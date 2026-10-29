import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { createBrainPage, updateBrainPage, readBrainPage, renameBrainPage } from '../../src/bigbrain/page-ops.js';
import { createTaskPage, updateTaskPage } from '../../src/bigbrain/task-ops.js';
import { openDatabase, sqliteRawDatabase } from '../../src/bigbrain/db.js';
import { syncBrain } from '../../src/bigbrain/sync.js';
import { buildDealsPayload } from '../../src/bigbrain/overlays/deals.js';
import { dealIntroductionSchema, dealMetadataSchema, dealMetadataFields, waitingOnSchema } from '../../src/bigbrain/deal-schema.js';

const provenance = { event_id: 'test-introduction', source_type: 'assistant_chat', source_label: 'Test', source_message: 'Record an evidenced commercial introduction.' };

test('typed descriptions separate external asks from existing-party dependencies and validate stages', () => {
  assert.match(dealMetadataFields().anonymised_asks.description, /Excludes documents/);
  assert.match(dealMetadataFields().anonymised_asks.description, /empty array/);
  assert.equal(dealMetadataSchema.safeParse({ anonymised_asks: [], deal_types: ['compute_brokerage'] }).success, true);
  assert.equal(dealMetadataSchema.safeParse({ deal_types: ['fundraising_everything'] }).success, false);
  assert.equal(waitingOnSchema.safeParse(['organizations/vendor']).success, true);
  assert.equal(waitingOnSchema.safeParse(['tasks/follow-up']).success, false);
  const baseline = { deal: 'deals/compute', parties: ['organizations/vendor', 'organizations/customer'], purpose: 'Compute supply', stage: 'proposed' };
  assert.equal(dealIntroductionSchema.safeParse(baseline).success, true);
  for (const patch of [{ deal: '../deals/compute' }, { parties: ['organizations/vendor'] }, { parties: ['organizations/vendor', 'organizations/vendor'] }, { stage: 'active' }, { purpose: '' }, { stage_as_of: 'yesterday' }, { stage_as_of: '2026-02-30' }, { stage_as_of: '2026-10-29T99:00:00Z' }]) {
    assert.equal(dealIntroductionSchema.safeParse({ ...baseline, ...patch }).success, false);
  }
});

