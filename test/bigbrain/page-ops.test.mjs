import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { openDatabase, getPageRecord } from '../../src/bigbrain/db.js';
import {
  createBrainPage,
  listBrainPath,
  readBrainPage,
  updateBrainPage,
} from '../../src/bigbrain/page-ops.js';
import { syncBrain } from '../../src/bigbrain/sync.js';

test('page ops create and update brain pages with frontmatter, body, and timeline', async () => {
  const fixture = await createFixture('bigbrain-page-ops-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const created = await createBrainPage({
      config,
      pagePath: 'people/jordan-lee',
      title: 'Jordan Lee',
      body: 'Jordan Lee is a partner contact for Example Brain.',
      timelineEntry: 'Created from MCP contribution.',
      frontmatter: { tags: ['example-brain', 'person'] },
    });

    assert.equal(created.path, 'people/jordan-lee.md');
    assert.equal(created.title, 'Jordan Lee');
    assert.match(created.markdown, /^---\ntype: note\ntitle: Jordan Lee\ncreated: \d{4}-\d{2}-\d{2}\ntags: \[example-brain, person\]\n---/);
    assert.match(created.markdown, /\n---\n\n## Timeline\n\n- \*\*\d{4}-\d{2}-\d{2}\*\* \| Created from MCP contribution\.\n$/);

    const updated = await updateBrainPage({
      config,
      pagePath: 'people/jordan-lee.md',
      body: 'Jordan Lee is the current Example Brain partner contact.',
      timelineEntry: 'Updated current role from team contribution.',
    });

    assert.match(updated.body, /current Example Brain partner contact/);
    assert.match(updated.timeline, /Created from MCP contribution/);
    assert.match(updated.timeline, /Updated current role from team contribution/);

    await syncBrain({ config, apiKey: null });
    const db = await openDatabase(config);
    const record = getPageRecord(db, 'people/jordan-lee');
    assert.equal(record.title, 'Jordan Lee');
    assert.match(record.compiled_truth, /current Example Brain partner contact/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('page ops list filters hidden runtime state and reject path escapes', async () => {
  const fixture = await createFixture('bigbrain-page-ops-safety-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    await fs.writeFile(path.join(fixture.brainHome, 'people', 'alice.md'), `---
type: note
title: Alice
created: 2026-06-17
---

# Alice

Current body.

---

## Timeline

- **2026-06-17** | Created.
`, 'utf8');
    await fs.mkdir(path.join(fixture.brainHome, '.bigbrain-state'), { recursive: true });
    await fs.writeFile(path.join(fixture.brainHome, '.bigbrain-state', 'secret.md'), 'hidden', 'utf8');

    const entries = await listBrainPath({ config, relativePath: '', recursive: true });
    assert.equal(entries.some((entry) => entry.path === 'people/alice.md'), true);
    assert.equal(entries.some((entry) => entry.path.includes('.bigbrain-state')), false);

    await assert.rejects(() => readBrainPage({ config, pagePath: '../outside.md' }), /Invalid brain path|escapes brain root/);
    await assert.rejects(() => createBrainPage({
      config,
      pagePath: 'alice.md',
      title: 'Alice',
      body: 'Body',
      timelineEntry: 'Created.',
    }), /collection folder/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('page updates preserve existing multiline frontmatter', async () => {
  const fixture = await createFixture('bigbrain-page-ops-frontmatter-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    await fs.writeFile(path.join(fixture.brainHome, 'people', 'alice.md'), `---
type: note
title: Alice
created: 2026-06-17
tags:
  - example-brain
  - person
---

# Alice

Current body.

---

## Timeline

- **2026-06-17** | Created.
`, 'utf8');

    const updated = await updateBrainPage({
      config,
      pagePath: 'people/alice.md',
      body: 'Updated body.',
      timelineEntry: 'Updated from MCP.',
    });

    assert.match(updated.markdown, /tags:\n  - example-brain\n  - person\n---/);
    assert.match(updated.markdown, /# Alice\n\nUpdated body\./);
    assert.match(updated.timeline, /Updated from MCP/);
  } finally {
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
