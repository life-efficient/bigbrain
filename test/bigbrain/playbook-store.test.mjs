import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { openDatabase, sqliteRawDatabase } from '../../src/bigbrain/db.js';
import {
  deletePlaybookRecord,
  getPlaybookRecord,
  listPlaybookRecords,
  upsertPlaybookRecord,
} from '../../src/bigbrain/playbook-store.js';

test('SQLite initializes the playbook overlay table and supports CRUD and scoped listing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-playbook-store-'));
  const sqlitePath = path.join(root, 'brain.sqlite');
  let db;
  try {
    db = await openDatabase({ storageBackend: 'sqlite', sqlitePath });
    const raw = sqliteRawDatabase(db);
    assert.ok(raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'playbook_records'").get());
    assert.ok(raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'playbook_records_owner_playbook_updated_at_idx'").get());

    const first = await upsertPlaybookRecord(db, {
      ownerKey: 'me',
      playbookId: 'keep-in-touch',
      recordType: 'person',
      scopeKey: 'people/alice',
      schemaVersion: 2,
      data: { status: 'active', priority: 1, tags: ['new'] },
      now: '2026-08-27T10:00:00Z',
    });
    assert.deepEqual(first, {
      owner_key: 'me',
      playbook_id: 'keep-in-touch',
      record_type: 'person',
      scope_key: 'people/alice',
      data: { status: 'active', priority: 1, tags: ['new'] },
      schema_version: 2,
      created_at: '2026-08-27T10:00:00.000Z',
      updated_at: '2026-08-27T10:00:00.000Z',
    });

    const updated = await upsertPlaybookRecord(db, {
      ownerKey: 'me', playbookId: 'keep-in-touch', recordType: 'person', scopeKey: 'people/alice',
      schemaVersion: 3, data: { status: 'paused', priority: 2 }, now: '2026-08-28T10:00:00Z',
    });
    assert.equal(updated.created_at, first.created_at);
    assert.equal(updated.updated_at, '2026-08-28T10:00:00.000Z');
    assert.deepEqual((await getPlaybookRecord(db, {
      ownerKey: 'me', playbookId: 'keep-in-touch', recordType: 'person', scopeKey: 'people/alice',
    })).data, { status: 'paused', priority: 2 });

    await upsertPlaybookRecord(db, {
      ownerKey: 'me', playbookId: 'keep-in-touch', recordType: 'person', scopeKey: 'people/bob',
      data: { status: 'active' }, now: '2026-08-27T11:00:00Z',
    });
    await upsertPlaybookRecord(db, {
      ownerKey: 'me', playbookId: 'dream-100', recordType: 'target', scopeKey: 'people/alice',
      data: { rank: 1 }, now: '2026-08-27T12:00:00Z',
    });

    const people = await listPlaybookRecords(db, {
      ownerKey: 'me', playbookId: 'keep-in-touch', recordType: 'person', scopeKeyPrefix: 'people',
    });
    assert.deepEqual(people.map((record) => record.scope_key), ['people/alice', 'people/bob']);
    assert.equal(await listPlaybookRecords(db, { ownerKey: 'me', playbookId: 'keep-in-touch', cursor: 1, limit: 1 }).then((rows) => rows.length), 1);
    const key = { ownerKey: 'me', playbookId: 'keep-in-touch', recordType: 'person', scopeKey: 'people/alice' };
    assert.equal(await getPlaybookRecord(db, { ...key, scopeKey: 'people/missing' }), null);
    assert.equal(await deletePlaybookRecord(db, key), true);
    assert.equal(await deletePlaybookRecord(db, key), false);
  } finally {
    await db?.close?.();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('SQLite schema initialization is idempotent for an existing database', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-playbook-legacy-'));
  const sqlitePath = path.join(root, 'brain.sqlite');
  const legacy = new DatabaseSync(sqlitePath);
  legacy.exec('CREATE TABLE playbook_records (owner_key TEXT NOT NULL, playbook_id TEXT NOT NULL, record_type TEXT NOT NULL, scope_key TEXT NOT NULL, data_json TEXT NOT NULL, schema_version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner_key, playbook_id, record_type, scope_key))');
  legacy.close();

  let db;
  try {
    db = await openDatabase({ storageBackend: 'sqlite', sqlitePath });
    await upsertPlaybookRecord(db, {
      ownerKey: 'owner', playbookId: 'test', recordType: 'item', scopeKey: 'one', data: {}, now: '2026-08-27T00:00:00Z',
    });
    assert.ok(sqliteRawDatabase(db).prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'playbook_records_owner_playbook_updated_at_idx'").get());
  } finally {
    await db?.close?.();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('playbook store validates keys and JSON objects before writing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-playbook-validation-'));
  let db;
  try {
    db = await openDatabase({ storageBackend: 'sqlite', sqlitePath: path.join(root, 'brain.sqlite') });
    const base = { ownerKey: 'me', playbookId: 'test', recordType: 'item', scopeKey: 'one' };
    await assert.rejects(() => upsertPlaybookRecord(db, { ...base, data: [] }), /data must be a JSON object/);
    await assert.rejects(() => upsertPlaybookRecord(db, { ...base, data: { value: NaN } }), /finite JSON numbers/);
    await assert.rejects(() => upsertPlaybookRecord(db, { ...base, scopeKey: 'one two', data: {} }), /scopeKey/);
    await assert.rejects(() => upsertPlaybookRecord(db, { ...base, schemaVersion: 0, data: {} }), /schemaVersion/);
  } finally {
    await db?.close?.();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Postgres store uses parameterized JSONB CRUD queries and normalizes rows', async () => {
  const calls = [];
  const row = {
    owner_key: 'me', playbook_id: 'keep-in-touch', record_type: 'person', scope_key: 'people/alice',
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

  const record = await upsertPlaybookRecord(db, {
    ownerKey: 'me', playbookId: 'keep-in-touch', recordType: 'person', scopeKey: 'people/alice',
    data: { status: 'active' }, now: '2026-08-27T10:00:00Z',
  });
  assert.deepEqual(record.data, { status: 'active' });
  assert.equal(calls[0].params[4], '{"status":"active"}');
  assert.match(calls[0].text, /ON CONFLICT/);
  await listPlaybookRecords(db, { ownerKey: 'me', playbookId: 'keep-in-touch', limit: 10 });
  await deletePlaybookRecord(db, {
    ownerKey: 'me', playbookId: 'keep-in-touch', recordType: 'person', scopeKey: 'people/alice',
  });
  assert.equal(calls.some((call) => call.text.includes('OFFSET $5') && call.text.includes('LIMIT $6')), true);
  assert.equal(calls.some((call) => call.text.includes('DELETE FROM playbook_records')), true);
});
