import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CodexAppThreadExecutor, CodexCliExecutor, normalizeCodexOutcome } from './codex-event-executor.js';
import { DEFAULT_RSS_POLL_LIMIT, RssCollector } from './rss-events.js';
import { InboundWebhookServer } from './webhook-events.js';
import { normalizeSourceType } from './source-taxonomy.js';
import { DEFAULT_COLLECTIONS } from './page-ops.js';

export { RssCollector } from './rss-events.js';
export { InboundWebhookServer, configuredWebhookEventType } from './webhook-events.js';

export const INBOUND_EVENTS_VERSION = 2;
export const DEFAULT_EVENT_RETENTION_DAYS = 90;
export const DEFAULT_EVENT_MAX_BODY_BYTES = 1_000_000;
export const DEFAULT_RSS_INITIAL_CURSOR_DAYS = 7;
export const DEFAULT_RSS_SOURCE_MAX_BYTES = 2_000_000;
export const DEFAULT_RSS_SOURCE_TIMEOUT_MS = 30_000;
export const EVENT_STATES = ['received', 'running', 'filed', 'ignored', 'failed', 'quarantined'];
export const EXECUTION_MODES = ['app_thread', 'cli'];
export const RUNTIME_LOCATIONS = ['client', 'host'];
export const LISTENER_TYPES = ['rss', 'webhook'];
export const CODEX_REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

const SECRET_KEYS = new Set(['authorization', 'cookie', 'set-cookie', 'token', 'access_token', 'refresh_token', 'client_secret', 'webhook_secret']);

export function defaultEventConfigDir(env = process.env) {
  if (env.BIGBRAIN_CONFIG_DIR) return path.resolve(env.BIGBRAIN_CONFIG_DIR);
  const home = env.HOME || os.homedir();
  return path.join(path.resolve(home), '.config', 'bigbrain');
}

export function defaultEventRegistryPath(env = process.env) {
  if (env.BIGBRAIN_EVENT_REGISTRY) return path.resolve(env.BIGBRAIN_EVENT_REGISTRY);
  return path.join(defaultEventConfigDir(env), 'event-registry.json');
}

export function defaultEventInboxPath(env = process.env) {
  if (env.BIGBRAIN_EVENT_INBOX) return path.resolve(env.BIGBRAIN_EVENT_INBOX);
  return path.join(defaultEventConfigDir(env), 'event-inbox.json');
}

export function defaultEventIngestorConfigPath(env = process.env) {
  return path.join(defaultEventConfigDir(env), 'event-ingestor.json');
}

export function createEmptyEventRegistry({ runtimeId = null, runtimeKind = 'client' } = {}) {
  return {
    version: INBOUND_EVENTS_VERSION,
    revision: 0,
    runtime: { id: runtimeId || `${runtimeKind}-${crypto.randomUUID()}`, kind: normalizeRuntimeLocation(runtimeKind) },
    retention_days: DEFAULT_EVENT_RETENTION_DAYS,
    poll_interval_ms: 300_000,
    brains: [],
    listeners: [],
    subscriptions: [],
    relay: { enabled: false, url: null, credential_ref: null },
    updated_at: null,
    audit: [],
  };
}

export function normalizeEventRegistry(value, defaults = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const base = createEmptyEventRegistry(defaults);
  const runtime = input.runtime && typeof input.runtime === 'object' ? input.runtime : {};
  const listeners = Array.isArray(input.listeners) ? input.listeners : [];
  const subscriptions = Array.isArray(input.subscriptions) ? input.subscriptions : [];
  const normalized = {
    ...base,
    ...input,
    version: INBOUND_EVENTS_VERSION,
    revision: Number.isInteger(input.revision) && input.revision >= 0 ? input.revision : 0,
    runtime: {
      id: normalizeIdentifier(runtime.id || base.runtime.id, 'runtime.id'),
      kind: normalizeRuntimeLocation(runtime.kind || base.runtime.kind),
    },
    retention_days: positiveInteger(input.retention_days, DEFAULT_EVENT_RETENTION_DAYS),
    poll_interval_ms: positiveInteger(input.poll_interval_ms, 300_000),
    brains: Array.isArray(input.brains) ? input.brains.map(normalizeRegisteredBrain) : [],
    listeners: listeners.map(normalizeListener),
    subscriptions: subscriptions.map(normalizeSubscription),
    relay: normalizeRelay(input.relay),
    audit: Array.isArray(input.audit) ? input.audit.slice(-200) : [],
    updated_at: input.updated_at || null,
  };
  assertUnique(normalized.listeners.map((listener) => listener.id), 'listener id');
  assertUnique(normalized.brains.map((brain) => brain.id), 'Brain id');
  assertUnique(normalized.subscriptions.map((subscription) => subscription.id), 'subscription id');
  const registeredBrains = new Set(normalized.brains.map((brain) => brain.id));
  for (const listener of normalized.listeners) {
    for (const brainId of listener.brain_ids) if (!registeredBrains.has(brainId)) throw new Error(`Listener ${listener.id} references unregistered Brain ${brainId}.`);
  }
  const listenerIds = new Set(normalized.listeners.map((listener) => listener.id));
  for (const subscription of normalized.subscriptions) {
    if (!listenerIds.has(subscription.listener_id)) throw new Error(`Subscription ${subscription.id} references unknown listener ${subscription.listener_id}.`);
    for (const brainId of subscription.brain_ids) if (!registeredBrains.has(brainId)) throw new Error(`Subscription ${subscription.id} references unregistered Brain ${brainId}.`);
  }
  return normalized;
}

export function normalizeListener(value) {
  if (!value || typeof value !== 'object') throw new Error('Listener must be an object.');
  const type = requireEnum(value.type, LISTENER_TYPES, 'listener.type');
  const id = normalizeIdentifier(value.id, 'listener.id');
  const endpoint = value.endpoint && typeof value.endpoint === 'object' ? value.endpoint : {};
  const url = String(value.url || endpoint.url || '').trim();
  if (type === 'rss' && !/^https?:\/\//i.test(url)) throw new Error(`RSS listener ${id} requires an http(s) endpoint.`);
  if (type === 'webhook' && url && !/^https?:\/\//i.test(url)) throw new Error(`Webhook listener ${id} endpoint must be an http(s) URL when supplied.`);
  const listenerLocation = normalizeRuntimeLocation(value.listener_location || value.collection_location || value.location || 'client');
  const executionLocation = normalizeRuntimeLocation(value.codex_execution_location || value.execution_location || (listenerLocation === 'host' ? 'host' : 'client'));
  const executionMode = requireEnum(value.codex_execution_mode || value.execution_mode || 'app_thread', EXECUTION_MODES, 'listener.codex_execution_mode');
  const provider = optionalString(value.provider || value.source_provider);
  const status = value.removed ? 'removed' : value.paused ? 'paused' : value.enabled === false ? 'disabled' : 'active';
  return {
    id,
    type,
    scope: value.scope === 'organization' ? 'organization' : 'personal',
    endpoint: normalizeEndpoint(endpoint, url),
    url: url || null,
    credential_ref: optionalString(value.credential_ref || value.secret_ref),
    description: optionalString(value.description) || `Inbound ${type} source ${id}`,
    display_name: optionalString(value.display_name) || id,
    icon: optionalString(value.icon) || defaultSourceIcon(type),
    filter: normalizeFilter(value.filter || value.filters),
    capture_policy: normalizeCapturePolicy(value.capture_policy || value.capture),
    event_type_path: normalizeFieldPath(value.event_type_path || value.event_type_field || (provider === 'granola' ? 'event_type' : 'type'), 'listener.event_type_path'),
    event_types: normalizeStringArray(value.event_types || value.allowed_event_types).map((item) => item.toLowerCase()),
    prompt_payload_fields: normalizeFieldPaths(value.prompt_payload_fields || value.prompt_fields, 'listener.prompt_payload_fields'),
    prompt_omit_fields: normalizeFieldPaths(value.prompt_omit_fields || value.prompt_exclude_fields, 'listener.prompt_omit_fields'),
    codex_model: optionalString(value.codex_model || value.model),
    codex_reasoning_effort: normalizeReasoningEffort(value.codex_reasoning_effort || value.reasoning_effort),
    codex_thread_title: optionalString(value.codex_thread_title || value.chat_title || value.thread_title),
    listener_location: listenerLocation,
    codex_execution_location: executionLocation,
    codex_execution_mode: executionMode,
    skill: optionalString(value.skill || value.ingest_skill || value.workflow_skill),
    enabled: status === 'active',
    paused: status === 'paused',
    removed: status === 'removed',
    status,
    brain_ids: normalizeStringArray(value.brain_ids || value.allowed_brain_ids),
    subscription_ids: normalizeStringArray(value.subscription_ids),
    publisher: optionalString(value.publisher),
    provider,
    section_heading: optionalString(value.section_heading),
    target_page: optionalString(value.target_page),
    raw_collection: optionalString(value.raw_collection),
    raw_prefix: optionalString(value.raw_prefix) || id,
    article_policy: normalizeArticlePolicy(value.article_policy || value.article_ingest, { type }),
    bootstrap: value.bootstrap === 'all' || value.bootstrap === 'none' ? value.bootstrap : 'latest',
    created_at: value.created_at || null,
    updated_at: value.updated_at || null,
    health: normalizeHealth(value.health),
  };
}

export function normalizeArticlePolicy(value, { type = 'webhook' } = {}) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    fetch_source: type === 'rss' ? input.fetch_source !== false : false,
    preserve_source: type === 'rss' ? input.preserve_source !== false : false,
    require_source: type === 'rss' ? input.require_source !== false : false,
    max_bytes: positiveInteger(input.max_bytes || input.max_source_bytes, DEFAULT_RSS_SOURCE_MAX_BYTES),
    timeout_ms: positiveInteger(input.timeout_ms || input.source_timeout_ms, DEFAULT_RSS_SOURCE_TIMEOUT_MS),
  };
}

