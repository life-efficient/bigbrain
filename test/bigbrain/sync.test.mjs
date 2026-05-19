import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { openDatabase } from '../../src/bigbrain/db.js';
import { searchBrain } from '../../src/bigbrain/search.js';
import { syncBrain } from '../../src/bigbrain/sync.js';

test('sync removes stale index rows after a page rename', async () => {
  const fixture = await createFixture('bigbrain-sync-rename-');
  try {
    await writeMarkdown(fixture.brainHome, 'companies/old-name.md', `---
title: Old Name
---
# Old Name

Renamed company.
---
2026-05-18 | Added.
`);

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });

    const oldPath = path.join(fixture.brainHome, 'companies', 'old-name.md');
    const newPath = path.join(fixture.brainHome, 'companies', 'new-name.md');
    await fs.rename(oldPath, newPath);
    await fs.writeFile(newPath, `---
title: New Name
---
# New Name

Renamed company.
---
2026-05-18 | Renamed.
`, 'utf8');

    await syncBrain({ config, apiKey: null });

    const db = await openDatabase(config);
    const oldResult = await searchBrain({ db, config, query: 'old name', apiKey: null });
    const newResult = await searchBrain({ db, config, query: 'new name', apiKey: null });

    assert.equal(oldResult.fused.some((row) => row.slug === 'companies/old-name'), false);
    assert.equal(newResult.fused.some((row) => row.slug === 'companies/new-name'), true);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

async function createFixture(prefix) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const pointerPath = path.join(rootDir, 'pointer');
  const stateRoot = path.join(rootDir, 'state-root');
  const brainHome = path.join(rootDir, 'brain-home');
  const init = await initializeBrainHome(brainHome, {
    env: { ...process.env, BIGBRAIN_POINTER_PATH: pointerPath, BIGBRAIN_STATE_ROOT: stateRoot },
  });
  return { rootDir, brainHome, configPath: init.configPath };
}

async function writeMarkdown(brainHome, relativePath, content) {
  const fullPath = path.join(brainHome, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
}
