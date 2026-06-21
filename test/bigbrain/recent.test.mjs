import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig, loadState, metaDirForBrainHome } from '../../src/bigbrain/config.js';
import { listRecentFiles } from '../../src/bigbrain/recent.js';
import { resolveWindow } from '../../src/bigbrain/time.js';

test('recent listing excludes .raw paths and sorts newest first', async () => {
  const fixture = await createFixture();
  try {
    const now = new Date('2026-05-18T12:00:00.000Z');
    await writeMarkdown(fixture.brainHome, 'meetings/client-sync.md', '# Client Sync');
    await writeMarkdown(fixture.brainHome, 'projects/new-launch.md', '# Launch');
    await writeMarkdown(fixture.brainHome, 'meetings/.raw/transcript.md', '# Raw');

    await setMtime(path.join(fixture.brainHome, 'meetings/client-sync.md'), '2026-05-18T11:30:00.000Z');
    await setMtime(path.join(fixture.brainHome, 'projects/new-launch.md'), '2026-05-18T11:45:00.000Z');
    await setMtime(path.join(fixture.brainHome, 'meetings/.raw/transcript.md'), '2026-05-18T11:40:00.000Z');

    const config = await loadConfig({ configPath: fixture.configPath });
    const state = await loadState({ statePath: fixture.statePath });
    const window = resolveWindow({
      stateLastCheckedAt: state.lastCheckedAt,
      fallbackDuration: config.lookbackFallback,
      now,
    });
    const report = await listRecentFiles(config, window, { now });

    assert.deepEqual(report.files.map((file) => file.relative_path), [
      'projects/new-launch.md',
      'meetings/client-sync.md',
    ]);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('recent listing uses fallback window when state file is missing', async () => {
  const fixture = await createFixture({ withState: false });
  try {
    const now = new Date('2026-05-18T12:00:00.000Z');
    await writeMarkdown(fixture.brainHome, 'people/alice.md', '# Alice');
    await setMtime(path.join(fixture.brainHome, 'people/alice.md'), '2026-05-17T15:00:00.000Z');

    const config = await loadConfig({ configPath: fixture.configPath });
    const state = await loadState({ statePath: fixture.statePath }, { allowMissing: true });
    const window = resolveWindow({
      stateLastCheckedAt: state.lastCheckedAt,
      fallbackDuration: config.lookbackFallback,
      now,
    });
    assert.equal(window.windowStart.toISOString(), '2026-05-17T12:00:00.000Z');
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

async function createFixture({ withState = true } = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-recent-'));
  const pointerPath = path.join(rootDir, 'pointer');
  const stateRoot = path.join(rootDir, 'state-root');
  const brainHome = path.join(rootDir, 'brain-home');
  const env = { ...process.env, BIGBRAIN_POINTER_PATH: pointerPath, BIGBRAIN_STATE_ROOT: stateRoot };
  const init = await initializeBrainHome(brainHome, { env });
  if (!withState) {
    await fs.rm(path.join(metaDirForBrainHome(brainHome, env), 'state.json'), { force: true });
  }
  await fs.mkdir(path.join(brainHome, 'meetings', '.raw'), { recursive: true });
  return { rootDir, brainHome, configPath: init.configPath, statePath: init.statePath };
}

async function writeMarkdown(brainHome, relativePath, content) {
  const fullPath = path.join(brainHome, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, `${content}\n`, 'utf8');
}

async function setMtime(filePath, isoString) {
  const date = new Date(isoString);
  await fs.utimes(filePath, date, date);
}