export function normalizeSubscription(value) {
  if (!value || typeof value !== 'object') throw new Error('Subscription must be an object.');
  const listenerId = normalizeIdentifier(value.listener_id || value.source_id, 'subscription.listener_id');
  const clientId = normalizeIdentifier(value.client_id || value.runtime_id || 'local-client', 'subscription.client_id');
  const deliveryUrl = optionalString(value.delivery_url || value.client_webhook_url);
  if (deliveryUrl && !/^https?:\/\//i.test(deliveryUrl)) throw new Error(`Subscription ${value.id || listenerId} delivery_url must be an http(s) URL.`);
  return {
    id: normalizeIdentifier(value.id || `${listenerId}-${clientId}`, 'subscription.id'),
    listener_id: listenerId,
    client_id: clientId,
    brain_ids: normalizeStringArray(value.brain_ids || value.allowed_brain_ids),
    enabled: value.enabled !== false,
    delivery_url: deliveryUrl,
    credential_ref: optionalString(value.credential_ref),
    created_at: value.created_at || null,
    updated_at: value.updated_at || null,
  };
}

export function normalizeFilter(value) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    rules: Array.isArray(input.rules) ? input.rules.map((rule) => ({
      match: optionalString(rule?.match || rule?.pattern),
      field: optionalString(rule?.field) || 'title',
      outcome: ['ignore', 'summary', 'full'].includes(rule?.outcome) ? rule.outcome : 'summary',
    })).filter((rule) => rule.match && validPattern(rule.match)) : [],
    ignore_categories: normalizeStringArray(input.ignore_categories),
    summary_categories: normalizeStringArray(input.summary_categories),
    full_categories: normalizeStringArray(input.full_categories),
    ignore_title_patterns: normalizeStringArray(input.ignore_title_patterns).filter(validPattern),
    ignore_if: normalizeStringArray(input.ignore_if).filter(validPattern),
  };
}

export function normalizeCapturePolicy(value) {
  const input = value && typeof value === 'object' ? value : {};
  const mode = ['ignore', 'summary', 'full'].includes(input.default_mode || input.mode) ? (input.default_mode || input.mode) : 'full';
  return {
    default_mode: mode,
    retain_raw: input.retain_raw === true || input.retain_source === true,
    max_raw_bytes: positiveInteger(input.max_raw_bytes, DEFAULT_EVENT_MAX_BODY_BYTES),
    preserve_source_link: input.preserve_source_link !== false,
  };
}

export function normalizeEventEnvelope(value, { now = new Date(), registry = null, listener = null } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Inbound event must be a JSON object.');
  const eventId = optionalString(value.event_id || value.id || value.source_event_id);
  const listenerId = optionalString(value.listener_id || value.source || listener?.id);
  const type = optionalString(value.type || (listener?.type === 'rss' ? 'rss.item' : 'webhook.event'));
  if (!eventId) throw new Error('Inbound event requires a stable event_id.');
  if (!listenerId) throw new Error('Inbound event requires listener_id.');
  if (!type) throw new Error('Inbound event requires type.');
  const receivedAt = optionalIso(value.received_at) || now.toISOString();
  const occurredAt = optionalIso(value.occurred_at) || receivedAt;
  const payload = sanitizePayload(value.payload === undefined ? value.data : value.payload);
  const source = value.source_info && typeof value.source_info === 'object' ? value.source_info : {};
  const sourceListener = listener || registry?.listeners?.find((candidate) => candidate.id === listenerId);
  const allowedBrainIds = normalizeStringArray(value.allowed_brain_ids || sourceListener?.brain_ids || []);
  const capturePolicy = normalizeCapturePolicy(value.capture_policy || sourceListener?.capture_policy);
  const rawPayload = typeof value.raw_payload === 'string'
    ? truncateUtf8(value.raw_payload, capturePolicy.max_raw_bytes)
    : null;
  return {
    event_id: eventId,
    origin_id: optionalString(value.origin_id) || `${listenerId}:${eventId}`,
    listener_id: listenerId,
    source_scope: value.source_scope === 'organization' || sourceListener?.scope === 'organization' ? 'organization' : 'personal',
    type,
    occurred_at: occurredAt,
    received_at: receivedAt,
    payload,
    raw_payload: rawPayload,
    raw_payload_sha256: rawPayload ? sha256(rawPayload) : null,
    source: {
      description: optionalString(value.source_description || source.description || sourceListener?.description),
      display_name: optionalString(value.source_display_name || source.display_name || sourceListener?.display_name) || listenerId,
      icon: optionalString(value.source_icon || source.icon || sourceListener?.icon) || defaultSourceIcon(sourceListener?.type),
      endpoint: optionalString(value.source_endpoint || source.endpoint || sourceListener?.url),
      provider: optionalString(value.source_provider || source.provider || sourceListener?.provider),
    },
    registry_revision: Number.isInteger(value.registry_revision) ? value.registry_revision : Number(registry?.revision || 0),
    allowed_brain_ids: allowedBrainIds,
    capture_policy: capturePolicy,
    execution: {
      location: normalizeRuntimeLocation(value.codex_execution_location || sourceListener?.codex_execution_location || 'client'),
      mode: requireEnum(value.codex_execution_mode || sourceListener?.codex_execution_mode || 'app_thread', EXECUTION_MODES, 'event.codex_execution_mode'),
    },
    metadata: sanitizeEventMetadata(value.metadata || {}),
  };
}

