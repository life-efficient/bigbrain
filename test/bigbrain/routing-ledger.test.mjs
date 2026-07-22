import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  defaultRoutingLedgerPath,
  openRoutingLedger,
  ROUTING_LEDGER_SCHEMA_VERSION,
} from '../../src/bigbrain/routing-ledger.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

test('default ledger path is machine-local and environment-injectable', () => {
  assert.equal(
    defaultRoutingLedgerPath({ HOME: '/example/home' }),
    '/example/home/.config/bigbrain/routing-ledger.sqlite',
  );
  assert.equal(
    defaultRoutingLedgerPath({ HOME: '/ignored', BIGBRAIN_MACHINE_HOME: '/machine/state' }),
    '/machine/state/routing-ledger.sqlite',
  );
  assert.equal(
    defaultRoutingLedgerPath({ BIGBRAIN_ROUTING_LEDGER_PATH: '/custom/routes.sqlite' }),
    '/custom/routes.sqlite',
  );
});

test('discovery is idempotent by source and source item ID', async () => {
  const fixture = await createFixture();
  try {
    const first = fixture.ledger.discover({
      source: 'granola', sourceItemId: 'meeting-1', metadataHash: HASH_A, policyRevision: 'policy-v1',
    });
    const second = fixture.ledger.discover({
      source: 'granola', sourceItemId: 'meeting-1', metadataHash: HASH_B, policyRevision: 'policy-v2',
    });

    assert.equal(first.already_exists, false);
    assert.equal(second.already_exists, true);
    assert.equal(second.id, first.id);
    assert.equal(second.metadata_hash, HASH_A);
    assert.equal(fixture.ledger.list().length, 1);
    assert.deepEqual(fixture.ledger.listEvents({ source: 'granola', sourceItemId: 'meeting-1' }).map((event) => event.event_type), ['discovered']);
  } finally {
    await fixture.cleanup();
  }
});

test('held routes require approval before an atomic write lease', async () => {
  const fixture = await createFixture();
  try {
    fixture.ledger.discover({ source: 'granola', sourceItemId: 'meeting-2', metadataHash: HASH_A, policyRevision: 'policy-v1' });
    const held = fixture.ledger.recordDecision({
      source: 'granola',
      sourceItemId: 'meeting-2',
      decision: 'hold',
      selectedBrainId: 'brn_icaire',
      metadataHash: HASH_A,
      policyRevision: 'policy-v1',
      reasonCodes: ['folder.icaire', 'approval.required'],
      confidenceBand: 'deterministic',
    });
    assert.equal(held.decision_state, 'held');
    assert.equal(held.approval_state, 'pending');
    assert.equal(fixture.ledger.acquireLease({ source: 'granola', sourceItemId: 'meeting-2' }), null);

    const approved = fixture.ledger.approve({
      source: 'granola', sourceItemId: 'meeting-2', actorId: 'usr_harry',
    });
    assert.equal(approved.decision_state, 'approved');
    assert.equal(approved.approval_state, 'approved');

    const lease = fixture.ledger.acquireLease({ source: 'granola', sourceItemId: 'meeting-2', durationMs: 60_000 });
    assert.equal(lease.decision_state, 'writing');
    assert.equal(lease.attempt_count, 1);
    assert.ok(lease.lease_token);
    assert.equal(fixture.ledger.acquireLease({ source: 'granola', sourceItemId: 'meeting-2' }), null);

    assert.throws(() => fixture.ledger.markVerified({
      source: 'granola', sourceItemId: 'meeting-2', leaseToken: 'wrong-token', destinationVerificationRef: 'audit_123',
    }), /lease/);
    const verified = fixture.ledger.markVerified({
      source: 'granola', sourceItemId: 'meeting-2', leaseToken: lease.lease_token, destinationVerificationRef: 'audit_123',
    });
    assert.equal(verified.decision_state, 'verified');
    assert.equal(verified.destination_verification_ref, 'audit_123');
    assert.equal(verified.lease_token, null);
    assert.throws(() => fixture.ledger.retry({ source: 'granola', sourceItemId: 'meeting-2' }), /Only failed/);
  } finally {
    await fixture.cleanup();
  }
});

