import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  EventInboxStore,
  EventRegistryStore,
  normalizeListener,
  RssCollector,
  stableSourceEventId,
} from '../../src/bigbrain/inbound-events.js';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-rss-events-'));
  return { root, registryPath: path.join(root, 'registry.json'), inboxPath: path.join(root, 'inbox.json') };
}

function listener(extra = {}) {
  return normalizeListener({
    id: 'feed',
    type: 'rss',
    url: 'https://example.test/feed.xml',
    brain_ids: ['brain_personal'],
    article_policy: { fetch_source: false },
    ...extra,
  });
}

function response(xml) {
  return { status: 200, ok: true, headers: { get: () => null }, text: async () => xml };
}

const feedXml = '<rss><channel><title>Example</title>'
  + '<item><guid>new</guid><title>New item</title><link>https://example.test/new</link><pubDate>Fri, 28 Aug 2026 12:00:00 GMT</pubDate></item>'
  + '<item><guid>old</guid><title>Old item</title><link>https://example.test/old</link><pubDate>Thu, 20 Aug 2026 12:00:00 GMT</pubDate></item>'
  + '<item><guid>undated</guid><title>Undated archive item</title><link>https://example.test/undated</link></item>'
  + '<item><guid>seen</guid><title>Seen item</title><link>https://example.test/seen</link><pubDate>Wed, 26 Aug 2026 12:00:00 GMT</pubDate></item>'
  + '</channel></rss>';

test('RSS status categorizes incremental and manual candidates without writing state', async () => {
  const paths = await fixture();
  try {
    const now = () => new Date('2026-08-28T13:00:00.000Z');
    const feedListener = listener();
    const registry = new EventRegistryStore({ filePath: paths.registryPath, runtimeId: 'client-1', now });
    await registry.save({ brains: [{ id: 'brain_personal', name: 'Personal' }], listeners: [feedListener] });
    const inbox = new EventInboxStore({ filePath: paths.inboxPath, now });
    await inbox.updateCollector(feedListener.id, {
      initialized_at: '2026-08-21T13:00:00.000Z',
      initial_cursor_at: '2026-08-21T13:00:00.000Z',
      cursor_at: '2026-08-27T12:00:00.000Z',
      cursor_id: null,
      seen: { [stableSourceEventId(feedListener.id, 'seen')]: '2026-08-28T12:00:00.000Z' },
    });
    const before = await fs.readFile(paths.inboxPath, 'utf8');
    const collector = new RssCollector({ registryStore: registry, inboxStore: inbox, now, fetchImpl: async () => response(feedXml) });
    const report = await collector.statusAll({ listenerId: feedListener.id, limit: 10 });
    const status = report.listeners[0];
    assert.equal(status.counts.unseen, 3);
    assert.equal(status.counts.incremental_outstanding, 1);
    assert.equal(status.counts.initial_window_unseen, 1);
    assert.equal(status.counts.manual_backfill_candidates, 2);
    assert.deepEqual(status.outstanding.incremental.map((item) => item.guid), ['new']);
    assert.deepEqual(status.outstanding.manual_backfill.map((item) => item.guid), ['old', 'undated']);
    assert.deepEqual(await fs.readFile(paths.inboxPath, 'utf8'), before);
    assert.equal((await inbox.list()).length, 0);
  } finally {
    await fs.rm(paths.root, { recursive: true, force: true });
  }
});