export function createRssEventEnvelope({ listener, item, feedXml = null, sourceDocument = null, now = new Date(), registry = null }) {
  const normalized = normalizeRssItemForEvent(item);
  const eventId = stableSourceEventId(listener.id, normalized.guid || normalized.link || `${normalized.title}:${normalized.pubDate}`);
  return normalizeEventEnvelope({
    event_id: eventId,
    origin_id: `${listener.id}:${eventId}`,
    listener_id: listener.id,
    source_scope: listener.scope,
    type: 'rss.item',
    occurred_at: normalized.published_at,
    payload: normalized,
    raw_payload: normalized.raw || feedXml || null,
    metadata: sourceDocument ? { source_document: sourceDocument } : {},
    source_info: listener,
  }, { now, registry, listener });
}

export function createWebhookEventEnvelope({ listener, eventId, payload, rawPayload = null, occurredAt = null, metadata = {}, now = new Date(), registry = null }) {
  return normalizeEventEnvelope({
    event_id: eventId,
    listener_id: listener.id,
    source_scope: listener.scope,
    type: 'webhook.event',
    occurred_at: occurredAt,
    payload,
    raw_payload: rawPayload,
    metadata,
    source_info: listener,
  }, { now, registry, listener });
}

export function normalizeRssItemForEvent(item) {
  const title = cleanText(item?.title);
  const description = cleanText(item?.description);
  const link = cleanText(item?.link);
  const guid = cleanText(item?.guid) || link;
  const pubDate = cleanText(item?.pubDate || item?.pub_date);
  const publishedAt = pubDate && !Number.isNaN(Date.parse(pubDate)) ? new Date(pubDate).toISOString() : optionalIso(item?.published_at || item?.publishedAt);
  return {
    title,
    description,
    link,
    guid,
    pubDate,
    published_at: publishedAt,
    category: cleanText(item?.category),
    raw: typeof item?.raw === 'string' ? item.raw.trim() : '',
  };
}

export function normalizeRssItem(item) {
  return normalizeRssItemForEvent(item);
}

export function stableSourceEventId(listenerId, sourceId) {
  return `${listenerId}:${sha256(sourceId).slice(0, 32)}`;
}

export function legacyRssItemKey(listenerId, item) {
  const normalized = normalizeRssItem(item);
  const sourceId = normalized.guid || normalized.link || sha256(`${normalized.title}\n${normalized.pubDate}`);
  return `${listenerId}:${sourceId}`;
}

export function classifyEvent(event, listener) {
  const filter = normalizeFilter(listener?.filter);
  const item = event?.payload || {};
  const category = String(item.category || '').trim().toLowerCase();
  const title = String(item.title || '').trim();
  if (listener?.provider === 'granola' && event?.type === 'granola.webhook' && item.completed !== true) {
    return { decision: 'ignore', reason: 'unsupported_granola_event' };
  }
  for (const rule of filter.rules) {
    const candidate = String(item[rule.field] || '');
    if (new RegExp(rule.match, 'i').test(candidate)) return { decision: rule.outcome, reason: `rule:${rule.field}:${rule.match}` };
  }
  if (filter.ignore_categories.some((value) => value.toLowerCase() === category)) return { decision: 'ignore', reason: 'ignored_category' };
  if (filter.full_categories.some((value) => value.toLowerCase() === category)) return { decision: 'full', reason: 'full_category' };
  if (filter.summary_categories.some((value) => value.toLowerCase() === category)) return { decision: 'summary', reason: 'summary_category' };
  if (filter.ignore_title_patterns.some((pattern) => new RegExp(pattern, 'i').test(title))) return { decision: 'ignore', reason: 'ignored_title' };
  if (filter.ignore_if.some((pattern) => new RegExp(pattern, 'i').test(JSON.stringify(item)))) return { decision: 'ignore', reason: 'ignored_payload' };
  return { decision: event?.capture_policy?.default_mode || listener?.capture_policy?.default_mode || 'full', reason: 'default_policy' };
}

export function createEmptyEventInbox() {
  return { version: INBOUND_EVENTS_VERSION, origin_events: {}, deliveries: {}, outcomes: {}, collectors: {}, updated_at: null };
}

export function normalizeEventInbox(value) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    version: INBOUND_EVENTS_VERSION,
    origin_events: input.origin_events && typeof input.origin_events === 'object' ? input.origin_events : {},
    deliveries: input.deliveries && typeof input.deliveries === 'object' ? input.deliveries : {},
    outcomes: input.outcomes && typeof input.outcomes === 'object' ? input.outcomes : {},
    collectors: input.collectors && typeof input.collectors === 'object' ? input.collectors : {},
    updated_at: input.updated_at || null,
  };
}

export class EventRegistryStore {
  constructor({ filePath = defaultEventRegistryPath(), runtimeId = null, runtimeKind = 'client', now = () => new Date() } = {}) {
    this.filePath = path.resolve(filePath);
    this.runtimeId = runtimeId;
    this.runtimeKind = runtimeKind;
    this.now = now;
    this.value = null;
    this.mtimeMs = null;
  }

  async load() {
    const raw = await fs.readFile(this.filePath, 'utf8').catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (raw === null) {
      this.value = createEmptyEventRegistry({ runtimeId: this.runtimeId, runtimeKind: this.runtimeKind });
      this.mtimeMs = null;
      return this.value;
    }
    this.value = normalizeEventRegistry(JSON.parse(raw), { runtimeId: this.runtimeId, runtimeKind: this.runtimeKind });
    this.mtimeMs = (await fs.stat(this.filePath)).mtimeMs;
    return this.value;
  }

  async get() {
    const stat = await fs.stat(this.filePath).catch(() => null);
    if (!this.value || (stat && stat.mtimeMs !== this.mtimeMs) || (!stat && this.mtimeMs !== null)) return this.load();
    return this.value;
  }

  async save(value, { audit = null } = {}) {
    return withFileLock(`${this.filePath}.lock`, async () => {
      const current = await readJson(this.filePath, createEmptyEventRegistry({ runtimeId: this.runtimeId, runtimeKind: this.runtimeKind }));
      const next = normalizeEventRegistry({
        ...current,
        ...value,
        revision: Number(current.revision || 0) + 1,
        updated_at: this.now().toISOString(),
        audit: audit ? [...(Array.isArray(current.audit) ? current.audit : []), { ...audit, at: this.now().toISOString() }].slice(-200) : current.audit,
      }, { runtimeId: this.runtimeId, runtimeKind: this.runtimeKind });
      await atomicWriteJson(this.filePath, next);
      this.value = next;
      this.mtimeMs = (await fs.stat(this.filePath)).mtimeMs;
      return next;
    });
  }

  async update(mutator, options = {}) {
    const current = await this.get();
    return this.save(await mutator(structuredClone(current)), options);
  }
}

export class EventInboxStore {
  constructor({ filePath = defaultEventInboxPath(), now = () => new Date() } = {}) {
    this.filePath = path.resolve(filePath);
    this.now = now;
    this.value = null;
    this.mtimeMs = null;
  }

  async load() {
    const raw = await fs.readFile(this.filePath, 'utf8').catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    this.value = normalizeEventInbox(raw === null ? createEmptyEventInbox() : JSON.parse(raw));
    this.mtimeMs = raw === null ? null : (await fs.stat(this.filePath)).mtimeMs;
    return this.value;
  }

  async get() {
    const stat = await fs.stat(this.filePath).catch(() => null);
    if (!this.value || (stat && stat.mtimeMs !== this.mtimeMs) || (!stat && this.mtimeMs !== null)) return this.load();
    return this.value;
  }

