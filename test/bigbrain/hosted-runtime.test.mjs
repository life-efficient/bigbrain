import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { hostedBrainOptionsFromEnv, prepareBigBrainRuntime } from '../../src/bigbrain/hosted-runtime.js';

test('hosted brain runtime prefers BRAIN_ROOT and keeps BRAIN_SUBDIR as a legacy alias', () => {
  const options = hostedBrainOptionsFromEnv({
    DATA_DIR: '/srv/data',
    BRAIN_NAME: 'Example Brain',
    BRAIN_REPO_URL: 'https://github.com/example/brain.git',
    BRAIN_ROOT: 'brain',
    BRAIN_RUNTIME_ID: 'example',
  });

  assert.equal(options.brainDir, '/srv/data/brain/brain');
  assert.equal(options.brainRoot, 'brain');
  assert.equal(options.runtimeDir, '/srv/data/bigbrain-runtime/example');

  const legacy = hostedBrainOptionsFromEnv({
    DATA_DIR: '/srv/data',
    BRAIN_NAME: 'Legacy Brain',
    BRAIN_REPO_URL: 'https://github.com/example/legacy.git',
    BRAIN_SUBDIR: 'brain',
  });
  assert.equal(legacy.brainDir, '/srv/data/legacy/brain');
});

test('hosted runtime persists one brain ID across config regeneration', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-hosted-identity-'));
  try {
    const options = hostedBrainOptionsFromEnv({
      DATA_DIR: dataDir,
      BRAIN_NAME: 'ICAIRE',
      BRAIN_REPO_URL: 'https://github.com/example/icaire.git',
      BRAIN_RUNTIME_ID: 'icaire',
    });
    await prepareBigBrainRuntime(options, {});
    const first = JSON.parse(await fs.readFile(options.configPath, 'utf8'));
    await prepareBigBrainRuntime({ ...options, brainName: 'ICAIRE Brain' }, {});
    const second = JSON.parse(await fs.readFile(options.configPath, 'utf8'));
    assert.match(first.brain_id, /^brn_[0-9a-f-]{36}$/);
    assert.equal(second.brain_id, first.brain_id);
    assert.equal(second.brain_name, 'ICAIRE Brain');
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
