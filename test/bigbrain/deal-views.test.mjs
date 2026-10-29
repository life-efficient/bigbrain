import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAllDealRecords, fetchAnonymisedDealsPdf } from '../../src/dashboard-client/overlays/deal-view-data.js';
import { matchesIntroductionFilters } from '../../src/dashboard-client/overlays/deal-progress.js';

test('introduction list loads every page independently of parent deal enrollment', async () => {
  const urls = [];
  const result = await loadAllDealRecords('/api/overlays/deals/introductions', { fetchImpl: async url => {
    urls.push(url);
    const second = url.includes('cursor=100');
    return { ok: true, json: async () => ({ records: second ? [{ page_slug: 'deal_introductions/last', deal: 'deals/not-enrolled' }] : Array.from({ length: 100 }, (_, n) => ({ page_slug: `deal_introductions/${n}` })), total: 101, next_cursor: second ? null : 100 }) };
  } });
  assert.equal(result.length, 101);
  assert.equal(result.at(-1).deal, 'deals/not-enrolled');
  assert.deepEqual(urls, ['/api/overlays/deals/introductions?limit=100', '/api/overlays/deals/introductions?limit=100&cursor=100']);
});

test('incomplete pagination and repeated cursors never become a complete list', async () => {
  await assert.rejects(loadAllDealRecords('/records', { fetchImpl: async () => ({ ok: true, json: async () => ({ records: [], total: 2, next_cursor: null }) }) }), /finish loading/);
  await assert.rejects(loadAllDealRecords('/records', { fetchImpl: async () => ({ ok: true, json: async () => ({ records: [{}], next_cursor: 1 }) }) }), /finish loading/);
});

test('introduction filters use introduction stage and searchable parent, party and waiting owner', () => {
  const intro = { title: 'Vendor / Customer', stage: 'introduced', parent_deal: { page_slug: 'deals/example', title: 'Compute supply' },
    parties: [{ page_slug: 'organizations/vendor', title: 'Vendor Company' }], purpose: 'Evaluate capacity',
    tasks: [{ page_slug: 'tasks/confirm', status: 'waiting', title: 'Confirm availability', waiting_on: [{ page_slug: 'people/alex', title: 'Alex' }] }],
    deal_stage: 'negotiating' };
  for (const search of ['compute supply', 'vendor company', 'capacity', 'alex']) assert.equal(matchesIntroductionFilters(intro, { search, stage: 'introduced' }), true);
  assert.equal(matchesIntroductionFilters(intro, { stage: 'negotiating' }), false);
  assert.equal(matchesIntroductionFilters({}, { stage: 'unknown' }), true);
});

test('PDF download always requests the complete export without UI filters', async () => {
  let request;
  const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
  assert.equal(await fetchAnonymisedDealsPdf(async (...args) => {
    request = args;
    return { ok: true, headers: new Headers({ 'content-type': 'application/pdf' }), blob: async () => blob };
  }), blob);
  assert.deepEqual(request, ['/api/overlays/deals/export.pdf', { cache: 'no-store' }]);
});

test('PDF errors and wrong content never become a downloaded document', async () => {
  await assert.rejects(fetchAnonymisedDealsPdf(async () => ({ ok: false, status: 422, json: async () => ({ error: 'Complete the anonymised descriptions first.' }) })), /Complete the anonymised/);
  await assert.rejects(fetchAnonymisedDealsPdf(async () => ({ ok: true, headers: new Headers({ 'content-type': 'text/html' }) })), /could not be generated/);
});
