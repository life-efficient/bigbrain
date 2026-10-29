import { saveIntroductionArrangement } from '../../src/dashboard-client/overlays/deal-arrangement.js';
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
  assert.equal(DEAL_STAGE_LABELS.establishing_arrangement, undefined);
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
  await saveDealStage({ ...record, deal_status: 'active' }, 'preparing', async (_, options) => {
    assert.equal(JSON.parse(options.body).expected_deal_status, 'active');
    return { ok: true, json: async () => ({ record: { ...record, deal_status: 'active', deal_stage: 'preparing', stage_as_of: '2026-10-29' } }) };
  });
});


test('introduction arrangement carries only its own concurrency guard', async () => {
  let record = { page_slug: 'deal_introductions/a', stage: 'negotiating', stage_as_of: '2026-10-20' };
  for (const status of ['establishing', 'agreed', 'none']) {
    const data = await saveIntroductionArrangement(record, status, async (url, options) => {
      assert.equal(url, '/api/overlays/deals/introductions/arrangement');
      assert.deepEqual(JSON.parse(options.body), { page_slug: record.page_slug, arrangement_status: status, expected_arrangement_status: record.arrangement_status || 'none' });
      return { ok: true, json: async () => ({ record: { ...record, arrangement_status: status } }) };
    });
    assert.equal(data.record.stage, 'negotiating');
    assert.equal(data.record.stage_as_of, '2026-10-20');
    record = data.record;
  }
});

test('introduction arrangement rejects conflicts and unverifiable success', async () => {
  const record = { page_slug: 'deal_introductions/a', arrangement_status: 'none' };
  await assert.rejects(saveIntroductionArrangement(record, 'establishing', async () => ({ ok: false, status: 409, json: async () => ({ error: 'Changed elsewhere' }) })), error => error.status === 409);
  await assert.rejects(saveIntroductionArrangement(record, 'agreed', async () => ({ ok: true, json: async () => ({ record }) })), /could not be verified/);
});
