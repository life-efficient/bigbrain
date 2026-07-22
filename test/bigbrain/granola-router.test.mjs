import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_GRANOLA_ROUTE_MARGIN,
  DEFAULT_GRANOLA_ROUTE_THRESHOLD,
  routeGranolaMeeting,
} from '../../src/bigbrain/granola-router.js';

test('an exact source include routes to an approved healthy auto profile', () => {
  const personal = brain('personal', { confidence: 0.99 });
  const icaire = brain('icaire', {
    confidence: 0.4,
    rules: [{ type: 'granola_folder', effect: 'include', value: 'ICAIRE' }],
  });

  const result = routeGranolaMeeting({
    meeting: meeting({ folder_names: ['ICAIRE'] }),
    brains: [personal, icaire],
  });

  assert.equal(result.decision, 'route');
  assert.equal(result.selected_brain_id, 'icaire');
  assert.deepEqual(result.reason_codes, ['hard_source_include']);
});

test('hard excludes are applied before hard includes', () => {
  const candidate = brain('personal', {
    rules: [
      { type: 'granola_folder', effect: 'include', value: 'ICAIRE' },
      { type: 'granola_folder', effect: 'exclude', value: 'ICAIRE' },
    ],
  });

  const result = routeGranolaMeeting({ meeting: meeting({ folder_names: ['ICAIRE'] }), brains: [candidate] });

  assert.equal(result.decision, 'hold');
  assert.deepEqual(result.reason_codes, ['all_candidates_excluded']);
  assert.equal(result.candidates[0].hard_excluded, true);
  assert.equal(result.candidates[0].hard_included, true);
});

test('source rules use exact folder and account values while domains are case-insensitive', () => {
  const result = routeGranolaMeeting({
    meeting: meeting({ folder_names: ['icaire'], organizer_domain: 'EXAMPLE.COM', account_context: 'Work' }),
    brains: [
      brain('folder', { confidence: 0.2, rules: [{ type: 'granola_folder', effect: 'include', value: 'ICAIRE' }] }),
      brain('domain', { confidence: 0.2, rules: [{ type: 'organizer_domain', effect: 'include', value: 'example.com' }] }),
      brain('account', { confidence: 0.99, rules: [{ type: 'account_context', effect: 'include', value: 'work' }] }),
    ],
  });

  assert.equal(result.decision, 'route');
  assert.equal(result.selected_brain_id, 'domain');
});

test('multiple hard includes and explicitly mixed meetings hold for one-owner routing', () => {
  const brains = [
    brain('personal', { rules: [{ type: 'account_context', effect: 'include', value: 'harry' }] }),
    brain('dealmaking', { rules: [{ type: 'account_context', effect: 'include', value: 'harry' }] }),
  ];
  const ambiguous = routeGranolaMeeting({ meeting: meeting({ account_context: 'harry' }), brains });
  assert.equal(ambiguous.decision, 'hold');
  assert.deepEqual(ambiguous.reason_codes, ['multiple_hard_includes']);

  const mixed = routeGranolaMeeting({ meeting: meeting({ mixed: true }), brains: [brain('personal')] });
  assert.equal(mixed.decision, 'hold');
  assert.deepEqual(mixed.reason_codes, ['meeting_mixed']);
});

test('classification requires the default threshold and a clear margin', () => {
  assert.equal(DEFAULT_GRANOLA_ROUTE_THRESHOLD, 0.85);
  assert.equal(DEFAULT_GRANOLA_ROUTE_MARGIN, 0.1);

  const low = routeGranolaMeeting({
    meeting: meeting(),
    brains: [brain('personal', { confidence: 0.84 })],
  });
  assert.deepEqual(low.reason_codes, ['low_confidence']);

  const close = routeGranolaMeeting({
    meeting: meeting(),
    brains: [brain('personal', { confidence: 0.93 }), brain('dealmaking', { confidence: 0.84 })],
  });
  assert.deepEqual(close.reason_codes, ['unclear_margin']);

  const clear = routeGranolaMeeting({
    meeting: meeting(),
    brains: [brain('personal', { confidence: 0.95 }), brain('dealmaking', { confidence: 0.84 })],
  });
  assert.equal(clear.decision, 'route');
  assert.equal(clear.selected_brain_id, 'personal');
});

