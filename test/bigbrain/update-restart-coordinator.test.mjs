import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { UpdateRestartCoordinator } from '../../electron/lib/update-restart-coordinator.mjs';

test('download receipt blocks reconciliation until the installed app reaches the target version', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-update-receipt-old-app-'));
  const receiptPath = path.join(root, 'update-restart.json');
  let reconciliations = 0;
  const writer = coordinator({ receiptPath, appVersion: '1.4.0', reconcile: async () => { reconciliations += 1; } });
  await writer.recordDownloadedTarget('1.5.0');

  const result = await writer.verifyAfterRelaunch();
  assert.equal(result.phase, 'app_verification_failed');
  assert.equal(result.action, 'retry_desktop_update');
  assert.equal(reconciliations, 0);
  assert.equal(JSON.parse(await fs.readFile(receiptPath, 'utf8')).target_version, '1.5.0');
  await fs.rm(root, { recursive: true, force: true });
});

test('verified app and service reconciliation complete the receipt exactly once', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-update-receipt-complete-'));
  const receiptPath = path.join(root, 'update-restart.json');
  const writer = coordinator({ receiptPath, appVersion: '1.4.0', reconcile: async () => ({ phase: 'current', failed: 0 }) });
  await writer.recordDownloadedTarget('1.5.0');

  const verifier = coordinator({ receiptPath, appVersion: '1.5.0', reconcile: async () => ({ phase: 'updated', failed: 0 }) });
  const result = await verifier.verifyAfterRelaunch();
  assert.equal(result.phase, 'complete');
  assert.equal(result.targetVersion, '1.5.0');
  assert.equal(result.reconciliation.phase, 'updated');
  await assert.rejects(() => fs.access(receiptPath), /ENOENT/);
  assert.equal((await verifier.verifyAfterRelaunch()).phase, 'none');
  await fs.rm(root, { recursive: true, force: true });
});

test('service attention keeps the receipt so reconciliation can be retried', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-update-receipt-services-'));
  const receiptPath = path.join(root, 'update-restart.json');
  const verifier = coordinator({ receiptPath, appVersion: '2.0.0', reconcile: async () => ({ phase: 'attention', newer: 1, failed: 0 }) });
  await verifier.recordDownloadedTarget('2.0.0');

  const result = await verifier.verifyAfterRelaunch();
  assert.equal(result.phase, 'service_attention');
  assert.equal(result.action, 'review_local_services');
  assert.equal((await fs.stat(receiptPath)).isFile(), true);
  await fs.rm(root, { recursive: true, force: true });
});

test('an unrecognized reconciliation result keeps the receipt for a safe retry', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-update-receipt-unknown-'));
  const receiptPath = path.join(root, 'update-restart.json');
  const verifier = coordinator({ receiptPath, appVersion: '2.0.0', reconcile: async () => undefined });
  await verifier.recordDownloadedTarget('2.0.0');

  const result = await verifier.verifyAfterRelaunch();
  assert.equal(result.phase, 'service_attention');
  assert.equal(result.action, 'review_local_services');
  assert.equal((await fs.stat(receiptPath)).isFile(), true);
  await fs.rm(root, { recursive: true, force: true });
});

test('reconciliation failures are redacted and leave the receipt recoverable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-update-receipt-failure-'));
  const receiptPath = path.join(root, 'update-restart.json');
  const verifier = coordinator({
    receiptPath,
    appVersion: '2.0.0',
    reconcile: async () => { throw new Error('repair failed with sk-secret123456789'); },
  });
  await verifier.recordDownloadedTarget('2.0.0');

  const result = await verifier.verifyAfterRelaunch();
  assert.equal(result.phase, 'service_attention');
  assert.match(result.message, /\[REDACTED\]/);
  assert.doesNotMatch(result.message, /sk-secret/);
  assert.equal((await fs.stat(receiptPath)).isFile(), true);
  await fs.rm(root, { recursive: true, force: true });
});

function coordinator({ receiptPath, appVersion, reconcile }) {
  return new UpdateRestartCoordinator({
    receiptPath,
    appVersion,
    reconcile,
    now: () => '2026-08-29T00:00:00.000Z',
  });
}
