import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { withRssIngestionStatus } from '../../src/bigbrain/rss-ingestion-status.js';
import { EventRuntimeManager } from '../../electron/lib/event-runtime-manager.mjs';
import { RssCollector } from '../../src/bigbrain/rss-events.js';

const low = '2026-08-01T12:00:00.000Z';
const high = '2026-09-01T12:00:00.000Z';
const readLedgerStatus = async () => ({ feeds: [
  { feed_id: 'first', filed_low_watermark: low, filed_high_watermark: high, outstanding_count: 7 },
  { feed_id: 'empty', filed_low_watermark: null, filed_high_watermark: null, outstanding_count: 0 },
] });

test('RSS configuration projects verified bounds by feed identity, including empty and removed feeds', async () => {
  const listeners = [
    { id: 'first', type: 'rss', url: 'https://example.test/feed', removed: true },
    { id: 'second', type: 'rss', url: 'https://example.test/other' },
    { id: 'empty', type: 'rss', url: 'https://other.test/feed' },
    { id: 'email', type: 'webhook' },
  ];
  const before = structuredClone(listeners);
  const result = await withRssIngestionStatus(listeners, { readLedgerStatus });
  assert.deepEqual(listeners, before);
  assert.equal(result[0].removed, true);
  assert.deepEqual(result[0].ingestion, { status: 'tracked', filed_low_watermark: low, filed_high_watermark: high, outstanding_count: 7, coverage: 'verified_articles_with_possible_gaps' });
  assert.equal(result[1].ingestion.status, 'uninitialized');
  assert.equal(result[1].ingestion.filed_low_watermark, null);
  assert.equal(result[1].ingestion.filed_high_watermark, null);
  assert.equal(result[1].ingestion.outstanding_count, null);
  assert.equal(result[2].ingestion.status, 'tracked');
  assert.equal(result[2].ingestion.outstanding_count, 0);
  assert.equal(result[3].ingestion, undefined);
});

test('an unavailable ledger reports unknown coverage instead of zero outstanding', async () => {
  const result = await withRssIngestionStatus([{ id: 'first', type: 'rss' }], { readLedgerStatus: async () => { throw new Error('database unavailable'); } });
  assert.equal(result[0].ingestion.status, 'unavailable');
  assert.equal(result[0].ingestion.filed_low_watermark, null);
  assert.equal(result[0].ingestion.filed_high_watermark, null);
  assert.equal(result[0].ingestion.outstanding_count, null);
});

test('desktop listener reads preserve configuration and separate ingestion bounds from polling progress', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rss-ingestion-status-'));
  try {
    const manager = new EventRuntimeManager({ registryPath: path.join(root, 'registry.json'), inboxPath: path.join(root, 'inbox.json'), readLedgerStatus });
    await manager.registry.save({ listeners: [{ id: 'first', type: 'rss', url: 'https://example.test/feed', credential_ref: 'secret-reference' }] });
    await manager.inbox.updateCollector('first', { cursor_at: '2026-09-14T12:00:00.000Z' });
    const beforeRegistry = await fs.readFile(manager.registryPath, 'utf8');
    const beforeInbox = await fs.readFile(manager.inboxPath, 'utf8');
    const state = await manager.state();
    const config = await manager.listeners();
    assert.equal(state.listeners[0].ingestion.filed_high_watermark, high);
    assert.equal(state.collectors.first.cursor_at, '2026-09-14T12:00:00.000Z');
    assert.deepEqual(config.listeners[0].ingestion, state.listeners[0].ingestion);
    assert.equal(config.listeners[0].credential_ref, undefined);
    assert.equal(config.listeners[0].credential_configured, true);
    assert.equal(await fs.readFile(manager.registryPath, 'utf8'), beforeRegistry);
    assert.equal(await fs.readFile(manager.inboxPath, 'utf8'), beforeInbox);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('feed retrieval errors retain verified ingestion state in RSS status', async () => {
  const collector = new RssCollector({
    registryStore: { get: async () => ({ runtime: { kind: 'client' }, listeners: [{ id: 'first', type: 'rss', enabled: true, listener_location: 'client' }] }) },
    inboxStore: { get: async () => ({ collectors: {} }) },
    readLedgerStatus,
    fetchImpl: async () => { throw new Error('feed unavailable'); },
  });
  const result = await collector.statusAll();
  assert.equal(result.listeners[0].status, 'error');
  assert.equal(result.listeners[0].ingestion.filed_high_watermark, high);
  assert.equal(result.listeners[0].ingestion.outstanding_count, 7);
});
