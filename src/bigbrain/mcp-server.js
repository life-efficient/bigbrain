import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { persistState } from './config.js';
import { openDatabase } from './db.js';
import {
  createBrainPage,
  createRawFileWithPage,
  listBrainPath,
  readBrainPage,
  updateBrainPage,
} from './page-ops.js';
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

const DEFAULT_MCP_PROTOCOL_VERSION = '2024-11-05';
const execFileAsync = promisify(execFile);

export async function startMcpServer({
  config,
  host = '0.0.0.0',
  port = Number(process.env.PORT || 3333),
  authToken = process.env.BIGBRAIN_MCP_TOKEN || process.env.MCP_AUTH_TOKEN || null,
  authConfig = buildAuthConfig({ authToken }),
  syncIntervalMs = Number(process.env.BIGBRAIN_MCP_SYNC_INTERVAL_MS || 300000),
  gitBackupEnabled = process.env.BIGBRAIN_MCP_GIT_BACKUP === '1',
  gitBackupIntervalMs = Number(process.env.BIGBRAIN_MCP_GIT_BACKUP_INTERVAL_MS || 300000),
} = {}) {
  if (authRoutesEnabled(authConfig)) assertOAuthConfigured(authConfig);
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
          return sendHtml(response, 200, renderOAuthCompletePage(authConfig));
        } catch (error) {
          return sendHtml(response, 403, renderAuthErrorPage(authConfig, error instanceof Error ? error.message : String(error)));
        }
      }
      if (request.method === 'GET' && request.url === '/health') {
        return sendJson(response, 200, { ok: true });
      }
      if (request.method !== 'POST' || !request.url?.startsWith('/mcp')) {
        return sendJson(response, 404, jsonRpcError(null, -32004, 'Not found'));
      }
      const authorization = await authorizeMcpRequest(request, authConfig);
      if (!authorization.ok) {
        return sendJson(response, authorization.status || 401, jsonRpcError(null, -32001, authorization.message || 'Unauthorized'), {
          authConfig,
          includeResourceMetadata: true,
        });
      }

      const payload = JSON.parse(await readRequestBody(request));
      const result = Array.isArray(payload)
        ? (await Promise.all(payload.map((message) => handleJsonRpcMessage({ config, message, gitBackupEnabled, actor: authorization.actor })))).filter(Boolean)
        : await handleJsonRpcMessage({ config, message: payload, gitBackupEnabled, actor: authorization.actor });
      if (!result || (Array.isArray(result) && result.length === 0)) {
        return sendNoContent(response);
      }
      return sendJson(response, 200, result);
    } catch (error) {
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

  return {
    server,
    url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${resolvedPort}/mcp`,
    close: () => new Promise((resolve, reject) => {
      if (syncTimer) clearInterval(syncTimer);
      if (gitBackupTimer) clearInterval(gitBackupTimer);
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function handleJsonRpcMessage({ config, message, gitBackupEnabled, actor }) {
  if (!message || message.jsonrpc !== '2.0') return jsonRpcError(message?.id ?? null, -32600, 'Invalid JSON-RPC request.');
  if (message.id === undefined) return null;

  try {
    switch (message.method) {
      case 'initialize':
        return jsonRpcResult(message.id, {
          protocolVersion: message.params?.protocolVersion || DEFAULT_MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'bigbrain', version: '0.1.0' },
        });
      case 'ping':
        return jsonRpcResult(message.id, {});
      case 'tools/list':
        return jsonRpcResult(message.id, { tools: toolDefinitions() });
      case 'tools/call':
        return jsonRpcResult(message.id, await callTool({ config, params: message.params || {}, gitBackupEnabled, actor }));
      default:
        return jsonRpcError(message.id, -32601, `Unknown method: ${message.method}`);
    }
  } catch (error) {
    return jsonRpcError(message.id, -32603, error instanceof Error ? error.message : String(error));
  }
}

async function callTool({ config, params, gitBackupEnabled, actor }) {
  const name = params.name;
  const args = params.arguments || {};
  switch (name) {
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
      }));
    case 'read':
      return toolJson(await readBrainPage({ config, pagePath: args.path }));
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
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function postWriteMaintenance(config, gitBackupEnabled, actor) {
  await syncAndPersist(config);
  if (gitBackupEnabled) {
    await backupGitChanges(config, backupMessage(actor));
  }
}

async function toolSearch(config, args) {
  const query = requireString(args.query, 'query');
  const limit = normalizeLimit(args.limit, 10);
  const db = await openDatabase(config);
  return searchBrain({ db, config, query, limit });
}

async function toolQuery(config, args) {
  const question = requireString(args.question, 'question');
  const limit = normalizeLimit(args.limit, 6);
  const db = await openDatabase(config);
  return queryBrain({ db, config, question, limit });
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

async function backupGitChanges(config, message) {
  const repoRoot = await gitRepoRoot(config.brainDir);
  const status = await git(repoRoot, ['status', '--porcelain']);
  if (!status.stdout.trim()) return { committed: false, pushed: false };

  const relativeBrainDir = path.relative(repoRoot, config.brainDir) || '.';
  await git(repoRoot, ['add', relativeBrainDir]);
  const staged = await git(repoRoot, ['diff', '--cached', '--name-only']);
  if (!staged.stdout.trim()) return { committed: false, pushed: false };

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
      name: 'search',
      description: 'Search the selected BigBrain brain using lexical and semantic retrieval when embeddings are available.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
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
          limit: { type: 'number' },
        },
        required: ['question'],
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
      description: 'Read one markdown page from the brain.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
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
      description: 'Upload a raw file under <collection>/.raw/<file> and create the corresponding markdown brain page in one call.',
      inputSchema: {
        type: 'object',
        properties: {
          raw_path: { type: 'string', description: 'Destination such as sources/.raw/deck.pdf or meetings/.raw/call/transcript.txt.' },
          raw_content_base64: { type: 'string', description: 'Base64 encoded raw bytes. Use this for PDFs, images, and other binary files.' },
          raw_content_text: { type: 'string', description: 'Plain text raw content. Use exactly one of raw_content_base64 or raw_content_text.' },
          mime_type: { type: 'string' },
          page_path: { type: 'string', description: 'Markdown page path to create, such as sources/deck-summary.' },
          title: { type: 'string' },
          body: { type: 'string' },
          timeline_entry: { type: 'string' },
          frontmatter: { type: 'object' },
        },
        required: ['raw_path', 'page_path', 'title', 'body', 'timeline_entry'],
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
  ];
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function toolJson(value) {
  const text = JSON.stringify(value, null, 2);
  return {
    content: [{ type: 'text', text }],
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

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
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
