import {
  DEFAULT_RSS_INITIAL_CURSOR_DAYS,
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
    if (response.status === 304) {
      await this.inboxStore.updateCollector(listener.id, {
        ...next,
        initialized_at: previous.initialized_at || polledAt,
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
      const event = createRssEventEnvelope({ listener, item, feedXml: item.raw || xml, now: this.now(), registry });
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
      cursor_at: cursor.cursor_at,
      cursor_id: cursor.cursor_id,
      last_success_at: polledAt,
      last_error: null,
      item_count: items.length,
    });
    return { listener_id: listener.id, status: 'ok', feed_title: feed.title, item_count: items.length, ingested, duplicates };
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

function compareRssCursors(left, right) {
  return Date.parse(left.cursor_at) - Date.parse(right.cursor_at) || String(left.cursor_id || '').localeCompare(String(right.cursor_id || ''));
}
