import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { startDashboard } from '../../src/bigbrain/dashboard.js';
import { updateDealAsks } from '../../src/bigbrain/overlays/deals.js';
import { readBrainPage } from '../../src/bigbrain/page-ops.js';

test('Deal asks edits persist in canonical frontmatter, refresh the index and preserve other page content', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deal-asks-edit-'));
  let server;
  try {
    const init = await initializeBrainHome(path.join(root, 'brain'), { env: { ...process.env,
      BIGBRAIN_POINTER_PATH: path.join(root, 'pointer'), BIGBRAIN_STATE_ROOT: path.join(root, 'state') } });
    const config = await loadConfig({ configPath: init.configPath });
    await fs.mkdir(path.join(config.brainDir, 'deals'), { recursive: true });
    for (const [slug, involvement] of [['sample', 'active'], ['public', 'public_unrelated']]) {
      await fs.writeFile(path.join(config.brainDir, 'deals', `${slug}.md`), `---\ntitle: Sample\ndeal_involvement: ${involvement}\nsummary: Internal summary\ncustom_field: Preserve me\nasks:\n  - Find investor\nteaser_summary: Anonymous opportunity\n---\n# Sample\n\nPreserve this body.\n\n---\n\n## Timeline\n\n`);
    }
    server = await startDashboard(config, { host: '127.0.0.1', port: 0 });
    const base = `http://127.0.0.1:${server.address().port}`;
    const before = await readBrainPage({ config, pagePath: 'deals/sample' });
    const baseline = { page_slug: 'deals/sample', expected_asks: ['Find investor'], expected_teaser_summary: 'Anonymous opportunity' };
    const post = (data) => fetch(`${base}/api/overlays/deals/asks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const simultaneous = await Promise.all([post({ ...baseline, asks: ['Find operator'], teaser_summary: 'Anonymous updated' }), post({ ...baseline, asks: ['Find buyer'] })]);
    assert.deepEqual(simultaneous.map((r) => r.status).sort(), [200, 409]);
    const successful = await simultaneous.find((r) => r.status === 200).json();
    assert.ok(successful.record);
    const after = await readBrainPage({ config, pagePath: 'deals/sample' });
    assert.deepEqual(after.frontmatter.asks, successful.record.asks);
    assert.equal(after.frontmatter.teaser_summary, successful.record.teaser_summary);
    assert.equal(after.frontmatter.custom_field, before.frontmatter.custom_field);
    assert.equal(after.frontmatter.summary, before.frontmatter.summary);
    assert.equal(after.body, before.body);
    assert.match(after.timeline, /Updated anonymous deal asks and teaser/);
    assert.match(after.timeline, /direct_edit/);
    const indexed = await fetch(`${base}/api/overlays/deals`).then((r) => r.json());
    assert.deepEqual(indexed.records[0], successful.record);
    const refreshed = { page_slug: 'deals/sample', expected_asks: successful.record.asks, expected_teaser_summary: successful.record.teaser_summary };
    const deleteAll = await post({ ...refreshed, asks: [] });
    assert.equal(deleteAll.status, 200);
    assert.deepEqual((await deleteAll.json()).record.asks, []);
    for (const changes of [{ asks: [3] }, { asks: [''] }, { asks: 'bad' }, { page_slug: '../people/sample' }, { expected_asks: null }, { teaser_summary: 5 }]) {
      assert.equal((await post({ ...baseline, asks: ['Valid'], ...changes })).status, 400);
    }
    assert.equal((await post({ ...baseline, page_slug: 'deals/public', asks: [] })).status, 404);
    assert.equal((await post({ ...baseline, page_slug: 'deals/missing', asks: [] })).status, 404);
    assert.equal((await fetch(`${base}/api/overlays/deals/asks`)).status, 405);
    assert.equal((await fetch(`${base}/api/overlays/deals/asks`, { method: 'POST', body: '{bad' })).status, 400);
  } finally {
    await server?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Deal ask mutation rejects read-only and create-only actors before accessing a page', async () => {
  for (const scopes of [['brain:read'], ['brain:create']]) {
    await assert.rejects(updateDealAsks({}, null, {}, { actor: { scopes } }), { statusCode: 403 });
  }
});
