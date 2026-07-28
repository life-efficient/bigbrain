import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  BRAIN_PROFILE_FILENAME,
  BRAIN_PROFILE_JSON_SCHEMA,
  authenticatedBrainAbout,
  conservativeBrainProfileDraft,
  loadBrainProfile,
  normalizeBrainProfile,
  writeBrainProfile,
} from '../../src/bigbrain/brain-profile.js';
import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { syncBrain } from '../../src/bigbrain/sync.js';

test('brain init creates a routing description excluded from indexing', async () => {
  const fixture = await createFixture('bigbrain-profile-init-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const loaded = await loadBrainProfile(config);
    assert.equal(loaded.valid, true);
    assert.equal(loaded.profile.identity.brain_id, config.brainId);
    assert.equal(loaded.profile.identity.brain_name, config.brainName);
    assert.match(loaded.profile.identity.description, /has not set a routing description yet/);
    assert.equal(loaded.about.meeting_ingestion_approval_required, true);

    const sync = await syncBrain({ config, apiKey: null });
    assert.equal(sync.indexed_pages, 0);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('missing and invalid descriptions fail closed', async () => {
  const fixture = await createFixture('bigbrain-profile-fail-closed-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    await fs.rm(path.join(fixture.brainHome, BRAIN_PROFILE_FILENAME));
    const missing = await loadBrainProfile(config);
    assert.equal(missing.status, 'missing');
    assert.equal(missing.about.meeting_ingestion_approval_required, true);

    await fs.writeFile(path.join(fixture.brainHome, BRAIN_PROFILE_FILENAME), 'not a description\n', 'utf8');
    const invalid = await loadBrainProfile(config);
    assert.equal(invalid.status, 'invalid');
    assert.equal(invalid.about.meeting_ingestion_approval_required, true);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('an existing ordinary root BRAIN.md remains indexed while routing fails closed', async () => {
  const fixture = await createFixture('bigbrain-profile-name-collision-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    await fs.writeFile(
      path.join(fixture.brainHome, BRAIN_PROFILE_FILENAME),
      '---\ntitle: Brain Notes\n---\n\n# Brain Notes\n\nExisting knowledge page from before routing descriptions.\n',
      'utf8',
    );

    const loaded = await loadBrainProfile(config);
    assert.equal(loaded.status, 'invalid');
    assert.equal(loaded.about.meeting_ingestion_approval_required, true);
    const sync = await syncBrain({ config, apiKey: null });
    assert.equal(sync.indexed_pages, 1);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('description writes enforce immutable runtime identity and allow auto writes when writable', async () => {
  const fixture = await createFixture('bigbrain-profile-write-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const profile = conservativeBrainProfileDraft(config);
    profile.identity.description = 'Private personal and commercial memory, excluding shared organization work.';
    const written = await writeBrainProfile(config, profile);
    const about = authenticatedBrainAbout(config, written, { writable: true, availableOperations: ['read', 'write'] });
    assert.equal(about.meeting_ingestion_approval_required, false);

    profile.identity.brain_id = 'brn_wrong';
    await assert.rejects(writeBrainProfile(config, profile), /immutable runtime brain_id/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('published description schema and runtime enforce the same scalar boundaries', async () => {
  const fixture = await createFixture('bigbrain-profile-schema-parity-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const valid = conservativeBrainProfileDraft(config);
    assert.equal(normalizeBrainProfile(valid, config).schema_version, BRAIN_PROFILE_JSON_SCHEMA.properties.schema_version.const);
    assert.deepEqual(BRAIN_PROFILE_JSON_SCHEMA.required, ['schema_version', 'identity']);
    assert.deepEqual(BRAIN_PROFILE_JSON_SCHEMA.properties.identity.required, ['brain_id', 'brain_name', 'description']);

    const stringVersion = structuredClone(valid);
    stringVersion.schema_version = '1';
    assert.throws(() => normalizeBrainProfile(stringVersion, config), /schema_version/);

    const blankDescription = structuredClone(valid);
    blankDescription.identity.description = '';
    assert.throws(() => normalizeBrainProfile(blankDescription, config), /non-empty string/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

async function createFixture(prefix) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const brainHome = path.join(rootDir, 'brain');
  const env = {
    ...process.env,
    BIGBRAIN_POINTER_PATH: path.join(rootDir, 'pointer'),
    BIGBRAIN_STATE_ROOT: path.join(rootDir, 'state'),
  };
  const init = await initializeBrainHome(brainHome, { env, brainName: 'Test Brain' });
  return { rootDir, brainHome, configPath: init.configPath };
}
