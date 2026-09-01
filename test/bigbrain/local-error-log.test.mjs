import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { appendLocalErrorLog } = require('../../electron/lib/local-error-log.cjs');

test('local error logs are bounded and sanitize nested values', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-errors-'));
  try {
    for (let index = 0; index < 4; index += 1) {
      appendLocalErrorLog({
        logDirectory: directory,
        maxEntries: 2,
        entry: { index, nested: { secret: 'kept but bounded' } },
      });
    }
    const lines = (await fs.readFile(path.join(directory, 'errors.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[0]), { index: 2, nested: { secret: 'kept but bounded' } });
    assert.deepEqual(JSON.parse(lines[1]), { index: 3, nested: { secret: 'kept but bounded' } });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('desktop error handling records failures without automatic renderer recovery', async () => {
  const [mainSource, clientSource] = await Promise.all([
    fs.readFile(new URL('../../electron/main.cjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/main.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(mainSource, /recordAppError/);
  assert.match(mainSource, /dashboard-renderer-gone/);
  assert.match(mainSource, /showLoadFailure\(`The dashboard renderer stopped unexpectedly/);
  assert.doesNotMatch(mainSource, /function recoverRenderer/);
  assert.match(clientSource, /recordDashboardError/);
  assert.match(clientSource, /Diagnostic report saved locally as/);
  assert.match(clientSource, /window\.location\.reload\(\)/);
  assert.match(clientSource, /async function copyErrorDetails\(\)/);
  assert.match(clientSource, /await copyTextToClipboard\(errorDetails\)/);
  assert.match(clientSource, /Copy error/);
});
