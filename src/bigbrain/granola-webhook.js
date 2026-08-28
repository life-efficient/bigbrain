import crypto from 'node:crypto';

const COMPLETION_EVENT_TYPES = new Set([
  'note.generated',
]);

export function createGranolaWebhookEventEnvelope({ listener, payload, rawPayload = null, headers = {}, now = new Date(), registry = null }) {
  const normalized = normalizeGranolaWebhookPayload(payload, headers);
  const eventId = normalized.event_id || stableGranolaWebhookId(normalized.granola_id, normalized.event_type);
  if (!eventId) throw new Error('Granola webhook requires a stable event or note ID.');
  return {
    event_id: eventId,
    origin_id: `${listener.id}:${eventId}`,
    listener_id: listener.id,
    source_scope: listener.scope,
    type: normalized.completed ? 'granola.meeting.completed' : 'granola.webhook',
    occurred_at: normalized.occurred_at || now.toISOString(),
    received_at: now.toISOString(),
    payload: normalized,
    raw_payload: rawPayload,
    source: {
      description: listener.description,
      display_name: listener.display_name || 'Granola',
      icon: listener.icon || 'Granola',
      endpoint: listener.url,
    },
    registry_revision: Number(registry?.revision || 0),
    allowed_brain_ids: listener.brain_ids || [],
    capture_policy: listener.capture_policy,
    execution: {
      location: listener.codex_execution_location || 'client',
      mode: listener.codex_execution_mode || 'app_thread',
    },
    metadata: { provider: 'granola', event_type: normalized.event_type },
  };
}

export function normalizeGranolaWebhookPayload(payload, headers = {}) {
  const input = isObject(payload) ? payload : {};
  const eventType = clean(input.event_type || input.type || input.event || headers['x-granola-event'] || headers['x-event-type']);
  const data = firstObject(input.data, input.payload, input.event_data, input.note, input.meeting, input);
  const note = firstObject(data.note, data.meeting, data.document, data);
  const granolaId = clean(note.id || note.note_id || note.meeting_id || note.granola_id || data.id || data.note_id || input.id || input.note_id);
  const status = clean(note.status || data.status || input.status).toLowerCase();
  const completed = COMPLETION_EVENT_TYPES.has(eventType.toLowerCase());
  const occurredAt = clean(note.completed_at || note.completedAt || data.completed_at || input.occurred_at || input.occurredAt || headers['x-occurred-at']);
  return {
    event_id: clean(headers['x-event-id'] || headers['idempotency-key'] || input.event_id || input.source_event_id || input.id),
    event_type: eventType || 'unknown',
    granola_id: granolaId,
    title: clean(note.title || note.name || data.title || input.title),
    status: status || (completed ? 'completed' : 'unknown'),
    completed,
    occurred_at: occurredAt || null,
    note_url: clean(note.url || note.web_url || note.webUrl || data.url || input.url),
    summary: note.summary ?? data.summary ?? input.summary ?? null,
    attendees: note.attendees ?? data.attendees ?? input.attendees ?? [],
    calendar_event: note.calendar_event ?? data.calendar_event ?? input.calendar_event ?? null,
  };
}

export function stableGranolaWebhookId(granolaId, eventType = 'note.generated') {
  const id = clean(granolaId);
  return id ? `granola:${id}:${clean(eventType).toLowerCase() || 'note.generated'}` : null;
}

export function granolaWebhookSignature(body, { webhookId, webhookTimestamp }, signingSecret) {
  const secret = String(signingSecret || '');
  if (!secret.startsWith('whsec_') || !webhookId || !webhookTimestamp) return null;
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  return `v1,${crypto.createHmac('sha256', key).update(`${webhookId}.${webhookTimestamp}.${body}`, 'utf8').digest('base64')}`;
}

export function verifyGranolaWebhookSignature(body, headers = {}, signingSecret, { now = new Date(), toleranceSeconds = 300 } = {}) {
  const webhookId = clean(headers['webhook-id']);
  const webhookTimestamp = clean(headers['webhook-timestamp']);
  const supplied = clean(headers['webhook-signature']);
  const timestamp = Number(webhookTimestamp);
  if (!webhookId || !webhookTimestamp || !supplied || !Number.isFinite(timestamp)) return false;
  if (Math.abs(new Date(now).getTime() / 1000 - timestamp) > toleranceSeconds) return false;
  const expected = granolaWebhookSignature(body, { webhookId, webhookTimestamp }, signingSecret);
  if (!expected) return false;
  return supplied.split(/\s+/).some((entry) => {
    const [version, signature] = entry.split(',', 2);
    if (version !== 'v1' || !signature) return false;
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected.slice(3));
    return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
  });
}

function firstObject(...values) {
  return values.find((value) => isObject(value)) || {};
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}
