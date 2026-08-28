import {
  DEFAULT_RSS_INITIAL_CURSOR_DAYS,
  DEFAULT_RSS_SOURCE_MAX_BYTES,
  DEFAULT_RSS_SOURCE_TIMEOUT_MS,
  createRssEventEnvelope,
  hmacSignature,
  isAfterRssCursor,
  latestRssCursor,
  legacyRssItemKey,
  normalizeRssItemForEvent,
  parseRssDocument,
  rssCursorForItem,
  stableSourceEventId,
  trimObject,
} from './inbound-events.js';

export const DEFAULT_RSS_MANUAL_BACKFILL_LIMIT = 25;

/**
 * RSS is deliberately poll-based. This module owns feed fetching, cursor
 * advancement, item deduplication, and optional subscription forwarding.
 */
export class RssCollector {
  constructor({ registryStore, inboxStore, fetchImpl = globalThis.fetch, secretResolver = () => null, now = () => new Date(), logger = console } = {}) {
    this.registryStore = registryStore;
    this.inboxStore = inboxStore;
    this.fetchImpl = fetchImpl;
    this.secretResolver = secretResolver;
    this.now = now;
    this.logger = logger;
    this.polling = false;
  }

  async pollAll() {
    if (this.polling) return { skipped: true, reason: 'poll already running' };
    this.polling = true;
    try {
      const registry = await this.registryStore.get();
      const report = { listeners: [], ingested: 0, duplicates: 0, errors: [] };
      for (const listener of registry.listeners.filter((item) => item.type === 'rss' && item.enabled && !item.removed && item.listener_location === registry.runtime.kind)) {
        try {
          const result = await this.poll(listener, registry);
          report.listeners.push(result);
          report.ingested += result.ingested || 0;
          report.duplicates += result.duplicates || 0;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          report.errors.push({ listener_id: listener.id, message });
          report.listeners.push({ listener_id: listener.id, status: 'error', message });
          await this.inboxStore.updateCollector(listener.id, { last_error: message, last_error_at: this.now().toISOString() }).catch(() => {});
          this.logger.error?.(`BigBrain RSS listener ${listener.id} failed: ${message}`);
        }
      }
      return report;
    } finally {
      this.polling = false;
    }
  }

