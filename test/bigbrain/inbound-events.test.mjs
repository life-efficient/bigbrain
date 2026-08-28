import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import {
  EventInboxStore,
  EventRegistryStore,
  InboundEventProcessor,
  InboundEventRuntime,
  InboundWebhookServer,
  classifyEvent,
  configuredWebhookEventType,
  createEmptyEventRegistry,
  createRssEventEnvelope,
  hmacSignature,
  legacyRssItemKey,
  normalizeEventRegistry,
  normalizeListener,
  normalizeEventEnvelope,
  parseRssDocument,
  RssCollector,
  ScopedFilingBroker,
} from '../../src/bigbrain/inbound-events.js';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-inbound-events-'));
  return { root, registryPath: path.join(root, 'registry.json'), inboxPath: path.join(root, 'inbox.json') };
}

function rssListener(extra = {}) {
  return normalizeListener({ id: 'openai-news', type: 'rss', url: 'https://example.test/feed.xml', brain_ids: ['brain_personal'], ...extra });
}

test('event registry validates independent collection and Codex placement controls and reloads direct edits', async () => {
  const paths = await fixture();
  try {
    const store = new EventRegistryStore({ filePath: paths.registryPath, runtimeId: 'client-1' });
    const initial = await store.save({ brains: [{ id: 'brain_personal', name: 'Personal' }], listeners: [rssListener({ listener_location: 'host', codex_execution_location: 'client', codex_execution_mode: 'app_thread', skill: 'bigbrain-ingest' })] });
    assert.equal(initial.listeners[0].listener_location, 'host');
    assert.equal(initial.listeners[0].codex_execution_location, 'client');
    assert.equal(initial.listeners[0].codex_execution_mode, 'app_thread');
    assert.equal(initial.listeners[0].skill, 'bigbrain-ingest');
    const direct = { ...initial, display_only: true, revision: initial.revision };
    await fs.writeFile(paths.registryPath, `${JSON.stringify(direct)}\n`);
    assert.equal((await store.get()).display_only, true);
    assert.throws(() => normalizeEventRegistry({ listeners: [{ id: 'x', type: 'rss', url: 'not-http' }] }), /http/);
  } finally {
    await fs.rm(paths.root, { recursive: true, force: true });
  }
});

test('listeners normalize upstream event filters and prompt field selection', () => {
  const listener = normalizeListener({
    id: 'granola',
    provider: 'granola',
    type: 'webhook',
    event_types: ['meeting.completed'],
    prompt_payload_fields: ['event_type', 'data.title'],
    prompt_omit_fields: ['data.internal'],
  });
  assert.equal(listener.event_type_path, 'event');
  assert.deepEqual(listener.event_types, ['meeting.completed']);
  assert.deepEqual(listener.prompt_payload_fields, ['event_type', 'data.title']);
  assert.deepEqual(listener.prompt_omit_fields, ['data.internal']);
  assert.equal(configuredWebhookEventType({ event: 'meeting.completed' }, {}, listener), 'meeting.completed');
});

test('inbox is durable, idempotent, retryable, and purges payloads on ignored outcomes', async () => {
  const paths = await fixture();
  try {
    const inbox = new EventInboxStore({ filePath: paths.inboxPath });
    const event = { event_id: 'source-1', listener_id: 'openai-news', type: 'rss.item', payload: { title: 'Announcement' }, raw_payload: '<item />', allowed_brain_ids: ['brain_personal'] };
    const first = await inbox.enqueue(event, { clientId: 'client-1' });
    const duplicate = await inbox.enqueue(event, { clientId: 'client-1' });
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    await inbox.claim(first.event.delivery_id);
    const ignored = await inbox.complete(first.event.delivery_id, { state: 'ignored', outcome: { status: 'ignored', reason: 'not useful' } });
    assert.equal(ignored.state, 'ignored');
    assert.equal(ignored.raw_payload, null);
    assert.equal((await inbox.list({ state: 'ignored' })).length, 1);
    await assert.rejects(inbox.retry(first.event.delivery_id), /Only failed/);
  } finally {
    await fs.rm(paths.root, { recursive: true, force: true });
  }
});

