import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { openDatabase, getPageRecord } from '../../src/bigbrain/db.js';
import {
  createBrainPage,
  createRawFile,
  createRawFileWithPage,
  deleteRawFile,
  listBrainPath,
  listRawFiles,
  readBrainPage,
  readRawFile,
  updateRawFile,
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
    const record = await getPageRecord(db, 'people/jordan-lee');
    assert.equal(record.title, 'Jordan Lee');
    assert.match(record.compiled_truth, /current Example Brain partner contact/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('page ops create raw files with associated brain pages', async () => {
  const fixture = await createFixture('bigbrain-page-ops-raw-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const pdfBytes = Buffer.from('%PDF-1.4\nraw deck\n%%EOF\n', 'utf8');
    const result = await createRawFileWithPage({
      config,
      rawPath: 'sources/.raw/example-deck.pdf',
      rawContentBase64: pdfBytes.toString('base64'),
      mimeType: 'application/pdf',
      pagePath: 'sources/example-deck',
      title: 'Example Brain Deck',
      body: 'Source deck for the Example Brain programme.',
      timelineEntry: 'Uploaded source deck and created page.',
      frontmatter: { tags: ['example-brain', 'source'] },
    });

    assert.equal(result.raw_file.path, 'sources/.raw/example-deck.pdf');
    assert.equal(result.raw_file.size, pdfBytes.length);
    assert.equal(result.page.slug, 'sources/example-deck');
    assert.equal(result.page.frontmatter.raw_file, 'sources/.raw/example-deck.pdf');
    assert.match(result.page.markdown, /raw_mime_type: application\/pdf/);
    assert.match(result.page.markdown, /- \[example-deck\.pdf\]\(\.raw\/example-deck\.pdf\)/);

    const storedRaw = await fs.readFile(path.join(fixture.brainHome, 'sources', '.raw', 'example-deck.pdf'));
    assert.deepEqual(storedRaw, pdfBytes);

    await syncBrain({ config, apiKey: null });
    const db = await openDatabase(config);
    assert.equal((await getPageRecord(db, 'sources/example-deck')).title, 'Example Brain Deck');
    assert.equal(await getPageRecord(db, 'sources/.raw/example-deck.pdf'), undefined);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('page ops support raw file CRUD without indexing raw files', async () => {
  const fixture = await createFixture('bigbrain-page-ops-raw-crud-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const created = await createRawFile({
      config,
      rawPath: 'sources/.raw/uploads/source.txt',
      rawContentText: 'initial raw text',
      mimeType: 'text/plain',
    });

    assert.equal(created.path, 'sources/.raw/uploads/source.txt');
    assert.equal(created.size, 'initial raw text'.length);

    const readInitial = await readRawFile({ config, rawPath: 'sources/.raw/uploads/source.txt' });
    assert.equal(Buffer.from(readInitial.content_base64, 'base64').toString('utf8'), 'initial raw text');

    const updated = await updateRawFile({
      config,
      rawPath: 'sources/.raw/uploads/source.txt',
      rawContentText: 'updated raw text',
      mimeType: 'text/plain',
    });
    assert.equal(updated.size, 'updated raw text'.length);

    await createRawFile({
      config,
      rawPath: 'meetings/.raw/transcript.txt',
      rawContentText: 'meeting raw text',
    });

    const allRaw = await listRawFiles({ config });
    assert.deepEqual(allRaw.map((entry) => entry.path), [
      'meetings/.raw/transcript.txt',
      'sources/.raw/uploads/source.txt',
    ]);

    const sourcesRaw = await listRawFiles({ config, rawPath: 'sources/.raw', recursive: false });
    assert.deepEqual(sourcesRaw.map((entry) => entry.path), []);

    const nestedSourcesRaw = await listRawFiles({ config, rawPath: 'sources/.raw', recursive: true });
    assert.deepEqual(nestedSourcesRaw.map((entry) => entry.path), ['sources/.raw/uploads/source.txt']);

    const deleted = await deleteRawFile({ config, rawPath: 'sources/.raw/uploads/source.txt' });
    assert.deepEqual(deleted, { path: 'sources/.raw/uploads/source.txt', deleted: true });
    await assert.rejects(() => readRawFile({ config, rawPath: 'sources/.raw/uploads/source.txt' }), /ENOENT/);

    await syncBrain({ config, apiKey: null });
    const db = await openDatabase(config);
    assert.equal(await getPageRecord(db, 'meetings/.raw/transcript.txt'), undefined);
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
    assert.equal((updated.markdown.match(/^## Timeline$/gm) || []).length, 1);
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
