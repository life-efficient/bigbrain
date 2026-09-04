import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { openDatabase } from '../../src/bigbrain/db.js';
import { startDashboard } from '../../src/bigbrain/dashboard.js';
import { saveComprehensionSession } from '../../src/bigbrain/playbooks/comprehension.js';
import { syncBrain } from '../../src/bigbrain/sync.js';

test('dashboard Comprehension view configures guidance and shows overlay summaries without changing pages', async () => {
  const fixture = await createFixture('bigbrain-dashboard-comprehension-');
  let server;
  let db;
  try {
    const markdown = '# Systems Thinking\n\nSource exposition.\n';
    await writeMarkdown(fixture.brainHome, 'concepts/systems-thinking.md', markdown);
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    db = await openDatabase(config);
    await saveComprehensionSession(db, {
      page_slug: 'concepts/systems-thinking',
      session_id: 'dashboard-1',
      summary: 'Strengths: can explain the core model.\nGaps: needs transfer.\nTutor notes: keep testing examples.\nNext resume step: ask a closed-book analogy.',
    }, { now: '2026-09-01T10:00:00Z' });
    await db.close?.();
    db = null;

    server = await startDashboard(config, { host: '127.0.0.1', port: 0 });
    const url = serverUrl(server);
    const initial = await fetch(`${url}/api/playbooks/comprehension`).then((response) => response.json());
    assert.equal(initial.setup.guidance, '');
    assert.equal(initial.pages[0].page_slug, 'concepts/systems-thinking');
    assert.match(initial.pages[0].summary, /Strengths/);

    const configured = await post(url, { guidance: 'Prioritise first principles and practical transfer.' });
    assert.equal(configured.setup.guidance, 'Prioritise first principles and practical transfer.');
    assert.equal(configured.pages[0].summary, initial.pages[0].summary);
    assert.equal(await fs.readFile(path.join(fixture.brainHome, 'concepts/systems-thinking.md'), 'utf8'), markdown);
  } finally {
    await db?.close?.();
    await server?.close();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

async function post(baseUrl, body) {
  const response = await fetch(`${baseUrl}/api/playbooks/comprehension`, {
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

async function writeMarkdown(brainHome, relativePath, markdown) {
  const fullPath = path.join(brainHome, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, markdown, 'utf8');
}