test('RSS policy supports ignore, summary, and full outcomes without creating Brain pages', () => {
  const listener = rssListener({ filter: { ignore_categories: ['security'], summary_categories: ['company'], full_categories: ['research'] } });
  assert.equal(classifyEvent({ payload: { category: 'Security', title: 'Patch' }, capture_policy: listener.capture_policy }, listener).decision, 'ignore');
  assert.equal(classifyEvent({ payload: { category: 'Company', title: 'News' }, capture_policy: listener.capture_policy }, listener).decision, 'summary');
  assert.equal(classifyEvent({ payload: { category: 'Research', title: 'Paper' }, capture_policy: listener.capture_policy }, listener).decision, 'full');
});

test('generic feed parser accepts Atom entries as well as RSS items', () => {
  const feed = parseRssDocument('<feed><title>Updates</title><link href="https://example.test"/><entry><id>atom-1</id><title>Release</title><link href="https://example.test/release"/><updated>2026-08-26T10:00:00Z</updated><category term="research"/><summary>Useful update.</summary></entry></feed>');
  assert.equal(feed.title, 'Updates');
  assert.equal(feed.items[0].guid, 'atom-1');
  assert.equal(feed.items[0].link, 'https://example.test/release');
  assert.equal(feed.items[0].category, 'research');
});

test('RSS collector polls feeds, honors bootstrap, and deduplicates later polls', async () => {
  const paths = await fixture();
  try {
    const registry = new EventRegistryStore({ filePath: paths.registryPath, runtimeId: 'client-1' });
    await registry.save({
      brains: [{ id: 'brain_personal', name: 'Personal' }],
      listeners: [rssListener({ bootstrap: 'latest' })],
    });
    const inbox = new EventInboxStore({ filePath: paths.inboxPath });
    const xml = '<rss><channel><title>Example</title><item><guid>item-1</guid><title>First</title><link>https://example.test/first</link><pubDate>Wed, 26 Aug 2026 10:00:00 GMT</pubDate></item><item><guid>item-2</guid><title>Second</title><link>https://example.test/second</link><pubDate>Wed, 26 Aug 2026 09:00:00 GMT</pubDate></item></channel></rss>';
    let fetches = 0;
    const collector = new RssCollector({
      registryStore: registry,
      inboxStore: inbox,
      fetchImpl: async () => {
        fetches += 1;
        return { status: 200, ok: true, headers: { get: () => null }, text: async () => xml };
      },
    });
    const first = await collector.pollAll();
    assert.equal(fetches, 1);
    assert.equal(first.ingested, 1);
    assert.equal((await inbox.list()).length, 1);
    const second = await collector.pollAll();
    assert.equal(fetches, 2);
    assert.equal(second.ingested, 0);
    assert.equal(second.duplicates, 0);
    assert.equal((await inbox.list()).length, 1);
  } finally {
    await fs.rm(paths.root, { recursive: true, force: true });
  }
});

test('RSS first poll is bounded to the initial seven-day cursor and advances by timestamp plus ID', async () => {
  const paths = await fixture();
  try {
    const listener = rssListener({ bootstrap: 'all' });
    const registry = new EventRegistryStore({ filePath: paths.registryPath, runtimeId: 'client-1', now: () => new Date('2026-08-28T12:00:00.000Z') });
    await registry.save({ brains: [{ id: 'brain_personal', name: 'Personal' }], listeners: [listener] });
    const inbox = new EventInboxStore({ filePath: paths.inboxPath, now: () => new Date('2026-08-28T12:00:00.000Z') });
    const xml = '<rss><channel><title>Example</title><item><guid>old</guid><title>Old</title><link>https://example.test/old</link><pubDate>Tue, 18 Aug 2026 10:00:00 GMT</pubDate></item><item><guid>recent</guid><title>Recent</title><link>https://example.test/recent</link><pubDate>Wed, 26 Aug 2026 10:00:00 GMT</pubDate></item><item><guid>latest</guid><title>Latest</title><link>https://example.test/latest</link><pubDate>Thu, 27 Aug 2026 10:00:00 GMT</pubDate></item></channel></rss>';
    const collector = new RssCollector({
      registryStore: registry,
      inboxStore: inbox,
      now: () => new Date('2026-08-28T12:00:00.000Z'),
      fetchImpl: async () => ({ status: 200, ok: true, headers: { get: () => null }, text: async () => xml }),
    });
    const first = await collector.pollAll();
    assert.equal(first.ingested, 2);
    assert.deepEqual((await inbox.list()).map((event) => event.payload.guid).sort(), ['latest', 'recent']);
    const state = (await inbox.get()).collectors[listener.id];
    assert.equal(state.cursor_at, '2026-08-27T10:00:00.000Z');
    assert.match(state.cursor_id, /^openai-news:/);
    const second = await collector.pollAll();
    assert.equal(second.ingested, 0);
    assert.equal((await inbox.list()).length, 2);
  } finally {
    await fs.rm(paths.root, { recursive: true, force: true });
  }
});

