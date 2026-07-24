import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

import { DEFAULT_RAW_FILE_MAX_BYTES } from './constants.js';
import { persistState } from './config.js';
import { BRAIN_PROFILE_JSON_SCHEMA, authenticatedBrainAbout, loadBrainProfile, saveBrainProfileRevision } from './brain-profile.js';
import {
  createDashboardRequestHandler,
  dashboardSessionCookie,
} from './dashboard.js';
import {
  getSharedGroup,
  insertMcpAuditLog,
  listMcpAuditLog,
  listSharedGroups,
  openDatabase,
  pruneMcpAuditLog,
  upsertSharedGroup,
} from './db.js';
import { filingRulesForBrain } from './filing-rules.js';
import {
  createBrainPage,
  createRawFile,
  createRawFileWithPage,
  deleteRawFile,
  listRawFiles,
  listBrainPath,
  normalizePageVisibility,
  pageVisibility,
  publicRawFiles,
  readBrainPage,
  readRawFile,
  renameBrainPage,
  renameRawFile,
  updateRawFile,
  updateBrainPage,
  updatePageVisibility,
} from './page-ops.js';
import { canonicalPagePath, canonicalPageUrl, isLoopbackHost, localPageUrl } from './page-links.js';
import { queryBrain, searchBrain } from './search.js';
import { syncBrain } from './sync.js';
import {
  authorizationServerMetadata,
  authRoutesEnabled,
  assertOAuthConfigured,
  authorizeMcpRequest,
  buildAuthConfig,
  completeOAuthCallback,
  createAgentOAuthStart,
  exchangeAgentOAuthCode,
  protectedResourceMetadata,
  registerOAuthClient,
  renderAuthErrorPage,
  renderConnectPage,
  renderOAuthCompletePage,
} from './mcp-auth.js';
import { createMcpAuthStore } from './mcp-auth-store.js';
import { findActiveMemberByEmail, listMembers, resolveActorMember } from './members.js';
import {
  auditTaskHygiene,
  createTaskPage,
  getTaskPage,
  listTaskPages,
  listTaskSummaries,
  updateTaskPage,
} from './task-ops.js';
import {
  BIGBRAIN_APP_VERSION,
  BIGBRAIN_MCP_PROTOCOL_VERSION,
  runtimeMetadata,
} from './runtime-metadata.js';

const execFileAsync = promisify(execFile);

