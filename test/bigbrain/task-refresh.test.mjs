import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runTaskRefresh } from '../../src/bigbrain/task-refresh.js';

test('recent meeting update rewrites an existing matching task', async () => {
  const fixture = await createFixture();
  try {
    await writeFile(fixture.tasksFile, `# Tasks

## P1 — Today
- [ ] Review the [Client Sync](../meetings/client-sync.md) and possibly tomorrow follow up with Jordan.

## P2 — This Week

## P3 — Backlog
`);
    await writeFile(path.join(fixture.brainDir, 'meetings', 'client-sync.md'), `# Client Sync

## Open Threads
- Send Jordan the revised follow-up package before the next check-in.
`);
    await setMtime(path.join(fixture.brainDir, 'meetings', 'client-sync.md'), '2026-05-18T09:00:00.000Z');

    const result = await runTaskRefresh({
      configPath: fixture.configPath,
      statePath: fixture.statePath,
      now: new Date('2026-05-18T12:00:00.000Z'),
    });

    const nextTasks = await fs.readFile(fixture.tasksFile, 'utf8');
    assert.equal(result.updated_tasks, 1);
    assert.match(nextTasks, /Send Jordan the revised follow-up package/);
    assert.doesNotMatch(nextTasks, /possibly tomorrow/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('recent project update adds a missing task when open threads are explicit', async () => {
  const fixture = await createFixture();
  try {
    await writeFile(fixture.tasksFile, `# Tasks

## P1 — Today

## P2 — This Week

## P3 — Backlog
`);
    await writeFile(path.join(fixture.brainDir, 'projects', 'launch-plan.md'), `# Launch Plan

## Open Threads
- Confirm the launch owner and reset the public launch date.
`);
    await setMtime(path.join(fixture.brainDir, 'projects', 'launch-plan.md'), '2026-05-18T10:00:00.000Z');

    const result = await runTaskRefresh({
      configPath: fixture.configPath,
      statePath: fixture.statePath,
      now: new Date('2026-05-18T12:00:00.000Z'),
    });

    const nextTasks = await fs.readFile(fixture.tasksFile, 'utf8');
    assert.equal(result.added_tasks, 1);
    assert.match(nextTasks, /Confirm the launch owner and reset the public launch date/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('task refresh does not duplicate an existing task already matched by source link', async () => {
  const fixture = await createFixture();
  try {
    await writeFile(fixture.tasksFile, `# Tasks

## P1 — Today
- [ ] Send Jordan the revised follow-up package [Source: [Client Sync](../meetings/client-sync.md), refreshed 2026-05-17]

## P2 — This Week

## P3 — Backlog
`);
    await writeFile(path.join(fixture.brainDir, 'meetings', 'client-sync.md'), `# Client Sync

## Open Threads
- Send Jordan the revised follow-up package.
`);
    await setMtime(path.join(fixture.brainDir, 'meetings', 'client-sync.md'), '2026-05-18T08:00:00.000Z');

    const result = await runTaskRefresh({
      configPath: fixture.configPath,
      statePath: fixture.statePath,
      now: new Date('2026-05-18T12:00:00.000Z'),
    });

    const nextTasks = await fs.readFile(fixture.tasksFile, 'utf8');
    const occurrences = (nextTasks.match(/Send Jordan the revised follow-up package/g) ?? []).length;
    assert.equal(result.added_tasks, 0);
    assert.equal(occurrences, 1);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('no relevant changed files leaves the task file untouched and still updates state', async () => {
  const fixture = await createFixture();
  try {
    const original = `# Tasks

## P1 — Today
- [ ] Keep the current task wording.

## P2 — This Week

## P3 — Backlog
`;
    await writeFile(fixture.tasksFile, original);
    await writeFile(path.join(fixture.brainDir, 'writing', 'note.md'), '# Writing Note');
    await setMtime(path.join(fixture.brainDir, 'writing', 'note.md'), '2026-05-18T08:00:00.000Z');

    const result = await runTaskRefresh({
      configPath: fixture.configPath,
      statePath: fixture.statePath,
      now: new Date('2026-05-18T12:00:00.000Z'),
    });

    const nextTasks = await fs.readFile(fixture.tasksFile, 'utf8');
    const state = JSON.parse(await fs.readFile(fixture.statePath, 'utf8'));
    assert.equal(result.changed, false);
    assert.equal(nextTasks, original);
    assert.equal(state.last_checked_at, '2026-05-18T12:00:00.000Z');
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('dry run does not advance state', async () => {
  const fixture = await createFixture();
  try {
    await writeFile(fixture.tasksFile, `# Tasks

## P1 — Today

## P2 — This Week

## P3 — Backlog
`);
    await writeFile(path.join(fixture.brainDir, 'projects', 'launch-plan.md'), `# Launch Plan

## Open Threads
- Confirm the launch owner and reset the public launch date.
`);
    await setMtime(path.join(fixture.brainDir, 'projects', 'launch-plan.md'), '2026-05-18T10:00:00.000Z');

    await runTaskRefresh({
      configPath: fixture.configPath,
      statePath: fixture.statePath,
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
  const brainDir = path.join(rootDir, 'brain');
  const tasksFile = path.join(brainDir, 'ops', 'tasks.md');
  const configPath = path.join(rootDir, 'bigbrain.config.json');
  const statePath = path.join(rootDir, 'bigbrain.state.json');

  await fs.mkdir(path.join(brainDir, 'ops'), { recursive: true });
  await fs.mkdir(path.join(brainDir, 'meetings'), { recursive: true });
  await fs.mkdir(path.join(brainDir, 'projects'), { recursive: true });
  await fs.mkdir(path.join(brainDir, 'writing'), { recursive: true });

  await fs.writeFile(configPath, JSON.stringify({
    brain_dir: brainDir,
    tasks_file: tasksFile,
    include_globs: ['**/*.md'],
    exclude_globs: ['.git/**', 'archive/**', '.raw/**', tasksFile],
    lookback_fallback: '24h',
  }, null, 2), 'utf8');

  await fs.writeFile(statePath, JSON.stringify({
    last_checked_at: null,
    last_run_status: null,
    last_run_summary: null,
  }, null, 2), 'utf8');

  return { rootDir, brainDir, tasksFile, configPath, statePath };
}

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function setMtime(filePath, isoString) {
  const date = new Date(isoString);
  await fs.utimes(filePath, date, date);
}