test('RSS collector recognizes legacy v1 keys during service migration', async () => {
  const paths = await fixture();
  try {
    const listener = rssListener({ bootstrap: 'latest' });
    const registry = new EventRegistryStore({ filePath: paths.registryPath, runtimeId: 'client-1' });
    await registry.save({ brains: [{ id: 'brain_personal', name: 'Personal' }], listeners: [listener] });
    const inbox = new EventInboxStore({ filePath: paths.inboxPath });
    const item = { guid: 'legacy-1', title: 'Already seen', link: 'https://example.test/legacy', pubDate: 'Wed, 26 Aug 2026 10:00:00 GMT' };
    const xml = '<rss><channel><title>Example</title><item><guid>legacy-1</guid><title>Already seen</title><link>https://example.test/legacy</link><pubDate>Wed, 26 Aug 2026 10:00:00 GMT</pubDate></item></channel></rss>';
    await inbox.updateCollector(listener.id, { initialized_at: '2026-08-26T10:00:00.000Z', legacy_seen: { [legacyRssItemKey(listener.id, item)]: '2026-08-26T10:01:00.000Z' } });
    const collector = new RssCollector({
      registryStore: registry,
      inboxStore: inbox,
      fetchImpl: async () => ({ status: 200, ok: true, headers: { get: () => null }, text: async () => xml }),
    });
    const report = await collector.pollAll();
    assert.equal(report.ingested, 0);
    assert.equal(report.duplicates, 1);
    assert.equal((await inbox.list()).length, 0);
  } finally {
    await fs.rm(paths.root, { recursive: true, force: true });
  }
});

test('RSS collector resets its polling guard after a registry failure', async () => {
  const paths = await fixture();
  try {
    const now = () => new Date('2026-08-28T00:00:00.000Z');
    const registry = new EventRegistryStore({ filePath: paths.registryPath, runtimeId: 'client-1', now });
    await registry.save({ brains: [{ id: 'brain_personal', name: 'Personal' }], listeners: [rssListener()] });
    const inbox = new EventInboxStore({ filePath: paths.inboxPath, now });
    let reads = 0;
    const collector = new RssCollector({
      registryStore: { get: async () => { reads += 1; if (reads === 1) throw new Error('synthetic registry outage'); return registry.get(); } },
      inboxStore: inbox,
      now,
      fetchImpl: async () => ({ status: 304, ok: false, headers: { get: () => null } }),
    });
    await assert.rejects(() => collector.pollAll(), /synthetic registry outage/);
    assert.equal(collector.polling, false);
    const second = await collector.pollAll();
    assert.equal(second.listeners[0].status, 'not_modified');
    assert.equal(collector.polling, false);
    const state = (await inbox.get()).collectors['openai-news'];
    assert.equal(state.cursor_at, '2026-08-21T00:00:00.000Z');
    assert.equal(state.cursor_id, null);
  } finally {
    await fs.rm(paths.root, { recursive: true, force: true });
  }
});

