import http from 'node:http';

import { createGranolaWebhookEventEnvelope } from './granola-webhook.js';
import {
  DEFAULT_EVENT_MAX_BODY_BYTES,
  createWebhookEventEnvelope,
  hmacSignature,
  normalizeEventEnvelope,
  readBody,
  sha256,
  timingSafeEqual,
} from './inbound-events.js';

/**
 * Webhooks are deliberately event-driven. This module owns HTTP intake,
 * authentication, upstream type filtering, and enqueueing. Processing is
 * handed to the shared processor only after an event passes these guards.
 */
export class InboundWebhookServer {
  constructor({ registryStore, inboxStore, host = '127.0.0.1', port = 55561, secretResolver = () => null, maxBodyBytes = DEFAULT_EVENT_MAX_BODY_BYTES, onAccepted = null, now = () => new Date(), logger = console } = {}) {
    this.registryStore = registryStore;
    this.inboxStore = inboxStore;
    this.host = host;
    this.port = port;
    this.secretResolver = secretResolver;
    this.maxBodyBytes = maxBodyBytes;
    this.onAccepted = onAccepted;
    this.now = now;
    this.logger = logger;
    this.server = null;
  }

  async start() {
    this.server = http.createServer((request, response) => this.handle(request, response).catch((error) => this.send(response, error.statusCode || 500, { ok: false, error: error.message })));
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.port, this.host, resolve); });
    return this.server.address();
  }

  async handle(request, response) {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/health') return this.send(response, 200, { ok: true, status: 'ready', host: this.host, port: this.server?.address()?.port || this.port });
    if (request.method !== 'POST') return this.send(response, 404, { ok: false, error: 'Not found' });
    const deliveryRoute = url.pathname.match(/^\/deliveries\/([^/]+)$/);
    const listenerId = deliveryRoute?.[1] || url.pathname.match(/^\/(?:events|webhooks)\/([^/]+)$/)?.[1] || request.headers['x-bigbrain-listener'];
    const registry = await this.registryStore.get();
    const listener = registry.listeners.find((candidate) => candidate.id === listenerId && candidate.type === 'webhook');
    const deliveryListener = deliveryRoute ? registry.listeners.find((candidate) => candidate.id === listenerId) : null;
    const resolvedListener = deliveryListener || listener;
    if (!resolvedListener || !resolvedListener.enabled) return this.send(response, 404, { ok: false, error: 'Inbound listener not found or disabled.' });
    if (!deliveryRoute && resolvedListener.listener_location !== registry.runtime.kind) return this.send(response, 409, { ok: false, error: 'Listener is assigned to another runtime location.' });
    const body = await readBody(request, this.maxBodyBytes);
    const subscription = deliveryRoute
      ? registry.subscriptions.find((candidate) => candidate.id === request.headers['x-bigbrain-subscription'] && candidate.listener_id === listenerId)
      : null;
    if (deliveryRoute && (!subscription || !subscription.enabled)) return this.send(response, 403, { ok: false, error: 'Inbound delivery subscription is not enabled.' });
    const secret = await this.secretResolver(subscription || resolvedListener);
    if (secret) {
      const signatureHeader = resolvedListener.endpoint?.signature_header || 'x-bigbrain-signature';
      const actual = request.headers[signatureHeader.toLowerCase()]
        || request.headers['x-bigbrain-signature']
        || request.headers['x-hub-signature-256']
        || request.headers['x-signature'];
      if (!timingSafeEqual(actual, hmacSignature(body, secret))) return this.send(response, 401, { ok: false, error: 'Invalid event signature.' });
    } else if (!['127.0.0.1', '::1', 'localhost'].includes(this.host)) {
      return this.send(response, 503, { ok: false, error: 'Webhook listener has no resolvable signing credential.' });
    }
    let payload;
    try { payload = JSON.parse(body); } catch { payload = { body }; }
    if (!deliveryRoute && resolvedListener.event_types.length) {
      const incomingType = configuredWebhookEventType(payload, request.headers, resolvedListener);
      if (!incomingType || !resolvedListener.event_types.includes(incomingType.toLowerCase())) {
        return this.send(response, 202, {
          ok: true,
          status: 'ignored',
          reason: incomingType ? 'unsupported_event_type' : 'missing_event_type',
          event_type: incomingType || null,
        });
      }
    }
    const eventId = String(request.headers['x-event-id'] || request.headers['idempotency-key'] || payload.event_id || payload.id || sha256(body));
    const event = deliveryRoute
      ? normalizeEventEnvelope(payload, { now: this.now(), registry, listener: resolvedListener })
      : resolvedListener.provider === 'granola'
        ? normalizeEventEnvelope(createGranolaWebhookEventEnvelope({ listener: resolvedListener, payload, rawPayload: body, headers: request.headers, now: this.now(), registry }), { now: this.now(), registry, listener: resolvedListener })
        : createWebhookEventEnvelope({ listener: resolvedListener, eventId, payload, rawPayload: body, occurredAt: request.headers['x-occurred-at'] || null, metadata: { content_type: request.headers['content-type'] || null }, now: this.now(), registry });
    const result = await this.inboxStore.enqueue(event, { clientId: subscription?.client_id || registry.runtime.id, subscriptionId: subscription?.id || null });
    if (!result.duplicate) Promise.resolve(this.onAccepted?.(result.event.delivery_id)).catch((error) => this.logger.error?.(`Inbound webhook processing failed: ${error.message}`));
    return this.send(response, result.duplicate ? 200 : 202, { ok: true, status: result.duplicate ? 'duplicate' : 'accepted', delivery_id: result.event.delivery_id, event_id: event.event_id });
  }

  async close() {
    if (!this.server) return;
    await new Promise((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve()));
    this.server = null;
  }

  send(response, status, value) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); }
}

export function configuredWebhookEventType(payload, headers = {}, listener = {}) {
  const configuredPath = listener.event_type_path || 'type';
  const configured = readPath(payload, configuredPath);
  if (configured !== undefined && configured !== null && String(configured).trim()) return String(configured).trim();
  if (listener.provider === 'granola') {
    for (const fallbackPath of ['event_type', 'type', 'event']) {
      if (fallbackPath === configuredPath) continue;
      const fallback = readPath(payload, fallbackPath);
      if (fallback !== undefined && fallback !== null && String(fallback).trim()) return String(fallback).trim();
    }
  }
  const headerNames = listener.provider === 'granola'
    ? ['x-granola-event', 'x-event-type']
    : ['x-event-type', 'x-webhook-event'];
  for (const name of headerNames) {
    const value = headers[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return null;
}

function readPath(value, path) {
  return String(path || '').split('.').filter(Boolean).reduce((current, key) => current == null ? undefined : current[key], value);
}