export async function startMcpServer({
  config,
  host = '127.0.0.1',
  port = Number(process.env.PORT || 55560),
  authToken = process.env.BIGBRAIN_MCP_TOKEN || process.env.MCP_AUTH_TOKEN || null,
  authConfig = buildAuthConfig({ authToken }),
  syncIntervalMs = Number(process.env.BIGBRAIN_MCP_SYNC_INTERVAL_MS || 300000),
  gitBackupEnabled = process.env.BIGBRAIN_MCP_GIT_BACKUP === '1',
  gitBackupIntervalMs = Number(process.env.BIGBRAIN_MCP_GIT_BACKUP_INTERVAL_MS || 300000),
} = {}) {
  assertToolPolicyComplete();
  if (!authConfig.tokenStore) authConfig.tokenStore = await createMcpAuthStore(config, authConfig);
  let memberDb = null;
  if (authRoutesEnabled(authConfig) && !authConfig.memberLookup) {
    memberDb = await openDatabase(config);
    authConfig.memberLookup = (email) => findActiveMemberByEmail(memberDb, email);
  }
  if (authRoutesEnabled(authConfig)) assertOAuthConfigured(authConfig);
  const dashboardHandler = await createDashboardRequestHandler(config, { authConfig, basePath: '/dashboard' });
  await syncAndPersist(config);
  const syncTimer = syncIntervalMs > 0
    ? setInterval(() => {
        syncAndPersist(config).catch((error) => {
          console.error(`BigBrain MCP background sync failed: ${error.message}`);
        });
      }, syncIntervalMs)
    : null;
  if (syncTimer) syncTimer.unref?.();
  const gitBackupTimer = gitBackupEnabled && gitBackupIntervalMs > 0
    ? setInterval(() => {
        backupGitChanges(config, 'bigbrain: automated MCP backup').catch((error) => {
          console.error(`BigBrain MCP git backup failed: ${error.message}`);
        });
      }, gitBackupIntervalMs)
    : null;
  if (gitBackupTimer) gitBackupTimer.unref?.();

  const server = http.createServer(async (request, response) => {
    try {
      const route = new URL(request.url || '/', 'http://127.0.0.1');
      if (request.method === 'GET' && route.pathname === '/connect' && authRoutesEnabled(authConfig)) {
        return sendHtml(response, 200, renderConnectPage(authConfig));
      }
      if (request.method === 'GET' && isProtectedResourceMetadataPath(route.pathname) && authRoutesEnabled(authConfig)) {
        return sendJson(response, 200, protectedResourceMetadata(authConfig), { cacheControl: 'public, max-age=300' });
      }
      if (request.method === 'GET' && route.pathname === '/.well-known/oauth-authorization-server' && authRoutesEnabled(authConfig)) {
        return sendJson(response, 200, authorizationServerMetadata(authConfig), { cacheControl: 'public, max-age=300' });
      }
      if (request.method === 'POST' && route.pathname === '/oauth/register' && authRoutesEnabled(authConfig)) {
        const input = JSON.parse(await readRequestBody(request) || '{}');
        return sendJson(response, 200, await registerOAuthClient(authConfig, input), { cacheControl: 'no-store' });
      }
      if (request.method === 'GET' && route.pathname === '/oauth/authorize' && authRoutesEnabled(authConfig)) {
        response.writeHead(302, { location: await createAgentOAuthStart(authConfig, request.url || '/') });
        response.end();
        return;
      }
      if (request.method === 'POST' && route.pathname === '/oauth/token' && authRoutesEnabled(authConfig)) {
        const body = await readRequestBody(request);
        return sendJson(response, 200, await exchangeAgentOAuthCode(authConfig, new URLSearchParams(body)), { cacheControl: 'no-store' });
      }
      if (request.method === 'GET' && route.pathname === '/auth/callback' && authRoutesEnabled(authConfig)) {
        try {
          const issued = await completeOAuthCallback(authConfig, {
            code: route.searchParams.get('code'),
            state: route.searchParams.get('state'),
          });
          if (issued.redirect_uri) {
            const redirect = new URL(issued.redirect_uri);
            redirect.searchParams.set('code', issued.code);
            if (issued.state) redirect.searchParams.set('state', issued.state);
            response.writeHead(302, { location: redirect.toString() });
            response.end();
            return;
          }
          if (issued.dashboard_session_token) {
            response.writeHead(302, {
              location: issued.redirect_path || '/dashboard',
              'set-cookie': dashboardSessionCookie(issued.dashboard_session_token, authConfig),
            });
            response.end();
            return;
          }
          return sendHtml(response, 200, renderOAuthCompletePage(authConfig));
        } catch (error) {
          return sendHtml(response, 403, renderAuthErrorPage(authConfig, error instanceof Error ? error.message : String(error)));
        }
      }
      if (request.method === 'GET' && route.pathname === '/live') {
        return sendJson(response, 200, {
          ok: true,
          status: 'live',
          runtime: runtimeMetadata(),
        }, { cacheControl: 'no-store' });
      }
      if (request.method === 'GET' && (route.pathname === '/ready' || route.pathname === '/health')) {
        const readiness = await checkMcpReadiness(config);
        return sendJson(response, readiness.ok ? 200 : 503, {
          ...readiness,
          brain_id: config.brainId,
          brain_name: config.brainName,
          runtime: runtimeMetadata(),
        }, { cacheControl: 'no-store' });
      }
      if (isDashboardRequest(route.pathname)) {
        if (isDashboardAdminRequest(route.pathname)) {
          const authorization = authorizeTokenDashboardRequest(request, authConfig);
          if (!authorization.ok) {
            response.writeHead(401, {
              'content-type': 'text/plain; charset=utf-8',
              'www-authenticate': `Basic realm="${dashboardAuthRealm(authConfig)}", charset="UTF-8"`,
              'cache-control': 'no-store',
            });
            response.end(authorization.message || 'Unauthorized');
            return;
          }
        }
        return dashboardHandler(request, response);
      }
      if (request.method !== 'POST' || !request.url?.startsWith('/mcp')) {
        return sendJson(response, 404, jsonRpcError(null, -32004, 'Not found'));
      }
      const requestId = `req_${randomUUID()}`;
      const authorization = await authorizeMcpRequest(request, authConfig);
      if (!authorization.ok) {
        await auditMcpSecurityEvent(config, {
          action: 'mcp.security.authentication_failed',
          reason: authorization.message || 'Unauthorized',
          authMode: authConfig?.mode || null,
          requestId,
        }).catch(() => {});
        return sendJson(response, authorization.status || 401, jsonRpcError(null, -32001, authorization.message || 'Unauthorized'), {
          authConfig,
          includeResourceMetadata: true,
        });
      }

      const payload = JSON.parse(await readRequestBody(request, { maxBytes: mcpRequestMaxBytes(config) }));
      const result = Array.isArray(payload)
        ? (await Promise.all(payload.map((message) => handleJsonRpcMessage({ config, message, gitBackupEnabled, actor: authorization.actor, authConfig, requestId })))).filter(Boolean)
        : await handleJsonRpcMessage({ config, message: payload, gitBackupEnabled, actor: authorization.actor, authConfig, requestId });
      if (!result || (Array.isArray(result) && result.length === 0)) {
        return sendNoContent(response);
      }
      return sendJson(response, 200, result);
    } catch (error) {
      if (error instanceof HttpError) {
        return sendJson(response, error.statusCode, jsonRpcError(null, error.rpcCode, error.message));
      }
      return sendJson(response, 500, jsonRpcError(null, -32603, error instanceof Error ? error.message : String(error)));
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const resolvedPort = typeof address === 'object' && address ? address.port : port;
  const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const localOrigin = `http://${displayHost.includes(':') ? `[${displayHost}]` : displayHost}:${resolvedPort}`;
  authConfig.runtimeLocalUrl = isLoopbackHost(host) && !authConfig.publicUrl ? localOrigin : null;
  authConfig.runtimePublicUrl = authConfig.publicUrl || localOrigin;

  return {
    server,
    url: `${localOrigin}/mcp`,
    close: () => new Promise((resolve, reject) => {
      if (syncTimer) clearInterval(syncTimer);
      if (gitBackupTimer) clearInterval(gitBackupTimer);
      server.close(async (error) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          await memberDb?.close?.();
          resolve();
        } catch (closeError) {
          reject(closeError);
        }
      });
    }),
  };
}

function isDashboardRequest(pathname) {
  return pathname === '/dashboard'
    || pathname.startsWith('/dashboard/')
    || pathname === '/public'
    || pathname.startsWith('/public/')
    || pathname === '/shared'
    || pathname.startsWith('/shared/')
    || pathname === '/favicon.ico'
    || pathname.startsWith('/assets/')
    || pathname.startsWith('/api/');
}

function isDashboardAdminRequest(pathname) {
  return pathname === '/dashboard'
    || pathname.startsWith('/dashboard/')
    || (pathname.startsWith('/api/') && !isDashboardPublicApiRequest(pathname));
}

function isDashboardPublicApiRequest(pathname) {
  return pathname === '/api/public/page'
    || pathname === '/api/public/raw'
    || pathname === '/api/shared/group'
    || pathname === '/api/shared/raw';
}

function authorizeTokenDashboardRequest(request, authConfig) {
  if (authConfig?.mode !== 'token') return { ok: true };
  const expected = process.env.DASHBOARD_PASSWORD || authConfig.authToken || process.env.MCP_AUTH_TOKEN || process.env.BIGBRAIN_MCP_TOKEN || '';
  if (!expected) return { ok: false, message: 'Dashboard authentication is not configured.' };

  const authorization = request.headers.authorization || '';
  if (authorization.startsWith('Bearer ') && authorization.slice('Bearer '.length) === expected) return { ok: true };
  if (authorization.startsWith('Basic ')) {
    const decoded = Buffer.from(authorization.slice('Basic '.length), 'base64').toString('utf8');
    const password = decoded.includes(':') ? decoded.slice(decoded.indexOf(':') + 1) : decoded;
    if (password === expected) return { ok: true };
  }
  return { ok: false, message: 'Dashboard authentication required.' };
}

function dashboardAuthRealm(authConfig) {
  const name = String(authConfig?.appName || authConfig?.serviceName || 'BigBrain').replace(/"/g, '');
  return `${name} Dashboard`;
}

async function handleJsonRpcMessage({ config, message, gitBackupEnabled, actor, authConfig, requestId }) {
  if (!message || message.jsonrpc !== '2.0') return jsonRpcError(message?.id ?? null, -32600, 'Invalid JSON-RPC request.');
  if (message.id === undefined) return null;

  try {
    switch (message.method) {
      case 'initialize':
        return jsonRpcResult(message.id, {
          protocolVersion: BIGBRAIN_MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: config.brainIdentityPersisted ? config.brainName : 'bigbrain', version: BIGBRAIN_APP_VERSION },
        });
      case 'ping':
        return jsonRpcResult(message.id, {});
      case 'tools/list':
        return jsonRpcResult(message.id, { tools: toolDefinitions().filter((tool) => canCallTool(tool.name, actor)) });
      case 'tools/call':
        return jsonRpcResult(message.id, await callTool({ config, params: message.params || {}, gitBackupEnabled, actor, authConfig, requestId }));
      default:
        return jsonRpcError(message.id, -32601, `Unknown method: ${message.method}`);
    }
  } catch (error) {
    if (error instanceof ForbiddenToolError) {
      return jsonRpcError(message.id, -32003, error.message);
    }
    return jsonRpcError(message.id, -32603, error instanceof Error ? error.message : String(error));
  }
}

async function callTool({ config, params, gitBackupEnabled, actor, authConfig, requestId }) {
  const name = params.name;
  const args = params.arguments || {};
  try {
    assertToolAllowed(name, actor);
    const result = await executeToolCall({ config, name, args, gitBackupEnabled, actor, authConfig });
    if (isAuditedTool(name)) {
      await auditMcpToolCall(config, { actor, name, args, authConfig, requestId });
    }
    return result;
  } catch (error) {
    if (isAuditedTool(name) || error instanceof ForbiddenToolError) await auditMcpToolCall(config, {
      actor,
      name,
      args,
      authConfig,
      requestId,
      error: error instanceof Error ? error.message : String(error),
      errorCode: error instanceof ForbiddenToolError ? 'scope_denied' : 'tool_error',
    }).catch(() => {});
    throw error;
  }
}

async function executeToolCall({ config, name, args, gitBackupEnabled, actor, authConfig }) {
  switch (name) {
    case 'me':
      return toolJson(await toolMe(config, actor, authConfig));
    case 'members/list':
    case 'members_list':
      return toolJson(await toolMembersList(config, args), { arrayKey: 'members' });
    case 'tasks/list':
      return toolJson(await toolTasksList(config, args, actor, authConfig), { arrayKey: 'tasks' });
    case 'tasks/summary':
      return toolJson(await toolTasksSummary(config, args, actor, authConfig));
    case 'tasks/get':
      return toolJson(await toolTasksGet(config, args));
    case 'tasks/hygiene':
      return toolJson(await toolTasksHygiene(config, args, actor, authConfig));
    case 'tasks/create': {
      const task = await toolTasksCreate(config, args, actor, authConfig);
      await postWriteMaintenance(config, gitBackupEnabled, actor);
      return toolJson(task);
    }
    case 'tasks/update': {
      const task = await toolTasksUpdate(config, args, actor, authConfig);
      await postWriteMaintenance(config, gitBackupEnabled, actor);
      return toolJson(task);
    }
    case 'search':
      return toolJson(await toolSearch(config, args));
    case 'query':
      return toolJson(await toolQuery(config, args));
    case 'list':
      return toolJson(await listBrainPath({
        config,
        relativePath: args.path || '',
        recursive: args.recursive !== false,
        limit: args.limit,
        orderBy: args.order_by,
      }), { arrayKey: 'pages' });
    case 'read':
      return toolJson(pageWithCanonicalLink(
        await readBrainPage({ config, pagePath: args.path }),
        config,
        authConfig,
      ));
    case 'get_page_visibility': {
      const page = await readBrainPage({ config, pagePath: args.path });
      return toolJson(pageVisibilityToolResponse(page, config, authConfig));
    }
    case 'groups_list': {
      const db = await openDatabase(config);
      return toolJson(await listSharedGroups(db), { arrayKey: 'groups' });
    }
    case 'groups_get': {
      const db = await openDatabase(config);
      const group = await getSharedGroup(db, args.slug, { resolveRedirect: true });
      if (!group) throw new Error(`Shared group not found: ${args.slug}`);
      return toolJson(sharedGroupToolResponse(group, authConfig));
    }
    case 'filing_rules':
      return toolMarkdown(await filingRulesForBrain({ config }));
    case 'about': {
      const loaded = await loadBrainProfile(config);
      const availableOperations = toolDefinitions()
        .map((tool) => tool.name)
        .filter((toolName) => canCallTool(toolName, actor));
      return toolJson(authenticatedBrainAbout(config, loaded, {
        authState: actor ? 'authenticated' : 'local_trusted',
        writable: canCallTool('create_page', actor),
        availableOperations,
      }));
    }
    case 'about/update': {
      const member = await resolveProfileEditor(config, actor, authConfig);
      const written = await saveBrainProfileRevision(config, args.profile, {
        updatedBy: member?.person_slug || 'bigbrain-admin',
        approve: args.approve === true,
      });
      return toolJson(authenticatedBrainAbout(config, written, {
        authState: actor ? 'authenticated' : 'local_trusted',
        writable: true,
        availableOperations: toolDefinitions().map((tool) => tool.name).filter((toolName) => canCallTool(toolName, actor)),
      }));
    }
    case 'list_raw_files':
      return toolJson(await listRawFiles({
        config,
        rawPath: args.path || '',
        recursive: args.recursive !== false,
        limit: args.limit,
        orderBy: args.order_by,
      }), { arrayKey: 'files' });
    case 'read_raw_file':
      return toolJson(await readRawFile({ config, rawPath: args.path }));
    case 'create_raw_file': {
      const rawFile = await createRawFile({
        config,
        rawPath: args.path,
        rawContentBase64: args.raw_content_base64,
        rawContentText: args.raw_content_text,
        mimeType: args.mime_type,
      });
      await postWriteMaintenance(config, gitBackupEnabled, actor);
      return toolJson(rawFile);
    }
    case 'create_page': {
      const page = await createBrainPage({
        config,
        pagePath: args.path,
        title: args.title,
        body: args.body,
        timelineEntry: timelineWithActor(args.timeline_entry, actor),
        frontmatter: args.frontmatter || {},
      });
      await postWriteMaintenance(config, gitBackupEnabled, actor);
      return toolJson(page);
    }
    case 'create_raw_file_with_page': {
      const result = await createRawFileWithPage({
        config,
        rawPath: args.raw_path,
        rawContentBase64: args.raw_content_base64,
        rawContentText: args.raw_content_text,
        mimeType: args.mime_type,
        pagePath: args.page_path,
        title: args.title,
        body: args.body,
        timelineEntry: timelineWithActor(args.timeline_entry, actor),
        frontmatter: args.frontmatter || {},
      });
      await postWriteMaintenance(config, gitBackupEnabled, actor);
      return toolJson(result);
    }
    case 'update_raw_file': {
      const rawFile = await updateRawFile({
        config,
        rawPath: args.path,
        rawContentBase64: args.raw_content_base64,
        rawContentText: args.raw_content_text,
        mimeType: args.mime_type,
      });
      await postWriteMaintenance(config, gitBackupEnabled, actor);
      return toolJson(rawFile);
    }
    case 'rename_raw_file': {
      const rawFile = await renameRawFile({
        config,
        fromRawPath: args.from_path,
        toRawPath: args.to_path,
      });
      await postWriteMaintenance(config, gitBackupEnabled, actor);
      return toolJson(rawFile);
    }
    case 'delete_raw_file': {
      const result = await deleteRawFile({ config, rawPath: args.path });
      await postWriteMaintenance(config, gitBackupEnabled, actor);
      return toolJson(result);
    }
    case 'rename_page': {
      const page = await renameBrainPage({
        config,
        fromPagePath: args.from_path,
        toPagePath: args.to_path,
        title: args.title,
        timelineEntry: timelineWithActor(args.timeline_entry, actor),
      });
      await postWriteMaintenance(config, gitBackupEnabled, actor);
      return toolJson(page);
    }
    case 'update_page': {
      const page = await updateBrainPage({
        config,
        pagePath: args.path,
        body: args.body,
        timelineEntry: timelineWithActor(args.timeline_entry, actor),
      });
      await postWriteMaintenance(config, gitBackupEnabled, actor);
      return toolJson(page);
    }
    case 'set_page_visibility': {
      const visibility = normalizePageVisibility(args.visibility);
      const page = await updatePageVisibility({
        config,
        pagePath: args.path,
        visibility,
        publicRawFiles: args.public_raw_files,
        timelineEntry: timelineWithActor(args.timeline_entry || `Visibility set to ${visibility}.`, actor),
      });
      await postWriteMaintenance(config, gitBackupEnabled, actor);
      return toolJson(pageVisibilityToolResponse(page, config, authConfig));
    }
    case 'groups_upsert': {
      const db = await openDatabase(config);
      const group = await upsertSharedGroup(db, {
        slug: args.slug,
        title: args.title,
        description: args.description,
        visibility: args.visibility,
        redirect_from: args.redirect_from,
        pages: args.pages,
      });
      return toolJson(sharedGroupToolResponse(group, authConfig));
    }
    case 'maintenance/sync':
    case 'maintenance_sync':
      return toolJson(await syncAndPersist(config));
    case 'maintenance/git_backup':
    case 'maintenance_git_backup':
      return toolJson(await backupGitChanges(config, backupMessage(actor)));
    case 'audit/list':
    case 'audit_list':
      return toolJson(await toolAuditAccess(config, args, 'list'));
    case 'audit/export':
    case 'audit_export':
      return toolJson(await toolAuditAccess(config, args, 'export'));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function auditMcpToolCall(config, { actor, name, args, authConfig, requestId, error = null, errorCode = null }) {
  const db = await openDatabase(config);
  try {
    await insertMcpAuditLog(db, {
      actorEmail: actor?.email || null,
      actorType: actor?.email === 'shared-token' ? 'shared_token' : actor?.email ? 'member' : 'system',
      actorId: actor?.email || null,
      action: `mcp.tool.${name || 'unknown'}`,
      requestId,
      ...auditResource(name, args),
      outcome: errorCode === 'scope_denied' ? 'denied' : error ? 'error' : 'success',
      errorCode,
      authMode: authConfig?.mode || null,
      serviceName: authConfig?.serviceName || 'bigbrain-mcp',
      brainId: config.brainId,
      brainName: config.brainName,
      details: {
        arguments: sanitizeAuditArguments(args),
        ...(error ? { error: boundedAuditString(error) } : {}),
      },
    });
    await enforceAuditRetention(db, config);
  } finally {
    await db.close?.();
  }
}

function auditResource(name, args = {}) {
  const candidates = name?.startsWith('groups_') ? [['group', args.slug]]
    : name?.includes('raw_file') ? [['raw_file', args.raw_path || args.path]]
      : [['page', args.path || args.slug]];
  const [resourceType, resourceId] = candidates.find(([, value]) => typeof value === 'string' && value) || [];
  return { resourceType: resourceType || null, resourceId: resourceId ? boundedAuditString(resourceId) : null };
}

async function enforceAuditRetention(db, config) {
  const cutoff = new Date(Date.now() - config.mcpAuditRetentionDays * 86400000).toISOString();
  await pruneMcpAuditLog(db, { before: cutoff, limit: 1000 });
}

async function auditMcpSecurityEvent(config, { action, reason, authMode, requestId = null }) {
  const db = await openDatabase(config);
  try {
    await insertMcpAuditLog(db, {
      action,
      requestId,
      actorType: 'anonymous',
      outcome: 'denied',
      errorCode: 'authentication_failed',
      authMode,
      serviceName: 'bigbrain-mcp',
      brainId: config.brainId,
      brainName: config.brainName,
      details: {
        auth_mode: authMode,
        reason: boundedAuditString(reason),
      },
    });
  } finally {
    await db.close?.();
  }
}

async function toolAuditAccess(config, args, mode) {
  const db = await openDatabase(config);
  try {
    const limit = Math.min(Number(args.limit || 100), 1000);
    const rows = await listMcpAuditLog(db, { limit: limit + 1, cursor: args.cursor || null });
    const hasMore = rows.length > limit;
    const records = rows.slice(0, limit);
    const result = { records, next_cursor: hasMore ? records.at(-1)?.id || null : null };
    return mode === 'export' ? { format: 'ndjson', data: records.map((row) => JSON.stringify(row)).join('\n'), ...result } : result;
  } finally {
    await db.close?.();
  }
}

function isAuditedTool(name) {
  const layer = toolPolicy(name)?.layer;
  return ['create', 'publish', 'raw_destructive', 'git_backup', 'maintenance', 'admin'].includes(layer);
}

function sanitizeAuditArguments(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const sanitized = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveAuditKey(key) || key === 'raw_content_base64' || key === 'raw_content_text' || key === 'body') {
      sanitized[key] = redactedAuditValue(entry);
      continue;
    }
    if (key === 'frontmatter' && entry && typeof entry === 'object' && !Array.isArray(entry)) {
      sanitized[key] = Object.keys(entry).sort();
      continue;
    }
    sanitized[key] = sanitizeAuditValue(entry, key);
  }
  return sanitized;
}

function sanitizeAuditValue(value, key) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (AUDIT_IDENTIFIER_KEYS.has(key)) return boundedAuditString(value);
    return redactedAuditValue(value);
  }
  if (Array.isArray(value)) return value.map((entry) => sanitizeAuditValue(entry, key)).slice(0, 20);
  if (value && typeof value === 'object') return sanitizeAuditArguments(value);
  return value;
}