test('processor records ignored events and only brokers filed outcomes to allowed Brains', async () => {
  const paths = await fixture();
  try {
    const registry = new EventRegistryStore({ filePath: paths.registryPath, runtimeId: 'client-1' });
    await registry.save({ brains: [{ id: 'brain_personal', name: 'Personal', mcp_url: 'http://brain.test/mcp' }], listeners: [rssListener()] });
    const inbox = new EventInboxStore({ filePath: paths.inboxPath });
    const event = createRssEventEnvelope({ listener: rssListener(), item: { title: 'Useful', link: 'https://example.test/useful', guid: 'useful', raw: '<item />' } });
    const queued = await inbox.enqueue(event, { clientId: 'client-1' });
    const calls = [];
    const processor = new InboundEventProcessor({
      registryStore: registry,
      inboxStore: inbox,
      executorFactory: async () => ({ execute: async () => ({ execution_id: 'exec-1', thread_id: 'thread-1', outcome: { status: 'filed', capture_mode: 'summary', reason: 'useful', destinations: [{ brain_id: 'brain_personal', writes: [] }] } }) }),
      filingBroker: { file: async (input, outcome) => { calls.push({ input, outcome }); return { status: 'filed', destinations: [] }; } },
    });
    const processed = await processor.process(queued.event.delivery_id);
    assert.equal(processed.state, 'filed');
    assert.equal(processed.thread_id, 'thread-1');
    assert.equal(calls[0].input.allowed_brain_ids[0], 'brain_personal');
    assert.equal((await inbox.list({ state: 'filed' })).length, 1);
  } finally {
    await fs.rm(paths.root, { recursive: true, force: true });
  }
});

test('processor treats a successful normal-language event task as complete without broker replay', async () => {
  const paths = await fixture();
  try {
    const listener = rssListener({ skill: 'bigbrain-ingest' });
    const registry = new EventRegistryStore({ filePath: paths.registryPath, runtimeId: 'client-1' });
    await registry.save({ brains: [{ id: 'brain_personal', name: 'Personal' }], listeners: [listener] });
    const inbox = new EventInboxStore({ filePath: paths.inboxPath });
    const queued = await inbox.enqueue(createRssEventEnvelope({ listener, item: { title: 'Useful', link: 'https://example.test/useful', guid: 'useful', pubDate: 'Thu, 28 Aug 2026 10:00:00 GMT', raw: '<item />' } }), { clientId: 'client-1' });
    const processor = new InboundEventProcessor({
      registryStore: registry,
      inboxStore: inbox,
      executorFactory: async () => ({ execute: async () => ({ mode: 'app_thread', execution_id: 'turn-1', thread_id: 'thread-1', response_text: 'Ingested through the BigBrain MCP.' }) }),
      filingBroker: { file: async () => { throw new Error('broker must not replay a direct MCP write'); } },
    });
    const processed = await processor.process(queued.event.delivery_id);
    assert.equal(processed.state, 'filed');
    assert.equal(processed.thread_id, 'thread-1');
    assert.match(processed.outcome.reason, /event-ingestion task/);
  } finally {
    await fs.rm(paths.root, { recursive: true, force: true });
  }
});

test('filing broker treats an already-provenanced event as an idempotent duplicate', async () => {
  const calls = [];
  const broker = new ScopedFilingBroker({
    brainRegistry: [{ id: 'brain_personal', name: 'Personal' }],
    mcpFactory: async () => ({
      callTool: async (name, args) => {
        calls.push({ name, args });
        if (name === 'events/provenance_list') return { provenance: [{ event_id: 'event-1', page_slug: 'concepts/example' }] };
        if (name === 'events/provenance') return { ok: true };
        throw new Error(`Unexpected write: ${name}`);
      },
    }),
  });
  const result = await broker.file({ event_id: 'event-1', allowed_brain_ids: ['brain_personal'] }, {
    status: 'filed',
    capture_mode: 'summary',
    destinations: [{ brain_id: 'brain_personal', writes: [{ tool: 'update_page', arguments: { path: 'concepts/example' } }] }],
  });
  assert.equal(result.status, 'filed');
  assert.equal(result.destinations[0].duplicate, true);
  assert.equal(result.destinations[0].provenance_updated, true);
  assert.deepEqual(calls.map((call) => call.name), ['events/provenance_list', 'events/provenance']);
});

