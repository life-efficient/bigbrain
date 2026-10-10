import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { openDatabase, sqliteRawDatabase } from '../../src/bigbrain/db.js';
import {
  deleteOverlayRecord,
  getOverlayRecord,
  listOverlayRecords,
  upsertOverlayRecord,
} from '../../src/bigbrain/overlay-store.js';

test('SQLite initializes the overlay table and supports CRUD and scoped listing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-overlay-store-'));
  const sqlitePath = path.join(root, 'brain.sqlite');
  let db;
  try {
    db = await openDatabase({ storageBackend: 'sqlite', sqlitePath });
    const raw = sqliteRawDatabase(db);
    assert.ok(raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'overlay_records'").get());
    assert.ok(raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'overlay_records_owner_overlay_updated_at_idx'").get());

    const first = await upsertOverlayRecord(db, {
      ownerKey: 'me',
      overlayId: 'keep-in-touch',
      recordType: 'person',
      scopeKey: 'people/alice',
      schemaVersion: 2,
      data: { status: 'active', priority: 1, tags: ['new'] },
      now: '2026-08-27T10:00:00Z',
    });
    assert.deepEqual(first, {
      owner_key: 'me',
      overlay_id: 'keep-in-touch',
      record_type: 'person',
      scope_key: 'people/alice',
      data: { status: 'active', priority: 1, tags: ['new'] },
      schema_version: 2,
      created_at: '2026-08-27T10:00:00.000Z',
      updated_at: '2026-08-27T10:00:00.000Z',
    });

    const updated = await upsertOverlayRecord(db, {
      ownerKey: 'me', overlayId: 'keep-in-touch', recordType: 'person', scopeKey: 'people/alice',
      schemaVersion: 3, data: { status: 'paused', priority: 2 }, now: '2026-08-28T10:00:00Z',
    });
    assert.equal(updated.created_at, first.created_at);
    assert.equal(updated.updated_at, '2026-08-28T10:00:00.000Z');
    assert.deepEqual((await getOverlayRecord(db, {
      ownerKey: 'me', overlayId: 'keep-in-touch', recordType: 'person', scopeKey: 'people/alice',
    })).data, { status: 'paused', priority: 2 });

    await upsertOverlayRecord(db, {
      ownerKey: 'me', overlayId: 'keep-in-touch', recordType: 'person', scopeKey: 'people/bob',
      data: { status: 'active' }, now: '2026-08-27T11:00:00Z',
    });
    await upsertOverlayRecord(db, {
      ownerKey: 'me', overlayId: 'dream-100', recordType: 'target', scopeKey: 'people/alice',
      data: { rank: 1 }, now: '2026-08-27T12:00:00Z',
    });

    const people = await listOverlayRecords(db, {
      ownerKey: 'me', overlayId: 'keep-in-touch', recordType: 'person', scopeKeyPrefix: 'people',
    });
    assert.deepEqual(people.map((record) => record.scope_key), ['people/alice', 'people/bob']);
    assert.equal(await listOverlayRecords(db, { ownerKey: 'me', overlayId: 'keep-in-touch', cursor: 1, limit: 1 }).then((rows) => rows.length), 1);
    const key = { ownerKey: 'me', overlayId: 'keep-in-touch', recordType: 'person', scopeKey: 'people/alice' };
    assert.equal(await getOverlayRecord(db, { ...key, scopeKey: 'people/missing' }), null);
    assert.equal(await deleteOverlayRecord(db, key), true);
    assert.equal(await deleteOverlayRecord(db, key), false);
  } finally {
    await db?.close?.();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('SQLite schema initialization is idempotent for an existing database', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-overlay-legacy-'));
  const sqlitePath = path.join(root, 'brain.sqlite');
  const legacy = new DatabaseSync(sqlitePath);
  legacy.exec('CREATE TABLE overlay_records (owner_key TEXT NOT NULL, overlay_id TEXT NOT NULL, record_type TEXT NOT NULL, scope_key TEXT NOT NULL, data_json TEXT NOT NULL, schema_version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner_key, overlay_id, record_type, scope_key))');
  legacy.close();

  let db;
  try {
    db = await openDatabase({ storageBackend: 'sqlite', sqlitePath });
    await upsertOverlayRecord(db, {
      ownerKey: 'owner', overlayId: 'test', recordType: 'item', scopeKey: 'one', data: {}, now: '2026-08-27T00:00:00Z',
    });
    assert.ok(sqliteRawDatabase(db).prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'overlay_records_owner_overlay_updated_at_idx'").get());
  } finally {
    await db?.close?.();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('overlay store validates keys and JSON objects before writing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-overlay-validation-'));
  let db;
  try {
    db = await openDatabase({ storageBackend: 'sqlite', sqlitePath: path.join(root, 'brain.sqlite') });
    const base = { ownerKey: 'me', overlayId: 'test', recordType: 'item', scopeKey: 'one' };
    await assert.rejects(() => upsertOverlayRecord(db, { ...base, data: [] }), /data must be a JSON object/);
    await assert.rejects(() => upsertOverlayRecord(db, { ...base, data: { value: NaN } }), /finite JSON numbers/);
    await assert.rejects(() => upsertOverlayRecord(db, { ...base, scopeKey: 'one two', data: {} }), /scopeKey/);
    await assert.rejects(() => upsertOverlayRecord(db, { ...base, schemaVersion: 0, data: {} }), /schemaVersion/);
  } finally {
    await db?.close?.();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Postgres store uses parameterized JSONB CRUD queries and normalizes rows', async () => {
  const calls = [];
  const row = {
    owner_key: 'me', overlay_id: 'keep-in-touch', record_type: 'person', scope_key: 'people/alice',
    data_json: { status: 'active' }, schema_version: 1,
    created_at: new Date('2026-08-27T10:00:00Z'), updated_at: new Date('2026-08-27T10:00:00Z'),
  };
  const db = {
    backend: 'postgres',
    async query(text, params) {
      calls.push({ text, params });
      if (text.includes('SELECT owner_key')) return { rows: [row] };
      if (text.includes('DELETE FROM')) return { rowCount: 1 };
      return { rows: [] };
    },
  };

  const record = await upsertOverlayRecord(db, {
    ownerKey: 'me', overlayId: 'keep-in-touch', recordType: 'person', scopeKey: 'people/alice',
    data: { status: 'active' }, now: '2026-08-27T10:00:00Z',
  });
  assert.deepEqual(record.data, { status: 'active' });
  assert.equal(calls[0].params[4], '{"status":"active"}');
  assert.match(calls[0].text, /ON CONFLICT/);
  await listOverlayRecords(db, { ownerKey: 'me', overlayId: 'keep-in-touch', limit: 10 });
  await deleteOverlayRecord(db, {
    ownerKey: 'me', overlayId: 'keep-in-touch', recordType: 'person', scopeKey: 'people/alice',
  });
  assert.equal(calls.some((call) => call.text.includes('OFFSET $5') && call.text.includes('LIMIT $6')), true);
  assert.equal(calls.some((call) => call.text.includes('DELETE FROM overlay_records')), true);
});


test('legacy workflow records retain settings, reviews, and owner isolation after migration', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-overlay-migration-'));
  const sqlitePath = path.join(root, 'brain.sqlite');
  const legacy = new DatabaseSync(sqlitePath);
  legacy.exec('CREATE TABLE playbook_records (owner_key TEXT NOT NULL, playbook_id TEXT NOT NULL, record_type TEXT NOT NULL, scope_key TEXT NOT NULL, data_json TEXT NOT NULL, schema_version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner_key, playbook_id, record_type, scope_key))');
  const insert = legacy.prepare('INSERT INTO playbook_records VALUES (?, ?, ?, ?, ?, 1, ?, ?)');
  insert.run('alice', 'keep-in-touch', 'settings', 'playbook', '{"enabled":true}', '2026-01-01', '2026-01-02');
  insert.run('bob', 'keep-in-touch', 'person', 'people/friend', '{"priority":2}', '2026-01-01', '2026-01-02');
  insert.run('alice', 'comprehension', 'session', 'session-1', '{"summary":"Retained"}', '2026-01-01', '2026-01-02');
  legacy.close();
  let db;
  try {
    db = await openDatabase({ storageBackend: 'sqlite', sqlitePath });
    const settings = await getOverlayRecord(db, { ownerKey: 'alice', overlayId: 'keep-in-touch', recordType: 'settings', scopeKey: 'overlay' });
    assert.deepEqual(settings.data, { enabled: true });
    assert.equal(settings.created_at, '2026-01-01T00:00:00.000Z');
    assert.equal((await listOverlayRecords(db, { ownerKey: 'bob', overlayId: 'keep-in-touch' })).length, 1);
    assert.equal((await listOverlayRecords(db, { ownerKey: 'alice', overlayId: 'comprehension' }))[0].data.summary, 'Retained');
    await db.close?.();
    db = await openDatabase({ storageBackend: 'sqlite', sqlitePath });
    assert.deepEqual((await getOverlayRecord(db, { ownerKey: 'alice', overlayId: 'keep-in-touch', recordType: 'settings', scopeKey: 'overlay' })).data, { enabled: true });
  } finally {
    await db?.close?.();
    await fs.rm(root, { recursive: true, force: true });
  }
});
