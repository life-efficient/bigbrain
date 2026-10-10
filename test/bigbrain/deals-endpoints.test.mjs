import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { startDashboard } from '../../src/bigbrain/dashboard.js';
import { startMcpServer } from '../../src/bigbrain/mcp-server.js';

test('Deals dashboard and MCP endpoints expose the same classified deals with pagination and read-only access', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-deals-endpoints-'));
  const brainHome = path.join(rootDir, 'brain');
  let dashboard;
  let mcp;
  try {
    const init = await initializeBrainHome(brainHome, { env: { ...process.env,
      BIGBRAIN_POINTER_PATH: path.join(rootDir, 'pointer'), BIGBRAIN_STATE_ROOT: path.join(rootDir, 'state') } });
    const write = async (slug, title, involvement, summary = '') => {
      const file = path.join(brainHome, `${slug}.md`);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, ['---', `title: ${title}`,
        ...(involvement ? [`deal_involvement: ${involvement}`] : []),
        ...(summary ? [`summary: ${JSON.stringify(summary)}`] : []), '---', `# ${title}`, '', 'Readable deal body.'].join('\n'));
    };
    await write('deals/active', 'Alpha Deal', 'active', 'Our active investment opportunity.');
    await write('deals/actionable', 'Beta Deal', 'network_actionable', 'A network contact may need our help.');
    await write('deals/observed', 'Gamma Deal', 'network_observed');
    await write('deals/public', 'Public transaction', 'public_unrelated');
    await write('deals/preparation', 'Buyer preparation');
    await write('deals/.raw/attachment', 'Attachment', 'active');
    const config = await loadConfig({ configPath: init.configPath });
    dashboard = await startDashboard(config, { host: '127.0.0.1', port: 0 });
    mcp = await startMcpServer({ config, host: '127.0.0.1', port: 0, authToken: 'secret', syncIntervalMs: 0 });
    const base = `http://127.0.0.1:${dashboard.address().port}`;
    const response = await fetch(`${base}/api/overlays/deals`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const payload = await response.json();
    assert.equal(payload.total, 3);
    assert.deepEqual(payload.records.map((r) => r.page_slug), ['deals/active', 'deals/actionable', 'deals/observed']);
    assert.equal(payload.records[0].summary, 'Our active investment opportunity.');
    assert.match(payload.records[2].summary, /Readable deal body/);
    for (const name of ['overlays/deals', 'overlays_deals']) {
      const result = await rpc(mcp.url, 'tools/call', { name, arguments: {} });
      assert.deepEqual(result.result.structuredContent, payload);
    }
    const listed = await rpc(mcp.url, 'tools/list', {});
    for (const name of ['overlays/deals', 'overlays_deals']) {
      const tool = listed.result.tools.find((item) => item.name === name);
      assert.ok(tool);
      assert.equal(tool.inputSchema.properties.limit.maximum, 100);
    }
    const first = await fetch(`${base}/api/overlays/deals?limit=1`).then((r) => r.json());
    assert.equal(first.next_cursor, 1);
    assert.equal(first.total, 3);
    const second = await rpc(mcp.url, 'tools/call', { name: 'overlays/deals', arguments: { limit: 1, cursor: 1 } });
    assert.equal(second.result.structuredContent.records[0].page_slug, 'deals/actionable');
    const filtered = await fetch(`${base}/api/overlays/deals?deal_involvement=network_observed`).then((r) => r.json());
    assert.equal(filtered.total, 1);
    for (const query of ['limit=0', 'limit=101', 'cursor=-1', 'limit=NaN', 'limit=', 'cursor=', 'deal_involvement=public_unrelated']) {
      assert.equal((await fetch(`${base}/api/overlays/deals?${query}`)).status, 400, query);
    }
    const invalid = await rpc(mcp.url, 'tools/call', { name: 'overlays/deals', arguments: { limit: 101 } });
    assert.ok(invalid.error || invalid.result?.isError);
    assert.equal((await fetch(`${base}/api/overlays/deals`, { method: 'POST' })).status, 405);
    const spa = await fetch(`${base}/overlays/deals`);
    assert.equal(spa.status, 200);
    assert.match(await spa.text(), /dashboard-client\.js/);
    const unauthenticated = await fetch(mcp.url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'overlays/deals', arguments: {} } }) });
    assert.equal(unauthenticated.status, 401);
  } finally {
    await mcp?.close();
    await dashboard?.close();
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test('Deals tools are available to hosted read-only tokens and reject tokens without read scope', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-deals-scopes-'));
  let running;
  try {
    const init = await initializeBrainHome(path.join(rootDir, 'brain'), { env: { ...process.env,
      BIGBRAIN_POINTER_PATH: path.join(rootDir, 'pointer'), BIGBRAIN_STATE_ROOT: path.join(rootDir, 'state') } });
    const tokenStorePath = path.join(rootDir, 'tokens.json');
    const tokens = [['bbmcp_reader', 'brain:read'], ['bbmcp_creator', 'brain:create']].map(([token, scope]) => ({
      token_hash: crypto.createHash('sha256').update(token).digest('hex'), email: 'reader@example.com',
      name: 'Reader', provider: 'google', created_at: new Date().toISOString(), last_used_at: null, revoked_at: null, scope,
    }));
    await fs.writeFile(tokenStorePath, JSON.stringify({ tokens, states: [], clients: [], codes: [] }));
    running = await startMcpServer({ config: await loadConfig({ configPath: init.configPath }),
      host: '127.0.0.1', port: 0, syncIntervalMs: 0, authConfig: {
        mode: 'oauth_allowlist', authToken: null, publicUrl: 'https://brain.example.test', provider: 'google',
        googleClientId: 'client-id', googleClientSecret: 'client-secret', allowedEmails: ['reader@example.com'],
        allowedDomains: [], tokenStorePath, allowSharedToken: false, serviceName: 'Brain', appName: 'Brain',
      } });
    const readTools = await rpc(running.url, 'tools/list', {}, 'bbmcp_reader');
    const createTools = await rpc(running.url, 'tools/list', {}, 'bbmcp_creator');
    for (const name of ['overlays/deals', 'overlays_deals']) {
      assert.ok(readTools.result.tools.some((tool) => tool.name === name));
      assert.ok(!createTools.result.tools.some((tool) => tool.name === name));
      const readable = await rpc(running.url, 'tools/call', { name, arguments: {} }, 'bbmcp_reader');
      assert.equal(readable.result.structuredContent.total, 0);
      const denied = await rpc(running.url, 'tools/call', { name, arguments: {} }, 'bbmcp_creator');
      assert.equal(denied.error.code, -32003);
    }
  } finally {
    await running?.close();
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

async function rpc(url, method, params, token = 'secret') {
  const response = await fetch(url, { method: 'POST', headers: {
    'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  assert.equal(response.status, 200);
  return response.json();
}
