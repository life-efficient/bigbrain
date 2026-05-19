import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome } from '../../src/bigbrain/config.js';
import { runTaskRefresh } from '../../src/bigbrain/task-refresh.js';

test('recent meeting update rewrites an existing matching task', async () => {
  const fixture = await createFixture();
  try {
    await writeFile(path.join(fixture.brainHome, 'ops/tasks.md'), `# Tasks

## P1 — Today
- [ ] Review the [Client Sync](../meetings/client-sync.md) and possibly tomorrow follow up with Jordan.

## P2 — This Week

## P3 — Backlog
`);
    await writeFile(path.join(fixture.brainHome, 'meetings/client-sync.md'), `# Client Sync

## Open Threads
- Send Jordan the revised follow-up package before the next check-in.
`);
    await setMtime(path.join(fixture.brainHome, 'meetings/client-sync.md'), '2026-05-18T09:00:00.000Z');

    const result = await runTaskRefresh({
      configPath: fixture.configPath,
      statePath: fixture.statePath,
      brainHome: fixture.brainHome,
      now: new Date('2026-05-18T12:00:00.000Z'),
    });
    const nextTasks = await fs.readFile(path.join(fixture.brainHome, 'ops/tasks.md'), 'utf8');
    assert.equal(result.updated_tasks, 1);
    assert.match(nextTasks, /Send Jordan the revised follow-up package/);
    assert.doesNotMatch(nextTasks, /possibly tomorrow/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('dry run does not advance state', async () => {
  const fixture = await createFixture();
  try {
    await writeFile(path.join(fixture.brainHome, 'projects/launch-plan.md'), `# Launch Plan

## Open Threads
- Confirm the launch owner and reset the public launch date.
`);
    await setMtime(path.join(fixture.brainHome, 'projects/launch-plan.md'), '2026-05-18T10:00:00.000Z');

    await runTaskRefresh({
      configPath: fixture.configPath,
      statePath: fixture.statePath,
      brainHome: fixture.brainHome,
      dryRun: true,
      now: new Date('2026-05-18T12:00:00.000Z'),
    });

    const state = JSON.parse(await fs.readFile(fixture.statePath, 'utf8'));
    assert.equal(state.last_checked_at, null);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

async function createFixture() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-tasks-'));
  const pointerPath = path.join(rootDir, 'pointer');
  const stateRoot = path.join(rootDir, 'state-root');
  const brainHome = path.join(rootDir, 'brain-home');
  const init = await initializeBrainHome(brainHome, { env: { ...process.env, BIGBRAIN_POINTER_PATH: pointerPath, BIGBRAIN_STATE_ROOT: stateRoot } });
  return { rootDir, brainHome, configPath: init.configPath, statePath: init.statePath };
}

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function setMtime(filePath, isoString) {
  const date = new Date(isoString);
  await fs.utimes(filePath, date, date);
}
