import test from 'node:test';
import assert from 'node:assert/strict';
import { dealStage, groupDealsByStage, saveDealStage, stageDropTarget } from '../../src/dashboard-client/overlays/deal-kanban.js';
const record = { page_slug: 'deals/example', deal_stage: 'qualifying', stage_as_of: '2026-10-20' };

test('every stage remains a drop target when empty without losing unknown records', () => {
  const columns = groupDealsByStage([{ ...record, deal_stage: 'unrecognized' }], { includeEmpty: true });
  assert.equal(columns.length, 9);
  assert.equal(columns[0].records.length, 1);
  assert.ok(columns.find(c => c.stage === 'closing').records.length === 0);
  assert.equal(stageDropTarget('stage:closing'), 'closing');
  assert.equal(stageDropTarget('stage:invalid'), null);
  assert.equal(stageDropTarget('deals/example'), null);
});

test('same-stage drop makes no request', async () => {
  const result = await saveDealStage(record, 'qualifying', () => assert.fail('Unexpected write'));
  assert.equal(result.record, record);
  assert.equal(dealStage({}), 'unknown');
});

test('stage write sends concurrency snapshot and verifies returned authoritative state', async () => {
  let sent;
  const response = await saveDealStage(record, 'closing', async (url, options) => {
    assert.equal(url, '/api/overlays/deals/stage');
    sent = JSON.parse(options.body);
    return { ok: true, json: async () => ({ record: { ...record, deal_stage: 'closing', stage_as_of: '2026-10-29T12:00:00Z' } }) };
  });
  assert.deepEqual(sent, { expected_deal_status: 'active', page_slug: 'deals/example', deal_stage: 'closing', expected_deal_stage: 'qualifying', expected_stage_as_of: '2026-10-20' });
  assert.equal(response.record.deal_stage, 'closing');
  assert.equal(record.deal_stage, 'qualifying');
});

test('stale edits and malformed success cannot be mistaken for confirmed stage updates', async () => {
  await assert.rejects(saveDealStage(record, 'closing', async () => ({ ok: false, status: 409, json: async () => ({ error: 'Changed elsewhere' }) })), e => e.status === 409 && e.message === 'Changed elsewhere');
  await assert.rejects(saveDealStage(record, 'closing', async () => ({ ok: true, json: async () => ({ record: { ...record, deal_stage: 'qualifying' } }) })), /could not be verified/);
});
