import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { openDatabase, getPageRecord } from '../../src/bigbrain/db.js';
import { startMcpServer } from '../../src/bigbrain/mcp-server.js';

test('MCP server lists tools and writes pages through tools/call', async () => {
  const fixture = await createFixture('bigbrain-mcp-server-');
  let running;
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    running = await startMcpServer({
      config,
      host: '127.0.0.1',
      port: 0,
      authToken: 'secret',
      syncIntervalMs: 0,
      gitBackupEnabled: false,
    });

    const listed = await rpc(running.url, 'tools/list', {}, 'secret');
    assert.equal(listed.result.tools.some((tool) => tool.name === 'create_page'), true);

    const unauthorized = await fetch(running.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    assert.equal(unauthorized.status, 401);

    const created = await rpc(running.url, 'tools/call', {
      name: 'create_page',
      arguments: {
        path: 'people/mcp-test',
        title: 'MCP Test',
        body: 'Created through the MCP server.',
        timeline_entry: 'Created through MCP endpoint test.',
      },
    }, 'secret');

    assert.equal(created.error, undefined, created.error?.message);
    assert.equal(created.result.structuredContent.slug, 'people/mcp-test');
    assert.match(created.result.structuredContent.markdown, /Created through MCP endpoint test/);

    const db = await openDatabase(config);
    const record = getPageRecord(db, 'people/mcp-test');
    assert.equal(record.title, 'MCP Test');
    assert.match(record.compiled_truth, /Created through the MCP server/);
  } finally {
    if (running) await running.close();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

async function rpc(url, method, params, token) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function createFixture(prefix) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const brainHome = path.join(rootDir, 'brain');
  const env = {
    ...process.env,
    BIGBRAIN_POINTER_PATH: path.join(rootDir, 'pointer'),
    BIGBRAIN_STATE_ROOT: path.join(rootDir, 'state'),
  };
  const init = await initializeBrainHome(brainHome, { env });
  return { rootDir, brainHome, configPath: init.configPath };
}