  async poll(listener, registry) {
    const previous = (await this.inboxStore.get()).collectors[listener.id] || {};
    const headers = { 'user-agent': 'BigBrain Inbound RSS/2.0' };
    if (previous.etag) headers['if-none-match'] = previous.etag;
    if (previous.last_modified) headers['if-modified-since'] = previous.last_modified;
    const response = await this.fetchImpl(listener.url, { headers });
    const polledAt = this.now().toISOString();
    const next = {
      ...previous,
      last_poll_at: polledAt,
      etag: response.headers?.get?.('etag') || previous.etag || null,
      last_modified: response.headers?.get?.('last-modified') || previous.last_modified || null,
    };
    const firstPoll = !previous.initialized_at;
    const cursorAt = previous.cursor_at || (firstPoll ? new Date(this.now().getTime() - DEFAULT_RSS_INITIAL_CURSOR_DAYS * 86_400_000).toISOString() : previous.last_poll_at || previous.initialized_at || this.now().toISOString());
    const initialCursorAt = previous.initial_cursor_at || (firstPoll ? cursorAt : null);
    if (response.status === 304) {
      await this.inboxStore.updateCollector(listener.id, {
        ...next,
        initialized_at: previous.initialized_at || polledAt,
        initial_cursor_at: initialCursorAt,
        cursor_at: cursorAt,
        cursor_id: previous.cursor_id || null,
        last_success_at: polledAt,
        last_error: null,
      });
      return { listener_id: listener.id, status: 'not_modified', ingested: 0, duplicates: 0 };
    }
    if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}.`);
    const xml = await response.text();
    const feed = parseRssDocument(xml);
    const items = feed.items.map(normalizeRssItemForEvent).sort((a, b) => Date.parse(b.published_at || '') - Date.parse(a.published_at || ''));
    const eligible = items.filter((item) => isAfterRssCursor(listener.id, item, cursorAt, previous.cursor_id));
    const candidates = listener.bootstrap === 'all' ? eligible : listener.bootstrap === 'none' ? [] : eligible.slice(0, 1);
    const seen = { ...(previous.seen || {}) };
    let cursor = { cursor_at: cursorAt, cursor_id: previous.cursor_id || null };
    if (!previous.cursor_at) {
      await this.inboxStore.updateCollector(listener.id, {
        ...next,
        initialized_at: previous.initialized_at || polledAt,
        initial_cursor_at: initialCursorAt,
        cursor_at: cursor.cursor_at,
        cursor_id: cursor.cursor_id,
      });
    }
    const candidateKeys = new Set(candidates.map((item) => stableSourceEventId(listener.id, item.guid || item.link || `${item.title}:${item.pubDate}`)));
    for (const item of items) {
      const key = stableSourceEventId(listener.id, item.guid || item.link || `${item.title}:${item.pubDate}`);
      if (!candidateKeys.has(key)) seen[key] ||= polledAt;
    }
    let ingested = 0;
    let duplicates = 0;
    for (const item of candidates) {
      const key = stableSourceEventId(listener.id, item.guid || item.link || `${item.title}:${item.pubDate}`);
      const legacyKey = legacyRssItemKey(listener.id, item);
      if (seen[key] || previous.legacy_seen?.[legacyKey]) {
        duplicates += 1;
        seen[key] ||= previous.legacy_seen?.[legacyKey] || polledAt;
        continue;
      }
      const sourceDocument = await this.fetchSourceDocument(listener, item);
      const event = createRssEventEnvelope({ listener, item, feedXml: item.raw || xml, sourceDocument, now: this.now(), registry });
      const subscriptions = registry.subscriptions.filter((subscription) => subscription.listener_id === listener.id && subscription.enabled);
      const deliveries = subscriptions.length
        ? subscriptions
        : listener.listener_location === 'host' && listener.codex_execution_location === 'client'
          ? []
          : [{ client_id: registry.runtime.id, brain_ids: listener.brain_ids, id: null, delivery_url: null }];
      if (!deliveries.length) {
        const unassigned = await this.inboxStore.enqueue(event, { clientId: registry.runtime.id, deliveryOnly: true });
        if (!unassigned.duplicate) await this.inboxStore.complete(unassigned.event.delivery_id, { state: 'ignored', outcome: { status: 'ignored', reason: 'no_active_subscriptions', capture_mode: 'none' }, retainRaw: false });
        seen[key] = polledAt;
        continue;
      }
      let accepted = false;
      for (const subscription of deliveries) {
        const deliveryEvent = { ...event, allowed_brain_ids: subscription.brain_ids?.length ? subscription.brain_ids : event.allowed_brain_ids };
        if (subscription.delivery_url) {
          const queued = await this.inboxStore.enqueue(deliveryEvent, { clientId: subscription.client_id, subscriptionId: subscription.id || null, deliveryOnly: true });
          if (!queued.duplicate || ['received', 'failed'].includes(queued.event.state)) {
            try {
              await this.forwardSubscription(deliveryEvent, subscription);
              await this.inboxStore.complete(queued.event.delivery_id, { state: 'filed', outcome: { status: 'delivered', subscription_id: subscription.id || null }, retainRaw: false });
            } catch (error) {
              await this.inboxStore.fail(queued.event.delivery_id, error);
              throw error;
            }
          }
          accepted = true;
          continue;
        }
        const result = await this.inboxStore.enqueue(deliveryEvent, { clientId: subscription.client_id, subscriptionId: subscription.id || null });
        if (result.duplicate) duplicates += 1; else { ingested += 1; accepted = true; }
      }
      if (!accepted && subscriptions.length) continue;
      seen[key] = polledAt;
      const itemCursor = rssCursorForItem(listener.id, item);
      if (itemCursor && compareRssCursors(itemCursor, cursor) > 0) {
        cursor = itemCursor;
        next.cursor_at = cursor.cursor_at;
        next.cursor_id = cursor.cursor_id;
      }
      await this.inboxStore.updateCollector(listener.id, {
        ...next,
        seen: trimObject(seen, 2000),
        initialized_at: previous.initialized_at || polledAt,
        initial_cursor_at: initialCursorAt,
        cursor_at: cursor.cursor_at,
        cursor_id: cursor.cursor_id,
        last_item_key: key,
      });
    }
    const latest = latestRssCursor(listener.id, items);
    if (!candidates.length && latest && compareRssCursors(latest, cursor) > 0) cursor = latest;
    await this.inboxStore.updateCollector(listener.id, {
      ...next,
      seen: trimObject(seen, 2000),
      initialized_at: previous.initialized_at || polledAt,
      initial_cursor_at: initialCursorAt,
      cursor_at: cursor.cursor_at,
      cursor_id: cursor.cursor_id,
      last_success_at: polledAt,
      last_error: null,
      item_count: items.length,
    });
    return { listener_id: listener.id, status: 'ok', feed_title: feed.title, item_count: items.length, ingested, duplicates };
  }

  async statusAll({ listenerId = null, limit = 50 } = {}) {
    const registry = await this.registryStore.get();
    const listeners = registry.listeners.filter((listener) => listener.type === 'rss'
      && listener.enabled
      && !listener.removed
      && listener.listener_location === registry.runtime.kind
      && (!listenerId || listener.id === listenerId));
    if (listenerId && !listeners.length) throw new Error(`Active RSS listener not found: ${listenerId}`);
    const report = { listeners: [], errors: [] };
    for (const listener of listeners) {
      try {
        report.listeners.push(await this.status(listener, registry, { limit }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        report.errors.push({ listener_id: listener.id, message });
        report.listeners.push({ listener_id: listener.id, status: 'error', message });
      }
    }
    return report;
  }

  async status(listener, registry, { limit = 50 } = {}) {
    const previous = (await this.inboxStore.get()).collectors[listener.id] || {};
    const response = await this.fetchImpl(listener.url, { headers: { 'user-agent': 'BigBrain RSS status/1.0' } });
    if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}.`);
    const feed = parseRssDocument(await response.text());
    const items = sortRssItems(feed.items.map(normalizeRssItemForEvent));
    const initialCursorPersisted = Boolean(previous.initial_cursor_at);
    const initialCursorAt = previous.initial_cursor_at || new Date(this.now().getTime() - DEFAULT_RSS_INITIAL_CURSOR_DAYS * 86_400_000).toISOString();
    const currentCursor = previous.cursor_at ? { cursor_at: previous.cursor_at, cursor_id: previous.cursor_id || null } : null;
    const seen = previous.seen || {};
    const legacySeen = previous.legacy_seen || {};
    const rows = items.map((item) => this.describeItem(listener, item, { seen, legacySeen, initialCursorAt, currentCursor }));
    const incremental = rows.filter((row) => row.incremental_outstanding);
    const initialWindow = rows.filter((row) => row.initial_window_unseen);
    const manual = rows.filter((row) => row.manual_backfill_candidate);
    const boundedLimit = normalizeLimit(limit, 50);
    return {
      listener_id: listener.id,
      status: 'ok',
      feed_title: feed.title,
      item_count: items.length,
      initialized_at: previous.initialized_at || null,
      initial_cursor: { cursor_at: initialCursorAt, cursor_id: null, source: initialCursorPersisted ? 'persisted' : 'derived_from_status_time' },
      current_cursor: currentCursor,
      seen_count: Object.keys(seen).length,
      legacy_seen_count: Object.keys(legacySeen).length,
      counts: {
        seen: rows.length - rows.filter((row) => !row.seen).length,
        unseen: rows.filter((row) => !row.seen).length,
        initial_window_unseen: initialWindow.length,
        incremental_outstanding: incremental.length,
        manual_backfill_candidates: manual.length,
      },
      outstanding: {
        incremental: incremental.slice(0, boundedLimit),
        initial_window: initialWindow.slice(0, boundedLimit),
        manual_backfill: manual.slice(0, boundedLimit),
      },
      truncated: {
        incremental: incremental.length > boundedLimit,
        initial_window: initialWindow.length > boundedLimit,
        manual_backfill: manual.length > boundedLimit,
      },
    };
  }

  async backfill(listenerId, { itemIds = [], dryRun = false, maxItems = DEFAULT_RSS_MANUAL_BACKFILL_LIMIT } = {}) {
    const registry = await this.registryStore.get();
    const listener = registry.listeners.find((candidate) => candidate.id === listenerId
      && candidate.type === 'rss'
      && candidate.enabled
      && !candidate.removed
      && candidate.listener_location === registry.runtime.kind);
    if (!listener) throw new Error(`Active RSS listener not found: ${listenerId}`);
    const requestedIds = [...new Set((Array.isArray(itemIds) ? itemIds : [itemIds]).map((value) => String(value || '').trim()).filter(Boolean))];
    if (!requestedIds.length) throw new Error('RSS manual backfill requires at least one exact stable item ID.');
    const limit = normalizeLimit(maxItems, DEFAULT_RSS_MANUAL_BACKFILL_LIMIT);
    if (requestedIds.length > limit) throw new Error(`RSS manual backfill is limited to ${limit} explicitly selected item IDs.`);
    const previous = (await this.inboxStore.get()).collectors[listener.id] || {};
    const response = await this.fetchImpl(listener.url, { headers: { 'user-agent': 'BigBrain RSS manual backfill/1.0' } });
    if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}.`);
    const xml = await response.text();
    const feed = parseRssDocument(xml);
    const items = sortRssItems(feed.items.map(normalizeRssItemForEvent));
    const byId = new Map(items.map((item) => [stableRssItemId(listener, item), item]));
    const initialCursorAt = previous.initial_cursor_at || new Date(this.now().getTime() - DEFAULT_RSS_INITIAL_CURSOR_DAYS * 86_400_000).toISOString();
    const currentCursor = previous.cursor_at ? { cursor_at: previous.cursor_at, cursor_id: previous.cursor_id || null } : null;
    const seen = { ...(previous.seen || {}) };
    const legacySeen = previous.legacy_seen || {};
    const result = {
      listener_id: listener.id,
      status: dryRun ? 'dry_run' : 'ok',
      feed_title: feed.title,
      requested_item_ids: requestedIds,
      selected: [],
      unknown_item_ids: requestedIds.filter((itemId) => !byId.has(itemId)),
      state_changed: false,
    };
    const selectedForState = [];
    for (const itemId of requestedIds) {
      const item = byId.get(itemId);
      if (!item) continue;
      const description = this.describeItem(listener, item, { seen, legacySeen, initialCursorAt, currentCursor });
      if (description.seen) {
        result.selected.push({ ...description, action: 'duplicate', reason: 'already_seen' });
        continue;
      }
      if (!description.manual_backfill_candidate) {
        result.selected.push({ ...description, action: 'skipped', reason: 'not_beyond_initial_cursor' });
        continue;
      }
      if (dryRun) {
        result.selected.push({ ...description, action: 'would_enqueue' });
        continue;
      }
      const delivery = await this.enqueueRssItem({ listener, item, feedXml: item.raw || xml, registry });
      const action = delivery.duplicates ? 'duplicate' : delivery.ingested ? 'enqueued' : 'handled';
      result.selected.push({ ...description, action, ingested: delivery.ingested, duplicates: delivery.duplicates });
      seen[itemId] = this.now().toISOString();
      selectedForState.push(itemId);
    }
    if (!dryRun && selectedForState.length) {
      await this.inboxStore.updateCollector(listener.id, {
        seen: trimObject(seen, 2000),
        last_backfill_at: this.now().toISOString(),
        last_backfill_item_ids: selectedForState,
      });
      result.state_changed = true;
    }
    result.counts = {
      enqueued: result.selected.filter((item) => item.action === 'enqueued').length,
      duplicates: result.selected.filter((item) => item.action === 'duplicate').length,
      skipped: result.selected.filter((item) => item.action === 'skipped').length,
      unknown: result.unknown_item_ids.length,
    };
    return result;
  }

  describeItem(listener, item, { seen, legacySeen, initialCursorAt, currentCursor }) {
    const itemId = stableRssItemId(listener, item);
    const legacyKey = legacyRssItemKey(listener.id, item);
    const itemCursor = rssCursorForItem(listener.id, item);
    const isSeen = Boolean(seen[itemId] || legacySeen[legacyKey]);
    const afterInitial = Boolean(itemCursor && isAfterRssCursor(listener.id, item, initialCursorAt));
    const afterCurrent = Boolean(itemCursor && currentCursor && compareRssCursors(itemCursor, currentCursor) > 0);
    return {
      item_id: itemId,
      title: item.title,
      link: item.link || null,
      guid: item.guid || null,
      published_at: item.published_at || null,
      seen: isSeen,
      after_initial_cursor: afterInitial,
      after_current_cursor: afterCurrent,
      incremental_outstanding: !isSeen && (currentCursor ? afterCurrent : afterInitial),
      initial_window_unseen: !isSeen && afterInitial,
      manual_backfill_candidate: !isSeen && (!itemCursor || !afterInitial),
    };
  }

  async enqueueRssItem({ listener, item, feedXml, registry, sourceDocument = null }) {
    const fetchedSource = sourceDocument || await this.fetchSourceDocument(listener, item);
    const event = createRssEventEnvelope({ listener, item, feedXml: item.raw || feedXml, sourceDocument: fetchedSource, now: this.now(), registry });
    const subscriptions = registry.subscriptions.filter((subscription) => subscription.listener_id === listener.id && subscription.enabled);
    const deliveries = subscriptions.length
      ? subscriptions
      : listener.listener_location === 'host' && listener.codex_execution_location === 'client'
        ? []
        : [{ client_id: registry.runtime.id, brain_ids: listener.brain_ids, id: null, delivery_url: null }];
    if (!deliveries.length) {
      const unassigned = await this.inboxStore.enqueue(event, { clientId: registry.runtime.id, deliveryOnly: true });
      if (!unassigned.duplicate) await this.inboxStore.complete(unassigned.event.delivery_id, { state: 'ignored', outcome: { status: 'ignored', reason: 'no_active_subscriptions', capture_mode: 'none' }, retainRaw: false });
      return { accepted: true, ingested: 0, duplicates: unassigned.duplicate ? 1 : 0 };
    }
    let ingested = 0;
    let duplicates = 0;
    for (const subscription of deliveries) {
      const deliveryEvent = { ...event, allowed_brain_ids: subscription.brain_ids?.length ? subscription.brain_ids : event.allowed_brain_ids };
      if (subscription.delivery_url) {
        const queued = await this.inboxStore.enqueue(deliveryEvent, { clientId: subscription.client_id, subscriptionId: subscription.id || null, deliveryOnly: true });
        if (!queued.duplicate || ['received', 'failed'].includes(queued.event.state)) {
          try {
            await this.forwardSubscription(deliveryEvent, subscription);
            await this.inboxStore.complete(queued.event.delivery_id, { state: 'filed', outcome: { status: 'delivered', subscription_id: subscription.id || null }, retainRaw: false });
          } catch (error) {
            await this.inboxStore.fail(queued.event.delivery_id, error);
            throw error;
          }
        }
        continue;
      }
      const result = await this.inboxStore.enqueue(deliveryEvent, { clientId: subscription.client_id, subscriptionId: subscription.id || null });
      if (result.duplicate) duplicates += 1; else ingested += 1;
    }
    return { accepted: true, ingested, duplicates };
  }

  async fetchSourceDocument(listener, item) {
    const policy = listener.article_policy || {};
    const url = item.link || item.guid || null;
    const base = {
      status: policy.fetch_source === false ? 'not_requested' : 'unavailable',
      url,
      fetched_at: null,
      content_type: null,
      byte_length: 0,
      truncated: false,
      text: '',
      raw_body: '',
    };
    if (policy.fetch_source === false || !url) return { ...base, error: policy.fetch_source === false ? null : 'RSS item has no canonical source URL.' };
    const maxBytes = Number.isInteger(policy.max_bytes) && policy.max_bytes > 0 ? policy.max_bytes : DEFAULT_RSS_SOURCE_MAX_BYTES;
    const timeoutMs = Number.isInteger(policy.timeout_ms) && policy.timeout_ms > 0 ? policy.timeout_ms : DEFAULT_RSS_SOURCE_TIMEOUT_MS;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await this.fetchImpl(url, {
        headers: { 'user-agent': 'BigBrain source article ingest/1.0' },
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!response.ok) return { ...base, error: `Source returned HTTP ${response.status}.` };
      const fullBody = await response.text();
      const rawBody = truncateUtf8(fullBody, maxBytes);
      const text = htmlToText(rawBody);
      return {
        status: text ? 'fetched' : 'empty',
        url,
        fetched_at: this.now().toISOString(),
        content_type: response.headers?.get?.('content-type') || null,
        byte_length: Buffer.byteLength(fullBody, 'utf8'),
        truncated: rawBody.length < fullBody.length,
        text,
        raw_body: rawBody,
      };
    } catch (error) {
      return { ...base, error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async forwardSubscription(event, subscription) {
    const body = JSON.stringify(event);
    const secret = await this.secretResolver(subscription);
    const response = await this.fetchImpl(subscription.delivery_url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-event-id': event.event_id,
        'x-bigbrain-listener': event.listener_id,
        'x-bigbrain-subscription': subscription.id || '',
        ...(secret ? { 'x-bigbrain-signature': hmacSignature(body, secret) } : {}),
      },
      body,
    });
    if (!response.ok) throw new Error(`Subscription ${subscription.id || subscription.client_id} delivery returned HTTP ${response.status}.`);
  }
}

function sortRssItems(items) {
  return items.sort((left, right) => {
    const leftTime = Date.parse(left.published_at || '');
    const rightTime = Date.parse(right.published_at || '');
    if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return String(left.title).localeCompare(String(right.title));
    if (Number.isNaN(leftTime)) return 1;
    if (Number.isNaN(rightTime)) return -1;
    return rightTime - leftTime || String(right.guid || right.link || '').localeCompare(String(left.guid || left.link || ''));
  });
}

function stableRssItemId(listener, item) {
  return stableSourceEventId(listener.id, item.guid || item.link || `${item.title}:${item.pubDate}`);
}

function normalizeLimit(value, fallback) {
  const limit = Number(value);
  return Number.isInteger(limit) && limit > 0 ? Math.min(limit, 1000) : fallback;
}

function compareRssCursors(left, right) {
  return Date.parse(left.cursor_at) - Date.parse(right.cursor_at) || String(left.cursor_id || '').localeCompare(String(right.cursor_id || ''));
}

function truncateUtf8(value, maxBytes) {
  const text = String(value || '');
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let end = Math.max(0, Math.floor(maxBytes * 0.95));
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > maxBytes) end -= 1;
  return text.slice(0, end);
}

function htmlToText(value) {
  return decodeHtmlEntities(String(value || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|h[1-6]|li|blockquote|pre|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\r/g, ''))
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}
