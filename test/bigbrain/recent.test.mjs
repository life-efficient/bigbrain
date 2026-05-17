import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadConfig, loadState } from '../../src/bigbrain/config.js';
import { resolveWindow } from '../../src/bigbrain/time.js';
import { listRecentFiles } from '../../src/bigbrain/recent.js';

test('recent listing excludes tasks file and .raw paths and sorts newest first', async () => {
  const fixture = await createFixture();
  try {
    const now = new Date('2026-05-18T12:00:00.000Z');
    await writeMarkdown(fixture.brainDir, 'meetings/client-sync.md', '# Client Sync');
    await writeMarkdown(fixture.brainDir, 'projects/new-launch.md', '# Launch');
    await writeMarkdown(fixture.brainDir, 'ops/tasks.md', '# Tasks');
    await writeMarkdown(fixture.brainDir, 'meetings/.raw/transcript.md', '# Raw');

    await setMtime(path.join(fixture.brainDir, 'meetings/client-sync.md'), '2026-05-18T11:30:00.000Z');
    await setMtime(path.join(fixture.brainDir, 'projects/new-launch.md'), '2026-05-18T11:45:00.000Z');
    await setMtime(path.join(fixture.brainDir, 'ops/tasks.md'), '2026-05-18T11:50:00.000Z');
    await setMtime(path.join(fixture.brainDir, 'meetings/.raw/transcript.md'), '2026-05-18T11:40:00.000Z');

    const config = await loadConfig(fixture.configPath);
    const state = await loadState(fixture.statePath);
    const window = resolveWindow({
      stateLastCheckedAt: state.lastCheckedAt,
      fallbackDuration: config.lookbackFallback,
      now,
    });
    const report = await listRecentFiles(config, window, { now });

    assert.deepEqual(
      report.files.map((file) => file.relative_path),
      ['projects/new-launch.md', 'meetings/client-sync.md'],
    );
    assert.equal(report.files[0].category, 'projects');
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('recent listing uses fallback window when state file is missing', async () => {
  const fixture = await createFixture({ withState: false });
  try {
    const now = new Date('2026-05-18T12:00:00.000Z');
    await writeMarkdown(fixture.brainDir, 'people/alice.md', '# Alice');
    await setMtime(path.join(fixture.brainDir, 'people/alice.md'), '2026-05-17T15:00:00.000Z');

    const config = await loadConfig(fixture.configPath);
    const state = await loadState(fixture.statePath, { allowMissing: true });
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

test('loadState fails clearly on malformed state json', async () => {
  const fixture = await createFixture();
  try {
    await fs.writeFile(fixture.statePath, '{"last_checked_at": "not-a-date"}\n', 'utf8');
    await assert.rejects(() => loadState(fixture.statePath), /last_checked_at/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

async function createFixture({ withState = true } = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-recent-'));
  const brainDir = path.join(rootDir, 'brain');
  const tasksFile = path.join(brainDir, 'ops', 'tasks.md');
  const configPath = path.join(rootDir, 'bigbrain.config.json');
  const statePath = path.join(rootDir, 'bigbrain.state.json');

  await fs.mkdir(path.join(brainDir, 'ops'), { recursive: true });
  await fs.mkdir(path.join(brainDir, 'meetings', '.raw'), { recursive: true });
  await fs.mkdir(path.join(brainDir, 'projects'), { recursive: true });
  await fs.mkdir(path.join(brainDir, 'people'), { recursive: true });

  await fs.writeFile(configPath, JSON.stringify({
    brain_dir: brainDir,
    tasks_file: tasksFile,
    include_globs: ['**/*.md'],
    exclude_globs: ['.git/**', 'archive/**', '.raw/**', tasksFile],
    lookback_fallback: '24h',
  }, null, 2), 'utf8');

  if (withState) {
    await fs.writeFile(statePath, JSON.stringify({
      last_checked_at: null,
      last_run_status: null,
      last_run_summary: null,
    }, null, 2), 'utf8');
  }

  return { rootDir, brainDir, tasksFile, configPath, statePath };
}

async function writeMarkdown(brainDir, relativePath, content) {
  const fullPath = path.join(brainDir, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, `${content}\n`, 'utf8');
}

async function setMtime(filePath, isoString) {
  const date = new Date(isoString);
  await fs.utimes(filePath, date, date);
}