  async enqueue(event, { deliveryId = null, clientId = 'local-client', subscriptionId = null, deliveryOnly = false } = {}) {
    return withFileLock(`${this.filePath}.lock`, async () => {
      const state = normalizeEventInbox(await readJson(this.filePath, createEmptyEventInbox()));
      const normalized = normalizeEventEnvelope(event, { now: this.now() });
      const existingOrigin = state.origin_events[normalized.origin_id];
      const resolvedDeliveryId = deliveryId || `${normalized.origin_id}:${clientId}`;
      if (!existingOrigin) {
        state.origin_events[normalized.origin_id] = {
          origin_id: normalized.origin_id,
          event_id: normalized.event_id,
          listener_id: normalized.listener_id,
          received_at: normalized.received_at,
          source_scope: normalized.source_scope,
        };
      }
      const existing = state.deliveries[resolvedDeliveryId];
      if (existing) return { duplicate: true, event: existing, state };
      const record = {
        delivery_id: resolvedDeliveryId,
        origin_id: normalized.origin_id,
        client_id: clientId,
        subscription_id: subscriptionId,
        delivery_only: deliveryOnly === true,
        ...normalized,
        state: 'received',
        attempts: 0,
        received_at: normalized.received_at,
        started_at: null,
        finished_at: null,
        outcome: null,
        execution_id: null,
        thread_id: null,
        last_error: null,
      };
      state.deliveries[resolvedDeliveryId] = record;
      state.updated_at = this.now().toISOString();
      await atomicWriteJson(this.filePath, state);
      this.value = state;
      this.mtimeMs = (await fs.stat(this.filePath)).mtimeMs;
      return { duplicate: false, event: record, state };
    });
  }

  async updateCollector(listenerId, value) {
    return withFileLock(`${this.filePath}.lock`, async () => {
      const state = normalizeEventInbox(await readJson(this.filePath, createEmptyEventInbox()));
      state.collectors[listenerId] = { ...(state.collectors[listenerId] || {}), ...value };
      state.updated_at = this.now().toISOString();
      await atomicWriteJson(this.filePath, state);
      this.value = state;
      this.mtimeMs = (await fs.stat(this.filePath)).mtimeMs;
      return state.collectors[listenerId];
    });
  }

  async update(deliveryId, mutator) {
    return withFileLock(`${this.filePath}.lock`, async () => {
      const state = normalizeEventInbox(await readJson(this.filePath, createEmptyEventInbox()));
      const current = state.deliveries[deliveryId];
      if (!current) throw new Error(`Event delivery not found: ${deliveryId}`);
      const next = await mutator(structuredClone(current), state);
      state.deliveries[deliveryId] = next;
      state.updated_at = this.now().toISOString();
      if (next.outcome) state.outcomes[deliveryId] = summarizeEventOutcome(next);
      await atomicWriteJson(this.filePath, state);
      this.value = state;
      this.mtimeMs = (await fs.stat(this.filePath)).mtimeMs;
      return next;
    });
  }

  async claim(deliveryId) {
    return withFileLock(`${this.filePath}.lock`, async () => {
      const state = normalizeEventInbox(await readJson(this.filePath, createEmptyEventInbox()));
      const current = state.deliveries[deliveryId];
      if (!current) throw new Error(`Event delivery not found: ${deliveryId}`);
      if (!['received', 'failed'].includes(current.state)) return withClaimFlag(current, false);
      const event = { ...current, state: 'running', attempts: Number(current.attempts || 0) + 1, started_at: this.now().toISOString(), last_error: null };
      state.deliveries[deliveryId] = event;
      state.updated_at = this.now().toISOString();
      await atomicWriteJson(this.filePath, state);
      this.value = state;
      this.mtimeMs = (await fs.stat(this.filePath)).mtimeMs;
      return withClaimFlag(event, true);
    });
  }

  async complete(deliveryId, { state = 'filed', outcome = {}, executionId = null, threadId = null, executionMeta = null, retainRaw = false } = {}) {
    if (!['filed', 'ignored'].includes(state)) throw new Error(`Terminal event state must be filed or ignored, got ${state}.`);
    return this.update(deliveryId, (event) => {
      const next = { ...event, state, finished_at: this.now().toISOString(), outcome, execution_id: executionId || event.execution_id, thread_id: threadId || event.thread_id, execution_meta: executionMeta || event.execution_meta || null, last_error: null };
      if (!retainRaw) {
        next.raw_payload = null;
        next.payload = state === 'ignored' ? null : next.payload;
        if (state === 'filed' && next.metadata?.source_document) {
          next.metadata = {
            ...next.metadata,
            source_document: Object.fromEntries(Object.entries(next.metadata.source_document).filter(([key]) => !['raw_body', 'text'].includes(key))),
          };
        }
      }
      return next;
    });
  }

  async fail(deliveryId, error, { quarantine = false, executionId = null, threadId = null, executionMeta = null } = {}) {
    return this.update(deliveryId, (event) => ({
      ...event,
      state: quarantine ? 'quarantined' : 'failed',
      finished_at: this.now().toISOString(),
      last_error: String(error instanceof Error ? error.message : error),
      execution_id: executionId || event.execution_id,
      thread_id: threadId || event.thread_id,
      execution_meta: executionMeta || event.execution_meta || null,
      error_details: executionMeta?.error_details || event.error_details || null,
      outcome: { status: quarantine ? 'quarantined' : 'failed' },
    }));
  }

  async retry(deliveryId) {
    return this.update(deliveryId, (event) => {
      if (!['failed', 'quarantined'].includes(event.state)) throw new Error(`Only failed or quarantined events can be retried: ${deliveryId}`);
      return { ...event, state: 'received', finished_at: null, outcome: null, last_error: null };
    });
  }

  async discard(deliveryId, reason = 'discarded') {
    return this.complete(deliveryId, { state: 'ignored', outcome: { status: 'ignored', reason }, retainRaw: false });
  }

  async quarantine(deliveryId, reason = 'quarantined') {
    return this.fail(deliveryId, reason, { quarantine: true });
  }

  async list({ state = null, listenerId = null, type = null, limit = 100, includeDeliveryOnly = true } = {}) {
    const inbox = await this.get();
    return Object.values(inbox.deliveries)
      .filter((event) => (!state || event.state === state) && (!listenerId || event.listener_id === listenerId) && (!type || event.type === type) && (includeDeliveryOnly || !event.delivery_only))
      .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)))
      .slice(0, Math.max(1, Math.min(Number(limit) || 100, 1000)));
  }

  async prune({ retentionDays = DEFAULT_EVENT_RETENTION_DAYS, now = this.now() } = {}) {
    return withFileLock(`${this.filePath}.lock`, async () => {
      const state = normalizeEventInbox(await readJson(this.filePath, createEmptyEventInbox()));
      const cutoff = new Date(now).getTime() - positiveInteger(retentionDays, DEFAULT_EVENT_RETENTION_DAYS) * 86_400_000;
      const removed = [];
      for (const [id, event] of Object.entries(state.deliveries)) {
        if (event.finished_at && Date.parse(event.finished_at) < cutoff) {
          removed.push(id);
          delete state.deliveries[id];
          delete state.outcomes[id];
        }
      }
      const activeOrigins = new Set(Object.values(state.deliveries).map((event) => event.origin_id));
      for (const originId of Object.keys(state.origin_events)) if (!activeOrigins.has(originId)) delete state.origin_events[originId];
      state.updated_at = this.now().toISOString();
      await atomicWriteJson(this.filePath, state);
      this.value = state;
      this.mtimeMs = (await fs.stat(this.filePath)).mtimeMs;
      return { removed, remaining: Object.keys(state.deliveries).length };
    });
  }
}

export class InboundEventProcessor {
  constructor({ registryStore, inboxStore, executorFactory, filingBroker = null, logger = console, now = () => new Date() } = {}) {
    if (!registryStore || !inboxStore) throw new Error('Inbound event processor requires registryStore and inboxStore.');
    this.registryStore = registryStore;
    this.inboxStore = inboxStore;
    this.executorFactory = executorFactory;
    this.filingBroker = filingBroker;
    this.logger = logger;
    this.now = now;
  }

