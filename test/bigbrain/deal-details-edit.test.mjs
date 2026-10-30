import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { startDashboard } from '../../src/bigbrain/dashboard.js';
import { readBrainPage } from '../../src/bigbrain/page-ops.js';
import { openDatabase, replacePageIndex } from '../../src/bigbrain/db.js';
import { parseMarkdownPage } from '../../src/bigbrain/markdown.js';
import { updateDealDetails } from '../../src/bigbrain/overlays/deals.js';

async function fixture(run) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deal-details-'));
 let server, db;
 try {
  const init = await initializeBrainHome(path.join(root, 'brain'), { env: { ...process.env, BIGBRAIN_POINTER_PATH: path.join(root, 'pointer'), BIGBRAIN_STATE_ROOT: path.join(root, 'state') } });
  const config = await loadConfig({ configPath: init.configPath });
  for (const folder of ['deals', 'deal_introductions', 'organizations']) await fs.mkdir(path.join(config.brainDir, folder), { recursive: true });
  await fs.writeFile(path.join(config.brainDir, 'deals/sample.md'), '---\ntitle: Sample\nsummary: Internal summary\ndeal_involvement: active\ndeal_stage: qualifying\nstage_as_of: 2026-10-20\nanonymised_title: Shareable title\nanonymised_description: Shareable description\nanonymised_asks: []\ncustom_field: Preserve me\n---\n# Sample\n\nSubstantive body with [party](../organizations/party.md).\n\n---\n\n## Timeline\n\n');
  await fs.writeFile(path.join(config.brainDir, 'deal_introductions/sample.md'), '---\ntitle: Introduction\nsummary: Internal route\ndeal: deals/sample\nparties: [organizations/a, organizations/b]\npurpose: Supply compute\nstage: discussing\nstage_as_of: 2026-10-20\narrangement_status: none\n---\n# Introduction\n\nOriginal introduction body.\n\n---\n\n## Timeline\n\n');
  for (const slug of ['a', 'b']) await fs.writeFile(path.join(config.brainDir, 'organizations', slug + '.md'), `---\ntitle: ${slug}\n---\n# ${slug}\n\nOrganization.\n\n---\n\n## Timeline\n`);
  db = await openDatabase(config);
  for (const slug of ['deals/sample', 'deal_introductions/sample']) {
    const file = path.join(config.brainDir, slug + '.md');
    await replacePageIndex(db, { ...parseMarkdownPage(await fs.readFile(file, 'utf8'), slug), path: file, contentHash: 'fixture', pageKind: 'canonical', updatedAt: new Date().toISOString() });
  }
  server = await startDashboard(config, { host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = input => fetch(base + '/api/overlays/deals/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  await run({ config, base, post });
 } finally { await server?.close(); db?.raw?.close(); await db?.close?.(); await fs.rm(root, { recursive: true, force: true }); }
}

test('deal modal edits persist atomically, update heading, preserve unrelated content and reject stale edits', async () => fixture(async ({ config, base, post }) => {
 const record = (await fetch(base + '/api/overlays/deals').then(r => r.json())).records[0];
 assert.equal(record.edit_values.summary, 'Internal summary');
 const before = await readBrainPage({ config, pagePath: record.page_slug });
 const values = { ...record.edit_values, title: 'Renamed sample', summary: 'New internal description', anonymised_title: 'New blind title', anonymised_description: 'New blind description', anonymised_asks: ['Seeking compute buyers.'], anonymised_stage_comment: 'The owner is confirming the power allocation.' };
 const input = { page_slug: record.page_slug, expected_deal_stage: record.deal_stage, expected_stage_as_of: record.stage_as_of, expected_values: record.edit_values, values };
 assert.equal((await post({ ...input, expected_deal_stage: 'negotiating' })).status, 409);
 const responses = await Promise.all([post(input), post({ ...input, values: { ...values, title: 'Competing edit' } })]);
 assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
 const saved = (await responses.find(r => r.status === 200).json()).record;
 const after = await readBrainPage({ config, pagePath: record.page_slug });
 assert.equal(after.title, saved.title);
 assert.match(after.markdown, new RegExp('# ' + saved.title));
 assert.equal(after.body, before.body.replace(/^# .+$/m, '# ' + after.title));
 assert.equal(after.frontmatter.custom_field, 'Preserve me');
 assert.equal(after.frontmatter.deal_stage, 'qualifying');
 assert.equal(after.frontmatter.stage_as_of, '2026-10-20');
 assert.equal(after.summary, values.summary);
 assert.equal(after.frontmatter.anonymised_stage_comment, values.anonymised_stage_comment);
 assert.deepEqual(after.frontmatter.anonymised_asks, values.anonymised_asks);
 const indexed = (await fetch(base + '/api/overlays/deals').then(r => r.json())).records[0];
 assert.deepEqual(indexed.edit_values, saved.edit_values);
 assert.equal((await post({ ...input, values: { ...values, stage: 'closed' } })).status, 400);
 assert.equal((await post({ ...input, page_slug: 'deals/../sample' })).status, 400);
}));

test('introduction modal edits purpose and arrangement without changing parent, stage, evidence date or body', async () => fixture(async ({ config, base, post }) => {
 const record = (await fetch(base + '/api/overlays/deals/introductions').then(r => r.json())).records[0];
 assert.equal(record.edit_values.purpose, 'Supply compute');
 const before = await readBrainPage({ config, pagePath: record.page_slug });
 const values = { title: 'Updated introduction', purpose: 'Supply managed compute', arrangement_status: 'establishing' };
 const input = { page_slug: record.page_slug, expected_values: record.edit_values, values };
 const response = await post(input); assert.equal(response.status, 200);
 const after = await readBrainPage({ config, pagePath: record.page_slug });
 assert.equal(after.title, values.title); assert.equal(after.body, before.body.replace(/^# .+$/m, '# ' + after.title));
 assert.equal(after.frontmatter.purpose, values.purpose); assert.equal(after.frontmatter.arrangement_status, values.arrangement_status);
 assert.equal(after.frontmatter.deal, 'deals/sample'); assert.equal(after.frontmatter.stage, 'discussing'); assert.equal(after.frontmatter.stage_as_of, '2026-10-20');
 assert.equal((await post(input)).status, 409);
 assert.equal((await post({ ...input, values: { ...values, purpose: '' } })).status, 400);
 assert.equal((await fetch(base + '/api/overlays/deals/edit')).status, 405);
}));

test('read-only actors cannot edit details', async () => {
 await assert.rejects(updateDealDetails({}, null, {}, { actor: { scopes: ['brain:read'] } }), { statusCode: 403 });
});