test('expired leases can be recovered and failures can be retried', async () => {
  let clock = new Date('2026-07-22T00:00:00.000Z');
  const fixture = await createFixture({ now: () => clock, uuids: ['lease-one', 'lease-two', 'lease-three'] });
  try {
    fixture.ledger.discover({ source: 'granola', sourceItemId: 'meeting-3', policyRevision: 'policy-v1' });
    fixture.ledger.recordDecision({
      source: 'granola', sourceItemId: 'meeting-3', decision: 'auto', selectedBrainId: 'brn_personal',
      policyRevision: 'policy-v1', reasonCodes: ['folder.not_icaire'], confidenceBand: 'deterministic',
    });
    const firstLease = fixture.ledger.acquireLease({ source: 'granola', sourceItemId: 'meeting-3', durationMs: 1000 });
    assert.equal(firstLease.lease_token, 'lease-one');

    clock = new Date('2026-07-22T00:00:02.000Z');
    assert.throws(() => fixture.ledger.markVerified({
      source: 'granola', sourceItemId: 'meeting-3', leaseToken: firstLease.lease_token, destinationVerificationRef: 'audit_stale',
    }), /lease/);
    const recoveredLease = fixture.ledger.acquireLease({ source: 'granola', sourceItemId: 'meeting-3', durationMs: 1000 });
    assert.equal(recoveredLease.lease_token, 'lease-two');
    assert.equal(recoveredLease.attempt_count, 2);

    const failed = fixture.ledger.markFailed({
      source: 'granola', sourceItemId: 'meeting-3', leaseToken: recoveredLease.lease_token, errorCode: 'destination.unavailable',
    });
    assert.equal(failed.decision_state, 'failed');
    assert.equal(failed.last_error_code, 'destination.unavailable');

    const retried = fixture.ledger.retry({ source: 'granola', sourceItemId: 'meeting-3', actorId: 'usr_harry' });
    assert.equal(retried.decision_state, 'approved');
    const thirdLease = fixture.ledger.acquireLease({ source: 'granola', sourceItemId: 'meeting-3' });
    assert.equal(thirdLease.lease_token, 'lease-three');
  } finally {
    await fixture.cleanup();
  }
});

test('reject is terminal and list supports queue filters', async () => {
  const fixture = await createFixture();
  try {
    for (const item of ['held-one', 'held-two']) {
      fixture.ledger.discover({ source: 'granola', sourceItemId: item, policyRevision: 'policy-v1' });
      fixture.ledger.recordDecision({
        source: 'granola', sourceItemId: item, decision: 'hold', selectedBrainId: 'brn_review',
        policyRevision: 'policy-v1', reasonCodes: ['ambiguous'], confidenceBand: 'low',
      });
    }
    const rejected = fixture.ledger.reject({
      source: 'granola', sourceItemId: 'held-one', actorId: 'usr_harry', reasonCode: 'user_rejected',
    });
    assert.equal(rejected.decision_state, 'rejected');
    assert.throws(() => fixture.ledger.approve({
      source: 'granola', sourceItemId: 'held-one', actorId: 'usr_harry',
    }), /Invalid route transition/);
    assert.deepEqual(
      fixture.ledger.list({ states: 'held' }).map((route) => route.source_item_id),
      ['held-two'],
    );
  } finally {
    await fixture.cleanup();
  }
});