  async process(deliveryId) {
    const inbox = await this.inboxStore.get();
    const event = inbox.deliveries[deliveryId];
    if (!event) throw new Error(`Event delivery not found: ${deliveryId}`);
    if (!['received', 'failed'].includes(event.state)) return event;
    const registry = await this.registryStore.get();
    const listener = registry.listeners.find((candidate) => candidate.id === event.listener_id);
    if (!listener || listener.removed || !listener.enabled) return this.inboxStore.fail(deliveryId, `Listener ${event.listener_id} is not active.`, { quarantine: true });
    if (event.delivery_only) return event;
    const claimed = await this.inboxStore.claim(deliveryId);
    if (!claimed.claimed) return claimed;
    const processingEvent = claimed;
    const classification = classifyEvent(processingEvent, listener);
    if (classification.decision === 'ignore') {
      return this.inboxStore.complete(deliveryId, {
        state: 'ignored',
        outcome: { status: 'ignored', reason: classification.reason, capture_mode: 'none' },
        executionId: `policy-${this.now().getTime()}`,
        executionMeta: { mode: 'policy', exit_status: 0 },
        retainRaw: listener.capture_policy.retain_raw,
      });
    }
    const allowedDestinations = resolveAllowedDestinations(registry, processingEvent, listener);
    let execution = null;
    try {
      if (processingEvent.execution.location !== registry.runtime.kind) {
        throw new Error(`Event requires Codex processing on ${processingEvent.execution.location}, but this runtime is ${registry.runtime.kind}.`);
      }
      const executor = await this.executorFactory({ mode: processingEvent.execution.mode, location: processingEvent.execution.location, listener, registry });
      if (!executor || typeof executor.execute !== 'function') throw new Error(`No Codex executor is configured for ${processingEvent.execution.location}/${processingEvent.execution.mode}.`);
      execution = await executor.execute({ event: { ...processingEvent, capture_policy: { ...processingEvent.capture_policy, default_mode: classification.decision } }, listener, allowedDestinations });
      if (processingEvent.type === 'rss.item') {
        return this.inboxStore.complete(deliveryId, {
          state: 'filed',
          outcome: {
            status: 'filed',
            capture_mode: classification.decision,
            reason: 'Completed the normal Codex article-ingestion task.',
            destinations: [],
          },
          executionId: execution?.execution_id,
          threadId: execution?.thread_id,
          executionMeta: executionMetadata(execution),
          retainRaw: listener.capture_policy.retain_raw,
        });
      }
      const outcome = execution?.outcome
        ? normalizeCodexOutcome(execution.outcome, { defaultBrainId: processingEvent.allowed_brain_ids?.length === 1 ? processingEvent.allowed_brain_ids[0] : null })
        : null;
      const executionMeta = executionMetadata(execution);
      if (!execution?.outcome) {
        return this.inboxStore.complete(deliveryId, {
          state: 'filed',
          outcome: {
            status: 'filed',
            capture_mode: classification.decision,
            reason: `Completed by the ${execution?.mode || 'Codex'} event-ingestion task.`,
            destinations: [],
          },
          executionId: execution?.execution_id,
          threadId: execution?.thread_id,
          executionMeta,
          retainRaw: listener.capture_policy.retain_raw,
        });
      }
      if (outcome.status === 'ignored') {
        return this.inboxStore.complete(deliveryId, {
          state: 'ignored',
          outcome,
          executionId: execution.execution_id,
          threadId: execution.thread_id,
          executionMeta,
          retainRaw: listener.capture_policy.retain_raw,
        });
      }
      if (outcome.status !== 'filed') {
        return this.inboxStore.fail(deliveryId, outcome.reason || 'Codex requires review.', { quarantine: true, executionId: execution.execution_id, threadId: execution.thread_id, executionMeta });
      }
      const filing = this.filingBroker ? await this.filingBroker.file({ ...processingEvent, execution_id: execution.execution_id, thread_id: execution.thread_id }, outcome) : { status: 'filed', destinations: [] };
      return this.inboxStore.complete(deliveryId, {
        state: 'filed',
        outcome: { ...outcome, filing },
        executionId: execution.execution_id,
        threadId: execution.thread_id,
        executionMeta,
        retainRaw: listener.capture_policy.retain_raw,
      });
    } catch (error) {
      this.logger.error?.(`BigBrain inbound event ${deliveryId} failed: ${error.message}`);
      return this.inboxStore.fail(deliveryId, error, { executionId: error.execution_id || execution?.execution_id || null, threadId: error.thread_id || execution?.thread_id || null, executionMeta: error.execution_meta || executionMetadata(execution) || null });
    }
  }

  async drain({ limit = 10, type = null } = {}) {
    const pending = await this.inboxStore.list({ state: 'received', type, limit, includeDeliveryOnly: false });
    const results = [];
    for (const event of pending) results.push(await this.process(event.delivery_id));
    return results;
  }
}

export class InboundEventRuntime {
  constructor({
    registryPath = defaultEventRegistryPath(),
    inboxPath = defaultEventInboxPath(),
    lockPath = `${registryPath}.runtime.lock`,
    webhook = {},
    fetchImpl = globalThis.fetch,
    executorFactory = null,
    filingBroker = null,
    credentialResolver = resolveCredentialRef,
    logger = console,
    now = () => new Date(),
  } = {}) {
    this.registryStore = new EventRegistryStore({ filePath: registryPath, now });
    this.inboxStore = new EventInboxStore({ filePath: inboxPath, now });
    this.lockPath = path.resolve(lockPath);
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.logger = logger;
    this.credentialResolver = credentialResolver;
    this.collector = new RssCollector({ registryStore: this.registryStore, inboxStore: this.inboxStore, fetchImpl, secretResolver: credentialResolver, now, logger });
    this.webhookConfig = webhook;
    this.webhookServer = null;
    this.webhookError = null;
    this.executorFactory = executorFactory || defaultExecutorFactory;
    this.filingBroker = filingBroker || new ScopedFilingBroker({
      brainRegistry: () => this.registryStore.value?.brains || [],
      mcpFactory: async (brain) => {
        if (!brain.mcp_url) throw new Error(`Registered Brain ${brain.id} has no MCP endpoint.`);
        return new SimpleMcpHttpClient({ url: brain.mcp_url, fetchImpl, credentialRef: brain.credential_ref, credentialResolver });
      },
    });
    this.processor = new InboundEventProcessor({ registryStore: this.registryStore, inboxStore: this.inboxStore, executorFactory: this.executorFactory, filingBroker: this.filingBroker, logger, now });
    this.rssTimer = null;
  }

  async start({ once = false } = {}) {
    await acquireRuntimeLock(this.lockPath);
    this.lockAcquired = true;
    try {
      await this.registryStore.get();
      await this.inboxStore.get();
      if (this.webhookConfig.enabled !== false) {
        this.webhookServer = new InboundWebhookServer({ registryStore: this.registryStore, inboxStore: this.inboxStore, ...this.webhookConfig, onAccepted: (deliveryId) => this.processor.process(deliveryId), now: this.now, logger: this.logger });
        try {
          await this.webhookServer.start();
          this.webhookError = null;
        } catch (error) {
          this.webhookError = error instanceof Error ? error.message : String(error);
          await this.webhookServer.close().catch(() => {});
          this.webhookServer = null;
          this.logger.error?.(`BigBrain webhook server failed: ${this.webhookError}`);
        }
      }
      const report = await this.runRssCycle();
      const processed = report.processed;
      const firstReport = { ...report, processed: processed.map(summarizeEventOutcome) };
      if (once) return { firstReport, close: () => this.close() };
      const intervalMs = Math.max(10_000, Number((await this.registryStore.get()).poll_interval_ms || 300_000));
      this.rssTimer = setInterval(() => this.runRssCycle().catch((error) => this.logger.error?.(`BigBrain RSS cycle failed: ${error.message}`)), intervalMs);
      this.rssTimer.unref?.();
      return { firstReport, close: () => this.close() };
    } catch (error) {
      await this.webhookServer?.close().catch(() => {});
      this.webhookServer = null;
      await this.releaseRuntimeLock();
      throw error;
    }
  }