const AUDIT_IDENTIFIER_KEYS = new Set([
  'path', 'slug', 'old_path', 'new_path', 'page_slug', 'raw_path', 'status',
  'visibility', 'priority', 'readiness', 'execution_mode', 'assignee',
]);

function isSensitiveAuditKey(key) {
  return /(?:token|secret|password|authorization|cookie|api[_-]?key|client[_-]?secret)/i.test(key);
}

function boundedAuditString(value) {
  return String(value ?? '').slice(0, 240);
}

function redactedAuditValue(value) {
  if (value === undefined) return undefined;
  const length = typeof value === 'string' ? value.length : JSON.stringify(value ?? '').length;
  return { redacted: true, length };
}

function pageVisibilityToolResponse(page, config, authConfig) {
  const visibility = pageVisibility(page.frontmatter);
  const publicUrlPath = visibility === 'public' ? `/public/${page.slug}` : null;
  return {
    path: page.path,
    slug: page.slug,
    title: page.title,
    visibility,
    public_url: publicUrlPath ? absolutePublicUrl(authConfig, publicUrlPath) : null,
    public_url_path: publicUrlPath,
    public_raw_files: publicRawFiles(page.frontmatter),
    ...canonicalPageLinkFields(page, authConfig, config.brainId),
  };
}