test('introductions index as graph pages, nest under deals and derive dependencies from linked tasks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-introductions-'));
  let db;
  try {
    const init = await initializeBrainHome(path.join(root, 'brain'), { env: { ...process.env, BIGBRAIN_POINTER_PATH: path.join(root, 'pointer'), BIGBRAIN_STATE_ROOT: path.join(root, 'state') } });
    const config = await loadConfig({ configPath: init.configPath });
    // Simulate an older persisted config that does not list the new collection.
    config.schemaDirs = config.schemaDirs.filter(p => p !== 'deal_introductions');
    const create = (slug, frontmatter = {}) => createBrainPage({ config, pagePath: slug, title: slug.split('/').at(-1), summary: 'Evidenced commercial context.', body: 'Current substantive commercial context.', frontmatter, timelineEntry: 'Recorded supported context.', timelineProvenance: provenance });
    await create('deals/compute', { deal_involvement: 'active', deal_types: ['compute_brokerage'], deal_stage: 'qualifying', anonymised_asks: [] });
    await create('organizations/vendor');
    await create('organizations/customer');
    await assert.rejects(create('deal_introductions/missing', { deal: 'deals/missing', parties: ['organizations/vendor', 'organizations/customer'], purpose: 'Supply compute', stage: 'proposed' }), /reference does not exist/);
    const intro = await create('deal_introductions/vendor-customer', { deal: 'deals/compute', parties: ['organizations/vendor', 'organizations/customer'], purpose: 'Supply compute', stage: 'discussing', stage_as_of: '2026-10-29' });
    assert.equal(intro.type, 'deal_introductions');
    db = await openDatabase(config);
    const task = await createTaskPage({ config, db, path: 'tasks/confirm-capacity', title: 'Confirm capacity', body: 'Confirm available compute with the vendor.', status: 'waiting', source: ['deal_introductions/vendor-customer'], waitingOn: ['organizations/vendor'], timelineEntry: 'Record capacity follow-up.', timelineProvenance: provenance });
    assert.deepEqual(task.waiting_on, ['organizations/vendor']);
    await createTaskPage({ config, db, path: 'tasks/confirm-requirement', title: 'Confirm requirement', body: 'Ask the customer for the requirement.', source: ['deals/compute'], timelineEntry: 'Record qualification follow-up.', timelineProvenance: provenance });
    await syncBrain({ config, apiKey: null });
    const raw = sqliteRawDatabase(db);
    assert.equal(raw.prepare('SELECT type FROM pages WHERE slug = ?').get(intro.slug).type, 'deal_introductions');
    const edges = raw.prepare('SELECT * FROM links WHERE from_slug = ?').all(intro.slug);
    assert.deepEqual(new Set(edges.map(e => e.to_slug)), new Set(['deals/compute', 'organizations/vendor', 'organizations/customer']));
    const payload = await buildDealsPayload(config, db);
    assert.equal(payload.total, 1);
    const deal = payload.records[0];
    assert.deepEqual(deal.deal_types, ['compute_brokerage']);
    assert.equal(deal.deal_stage, 'qualifying');
    assert.equal(deal.tasks[0].title, 'Confirm requirement');
    assert.equal(deal.introductions.length, 1);
    assert.deepEqual(deal.introductions[0].parties, [{ page_slug: 'organizations/vendor', title: 'vendor' }, { page_slug: 'organizations/customer', title: 'customer' }]);
    assert.deepEqual(deal.introductions[0].tasks[0].waiting_on, [{ page_slug: 'organizations/vendor', title: 'vendor' }]);
    await updateTaskPage({ config, db, path: task.slug, waitingOn: [], status: 'done', timelineEntry: 'Capacity received. No successor task needed: qualification complete.', timelineProvenance: provenance });
    await syncBrain({ config, apiKey: null });
    assert.equal((await buildDealsPayload(config, db)).records[0].introductions[0].tasks.length, 0);
    assert.deepEqual((await readBrainPage({ config, pagePath: task.slug })).frontmatter.waiting_on, []);
    const before = await readBrainPage({ config, pagePath: intro.slug });
    await assert.rejects(updateBrainPage({ config, pagePath: intro.slug, frontmatterValues: { parties: ['organizations/missing', 'organizations/customer'] }, timelineEntry: 'Invalid reference', timelineProvenance: provenance }), /reference does not exist/);
    assert.equal((await readBrainPage({ config, pagePath: intro.slug })).markdown, before.markdown);
    await renameBrainPage({ config, fromPagePath: intro.slug, toPagePath: 'deal_introductions/renamed', timelineEntry: 'Clarified introduction name.', timelineProvenance: provenance });
    assert.deepEqual((await readBrainPage({ config, pagePath: task.slug })).frontmatter.source, ['deal_introductions/renamed']);
    await renameBrainPage({ config, fromPagePath: 'organizations/vendor', toPagePath: 'organizations/supplier', timelineEntry: 'Clarified party name.', timelineProvenance: provenance });
    assert.deepEqual((await readBrainPage({ config, pagePath: 'deal_introductions/renamed' })).frontmatter.parties, ['organizations/supplier', 'organizations/customer']);
    await renameBrainPage({ config, fromPagePath: 'deals/compute', toPagePath: 'deals/capacity', timelineEntry: 'Clarified deal name.', timelineProvenance: provenance });
    assert.equal((await readBrainPage({ config, pagePath: 'deal_introductions/renamed' })).frontmatter.deal, 'deals/capacity');

  } finally {
    db?.raw?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