test('RSS polling fetches the canonical article and attaches source material for the Codex route', async () => {
  const paths = await fixture();
  try {
    const now = () => new Date('2026-08-28T13:00:00.000Z');
    const feedListener = listener({ article_policy: { fetch_source: true, max_bytes: 50_000 } });
    const registry = new EventRegistryStore({ filePath: paths.registryPath, runtimeId: 'client-1', now });
    await registry.save({ brains: [{ id: 'brain_personal', name: 'Personal' }], listeners: [feedListener] });
    const inbox = new EventInboxStore({ filePath: paths.inboxPath, now });
    const feed = '<rss><channel><title>Example</title><item><guid>article-1</guid><title>Useful article</title><link>https://example.test/article-1</link><pubDate>Fri, 28 Aug 2026 12:00:00 GMT</pubDate></item></channel></rss>';
    const source = '<html><head><title>Useful article</title></head><body><article><h1>Useful article</h1><p>Original source paragraph.</p><p>Second paragraph.</p></article></body></html>';
    const calls = [];
    const collector = new RssCollector({
      registryStore: registry,
      inboxStore: inbox,
      now,
      fetchImpl: async (url) => {
        calls.push(url);
        return response(url.endsWith('feed.xml') ? feed : source);
      },
    });
    const report = await collector.pollAll();
    assert.equal(report.ingested, 1);
    assert.deepEqual(calls, ['https://example.test/feed.xml', 'https://example.test/article-1']);
    const event = (await inbox.list())[0];
    assert.equal(event.metadata.source_document.status, 'fetched');
    assert.match(event.metadata.source_document.text, /Original source paragraph/);
    assert.match(event.metadata.source_document.raw_body, /<article>/);
  } finally {
    await fs.rm(paths.root, { recursive: true, force: true });
  }
});

test('RSS source fetch failures remain explicit instead of becoming complete source captures', async () => {
  const paths = await fixture();
  try {
    const now = () => new Date('2026-08-28T13:00:00.000Z');
    const feedListener = listener({ article_policy: { fetch_source: true } });
    const registry = new EventRegistryStore({ filePath: paths.registryPath, runtimeId: 'client-1', now });
    await registry.save({ brains: [{ id: 'brain_personal', name: 'Personal' }], listeners: [feedListener] });
    const inbox = new EventInboxStore({ filePath: paths.inboxPath, now });
    const feed = '<rss><channel><title>Example</title><item><guid>article-2</guid><title>Unavailable article</title><link>https://example.test/article-2</link><pubDate>Fri, 28 Aug 2026 12:00:00 GMT</pubDate></item></channel></rss>';
    const collector = new RssCollector({
      registryStore: registry,
      inboxStore: inbox,
      now,
      fetchImpl: async (url) => url.endsWith('feed.xml') ? response(feed) : { status: 503, ok: false, headers: { get: () => null }, text: async () => '' },
    });
    await collector.pollAll();
    const event = (await inbox.list())[0];
    assert.equal(event.metadata.source_document.status, 'unavailable');
    assert.match(event.metadata.source_document.error, /HTTP 503/);
  } finally {
    await fs.rm(paths.root, { recursive: true, force: true });
  }
});

test('RSS source retrieval falls back to curl after HTTP 403', async () => {
  const paths = await fixture();
  try {
    const registry = new EventRegistryStore({ filePath: paths.registryPath, runtimeId: 'client-1' });
    const feedListener = listener({ article_policy: { fetch_source: true, max_bytes: 100000, timeout_ms: 1000 } });
    await registry.save({ brains: [{ id: 'brain_personal', name: 'Personal' }], listeners: [feedListener] });
    const inbox = new EventInboxStore({ filePath: paths.inboxPath });
    const collector = new RssCollector({
      registryStore: registry,
      inboxStore: inbox,
      fetchImpl: async (url) => url.endsWith('feed.xml')
        ? response('<rss><channel><item><guid>one</guid><title>One</title><link>https://example.test/article</link><pubDate>Fri, 29 Aug 2026 10:00:00 GMT</pubDate></item></channel></rss>')
        : { status: 403, ok: false, headers: { get: () => null } },
      curlImpl: async (command, args) => {
        assert.equal(command, 'curl');
        assert.ok(args.includes('https://example.test/article'));
        return { stdout: '<html><title>Recovered</title><p>Article body</p></html>', stderr: '' };
      },
    });
    const report = await collector.pollAll();
    assert.equal(report.listeners[0].ingested, 1);
    const queued = Object.values((await inbox.get()).deliveries)[0];
    assert.equal(queued.metadata.source_document.status, 'fetched');
    assert.match(queued.metadata.source_document.text, /Article body/);
  } finally {
    await fs.rm(paths.root, { recursive: true, force: true });
  }
});