function pageWithCanonicalLink(page, config, authConfig) {
  return {
    ...page,
    brain_id: config.brainId,
    ...canonicalPageLinkFields(page, authConfig, config.brainId),
  };
}

function canonicalPageLinkFields(page, authConfig, explicitBrainId = null) {
  const brainId = explicitBrainId || authConfig?.brainId;
  if (!brainId) return {};
  const pageUrlPath = canonicalPagePath(brainId, page.slug);
  const localOrigin = authConfig?.runtimeLocalUrl || null;
  const protectedOrigin = authConfig?.publicUrl
    || localOrigin
    || (authConfig?.runtimePublicUrl && !/^http:\/\/127\.0\.0\.1(?::|$)/.test(authConfig.runtimePublicUrl)
      ? authConfig.runtimePublicUrl
      : null);
  return {
    brain_id: brainId,
    page_url: protectedOrigin ? canonicalPageUrl(protectedOrigin, brainId, page.slug) : null,
    page_url_path: pageUrlPath,
    local_url: localPageUrl(brainId, page.slug),
  };
}

function sharedGroupToolResponse(group, authConfig) {
  const publicUrlPath = group.visibility === 'public' ? `/shared/${group.slug}` : null;
  return {
    slug: group.slug,
    title: group.title,
    description: group.description,
    visibility: group.visibility,
    public_url: publicUrlPath ? absolutePublicUrl(authConfig, publicUrlPath) : null,
    public_url_path: publicUrlPath,
    redirect_from: group.redirect_from || [],
    pages: group.pages || [],
    created_at: group.created_at,
    updated_at: group.updated_at,
  };
}

function absolutePublicUrl(authConfig, publicUrlPath) {
  const origin = (authConfig?.publicUrl || authConfig?.runtimePublicUrl || '').replace(/\/+$/, '');
  if (!origin) return publicUrlPath;
  return new URL(publicUrlPath, origin).toString();
}

async function postWriteMaintenance(config, gitBackupEnabled, actor) {
  await syncAndPersist(config);
  if (gitBackupEnabled && canRunGitBackup(actor)) {
    await backupGitChanges(config, backupMessage(actor));
  }
}

async function toolMe(config, actor, authConfig) {
  const db = await openDatabase(config);
  try {
    const member = await resolveActorMember(db, actor, memberResolutionFromAuthConfig(authConfig));
    return {
      actor: actor || null,
      member,
      person_slug: member?.person_slug || null,
      authenticated: Boolean(actor?.email),
    };
  } finally {
    await db.close?.();
  }
}

async function toolMembersList(config, args) {
  const db = await openDatabase(config);
  try {
    return await listMembers(db, { status: args.status || 'active' });
  } finally {
    await db.close?.();
  }
}

