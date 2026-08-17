import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runGranolaLedgerCommand } from '../../src/bigbrain/granola-ledger-runner.js';

test('supported Granola ledger runner covers preflight, dedupe, claim, verify, and cursor advance', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-granola-ledger-runner-'));
  const ledgerPath = path.join(rootDir, 'routing-ledger.sqlite');
  const env = { BIGBRAIN_ROUTING_LEDGER_PATH: ledgerPath };
  try {
    const preflight = await runGranolaLedgerCommand(['preflight', '--source', 'granola'], { env });
    assert.equal(preflight.schema_version, 2);
    assert.equal(preflight.expected_schema_version, 2);
    assert.equal(preflight.writable, true);
    assert.equal(preflight.integrity, 'ok');
    assert.equal(preflight.foreign_key_violations, 0);
    assert.equal(preflight.cursor, null);

    const firstRecord = await runGranolaLedgerCommand([
      'record', '--source', 'granola', '--item', 'meeting-1', '--decision', 'auto',
      '--brain', 'brn_personal', '--policy-revision', 'policy-v1', '--confidence', 'deterministic',
    ], { env });
    assert.equal(firstRecord.already_exists, false);
    assert.equal(firstRecord.route.decision_state, 'approved');

    const duplicateRecord = await runGranolaLedgerCommand([
      'record', '--source', 'granola', '--item', 'meeting-1', '--decision', 'auto',
      '--brain', 'brn_other', '--policy-revision', 'policy-v2',
    ], { env });
    assert.equal(duplicateRecord.already_exists, true);
    assert.equal(duplicateRecord.route.selected_brain_id, 'brn_personal');

    const inspection = await runGranolaLedgerCommand([
      'inspect', '--source', 'granola', '--item', 'meeting-1',
    ], { env });
    assert.equal(inspection.route.decision_state, 'approved');

    const claim = await runGranolaLedgerCommand([
      'claim', '--source', 'granola', '--item', 'meeting-1', '--duration-ms', '60000',
    ], { env });
    assert.equal(claim.claimed, true);
    assert.equal(claim.route.decision_state, 'writing');

    const duplicateClaim = await runGranolaLedgerCommand([
      'claim', '--source', 'granola', '--item', 'meeting-1', '--duration-ms', '60000',
    ], { env });
    assert.equal(duplicateClaim.claimed, false);

    const verified = await runGranolaLedgerCommand([
      'verify', '--source', 'granola', '--item', 'meeting-1',
      '--lease-token', claim.route.lease_token, '--verification-ref', 'readback_ref',
    ], { env });
    assert.equal(verified.route.decision_state, 'verified');

    const advanced = await runGranolaLedgerCommand([
      'advance', '--source', 'granola', '--item', 'meeting-1',
      '--meeting-timestamp', '2026-08-17T12:00:00.000Z',
    ], { env });
    assert.equal(advanced.cursor.advanced, true);
    const regressed = await runGranolaLedgerCommand([
      'advance', '--source', 'granola', '--item', 'meeting-0',
      '--meeting-timestamp', '2026-08-17T12:00:00.000Z',
    ], { env });
    assert.equal(regressed.cursor.advanced, false);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});
