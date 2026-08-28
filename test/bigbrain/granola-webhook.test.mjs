import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGranolaWebhookEventEnvelope,
  granolaWebhookSignature,
  normalizeGranolaWebhookPayload,
  stableGranolaWebhookId,
  verifyGranolaWebhookSignature,
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

test('normalizes Granola note.generated from a nested note payload', () => {
  const normalized = normalizeGranolaWebhookPayload({
    event_type: 'note.generated',
    data: { note: { id: 'not_123', title: 'Planning', summary: 'Decisions' } },
  });
  assert.equal(normalized.granola_id, 'not_123');
  assert.equal(normalized.completed, true);
  assert.equal(normalized.title, 'Planning');
  assert.equal(normalized.event_type, 'note.generated');
  assert.equal(stableGranolaWebhookId('not_123'), 'granola:not_123:note.generated');
});

test('note.generated envelope preserves the raw provider payload', () => {
  const raw = JSON.stringify({ event_type: 'note.generated', note_id: 'not_456', title: 'Call' });
  const event = createGranolaWebhookEventEnvelope({ listener, payload: JSON.parse(raw), rawPayload: raw, now: new Date('2026-08-28T10:00:00Z') });
  assert.equal(event.event_id, 'granola:not_456:note.generated');
  assert.equal(event.type, 'granola.meeting.completed');
  assert.equal(event.payload.granola_id, 'not_456');
  assert.equal(event.raw_payload, raw);
  assert.deepEqual(event.allowed_brain_ids, ['brain_personal']);
});

test('note.edited remains identifiable without being treated as a generated note', () => {
  const event = createGranolaWebhookEventEnvelope({ listener, payload: { event_type: 'note.edited', event_id: 'evt_1', note_id: 'not_789' } });
  assert.equal(event.type, 'granola.webhook');
  assert.equal(event.payload.completed, false);
  assert.equal(event.event_id, 'evt_1');
});

test('verifies Granola Standard Webhooks signatures and rejects stale deliveries', () => {
  const body = JSON.stringify({ event_type: 'note.generated', note_id: 'not_999' });
  const secret = `whsec_${Buffer.from('test-signing-secret').toString('base64')}`;
  const webhookId = 'msg_test_1';
  const webhookTimestamp = String(Math.floor(new Date('2026-08-28T10:00:00Z').getTime() / 1000));
  const headers = { 'webhook-id': webhookId, 'webhook-timestamp': webhookTimestamp };
  const signature = granolaWebhookSignature(body, { webhookId, webhookTimestamp }, secret);
  assert.equal(verifyGranolaWebhookSignature(body, { ...headers, 'webhook-signature': signature }, secret, { now: new Date('2026-08-28T10:02:00Z') }), true);
  assert.equal(verifyGranolaWebhookSignature(body, { ...headers, 'webhook-signature': signature }, secret, { now: new Date('2026-08-28T10:10:00Z') }), false);
});