async function toolTasksList(config, args, actor, authConfig) {
  const db = await openDatabase(config);
  try {
    return await listTaskPages({
      config,
      db,
      assignee: args.assignee || null,
      status: args.status || null,
      priority: args.priority || null,
      readiness: args.readiness || null,
      executionMode: args.execution_mode || null,
      actor,
      memberResolution: memberResolutionFromAuthConfig(authConfig),
    });
  } finally {
    await db.close?.();
  }
}

async function toolTasksSummary(config, args, actor, authConfig) {
  const db = await openDatabase(config);
  try {
    return await listTaskSummaries({
      config,
      db,
      assignee: args.assignee || null,
      statuses: args.statuses,
      priority: args.priority || null,
      readiness: args.readiness || null,
      executionMode: args.execution_mode || null,
      limit: args.limit,
      cursor: args.cursor,
      actor,
      memberResolution: memberResolutionFromAuthConfig(authConfig),
    });
  } finally {
    await db.close?.();
  }
}

async function toolTasksGet(config, args) {
  const db = await openDatabase(config);
  try {
    return await getTaskPage({ config, db, path: args.path });
  } finally {
    await db.close?.();
  }
}

async function toolTasksHygiene(config, args, actor, authConfig) {
  const db = await openDatabase(config);
  try {
    return await auditTaskHygiene({
      config,
      db,
      assignee: args.assignee || null,
      statuses: args.statuses,
      staleDays: args.stale_days,
      limit: args.limit,
      cursor: args.cursor,
      actor,
      memberResolution: memberResolutionFromAuthConfig(authConfig),
    });
  } finally {
    await db.close?.();
  }
}

async function toolTasksCreate(config, args, actor, authConfig) {
  const db = await openDatabase(config);
  try {
    return await createTaskPage({
      config,
      db,
      title: args.title,
      body: args.body,
      assignees: args.assignees || [],
      status: args.status || 'open',
      priority: args.priority || 'p3',
      readiness: args.readiness || 'underspecified',
      executionMode: args.execution_mode || 'agent',
      source: args.source || [],
      path: args.path || null,
      timelineEntry: timelineWithActor(args.timeline_entry || 'Task created through MCP.', actor),
      actor,
      memberResolution: memberResolutionFromAuthConfig(authConfig),
    });
  } finally {
    await db.close?.();
  }
}

async function toolTasksUpdate(config, args, actor, authConfig) {
  const db = await openDatabase(config);
  try {
    return await updateTaskPage({
      config,
      db,
      path: args.path,
      body: args.body,
      status: args.status,
      priority: args.priority,
      readiness: args.readiness,
      executionMode: args.execution_mode,
      assignees: args.assignees,
      source: args.source,
      timelineEntry: timelineWithActor(args.timeline_entry || 'Task updated through MCP.', actor),
      actor,
      memberResolution: memberResolutionFromAuthConfig(authConfig),
    });
  } finally {
    await db.close?.();
  }
}

function memberResolutionFromAuthConfig(authConfig) {
  return {
    authMode: authConfig?.mode || null,
    localPersonSlug: authConfig?.localPersonSlug || null,
  };
}

async function toolSearch(config, args) {
  const query = requireString(args.query, 'query');
  const limit = normalizeLimit(args.limit, 10);
  const db = await openDatabase(config);
  try {
    return await searchBrain({
      db,
      config,
      query,
      limit,
      mode: args.mode,
      explain: args.explain === true,
    });
  } finally {
    await db.close?.();
  }
}

async function toolQuery(config, args) {
  const question = args.question !== undefined
    ? requireString(args.question, 'question')
    : requireString(args.query, 'query');
  const limit = normalizeLimit(args.limit, 6);
  const db = await openDatabase(config);
  try {
    return await queryBrain({
      db,
      config,
      question,
      limit,
      mode: args.mode,
      explain: args.explain === true,
      expand: typeof args.expand === 'boolean' ? args.expand : undefined,
    });
  } finally {
    await db.close?.();
  }
}

async function syncAndPersist(config) {
  const result = await syncBrain({ config });
  await persistState(config.statePath, {
    last_checked_at: new Date().toISOString(),
    last_run_status: 'success',
    last_run_summary: `Index now has ${result.index_totals_after_sync.pages} page(s); ${result.outstanding_work.pages_needing_embeddings} page(s) need embeddings`,
    last_seen_files: [],
  });
  return result;
}

async function checkMcpReadiness(config) {
  let db;
  try {
    const brain = await fs.stat(config.brainDir);
    if (!brain.isDirectory()) return notReady('brain_unavailable');
  } catch {
    return notReady('brain_unavailable');
  }

  try {
    db = await openDatabase(config);
    return {
      ok: true,
      status: 'ready',
      checks: {
        brain: 'ok',
        storage: 'ok',
      },
    };
  } catch {
    return notReady('storage_unavailable');
  } finally {
    try {
      await db?.close?.();
    } catch {
      // Readiness is based on opening storage; cleanup failures are non-fatal here.
    }
  }
}

function notReady(reason) {
  return {
    ok: false,
    status: 'not_ready',
    reason,
    checks: {
      brain: reason === 'brain_unavailable' ? 'unavailable' : 'ok',
      storage: reason === 'storage_unavailable' ? 'unavailable' : 'not_checked',
    },
  };
}

async function backupGitChanges(config, message) {
  const repoRoot = await gitRepoRoot(config.brainDir);
  const status = await git(repoRoot, ['status', '--porcelain']);
  if (!status.stdout.trim()) return { committed: false, pushed: false };

  const relativeBrainDir = path.relative(repoRoot, config.brainDir) || '.';
  await git(repoRoot, ['pull', '--rebase', '--autostash']);
  await git(repoRoot, ['add', relativeBrainDir]);
  const staged = await git(repoRoot, ['diff', '--cached', '--quiet']).catch((error) => error);
  if (staged && staged.code === 0) return { committed: false, pushed: false };
  if (staged && staged.code !== 1) throw staged;
  const stagedNames = await git(repoRoot, ['diff', '--cached', '--name-only']);
  if (!stagedNames.stdout.trim()) return { committed: false, pushed: false };

  await git(repoRoot, ['commit', '-m', message]);
  await git(repoRoot, ['push']);
  return { committed: true, pushed: true };
}

async function gitRepoRoot(cwd) {
  const result = await git(cwd, ['rev-parse', '--show-toplevel']);
  return result.stdout.trim();
}

async function git(cwd, args) {
  return execFileAsync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
    maxBuffer: 10 * 1024 * 1024,
  });
}

