import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';

import { StdioHttpMcpBridge, parseSseJson, readProtectedBearerToken } from '../../src/bigbrain/mcp-http-stdio-bridge.js';

test('protected token reader rejects permissive files and accepts mode 600', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-bridge-'));
  const tokenPath = path.join(directory, 'token');
  try {
    await fs.writeFile(tokenPath, 'secret-value\n', { mode: 0o644 });
    await assert.rejects(() => readProtectedBearerToken(tokenPath), /group or other users/);
    await fs.chmod(tokenPath, 0o600);
    assert.equal(await readProtectedBearerToken(tokenPath), 'secret-value');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('bridge forwards JSON-RPC, captures the session, and rereads rotated tokens', async () => {
  const input = Readable.from([
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}\n',
    '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n',
  ]);
  const output = new PassThrough();
  let token = 'first-secret';
  const calls = [];
  const fetchImpl = async (_url, options) => {
    calls.push(options);
    if (options.method === 'GET') return response('', { status: 405 });
    if (options.method === 'DELETE') return response('', { status: 204 });
    const request = JSON.parse(options.body);
    const headers = request.id === 1 ? { 'mcp-session-id': 'session-1' } : {};
    if (request.id === 1) token = 'rotated-secret';
    return response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {} }), { headers });
  };
  const bridge = new StdioHttpMcpBridge({
    endpoint: 'https://brain.example/mcp', input, output, fetchImpl, tokenPath: '/protected/token',
    tokenReader: async () => token,
  });
  await bridge.run();
  const posts = calls.filter((call) => call.method === 'POST');
  assert.equal(posts.length, 2);
  assert.equal(posts[0].headers.authorization, 'Bearer first-secret');
  assert.equal(posts[1].headers.authorization, 'Bearer rotated-secret');
  assert.equal(posts[1].headers['mcp-session-id'], 'session-1');
  assert.equal(posts[1].headers['mcp-protocol-version'], '2025-03-26');
  assert.deepEqual(readAll(output).trim().split('\n').map(JSON.parse), [
    { jsonrpc: '2.0', id: 1, result: {} },
    { jsonrpc: '2.0', id: 2, result: {} },
  ]);
  assert.doesNotMatch(JSON.stringify(calls.map(({ body, ...call }) => call)), /secret-value/);
});

test('bridge emits streamable HTTP SSE messages as stdio JSON lines', async () => {
  const chunks = ['event: message\ndata: {"jsonrpc":"2.0",', '"id":7,"result":{"ok":true}}\n\n'];
  const messages = [];
  for await (const message of parseSseJson(Readable.from(chunks))) messages.push(message);
  assert.deepEqual(messages, [{ jsonrpc: '2.0', id: 7, result: { ok: true } }]);
});

test('remote failures return a safe JSON-RPC error without response content', async () => {
  const input = Readable.from(['{"jsonrpc":"2.0","id":9,"method":"tools/list"}\n']);
  const output = new PassThrough();
  const bridge = new StdioHttpMcpBridge({
    endpoint: 'https://brain.example/mcp', input, output, tokenPath: '/protected/token',
    tokenReader: async () => 'do-not-print-me',
    fetchImpl: async () => response('private upstream body', { status: 401 }),
  });
  await bridge.run();
  const text = readAll(output);
  assert.match(text, /HTTP 401/);
  assert.doesNotMatch(text, /do-not-print-me|private upstream body/);
});

function response(body, { status = 200, headers = {} } = {}) {
  return new Response(body || null, {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function readAll(stream) {
  const chunks = [];
  let chunk;
  while ((chunk = stream.read()) !== null) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}
