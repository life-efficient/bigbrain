import test from 'node:test';
import assert from 'node:assert/strict';
import { activeDealTasks, matchesDealFilters, pageReference, progressDate } from '../../src/dashboard-client/overlays/deal-progress.js';

const deal = {
  title: 'Compute supply requirement', deal_types: ['compute_brokerage'], deal_stage: 'qualifying',
  anonymised_title: 'Hosted compute', anonymised_description: 'Compute capacity required.', anonymised_asks: [],
  introductions: [{ title: 'Supplier and customer', stage: 'discussing', purpose: 'Assess capacity fit',
    parties: [{ page_slug: 'organizations/vendor', title: 'Example Vendor' }],
    tasks: [{ page_slug: 'tasks/confirm-capacity', title: 'Confirm capacity', status: 'waiting',
      waiting_on: [{ page_slug: 'people/alex', title: 'Alex Taylor' }], assignees: [] }],
  }],
};

test('deal search includes introduction parties, purpose and who owes a response', () => {
  for (const search of ['example vendor', 'Alex Taylor', 'capacity fit', 'Discussing']) {
    assert.equal(matchesDealFilters(deal, { search }), true, search);
  }
  assert.equal(matchesDealFilters(deal, { search: 'Unrelated person' }), false);
});

test('type and parent stage filters do not infer fundraising from an active introduction', () => {
  assert.equal(matchesDealFilters(deal, { dealType: 'capital_raise' }), false);
  assert.equal(matchesDealFilters(deal, { dealType: 'compute_brokerage', stage: 'qualifying' }), true);
  assert.equal(matchesDealFilters(deal, { stage: 'negotiating' }), false);
  assert.equal(matchesDealFilters({}, { stage: 'unknown' }), true);
});

test('closed tasks do not appear as next actions or make search match stale followups', () => {
  const tasks = [{ page_slug: 'tasks/old', title: 'Obsolete approval', status: 'done' },
    { page_slug: 'tasks/archived', status: 'archived' }, { page_slug: 'tasks/open', status: 'open' }];
  assert.deepEqual(activeDealTasks(tasks).map(task => task.page_slug), ['tasks/open']);
  assert.equal(matchesDealFilters({ tasks }, { search: 'obsolete' }), false);
});

test('missing progress data remains unknown and references keep their navigable identity', () => {
  assert.deepEqual(pageReference('organizations/example-vendor'), { page_slug: 'organizations/example-vendor', title: 'example vendor' });
  assert.equal(pageReference(null), null);
  assert.equal(progressDate(null), null);
  assert.equal(progressDate('yesterday'), null);
  assert.equal(progressDate('2026-10-29T23:30:00Z'), '29 Oct 2026');
  assert.equal(matchesDealFilters({ anonymised_asks: null }, { search: 'missing' }), false);
});
