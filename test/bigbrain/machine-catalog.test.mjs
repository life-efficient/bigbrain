import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  MACHINE_CATALOG_VERSION,
  MachineCatalog,
  defaultMachineCatalogPath,
  normalizeMachineCatalog,
} from '../../src/bigbrain/machine-catalog.js';

const LOCAL_ID = 'brn_11111111-1111-4111-8111-111111111111';
const REMOTE_ID = 'brn_22222222-2222-4222-8222-222222222222';

test('machine catalog path is injectable and defaults below the BigBrain config directory', () => {
  assert.equal(
    defaultMachineCatalogPath({ HOME: '/tmp/example-home' }),
    '/tmp/example-home/.config/bigbrain/brains.json',
  );
  assert.equal(
    defaultMachineCatalogPath({ HOME: '/tmp/example-home', BIGBRAIN_CONFIG_DIR: '/tmp/config-root' }),
    '/tmp/config-root/brains.json',
  );
  assert.equal(
    defaultMachineCatalogPath({ BIGBRAIN_CATALOG_PATH: '/tmp/custom/catalog.json' }),
    '/tmp/custom/catalog.json',
  );
});

test('machine catalog migrates registry-v1-like local and remote records without private owner fields', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-machine-catalog-v1-'));
  const catalogPath = path.join(root, 'brains.json');
  try {
    await fs.writeFile(catalogPath, `${JSON.stringify({
      version: 1,
      activeBrainId: 'remote-entry',
      brains: [
        {
          id: LOCAL_ID,
          name: 'Personal Brain',
          home: path.join(root, 'personal'),
          host: '127.0.0.1',
          port: 55560,
          serviceLabel: `ai.diffusing.bigbrain.${LOCAL_ID}`,
          status: 'running',
          owner: { name: 'Private Owner', email: 'owner@example.com' },
          aiAccess: { type: 'bring_your_own_key' },
          createdAt: '2026-07-01T00:00:00.000Z',
        },
        {
          id: 'remote-entry',
          brainId: REMOTE_ID,
          name: 'ICAIRE',
          connectionType: 'service',
          serviceUrl: 'https://brain.example.test',
          status: 'connected',
          onboarding: { completed: true },
          createdAt: '2026-07-02T00:00:00.000Z',
        },
      ],
    }, null, 2)}\n`);

    const loaded = await new MachineCatalog({ catalogPath }).load();
    assert.equal(loaded.version, MACHINE_CATALOG_VERSION);
    assert.equal(loaded.brains.length, 2);
    assert.equal(loaded.active_entry_id, REMOTE_ID);
    const local = loaded.brains.find((brain) => brain.brain_id === LOCAL_ID);
    assert.equal(local.kind, 'local');
    assert.equal(local.local.port, 55560);
    assert.equal(local.local.home, path.join(root, 'personal'));
    assert.equal(local.connection.handle, `ai.diffusing.bigbrain.${LOCAL_ID}`);
    const remote = loaded.brains.find((brain) => brain.brain_id === REMOTE_ID);
    assert.equal(remote.kind, 'remote');
    assert.equal(remote.connection.endpoint, 'https://brain.example.test');
    assert.equal(remote.verification.state, 'unverified');
    assert.doesNotMatch(JSON.stringify(loaded), /owner@example\.com|Private Owner|aiAccess|onboarding/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('v1 local drafts without a canonical ID remain visible but cannot be marked verified', () => {
  const migrated = normalizeMachineCatalog({
    version: 1,
    activeBrainId: 'legacy-local-id',
    brains: [{ id: 'legacy-local-id', name: 'Unfinished Brain', home: '/tmp/unfinished', port: 55561 }],
  });
  assert.equal(migrated.active_entry_id, 'legacy:legacy-local-id');
  assert.equal(migrated.brains[0].brain_id, null);
  assert.equal(migrated.brains[0].verification.state, 'unverified');
});

test('catalog persists verified local and remote entries and updates by canonical brain ID', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-machine-catalog-upsert-'));
  const catalog = new MachineCatalog({
    catalogPath: path.join(root, 'catalog.json'),
    now: () => new Date('2026-07-22T10:00:00.000Z'),
  });
  try {
    await catalog.upsert(verifiedLocal(path.join(root, 'personal')));
    await catalog.upsert(verifiedRemote());
    await catalog.activate(REMOTE_ID);

    const updated = verifiedRemote();
    updated.health = { status: 'degraded', checked_at: '2026-07-22T09:59:00.000Z' };
    updated.access.writability = 'approval_required';
    await catalog.upsert(updated);

    const loaded = await catalog.load();
    assert.equal(loaded.brains.length, 2);
    assert.equal(loaded.active_entry_id, REMOTE_ID);
    const remote = loaded.brains.find((brain) => brain.brain_id === REMOTE_ID);
    assert.equal(remote.health.status, 'degraded');
    assert.equal(remote.access.writability, 'approval_required');
    assert.equal(remote.created_at, '2026-07-22T10:00:00.000Z');
    assert.equal(remote.updated_at, '2026-07-22T10:00:00.000Z');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('catalog rejects duplicate handles, credential fields, and credential-bearing endpoints', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-machine-catalog-secret-'));
  const catalog = new MachineCatalog({ catalogPath: path.join(root, 'catalog.json') });
  try {
    await catalog.upsert(verifiedLocal(path.join(root, 'personal')));
    const duplicate = verifiedRemote();
    duplicate.connection.handle = 'local-personal';
    await assert.rejects(catalog.upsert(duplicate), /Connection handle is already assigned/);

    const withToken = verifiedRemote();
    withToken.connection.auth_token = 'do-not-store';
    await assert.rejects(catalog.upsert(withToken), /cannot store credential field/);

    const withCredentialUrl = verifiedRemote();
    withCredentialUrl.connection.endpoint = 'https://user:password@brain.example.test';
    await assert.rejects(catalog.upsert(withCredentialUrl), /cannot contain credentials/);

    const withoutVerificationTime = verifiedRemote();
    withoutVerificationTime.verification.verified_at = null;
    await assert.rejects(catalog.upsert(withoutVerificationTime), /require verification\.verified_at/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('catalog removal clears an active entry and unsupported versions fail closed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-machine-catalog-remove-'));
  const catalog = new MachineCatalog({ catalogPath: path.join(root, 'catalog.json') });
  try {
    await catalog.upsert(verifiedRemote());
    await catalog.activate(REMOTE_ID);
    const removed = await catalog.remove(REMOTE_ID);
    assert.equal(removed.brain_id, REMOTE_ID);
    assert.deepEqual(await catalog.load(), { version: 2, active_entry_id: null, brains: [] });
    assert.throws(() => normalizeMachineCatalog({ version: 3, brains: [] }), /Unsupported/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

function verifiedLocal(home) {
  return {
    brain_id: LOCAL_ID,
    brain_name: 'Personal Brain',
    kind: 'local',
    connection: { type: 'local_runtime', handle: 'local-personal', endpoint: 'http://127.0.0.1:55560/mcp' },
    verification: { state: 'verified', verified_at: '2026-07-22T09:00:00.000Z' },
    profile: { state: 'valid', schema_version: 1, profile_version: 2 },
    access: { auth_state: 'local_trusted', writability: 'writable' },
    health: { status: 'healthy', checked_at: '2026-07-22T09:00:00.000Z' },
    local: { home, host: '127.0.0.1', port: 55560, service_label: 'local.bigbrain.personal', service_status: 'running' },
  };
}

function verifiedRemote() {
  return {
    brain_id: REMOTE_ID,
    brain_name: 'ICAIRE',
    kind: 'remote',
    connection: { type: 'codex_mcp', handle: 'icaire', endpoint: 'https://brain.example.test/mcp' },
    verification: { state: 'verified', verified_at: '2026-07-22T09:00:00.000Z' },
    profile: { state: 'valid', schema_version: 1, profile_version: 4 },
    access: { auth_state: 'authenticated', writability: 'approval_required' },
    health: { status: 'healthy', checked_at: '2026-07-22T09:00:00.000Z' },
    local: null,
  };
}
