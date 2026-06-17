import http from 'node:http';

import { persistState } from './config.js';
import { openDatabase } from './db.js';
import {
  createBrainPage,
  listBrainPath,
  readBrainPage,
  updateBrainPage,
} from './page-ops.js';
import { queryBrain, searchBrain } from './search.js';
import { syncBrain } from './sync.js';

const DEFAULT_MCP_PROTOCOL_VERSION = '2024-11-05';

export async function startMcpServer({
  config,
  host = '0.0.0.0',
  port = Number(process.env.PORT || 3333),
  authToken = process.env.BIGBRAIN_MCP_TOKEN || process.env.MCP_AUTH_TOKEN || null,
  syncIntervalMs = Number(process.env.BIGBRAIN_MCP_SYNC_INTERVAL_MS || 300000),
} = {}) {
  await syncAndPersist(config);
  const syncTimer = syncIntervalMs > 0
    ? setInterval(() => {
        syncAndPersist(config).catch((error) => {
          console.error(`BigBrain MCP background sync failed: ${error.message}`);
        });
      }, syncIntervalMs)
    : null;
  if (syncTimer) syncTimer.unref?.();

  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') {
        return sendJson(response, 200, { ok: true, brain_home: config.brainHome });
      }
      if (request.method !== 'POST' || !request.url?.startsWith('/mcp')) {
        return sendJson(response, 404, jsonRpcError(null, -32004, 'Not found'));
      }
      if (!isAuthorized(request, authToken)) {
        return sendJson(response, 401, jsonRpcError(null, -32001, 'Unauthorized'));
      }

      const payload = JSON.parse(await readRequestBody(request));
      const result = Array.isArray(payload)
        ? await Promise.all(payload.map((message) => handleJsonRpcMessage({ config, message })))
        : await handleJsonRpcMessage({ config, message: payload });
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
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function handleJsonRpcMessage({ config, message }) {
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
        return jsonRpcResult(message.id, await callTool({ config, params: message.params || {} }));
      default:
        return jsonRpcError(message.id, -32601, `Unknown method: ${message.method}`);
    }
  } catch (error) {
    return jsonRpcError(message.id, -32603, error instanceof Error ? error.message : String(error));
  }
}

async function callTool({ config, params }) {
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
      }));
    case 'read':
      return toolJson(await readBrainPage({ config, pagePath: args.path }));
    case 'create_page': {
      const page = await createBrainPage({
        config,
        pagePath: args.path,
        title: args.title,
        body: args.body,
        timelineEntry: args.timeline_entry,
        frontmatter: args.frontmatter || {},
      });
      await syncAndPersist(config);
      return toolJson(page);
    }
    case 'update_page': {
      const page = await updateBrainPage({
        config,
        pagePath: args.path,
        body: args.body,
        timelineEntry: args.timeline_entry,
      });
      await syncAndPersist(config);
      return toolJson(page);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
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

function isAuthorized(request, authToken) {
  if (!authToken) return true;
  const authorization = request.headers.authorization || '';
  if (authorization === `Bearer ${authToken}`) return true;
  return request.headers['x-bigbrain-token'] === authToken;
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  });
  response.end(JSON.stringify(value));
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
