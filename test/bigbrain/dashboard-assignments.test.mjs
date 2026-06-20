import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { buildInboxPayload, buildTasksPayload } from '../../src/bigbrain/dashboard.js';
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

    const filtered = await buildTasksPayload(config, db, new URL('/api/tasks?assignee=people/hani', 'http://127.0.0.1'));
    assert.deepEqual(filtered.sections.flatMap((section) => section.items).map((item) => item.slug), ['tasks/follow-up']);
    assert.equal(filtered.sections[0].items[0].assignees[0].email, 'hani@example.com');

    const unknown = await buildTasksPayload(config, db, new URL('/api/tasks?assignee=people/external-advisor', 'http://127.0.0.1'));
    assert.deepEqual(unknown.sections, []);
    assert.equal(unknown.meta.open_tasks, 0);
  } finally {
    await db?.close?.();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('dashboard inbox payload exposes member-backed assignees', async () => {
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
    const config = await loadConfig({ configPath: fixture.configPath });
    db = await openDatabase(config);
    await upsertMember(db, {
      email: 'hani@example.com',
      name: 'Hani',
      person_slug: 'people/hani',
    });

    const payload = await buildInboxPayload(config, db, new URL('/api/inbox?assignee=people/hani', 'http://127.0.0.1'));
    assert.equal(payload.items.length, 1);
    assert.deepEqual(payload.items.map((item) => item.slug), ['inbox/raw-note']);
    assert.deepEqual(payload.items[0].assignees.map((member) => member.person_slug), ['people/hani']);
    assert.deepEqual(payload.items[0].invalid_assignees, ['people/unknown']);

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