test('RSS manual backfill requires explicit older stable IDs and deduplicates repeat selection', async () => {
  const paths = await fixture();
  try {
    const now = () => new Date('2026-08-28T13:00:00.000Z');
    const feedListener = listener();
    const registry = new EventRegistryStore({ filePath: paths.registryPath, runtimeId: 'client-1', now });
    await registry.save({ brains: [{ id: 'brain_personal', name: 'Personal' }], listeners: [feedListener] });
    const inbox = new EventInboxStore({ filePath: paths.inboxPath, now });
    await inbox.updateCollector(feedListener.id, {
      initialized_at: '2026-08-21T13:00:00.000Z',
      initial_cursor_at: '2026-08-21T13:00:00.000Z',
      cursor_at: '2026-08-28T12:00:00.000Z',
      cursor_id: null,
    });
    const collector = new RssCollector({ registryStore: registry, inboxStore: inbox, now, fetchImpl: async () => response(feedXml) });
    const oldId = stableSourceEventId(feedListener.id, 'old');
    const undatedId = stableSourceEventId(feedListener.id, 'undated');
    const newId = stableSourceEventId(feedListener.id, 'new');
    const dryRun = await collector.backfill(feedListener.id, { itemIds: [oldId, undatedId], dryRun: true });
    assert.equal(dryRun.status, 'dry_run');
    assert.deepEqual(dryRun.selected.map((item) => item.action), ['would_enqueue', 'would_enqueue']);
    assert.equal(dryRun.state_changed, false);
    assert.equal((await inbox.list()).length, 0);

    const applied = await collector.backfill(feedListener.id, { itemIds: [oldId, undatedId] });
    assert.equal(applied.status, 'ok');
    assert.equal(applied.counts.enqueued, 2);
    assert.equal((await inbox.list()).length, 2);
    const stateAfter = (await inbox.get()).collectors[feedListener.id];
    assert.equal(stateAfter.cursor_at, '2026-08-28T12:00:00.000Z');
    assert.deepEqual(Object.keys(stateAfter.seen).sort(), [oldId, undatedId].sort());

    const repeated = await collector.backfill(feedListener.id, { itemIds: [oldId, undatedId] });
    assert.equal(repeated.counts.duplicates, 2);
    assert.equal((await inbox.list()).length, 2);
    const rejected = await collector.backfill(feedListener.id, { itemIds: [newId] });
    assert.equal(rejected.counts.skipped, 1);
    assert.equal(rejected.selected[0].reason, 'not_beyond_initial_cursor');
    assert.equal((await inbox.list()).length, 2);
  } finally {
    await fs.rm(paths.root, { recursive: true, force: true });
  }
});

test('RSS manual backfill is bounded and rejects an unselected archive request', async () => {
  const paths = await fixture();
  try {
    const feedListener = listener();
    const registry = new EventRegistryStore({ filePath: paths.registryPath, runtimeId: 'client-1' });
    await registry.save({ brains: [{ id: 'brain_personal', name: 'Personal' }], listeners: [feedListener] });
    const inbox = new EventInboxStore({ filePath: paths.inboxPath });
    const collector = new RssCollector({ registryStore: registry, inboxStore: inbox, fetchImpl: async () => response(feedXml) });
    await assert.rejects(() => collector.backfill(feedListener.id, { itemIds: [] }), /at least one exact stable item ID/);
    await assert.rejects(() => collector.backfill(feedListener.id, { itemIds: ['feed:1', 'feed:2', 'feed:3', 'feed:4'] }), /limited to 3/);
    await assert.rejects(() => collector.backfill(feedListener.id, { itemIds: Array.from({ length: 26 }, (_, index) => `feed:${index}`), maxItems: 25 }), /limited to 25/);
  } finally {
    await fs.rm(paths.root, { recursive: true, force: true });
  }
});