test('a profile-specific threshold overrides the default', () => {
  const result = routeGranolaMeeting({
    meeting: meeting(),
    brains: [brain('research', { confidence: 0.81, minimumConfidence: 0.8 })],
  });
  assert.equal(result.decision, 'route');
  assert.equal(result.selected_brain_id, 'research');
});

test('profiles must be valid and approved before any brain can auto-route', () => {
  for (const candidate of [
    brain('invalid', { profileValid: false, confidence: 0.99 }),
    brain('draft', { approved: false, confidence: 0.99 }),
    brain('review', { ingestionMode: 'review', confidence: 0.99 }),
    brain('approval', { approvalRequired: true, confidence: 0.99 }),
  ]) {
    const result = routeGranolaMeeting({ meeting: meeting(), brains: [candidate] });
    assert.equal(result.decision, 'hold');
    assert.equal(result.selected_brain_id, null);
  }
});

test('verified, authenticated, and writable gates prevent fallback routing', () => {
  for (const unavailable of [
    brain('target', { confidence: 0.99, verified: false }),
    brain('target', { confidence: 0.99, authenticated: false }),
    brain('target', { confidence: 0.99, writable: false }),
  ]) {
    const result = routeGranolaMeeting({
      meeting: meeting(),
      brains: [unavailable, brain('fallback', { confidence: 0.7 })],
    });
    assert.equal(result.decision, 'hold');
    assert.equal(result.candidate_brain_id, 'target');
  }
});

test('deny and matching review rules are honored without speculative writes', () => {
  const denied = routeGranolaMeeting({
    meeting: meeting(),
    brains: [brain('archive', { confidence: 0.99, ingestionMode: 'deny' })],
  });
  assert.equal(denied.decision, 'hold');
  assert.deepEqual(denied.reason_codes, ['selected_destination_denied']);

  const review = routeGranolaMeeting({
    meeting: meeting({ account_context: 'shared' }),
    brains: [brain('shared', {
      confidence: 0.99,
      rules: [{ type: 'account_context', effect: 'review', value: 'shared' }],
    })],
  });
  assert.equal(review.decision, 'hold');
  assert.deepEqual(review.reason_codes, ['selected_destination_source_review_required']);
});

test('transcript-like content is rejected at the deterministic boundary', () => {
  for (const content of [
    { transcript: 'private words' },
    { summary: 'private summary' },
    { notes: 'private notes' },
  ]) {
    assert.throws(
      () => routeGranolaMeeting({ meeting: meeting(content), brains: [brain('personal')] }),
      /must not be supplied to the deterministic router/,
    );
  }
});

function meeting(overrides = {}) {
  return {
    granola_id: 'meeting-1',
    title: 'Example meeting',
    date: '2026-07-22',
    folder_names: [],
    organizer_domain: 'example.com',
    attendee_domains: [],
    account_context: 'default',
    ...overrides,
  };
}

function brain(brainId, {
  confidence = 0.95,
  profileValid = true,
  approved = true,
  ingestionMode = 'auto',
  approvalRequired = false,
  minimumConfidence = null,
  rules = [],
  verified = true,
  authenticated = true,
  writable = true,
} = {}) {
  return {
    brain_id: brainId,
    confidence,
    profile_valid: profileValid,
    verified,
    authenticated,
    writable,
    profile: {
      identity: { brain_id: brainId },
      routing: {
        ingestion_mode: ingestionMode,
        approval_required: approvalRequired,
        minimum_confidence: minimumConfidence,
        source_rules: rules,
      },
      provenance: { review_status: approved ? 'approved' : 'draft' },
    },
  };
}