function toolDefinitions() {
  return [
    {
      name: 'me',
      description: 'Return the authenticated MCP actor and the matching active BigBrain member, if one exists.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'members/list',
      description: 'List BigBrain members who can authenticate and be assigned tasks.',
      inputSchema: membersListSchema(),
    },
    {
      name: 'members_list',
      description: 'Alias for members/list for clients that do not support slash tool names.',
      inputSchema: membersListSchema(),
    },
    {
      name: 'tasks/list',
      description: 'List task pages under tasks/, optionally filtered by assignee, status, priority, readiness, or execution_mode. Use assignee=me for the authenticated member.',
      inputSchema: tasksListSchema(),
    },
    {
      name: 'tasks/summary',
      description: 'List bounded compact task metadata for ranking without returning task bodies, timelines, sources, markdown, or open-question text. Defaults to in_progress and open. Use tasks/get only after selecting a task that needs full handoff context.',
      inputSchema: tasksSummarySchema(),
    },
    {
      name: 'tasks/get',
      description: 'Read one selected task with its full body, timeline, sources, and open questions. Use after compact ranking when the task has been selected for handoff or detailed review.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Task slug or markdown path under tasks/.' },
        },
        required: ['path'],
      },
    },
    {
      name: 'tasks/hygiene',
      description: 'Run a read-only bounded audit for likely stale, overdue, unassigned, invalid-assignee, or backlogged tasks. This tool never mutates or archives tasks.',
      inputSchema: tasksHygieneSchema(),
    },
    {
      name: 'tasks/create',
      description: 'Create one member-assigned task page under tasks/. Assignees must be active members; assignees may include me. Set readiness and execution_mode as agent-authored handoff hints: agent for autonomous agent-completable work, interactive when guided user judgement/review/decisions are needed, or user only for real-world actions Codex cannot meaningfully perform. If creating a done or archived task, timeline_entry must include either "Next task: tasks/<slug>" or "No successor task needed: <reason>".',
      inputSchema: taskWriteSchema({ requireBody: true }),
    },
    {
      name: 'tasks/update',
      description: 'Update one task page under tasks/, including status, readiness, execution_mode, priority, assignees, source, body, and timeline. Treat readiness and execution_mode as agent-authored handoff hints; reclassify them case by case instead of relying on write-time body validation. When setting status to done or archived, timeline_entry must include either "Next task: tasks/<slug>" or "No successor task needed: <reason>".',
      inputSchema: taskWriteSchema({ update: true }),
    },
    {
      name: 'search',
      description: 'Search the selected BigBrain brain using lexical and semantic retrieval when embeddings are available.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
          mode: { type: 'string', enum: ['conservative', 'balanced', 'tokenmax'] },
          explain: { type: 'boolean' },
        },
        required: ['query'],
      },
    },
    {
      name: 'query',
      description: 'Answer a question using retrieved BigBrain context.',
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          query: { type: 'string' },
          limit: { type: 'number' },
          mode: { type: 'string', enum: ['conservative', 'balanced', 'tokenmax'] },
          explain: { type: 'boolean' },
          expand: { type: 'boolean' },
        },
      },
    },
    {
      name: 'list',
      description: 'List files and folders under the selected brain root, optionally constrained by path prefix.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          recursive: { type: 'boolean' },
          limit: { type: 'number' },
          order_by: { type: 'string', enum: ['updated_at', 'created_at', 'alphanumeric'] },
        },
      },
    },
    {
      name: 'read',
      description: 'Read one markdown page from the brain. The response includes a protected page_url and a stable loopback local_url for the BigBrain desktop resolver.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
    },
    {
      name: 'get_page_visibility',
      description: 'Return one page private viewing link and whether it is internal or public. local_url opens the connected brain through the loopback-only BigBrain desktop resolver; page_url remains protected remotely. When public, public_url is a directly shareable absolute public URL.',
      inputSchema: pageVisibilitySchema({ requireVisibility: false }),
    },
    {
      name: 'groups_list',
      description: 'List first-class shared groups and their ordered member pages.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'groups_get',
      description: 'Read one first-class shared group by slug, resolving group redirects when present.',
      inputSchema: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Shared group slug such as active-deals.' },
        },
        required: ['slug'],
      },
    },
    {
      name: 'about',
      description: 'Return the authenticated routing profile and bounded capabilities for this BigBrain instance. Missing, invalid, or unapproved profiles fail closed to review.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'about/update',
      description: 'Replace the versioned brain routing profile. Requires administrative authority. Set approve=true only after the owner reviewed the complete profile.',
      inputSchema: {
        type: 'object',
        properties: {
          profile: BRAIN_PROFILE_JSON_SCHEMA,
          approve: { type: 'boolean' },
        },
        required: ['profile', 'approve'],
      },
    },
    {
      name: 'filing_rules',
      description: 'Return the selected brain filing rules as combined Markdown, compiled from top-level and collection FILING.md files.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'list_raw_files',
      description: 'List raw files stored under .raw folders in the selected brain.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Optional .raw path prefix such as deals/.raw, meetings/.raw, deliverables/.raw, or writing/.raw for unassigned evidence.' },
          recursive: { type: 'boolean' },
          limit: { type: 'number' },
          order_by: { type: 'string', enum: ['updated_at', 'created_at', 'alphanumeric'] },
        },
      },
    },
    {
      name: 'read_raw_file',
      description: 'Read one raw file as base64 content.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Raw file path such as deals/.raw/blind-teaser.pdf, meetings/.raw/call-transcript.txt, or writing/.raw/unassigned-evidence.pdf.' },
        },
        required: ['path'],
      },
    },
    {
      name: 'create_raw_file',
      description: 'Create one raw file under <collection>/.raw/<filename> without creating a markdown page. Do not nest folders inside .raw. Raw uploads are size-limited to protect git-backed sync.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Destination such as deals/.raw/blind-teaser.pdf, meetings/.raw/call-transcript.txt, or writing/.raw/unassigned-evidence.pdf.' },
          raw_content_base64: { type: 'string', description: 'Base64 encoded raw bytes. Use this for PDFs, images, and other binary files.' },
          raw_content_text: { type: 'string', description: 'Plain text raw content. Use exactly one of raw_content_base64 or raw_content_text.' },
          mime_type: { type: 'string' },
        },
        required: ['path'],
      },
    },
    {
      name: 'create_page',
      description: 'Create a markdown brain page with frontmatter, current body, and a timeline entry.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
          timeline_entry: { type: 'string' },
          frontmatter: { type: 'object' },
        },
        required: ['path', 'title', 'body', 'timeline_entry'],
      },
    },
    {
      name: 'create_raw_file_with_page',
      description: 'Upload a raw file under <collection>/.raw/<filename> and create the corresponding markdown brain page in one call. Do not nest folders inside .raw. Raw uploads are size-limited to protect git-backed sync.',
      inputSchema: {
        type: 'object',
        properties: {
          raw_path: { type: 'string', description: 'Destination such as deals/.raw/blind-teaser.pdf, meetings/.raw/call-transcript.txt, deliverables/.raw/brief.pdf, or writing/.raw/unassigned-evidence.pdf.' },
          raw_content_base64: { type: 'string', description: 'Base64 encoded raw bytes. Use this for PDFs, images, and other binary files.' },
          raw_content_text: { type: 'string', description: 'Plain text raw content. Use exactly one of raw_content_base64 or raw_content_text.' },
          mime_type: { type: 'string' },
          page_path: { type: 'string', description: 'Optional deterministic attachment sidecar path. When supplied it must equal <collection>/.raw/<raw-basename>.md; otherwise it is derived from raw_path.' },
          title: { type: 'string' },
          body: { type: 'string' },
          timeline_entry: { type: 'string' },
          frontmatter: { type: 'object' },
        },
        required: ['raw_path', 'title', 'body', 'timeline_entry'],
      },
    },
    {
      name: 'update_raw_file',
      description: 'Replace the bytes of one existing raw file under .raw. Raw uploads are size-limited to protect git-backed sync.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Existing raw file path such as deals/.raw/blind-teaser.pdf, meetings/.raw/call-transcript.txt, or writing/.raw/unassigned-evidence.pdf.' },
          raw_content_base64: { type: 'string', description: 'Base64 encoded raw bytes. Use this for PDFs, images, and other binary files.' },
          raw_content_text: { type: 'string', description: 'Plain text raw content. Use exactly one of raw_content_base64 or raw_content_text.' },
          mime_type: { type: 'string' },
        },
        required: ['path'],
      },
    },
    {
      name: 'delete_raw_file',
      description: 'Delete one existing raw file under .raw.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Existing raw file path such as sources/.raw/deck.pdf.' },
        },
        required: ['path'],
      },
    },
    {
      name: 'rename_raw_file',
      description: 'Rename one existing raw file under .raw and rewrite markdown links, raw_file frontmatter, and public_raw_files references that pointed to the old raw file path.',
      inputSchema: {
        type: 'object',
        properties: {
          from_path: { type: 'string', description: 'Existing raw file path such as deals/.raw/company-specific-teaser.pdf.' },
          to_path: { type: 'string', description: 'Destination raw file path such as deals/.raw/regional-platform-blind-teaser.pdf.' },
        },
        required: ['from_path', 'to_path'],
      },
    },
    {
      name: 'rename_page',
      description: 'Rename one markdown brain page and rewrite relative markdown links that pointed to the old page path. Optionally update the page title during the rename.',
      inputSchema: {
        type: 'object',
        properties: {
          from_path: { type: 'string', description: 'Existing markdown page path such as deals/company-specific-teaser.md.' },
          to_path: { type: 'string', description: 'Destination markdown page path such as deals/regional-platform-blind-teaser.md.' },
          title: { type: 'string', description: 'Optional replacement title for the moved page.' },
          timeline_entry: { type: 'string' },
        },
        required: ['from_path', 'to_path', 'timeline_entry'],
      },
    },
    {
      name: 'update_page',
      description: 'Replace the current body of a markdown brain page and append a timeline entry.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          body: { type: 'string' },
          timeline_entry: { type: 'string' },
        },
        required: ['path', 'body', 'timeline_entry'],
      },
    },
    {
      name: 'set_page_visibility',
      description: 'Set one page to internal or public. Public makes the page body available on the internet and returns a directly usable absolute public_url; frontmatter, timeline, linked private pages, and raw files stay private unless raw files are explicitly listed in public_raw_files.',
      inputSchema: pageVisibilitySchema({ requireVisibility: true }),
    },
    {
      name: 'groups_upsert',
      description: 'Create or update a first-class shared group. A public group is served at /shared/<slug> and exposes only explicitly curated member summaries plus safe raw attachments.',
      inputSchema: sharedGroupWriteSchema(),
    },
    {
      name: 'audit/list',
      description: 'List bounded MCP audit records using cursor pagination. Requires brain:admin.',
      inputSchema: auditAccessSchema(),
    },
    {
      name: 'audit/export',
      description: 'Export one bounded page of MCP audit records as NDJSON. Requires brain:admin.',
      inputSchema: auditAccessSchema(),
    },
    {
      name: 'maintenance/sync',
      description: 'Run BigBrain sync for the selected brain and persist the latest sync state. Requires a maintenance/admin scope on hosted OAuth.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'maintenance_sync',
      description: 'Alias for maintenance/sync for clients that do not support slash tool names.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'maintenance/git_backup',
      description: 'Commit and push pending changes for the selected git-backed brain. Requires a git-backup/admin scope on hosted OAuth.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'maintenance_git_backup',
      description: 'Alias for maintenance/git_backup for clients that do not support slash tool names.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ];
}

