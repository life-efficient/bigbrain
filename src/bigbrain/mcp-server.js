import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

import { DEFAULT_RAW_FILE_MAX_BYTES } from './constants.js';
import { callSubstackLedger, substackLedgerInputSchema, substackWorkflow } from './substack-mcp.js';
import { callRssLedger, rssLedgerInputSchema, rssWorkflow } from './rss-mcp.js';
import { articleSlug, fetchArticleCapture } from './article-capture.js';
import { withRssIngestionStatus } from './rss-ingestion-status.js';
import { persistState } from './config.js';
import { BRAIN_PROFILE_JSON_SCHEMA, authenticatedBrainAbout, loadBrainProfile, saveBrainProfileRevision } from './brain-profile.js';
import {
  createBrainDomain,
  deleteBrainDomain,
  domainMembershipFieldSchema,
  getBrainDomain,
  listBrainDomains,
  loadDomainRegistrySync,
  updateBrainDomain,
} from './domains.js';
import {
  bootstrapPageSchemaRegistry,
  deletePageSchema,
  getPageSchema,
  listPageSchemas,
  loadPageSchemaRegistry,
  registerPageSchema,
  updatePageSchema,
} from './page-schema-registry.js';
import {
  createDashboardRequestHandler,
  dashboardSessionCookie,
} from './dashboard.js';
import {
  getSharedGroup,
  insertMcpAuditLog,
  listMcpAuditLog,
  listPageProvenance,
  listSharedGroups,
  closePostgresPools,
  openDatabase,
  pruneMcpAuditLog,
  upsertSharedGroup,
  upsertPageProvenance,
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
  quickPageHealthCheck,
  readBrainPage,
  readRawFile,
  renameBrainPage,
  renameRawFile,
  updateRawFile,
  updateBrainPage,
  updateBrainPageImages,
  updatePageVisibility,
} from './page-ops.js';
import { canonicalPagePath, canonicalPageUrl, isLoopbackHost, localPageUrl } from './page-links.js';
import { queryPagesByFrontmatter } from './frontmatter-query.js';
import {
  buildKeepInTouchPayload,
  enrollKeepInTouchPerson,
  logKeepInTouchContact,
  setKeepInTouchPriority,
  setKeepInTouchEnabled,
  setKeepInTouchFrequency,
  snoozeKeepInTouchPerson,
} from './playbooks/keep-in-touch.js';
import {
  KEEP_IN_TOUCH_DEFAULT_REVIEW_LIMIT,
  KEEP_IN_TOUCH_MAX_REVIEW_LIMIT,
  buildKeepInTouchReviewPayload,
  recordKeepInTouchReview,
} from './playbooks/keep-in-touch-review.js';
import {
  buildComprehensionPayload,
  getComprehensionPage,
  saveComprehensionSession,
  updateComprehensionSetup,
} from './playbooks/comprehension.js';
import { queryBrain, searchBrain } from './search.js';
import { syncBrain } from './sync.js';
import {
  SOURCE_TYPE_DEFINITIONS,
  SOURCE_TYPE_VALUES,
  TIMELINE_SIGNIFICANCE_VALUES,
  parseMutationMetadata,
  timelineSignificanceSchema,
} from './source-taxonomy.js';
import {
  EventInboxStore,
  EventRegistryStore,
  EVENT_STATES,
  RssCollector,
  createWebhookEventEnvelope,
  normalizeListener,
  normalizeSubscription,
  normalizeEventEnvelope,
  defaultEventInboxPath,
  defaultEventRegistryPath,
} from './inbound-events.js';
import {
  authorizationServerMetadata,
  authRoutesEnabled,
  assertOAuthConfigured,
  authorizeMcpRequest,
  buildAuthConfig,
  completeOAuthCallback,
  createAgentOAuthStart,
  createDashboardOAuthStart,
  exchangeAgentOAuthCode,
  protectedResourceMetadata,
  registerOAuthClient,
  renderAuthErrorPage,
  renderConnectPage,
  renderOAuthCompletePage,
} from './mcp-auth.js';
import { createMcpAuthStore } from './mcp-auth-store.js';
import { findActiveMemberByEmail, listMembers, resolveActorMember, upsertMember } from './members.js';
import { getRole, isOwnerRole, listRoles, roleAllows, roleCanEditPath, upsertCustomRole } from './roles.js';
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
  assertToolPolicyComplete(config);
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
      if (request.method === 'GET' && route.pathname === '/auth/start' && authRoutesEnabled(authConfig)) {
        response.writeHead(302, { location: await createDashboardOAuthStart(authConfig, request.url || '/auth/start') });
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
          return sendHtml(response, 200, renderOAuthCompletePage());
        } catch (error) {
          return sendHtml(response, 403, renderAuthErrorPage(authConfig, error));
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
          await closePostgresPools();
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
        return jsonRpcResult(message.id, { tools: toolDefinitions(config).filter((tool) => canCallTool(tool.name, actor)) });
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
    await assertRoleAllowed({ config, name, args, actor, authConfig });
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
  const mutation = requireMutationMetadata(name, args);
  const significance = requirePageTimelineSignificance(name, args);
  if (mutation) {
    args.commit_message = mutation.commit_message;
    args.provenance = mutation.provenance;
  }
  if (significance) args.significance = significance;
  switch (name) {
    case 'me':
      return toolJson(await toolMe(config, actor, authConfig));
    case 'members/list':
    case 'members_list':
      return toolJson(await toolMembersList(config, args), { arrayKey: 'members' });
    case 'members/upsert':
    case 'members_upsert':
      return toolJson(await toolMembersUpsert(config, args, actor, authConfig));
    case 'roles/list':
    case 'roles_list':
      return toolJson(await toolRolesList(config), { arrayKey: 'roles' });
    case 'roles/upsert':
    case 'roles_upsert':
      return toolJson(await toolRolesUpsert(config, args), { arrayKey: 'roles' });
    case 'domains/list':
    case 'domains_list':
      return toolJson(await listBrainDomains(config), { arrayKey: 'domains' });
    case 'domains/get':
    case 'domains_get':
      return toolJson(await getBrainDomain(config, requireString(args.id, 'id')));
    case 'domains/create':
    case 'domains_create': {
      const domain = await createBrainDomain(config, {
        id: args.id,
        name: args.name,
        guidance: args.guidance,
      });
      await postWriteMaintenance(config, gitBackupEnabled, actor, args.commit_message);
      return toolJson({ domain, registry: await listBrainDomains(config) });
    }
    case 'domains/update':
    case 'domains_update': {
      const domain = await updateBrainDomain(config, {
        id: args.id,
        name: args.name,
        guidance: args.guidance,
      });
      await postWriteMaintenance(config, gitBackupEnabled, actor, args.commit_message);
      return toolJson({ domain, registry: await listBrainDomains(config) });
    }
    case 'domains/delete':
    case 'domains_delete': {
      const deleted = await deleteBrainDomain(config, { id: args.id });
      await postWriteMaintenance(config, gitBackupEnabled, actor, args.commit_message);
      return toolJson({ ...deleted, registry: await listBrainDomains(config) });
    }
    case 'schemas/list':
    case 'schemas_list':
      return toolJson(await listPageSchemas(config), { arrayKey: 'schemas' });
    case 'schemas/get':
    case 'schemas_get':
      return toolJson(await getPageSchema(config, requireString(args.id, 'id')));
    case 'schemas/bootstrap':
    case 'schemas_bootstrap': {
      const before = await loadPageSchemaRegistry(config);
      const loaded = await bootstrapPageSchemaRegistry(config);
      await postWriteMaintenance(config, gitBackupEnabled, actor, args.commit_message);
      return toolJson({ initialized: before.status === 'missing', ...loaded });
    }
    case 'schemas/register':
    case 'schemas_register': {
      const schema = await registerPageSchema(config, {
        id: args.id,
        definition: args.definition,
      });
      await postWriteMaintenance(config, gitBackupEnabled, actor, args.commit_message);
      return toolJson({ schema, schemas: await listPageSchemas(config) });
    }
    case 'schemas/update':
    case 'schemas_update': {
      const schema = await updatePageSchema(config, {
        id: args.id,
        definition: args.definition,
      });
      await postWriteMaintenance(config, gitBackupEnabled, actor, args.commit_message);
      return toolJson({ schema, schemas: await listPageSchemas(config) });
    }
    case 'schemas/delete':
    case 'schemas_delete': {
      const deleted = await deletePageSchema(config, { id: args.id });
      await postWriteMaintenance(config, gitBackupEnabled, actor, args.commit_message);
      return toolJson({ ...deleted, schemas: await listPageSchemas(config) });
    }
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
      await postWriteMaintenance(config, gitBackupEnabled, actor, args.commit_message);
      await recordWriteProvenance(config, args.path || task.path, args.provenance, args.commit_message);
      return toolJson(task);
    }
    case 'tasks/update': {
      const task = await toolTasksUpdate(config, args, actor, authConfig);
      await postWriteMaintenance(config, gitBackupEnabled, actor, args.commit_message);
      await recordWriteProvenance(config, args.path, args.provenance, args.commit_message);
      return toolJson(task);
    }
    case 'rss/workflow':
    case 'rss_workflow':
      return toolJson(await rssWorkflow(args));
    case 'rss/ledger':
    case 'rss_ledger':
      return toolJson(callRssLedger(config, args));
    case 'substack/workflow':
    case 'substack_workflow':
      return toolJson(await substackWorkflow(args));
    case 'substack/ledger':
    case 'substack_ledger':
      return toolJson(callSubstackLedger(config, args));
    case 'events/listeners':
      return toolJson(await eventRegistryValue(config).then(async (registry) => ({ revision: registry.revision, runtime: registry.runtime, listeners: await withRssIngestionStatus(registry.listeners.map(safeListener)) })), { arrayKey: 'listeners' });
    case 'events/listener_upsert': {
      const registryStore = eventRegistryStore(config);
      const listener = normalizeListener(args.listener || args);
      const next = await registryStore.update((registry) => {
        assertEventBrainIdsRegistered(registry, listener.brain_ids, config);
        const index = registry.listeners.findIndex((item) => item.id === listener.id);
        const listeners = [...registry.listeners];
        listeners[index < 0 ? listeners.length : index] = { ...(index < 0 ? {} : listeners[index]), ...listener, updated_at: new Date().toISOString(), created_at: index < 0 ? new Date().toISOString() : listeners[index].created_at };
        return { ...registry, listeners };
      }, { audit: { action: 'listener_upsert', listener_id: listener.id } });
      return toolJson({ revision: next.revision, listener: safeListener(next.listeners.find((item) => item.id === listener.id)) });
    }
    case 'events/listener_pause':
    case 'events/listener_resume': {
      const listenerId = requireString(args.listener_id, 'listener_id');
      const registryStore = eventRegistryStore(config);
      const next = await registryStore.update((registry) => {
        const listeners = registry.listeners.map((listener) => listener.id === listenerId ? { ...listener, paused: name.endsWith('pause'), enabled: name.endsWith('resume'), status: name.endsWith('pause') ? 'paused' : 'active', updated_at: new Date().toISOString() } : listener);
        if (!listeners.some((listener) => listener.id === listenerId)) throw new Error(`Listener not found: ${listenerId}`);
        return { ...registry, listeners };
      }, { audit: { action: name, listener_id: listenerId } });
      return toolJson({ revision: next.revision, listener: safeListener(next.listeners.find((item) => item.id === listenerId)) });
    }
    case 'events/listener_remove': {
      const listenerId = requireString(args.listener_id, 'listener_id');
      const registryStore = eventRegistryStore(config);
      const next = await registryStore.update((registry) => {
        const listeners = registry.listeners.map((listener) => listener.id === listenerId ? { ...listener, removed: true, enabled: false, paused: false, status: 'removed', updated_at: new Date().toISOString() } : listener);
        if (!listeners.some((listener) => listener.id === listenerId)) throw new Error(`Listener not found: ${listenerId}`);
        return { ...registry, listeners };
      }, { audit: { action: name, listener_id: listenerId } });
      return toolJson({ revision: next.revision, listener: safeListener(next.listeners.find((item) => item.id === listenerId)) });
    }
    case 'events/subscriptions':
      return toolJson(await eventRegistryValue(config).then((registry) => ({ revision: registry.revision, subscriptions: registry.subscriptions })));
    case 'events/subscription_upsert': {
      const registryStore = eventRegistryStore(config);
      const subscription = normalizeSubscription(args.subscription || args);
      const next = await registryStore.update((registry) => {
        if (!registry.listeners.some((listener) => listener.id === subscription.listener_id)) throw new Error(`Listener not found: ${subscription.listener_id}`);
        assertEventBrainIdsRegistered(registry, subscription.brain_ids, config);
        const index = registry.subscriptions.findIndex((item) => item.id === subscription.id);
        const subscriptions = [...registry.subscriptions];
        subscriptions[index < 0 ? subscriptions.length : index] = { ...(index < 0 ? {} : subscriptions[index]), ...subscription, updated_at: new Date().toISOString(), created_at: index < 0 ? new Date().toISOString() : subscriptions[index].created_at };
        return { ...registry, subscriptions };
      }, { audit: { action: 'subscription_upsert', subscription_id: subscription.id } });
      return toolJson({ revision: next.revision, subscription: next.subscriptions.find((item) => item.id === subscription.id) });
    }
    case 'events/inbox': {
      const events = await eventInboxStore(config).list({ state: args.state || null, listenerId: args.listener_id || null, limit: args.limit });
      return toolJson({ events: events.map(safeEventRecord) }, { arrayKey: 'events' });
    }
    case 'events/rss_status':
    case 'events/rss-status': {
      const collector = new RssCollector({ registryStore: eventRegistryStore(config), inboxStore: eventInboxStore(config) });
      return toolJson(await collector.statusAll({ listenerId: args.listener_id || null, limit: args.limit || 50 }));
    }
    case 'events/rss_backfill':
    case 'events/rss-backfill': {
      const collector = new RssCollector({ registryStore: eventRegistryStore(config), inboxStore: eventInboxStore(config) });
      return toolJson(await collector.backfill(requireString(args.listener_id, 'listener_id'), {
        itemIds: args.item_ids,
        dryRun: args.apply !== true,
        maxItems: args.max_items,
      }));
    }
    case 'events/retry': {
      const event = await eventInboxStore(config).retry(requireString(args.delivery_id, 'delivery_id'));
      return toolJson({ event: safeEventRecord(event) });
    }
    case 'events/discard': {
      const event = await eventInboxStore(config).discard(requireString(args.delivery_id, 'delivery_id'), args.reason || 'discarded');
      return toolJson({ event: safeEventRecord(event) });
    }
    case 'events/quarantine': {
      const event = await eventInboxStore(config).quarantine(requireString(args.delivery_id, 'delivery_id'), args.reason || 'quarantined');
      return toolJson({ event: safeEventRecord(event) });
    }
    case 'events/test': {
      const registry = await eventRegistryValue(config);
      const listenerId = requireString(args.listener_id, 'listener_id');
      const listener = registry.listeners.find((item) => item.id === listenerId);
      if (!listener) throw new Error(`Listener not found: ${listenerId}`);
      const event = normalizeEventEnvelope({ event_id: args.event_id || `test-${randomUUID()}`, listener_id: listenerId, type: args.type || 'webhook.event', payload: args.payload || { test: true }, source_info: listener }, { registry, listener });
      const result = await eventInboxStore(config).enqueue(event, { clientId: registry.runtime.id });
      return toolJson({ accepted: !result.duplicate, duplicate: result.duplicate, event: safeEventRecord(result.event) });
    }
    case 'events/health': {
      const registry = await eventRegistryValue(config);
      const inbox = await eventInboxStore(config).get();
      const counts = Object.values(inbox.deliveries).reduce((value, event) => { value[event.state] = (value[event.state] || 0) + 1; return value; }, {});
      return toolJson({ ok: true, registry_revision: registry.revision, runtime: registry.runtime, listener_count: registry.listeners.filter((listener) => !listener.removed).length, counts, collectors: inbox.collectors, registry_path: eventRegistryStore(config).filePath, inbox_path: eventInboxStore(config).filePath });
    }
    case 'events/provenance': {
      const db = await openDatabase(config);
      try {
        const value = await upsertPageProvenance(db, { ...args.provenance, path: args.path, commit_message: args.commit_message });
        return toolJson(value);
      } finally {
        await db.close?.();
      }
    }
    case 'events/provenance_list': {
      const db = await openDatabase(config);
      try {
        return toolJson({ provenance: await listPageProvenance(db, { pageSlugs: args.page_slugs, eventId: args.event_id, limit: args.limit }) }, { arrayKey: 'provenance' });
      } finally {
        await db.close?.();
      }
    }
    case 'search':
      return toolJson(await toolSearch(config, args));
    case 'query':
      return toolJson(await toolQuery(config, args));
    case 'pages/query':
    case 'pages_query':
      return toolJson(await toolPagesQuery(config, args));
    case 'playbooks/keep-in-touch/list_due':
    case 'playbooks_keep_in_touch_list_due':
      return toolJson(await toolKeepInTouchListDue(config, args, actor));
    case 'playbooks/keep-in-touch/review':
    case 'playbooks_keep_in_touch_review':
      return toolJson(await toolKeepInTouchReview(config, args, actor));
    case 'playbooks/keep-in-touch/record_review':
    case 'playbooks_keep_in_touch_record_review':
      return toolJson(await toolKeepInTouchRecordReview(config, args, actor));
    case 'playbooks/keep-in-touch/enroll':
    case 'playbooks_keep_in_touch_enroll':
      return toolJson(await toolKeepInTouchMutation(config, args, actor, 'enroll'));
    case 'playbooks/keep-in-touch/log_contact':
    case 'playbooks_keep_in_touch_log_contact':
      return toolJson(await toolKeepInTouchMutation(config, args, actor, 'log-contact'));
    case 'playbooks/keep-in-touch/set_priority':
    case 'playbooks_keep_in_touch_set_priority':
      return toolJson(await toolKeepInTouchMutation(config, args, actor, 'set-priority'));
    case 'playbooks/keep-in-touch/set_frequency':
    case 'playbooks_keep_in_touch_set_frequency':
      return toolJson(await toolKeepInTouchMutation(config, args, actor, 'set-frequency'));
    case 'playbooks/keep-in-touch/set_enabled':
    case 'playbooks_keep_in_touch_set_enabled':
      return toolJson(await toolKeepInTouchMutation(config, args, actor, 'set-enabled'));
    case 'playbooks/keep-in-touch/snooze':
    case 'playbooks_keep_in_touch_snooze':
      return toolJson(await toolKeepInTouchMutation(config, args, actor, 'snooze'));
    case 'playbooks/comprehension':
    case 'playbooks_comprehension':
      return toolJson(await toolComprehensionGet(config, args, actor, authConfig));
    case 'playbooks/comprehension/setup':
    case 'playbooks_comprehension_setup':
      return toolJson(await toolComprehensionSetup(config, args, actor, authConfig));
    case 'playbooks/comprehension/session':
    case 'playbooks_comprehension_session':
      return toolJson(await toolComprehensionSession(config, args, actor, authConfig));
    case 'list':
      return toolJson(await listBrainPath({
        config,
        relativePath: args.path || '',
        recursive: args.recursive !== false,
        limit: args.limit,
        orderBy: args.order_by,
        updatedSince: args.updated_since,
        updatedUntil: args.updated_until,
        createdSince: args.created_since,
        createdUntil: args.created_until,
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
      const availableOperations = toolDefinitions(config)
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
      });
      return toolJson(authenticatedBrainAbout(config, written, {
        authState: actor ? 'authenticated' : 'local_trusted',
        writable: true,
        availableOperations: toolDefinitions(config).map((tool) => tool.name).filter((toolName) => canCallTool(toolName, actor)),
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
      await postWriteMaintenance(config, gitBackupEnabled, actor, args.commit_message);
      return toolJson(rawFile);
    }
    case 'create_page': {
      const page = await createBrainPage({
        config,
        pagePath: args.path,
        title: args.title,
        compiledTruth: args.compiled_truth ?? args.body,
        timelineEntry: timelineForMutation(args, actor),
        timelineSignificance: args.significance,
        frontmatter: args.frontmatter || {},
        domains: args.domains,
        images: args.images,
      });
      await postWriteMaintenance(config, gitBackupEnabled, actor, args.commit_message);
      await recordWriteProvenance(config, args.path, { ...args.provenance, significance: args.significance }, args.commit_message);
      return toolJson({ ...page, page_health: await quickPageHealthCheck({ config, pagePath: page.path }) });
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
        timelineEntry: timelineForMutation(args, actor),
        domains: args.domains,
        frontmatter: args.frontmatter || {},
      });
      await postWriteMaintenance(config, gitBackupEnabled, actor, args.commit_message);
      await recordWriteProvenance(config, args.page_path || args.raw_path, args.provenance, args.commit_message);
      return toolJson({ ...result, page_health: await quickPageHealthCheck({ config, pagePath: result.page.path }) });
    }
    case 'capture_article': {
      const capture = await fetchArticleCapture(args.article_url);
      const slug = articleSlug(args.title);
      const rawPath = `articles/.raw/${slug}.html`;
      const pagePath = `articles/${slug}.md`;
      const rawFile = await createRawFile({ config, rawPath, rawContentText: capture.html, mimeType: 'text/html' });
      try {
        const body = [
          '## Summary', args.summary.trim(),
          '## Current Relevance', args.current_relevance.trim(),
          '## Source',
          `- [Original publisher page](${args.article_url})`,
          `- [Archived publisher HTML](.raw/${slug}.html)`,
          `- Capture: ${capture.word_count.toLocaleString()} words of publisher text; archival and transcript hashes recorded in frontmatter.`,
          '## Faithful Publisher Text', capture.transcript,
        ].join('\n\n');
        const page = await createBrainPage({
          config,
          pagePath,
          title: args.title,
          compiledTruth: body,
          timelineEntry: timelineForMutation(args, actor),
          frontmatter: {
            source_kind: args.source_kind || 'online-article',
            published_date: args.published_date,
            article_url: args.article_url,
            raw_file: rawPath,
            capture_status: 'full',
            publisher_text_words: capture.word_count,
            archival_sha256: capture.html_sha256,
            transcript_sha256: capture.transcript_sha256,
            ...(args.domains ? { domains: args.domains } : {}),
          },
          domains: args.domains,
        });
        await postWriteMaintenance(config, gitBackupEnabled, actor, args.commit_message);
        await recordWriteProvenance(config, page.path, args.provenance, args.commit_message);
        return toolJson({ page, raw_file: rawFile, capture: { status: 'full', word_count: capture.word_count }, page_health: await quickPageHealthCheck({ config, pagePath: page.path }) });
      } catch (error) {
        await deleteRawFile({ config, rawPath }).catch(() => {});
        throw error;
      }
    }
    case 'refresh_article_capture': {
      const capture = await fetchArticleCapture(args.article_url);
      const slug = articleSlug(args.title);
      const pagePath = `articles/${slug}.md`;
      const page = await updateBrainPage({
        config,
        pagePath,
        compiledTruth: capture.transcript,
        timelineEntry: timelineForMutation(args, actor),
        frontmatterValues: {
          capture_status: 'full',
          publisher_text_words: capture.word_count,
          transcript_sha256: capture.transcript_sha256,
        },
      });
      await postWriteMaintenance(config, gitBackupEnabled, actor, args.commit_message);
      await recordWriteProvenance(config, page.path, args.provenance, args.commit_message);
      return toolJson({ page, capture: { status: 'full', word_count: capture.word_count }, page_health: await quickPageHealthCheck({ config, pagePath }) });
    }
    case 'update_raw_file': {
      const rawFile = await updateRawFile({
        config,
        rawPath: args.path,
        rawContentBase64: args.raw_content_base64,
        rawContentText: args.raw_content_text,
        mimeType: args.mime_type,
      });
      await postWriteMaintenance(config, gitBackupEnabled, actor, args.commit_message);
      return toolJson(rawFile);
    }
    case 'rename_raw_file': {
      const rawFile = await renameRawFile({
        config,
        fromRawPath: args.from_path,
        toRawPath: args.to_path,
      });
      await postWriteMaintenance(config, gitBackupEnabled, actor, args.commit_message);
      return toolJson(rawFile);
    }
    case 'delete_raw_file': {
      const result = await deleteRawFile({ config, rawPath: args.path });
      await postWriteMaintenance(config, gitBackupEnabled, actor, args.commit_message);
      return toolJson(result);
    }
    case 'rename_page': {
      const page = await renameBrainPage({
        config,
        fromPagePath: args.from_path,
        toPagePath: args.to_path,
        title: args.title,
        timelineEntry: timelineForMutation(args, actor),
      });
      await postWriteMaintenance(config, gitBackupEnabled, actor, args.commit_message);
      return toolJson(page);
    }
    case 'update_page': {
      const page = await updateBrainPage({
        config,
        pagePath: args.path,
        compiledTruth: args.compiled_truth ?? args.body,
        timelineEntry: timelineForMutation(args, actor),
        timelineSignificance: args.significance,
        frontmatterValues: updatePageFrontmatterValues(args),
      });
      await postWriteMaintenance(config, gitBackupEnabled, actor, args.commit_message);
      await recordWriteProvenance(config, args.path, { ...args.provenance, significance: args.significance }, args.commit_message);
      return toolJson({ ...page, page_health: await quickPageHealthCheck({ config, pagePath: page.path }) });
    }
    case 'attach_page_images': {
      const page = await updateBrainPageImages({
        config,
        pagePath: args.path,
        images: args.images,
        mode: args.mode,
        timelineEntry: timelineForMutation(args, actor),
        timelineSignificance: args.significance,
      });
      await postWriteMaintenance(config, gitBackupEnabled, actor, args.commit_message);
      await recordWriteProvenance(config, args.path, { ...args.provenance, significance: args.significance }, args.commit_message);
      return toolJson({ ...page, page_health: await quickPageHealthCheck({ config, pagePath: page.path }) });
    }
    case 'set_page_visibility': {
      const visibility = normalizePageVisibility(args.visibility);
      const page = await updatePageVisibility({
        config,
        pagePath: args.path,
        visibility,
        publicRawFiles: args.public_raw_files,
        timelineEntry: timelineForMutation(args, actor, `Visibility set to ${visibility}.`),
      });
      await postWriteMaintenance(config, gitBackupEnabled, actor, args.commit_message);
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
      return toolJson(await backupGitChanges(config, args.commit_message));
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

function updatePageFrontmatterValues(args) {
  const frontmatter = args.frontmatter ?? {};
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new Error('update_page frontmatter must be an object.');
  }
  const reserved = ['domains', 'visibility', 'public_raw_files', 'images'];
  const reservedKey = reserved.find((key) => Object.prototype.hasOwnProperty.call(frontmatter, key));
  if (reservedKey) {
    throw new Error(`Use the dedicated ${reservedKey === 'domains' ? 'domains field' : `${reservedKey} tool or field`} rather than update_page frontmatter.${reservedKey}.`);
  }
  return {
    ...frontmatter,
    ...(args.domains === undefined ? {} : { domains: args.domains }),
  };
}

const GRAPH_PAGE_READ_TOOLS = new Set(['read', 'get_page_visibility']);

function isAuditedTool(name) {
  const layer = toolPolicy(name)?.layer;
  return GRAPH_PAGE_READ_TOOLS.has(name)
    || ['create', 'publish', 'raw_destructive', 'git_backup', 'maintenance', 'admin', 'domains_manage', 'schemas_manage', 'events_manage'].includes(layer);
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
  let pageUrlPath;
  try {
    pageUrlPath = canonicalPagePath(brainId, page.slug);
  } catch {
    return {
      brain_id: brainId,
      page_url: null,
      page_url_path: null,
      local_url: null,
    };
  }
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

async function postWriteMaintenance(config, gitBackupEnabled, actor, commitMessage) {
  await syncAndPersist(config);
  if (gitBackupEnabled && canRunGitBackup(actor)) {
    await backupGitChanges(config, commitMessage);
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
      timelineEntries: timelineForMutation(args, actor, 'Task created through MCP.'),
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
      timelineEntry: timelineForMutation(args, actor, 'Task updated through MCP.'),
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

async function toolPagesQuery(config, args) {
  const db = await openDatabase(config);
  try {
    return await queryPagesByFrontmatter({
      db,
      pathPrefix: args.path_prefix,
      type: args.type,
      filters: args.filters ?? args.where ?? [],
      fields: args.fields ?? args.select ?? [],
      orderBy: args.order_by ?? [],
      limit: args.limit,
      cursor: args.cursor,
      countOnly: args.count_only,
      includeTotal: args.include_total,
      asOf: args.as_of,
    });
  } finally {
    await db.close?.();
  }
}

async function toolKeepInTouchListDue(config, args, actor) {
  const db = await openDatabase(config);
  try {
    const payload = await buildKeepInTouchPayload(config, db, {
      actor,
      now: args.as_of ? new Date(args.as_of) : new Date(),
    });
    const records = payload.records.filter((record) => record.is_due).slice(0, normalizeLimit(args.limit, 50));
    return {
      playbook: payload.playbook,
      brain: payload.brain,
      summary: { ...payload.summary, returned: records.length },
      records,
    };
  } finally {
    await db.close?.();
  }
}

async function toolKeepInTouchReview(config, args, actor) {
  const db = await openDatabase(config);
  try {
    return await buildKeepInTouchReviewPayload(config, db, {
      actor,
      asOf: args.as_of ? new Date(args.as_of) : new Date(),
      limit: args.limit,
    });
  } finally {
    await db.close?.();
  }
}

async function toolKeepInTouchRecordReview(config, args, actor) {
  const db = await openDatabase(config);
  try {
    const result = await recordKeepInTouchReview(config, db, args, { actor });
    await postWriteMaintenance(config, false, actor, args.commit_message);
    return result;
  } finally {
    await db.close?.();
  }
}

async function toolKeepInTouchMutation(config, args, actor, action) {
  const db = await openDatabase(config);
  try {
    let result;
    if (action === 'enroll') result = await enrollKeepInTouchPerson(config, db, args, { actor });
    if (action === 'log-contact') result = await logKeepInTouchContact(config, db, args, { actor });
    if (action === 'set-priority') result = await setKeepInTouchPriority(config, db, args, { actor });
    if (action === 'set-frequency') result = await setKeepInTouchFrequency(config, db, args, { actor });
    if (action === 'set-enabled') result = await setKeepInTouchEnabled(config, db, args, { actor });
    if (action === 'snooze') result = await snoozeKeepInTouchPerson(config, db, args, { actor });
    await postWriteMaintenance(config, false, actor, args.commit_message);
    return result;
  } finally {
    await db.close?.();
  }
}

async function toolComprehensionGet(config, args, actor, authConfig) {
  const db = await openDatabase(config);
  try {
    const payload = await buildComprehensionPayload(config, db, {
      actor,
      limit: args.limit,
      historyLimit: args.history_limit,
    });
    if (!args.page_slug) return payload;
    return {
      ...payload,
      page: await getComprehensionPage(db, args.page_slug, {
        actor,
        limit: args.history_limit,
      }),
    };
  } finally {
    await db.close?.();
  }
}

async function toolComprehensionSetup(config, args, actor, authConfig) {
  const db = await openDatabase(config);
  try {
    const guidance = await updateComprehensionSetup(db, args, { actor });
    return {
      playbook: { id: 'comprehension', name: 'Comprehension', schema_version: 1 },
      guidance: guidance.guidance,
    };
  } finally {
    await db.close?.();
  }
}

async function toolComprehensionSession(config, args, actor, authConfig) {
  const db = await openDatabase(config);
  try {
    return await saveComprehensionSession(db, args, { actor });
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
  const runtimePathPrefix = relativeBrainDir === '.' ? '' : `${relativeBrainDir}/`;
  await git(repoRoot, ['pull', '--rebase', '--autostash']);
  await git(repoRoot, [
    'add',
    '--',
    relativeBrainDir,
    `:(exclude)${runtimePathPrefix}.bigbrain-state`,
    `:(exclude)${runtimePathPrefix}.bigbrain-state/**`,
  ]);
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

function toolDefinitions(config = null) {
  const domainRegistry = config ? loadDomainRegistrySync(config) : null;
  const domainField = domainMembershipFieldSchema(domainRegistry);
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
      name: 'members/upsert',
      description: 'Create or update a BigBrain member and assign one role. Owners can manage every role; admins can manage non-owner members.',
      inputSchema: memberUpsertSchema(),
    },
    {
      name: 'members_upsert',
      description: 'Alias for members/upsert for clients that do not support slash tool names.',
      inputSchema: memberUpsertSchema(),
    },
    {
      name: 'roles/list',
      description: 'List default and custom BigBrain roles, including page edit path scopes.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'roles_list',
      description: 'Alias for roles/list for clients that do not support slash tool names.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'roles/upsert',
      description: 'Create or update one custom BigBrain role. Custom roles can scope page edit permissions by path prefix.',
      inputSchema: roleUpsertSchema(),
    },
    {
      name: 'roles_upsert',
      description: 'Alias for roles/upsert for clients that do not support slash tool names.',
      inputSchema: roleUpsertSchema(),
    },
    {
      name: 'domains/list',
      description: 'List the explicitly curated knowledge domains registered for this Brain. This is read-only; domain creation is a separate user-directed operation.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'domains_list',
      description: 'Alias for domains/list for clients that do not support slash tool names.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'domains/get',
      description: 'Read one explicitly registered Brain domain and its classification guidance.',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Stable registered domain ID, such as ai-infrastructure.' } }, required: ['id'] },
    },
    {
      name: 'domains_get',
      description: 'Alias for domains/get for clients that do not support slash tool names.',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Stable registered domain ID, such as ai-infrastructure.' } }, required: ['id'] },
    },
    {
      name: 'domains/create',
      description: 'Create one durable Brain knowledge domain. Call only when the user explicitly asks to curate the domain registry; never call this during routine page creation, ingestion, or enrichment.',
      inputSchema: domainWriteSchema({ requireId: true }),
    },
    {
      name: 'domains_create',
      description: 'Alias for domains/create for clients that do not support slash tool names.',
      inputSchema: domainWriteSchema({ requireId: true }),
    },
    {
      name: 'domains/update',
      description: 'Update one existing Brain knowledge domain without changing its stable ID. Call only when the user explicitly asks to curate the domain registry.',
      inputSchema: domainWriteSchema({ requireId: true, update: true }),
    },
    {
      name: 'domains_update',
      description: 'Alias for domains/update for clients that do not support slash tool names.',
      inputSchema: domainWriteSchema({ requireId: true, update: true }),
    },
    {
      name: 'domains/delete',
      description: 'Delete one registered Brain knowledge domain. Call only when the user explicitly asks to curate the domain registry; deletion is refused while pages still use the domain.',
      inputSchema: domainDeleteSchema(),
    },
    {
      name: 'domains_delete',
      description: 'Alias for domains/delete for clients that do not support slash tool names.',
      inputSchema: domainDeleteSchema(),
    },
    {
      name: 'schemas/list',
      description: 'List the page schemas registered for this Brain. Schemas are Brain-local and may differ between Brains.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'schemas_list',
      description: 'Alias for schemas/list for clients that do not support slash tool names.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'schemas/get',
      description: 'Read one registered page schema by its stable ID.',
      inputSchema: pageSchemaGetSchema(),
    },
    {
      name: 'schemas_get',
      description: 'Alias for schemas/get for clients that do not support slash tool names.',
      inputSchema: pageSchemaGetSchema(),
    },
    {
      name: 'schemas/bootstrap',
      description: 'Initialize the missing page schema registry for this Brain with editable defaults. It never overwrites an existing registry.',
      inputSchema: pageSchemaBootstrapSchema(),
    },
    {
      name: 'schemas_bootstrap',
      description: 'Alias for schemas/bootstrap for clients that do not support slash tool names.',
      inputSchema: pageSchemaBootstrapSchema(),
    },
    {
      name: 'schemas/register',
      description: 'Register one new page schema for this Brain. Use only when the user explicitly asks to curate page schemas.',
      inputSchema: pageSchemaWriteSchema(),
    },
    {
      name: 'schemas_register',
      description: 'Alias for schemas/register for clients that do not support slash tool names.',
      inputSchema: pageSchemaWriteSchema(),
    },
    {
      name: 'schemas/update',
      description: 'Replace one existing page schema definition without changing its stable ID. Use only when the user explicitly asks to curate page schemas.',
      inputSchema: pageSchemaWriteSchema(),
    },
    {
      name: 'schemas_update',
      description: 'Alias for schemas/update for clients that do not support slash tool names.',
      inputSchema: pageSchemaWriteSchema(),
    },
    {
      name: 'schemas/delete',
      description: 'Delete one registered page schema. Deletion is refused while pages explicitly declare that schema.',
      inputSchema: pageSchemaDeleteSchema(),
    },
    {
      name: 'schemas_delete',
      description: 'Alias for schemas/delete for clients that do not support slash tool names.',
      inputSchema: pageSchemaDeleteSchema(),
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
      name: 'rss/workflow',
      description: 'Get trusted RSS article ingestion instructions directly, without filesystem or desktop access.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    },
    {
      name: 'rss_workflow',
      description: 'Alias for rss/workflow for clients that do not support slash tool names.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    },
    {
      name: 'rss/ledger',
      description: 'Read or update shared per-feed RSS ingestion state. Claim articles atomically across RSS, email and reconciliation, then complete with owning-Brain read-back. Low/high watermarks represent verified articles, not complete coverage. Get guidance from rss/workflow.',
      inputSchema: rssLedgerInputSchema(),
    },
    {
      name: 'rss_ledger',
      description: 'Alias for rss/ledger for clients that do not support slash tool names.',
      inputSchema: rssLedgerInputSchema(),
    },
    {
      name: 'substack/workflow',
      description: 'Read the complete trusted Substack ingestion workflow and required references directly. No shell, local file reader, or desktop app is needed. Call before Substack ingestion.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'substack_workflow',
      description: 'Alias for substack/workflow for clients that do not support slash tool names.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'substack/ledger',
      description: 'Read or update the shared Substack ingestion register directly, without opening files or desktop apps. Atomically claim before ingestion; complete only after owning-Brain read-back. Uses server-owned storage and rejects verification for another Brain. Get operation guidance from substack/workflow.',
      inputSchema: substackLedgerInputSchema(),
    },
    {
      name: 'substack_ledger',
      description: 'Alias for substack/ledger for clients that do not support slash tool names.',
      inputSchema: substackLedgerInputSchema(),
    },
    {
      name: 'events/listeners',
      description: 'List configured RSS and webhook listeners for this connector runtime. Credentials and raw payloads are never returned.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'events/listener_upsert',
      description: 'Create or update a generic inbound RSS or webhook listener in the canonical runtime registry. Use credential_ref, never a raw secret.',
      inputSchema: listenerWriteSchema(),
    },
    {
      name: 'events/listener_pause',
      description: 'Pause one listener. Historical inbox records and Brain content are retained.',
      inputSchema: { type: 'object', properties: { listener_id: { type: 'string' } }, required: ['listener_id'] },
    },
    {
      name: 'events/listener_resume',
      description: 'Resume one paused listener.',
      inputSchema: { type: 'object', properties: { listener_id: { type: 'string' } }, required: ['listener_id'] },
    },
    {
      name: 'events/listener_remove',
      description: 'Remove one listener from future collection without deleting historical event metadata or Brain content.',
      inputSchema: { type: 'object', properties: { listener_id: { type: 'string' } }, required: ['listener_id'] },
    },
    {
      name: 'events/subscriptions',
      description: 'List Brain subscriptions for inbound listeners.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'events/subscription_upsert',
      description: 'Create or update a listener subscription using registered Brain IDs only.',
      inputSchema: subscriptionWriteSchema(),
    },
    {
      name: 'events/inbox',
      description: 'Inspect bounded inbound event metadata, outcomes, failures, and retries without returning payloads or credentials.',
      inputSchema: { type: 'object', properties: { state: { type: 'string', enum: EVENT_STATE_SCHEMA_VALUES() }, listener_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 1000 } } },
    },
    {
      name: 'events/rss_status',
      description: 'Fetch active RSS feeds and report cursor, seen-state, incremental outstanding items, and explicit manual-backfill candidates. This operation never writes the inbox or creates Codex tasks.',
      inputSchema: { type: 'object', properties: { listener_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 1000 } } },
    },
    {
      name: 'events/rss_backfill',
      description: 'Default-dry-run manual RSS backfill for explicitly selected stable item IDs. Set apply=true to enqueue at most the bounded selection; normal RSS cursor polling is unchanged.',
      inputSchema: { type: 'object', properties: { listener_id: { type: 'string' }, item_ids: { type: 'array', minItems: 1, maxItems: 25, items: { type: 'string' } }, apply: { type: 'boolean' }, max_items: { type: 'integer', minimum: 1, maximum: 25 } }, required: ['listener_id', 'item_ids'] },
    },
    {
      name: 'events/retry',
      description: 'Return a failed or quarantined inbound event to the durable inbox for processing.',
      inputSchema: { type: 'object', properties: { delivery_id: { type: 'string' } }, required: ['delivery_id'] },
    },
    {
      name: 'events/discard',
      description: 'Intentionally ignore an inbound event and purge its payload unless the listener retains raw payloads.',
      inputSchema: { type: 'object', properties: { delivery_id: { type: 'string' }, reason: { type: 'string' } }, required: ['delivery_id'] },
    },
    {
      name: 'events/quarantine',
      description: 'Quarantine an inbound event for human review without deleting its retryable payload.',
      inputSchema: { type: 'object', properties: { delivery_id: { type: 'string' }, reason: { type: 'string' } }, required: ['delivery_id'] },
    },
    {
      name: 'events/test',
      description: 'Enqueue a synthetic event to verify a configured listener and its destination boundaries.',
      inputSchema: { type: 'object', properties: { listener_id: { type: 'string' }, event_id: { type: 'string' }, type: { type: 'string' }, payload: { type: 'object' } }, required: ['listener_id'] },
    },
    {
      name: 'events/health',
      description: 'Report connector runtime, registry, listener, inbox, and failure health.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'events/provenance',
      description: 'Record one validated inbound provenance relation for a meaningful Brain page write. Runtime use only.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, ...mutationProperties() }, required: ['path', ...mutationRequired()] },
    },
    {
      name: 'events/provenance_list',
      description: 'List structured provenance relations for graph and operational inspection.',
      inputSchema: { type: 'object', properties: { page_slugs: { type: 'array', items: { type: 'string' } }, event_id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 1000 } } },
    },
    {
      name: 'search',
      description: 'Retrieve ranked BigBrain pages using lexical and semantic search. Returns complete page embedding payloads without operational frontmatter in budgeted retrieval_context, plus included and omitted page slugs. Answer from this evidence in the calling harness; read omitted pages when needed. Default balanced mode uses no answer-generation, expansion, or reranking model.',
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
      name: 'pages/query',
      description: 'Query indexed pages with safe structured filters over page fields and flat front matter. Returns compact page metadata, selected front matter, a total count, and an offset cursor. Use count_only for count queries and as_of for deterministic timestamp comparisons.',
      inputSchema: pagesQuerySchema(),
    },
    {
      name: 'pages_query',
      description: 'Alias for pages/query for clients that do not support slash tool names.',
      inputSchema: pagesQuerySchema(),
    },
    {
      name: 'playbooks/keep-in-touch/list_due',
      description: 'List people enrolled in the Keep in Touch playbook whose next touchpoint is due. This reads playbook overlay state without changing person pages.',
      inputSchema: keepInTouchListDueSchema(),
    },
    {
      name: 'playbooks_keep_in_touch_list_due',
      description: 'Alias for playbooks/keep-in-touch/list_due for clients that do not support slash tool names.',
      inputSchema: keepInTouchListDueSchema(),
    },
    {
      name: 'playbooks/keep-in-touch/review',
      description: 'Start a deterministic Keep in Touch review of people pages updated since the playbook cursor. This reads only page metadata and private playbook state; the caller reads each returned people page before recording decisions.',
      inputSchema: keepInTouchReviewSchema(),
    },
    {
      name: 'playbooks_keep_in_touch_review',
      description: 'Alias for playbooks/keep-in-touch/review for clients that do not support slash tool names.',
      inputSchema: keepInTouchReviewSchema(),
    },
    {
      name: 'playbooks/keep-in-touch/record_review',
      description: 'Commit one complete Keep in Touch review. It stores every per-person outcome and rationale in the playbook overlay, applies additions or frequency changes, and advances the private cursor only after every candidate has a decision.',
      inputSchema: keepInTouchRecordReviewSchema(),
    },
    {
      name: 'playbooks_keep_in_touch_record_review',
      description: 'Alias for playbooks/keep-in-touch/record_review for clients that do not support slash tool names.',
      inputSchema: keepInTouchRecordReviewSchema(),
    },
    {
      name: 'playbooks/keep-in-touch/enroll',
      description: 'Enroll one people page in the Keep in Touch playbook. State is stored in a playbook overlay, not person frontmatter.',
      inputSchema: keepInTouchEnrollSchema(),
    },
    {
      name: 'playbooks_keep_in_touch_enroll',
      description: 'Alias for playbooks/keep-in-touch/enroll for clients that do not support slash tool names.',
      inputSchema: keepInTouchEnrollSchema(),
    },
    {
      name: 'playbooks/keep-in-touch/log_contact',
      description: 'Record a confirmed Keep in Touch contact, update the next due timestamp, and append a timeline entry to the person page.',
      inputSchema: keepInTouchLogContactSchema(),
    },
    {
      name: 'playbooks_keep_in_touch_log_contact',
      description: 'Alias for playbooks/keep-in-touch/log_contact for clients that do not support slash tool names.',
      inputSchema: keepInTouchLogContactSchema(),
    },
    {
      name: 'playbooks/keep-in-touch/set_priority',
      description: 'Set the Keep in Touch priority for one enrolled people page. Priority belongs to the playbook overlay.',
      inputSchema: keepInTouchSetPrioritySchema(),
    },
    {
      name: 'playbooks_keep_in_touch_set_priority',
      description: 'Alias for playbooks/keep-in-touch/set_priority for clients that do not support slash tool names.',
      inputSchema: keepInTouchSetPrioritySchema(),
    },
    {
      name: 'playbooks/keep-in-touch/set_frequency',
      description: 'Set the Keep in Touch frequency for one enrolled person using the playbook overlay. The daily review uses only 3, 7, 14, 30, or 60 days.',
      inputSchema: keepInTouchSetFrequencySchema(),
    },
    {
      name: 'playbooks_keep_in_touch_set_frequency',
      description: 'Alias for playbooks/keep-in-touch/set_frequency for clients that do not support slash tool names.',
      inputSchema: keepInTouchSetFrequencySchema(),
    },
    {
      name: 'playbooks/keep-in-touch/set_enabled',
      description: 'Enable or disable Keep in Touch for the current user and Brain. Disabling makes the daily review a no-op and preserves its cursor and registry.',
      inputSchema: keepInTouchSetEnabledSchema(),
    },
    {
      name: 'playbooks_keep_in_touch_set_enabled',
      description: 'Alias for playbooks/keep-in-touch/set_enabled for clients that do not support slash tool names.',
      inputSchema: keepInTouchSetEnabledSchema(),
    },
    {
      name: 'playbooks/keep-in-touch/snooze',
      description: 'Move one enrolled Keep in Touch person forward by a number of days without recording contact.',
      inputSchema: keepInTouchSnoozeSchema(),
    },
    {
      name: 'playbooks_keep_in_touch_snooze',
      description: 'Alias for playbooks/keep-in-touch/snooze for clients that do not support slash tool names.',
      inputSchema: keepInTouchSnoozeSchema(),
    },
    {
      name: 'playbooks/comprehension',
      description: 'Read the authenticated user\'s Comprehension guidance, recent page summaries, and prior session history. State lives in a user-scoped playbook overlay, not Brain pages or task pages.',
      inputSchema: comprehensionReadSchema(),
    },
    {
      name: 'playbooks_comprehension',
      description: 'Alias for playbooks/comprehension for clients that do not support slash tool names.',
      inputSchema: comprehensionReadSchema(),
    },
    {
      name: 'playbooks/comprehension/setup',
      description: 'Update the authenticated user\'s natural-language Comprehension guidance. This changes only the playbook overlay.',
      inputSchema: comprehensionSetupSchema(),
    },
    {
      name: 'playbooks_comprehension_setup',
      description: 'Alias for playbooks/comprehension/setup for clients that do not support slash tool names.',
      inputSchema: comprehensionSetupSchema(),
    },
    {
      name: 'playbooks/comprehension/session',
      description: 'Create or update one Comprehension session summary for a Brain page. The summary is the complete durable learning state and may be updated repeatedly while learning continues.',
      inputSchema: comprehensionSessionSchema(),
    },
    {
      name: 'playbooks_comprehension_session',
      description: 'Alias for playbooks/comprehension/session for clients that do not support slash tool names.',
      inputSchema: comprehensionSessionSchema(),
    },
    {
      name: 'list',
      description: 'List files and folders under the selected brain root, optionally constrained by path prefix and file timestamps. Timestamp filters are inclusive.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          recursive: { type: 'boolean' },
          limit: { type: 'number' },
          order_by: { type: 'string', enum: ['updated_at', 'created_at', 'alphanumeric'] },
          updated_since: { type: 'string', format: 'date-time', description: 'Include entries updated at or after this timestamp.' },
          updated_until: { type: 'string', format: 'date-time', description: 'Include entries updated at or before this timestamp.' },
          created_since: { type: 'string', format: 'date-time', description: 'Include entries created at or after this timestamp.' },
          created_until: { type: 'string', format: 'date-time', description: 'Include entries created at or before this timestamp.' },
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
      description: 'Return the authenticated routing description and bounded capabilities for this BigBrain instance. Missing or invalid descriptions require approval.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'about/update',
      description: 'Replace the brain routing description. Keep it concise and self-contained: define what belongs here and the appropriate sharing or confidentiality boundary, expand organization names before acronyms on first use, do not name a specific user or owner, do not refer to other brains, and do not assume which other brains users can access. Requires owner authority.',
      inputSchema: {
        type: 'object',
        properties: {
          profile: BRAIN_PROFILE_JSON_SCHEMA,
        },
        required: ['profile'],
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
          ...mutationProperties(),
          path: { type: 'string', description: 'Destination such as deals/.raw/blind-teaser.pdf, meetings/.raw/call-transcript.txt, or writing/.raw/unassigned-evidence.pdf.' },
          raw_content_base64: { type: 'string', description: 'Base64 encoded raw bytes. Use this for PDFs, images, and other binary files.' },
          raw_content_text: { type: 'string', description: 'Plain text raw content. Use exactly one of raw_content_base64 or raw_content_text.' },
          mime_type: { type: 'string' },
        },
        required: ['path', ...mutationRequired()],
      },
    },
    {
      name: 'create_page',
      description: 'Create a markdown brain page. compiled_truth is the current content rendered above the writer-managed separator; the writer adds the single timeline boundary and timeline entry classified by significance, then returns a quick read-back page health check.',
      inputSchema: {
        type: 'object',
        properties: {
          ...mutationProperties(),
          path: { type: 'string' },
          title: { type: 'string' },
          compiled_truth: { type: 'string', description: 'Current page content rendered above the separator, including the opening compiled-truth paragraph and any current-context sections. Do not include the separator or ## Timeline; the writer owns them.' },
          body: { type: 'string', description: 'Legacy alias for compiled_truth. Use compiled_truth for new calls.' },
          ...timelineInputProperties(),
          significance: { type: 'string', enum: TIMELINE_SIGNIFICANCE_VALUES, description: 'Impact of this timeline update on the owning page: patch, minor, or major.' },
          domains: domainField,
          images: pageImagesField(),
          frontmatter: { type: 'object' },
        },
        required: ['path', 'title', 'significance', ...mutationRequired()],
        allOf: [
          { anyOf: pageContentInputRequirements() },
          { anyOf: timelineInputRequirements() },
        ],
      },
    },
    {
      name: 'create_raw_file_with_page',
      description: 'Upload a raw file under <collection>/.raw/<filename> and create the corresponding markdown brain page in one call. Do not nest folders inside .raw. Raw uploads are size-limited to protect git-backed sync.',
      inputSchema: {
        type: 'object',
        properties: {
          ...mutationProperties(),
          raw_path: { type: 'string', description: 'Destination such as deals/.raw/blind-teaser.pdf, meetings/.raw/call-transcript.txt, deliverables/.raw/brief.pdf, or writing/.raw/unassigned-evidence.pdf.' },
          raw_content_base64: { type: 'string', description: 'Base64 encoded raw bytes. Use this for PDFs, images, and other binary files.' },
          raw_content_text: { type: 'string', description: 'Plain text raw content. Use exactly one of raw_content_base64 or raw_content_text.' },
          mime_type: { type: 'string' },
          page_path: { type: 'string', description: 'Optional deterministic attachment sidecar path. When supplied it must equal <collection>/.raw/<raw-basename>.md; otherwise it is derived from raw_path.' },
          title: { type: 'string' },
          body: { type: 'string', description: 'Current page content, including compiled truth and any current-context sections. Do not include the separator or ## Timeline; the writer owns them.' },
          ...timelineInputProperties(),
          domains: domainField,
          frontmatter: { type: 'object' },
        },
        required: ['raw_path', 'title', 'body', ...mutationRequired()],
        anyOf: timelineInputRequirements(),
      },
    },
    {
      name: 'capture_article',
      description: 'Fetch a publisher article, preserve its HTML as optional archival evidence, and create one searchable Markdown article page containing retrieval context plus a faithful full-text transcript.',
      inputSchema: {
        type: 'object',
        properties: {
          ...mutationProperties(),
          article_url: { type: 'string', format: 'uri', description: 'Canonical publisher URL for the article.' },
          title: { type: 'string' },
          published_date: { type: 'string', description: 'Publisher publication date in ISO 8601 form.' },
          source_kind: { type: 'string', description: 'For example substack, rss, newsletter, or online-article.' },
          summary: { type: 'string', description: 'Concise retrieval-oriented explanation. The full publisher text is fetched separately.' },
          current_relevance: { type: 'string', description: 'Why this source matters to the Brain and which canonical pages it informs.' },
          domains: domainField,
          ...timelineInputProperties(),
        },
        required: ['article_url', 'title', 'published_date', 'summary', 'current_relevance', ...mutationRequired()],
        anyOf: timelineInputRequirements(),
      },
    },
    {
      name: 'refresh_article_capture',
      description: 'Refresh an existing canonical article page with the exact current publisher text, leaving only the article prose in the rendered body.',
      inputSchema: {
        type: 'object',
        properties: {
          ...mutationProperties(),
          article_url: { type: 'string', format: 'uri' },
          title: { type: 'string' },
          ...timelineInputProperties(),
        },
        required: ['article_url', 'title', ...mutationRequired()],
        anyOf: timelineInputRequirements(),
      },
    },
    {
      name: 'update_raw_file',
      description: 'Replace the bytes of one existing raw file under .raw. Raw uploads are size-limited to protect git-backed sync.',
      inputSchema: {
        type: 'object',
      properties: {
          ...mutationProperties(),
          path: { type: 'string', description: 'Existing raw file path such as deals/.raw/blind-teaser.pdf, meetings/.raw/call-transcript.txt, or writing/.raw/unassigned-evidence.pdf.' },
          raw_content_base64: { type: 'string', description: 'Base64 encoded raw bytes. Use this for PDFs, images, and other binary files.' },
          raw_content_text: { type: 'string', description: 'Plain text raw content. Use exactly one of raw_content_base64 or raw_content_text.' },
          mime_type: { type: 'string' },
        },
        required: ['path', ...mutationRequired()],
      },
    },
    {
      name: 'delete_raw_file',
      description: 'Delete one existing raw file under .raw.',
      inputSchema: {
        type: 'object',
        properties: {
          ...mutationProperties(),
          path: { type: 'string', description: 'Existing raw file path such as sources/.raw/deck.pdf.' },
        },
        required: ['path', ...mutationRequired()],
      },
    },
    {
      name: 'rename_raw_file',
      description: 'Rename one existing raw file under .raw and rewrite markdown links, raw_file frontmatter, and public_raw_files references that pointed to the old raw file path.',
      inputSchema: {
        type: 'object',
        properties: {
          ...mutationProperties(),
          from_path: { type: 'string', description: 'Existing raw file path such as deals/.raw/company-specific-teaser.pdf.' },
          to_path: { type: 'string', description: 'Destination raw file path such as deals/.raw/regional-platform-blind-teaser.pdf.' },
        },
        required: ['from_path', 'to_path', ...mutationRequired()],
      },
    },
    {
      name: 'rename_page',
      description: 'Rename one markdown brain page and rewrite relative markdown links that pointed to the old page path. Optionally update the page title during the rename.',
      inputSchema: {
        type: 'object',
        properties: {
          ...mutationProperties(),
          from_path: { type: 'string', description: 'Existing markdown page path such as deals/company-specific-teaser.md.' },
          to_path: { type: 'string', description: 'Destination markdown page path such as deals/regional-platform-blind-teaser.md.' },
          title: { type: 'string', description: 'Optional replacement title for the moved page.' },
          ...timelineInputProperties(),
        },
        required: ['from_path', 'to_path', ...mutationRequired()],
        anyOf: timelineInputRequirements(),
      },
    },
    {
      name: 'update_page',
      description: 'Replace the current compiled_truth zone of a markdown brain page and append one writer-managed timeline entry classified by significance. Returns a quick read-back page health check.',
      inputSchema: {
        type: 'object',
        properties: {
          ...mutationProperties(),
          path: { type: 'string' },
          compiled_truth: { type: 'string', description: 'Replacement current content rendered above the separator, including the opening compiled-truth paragraph and any current-context sections. Do not include the separator or ## Timeline; the writer owns them.' },
          body: { type: 'string', description: 'Legacy alias for compiled_truth. Use compiled_truth for new calls.' },
          ...timelineInputProperties(),
          significance: { type: 'string', enum: TIMELINE_SIGNIFICANCE_VALUES, description: 'Impact of this timeline update on the owning page: patch, minor, or major.' },
          domains: domainField,
          frontmatter: { type: 'object', description: 'Optional patch to arbitrary page metadata, including fields declared by the page schema. Do not include domains, visibility, public_raw_files, or images; use their dedicated fields or tools.' },
        },
        required: ['path', 'significance', ...mutationRequired()],
        allOf: [
          { anyOf: pageContentInputRequirements() },
          { anyOf: timelineInputRequirements() },
        ],
      },
    },
    {
      name: 'attach_page_images',
      description: 'Attach or replace an ordered set of image files on an existing markdown brain page. Images stay in raw Brain storage and are represented by structured page metadata with optional captions and source context.',
      inputSchema: {
        type: 'object',
        properties: {
          ...mutationProperties(),
          path: { type: 'string', description: 'Markdown page path such as products/example or concepts/example.md.' },
          images: pageImagesField(),
          mode: { type: 'string', enum: ['append', 'replace'], default: 'append', description: 'append preserves existing image attachments; replace sets the page image list to exactly this array.' },
          ...timelineInputProperties(),
          significance: { type: 'string', enum: TIMELINE_SIGNIFICANCE_VALUES, description: 'Impact of this image attachment update on the owning page: patch, minor, or major.' },
        },
        required: ['path', 'images', 'significance', ...mutationRequired()],
        anyOf: timelineInputRequirements(),
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
        properties: mutationProperties(),
        required: mutationRequired(),
      },
    },
    {
      name: 'maintenance_sync',
      description: 'Alias for maintenance/sync for clients that do not support slash tool names.',
      inputSchema: {
        type: 'object',
        properties: mutationProperties(),
        required: mutationRequired(),
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
  if (actor?.superuser === true) return true;
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

function eventRegistryStore(config) {
  return new EventRegistryStore({ filePath: config?.eventRegistryPath || defaultEventRegistryPath() });
}

function eventInboxStore(config) {
  return new EventInboxStore({ filePath: config?.eventInboxPath || defaultEventInboxPath() });
}

async function eventRegistryValue(config) {
  return eventRegistryStore(config).get();
}

function safeListener(listener) {
  if (!listener) return null;
  const { credential_ref, ...safe } = listener;
  return { ...safe, credential_configured: Boolean(credential_ref) };
}

function assertEventBrainIdsRegistered(registry, brainIds, config = null) {
  const registered = new Set((registry.brains || []).map((brain) => brain.id));
  if (config?.brainId) registered.add(config.brainId);
  for (const brainId of brainIds || []) if (!registered.has(brainId)) throw new Error(`Brain ${brainId} is not registered for inbound event destinations.`);
}

function safeEventRecord(event) {
  if (!event) return null;
  const { payload, raw_payload, ...safe } = event;
  return { ...safe, payload_present: payload !== null && payload !== undefined, raw_payload_present: Boolean(raw_payload) };
}

async function recordWriteProvenance(config, pagePath, provenance, commitMessage) {
  if (!provenance || !pagePath) return null;
  const db = await openDatabase(config);
  try {
    return await upsertPageProvenance(db, { ...provenance, path: pagePath, commit_message: commitMessage });
  } finally {
    await db.close?.();
  }
}

function EVENT_STATE_SCHEMA_VALUES() {
  return [...EVENT_STATES];
}

const TOOL_POLICIES = {
  me: { layer: 'read', scopes: ['brain:read'] },
  'members/list': { layer: 'read', scopes: ['brain:read'] },
  members_list: { layer: 'read', scopes: ['brain:read'] },
  'members/upsert': { layer: 'members_manage', scopes: ['brain:admin'] },
  members_upsert: { layer: 'members_manage', scopes: ['brain:admin'] },
  'roles/list': { layer: 'read', scopes: ['brain:read'] },
  roles_list: { layer: 'read', scopes: ['brain:read'] },
  'roles/upsert': { layer: 'roles_manage', scopes: ['brain:admin'] },
  roles_upsert: { layer: 'roles_manage', scopes: ['brain:admin'] },
  'domains/list': { layer: 'read', scopes: ['brain:read'] },
  domains_list: { layer: 'read', scopes: ['brain:read'] },
  'domains/get': { layer: 'read', scopes: ['brain:read'] },
  domains_get: { layer: 'read', scopes: ['brain:read'] },
  'domains/create': { layer: 'domains_manage', scopes: ['brain:admin'] },
  domains_create: { layer: 'domains_manage', scopes: ['brain:admin'] },
  'domains/update': { layer: 'domains_manage', scopes: ['brain:admin'] },
  domains_update: { layer: 'domains_manage', scopes: ['brain:admin'] },
  'domains/delete': { layer: 'domains_manage', scopes: ['brain:admin'] },
  domains_delete: { layer: 'domains_manage', scopes: ['brain:admin'] },
  'schemas/list': { layer: 'read', scopes: ['brain:read'] },
  schemas_list: { layer: 'read', scopes: ['brain:read'] },
  'schemas/get': { layer: 'read', scopes: ['brain:read'] },
  schemas_get: { layer: 'read', scopes: ['brain:read'] },
  'schemas/bootstrap': { layer: 'schemas_manage', scopes: ['brain:admin'] },
  schemas_bootstrap: { layer: 'schemas_manage', scopes: ['brain:admin'] },
  'schemas/register': { layer: 'schemas_manage', scopes: ['brain:admin'] },
  schemas_register: { layer: 'schemas_manage', scopes: ['brain:admin'] },
  'schemas/update': { layer: 'schemas_manage', scopes: ['brain:admin'] },
  schemas_update: { layer: 'schemas_manage', scopes: ['brain:admin'] },
  'schemas/delete': { layer: 'schemas_manage', scopes: ['brain:admin'] },
  schemas_delete: { layer: 'schemas_manage', scopes: ['brain:admin'] },
  'tasks/list': { layer: 'read', scopes: ['brain:read'] },
  'tasks/summary': { layer: 'read', scopes: ['brain:read'] },
  'tasks/get': { layer: 'read', scopes: ['brain:read'] },
  'tasks/hygiene': { layer: 'read', scopes: ['brain:read'] },
  search: { layer: 'read', scopes: ['brain:read'] },
  query: { layer: 'read', scopes: ['brain:read'] },
  'pages/query': { layer: 'read', scopes: ['brain:read'] },
  pages_query: { layer: 'read', scopes: ['brain:read'] },
  'playbooks/keep-in-touch/list_due': { layer: 'read', scopes: ['brain:read'] },
  playbooks_keep_in_touch_list_due: { layer: 'read', scopes: ['brain:read'] },
  'playbooks/keep-in-touch/review': { layer: 'read', scopes: ['brain:read'] },
  playbooks_keep_in_touch_review: { layer: 'read', scopes: ['brain:read'] },
  'playbooks/keep-in-touch/record_review': { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  playbooks_keep_in_touch_record_review: { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  'playbooks/keep-in-touch/enroll': { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  playbooks_keep_in_touch_enroll: { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  'playbooks/keep-in-touch/log_contact': { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  playbooks_keep_in_touch_log_contact: { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  'playbooks/keep-in-touch/set_priority': { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  playbooks_keep_in_touch_set_priority: { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  'playbooks/keep-in-touch/set_frequency': { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  playbooks_keep_in_touch_set_frequency: { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  'playbooks/keep-in-touch/set_enabled': { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  playbooks_keep_in_touch_set_enabled: { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  'playbooks/keep-in-touch/snooze': { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  playbooks_keep_in_touch_snooze: { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  'playbooks/comprehension': { layer: 'read', scopes: ['brain:read'] },
  playbooks_comprehension: { layer: 'read', scopes: ['brain:read'] },
  'playbooks/comprehension/setup': { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  playbooks_comprehension_setup: { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  'playbooks/comprehension/session': { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  playbooks_comprehension_session: { layer: 'create', scopes: ['brain:create', 'brain:write'] },
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
  'rss/workflow': { layer: 'read', scopes: ['brain:read'] },
  rss_workflow: { layer: 'read', scopes: ['brain:read'] },
  'rss/ledger': { layer: 'events_manage', scopes: ['brain:admin'] },
  rss_ledger: { layer: 'events_manage', scopes: ['brain:admin'] },
  'substack/workflow': { layer: 'read', scopes: ['brain:read'] },
  substack_workflow: { layer: 'read', scopes: ['brain:read'] },
  'substack/ledger': { layer: 'events_manage', scopes: ['brain:admin'] },
  substack_ledger: { layer: 'events_manage', scopes: ['brain:admin'] },
  'events/listeners': { layer: 'read', scopes: ['brain:read'] },
  'events/listener_upsert': { layer: 'events_manage', scopes: ['brain:admin'] },
  'events/listener_pause': { layer: 'events_manage', scopes: ['brain:admin'] },
  'events/listener_resume': { layer: 'events_manage', scopes: ['brain:admin'] },
  'events/listener_remove': { layer: 'events_manage', scopes: ['brain:admin'] },
  'events/subscriptions': { layer: 'read', scopes: ['brain:read'] },
  'events/subscription_upsert': { layer: 'events_manage', scopes: ['brain:admin'] },
  'events/inbox': { layer: 'read', scopes: ['brain:read'] },
  'events/rss_status': { layer: 'read', scopes: ['brain:read'] },
  'events/rss-status': { layer: 'read', scopes: ['brain:read'] },
  'events/rss_backfill': { layer: 'events_manage', scopes: ['brain:admin'] },
  'events/rss-backfill': { layer: 'events_manage', scopes: ['brain:admin'] },
  'events/retry': { layer: 'events_manage', scopes: ['brain:admin'] },
  'events/discard': { layer: 'events_manage', scopes: ['brain:admin'] },
  'events/quarantine': { layer: 'events_manage', scopes: ['brain:admin'] },
  'events/test': { layer: 'events_manage', scopes: ['brain:admin'] },
  'events/health': { layer: 'read', scopes: ['brain:read'] },
  'events/provenance': { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  'events/provenance_list': { layer: 'read', scopes: ['brain:read'] },
  create_raw_file: { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  create_page: { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  create_raw_file_with_page: { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  capture_article: { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  refresh_article_capture: { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  update_page: { layer: 'create', scopes: ['brain:create', 'brain:write'] },
  attach_page_images: { layer: 'create', scopes: ['brain:create', 'brain:write'] },
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

const GIT_SYNC_MUTATION_TOOLS = new Set([
  'tasks/create',
  'tasks/update',
  'domains/create',
  'domains_create',
  'domains/update',
  'domains_update',
  'domains/delete',
  'domains_delete',
  'schemas/bootstrap',
  'schemas_bootstrap',
  'schemas/register',
  'schemas_register',
  'schemas/update',
  'schemas_update',
  'schemas/delete',
  'schemas_delete',
  'create_raw_file',
  'create_page',
  'create_raw_file_with_page',
  'capture_article',
  'refresh_article_capture',
  'attach_page_images',
  'update_raw_file',
  'delete_raw_file',
  'rename_raw_file',
  'rename_page',
  'update_page',
  'set_page_visibility',
  'maintenance/git_backup',
  'maintenance_git_backup',
  'playbooks/keep-in-touch/enroll',
  'playbooks_keep_in_touch_enroll',
  'playbooks/keep-in-touch/log_contact',
  'playbooks_keep_in_touch_log_contact',
  'playbooks/keep-in-touch/set_priority',
  'playbooks_keep_in_touch_set_priority',
  'playbooks/keep-in-touch/set_frequency',
  'playbooks_keep_in_touch_set_frequency',
  'playbooks/keep-in-touch/set_enabled',
  'playbooks_keep_in_touch_set_enabled',
  'playbooks/keep-in-touch/record_review',
  'playbooks_keep_in_touch_record_review',
  'playbooks/keep-in-touch/snooze',
  'playbooks_keep_in_touch_snooze',
]);

function requireMutationMetadata(name, args) {
  if (!GIT_SYNC_MUTATION_TOOLS.has(name)) return null;
  try {
    return parseMutationMetadata({
      commit_message: args?.commit_message,
      provenance: args?.provenance,
    });
  } catch (error) {
    throw new Error(`Git-backed MCP mutation ${name} requires a valid commit_message and provenance: ${error.message}`);
  }
}

function requirePageTimelineSignificance(name, args) {
  if (!['create_page', 'update_page', 'attach_page_images'].includes(name)) return null;
  try {
    return timelineSignificanceSchema.parse(args?.significance);
  } catch (error) {
    throw new Error(`${name} requires significance: ${error.message}`);
  }
}

async function resolveProfileEditor(config, actor, authConfig) {
  const db = await openDatabase(config);
  try {
    const member = await resolveActorMember(db, actor, memberResolutionFromAuthConfig(authConfig));
    if (member && !(await roleAllows(db, member.role, 'about_update'))) throw new Error('Only a brain owner may update the meeting-ingestion description.');
    return member;
  } finally {
    await db.close?.();
  }
}

async function toolRolesList(config) {
  const db = await openDatabase(config);
  try {
    return await listRoles(db);
  } finally {
    await db.close?.();
  }
}

async function toolRolesUpsert(config, args) {
  const db = await openDatabase(config);
  try {
    const role = await upsertCustomRole(db, {
      key: args.key,
      name: args.name,
      description: args.description,
      permissions: args.permissions || { read: true, page_edit: true },
      page_edit_paths: args.page_edit_paths || [],
    });
    return { roles: await listRoles(db), role };
  } finally {
    await db.close?.();
  }
}

async function toolMembersUpsert(config, args, actor, authConfig) {
  const db = await openDatabase(config);
  try {
    const actorMember = await resolveActorMember(db, actor, memberResolutionFromAuthConfig(authConfig));
    const targetRole = args.role || 'editor';
    if (!(await getRole(db, targetRole))) throw new Error(`Unknown role: ${targetRole}`);
    if (actorMember && !isOwnerRole(actorMember.role) && isOwnerRole(targetRole)) {
      throw new Error('Only a brain owner may assign or unassign owners.');
    }
    const existing = (await listMembers(db)).find((member) => member.email === String(args.email || '').trim().toLowerCase());
    if (actorMember && !isOwnerRole(actorMember.role) && existing && isOwnerRole(existing.role)) {
      throw new Error('Only a brain owner may change owners.');
    }
    return upsertMember(db, {
      email: args.email,
      name: args.name,
      person_slug: args.person_slug,
      status: args.status || 'active',
      role: targetRole,
    });
  } finally {
    await db.close?.();
  }
}

async function assertRoleAllowed({ config, name, args, actor, authConfig }) {
  const permission = rolePermissionForTool(name);
  if (!permission) return;
  const db = await openDatabase(config);
  try {
    const member = await resolveActorMember(db, actor, memberResolutionFromAuthConfig(authConfig));
    if (!member) {
      const hasConfiguredMembers = (await listMembers(db)).length > 0;
      if (actor?.email && hasConfiguredMembers && permission !== 'read') throw new ForbiddenToolError(`${name} requires an active brain member role.`);
      return;
    }
    if (!(await roleAllows(db, member.role, permission))) throw new ForbiddenToolError(`${name} is not allowed for role ${member.role}.`);
    if (permission === 'page_edit') {
      for (const pagePath of pageEditPathsForTool(name, args)) {
        if (!(await roleCanEditPath(db, member.role, pagePath))) {
          throw new ForbiddenToolError(`${name} is not allowed for role ${member.role} on ${pagePath}.`);
        }
      }
    }
  } finally {
    await db.close?.();
  }
}

function rolePermissionForTool(name) {
  const policy = toolPolicy(name);
  if (!policy) return null;
  if (policy.layer === 'read') return 'read';
  if (policy.layer === 'create') return 'page_edit';
  if (policy.layer === 'publish') return 'publish';
  if (policy.layer === 'raw_destructive') return 'raw_destructive';
  if (policy.layer === 'git_backup') return 'git_backup';
  if (policy.layer === 'maintenance') return 'maintenance';
  if (policy.layer === 'admin') return ['about/update'].includes(name) ? 'about_update' : 'audit';
  if (policy.layer === 'members_manage') return 'members_manage';
  if (policy.layer === 'roles_manage') return 'roles_manage';
  if (policy.layer === 'domains_manage') return 'domains_manage';
  if (policy.layer === 'schemas_manage') return 'schemas_manage';
  if (policy.layer === 'events_manage') return 'members_manage';
  return null;
}

function pageEditPathsForTool(name, args) {
  switch (name) {
    case 'create_page':
    case 'update_page':
    case 'attach_page_images':
      return [args.path].filter(Boolean);
    case 'rename_page':
      return [args.from_path, args.to_path].filter(Boolean);
    case 'tasks/create':
    case 'tasks/update':
      return [args.path || args.slug || 'tasks'].filter(Boolean);
    case 'create_raw_file_with_page':
      return [args.page_path].filter(Boolean);
    case 'capture_article':
      return [`articles/${articleSlug(args.title)}.md`];
    case 'refresh_article_capture':
      return [`articles/${articleSlug(args.title)}.md`];
    default:
      return [];
  }
}

function assertToolPolicyComplete(config = null) {
  const advertised = new Set(toolDefinitions(config).map((tool) => tool.name));
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

function domainWriteSchema() {
  return {
    type: 'object',
    properties: {
      ...mutationProperties(),
      id: { type: 'string', description: 'Stable lowercase hyphenated domain ID, such as ai-infrastructure. IDs cannot be changed by update.' },
      name: { type: 'string', description: 'Human-friendly domain name.' },
      guidance: { type: 'string', description: 'Authoritative guidance for what belongs in this knowledge domain, what does not, and when the domain should be left empty.' },
    },
    required: ['id', 'name', 'guidance', ...mutationRequired()],
  };
}

function domainDeleteSchema() {
  return {
    type: 'object',
    properties: {
      ...mutationProperties(),
      id: { type: 'string', description: 'Stable registered domain ID to delete.' },
    },
    required: ['id', ...mutationRequired()],
  };
}

function pageSchemaGetSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Stable lowercase hyphenated page schema ID.' },
    },
    required: ['id'],
  };
}

function pageSchemaBootstrapSchema() {
  return {
    type: 'object',
    properties: mutationProperties(),
    required: mutationRequired(),
  };
}

function pageSchemaWriteSchema() {
  return {
    type: 'object',
    properties: {
      ...mutationProperties(),
      id: { type: 'string', description: 'Stable lowercase hyphenated page schema ID. IDs cannot be changed by update.' },
      definition: {
        type: 'object',
        description: 'Brain-local schema definition. path_prefix maps a collection; fields describes optional frontmatter fields, their type, enum, default, required flag, and guidance.',
        properties: {
          path_prefix: { type: 'string', description: 'Optional relative collection path such as tasks or decisions.' },
          description: { type: 'string', description: 'Human-readable purpose and usage guidance.' },
          fields: {
            type: 'object',
            description: 'Map of frontmatter field names to field definitions.',
            additionalProperties: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['string', 'number', 'boolean', 'array', 'object'] },
                required: { type: 'boolean' },
                enum: { type: 'array', items: { type: ['string', 'number', 'boolean'] } },
                default: {},
                description: { type: 'string' },
              },
              additionalProperties: true,
            },
          },
        },
        additionalProperties: true,
      },
    },
    required: ['id', 'definition', ...mutationRequired()],
  };
}

function pageSchemaDeleteSchema() {
  return {
    type: 'object',
    properties: {
      ...mutationProperties(),
      id: { type: 'string', description: 'Stable registered page schema ID to delete.' },
    },
    required: ['id', ...mutationRequired()],
  };
}

function pagesQuerySchema() {
  return {
    type: 'object',
    properties: {
      path_prefix: { type: 'string', description: 'Optional relative Brain path prefix such as people or deals.' },
      type: { type: 'string', description: 'Optional exact indexed page type, such as people or deals.' },
      filters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', description: 'A page field or a flat front-matter key.' },
            operator: { type: 'string', enum: ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in', 'exists'] },
            value: { description: 'A scalar filter value, an array for in, or a boolean for exists.' },
            value_type: { type: 'string', enum: ['string', 'number', 'boolean', 'timestamp'] },
          },
          required: ['field', 'operator'],
        },
      },
      fields: { type: 'array', items: { type: 'string' }, description: 'Optional front-matter keys to return. Omit to return all front matter.' },
      order_by: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            direction: { type: 'string', enum: ['asc', 'desc'] },
            value_type: { type: 'string', enum: ['string', 'number', 'boolean', 'timestamp'] },
          },
          required: ['field'],
        },
      },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      cursor: { type: 'integer', minimum: 0, default: 0 },
      count_only: { type: 'boolean', default: false },
      include_total: { type: 'boolean', default: true },
      as_of: { type: 'string', format: 'date-time', description: 'Optional RFC3339 timestamp returned with the result and used by $as_of filter values.' },
    },
  };
}

function keepInTouchListDueSchema() {
  return {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      as_of: { type: 'string', format: 'date-time', description: 'Optional RFC3339 timestamp used to determine whether a person is due.' },
    },
  };
}

function keepInTouchReviewSchema() {
  return {
    type: 'object',
    properties: {
      as_of: { type: 'string', format: 'date-time', description: 'Optional RFC3339 timestamp that freezes the review window.' },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: KEEP_IN_TOUCH_MAX_REVIEW_LIMIT,
        default: KEEP_IN_TOUCH_DEFAULT_REVIEW_LIMIT,
        description: 'Maximum number of people pages to review in this run. Pages are returned oldest-first from the playbook cursor so repeated runs backfill over time.',
      },
    },
  };
}

function keepInTouchRecordReviewSchema() {
  return {
    type: 'object',
    properties: {
      review_id: { type: 'string', description: 'Review identifier returned by playbooks/keep-in-touch/review.' },
      as_of: { type: 'string', format: 'date-time', description: 'The exact as_of timestamp returned by the review.' },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: KEEP_IN_TOUCH_MAX_REVIEW_LIMIT,
        default: KEEP_IN_TOUCH_DEFAULT_REVIEW_LIMIT,
        description: 'The exact page limit used by the review. Pass through the value returned by playbooks/keep-in-touch/review.',
      },
      cursor_before: {
        type: ['object', 'null'],
        properties: {
          updated_at: { type: 'string', format: 'date-time' },
          page_slug: { type: 'string' },
        },
      },
      decisions: {
        type: 'array',
        description: 'Exactly one evidence-backed decision for every candidate returned by the review.',
        items: {
          type: 'object',
          properties: {
            page_slug: { type: 'string' },
            outcome: { type: 'string', enum: ['added', 'frequency_changed', 'due', 'no_change', 'needs_review'] },
            reason: { type: 'string' },
            evidence: { type: 'array', items: { type: 'string' }, minItems: 1 },
            confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
            frequency_days: { type: 'integer', enum: [3, 7, 14, 30, 60] },
            last_contacted_at: { type: 'string', format: 'date-time' },
          },
          required: ['page_slug', 'outcome', 'reason', 'evidence', 'confidence'],
        },
      },
      ...mutationProperties(),
    },
    required: ['review_id', 'as_of', 'limit', 'cursor_before', 'decisions', ...mutationRequired()],
  };
}

function keepInTouchSetFrequencySchema() {
  return {
    type: 'object',
    properties: {
      page_slug: { type: 'string', description: 'Enrolled people page slug such as people/alice.' },
      frequency_days: { type: 'integer', enum: [3, 7, 14, 30, 60] },
    },
    required: ['page_slug', 'frequency_days'],
  };
}

function keepInTouchSetEnabledSchema() {
  return {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', description: 'Whether the Keep in Touch daily review may scan and write its private overlay.' },
    },
    required: ['enabled'],
  };
}

function keepInTouchEnrollSchema() {
  return {
    type: 'object',
    properties: {
      page_slug: { type: 'string', description: 'People page slug such as people/alice.' },
      priority: { type: 'integer', minimum: 1, maximum: 5, default: 3 },
      stage: { type: 'string', enum: ['new', 'building', 'maintaining', 'paused'], default: 'building' },
      cadence_days: { type: 'integer', minimum: 1, maximum: 3650, default: 7 },
      next_due_at: { type: 'string', format: 'date-time' },
      last_contacted_at: { type: 'string', format: 'date-time' },
    },
    required: ['page_slug'],
  };
}

function keepInTouchLogContactSchema() {
  return {
    type: 'object',
    properties: {
      page_slug: { type: 'string', description: 'Enrolled people page slug such as people/alice.' },
      contacted_at: { type: 'string', format: 'date-time' },
      cadence_days: { type: 'integer', minimum: 1, maximum: 3650 },
    },
    required: ['page_slug'],
  };
}

function keepInTouchSetPrioritySchema() {
  return {
    type: 'object',
    properties: {
      page_slug: { type: 'string', description: 'Enrolled people page slug such as people/alice.' },
      priority: { type: 'integer', minimum: 1, maximum: 5 },
    },
    required: ['page_slug', 'priority'],
  };
}

function keepInTouchSnoozeSchema() {
  return {
    type: 'object',
    properties: {
      page_slug: { type: 'string', description: 'Enrolled people page slug such as people/alice.' },
      days: { type: 'integer', minimum: 1, maximum: 3650, default: 7 },
    },
    required: ['page_slug'],
  };
}

function comprehensionReadSchema() {
  return {
    type: 'object',
    properties: {
      page_slug: { type: 'string', description: 'Optional page slug whose full Comprehension session history should be returned.' },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
      history_limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
    },
  };
}

function comprehensionSetupSchema() {
  return {
    type: 'object',
    properties: {
      guidance: { type: 'string', description: 'Natural-language description of what the user wants to understand and retain.' },
    },
    required: ['guidance'],
  };
}

function comprehensionSessionSchema() {
  return {
    type: 'object',
    properties: {
      page_slug: { type: 'string', description: 'Brain page being understood.' },
      session_id: { type: 'string', description: 'Optional stable identifier used to continue one session.' },
      summary: { type: 'string', description: 'Complete current written summary, including strengths, gaps, tutor notes, and the next point to resume.' },
    },
    required: ['page_slug', 'summary'],
  };
}

function listenerWriteSchema() {
  return {
    type: 'object',
    properties: {
      listener: {
        type: 'object',
        description: 'Listener definition. Stable id, type, endpoint, scope, feed-specific guidance, policies, placement, execution mode, and optional registered Brain IDs.',
      },
      id: { type: 'string' },
      type: { type: 'string', enum: ['rss', 'webhook'] },
      scope: { type: 'string', enum: ['personal', 'organization'] },
      url: { type: 'string' },
      credential_ref: { type: 'string' },
      description: { type: 'string' },
      guidance: { type: 'string', description: 'Feed-specific instructions for what this RSS source is for, what to prioritize, and what to ignore. Applied to each article event from this listener.' },
      display_name: { type: 'string' },
      icon: { type: 'string' },
      filter: { type: 'object' },
      capture_policy: { type: 'object' },
      article_policy: { type: 'object', description: 'RSS-only canonical source retrieval and preservation policy.' },
      listener_location: { type: 'string', enum: ['client', 'host'] },
      codex_execution_location: { type: 'string', enum: ['client', 'host'] },
      codex_execution_mode: { type: 'string', enum: ['app_thread', 'cli'] },
      codex_model: { type: 'string' },
      codex_reasoning_effort: { type: 'string', enum: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
      codex_thread_title: { type: 'string' },
      brain_ids: { type: 'array', items: { type: 'string' } },
      subscription_ids: { type: 'array', items: { type: 'string' } },
      enabled: { type: 'boolean' },
      paused: { type: 'boolean' },
    },
  };
}

function subscriptionWriteSchema() {
  return {
    type: 'object',
    properties: {
      subscription: { type: 'object' },
      id: { type: 'string' },
      listener_id: { type: 'string' },
      client_id: { type: 'string' },
      brain_ids: { type: 'array', items: { type: 'string' } },
      enabled: { type: 'boolean' },
    },
  };
}

function memberUpsertSchema() {
  return {
    type: 'object',
    properties: {
      email: { type: 'string' },
      person_slug: { type: 'string', description: 'People page slug such as people/hani.' },
      name: { type: 'string' },
      role: { type: 'string', description: 'Role key such as owner, admin, editor, read-only, or a custom role key.' },
      status: { type: 'string', enum: ['active', 'inactive', 'invited'] },
    },
    required: ['email', 'person_slug', 'role'],
  };
}

function roleUpsertSchema() {
  return {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Lowercase custom role key. Built-in roles cannot be changed through this tool.' },
      name: { type: 'string' },
      description: { type: 'string' },
      permissions: {
        type: 'object',
        properties: {
          read: { type: 'boolean' },
          page_edit: { type: 'boolean' },
          publish: { type: 'boolean' },
          raw_destructive: { type: 'boolean' },
          maintenance: { type: 'boolean' },
          git_backup: { type: 'boolean' },
        },
      },
      page_edit_paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Path prefixes this custom role can edit, such as deals or meetings. Empty string means all pages.',
      },
    },
    required: ['key', 'name'],
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
      ...mutationProperties(),
      path: { type: 'string', description: 'Markdown page path such as people/alice or people/alice.md.' },
      visibility: { type: 'string', enum: ['internal', 'public'], description: 'internal is private to the brain; public exposes the page body and returns an absolute public_url plus public_url_path.' },
      public_raw_files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional explicit raw-file allowlist such as ["ops/.raw/onboarding.pdf"]. Only linked or attached PDF, PNG, JPG, JPEG, WebP, TXT, and CSV files can be served on public pages.',
      },
      ...timelineInputProperties(),
    },
    required: [...(requireVisibility ? ['path', 'visibility'] : ['path']), ...mutationRequired()],
  };
}

function pageImagesField() {
  return {
    type: 'array',
    maxItems: 100,
    description: 'Ordered image attachments. Each path must point to an existing image under <collection>/.raw/.',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Raw image path such as meetings/.raw/cooling-tower.jpg.' },
        caption: { type: 'string' },
        alt_text: { type: 'string' },
        kind: { type: 'string', enum: ['product', 'component', 'system', 'installation', 'diagram', 'other'] },
        source: { type: 'string', description: 'Source record, file, or exhibit identifier.' },
        timestamp: { type: 'string', description: 'Optional source timestamp such as 14:20.' },
        captured_at: { type: 'string', description: 'Optional image capture timestamp.' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      },
    },
  };
}

function mutationProperties() {
  return {
    commit_message: {
      type: 'string',
      description: 'Required short single-line description of what this mutation changes and why. Used directly as the Git commit message.',
    },
    provenance: {
      type: 'object',
      description: 'Required compact metadata describing what triggered this mutation.',
      properties: {
        event_id: { type: 'string', description: 'Stable source event identifier used for idempotency.' },
        source_type: { type: 'string', enum: SOURCE_TYPE_VALUES, description: SOURCE_TYPE_VALUES.map((value) => `${value}: ${SOURCE_TYPE_DEFINITIONS[value].description}`).join(' ') },
        source_label: { type: 'string', description: 'Short AI-selected name for the triggering event, such as a sender, thread, meeting, feed, or chat title.' },
        source_message: { type: 'string', description: 'Human-readable source message or concise source content that caused the page update. This is stored on the timeline entry.' },
        origin_id: { type: 'string', description: 'Optional upstream event or provider object identifier.' },
        listener_id: { type: 'string', description: 'Optional registered listener that delivered the source event.' },
        source_icon: { type: 'string', description: 'Optional compact source icon identifier.' },
        source_url: { type: 'string', format: 'uri', description: 'Optional canonical URL for the source event or source item.' },
        occurred_at: { type: 'string', format: 'date-time', description: 'Optional source event timestamp. Use this when the source event happened before ingestion.' },
        received_at: { type: 'string', format: 'date-time', description: 'Optional timestamp when the source was received by the integration.' },
        codex_execution_id: { type: 'string' },
        codex_thread_id: { type: 'string' },
        raw_ref: { type: 'string', description: 'Optional reference to retained raw source material.' },
        outcome: { type: 'string', description: 'Optional processing outcome label.' },
      },
      required: ['event_id', 'source_type', 'source_label', 'source_message'],
    },
  };
}

function timelineInputProperties() {
  return {
    timeline_entry: {
      type: 'string',
      description: 'Backward-compatible shorthand for one concise, subject-first timeline entry. Omit the current user\'s name when authorship is implicit; keep source wording in provenance.source_message. New callers may use timeline for structured entries.',
    },
    timeline: {
      type: 'array',
      minItems: 1,
      items: timelineEntrySchema(),
      description: 'Structured append-only timeline entries. occurred_at defaults to the current time and may be overridden for historical events; recorded_at defaults to the actual write time. Provenance is stored on each entry, not as mutable page-level source metadata.',
    },
  };
}

function timelineEntrySchema() {
  return {
    type: 'object',
    properties: {
      entry_id: { type: 'string', description: 'Optional stable identifier. When omitted, the source event_id is used.' },
      occurred_at: { type: 'string', description: 'When the underlying event happened: YYYY-MM-DD or an ISO timestamp. Defaults to now.' },
      timestamp: { type: 'string', format: 'date-time', description: 'Compatibility alias for occurred_at.' },
      date: { type: 'string', format: 'date', description: 'Compatibility alias for a date-only occurred_at value.' },
      recorded_at: { type: 'string', format: 'date-time', description: 'When BigBrain recorded the entry. Defaults to the actual write time.' },
      text: { type: 'string', description: 'Concise, subject-first summary of the durable page change. Omit the current user\'s name when authorship is implicit; keep source wording and approval context in provenance.source_message.' },
      provenance: {
        type: 'object',
        description: 'Required source provenance for this specific timeline entry. It records the event and source that caused the page change.',
        properties: {
          event_id: { type: 'string' },
          source_type: { type: 'string', enum: SOURCE_TYPE_VALUES },
          source_label: { type: 'string' },
          source_message: { type: 'string' },
          source_icon: { type: 'string' },
          source_url: { type: 'string', format: 'uri' },
        },
        required: ['event_id', 'source_type', 'source_label', 'source_message'],
      },
      significance: { type: 'string', enum: TIMELINE_SIGNIFICANCE_VALUES },
    },
    required: ['text', 'provenance'],
  };
}

function timelineInputRequirements() {
  return [
    { required: ['timeline_entry'] },
    { required: ['timeline'] },
  ];
}

function pageContentInputRequirements() {
  return [
    { required: ['compiled_truth'] },
    { required: ['body'] },
  ];
}

function mutationRequired() {
  return ['commit_message', 'provenance'];
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
      ...mutationProperties(),
      path: { type: 'string', description: update ? 'Existing task path under tasks/.' : 'Optional destination path under tasks/.' },
      title: { type: 'string' },
      body: { type: 'string' },
      status: { type: 'string', enum: ['open', 'in_progress', 'waiting', 'done', 'archived'] },
      priority: { type: 'string', enum: ['p0', 'p1', 'p2', 'p3'] },
      readiness: { type: 'string', enum: ['underspecified', 'ready'], description: 'Agent-authored handoff state. Use ready when the task appears specified enough to work; use underspecified when it clearly needs more context. Presentation tools may still surface open questions as input-needed.' },
      execution_mode: { type: 'string', enum: ['agent', 'user', 'interactive'], description: 'Who can execute the task: agent for autonomous agent-completable work, interactive for guided work needing user judgement/review/decisions, user only for real-world actions Codex cannot perform.' },
      assignees: { type: 'array', items: { type: 'string' }, description: 'Active member person slugs, or me for the authenticated member.' },
      source: { type: 'array', items: { type: 'string' }, description: 'Related brain slugs such as meetings/example or initiatives/example.' },
      ...timelineInputProperties(),
    },
    required: [...(update ? ['path'] : requireBody ? ['title', 'body'] : ['title']), ...mutationRequired()],
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

function timelineForMutation(args = {}, actor = null, fallback = null) {
  const input = args.timeline !== undefined
    ? args.timeline
    : args.timeline_entry !== undefined
      ? args.timeline_entry
      : fallback;
  if (input === null || input === undefined) return input;

  const enrich = (value) => {
    const base = value && typeof value === 'object' && !Array.isArray(value)
      ? { ...value }
      : { text: value };
    const rawText = String(base.text ?? base.entry ?? base.timeline_entry ?? '').trim();
    const text = actor?.email && rawText && !rawText.includes(`(via ${actor.email})`)
      ? `${rawText} (via ${actor.email})`
      : rawText;
    const provenance = {
      ...(args.provenance || {}),
      ...(base.provenance || {}),
    };
    if (!provenance.source_message && provenance.source_label) provenance.source_message = provenance.source_label;
    if (args.commit_message && Object.keys(provenance).length) provenance.commit_message = args.commit_message;
    return {
      ...base,
      text,
      ...(Object.keys(provenance).length ? { provenance } : {}),
      ...(base.significance === undefined && args.significance !== undefined ? { significance: args.significance } : {}),
    };
  };

  return Array.isArray(input) ? input.map(enrich) : enrich(input);
}

function backupMessage(actor) {
  return actor?.email
    ? `bigbrain: MCP contribution from ${actor.email}`
    : 'bigbrain: automated MCP backup';
}
