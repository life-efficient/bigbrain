import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { startMcpServer } from '../../src/bigbrain/mcp-server.js';

test('MCP Substack workflow and shared ledger work without shell or arbitrary filesystem access', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-mcp-substack-'));
  const previous = process.env.BIGBRAIN_SUBSTACK_LEDGER_PATH;
  process.env.BIGBRAIN_SUBSTACK_LEDGER_PATH = path.join(root, 'shared-ledger.sqlite');
  let server;
  try {
    const initialized = await initializeBrainHome(path.join(root, 'brain'), { env: { ...process.env, BIGBRAIN_POINTER_PATH: path.join(root, 'pointer'), BIGBRAIN_STATE_ROOT: path.join(root, 'state') } });
    const config = await loadConfig({ configPath: initialized.configPath });
    server = await startMcpServer({ config, host: '127.0.0.1', port: 0, authToken: 'test-secret', syncIntervalMs: 0 });
    const rpc = async (method, params) => {
      const response = await fetch(server.url, { method: 'POST', headers: { authorization: 'Bearer test-secret', 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      return response.json();
    };
    const call = async (name, args) => {
      const response = await rpc('tools/call', { name, arguments: args });
      assert.equal(response.error, undefined, JSON.stringify(response.error));
      return response.result.structuredContent;
    };
    const ledger = (operation, input = {}) => call('substack/ledger', { operation, input });
    const rejected = async args => assert.ok((await rpc('tools/call', { name: 'substack/ledger', arguments: args })).error);
    const listed = await rpc('tools/list', {});
    for (const name of ['substack/workflow', 'substack_workflow', 'substack/ledger', 'substack_ledger', 'rss/workflow', 'rss_workflow', 'rss/ledger', 'rss_ledger']) assert.ok(listed.result.tools.some(tool => tool.name === name));
    const workflow = await call('substack/workflow', {});
    assert.equal(workflow.documents.length, 6);
    assert.ok(workflow.documents.some(doc => doc.name.endsWith('ingestion-completeness.md') && doc.content.includes('saved Brain state')));
    assert.match(workflow.instruction, /Never open TextEdit/);
    assert.deepEqual(await call('substack_workflow', {}), workflow);
    assert.ok((await rpc('tools/call', { name: 'substack/workflow', arguments: { path: '/etc/passwd' } })).error);
    assert.equal((await ledger('status')).exists, false);
    await assert.rejects(fs.stat(process.env.BIGBRAIN_SUBSTACK_LEDGER_PATH), { code: 'ENOENT' });
    await rejected({ operation: 'status', input: {}, ledgerPath: '/tmp/forbidden.sqlite' });
    await rejected({ operation: 'status', input: { ledgerPath: '/tmp/forbidden.sqlite' } });
    await rejected({ operation: 'close', input: {} });
    await rejected({ operation: 'status', input: { limit: '5' } });

    const publicationUrl = 'https://publisher.substack.com';
    const url = `${publicationUrl}/p/one`;
    await ledger('publication-upsert', { publicationUrl, feedUrl: `${publicationUrl}/feed`, title: 'Publisher' });
    await ledger('discover', { publicationUrl, url, publishedAt: '2026-09-01T10:00:00Z', title: 'One', channel: 'rss' });
    assert.equal((await call('substack_ledger', { operation: 'status', input: { url } })).posts[0].outcome, 'pending');
    const claims = await Promise.all([ledger('claim', { url, owner: 'rss' }), ledger('claim', { url, owner: 'email' })]);
    assert.equal(claims.filter(result => result.claimed).length, 1);
    let leaseToken = claims.find(result => result.claimed).leaseToken;
    await ledger('renew', { url, leaseToken, leaseSeconds: 3600 });
    const verification = { readBack: true, verifiedAt: new Date(Date.now() - 1000).toISOString(), brainId: config.brainId, paths: ['sources/one.md'], evidence: 'Same-Brain source read-back.' };
    await rejected({ operation: 'complete', input: { url, leaseToken, outcome: 'verified_noop', verification: { ...verification, brainId: 'another-brain' } } });
    await rejected({ operation: 'complete', input: { url, leaseToken, outcome: 'verified_noop', verification: { ...verification, paths: ['../other-brain/source.md'] } } });
    assert.equal((await ledger('status', { url })).posts[0].outcome, 'processing');
    await ledger('release', { url, leaseToken, reason: 'Temporary source access failure.' });
    await ledger('retry', { url, reason: 'Source access restored.' });
    leaseToken = (await ledger('claim', { url, owner: 'browser' })).leaseToken;
    await ledger('complete', { url, leaseToken, outcome: 'verified_noop', verification });
    await ledger('scan-checkpoint', { publicationUrl, channel: 'browser', through: '2026-09-02T10:00:00Z', oldestSeenAt: '2026-09-01T10:00:00Z', newestSeenAt: '2026-09-01T10:00:00Z' });
    const status = await ledger('status', { publicationUrl });
    assert.equal(status.posts[0].verification.brainId, config.brainId);
    assert.equal(status.publications[0].filed_high_watermark, '2026-09-01T10:00:00.000Z');
    assert.equal(status.scans[0].channel, 'browser');
    assert.equal((await ledger('claim', { url, owner: 'email-after-rss' })).claimed, false);
    const rssWorkflow = await call('rss/workflow', {});
    assert.equal(rssWorkflow.documents.length, 5);
    assert.ok(rssWorkflow.documents.some(doc => doc.name.endsWith('rss-ledger.md')));
    assert.match(rssWorkflow.instruction, /Never open TextEdit/);
    assert.deepEqual(await call('rss_workflow', {}), rssWorkflow);
    assert.ok((await rpc('tools/call', { name: 'rss/workflow', arguments: { path: '/etc/passwd' } })).error);
    const rss = (operation, input = {}) => call('rss/ledger', { operation, input });
    const rssRejected = async args => assert.ok((await rpc('tools/call', { name: 'rss/ledger', arguments: args })).error);
    await rssRejected({ operation: 'status', input: { ledgerPath: '/tmp/forbidden.sqlite' } });
    await rssRejected({ operation: 'status', input: {}, ledgerPath: '/tmp/forbidden.sqlite' });
    await rss('feed-upsert', { feedId: 'generic', feedUrl: 'https://feeds.example/feed', title: 'Generic feed' });
    const genericUrl = 'https://articles.example/?post=1';
    await rss('discover', { feedId: 'generic', url: genericUrl, publishedAt: '2026-09-02T00:00:00Z', title: 'Generic article', channel: 'rss' });
    const rssClaim = await rss('claim', { url: genericUrl, owner: 'rss' });
    await rssRejected({ operation: 'complete', input: { url: genericUrl, leaseToken: rssClaim.leaseToken, outcome: 'source_only', verification: { ...verification, brainId: 'another-brain' } } });
    await rssRejected({ operation: 'complete', input: { url: genericUrl, leaseToken: rssClaim.leaseToken, outcome: 'source_only', verification: { ...verification, paths: ['../another-brain/source.md'] } } });
    assert.equal((await rss('status', { feedId: 'generic' })).feeds[0].filed_high_watermark, null);
    await rss('complete', { url: genericUrl, leaseToken: rssClaim.leaseToken, outcome: 'source_only', verification });
    const rssState = await call('rss_ledger', { operation: 'status', input: { feedId: 'generic' } });
    assert.equal(rssState.feeds[0].filed_high_watermark, '2026-09-02T00:00:00.000Z');
    assert.equal(rssState.feeds[0].outstanding_count, 0);
    assert.equal((await rss('claim', { url: genericUrl, owner: 'email-after-rss' })).claimed, false);

  } finally {
    await server?.close();
    if (previous === undefined) delete process.env.BIGBRAIN_SUBSTACK_LEDGER_PATH;
    else process.env.BIGBRAIN_SUBSTACK_LEDGER_PATH = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
});
