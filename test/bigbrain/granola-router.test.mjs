import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_GRANOLA_ROUTE_MARGIN,
  DEFAULT_GRANOLA_ROUTE_THRESHOLD,
  routeGranolaMeeting,
} from '../../src/bigbrain/granola-router.js';

test('description classification routes to a healthy writable brain', () => {
  const result = routeGranolaMeeting({
    meeting: meeting({ folder_names: ['ICAIRE'] }),
    brains: [
      brain('personal', { confidence: 0.4, description: 'Personal, family, health, and private administrative memory.' }),
      brain('icaire', { confidence: 0.99, description: 'ICAIRE organization work, programmes, research, and operations.' }),
    ],
  });

  assert.equal(result.decision, 'route');
  assert.equal(result.selected_brain_id, 'icaire');
  assert.deepEqual(result.reason_codes, ['description_match_confident']);
});

test('explicitly mixed meetings hold for one-owner routing', () => {
  const result = routeGranolaMeeting({ meeting: meeting({ mixed: true }), brains: [brain('personal')] });
  assert.equal(result.decision, 'hold');
  assert.deepEqual(result.reason_codes, ['meeting_mixed']);
});

test('description classification requires the default threshold and a clear margin', () => {
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

test('a caller-supplied threshold overrides the default', () => {
  const result = routeGranolaMeeting({
    meeting: meeting(),
    brains: [brain('research', { confidence: 0.81, minimumConfidence: 0.8 })],
  });
  assert.equal(result.decision, 'route');
  assert.equal(result.selected_brain_id, 'research');
});

test('descriptions must be valid before any brain can auto-route', () => {
  const invalid = routeGranolaMeeting({
    meeting: meeting(),
    brains: [brain('invalid', { profileValid: false, confidence: 0.99 })],
  });
  assert.equal(invalid.decision, 'hold');
  assert.equal(invalid.candidates[0].gate, 'profile_invalid');

  assert.throws(
    () => routeGranolaMeeting({ meeting: meeting(), brains: [brain('missing-description', { description: '', confidence: 0.99 })] }),
    /description|non-empty string/,
  );
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
  description = `${brainId} brain description`,
  minimumConfidence = null,
  verified = true,
  authenticated = true,
  writable = true,
} = {}) {
  return {
    brain_id: brainId,
    confidence,
    minimum_confidence: minimumConfidence,
    profile_valid: profileValid,
    verified,
    authenticated,
    writable,
    profile: {
      identity: { brain_id: brainId, description },
    },
  };
}