function assertToolAllowed(name, actor) {
  if (!canCallTool(name, actor)) {
    const policy = toolPolicy(name);
    if (!policy) throw new ForbiddenToolError(`${name} is not enabled by hosted MCP tool policy.`);
    throw new ForbiddenToolError(`${name} requires ${policy.scopes.join(' or ')} scope.`);
  }
}

function canCallTool(name, actor) {
  const scopes = actorScopes(actor);
  if (scopes === null) return true;
  const policy = toolPolicy(name);
  if (!policy) return false;
  if (scopes.has('brain:admin')) return true;
  return policy.scopes.some((scope) => scopes.has(scope));
}

function canRunGitBackup(actor) {
  const scopes = actorScopes(actor);
  if (scopes === null) return true;
  return scopes.has('brain:admin') || scopes.has('brain:git-backup');
}

function actorScopes(actor) {
  if (!actor || !Array.isArray(actor.scopes)) return null;
  return new Set(actor.scopes);
}

function toolPolicy(name) {
  const policies = TOOL_POLICIES;
  return policies[name] || null;
}

const TOOL_POLICIES = {
  me: { layer: 'read', scopes: ['brain:read'] },
  'members/list': { layer: 'read', scopes: ['brain:read'] },
  members_list: { layer: 'read', scopes: ['brain:read'] },
  'tasks/list': { layer: 'read', scopes: ['brain:read'] },
  'tasks/summary': { layer: 'read', scopes: ['brain:read'] },
  'tasks/get': { layer: 'read', scopes: ['brain:read'] },
  'tasks/hygiene': { layer: 'read', scopes: ['brain:read'] },
  search: { layer: 'read', scopes: ['brain:read'] },
  query: { layer: 'read', scopes: ['brain:read'] },
  list: { layer: 'read', scopes: ['brain:read'] },
  read: { layer: 'read', scopes: ['brain:read'] },
  get_page_visibility: { layer: 'read', scopes: ['brain:read'] },
  groups_list: { layer: 'read', scopes: ['brain:read'] },
  groups_get: { layer: 'read', scopes: ['brain:read'] },
  filing_rules: { layer: 'read', scopes: ['brain:read'] },
  about: { layer: 'read', scopes: ['brain:read'] },
  'about/update': { layer: 'admin', scopes: ['brain:admin'] },
  list_raw_files: { layer: 'read', scopes: ['brain:read'] },
  read_raw_file: { layer: 'read', scopes: ['brain:read'] },
  'tasks/create': { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  'tasks/update': { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  create_raw_file: { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  create_page: { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  create_raw_file_with_page: { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  update_page: { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  rename_page: { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  groups_upsert: { layer: 'publish', scopes: ['brain:publish'] },
  set_page_visibility: { layer: 'publish', scopes: ['brain:publish'] },
  update_raw_file: { layer: 'raw_destructive', scopes: ['brain:raw:destructive'] },
  rename_raw_file: { layer: 'raw_destructive', scopes: ['brain:raw:destructive'] },
  delete_raw_file: { layer: 'raw_destructive', scopes: ['brain:raw:destructive'] },
  'maintenance/git_backup': { layer: 'git_backup', scopes: ['brain:git-backup'] },
  maintenance_git_backup: { layer: 'git_backup', scopes: ['brain:git-backup'] },
  'maintenance/sync': { layer: 'maintenance', scopes: ['brain:maintenance'] },
  maintenance_sync: { layer: 'maintenance', scopes: ['brain:maintenance'] },
  'audit/list': { layer: 'admin', scopes: ['brain:admin'] },
  audit_list: { layer: 'admin', scopes: ['brain:admin'] },
  'audit/export': { layer: 'admin', scopes: ['brain:admin'] },
  audit_export: { layer: 'admin', scopes: ['brain:admin'] },
};

async function resolveProfileEditor(config, actor, authConfig) {
  const db = await openDatabase(config);
  try {
    const member = await resolveActorMember(db, actor, memberResolutionFromAuthConfig(authConfig));
    if (member && member.role !== 'owner') throw new Error('Only a brain owner may update the routing profile.');
    return member;
  } finally {
    await db.close?.();
  }
}

function assertToolPolicyComplete() {
  const advertised = new Set(toolDefinitions().map((tool) => tool.name));
  const missing = Array.from(advertised).filter((name) => !TOOL_POLICIES[name]);
  if (missing.length) throw new Error(`MCP tools missing hosted authorization policy: ${missing.join(', ')}`);
}

function auditAccessSchema() {
  return { type: 'object', properties: {
    limit: { type: 'integer', minimum: 1, maximum: 1000 },
    cursor: { type: 'integer', minimum: 1 },
  } };
}

function membersListSchema() {
  return {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['active', 'inactive', 'invited'] },
    },
  };
}

function tasksListSchema() {
  return {
    type: 'object',
    properties: {
      assignee: { type: 'string', description: 'Active member person slug such as people/hani, or me for the authenticated member.' },
      status: { type: 'string', enum: ['open', 'in_progress', 'waiting', 'done', 'archived'] },
      priority: { type: 'string', enum: ['p0', 'p1', 'p2', 'p3'] },
      readiness: { type: 'string', enum: ['underspecified', 'ready'] },
      execution_mode: { type: 'string', enum: ['agent', 'user', 'interactive'], description: 'Who can execute the task: agent for autonomous agent-completable work, interactive for guided work needing user judgement/review/decisions, user only for real-world actions Codex cannot perform.' },
    },
  };
}

function tasksSummarySchema() {
  return {
    type: 'object',
    properties: {
      assignee: { type: 'string', description: 'Active member person slug such as people/hani, or me for the authenticated member.' },
      statuses: {
        type: 'array',
        items: { type: 'string', enum: ['open', 'in_progress', 'waiting', 'done', 'archived'] },
        minItems: 1,
        uniqueItems: true,
      },
      priority: { type: 'string', enum: ['p0', 'p1', 'p2', 'p3'] },
      readiness: { type: 'string', enum: ['underspecified', 'ready'] },
      execution_mode: { type: 'string', enum: ['agent', 'user', 'interactive'] },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      cursor: { type: 'integer', minimum: 0, description: 'Best-effort offset cursor for the current task snapshot.' },
    },
  };
}

function tasksHygieneSchema() {
  return {
    type: 'object',
    properties: {
      assignee: { type: 'string', description: 'Optional active member person slug, or me for the authenticated member.' },
      statuses: {
        type: 'array',
        items: { type: 'string', enum: ['open', 'in_progress', 'waiting', 'done', 'archived'] },
        minItems: 1,
        uniqueItems: true,
      },
      stale_days: { type: 'integer', minimum: 1, maximum: 3650, default: 30 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      cursor: { type: 'integer', minimum: 0, description: 'Best-effort offset cursor for the current task snapshot.' },
    },
  };
}

function pageVisibilitySchema({ requireVisibility }) {
  return {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Markdown page path such as people/alice or people/alice.md.' },
      visibility: { type: 'string', enum: ['internal', 'public'], description: 'internal is private to the brain; public exposes the page body and returns an absolute public_url plus public_url_path.' },
      public_raw_files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional explicit raw-file allowlist such as ["ops/.raw/onboarding.pdf"]. Only linked or attached PDF, PNG, JPG, JPEG, WebP, TXT, and CSV files can be served on public pages.',
      },
      timeline_entry: { type: 'string', description: 'Optional timeline note for the visibility change.' },
    },
    required: requireVisibility ? ['path', 'visibility'] : ['path'],
  };
}

function sharedGroupWriteSchema() {
  return {
    type: 'object',
    properties: {
      slug: { type: 'string', description: 'Simple shared URL slug such as active-deals. Public URL is /shared/<slug>.' },
      title: { type: 'string' },
      description: { type: 'string' },
      visibility: { type: 'string', enum: ['internal', 'public'], description: 'internal is private to MCP; public exposes the group at /shared/<slug>.' },
      redirect_from: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional previous group slugs that should redirect to this group.',
      },
      pages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            page_slug: { type: 'string' },
            slug: { type: 'string' },
            path: { type: 'string' },
            label: { type: 'string' },
            public_summary: {
              type: 'string',
              description: 'Optional curated public description for this group card. When omitted, the public card has no description; private page content is never used as a fallback.',
            },
            sort_order: { type: 'number' },
            raw_files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional raw file paths to expose for this member through the group, such as deals/.raw/teaser.pdf.',
            },
          },
        },
        description: 'Ordered member pages. Each item may use page_slug, slug, or path, may provide a curated public_summary, and may select public raw_files for that member.',
      },
    },
    required: ['slug', 'title', 'pages'],
  };
}

