import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  BRAIN_PROFILE_FILENAME,
  authenticatedBrainAbout,
  conservativeBrainProfileDraft,
  loadBrainProfile,
  writeBrainProfile,
} from '../../src/bigbrain/brain-profile.js';
import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { syncBrain } from '../../src/bigbrain/sync.js';

test('brain init creates a conservative unreviewed routing profile excluded from indexing', async () => {
  const fixture = await createFixture('bigbrain-profile-init-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const loaded = await loadBrainProfile(config);
    assert.equal(loaded.valid, true);
    assert.equal(loaded.profile.identity.brain_id, config.brainId);
    assert.equal(loaded.profile.routing.ingestion_mode, 'review');
    assert.equal(loaded.profile.routing.approval_required, true);
    assert.equal(loaded.profile.provenance.review_status, 'draft');
    assert.equal(loaded.about.routing.auto_write_allowed, false);

    const sync = await syncBrain({ config, apiKey: null });
    assert.equal(sync.indexed_pages, 0);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('missing and invalid profiles fail closed', async () => {
  const fixture = await createFixture('bigbrain-profile-fail-closed-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    await fs.rm(path.join(fixture.brainHome, BRAIN_PROFILE_FILENAME));
    const missing = await loadBrainProfile(config);
    assert.equal(missing.status, 'missing');
    assert.equal(missing.about.routing.effective_ingestion_mode, 'review');
    assert.equal(missing.about.routing.auto_write_allowed, false);

    await fs.writeFile(path.join(fixture.brainHome, BRAIN_PROFILE_FILENAME), 'not a profile\n', 'utf8');
    const invalid = await loadBrainProfile(config);
    assert.equal(invalid.status, 'invalid');
    assert.equal(invalid.about.routing.auto_write_allowed, false);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('profile writes enforce immutable runtime identity and explicit auto approval policy', async () => {
  const fixture = await createFixture('bigbrain-profile-write-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const profile = conservativeBrainProfileDraft(config, { updatedBy: 'people/owner' });
    profile.identity.summary = 'Private personal and commercial memory, excluding shared organization work.';
    profile.routing.ingestion_mode = 'auto';
    profile.routing.approval_required = false;
    profile.provenance.review_status = 'approved';
    const written = await writeBrainProfile(config, profile);
    const about = authenticatedBrainAbout(config, written, { writable: true, availableOperations: ['read', 'write'] });
    assert.equal(about.routing.auto_write_allowed, true);

    profile.identity.brain_id = 'brn_wrong';
    await assert.rejects(writeBrainProfile(config, profile), /immutable runtime brain_id/);
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