  async close() {
    if (this.rssTimer) clearInterval(this.rssTimer);
    this.rssTimer = null;
    await this.webhookServer?.close();
    this.webhookServer = null;
    await this.releaseRuntimeLock();
  }

  async releaseRuntimeLock() {
    if (!this.lockAcquired) return;
    this.lockAcquired = false;
    const lock = await fs.readFile(this.lockPath, 'utf8').catch(() => null);
    if (!lock) return;
    try {
      if (JSON.parse(lock).pid !== process.pid) return;
    } catch {
      return;
    }
    await fs.rm(this.lockPath, { force: true });
  }

  async runRssCycle() {
    let registry = null;
    let report = { listeners: [], ingested: 0, duplicates: 0, errors: [] };
    try {
      registry = await this.registryStore.get();
      report = await this.collector.pollAll({ limit: DEFAULT_RSS_POLL_LIMIT });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.errors.push({ scope: 'rss', message });
      this.logger.error?.(`BigBrain RSS cycle failed: ${message}`);
    }
    let processed = [];
    try {
      const deliveryIds = report.listeners.flatMap((listener) => listener.delivery_ids || []);
      for (const deliveryId of deliveryIds.slice(0, 25)) processed.push(await this.processor.process(deliveryId));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.errors.push({ scope: 'rss_processing', message });
      this.logger.error?.(`BigBrain RSS processing failed: ${message}`);
    }
    if (registry) await this.inboxStore.prune({ retentionDays: registry.retention_days }).catch((error) => this.logger.error?.(`BigBrain RSS retention failed: ${error.message}`));
    return { ...report, processed };
  }

  async runCycle() {
    return this.runRssCycle();
  }
}

export function defaultExecutorFactory({ mode, ...options }) {
  return mode === 'cli' ? new CodexCliExecutor(options) : new CodexAppThreadExecutor(options);
}

export function hmacSignature(body, secret) {
  return `sha256=${crypto.createHmac('sha256', String(secret)).update(String(body)).digest('hex')}`;
}

export class SimpleMcpHttpClient {
  constructor({ url, fetchImpl = globalThis.fetch, credential = null, credentialRef = null, credentialResolver = resolveCredentialRef } = {}) {
    if (!url || typeof fetchImpl !== 'function') throw new Error('MCP client requires a URL and fetch implementation.');
    this.url = url;
    this.fetchImpl = fetchImpl;
    this.credential = credential;
    this.credentialRef = credentialRef;
    this.credentialResolver = credentialResolver;
    this.nextId = 1;
    this.initialized = false;
  }

  async callTool(name, args = {}) {
    if (!this.initialized) {
      await this.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'bigbrain-inbound-events', version: '2.0.0' } });
      this.initialized = true;
    }
    const result = await this.request('tools/call', { name, arguments: args });
    if (result?.isError) throw new Error(`MCP tool ${name} failed.`);
    if (result?.structuredContent !== undefined) return result.structuredContent;
    const text = result?.content?.find((entry) => entry.type === 'text')?.text;
    if (text === undefined) return result;
    try { return JSON.parse(text); } catch { return text; }
  }

  async request(method, params) {
    const id = this.nextId++;
    const credential = this.credential || await this.credentialResolver?.(this.credentialRef);
    const headers = { 'content-type': 'application/json', accept: 'application/json' };
    if (typeof credential === 'string' && credential.trim()) headers.authorization = credential.startsWith('Bearer ') ? credential : `Bearer ${credential}`;
    if (credential && typeof credential === 'object' && credential.headers) Object.assign(headers, credential.headers);
    const response = await this.fetchImpl(this.url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
    const value = await response.json().catch(() => null);
    if (!response.ok || value?.error) throw new Error(value?.error?.message || `MCP request ${method} failed with HTTP ${response.status}.`);
    return value?.result;
  }
}

export async function resolveCredentialRef(reference, env = process.env) {
  if (!reference) return null;
  const value = String(typeof reference === 'object' ? reference.credential_ref || reference.secret_ref || '' : reference).trim();
  if (value.startsWith('env:')) return env[value.slice(4)] || null;
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return env[value] || env[`BIGBRAIN_CREDENTIAL_${normalized}`] || env[`BIGBRAIN_EVENT_SECRET_${normalized}`] || null;
}