test('webhook server authenticates, limits, and deduplicates generic events', async () => {
  const paths = await fixture();
  const registry = new EventRegistryStore({ filePath: paths.registryPath, runtimeId: 'client-1' });
  await registry.save({ brains: [{ id: 'brain_personal', name: 'Personal' }], listeners: [normalizeListener({ id: 'calendar', type: 'webhook', scope: 'personal', brain_ids: ['brain_personal'] })] });
  const inbox = new EventInboxStore({ filePath: paths.inboxPath });
  const server = new InboundWebhookServer({ registryStore: registry, inboxStore: inbox, port: 0, secretResolver: () => 'secret' });
  try {
    const address = await server.start();
    const url = `http://127.0.0.1:${address.port}/events/calendar`;
    const body = JSON.stringify({ id: 'calendar-1', title: 'Meeting' });
    const first = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bigbrain-signature': hmacSignature(body, 'secret') }, body });
    const second = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bigbrain-signature': hmacSignature(body, 'secret') }, body });
    assert.equal(first.status, 202);
    assert.equal(second.status, 200);
    assert.equal((await inbox.list()).length, 1);
  } finally {
    await server.close();
    await fs.rm(paths.root, { recursive: true, force: true });
  }
});

test('Granola completion webhook is normalized, processed, filed, and deduplicated', async () => {
  const paths = await fixture();
  const granola = normalizeListener({
    id: 'granola',
    provider: 'granola',
    type: 'webhook',
    scope: 'personal',
    brain_ids: ['brain_personal'],
    capture_policy: { default_mode: 'full', retain_raw: true },
    event_type_path: 'event',
    event_types: ['meeting.completed'],
  });
  const registry = new EventRegistryStore({ filePath: paths.registryPath, runtimeId: 'client-1' });
  await registry.save({ brains: [{ id: 'brain_personal', name: 'Personal' }], listeners: [granola] });
  const inbox = new EventInboxStore({ filePath: paths.inboxPath });
  const executions = [];
  const processor = new InboundEventProcessor({
    registryStore: registry,
    inboxStore: inbox,
    executorFactory: async () => ({ execute: async ({ event }) => {
      executions.push(event);
      return { execution_id: 'granola-exec-1', thread_id: 'granola-thread-1', outcome: { status: 'filed', capture_mode: 'full', reason: 'completed meeting', destinations: [{ brain_id: 'brain_personal', writes: [] }] } };
    } }),
    filingBroker: { file: async () => ({ status: 'filed', destinations: [] }) },
  });
  const server = new InboundWebhookServer({ registryStore: registry, inboxStore: inbox, port: 0, secretResolver: () => 'secret', onAccepted: (deliveryId) => processor.process(deliveryId) });
  try {
    const address = await server.start();
    const url = `http://127.0.0.1:${address.port}/events/granola`;
    const body = JSON.stringify({ event: 'meeting.completed', data: { note: { id: 'not_test_1', title: 'Webhook test', summary: 'A completed meeting.' } } });
    const headers = { 'content-type': 'application/json', 'x-bigbrain-signature': hmacSignature(body, 'secret') };
    const first = await fetch(url, { method: 'POST', headers, body });
    const second = await fetch(url, { method: 'POST', headers, body });
    assert.equal(first.status, 202);
    assert.equal(second.status, 200);
    for (let attempt = 0; attempt < 20 && executions.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    const filed = (await inbox.list({ state: 'filed' }))[0];
    assert.equal(executions[0].type, 'granola.meeting.completed');
    assert.equal(executions[0].payload.granola_id, 'not_test_1');
    assert.equal(filed.outcome.filing.status, 'filed');
    assert.equal((await inbox.list()).length, 1);
  } finally {
    await server.close();
    await fs.rm(paths.root, { recursive: true, force: true });
  }
});

test('webhook event type filters acknowledge unsupported events without enqueueing', async () => {
  const paths = await fixture();
  const registry = new EventRegistryStore({ filePath: paths.registryPath, runtimeId: 'client-1' });
  await registry.save({ brains: [{ id: 'brain_personal', name: 'Personal' }], listeners: [normalizeListener({ id: 'granola', provider: 'granola', type: 'webhook', event_type_path: 'event', event_types: ['meeting.completed'] })] });
  const inbox = new EventInboxStore({ filePath: paths.inboxPath });
  const server = new InboundWebhookServer({ registryStore: registry, inboxStore: inbox, port: 0, secretResolver: () => 'secret' });
  try {
    const address = await server.start();
    const body = JSON.stringify({ event: 'meeting.started', data: { note: { id: 'not_test_2' } } });
    const response = await fetch(`http://127.0.0.1:${address.port}/events/granola`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bigbrain-signature': hmacSignature(body, 'secret') }, body });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { ok: true, status: 'ignored', reason: 'unsupported_event_type', event_type: 'meeting.started' });
    assert.equal((await inbox.list()).length, 0);
  } finally {
    await server.close();
    await fs.rm(paths.root, { recursive: true, force: true });
  }
});

test('client delivery route preserves host RSS origin and explicit Brain scope', async () => {
  const paths = await fixture();
  const registry = new EventRegistryStore({ filePath: paths.registryPath, runtimeId: 'client-1' });
  await registry.save({
    brains: [{ id: 'brain_one', name: 'One' }, { id: 'brain_two', name: 'Two' }],
    listeners: [normalizeListener({ id: 'org-feed', type: 'rss', scope: 'organization', url: 'https://example.test/feed.xml', listener_location: 'host' })],
    subscriptions: [{ id: 'org-feed-client-1', listener_id: 'org-feed', client_id: 'client-1', brain_ids: ['brain_one'], credential_ref: 'env:DELIVERY_SECRET' }],
  });
  const inbox = new EventInboxStore({ filePath: paths.inboxPath });
  const listener = (await registry.get()).listeners[0];
  const event = normalizeEventEnvelope({
    event_id: 'org-event-1',
    origin_id: 'org-feed:origin-1',
    listener_id: 'org-feed',
    source_scope: 'organization',
    type: 'rss.item',
    payload: { title: 'Hosted announcement', link: 'https://example.test/announcement' },
    allowed_brain_ids: ['brain_one'],
    source_info: listener,
  }, { registry: await registry.get(), listener });
  const body = JSON.stringify(event);
  const server = new InboundWebhookServer({
    registryStore: registry,
    inboxStore: inbox,
    port: 0,
    secretResolver: (value) => value?.credential_ref === 'env:DELIVERY_SECRET' ? 'secret' : null,
  });
  try {
    const address = await server.start();
    const response = await fetch(`http://127.0.0.1:${address.port}/deliveries/org-feed`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-event-id': event.event_id,
        'x-bigbrain-subscription': 'org-feed-client-1',
        'x-bigbrain-signature': hmacSignature(body, 'secret'),
      },
      body,
    });
    assert.equal(response.status, 202);
    const queued = (await inbox.list())[0];
    assert.equal(queued.type, 'rss.item');
    assert.deepEqual(queued.allowed_brain_ids, ['brain_one']);
    assert.equal(queued.source_scope, 'organization');
  } finally {
    await server.close();
    await fs.rm(paths.root, { recursive: true, force: true });
  }
});

