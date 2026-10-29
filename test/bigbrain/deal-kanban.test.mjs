import test from 'node:test';
import assert from 'node:assert/strict';
import { groupDealsByStage } from '../../src/dashboard-client/overlays/deal-kanban.js';
import { matchesDealFilters } from '../../src/dashboard-client/overlays/deal-progress.js';

test('kanban preserves every record once and groups in workflow order without empty columns', () => {
  const records = [{ page_slug: 'deals/a', deal_stage: 'negotiating' }, { page_slug: 'deals/b', deal_stage: 'qualifying' },
    { page_slug: 'deals/c' }, { page_slug: 'deals/d', deal_stage: 'future-stage' }, { page_slug: 'deals/e', deal_stage: 'qualifying' }];
  const before = structuredClone(records);
  const columns = groupDealsByStage(records);
  assert.deepEqual(columns.map(column => column.stage), ['unknown', 'qualifying', 'negotiating']);
  assert.deepEqual(columns[0].records.map(record => record.page_slug), ['deals/c', 'deals/d']);
  assert.deepEqual(columns.flatMap(column => column.records.map(record => record.page_slug)).sort(), records.map(record => record.page_slug).sort());
  assert.deepEqual(records, before);
  assert.deepEqual(groupDealsByStage([]), []);
});

test('kanban counts and cards reflect the same filtered deal set as list view', () => {
  const records = [{ title: 'Compute buyer', deal_stage: 'negotiating', deal_types: ['compute_brokerage'] },
    { title: 'Compute provider', deal_stage: 'qualifying', deal_types: ['compute_brokerage'] },
    { title: 'Capital raise', deal_stage: 'negotiating', deal_types: ['capital_raise'] }];
  const filtered = records.filter(record => matchesDealFilters(record, { search: 'compute', stage: 'negotiating', dealType: 'compute_brokerage' }));
  const columns = groupDealsByStage(filtered);
  assert.equal(columns.length, 1);
  assert.equal(columns[0].stage, 'negotiating');
  assert.deepEqual(columns[0].records, [records[0]]);
});
