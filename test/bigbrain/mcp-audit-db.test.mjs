import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { getMcpAuditAnalytics, insertMcpAuditLog, listMcpAuditLog, openDatabase, pruneMcpAuditLog } from '../../src/bigbrain/db.js';
import { buildDefaultConfig } from '../../src/bigbrain/config.js';

test('MCP audit retention defaults to 360 days and remains configurable', () => {
  assert.equal(buildDefaultConfig('/tmp/brain', {}).mcp_audit_retention_days, 360);
  assert.equal(buildDefaultConfig('/tmp/brain', { BIGBRAIN_MCP_AUDIT_RETENTION_DAYS: '720' }).mcp_audit_retention_days, 720);
});

test('SQLite upgrades legacy audit tables and preserves structured records', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-audit-'));
  const sqlitePath = path.join(root, 'brain.sqlite');
  const legacy = new DatabaseSync(sqlitePath);
  legacy.exec(`CREATE TABLE mcp_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_email TEXT,
    action TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL)`);
  legacy.prepare('INSERT INTO mcp_audit_log (actor_email, action, details_json, created_at) VALUES (?, ?, ?, ?)')
    .run('legacy@example.test', 'mcp.tool.create_page', '{}', '2025-01-01T00:00:00.000Z');
  legacy.close();

  const db = await openDatabase({ storageBackend: 'sqlite', sqlitePath });
  await insertMcpAuditLog(db, {
    eventId: 'evt_test', requestId: 'req_test', actorEmail: 'actor@example.test', actorType: 'member',
    actorId: 'people/actor', action: 'mcp.tool.update_page', resourceType: 'page', resourceId: 'people/example',
    outcome: 'success', authMode: 'oauth', serviceName: 'bigbrain-mcp', brainId: 'brn_test', brainName: 'Test',
    details: { arguments: { path: 'people/example', body: { redacted: true, length: 12 } } },
  });
  const rows = await listMcpAuditLog(db, { limit: 10 });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].request_id, 'req_test');
  assert.equal(rows[0].resource_id, 'people/example');
  assert.equal(rows[1].event_id, null);
  const analytics = await getMcpAuditAnalytics(db);
  assert.equal(analytics.summary.total_events, 2);
  assert.equal(analytics.actions[0].action, 'mcp.tool.create_page');
  assert.equal('details_json' in analytics.recent[0], false);
  db.raw.close();
});

test('audit retention is strict, bounded, and pagination uses an id cursor', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-audit-retention-'));
  const db = await openDatabase({ storageBackend: 'sqlite', sqlitePath: path.join(root, 'brain.sqlite') });
  for (const [eventId, createdAt] of [['old-1', '2025-01-01T00:00:00.000Z'], ['old-2', '2025-01-02T00:00:00.000Z'], ['boundary', '2025-01-03T00:00:00.000Z']]) {
    await insertMcpAuditLog(db, { eventId, action: 'mcp.tool.create_page', createdAt });
  }
  assert.equal(await pruneMcpAuditLog(db, { before: '2025-01-03T00:00:00.000Z', limit: 1 }), 1);
  const first = await listMcpAuditLog(db, { limit: 1 });
  const second = await listMcpAuditLog(db, { limit: 1, cursor: first[0].id });
  assert.equal(first[0].event_id, 'boundary');
  assert.equal(second[0].event_id, 'old-2');
  db.raw.close();
});
