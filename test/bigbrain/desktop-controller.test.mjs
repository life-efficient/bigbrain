import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BrainRegistry, allocatePort } from '../../electron/lib/brain-registry.mjs';
import { connectionInstructions } from '../../electron/lib/connection-instructions.mjs';
import { DisabledManagedInferenceClient, DisabledAuthProvider, DisabledEntitlementProvider, NoopUsageMeter } from '../../electron/lib/access-providers.mjs';
import { redactSecrets } from '../../electron/lib/keychain.mjs';

test('registry persists isolated brains and restores the active brain', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-registry-'));
  const registry = new BrainRegistry({ appSupport: root });
  const one = await registry.createDraft({ name: 'Research', ownerName: 'Ada', ownerEmail: 'ADA@example.com' });
  const two = await registry.createDraft({ name: 'Teaching', ownerName: 'Ada', ownerEmail: 'ada@example.com' });
  const three = await registry.createDraft({ name: 'Personal', ownerName: 'Ada', ownerEmail: 'ada@example.com' });
  assert.equal(new Set([one.id, two.id, three.id]).size, 3);
  assert.equal(new Set([one.port, two.port, three.port]).size, 3);
  assert.notEqual(one.home, two.home);
  await registry.activate(one.id);
  const reloaded = await new BrainRegistry({ appSupport: root }).load();
  assert.equal(reloaded.activeBrainId, one.id);
  assert.equal(reloaded.brains.length, 3);
  assert.equal(reloaded.brains[0].owner.email, 'ada@example.com');
});

test('port allocation skips reserved stable ports', async () => {
  const first = await allocatePort([], '127.0.0.1', 43880);
  const second = await allocatePort([first], '127.0.0.1', 43880);
  assert.equal(first, 43880);
  assert.equal(second, 43881);
});

test('registry registers an existing brain in place and rejects duplicates', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-existing-registry-'));
  const existingHome = path.join(root, 'elsewhere', 'brain');
  const registry = new BrainRegistry({ appSupport: path.join(root, 'support') });
  const brain = await registry.registerExisting({ id: '11111111-1111-4111-8111-111111111111', name: 'Existing Brain', home: existingHome, ownerName: 'Ada', ownerEmail: 'ada@example.com' });
  assert.equal(brain.home, existingHome);
  assert.equal(brain.name, 'Existing Brain');
  await assert.rejects(() => registry.registerExisting({ id: brain.id, name: brain.name, home: existingHome, ownerName: 'Ada', ownerEmail: 'ada@example.com' }), /already registered/);
});

test('connection instructions are brain-specific and contain no credentials', () => {
  const result = connectionInstructions({ name: 'Lecture Brain', host: '127.0.0.1', port: 4123 });
  assert.equal(result.endpoint, 'http://127.0.0.1:4123/mcp');
  assert.match(result.codex, /lecture-brain/);
  assert.doesNotMatch(JSON.stringify(result), /api.?key|sk-/i);
});

test('secret redaction protects errors and future provider contracts fail closed', async () => {
  assert.equal(redactSecrets('bad sk-abcdefghijklmnopqrstuvwxyz token'), 'bad [REDACTED] token');
  await assert.rejects(() => new DisabledManagedInferenceClient().request(), /not available/);
  assert.deepEqual(await new DisabledAuthProvider().authenticate(), { state: 'not_required' });
  assert.deepEqual(await new DisabledEntitlementProvider().status(), { state: 'bring_your_own_key' });
  assert.deepEqual(await new NoopUsageMeter().record(), { recorded: false });
});