function taskWriteSchema({ requireBody = false, update = false } = {}) {
  return {
    type: 'object',
    properties: {
      path: { type: 'string', description: update ? 'Existing task path under tasks/.' : 'Optional destination path under tasks/.' },
      title: { type: 'string' },
      body: { type: 'string' },
      status: { type: 'string', enum: ['open', 'in_progress', 'waiting', 'done', 'archived'] },
      priority: { type: 'string', enum: ['p0', 'p1', 'p2', 'p3'] },
      readiness: { type: 'string', enum: ['underspecified', 'ready'], description: 'Agent-authored handoff state. Use ready when the task appears specified enough to work; use underspecified when it clearly needs more context. Presentation tools may still surface open questions as input-needed.' },
      execution_mode: { type: 'string', enum: ['agent', 'user', 'interactive'], description: 'Who can execute the task: agent for autonomous agent-completable work, interactive for guided work needing user judgement/review/decisions, user only for real-world actions Codex cannot perform.' },
      assignees: { type: 'array', items: { type: 'string' }, description: 'Active member person slugs, or me for the authenticated member.' },
      source: { type: 'array', items: { type: 'string' }, description: 'Related brain slugs such as meetings/example or initiatives/example.' },
      timeline_entry: { type: 'string', description: 'Required when completing or archiving a task. Use "Next task: tasks/<slug>" or "No successor task needed: <reason>".' },
    },
    required: update ? ['path'] : requireBody ? ['title', 'body'] : ['title'],
  };
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function toolJson(value, { arrayKey = 'items' } = {}) {
  const text = JSON.stringify(value, null, 2);
  const structuredContent = Array.isArray(value) ? { [arrayKey]: value } : value;
  return {
    content: [{ type: 'text', text }],
    structuredContent,
  };
}

function toolMarkdown(value) {
  return {
    content: [{ type: 'text', text: value.markdown }],
    structuredContent: value,
  };
}

function sendJson(response, statusCode, value, options = {}) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  };
  if (options.cacheControl) headers['cache-control'] = options.cacheControl;
  if (options.includeResourceMetadata && options.authConfig?.publicUrl) {
    headers['www-authenticate'] = `Bearer error="invalid_token", resource_metadata="${options.authConfig.publicUrl}/.well-known/oauth-protected-resource/mcp"`;
  }
  response.writeHead(statusCode, headers);
  response.end(JSON.stringify(value));
}

function sendNoContent(response) {
  response.writeHead(202, {
    'access-control-allow-origin': '*',
  });
  response.end();
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(html);
}

function isProtectedResourceMetadataPath(pathname) {
  return pathname === '/.well-known/oauth-protected-resource'
    || pathname === '/.well-known/oauth-protected-resource/mcp'
    || pathname === '/.well-known/oauth-protected-resource/api/mcp';
}

async function readRequestBody(request, { maxBytes = null } = {}) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (maxBytes && total > maxBytes) {
      throw new HttpError(413, -32013, `MCP request body is too large: ${formatBytes(total)} exceeds the configured request limit of ${formatBytes(maxBytes)}.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function mcpRequestMaxBytes(config) {
  const rawLimit = Number.isInteger(config?.rawFileMaxBytes) && config.rawFileMaxBytes > 0
    ? config.rawFileMaxBytes
    : DEFAULT_RAW_FILE_MAX_BYTES;
  return Math.ceil(rawLimit * 1.5) + 1024 * 1024;
}

class HttpError extends Error {
  constructor(statusCode, rpcCode, message) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.rpcCode = rpcCode;
  }
}

class ForbiddenToolError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ForbiddenToolError';
  }
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} bytes`;
}

function requireString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function normalizeLimit(value, fallback) {
  const number = Number(value || fallback);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), 50);
}

function timelineWithActor(entry, actor) {
  if (!actor?.email) return entry;
  return `${entry} (via ${actor.email})`;
}

function backupMessage(actor) {
  return actor?.email
    ? `bigbrain: MCP contribution from ${actor.email}`
    : 'bigbrain: automated MCP backup';
}
