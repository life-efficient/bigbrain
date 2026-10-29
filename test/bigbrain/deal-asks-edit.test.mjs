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
      await fs.writeFile(path.join(config.brainDir, 'deals', `${slug}.md`), `---\ntitle: Sample\ndeal_involvement: ${involvement}\nsummary: Internal summary\ncustom_field: Preserve me\nasks:\n  - Find investor\nteaser_summary: >-\n  Anonymous\n  opportunity\nretained_list:\n  - one\n  - two\n---\n# Sample\n\nPreserve this body.\n\n---\n\n## Timeline\n\n`);
    }
    server = await startDashboard(config, { host: '127.0.0.1', port: 0 });
    const base = `http://127.0.0.1:${server.address().port}`;
    const before = await readBrainPage({ config, pagePath: 'deals/sample' });
    const baseline = { expected_anonymised_title: '', page_slug: 'deals/sample', expected_anonymised_asks: ['Find investor'], expected_anonymised_description: 'Anonymous opportunity' };
    const post = (data) => fetch(`${base}/api/overlays/deals/asks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const simultaneous = await Promise.all([post({ ...baseline, anonymised_asks: ['Find investor', 'Find operator, developer: [experienced]'], anonymised_description: 'Anonymous updated' }), post({ ...baseline, anonymised_asks: ['Find buyer'], anonymised_description: 'Anonymous opportunity' })]);
    assert.deepEqual(simultaneous.map((r) => r.status).sort(), [200, 409]);
    const successful = await simultaneous.find((r) => r.status === 200).json();
    assert.ok(successful.record);
    const after = await readBrainPage({ config, pagePath: 'deals/sample' });
    assert.deepEqual(after.frontmatter.anonymised_asks, successful.record.anonymised_asks);
    assert.equal(after.frontmatter.anonymised_description, successful.record.anonymised_description);
    assert.equal(Object.hasOwn(after.frontmatter, 'asks'), false);
    assert.equal(Object.hasOwn(after.frontmatter, 'teaser_summary'), false);
    assert.equal(after.frontmatter.custom_field, before.frontmatter.custom_field);
    assert.deepEqual(after.frontmatter.retained_list, ['one', 'two']);
    assert.equal(after.frontmatter.deal_involvement, 'active');
    assert.doesNotMatch(after.frontmatter_raw, /  - Find investor|  Anonymous|  opportunity/);
    assert.equal(after.frontmatter.summary, before.frontmatter.summary);
    assert.equal(after.body, before.body);
    assert.match(after.timeline, /Updated anonymous deal asks and teaser/);
    assert.match(after.timeline, /direct_edit/);
    const indexed = await fetch(`${base}/api/overlays/deals`).then((r) => r.json());
    assert.deepEqual(indexed.records[0], successful.record);
    const refreshed = { expected_anonymised_title: successful.record.anonymised_title, page_slug: 'deals/sample', expected_anonymised_asks: successful.record.anonymised_asks, expected_anonymised_description: successful.record.anonymised_description };
    const complexAsks = ['Find investor', 'Lenders for construction, permits, and equipment', 'An operator: "experienced" [preferred]'];
    const complexResponse = await post({ ...refreshed, anonymised_asks: complexAsks, anonymised_title: 'New anonymous title', anonymised_description: 'A "quoted" teaser\nwith a second line.' });
    assert.equal(complexResponse.status, 200);
    const complexRecord = (await complexResponse.json()).record;
    assert.deepEqual(complexRecord.anonymised_asks, complexAsks);
    assert.equal(complexRecord.anonymised_title, 'New anonymous title');
    assert.equal((await post({ ...refreshed, expected_anonymised_asks: complexAsks, expected_anonymised_description: complexRecord.anonymised_description, anonymised_asks: complexAsks })).status, 409);
    const complexPage = await readBrainPage({ config, pagePath: 'deals/sample' });
    assert.deepEqual(complexPage.frontmatter.anonymised_asks, complexAsks);
    assert.equal(complexPage.frontmatter.anonymised_description, 'A "quoted" teaser\nwith a second line.');
    const deleteAll = await post({ expected_anonymised_title: complexRecord.anonymised_title, page_slug: 'deals/sample', expected_anonymised_asks: complexRecord.anonymised_asks,
      expected_anonymised_description: complexRecord.anonymised_description, anonymised_asks: [] });
    assert.equal(deleteAll.status, 200);
    assert.deepEqual((await deleteAll.json()).record.anonymised_asks, []);
    for (const changes of [{ anonymised_asks: [3] }, { anonymised_asks: [''] }, { anonymised_asks: 'bad' }, { page_slug: '../people/sample' }, { expected_anonymised_asks: null }, { anonymised_description: 5 }, { anonymised_title: 5 }, { anonymised_title: 'a'.repeat(501) }, { expected_anonymised_title: null }]) {
      assert.equal((await post({ ...baseline, anonymised_asks: ['Valid'], ...changes })).status, 400);
    }
    assert.equal((await post({ ...baseline, page_slug: 'deals/public', anonymised_asks: [] })).status, 404);
    assert.equal((await post({ ...baseline, page_slug: 'deals/missing', anonymised_asks: [] })).status, 404);
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
