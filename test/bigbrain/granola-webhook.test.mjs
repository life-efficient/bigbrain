import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGranolaWebhookEventEnvelope,
  normalizeGranolaWebhookPayload,
  stableGranolaWebhookId,
} from '../../src/bigbrain/granola-webhook.js';

const listener = {
  id: 'granola',
  provider: 'granola',
  scope: 'personal',
  description: 'Process completed Granola meetings.',
  display_name: 'Granola',
  icon: 'Granola',
  brain_ids: ['brain_personal'],
  capture_policy: { default_mode: 'full', retain_raw: true, max_raw_bytes: 1_000_000, preserve_source_link: true },
  codex_execution_location: 'client',
  codex_execution_mode: 'app_thread',
};

test('normalizes a Granola completion webhook from a nested note payload', () => {
  const normalized = normalizeGranolaWebhookPayload({
    type: 'meeting.completed',
    data: { note: { id: 'not_123', title: 'Planning', summary: 'Decisions', completed_at: '2026-08-28T09:00:00Z' } },
  });
  assert.equal(normalized.granola_id, 'not_123');
  assert.equal(normalized.completed, true);
  assert.equal(normalized.title, 'Planning');
  assert.equal(normalized.event_type, 'meeting.completed');
  assert.equal(stableGranolaWebhookId('not_123'), 'granola:not_123:meeting.completed');
});

test('completion envelope is stable and preserves the raw provider payload', () => {
  const raw = JSON.stringify({ event: 'note.ready', note: { id: 'not_456', title: 'Call' } });
  const event = createGranolaWebhookEventEnvelope({ listener, payload: JSON.parse(raw), rawPayload: raw, now: new Date('2026-08-28T10:00:00Z') });
  assert.equal(event.event_id, 'granola:not_456:note.ready');
  assert.equal(event.type, 'granola.meeting.completed');
  assert.equal(event.payload.granola_id, 'not_456');
  assert.equal(event.raw_payload, raw);
  assert.deepEqual(event.allowed_brain_ids, ['brain_personal']);
});

test('non-completion provider events remain identifiable for policy ignore', () => {
  const event = createGranolaWebhookEventEnvelope({ listener, payload: { type: 'ping', id: 'evt_1' } });
  assert.equal(event.type, 'granola.webhook');
  assert.equal(event.payload.completed, false);
  assert.equal(event.event_id, 'evt_1');
});
