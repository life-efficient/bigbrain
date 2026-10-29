import test from 'node:test';
import assert from 'node:assert/strict';
import { recordStatus, saveRecordStatus } from '../../src/dashboard-client/overlays/deal-status.js';
import { matchesDealFilters, matchesIntroductionFilters, DEAL_STAGE_LABELS, INTRODUCTION_STAGE_LABELS } from '../../src/dashboard-client/overlays/deal-progress.js';
import { saveDealStage } from '../../src/dashboard-client/overlays/deal-kanban.js';

test('status filters are independent of stage and parent status', () => {
  const deal = { deal_status: 'archived', deal_stage: 'qualifying' };
  assert.equal(matchesDealFilters(deal, { status: 'active' }), false);
  assert.equal(matchesDealFilters(deal, { status: 'archived', stage: 'qualifying' }), true);
  assert.equal(matchesDealFilters(deal, { status: 'all' }), true);
  const introduction = { introduction_status: 'active', stage: 'discussing', parent_deal: deal };
  assert.equal(matchesIntroductionFilters(introduction, { status: 'active', stage: 'discussing' }), true);
  assert.equal(matchesIntroductionFilters(introduction, { status: 'archived' }), false);
  assert.equal(recordStatus({ deal_stage: 'paused' }), 'archived');
  assert.equal(recordStatus({ deal_status: 'active', deal_stage: 'qualifying' }), 'active');
  assert.equal(DEAL_STAGE_LABELS.establishing_arrangement, 'Establishing arrangement');
  assert.equal(DEAL_STAGE_LABELS.paused, undefined);
  assert.equal(DEAL_STAGE_LABELS.dropped, undefined);
  assert.equal(INTRODUCTION_STAGE_LABELS.paused, undefined);
});

test('archive and restore carry concurrency guards without changing stages', async () => {
  for (const introduction of [false, true]) {
    const statusField = introduction ? 'introduction_status' : 'deal_status';
    const stageField = introduction ? 'stage' : 'deal_stage';
    let record = { page_slug: introduction ? 'deal-introductions/a' : 'deals/a', [statusField]: 'active', [stageField]: 'negotiating', stage_as_of: '2026-10-29' };
    for (const status of ['archived', 'active']) {
      const data = await saveRecordStatus(record, status, introduction, async (url, options) => {
        assert.equal(url, '/api/overlays/deals/status');
        assert.deepEqual(JSON.parse(options.body), { page_slug: record.page_slug, status, expected_status: record[statusField], expected_stage: 'negotiating', expected_stage_as_of: '2026-10-29' });
        return { ok: true, json: async () => ({ record: { ...record, [statusField]: status } }) };
      });
      record = data.record;
    }
  }
});

test('status conflicts surface to caller and unverifiable changes are rejected', async () => {
  const record = { page_slug: 'deals/a', deal_stage: 'qualifying' };
  await assert.rejects(saveRecordStatus(record, 'archived', false, async () => ({ ok: false, status: 409, json: async () => ({ error: 'Changed elsewhere' }) })), error => error.status === 409);
  await assert.rejects(saveRecordStatus(record, 'archived', false, async () => ({ ok: true, json: async () => ({ record: { ...record, deal_status: 'archived', deal_stage: 'negotiating' } }) })), /could not be verified/);
});

test('archived cards cannot change stage and active moves include status guard', async () => {
  const record = { page_slug: 'deals/a', deal_status: 'archived', deal_stage: 'qualifying' };
  await assert.rejects(saveDealStage(record, 'negotiating', () => assert.fail('Must not send')), /Restore/);
  await saveDealStage({ ...record, deal_status: 'active' }, 'establishing_arrangement', async (_, options) => {
    assert.equal(JSON.parse(options.body).expected_deal_status, 'active');
    return { ok: true, json: async () => ({ record: { ...record, deal_status: 'active', deal_stage: 'establishing_arrangement', stage_as_of: '2026-10-29' } }) };
  });
});