test('schema contains routing metadata but no transcript, prompt, or participant columns', async () => {
  const fixture = await createFixture();
  try {
    const columns = fixture.ledger.db.prepare('PRAGMA table_info(routes)').all().map((column) => column.name);
    assert.ok(columns.includes('metadata_hash'));
    assert.ok(columns.includes('selected_brain_id'));
    assert.ok(columns.includes('destination_verification_ref'));
    assert.equal(columns.some((column) => /transcript|summary|prompt|participant|attendee|title/i.test(column)), false);
    assert.equal(fixture.ledger.db.prepare('PRAGMA user_version').get().user_version, ROUTING_LEDGER_SCHEMA_VERSION);
  } finally {
    await fixture.cleanup();
  }
});

test('version 1 ledgers reopen without losing routes or events', async () => {
  const fixture = await createFixture();
  try {
    fixture.ledger.discover({
      source: 'granola', sourceItemId: 'persisted-meeting', metadataHash: HASH_A, policyRevision: 'policy-v1',
    });
    fixture.ledger.close();
    fixture.ledger = await openRoutingLedger({ ledgerPath: fixture.ledgerPath });

    const route = fixture.ledger.get({ source: 'granola', sourceItemId: 'persisted-meeting' });
    assert.equal(route.metadata_hash, HASH_A);
    assert.deepEqual(
      fixture.ledger.listEvents({ source: 'granola', sourceItemId: 'persisted-meeting' }).map((event) => event.event_type),
      ['discovered'],
    );
    assert.equal(fixture.ledger.db.prepare('PRAGMA user_version').get().user_version, ROUTING_LEDGER_SCHEMA_VERSION);
  } finally {
    await fixture.cleanup();
  }
});

test('future routing-ledger versions are rejected without modifying the database', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-routing-ledger-future-'));
  const ledgerPath = path.join(rootDir, 'routing-ledger.sqlite');
  const db = new DatabaseSync(ledgerPath);
  db.exec(`
    CREATE TABLE future_data (value TEXT NOT NULL);
    INSERT INTO future_data (value) VALUES ('preserve-me');
    PRAGMA user_version = 2;
  `);
  db.close();
  try {
    await assert.rejects(openRoutingLedger({ ledgerPath }), /newer than supported version 1/);
    const inspected = new DatabaseSync(ledgerPath);
    try {
      assert.equal(inspected.prepare('PRAGMA user_version').get().user_version, 2);
      assert.equal(inspected.prepare('SELECT value FROM future_data').get().value, 'preserve-me');
      assert.equal(inspected.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'routes'").get().count, 0);
    } finally {
      inspected.close();
    }
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test('malformed version 0 routing tables are rejected without being stamped or partially initialized', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-routing-ledger-malformed-'));
  const ledgerPath = path.join(rootDir, 'routing-ledger.sqlite');
  const db = new DatabaseSync(ledgerPath);
  db.exec('CREATE TABLE routes (id INTEGER PRIMARY KEY);');
  db.close();
  try {
    await assert.rejects(openRoutingLedger({ ledgerPath }), /Cannot initialize routing ledger schema version 1/);
    const inspected = new DatabaseSync(ledgerPath);
    try {
      assert.equal(inspected.prepare('PRAGMA user_version').get().user_version, 0);
      assert.deepEqual(inspected.prepare('PRAGMA table_info(routes)').all().map((column) => column.name), ['id']);
      assert.equal(inspected.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'route_events'").get().count, 0);
    } finally {
      inspected.close();
    }
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

async function createFixture({ now = () => new Date('2026-07-22T00:00:00.000Z'), uuids = [] } = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-routing-ledger-'));
  const ledgerPath = path.join(rootDir, 'machine', 'routing-ledger.sqlite');
  let uuidIndex = 0;
  const ledger = await openRoutingLedger({
    ledgerPath,
    now,
    randomUUID: () => uuids[uuidIndex++] || `lease-${uuidIndex}`,
  });
  const fixture = {
    rootDir,
    ledgerPath,
    ledger,
    cleanup: async () => {
      fixture.ledger.close();
      await fs.rm(rootDir, { recursive: true, force: true });
    },
  };
  return fixture;
}