export function timingSafeEqual(actual, expected) {
  const left = Buffer.from(String(actual || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function parseRssDocument(xml) {
  const channel = firstTag(xml, 'channel');
  const atomFeed = !channel && firstTag(xml, 'feed');
  const container = channel || atomFeed;
  if (!container) throw new Error('RSS or Atom document has no feed container.');
  const atom = Boolean(atomFeed);
  const itemTag = atom ? 'entry' : 'item';
  return {
    title: firstTagText(container, 'title'),
    description: firstTagText(container, atom ? 'subtitle' : 'description'),
    link: atom ? firstTagAttr(container, 'link', 'href') || firstTagText(container, 'link') : firstTagText(container, 'link'),
    items: allTags(container, itemTag).map((raw) => ({
      raw,
      title: firstTagText(raw, 'title'),
      description: firstTagText(raw, atom ? 'summary' : 'description') || firstTagText(raw, atom ? 'content' : 'description'),
      link: atom ? firstTagAttr(raw, 'link', 'href') || firstTagText(raw, 'link') : firstTagText(raw, 'link'),
      guid: firstTagText(raw, atom ? 'id' : 'guid'),
      pubDate: firstTagText(raw, atom ? 'published' : 'pubDate') || firstTagText(raw, atom ? 'updated' : 'pubDate'),
      category: atom ? firstTagAttr(raw, 'category', 'term') || firstTagText(raw, 'category') : firstTagText(raw, 'category'),
    })).filter((item) => item.title && (item.link || item.guid)),
  };
}

function firstTag(xml, name) {
  return String(xml || '').match(new RegExp(`<(?:(?:[a-z0-9_-]+):)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[a-z0-9_-]+):)?${name}>`, 'i'))?.[1] || '';
}

function allTags(xml, name) {
  return Array.from(String(xml || '').matchAll(new RegExp(`<(?:(?:[a-z0-9_-]+):)?${name}\\b[^>]*>[\\s\\S]*?<\\/(?:(?:[a-z0-9_-]+):)?${name}>`, 'gi')), (match) => match[0]);
}

function firstTagText(xml, name) {
  return cleanText(firstTag(xml, name));
}

function firstTagAttr(xml, name, attribute) {
  return cleanText(String(xml || '').match(new RegExp(`<(?:(?:[a-z0-9_-]+):)?${name}\\b[^>]*\\b${attribute}=["']([^"']+)["'][^>]*\\/?\\s*>`, 'i'))?.[1] || '');
}

function resolveAllowedDestinations(registry, event, listener) {
  const explicit = normalizeStringArray(event.allowed_brain_ids);
  const allowed = new Set(explicit.length ? explicit : listener.brain_ids);
  if (explicit.length) return [...allowed].map((id) => ({ id, name: id }));
  const subscriptions = registry.subscriptions.filter((subscription) => subscription.listener_id === listener.id && subscription.enabled);
  for (const subscription of subscriptions) for (const brainId of subscription.brain_ids) allowed.add(brainId);
  return [...allowed].map((id) => ({ id, name: id }));
}

export async function readBody(request, maxBytes) {
  let total = 0;
  const chunks = [];
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error(`Request body is too large: ${total} bytes.`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function trimObject(value, limit) {
  return Object.fromEntries(Object.entries(value || {}).sort(([, left], [, right]) => String(left).localeCompare(String(right))).slice(-limit));
}

export function isAfterRssCursor(listenerId, item, cursorAt, cursorId = null) {
  const cursor = rssCursorForItem(listenerId, item);
  if (!cursor || !cursorAt || Number.isNaN(Date.parse(cursorAt))) return false;
  return compareRssCursors(cursor, { cursor_at: cursorAt, cursor_id: cursorId || null }) > 0;
}

function compareRssCursors(left, right) {
  return Date.parse(left.cursor_at) - Date.parse(right.cursor_at) || String(left.cursor_id || '').localeCompare(String(right.cursor_id || ''));
}

export function latestRssCursor(listenerId, items) {
  return items.map((item) => rssCursorForItem(listenerId, item)).filter(Boolean).sort((left, right) => (
    Date.parse(right.cursor_at) - Date.parse(left.cursor_at) || right.cursor_id.localeCompare(left.cursor_id)
  ))[0] || null;
}

export function rssCursorForItem(listenerId, item) {
  const rawDate = item?.published_at || item?.publishedAt || item?.pubDate || item?.pub_date;
  const timestamp = rawDate && !Number.isNaN(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : null;
  if (!timestamp) return null;
  return {
    cursor_at: timestamp,
    cursor_id: stableSourceEventId(listenerId, item?.guid || item?.link || `${item?.title || ''}:${item?.pubDate || item?.pub_date || ''}`),
  };
}

function withClaimFlag(event, claimed) {
  const result = { ...event };
  Object.defineProperty(result, 'claimed', { value: claimed, enumerable: false });
  return result;
}

export function summarizeEventOutcome(event) {
  return {
    delivery_id: event.delivery_id,
    origin_id: event.origin_id,
    event_id: event.event_id,
    listener_id: event.listener_id,
    state: event.state,
    received_at: event.received_at,
    finished_at: event.finished_at,
    execution_id: event.execution_id || null,
    thread_id: event.thread_id || null,
    outcome: event.outcome || null,
    execution_meta: event.execution_meta || null,
    last_error: event.last_error || null,
  };
}

function executionMetadata(execution) {
  if (!execution) return null;
  return {
    mode: execution.mode || null,
    exit_status: Number.isInteger(execution.exit_status) ? execution.exit_status : 0,
    stderr: typeof execution.stderr === 'string' && execution.stderr ? execution.stderr.slice(-20_000) : null,
    notification_count: Array.isArray(execution.notifications) ? execution.notifications.length : null,
  };
}

export function provenanceForEvent(event, { capturedAs = null } = {}) {
  const sourceType = sourceTypeForEvent(event);
  const sourceLabel = event.source?.display_name || event.listener_id || 'Inbound source';
  return {
    event_id: event.event_id,
    origin_id: event.origin_id,
    listener_id: event.listener_id,
    source_type: sourceType,
    source_label: sourceLabel,
    source_message: sourceMessageForEvent(event, sourceLabel),
    source_icon: event.source?.icon || null,
    source_url: event.source?.endpoint || null,
    codex_thread_id: event.thread_id || null,
    codex_execution_id: event.execution_id || null,
    occurred_at: event.occurred_at || null,
    received_at: event.received_at || null,
    raw_ref: event.raw_ref || event.metadata?.raw_ref || null,
    outcome: capturedAs ? `captured:${capturedAs}` : 'filed',
  };
}

function sourceMessageForEvent(event, fallback) {
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
  const payloadText = typeof event?.payload === 'string' ? event.payload : null;
  const sourceDocument = event?.metadata?.source_document && typeof event.metadata.source_document === 'object'
    ? event.metadata.source_document
    : {};
  const candidates = [
    event?.source_message,
    event?.metadata?.source_message,
    payloadText,
    payload.message,
    payload.text,
    payload.body,
    payload.content,
    payload.subject,
    payload.title,
    payload.description,
    sourceDocument.message,
    sourceDocument.text,
    sourceDocument.subject,
    event?.source?.description,
    fallback,
  ];
  const value = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim());
  return String(value || fallback || 'Source message unavailable').trim().slice(0, 4000);
}

export function sourceTypeForEvent(event) {
  const provider = String(event?.source?.provider || event?.provider || '').trim().toLowerCase();
  if (provider === 'whatsapp') return 'whatsapp';
  if (provider === 'gmail' || provider === 'email') return 'gmail';
  if (provider === 'google_calendar' || provider === 'calendar') return 'google_calendar';
  if (provider === 'granola') return 'granola';
  if (provider === 'rss' || event?.type === 'rss.item') return 'rss';
  if (event?.source?.type === 'rss') return 'rss';
  if (event?.source?.type === 'webhook' || String(event?.type || '').startsWith('webhook.')) return 'webhook';
  return normalizeSourceType(provider || event?.type?.split('.')?.[0]);
}

export class ScopedFilingBroker {
  constructor({ brainRegistry, mcpFactory, sync = null } = {}) {
    this.brainRegistry = brainRegistry;
    this.mcpFactory = mcpFactory;
    this.sync = sync;
  }

  allowedBrainIds(event) {
    return new Set(normalizeStringArray(event?.allowed_brain_ids));
  }

  assertAllowedBrain(event, brainId) {
    if (!this.allowedBrainIds(event).has(brainId)) throw new Error(`Brain ${brainId} is not an allowed destination for event ${event.event_id}.`);
    const brains = typeof this.brainRegistry === 'function' ? this.brainRegistry() : this.brainRegistry;
    const brain = brains?.find?.((candidate) => candidate.id === brainId || candidate.brain_id === brainId);
    if (!brain) throw new Error(`Brain ${brainId} is not registered on this client.`);
    return brain;
  }

  async file(event, outcome) {
    if (!outcome || typeof outcome !== 'object') throw new Error('Codex filing outcome must be an object.');
    if (outcome.status === 'ignored') return { status: 'ignored', destinations: [] };
    if (!['filed', 'needs_review'].includes(outcome.status)) throw new Error(`Unsupported Codex filing status: ${outcome.status}`);
    if (outcome.status === 'needs_review') return { status: 'needs_review', destinations: [] };
    const destinations = Array.isArray(outcome.destinations) ? outcome.destinations : [];
    if (!destinations.length) throw new Error('Filed Codex outcome must name at least one destination.');
    const results = [];
    for (const destination of destinations) {
      const brain = this.assertAllowedBrain(event, destination.brain_id);
      const client = await this.mcpFactory(brain);
      const existingProvenance = await this.findExistingProvenance(client, event.event_id);
      if (existingProvenance.length) {
        const provenance = provenanceForEvent(event, { capturedAs: outcome.capture_mode || null });
        for (const row of existingProvenance) {
          await client.callTool('events/provenance', {
            path: row.page_slug,
            commit_message: row.commit_message || `Refresh provenance for ${provenance.source_label}`,
            provenance,
          });
        }
        results.push({ brain_id: destination.brain_id, duplicate: true, writes: [], provenance: existingProvenance, provenance_updated: true });
        continue;
      }
      const writes = Array.isArray(destination.writes) ? destination.writes : [];
      const brainResults = [];
      for (const write of writes) brainResults.push(await this.applyWrite(client, write, provenanceForEvent(event, { capturedAs: outcome.capture_mode || null }), event));
      if (this.sync) await this.sync(brain);
      results.push({ brain_id: destination.brain_id, writes: brainResults });
    }
    return { status: 'filed', destinations: results };
  }

  async findExistingProvenance(client, eventId) {
    if (!eventId || typeof client?.callTool !== 'function') return [];
    try {
      const result = await client.callTool('events/provenance_list', { event_id: eventId, limit: 100 });
      const rows = result?.provenance || result?.structuredContent?.provenance || [];
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      if (/unknown tool|tool .* not found|method not found/i.test(String(error?.message || ''))) return [];
      throw error;
    }
  }

  async applyWrite(client, write, provenance, event = null) {
    if (!write || typeof write !== 'object') throw new Error('Filing write must be an object.');
    const allowed = new Set(['create_page', 'update_page', 'create_raw_file_with_page']);
    if (!allowed.has(write.tool)) throw new Error(`Filing broker does not allow ${write.tool}.`);
    const args = { ...(write.arguments || {}) };
    const commitMessage = String(write.commit_message || args.commit_message || '').trim();
    if (!commitMessage) throw new Error(`Filing write ${write.tool} must include a short commit_message.`);
    args.commit_message = commitMessage;
    args.provenance = provenance;
    if (sourceTypeForEvent(event) === 'rss') assertRssWritePath(write.tool, args);
    if (write.tool === 'create_raw_file_with_page' && args.raw_content_source === 'event.source_document.raw_body') {
      const sourceDocument = event?.metadata?.source_document;
      if (sourceDocument?.status !== 'fetched' || typeof sourceDocument.raw_body !== 'string' || !sourceDocument.raw_body) {
        throw new Error('RSS source preservation requested but the canonical source body was not fetched.');
      }
      args.raw_content_text = sourceDocument.raw_body;
      delete args.raw_content_source;
    }
    if (write.tool === 'update_page') {
      args.body = String(args.body || '');
      args.timeline_entry = args.timeline_entry || `Updated from ${provenance.source_label}.`;
      await client.callTool('update_page', args);
      return client.callTool('read', { path: args.path });
    }
    const result = await client.callTool(write.tool, args);
    const pathValue = args.path || args.page_path;
    if (pathValue) {
      const readback = await client.callTool('read', { path: pathValue });
      if (!readback) throw new Error(`Missing canonical read-back for ${pathValue}.`);
      return readback;
    }
    return result;
  }
}

function assertRssWritePath(tool, args) {
  const paths = [args?.path, args?.page_path, args?.raw_path].filter(Boolean);
  for (const value of paths) {
    const normalized = String(value).replace(/\\/g, '/').replace(/^\/+/, '');
    const collection = normalized.split('/')[0];
    if (!DEFAULT_COLLECTIONS.includes(collection)) {
      throw new Error(`RSS filing may only write established Brain collections; rejected ${tool} path ${value}.`);
    }
  }
}

async function withFileLock(lockPath, action, { attempts = 80 } = {}) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  let handle = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      handle = await fs.open(lockPath, 'wx');
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (!handle) throw new Error(`Could not acquire event store lock: ${lockPath}`);
  try {
    return await action();
  } finally {
    await handle.close().catch(() => {});
    await fs.rm(lockPath, { force: true }).catch(() => {});
  }
}

async function acquireRuntimeLock(lockPath) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  try {
    const handle = await fs.open(lockPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`);
    await handle.close();
    return;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  const existing = await fs.readFile(lockPath, 'utf8').catch(() => null);
  let pid = null;
  try { pid = Number(JSON.parse(existing || '{}').pid); } catch { pid = null; }
  if (pid) {
    try {
      process.kill(pid, 0);
      throw new Error(`BigBrain inbound event runtime is already running as process ${pid}.`);
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
  await fs.rm(lockPath, { force: true });
  const handle = await fs.open(lockPath, 'wx', 0o600);
  await handle.writeFile(`${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`);
  await handle.close();
}

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, filePath);
}

async function readJson(filePath, fallback) {
  const raw = await fs.readFile(filePath, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  return raw === null ? fallback : JSON.parse(raw);
}

function normalizeHealth(value) {
  const input = value && typeof value === 'object' ? value : {};
  return { state: input.state || 'unknown', checked_at: input.checked_at || null, last_error: input.last_error || null };
}

function normalizeRelay(value) {
  const input = value && typeof value === 'object' ? value : {};
  return { enabled: input.enabled === true, url: optionalString(input.url), credential_ref: optionalString(input.credential_ref) };
}

function normalizeRegisteredBrain(value) {
  if (!value || typeof value !== 'object') throw new Error('Registered Brain must be an object.');
  const id = String(value.id || value.brain_id || '').trim();
  if (!id) throw new Error('Registered Brain requires id.');
  const mcpUrl = String(value.mcp_url || value.endpoint || value.service_url || '').trim();
  return { id, name: String(value.name || value.brain_name || id), mcp_url: mcpUrl || null, credential_ref: optionalString(value.credential_ref), kind: value.kind || 'local_runtime' };
}

function normalizeEndpoint(value, url) {
  const input = value && typeof value === 'object' ? value : {};
  const endpoint = {};
  for (const key of ['path', 'method', 'signature_header', 'signature_algorithm', 'content_type']) {
    if (typeof input[key] === 'string' && input[key].trim()) endpoint[key] = input[key].trim();
  }
  if (url) endpoint.url = url;
  return endpoint;
}

function normalizeRssItemText(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanText(value) {
  return normalizeRssItemText(String(value || '').replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
}

function sanitizePayload(value, depth = 0) {
  if (depth > 8) return '[depth-limited]';
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return typeof value === 'string' ? value.slice(0, 200_000) : value;
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => sanitizePayload(item, depth + 1));
  if (typeof value !== 'object') return String(value);
  return Object.fromEntries(Object.entries(value).slice(0, 500).filter(([key]) => !SECRET_KEYS.has(key.toLowerCase())).map(([key, item]) => [key, sanitizePayload(item, depth + 1)]));
}

function sanitizeEventMetadata(value) {
  const sanitized = sanitizePayload(value);
  const sourceDocument = value && typeof value === 'object' && value.source_document && typeof value.source_document === 'object'
    ? value.source_document
    : null;
  if (sourceDocument && sanitized?.source_document && typeof sourceDocument.raw_body === 'string') {
    sanitized.source_document.raw_body = truncateUtf8(sourceDocument.raw_body, DEFAULT_RSS_SOURCE_MAX_BYTES);
  }
  return sanitized;
}

function normalizeIdentifier(value, name) {
  const text = String(value || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(text)) throw new Error(`${name} must be a stable identifier using letters, numbers, dot, underscore, or hyphen.`);
  return text;
}

function normalizeRuntimeLocation(value) {
  const location = String(value || '').trim().toLowerCase();
  if (!RUNTIME_LOCATIONS.includes(location)) throw new Error(`Runtime location must be client or host, got ${value}.`);
  return location;
}

function requireEnum(value, values, name) {
  if (!values.includes(value)) throw new Error(`${name} must be one of ${values.join(', ')}.`);
  return value;
}

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeReasoningEffort(value) {
  const effort = optionalString(value)?.toLowerCase() || null;
  return effort ? requireEnum(effort, CODEX_REASONING_EFFORTS, 'listener.codex_reasoning_effort') : null;
}

function normalizeFieldPath(value, name) {
  const fieldPath = String(value || '').trim();
  if (!fieldPath || !/^[a-zA-Z0-9_.-]+$/.test(fieldPath)) throw new Error(`${name} must be a dot-separated field path.`);
  return fieldPath;
}

function normalizeFieldPaths(value, name) {
  return normalizeStringArray(value).map((fieldPath) => normalizeFieldPath(fieldPath, name));
}

function optionalIso(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))] : value ? [String(value).trim()] : [];
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function truncateUtf8(value, maxBytes) {
  const buffer = Buffer.from(String(value));
  if (buffer.byteLength <= maxBytes) return buffer.toString('utf8');
  return buffer.subarray(0, maxBytes).toString('utf8');
}

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function defaultSourceIcon(type) {
  return type === 'rss' ? 'Rss' : 'Webhook';
}

function validPattern(value) {
  try { new RegExp(value); return true; } catch { throw new Error(`Invalid inbound event filter pattern: ${value}`); }
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}
