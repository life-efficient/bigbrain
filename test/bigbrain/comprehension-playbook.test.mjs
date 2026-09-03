import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { openDatabase } from '../../src/bigbrain/db.js';
import { getPlaybookRecord } from '../../src/bigbrain/playbook-store.js';
import { syncBrain } from '../../src/bigbrain/sync.js';
import {
  buildComprehensionPayload,
  getComprehensionPage,
  saveComprehensionSession,
  updateComprehensionSetup,
} from '../../src/bigbrain/playbooks/comprehension.js';

test('Comprehension stores user guidance and minimal page session report cards in the overlay', async () => {
  const fixture = await createFixture('bigbrain-comprehension-');
  let db;
  try {
    const source = `---\ntitle: Systems Thinking\n---\n# Systems Thinking\n\nA page about systems.\n`;
    await writeMarkdown(fixture.brainHome, 'concepts/systems-thinking.md', source);
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    db = await openDatabase(config);

    const actor = { email: 'Harry@example.com' };
    assert.deepEqual(await updateComprehensionSetup(db, {
      guidance: 'Understand the ideas most useful for building better products.',
    }, { actor, now: '2026-09-01T10:00:00Z' }), {
      guidance: 'Understand the ideas most useful for building better products.',
    });

    const first = await saveComprehensionSession(db, {
      page_slug: 'concepts/systems-thinking',
      session_id: 'systems-1',
      summary: 'Report card\nStrengths: distinguishes stocks from flows.\nGaps: needs transfer practice.\nTutor notes: use a concrete product example.\nNext resume step: test a causal loop.',
    }, { actor, now: '2026-09-01T10:01:00Z' });
    const second = await saveComprehensionSession(db, {
      page_slug: 'concepts/systems-thinking',
      session_id: 'systems-1',
      summary: 'Report card\nStrengths: explains stocks, flows, and causal loops.\nGaps: analogy is still tentative.\nTutor notes: ask for a product transfer example.\nNext resume step: closed-book transfer question.',
    }, { actor, now: '2026-09-01T10:05:00Z' });

    assert.equal(first.created_at, second.created_at);
    assert.deepEqual(Object.keys((await getPlaybookRecord(db, {
      ownerKey: 'member:harry@example.com',
      playbookId: 'comprehension',
      recordType: 'session',
      scopeKey: 'page:concepts/systems-thinking/systems-1',
    })).data), ['summary']);

    const payload = await buildComprehensionPayload(config, db, { actor });
    assert.equal(payload.setup.guidance, 'Understand the ideas most useful for building better products.');
    assert.equal(payload.summary.pages_with_sessions, 1);
    assert.equal(payload.pages[0].page_slug, 'concepts/systems-thinking');
    assert.equal(payload.pages[0].summary, second.summary);
    assert.equal(payload.pages[0].page_exists, true);

    const history = await getComprehensionPage(db, 'concepts/systems-thinking', { actor });
    assert.equal(history.sessions.length, 1);
    assert.equal(history.latest_session.summary, second.summary);

    const otherActor = await buildComprehensionPayload(config, db, { actor: { email: 'other@example.com' } });
    assert.equal(otherActor.summary.pages_with_sessions, 0);
    assert.equal(otherActor.setup.guidance, '');
    assert.equal((await fs.readFile(path.join(fixture.brainHome, 'concepts/systems-thinking.md'), 'utf8')), source);
  } finally {
    await db?.close?.();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('Comprehension rejects task pages and blank report cards', async () => {
  const fixture = await createFixture('bigbrain-comprehension-validation-');
  let db;
  try {
    await writeMarkdown(fixture.brainHome, 'tasks/learn.md', '# Learn\n');
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    db = await openDatabase(config);
    await assert.rejects(() => saveComprehensionSession(db, { page_slug: 'tasks/learn', summary: 'x' }), /non-task Brain page/);
    await assert.rejects(() => saveComprehensionSession(db, { page_slug: 'tasks/learn', summary: '' }), /non-task Brain page/);
  } finally {
    await db?.close?.();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

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
