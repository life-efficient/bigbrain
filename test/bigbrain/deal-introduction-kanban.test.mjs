import test from 'node:test';
import assert from 'node:assert/strict';
import { groupIntroductionsByStage, introductionStageDropTarget, saveIntroductionStage } from '../../src/dashboard-client/overlays/deal-introduction-kanban.js';
import { INTRODUCTION_STAGE_LABELS } from '../../src/dashboard-client/overlays/deal-progress.js';

const introduction = { page_slug: 'deal_introductions/supplier-customer', stage: 'proposed', stage_as_of: '2026-10-28', introduction_status: 'active', arrangement_status: 'establishing' };

test('introduction board retains every record and empty drop destinations in lifecycle order', () => {
  const records = [introduction, { page_slug: 'deal_introductions/missing' }, { page_slug: 'deal_introductions/future', stage: 'future' },
    { page_slug: 'deal_introductions/negotiating', stage: 'negotiating' }];
  const before = structuredClone(records);
  const columns = groupIntroductionsByStage(records, { includeEmpty: true });
  assert.deepEqual(columns.map(column => column.stage), Object.keys(INTRODUCTION_STAGE_LABELS));
  assert.deepEqual(columns[0].records.map(record => record.page_slug), ['deal_introductions/missing', 'deal_introductions/future']);
  assert.deepEqual(columns.flatMap(column => column.records).map(record => record.page_slug).sort(), records.map(record => record.page_slug).sort());
  assert.deepEqual(records, before);
  assert.equal(introductionStageDropTarget('introduction-stage:agreed'), 'agreed');
  assert.equal(introductionStageDropTarget('stage:agreed'), null);
  assert.equal(introductionStageDropTarget('introduction-stage:future'), null);
});

test('introduction stage movement sends its concurrency snapshot without changing arrangement', async () => {
  let request;
  const result = await saveIntroductionStage(introduction, 'introduced', async (url, options) => {
    assert.equal(url, '/api/overlays/deals/introductions/stage');
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ record: { ...introduction, stage: 'introduced', stage_as_of: '2026-10-29T12:00:00.000Z' } }) };
  });
  assert.deepEqual(request, { page_slug: introduction.page_slug, stage: 'introduced', expected_stage: 'proposed', expected_stage_as_of: '2026-10-28', expected_introduction_status: 'active' });
  assert.equal(result.record.arrangement_status, 'establishing');
  assert.equal(introduction.stage, 'proposed');
});

test('archived, invalid and same-stage introduction moves never write', async () => {
  const noWrite = () => assert.fail('Unexpected network write');
  await assert.rejects(saveIntroductionStage({ ...introduction, introduction_status: 'archived' }, 'introduced', noWrite), /Restore this introduction/);
  await assert.rejects(saveIntroductionStage(introduction, 'qualifying', noWrite), /valid introduction stage/);
  assert.deepEqual(await saveIntroductionStage(introduction, 'proposed', noWrite), { record: introduction });
});

test('conflicts and unverified stage responses cannot be treated as saved', async () => {
  await assert.rejects(saveIntroductionStage(introduction, 'introduced', async () => ({ ok: false, status: 409, json: async () => ({ error: 'Changed elsewhere' }) })), error => error.status === 409 && /Changed elsewhere/.test(error.message));
  await assert.rejects(saveIntroductionStage(introduction, 'introduced', async () => ({ ok: true, json: async () => ({ record: introduction }) })), /could not be verified/);
  await assert.rejects(saveIntroductionStage(introduction, 'introduced', async () => ({ ok: true, json: async () => ({ record: { ...introduction, stage: 'introduced', stage_as_of: null } }) })), /could not be verified/);
});
