import test from 'node:test';
import assert from 'node:assert/strict';

import { hostedBrainOptionsFromEnv } from '../../src/bigbrain/hosted-runtime.js';

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

