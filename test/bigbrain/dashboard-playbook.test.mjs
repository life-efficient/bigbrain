import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { startDashboard } from '../../src/bigbrain/dashboard.js';
import { syncBrain } from '../../src/bigbrain/sync.js';

test('dashboard Keep in Touch playbook stores an overlay and logs contact on the person timeline', async () => {
  const fixture = await createFixture('bigbrain-dashboard-playbook-');
  let server;
  try {
    await writeMarkdown(fixture.brainHome, 'people/alice.md', `---
title: Alice Example
---
# Alice Example

Relationship context.
`);
    await writeMarkdown(fixture.brainHome, 'people/bob.md', '# Bob Example\n\nAnother person.\n');
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    server = await startDashboard(config, { host: '127.0.0.1', port: 0 });
    const url = serverUrl(server);

    const empty = await fetch(`${url}/api/playbooks/keep-in-touch`).then((response) => response.json());
    assert.equal(empty.summary.enrolled, 0);
    assert.deepEqual(empty.people.map((person) => person.slug), ['people/alice', 'people/bob']);

    const enrolled = await post(url, 'enroll', {
      page_slug: 'people/alice',
      priority: 2,
      stage: 'new',
      cadence_days: 3,
      next_due_at: '2026-08-27T08:00:00.000Z',
    });
    assert.equal(enrolled.summary.enrolled, 1);
    assert.equal(enrolled.records[0].title, 'Alice Example');
    assert.equal(enrolled.records[0].priority, 2);
    assert.equal(enrolled.records[0].is_due, true);

    const prioritized = await post(url, 'set-priority', { page_slug: 'people/alice', priority: 1 });
    assert.equal(prioritized.records[0].priority, 1);

    const snoozed = await post(url, 'snooze', { page_slug: 'people/alice', days: 7 });
    assert.equal(snoozed.records[0].is_due, false);

    const contacted = await post(url, 'log-contact', { page_slug: 'people/alice', contacted_at: '2026-08-27T10:00:00.000Z' });
    assert.equal(contacted.records[0].last_contacted_at, '2026-08-27T10:00:00.000Z');
    assert.equal(contacted.records[0].next_due_at, '2026-08-30T10:00:00.000Z');

    const markdown = await fs.readFile(path.join(fixture.brainHome, 'people/alice.md'), 'utf8');
    assert.match(markdown, /Keep in Touch contact logged\./);
    assert.doesNotMatch(markdown, /keep_in_touch_/);
  } finally {
    await server?.close();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

async function post(baseUrl, action, body) {
  const response = await fetch(`${baseUrl}/api/playbooks/keep-in-touch/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  return response.json();
}

function serverUrl(server) {
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function writeMarkdown(brainHome, relativePath, markdown) {
  const fullPath = path.join(brainHome, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, markdown, 'utf8');
}

async function createFixture(prefix) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const brainHome = path.join(rootDir, 'brain');
  const env = {
    ...process.env,
    BIGBRAIN_POINTER_PATH: path.join(rootDir, 'pointer'),
    BIGBRAIN_STATE_ROOT: path.join(rootDir, 'state'),
  };
  const init = await initializeBrainHome(brainHome, { env });
  return { rootDir, brainHome, configPath: init.configPath };
}
