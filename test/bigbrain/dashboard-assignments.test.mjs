import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { buildInboxPayload, buildPreviewPayload, buildTasksPayload } from '../../src/bigbrain/dashboard.js';
import { openDatabase } from '../../src/bigbrain/db.js';
import { upsertMember } from '../../src/bigbrain/members.js';

test('dashboard task pages filter assignees through active members', async () => {
  const fixture = await createFixture('bigbrain-dashboard-assignments-');
  let db;
  try {
    await writeMarkdown(fixture.brainHome, 'tasks/follow-up.md', `---
title: Follow up with Ahmed
status: open
priority: p1
readiness: ready
execution_mode: interactive
assignees: [people/hani]
source: [meetings/ahmed]
---
# Follow up with Ahmed

Send the proposal.
`);
    await writeMarkdown(fixture.brainHome, 'tasks/external-task.md', `---
title: External owner task
status: open
priority: p2
assignees: [people/external-advisor]
---
# External owner task

This should not resolve to a member.
`);
    await writeMarkdown(fixture.brainHome, 'tasks/FILING.md', `# Task Filing

Guidance for task page shape.
`);
    await writeMarkdown(fixture.brainHome, 'tasks/README.md', `# Tasks

Task collection overview.
`);

    const config = await loadConfig({ configPath: fixture.configPath });
    db = await openDatabase(config);
    await upsertMember(db, {
      email: 'hani@example.com',
      name: 'Hani',
      person_slug: 'people/hani',
      role: 'owner',
    });

    const all = await buildTasksPayload(config, db);
    assert.equal(all.source, 'task_pages');
    assert.equal(all.meta.open_tasks, 2);
    assert.equal(all.meta.invalid_assignments, 1);
    assert.equal(all.members[0].person_slug, 'people/hani');
    assert.deepEqual(
      all.sections.flatMap((section) => section.items).map((item) => item.slug).sort(),
      ['tasks/external-task', 'tasks/follow-up'],
    );
    const readinessBySlug = Object.fromEntries(all.sections.flatMap((section) => section.items).map((item) => [item.slug, item.readiness]));
    assert.equal(readinessBySlug['tasks/follow-up'], 'ready');
    assert.equal(readinessBySlug['tasks/external-task'], 'underspecified');
    const executionModeBySlug = Object.fromEntries(all.sections.flatMap((section) => section.items).map((item) => [item.slug, item.execution_mode]));
    assert.equal(executionModeBySlug['tasks/follow-up'], 'interactive');
    assert.equal(executionModeBySlug['tasks/external-task'], 'agent');

    const filtered = await buildTasksPayload(config, db, new URL('/api/tasks?assignee=people/hani', 'http://127.0.0.1'));
    assert.deepEqual(filtered.sections.flatMap((section) => section.items).map((item) => item.slug), ['tasks/follow-up']);
    assert.equal(filtered.sections[0].items[0].assignees[0].email, 'hani@example.com');

    const currentUser = await buildTasksPayload(config, db, new URL('/api/tasks', 'http://127.0.0.1'), {
      actor: { email: 'hani@example.com', name: 'Hani' },
    });
    assert.equal(currentUser.filters.current_member.person_slug, 'people/hani');

    const unknown = await buildTasksPayload(config, db, new URL('/api/tasks?assignee=people/external-advisor', 'http://127.0.0.1'));
    assert.deepEqual(unknown.sections, []);
    assert.equal(unknown.meta.open_tasks, 0);
  } finally {
    await db?.close?.();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('dashboard task page items expose slugs for sidecar previews and relative links', async () => {
  const fixture = await createFixture('bigbrain-dashboard-task-links-');
  let db;
  try {
    await writeMarkdown(fixture.brainHome, 'tasks/follow-up.md', `---
title: Follow up with Ahmed
status: open
priority: p1
---
# Follow up with Ahmed

Send the proposal to [Ahmed](../people/ahmed.md).
`);
    await writeMarkdown(fixture.brainHome, 'people/ahmed.md', `---
title: Ahmed
---
# Ahmed

Partner contact.
`);

    const config = await loadConfig({ configPath: fixture.configPath });
    db = await openDatabase(config);

    const payload = await buildTasksPayload(config, db);
    const task = payload.sections.flatMap((section) => section.items)[0];
    assert.equal(task.slug, 'tasks/follow-up');
    assert.equal(task.markdown, 'Follow up with Ahmed');

    const preview = await buildPreviewPayload(
      config,
      db,
      new URL('/api/preview?from=tasks/follow-up&target=../people/ahmed.md', 'http://127.0.0.1'),
    );
    assert.equal(preview.slug, 'people/ahmed');
    assert.equal(preview.title, 'Ahmed');
  } finally {
    await db?.close?.();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('legacy dashboard inbox payload exposes deprecation metadata and member-backed assignees', async () => {
  const fixture = await createFixture('bigbrain-dashboard-inbox-assignments-');
  let db;
  try {
    await writeMarkdown(fixture.brainHome, 'inbox/raw-note.md', `---
title: Raw Note
status: triage
assignees: [people/hani, people/unknown]
---
# Raw Note

Needs sorting.
`);
    await writeMarkdown(fixture.brainHome, 'inbox/filing.md', `# Inbox Filing

Guidance for inbox handling.
`);
    await writeMarkdown(fixture.brainHome, 'inbox/README.md', `# Inbox

Collection overview.
`);
    const config = await loadConfig({ configPath: fixture.configPath });
    db = await openDatabase(config);
    await upsertMember(db, {
      email: 'hani@example.com',
      name: 'Hani',
      person_slug: 'people/hani',
    });

    const payload = await buildInboxPayload(config, db, new URL('/api/inbox?assignee=people/hani', 'http://127.0.0.1'));
    assert.equal(payload.deprecated, true);
    assert.match(payload.guidance, /Create or update tasks/);
    assert.equal(payload.items.length, 1);
    assert.deepEqual(payload.items.map((item) => item.slug), ['inbox/raw-note']);
    assert.deepEqual(payload.items[0].assignees.map((member) => member.person_slug), ['people/hani']);
    assert.deepEqual(payload.items[0].invalid_assignees, ['people/unknown']);

    const currentUser = await buildInboxPayload(config, db, new URL('/api/inbox', 'http://127.0.0.1'), {
      actor: { email: 'hani@example.com', name: 'Hani' },
    });
    assert.equal(currentUser.filters.current_member.person_slug, 'people/hani');

    const unknown = await buildInboxPayload(config, db, new URL('/api/inbox?assignee=people/unknown', 'http://127.0.0.1'));
    assert.deepEqual(unknown.items, []);
  } finally {
    await db?.close?.();
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