test('runtime lock prevents a desktop and service poller from running concurrently', async () => {
  const paths = await fixture();
  const first = new InboundEventRuntime({ registryPath: paths.registryPath, inboxPath: paths.inboxPath, webhook: { enabled: false } });
  const second = new InboundEventRuntime({ registryPath: paths.registryPath, inboxPath: paths.inboxPath, webhook: { enabled: false } });
  try {
    await first.start();
    await assert.rejects(() => second.start(), /already running/);
  } finally {
    await first.close();
    await second.close();
    await fs.rm(paths.root, { recursive: true, force: true });
  }
});

test('RSS failures are isolated from webhook serving and webhook failures do not stop RSS cycles', async () => {
  const paths = await fixture();
  let runtime = null;
  try {
    const webhook = normalizeListener({ id: 'calendar', type: 'webhook', brain_ids: ['brain_personal'] });
    const registry = new EventRegistryStore({ filePath: paths.registryPath, runtimeId: 'client-1' });
    await registry.save({ brains: [{ id: 'brain_personal', name: 'Personal' }], listeners: [rssListener({ id: 'feed', url: 'https://example.test/feed.xml' }), webhook] });
    const inbox = new EventInboxStore({ filePath: paths.inboxPath });
    let rssFetches = 0;
    runtime = new InboundEventRuntime({
      registryPath: paths.registryPath,
      inboxPath: paths.inboxPath,
      webhook: { enabled: true, host: '127.0.0.1', port: 0 },
      fetchImpl: async (url) => {
        if (url.includes('/feed.xml')) {
          rssFetches += 1;
          if (rssFetches === 1) throw new Error('synthetic RSS outage');
          return { status: 200, ok: true, headers: { get: () => null }, text: async () => '<rss><channel><title>Example</title><item><guid>rss-1</guid><title>RSS item</title><link>https://example.test/rss-1</link><pubDate>Thu, 28 Aug 2026 10:00:00 GMT</pubDate></item></channel></rss>' };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
      executorFactory: async () => ({ execute: async ({ event }) => {
        if (event.type === 'webhook.event') throw new Error('synthetic webhook processing failure');
        return { execution_id: 'rss-exec', thread_id: 'rss-thread', outcome: { status: 'filed', capture_mode: 'summary', reason: 'rss', destinations: [{ brain_id: 'brain_personal', writes: [] }] } };
      } }),
      filingBroker: { file: async () => ({ status: 'filed', destinations: [] }) },
    });
    await runtime.start();
    const address = runtime.webhookServer.server.address();
    const first = await fetch(`http://127.0.0.1:${address.port}/events/calendar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'calendar-1', title: 'Meeting' }) });
    assert.equal(first.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal((await inbox.list({ listenerId: 'calendar' }))[0].state, 'failed');
    const secondReport = await runtime.runRssCycle();
    assert.equal(secondReport.errors.length, 0);
    assert.equal(secondReport.ingested, 1);
    assert.equal((await inbox.list({ listenerId: 'feed' })).length, 1);
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/health`)).status, 200);
  } finally {
    await runtime?.close().catch(() => {});
    await fs.rm(paths.root, { recursive: true, force: true });
  }
});

test('webhook startup failure degrades only the webhook plane and still runs RSS', async () => {
  const paths = await fixture();
  const blocker = http.createServer().listen(0, '127.0.0.1');
  try {
    const registry = new EventRegistryStore({ filePath: paths.registryPath, runtimeId: 'client-1' });
    await registry.save({
      brains: [{ id: 'brain_personal', name: 'Personal' }],
      listeners: [rssListener({ id: 'feed', url: 'https://example.test/feed.xml' }), normalizeListener({ id: 'calendar', type: 'webhook', brain_ids: ['brain_personal'] })],
    });
    const inbox = new EventInboxStore({ filePath: paths.inboxPath });
    const runtime = new InboundEventRuntime({
      registryPath: paths.registryPath,
      inboxPath: paths.inboxPath,
      webhook: { enabled: true, host: '127.0.0.1', port: blocker.address().port },
      fetchImpl: async () => ({ status: 200, ok: true, headers: { get: () => null }, text: async () => '<rss><channel><title>Example</title><item><guid>rss-1</guid><title>RSS item</title><link>https://example.test/rss-1</link><pubDate>Thu, 28 Aug 2026 10:00:00 GMT</pubDate></item></channel></rss>' }),
      executorFactory: async () => ({ execute: async () => ({ execution_id: 'rss-exec', thread_id: 'rss-thread', outcome: { status: 'filed', capture_mode: 'summary', reason: 'rss', destinations: [{ brain_id: 'brain_personal', writes: [] }] } }) }),
      filingBroker: { file: async () => ({ status: 'filed', destinations: [] }) },
    });
    const started = await runtime.start();
    assert.match(runtime.webhookError, /EADDRINUSE|address already in use/i);
    assert.equal(started.firstReport.ingested, 1);
    assert.equal((await inbox.list({ listenerId: 'feed' })).length, 1);
    await runtime.close();
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
    await fs.rm(paths.root, { recursive: true, force: true });
  }
});
