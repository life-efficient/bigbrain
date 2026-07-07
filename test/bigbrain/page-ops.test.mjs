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
  pageVisibility,
  readBrainPage,
  readRawFile,
  renameBrainPage,
  renameRawFile,
  updateRawFile,
  updateBrainPage,
  updatePageVisibility,
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
      body: 'Jordan Lee is a example contact for Example Brain.',
      timelineEntry: 'Created from MCP contribution.',
      frontmatter: { tags: ['example-brain', 'person'], visibility: 'public', public: true },
    });

    assert.equal(created.path, 'people/jordan-lee.md');
    assert.equal(created.title, 'Jordan Lee');
    assert.equal(pageVisibility(created.frontmatter), 'internal');
    assert.equal('visibility' in created.frontmatter, false);
    assert.equal('public' in created.frontmatter, false);
    assert.equal('type' in created.frontmatter, false);
    assert.equal(created.type, 'people');
    assert.match(created.markdown, /^---\ntitle: Jordan Lee\ncreated: \d{4}-\d{2}-\d{2}\ntags: \[example-brain, person\]\n---/);
    assert.doesNotMatch(created.markdown, /^type:/m);
    assert.match(created.markdown, /\n---\n\n## Timeline\n\n- \*\*\d{4}-\d{2}-\d{2}\*\* \| Created from MCP contribution\.\n$/);

    const updated = await updateBrainPage({
      config,
      pagePath: 'people/jordan-lee.md',
      body: 'Jordan Lee is the current Example Brain example contact.',
      timelineEntry: 'Updated current role from team contribution.',
    });

    assert.match(updated.body, /current Example Brain example contact/);
    assert.match(updated.timeline, /Created from MCP contribution/);
    assert.match(updated.timeline, /Updated current role from team contribution/);

    await syncBrain({ config, apiKey: null });
    const db = await openDatabase(config);
    const record = await getPageRecord(db, 'people/jordan-lee');
    assert.equal(record.title, 'Jordan Lee');
    assert.match(record.compiled_truth, /current Example Brain example contact/);
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
      body: 'Source deck for the Example Brain program.',
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
      rawPath: 'sources/.raw/uploads-source.txt',
      rawContentText: 'initial raw text',
      mimeType: 'text/plain',
    });

    assert.equal(created.path, 'sources/.raw/uploads-source.txt');
    assert.equal(created.size, 'initial raw text'.length);

    const readInitial = await readRawFile({ config, rawPath: 'sources/.raw/uploads-source.txt' });
    assert.equal(Buffer.from(readInitial.content_base64, 'base64').toString('utf8'), 'initial raw text');

    const updated = await updateRawFile({
      config,
      rawPath: 'sources/.raw/uploads-source.txt',
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
      'sources/.raw/uploads-source.txt',
    ]);

    const sourcesRaw = await listRawFiles({ config, rawPath: 'sources/.raw', recursive: false });
    assert.deepEqual(sourcesRaw.map((entry) => entry.path), ['sources/.raw/uploads-source.txt']);

    const deleted = await deleteRawFile({ config, rawPath: 'sources/.raw/uploads-source.txt' });
    assert.deepEqual(deleted, { path: 'sources/.raw/uploads-source.txt', deleted: true });
    await assert.rejects(() => readRawFile({ config, rawPath: 'sources/.raw/uploads-source.txt' }), /ENOENT/);

    await syncBrain({ config, apiKey: null });
    const db = await openDatabase(config);
    assert.equal(await getPageRecord(db, 'meetings/.raw/transcript.txt'), undefined);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('page ops rename raw files and rewrite page references', async () => {
  const fixture = await createFixture('bigbrain-page-ops-raw-rename-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const pdfBytes = Buffer.from('%PDF-1.4\nraw deck\n%%EOF\n', 'utf8');
    await createRawFileWithPage({
      config,
      rawPath: 'deals/.raw/company-name-blind-teaser.pdf',
      rawContentBase64: pdfBytes.toString('base64'),
      mimeType: 'application/pdf',
      pagePath: 'deals/company-name-blind-teaser',
      title: 'Company Name Blind Teaser',
      body: 'Current teaser.',
      timelineEntry: 'Uploaded teaser.',
      frontmatter: { public_raw_files: ['deals/.raw/company-name-blind-teaser.pdf'] },
    });

    const renamed = await renameRawFile({
      config,
      fromRawPath: 'deals/.raw/company-name-blind-teaser.pdf',
      toRawPath: 'deals/.raw/regional-platform-blind-teaser.pdf',
    });

    assert.equal(renamed.path, 'deals/.raw/regional-platform-blind-teaser.pdf');
    assert.equal(renamed.previous_path, 'deals/.raw/company-name-blind-teaser.pdf');
    assert.deepEqual(renamed.changed_pages, ['deals/company-name-blind-teaser.md']);
    await assert.rejects(
      () => readRawFile({ config, rawPath: 'deals/.raw/company-name-blind-teaser.pdf' }),
      /ENOENT/,
    );
    const page = await readBrainPage({ config, pagePath: 'deals/company-name-blind-teaser' });
    assert.equal(page.frontmatter.raw_file, 'deals/.raw/regional-platform-blind-teaser.pdf');
    assert.deepEqual(page.frontmatter.public_raw_files, ['deals/.raw/regional-platform-blind-teaser.pdf']);
    assert.match(page.markdown, /\[regional-platform-blind-teaser\.pdf\]\(\.raw\/regional-platform-blind-teaser\.pdf\)/);
    assert.doesNotMatch(page.markdown, /company-name-blind-teaser\.pdf/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('page ops rename pages and rewrite relative markdown links', async () => {
  const fixture = await createFixture('bigbrain-page-ops-page-rename-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    await createBrainPage({
      config,
      pagePath: 'deals/company-name-blind-teaser',
      title: 'Company Name Blind Teaser',
      body: 'Current teaser.',
      timelineEntry: 'Created teaser.',
    });
    await createBrainPage({
      config,
      pagePath: 'deals/company-name',
      title: 'Company Name',
      body: 'Related: [Company Name Blind Teaser](company-name-blind-teaser.md).',
      timelineEntry: 'Created deal.',
    });

    const renamed = await renameBrainPage({
      config,
      fromPagePath: 'deals/company-name-blind-teaser',
      toPagePath: 'deals/regional-platform-blind-teaser',
      title: 'Regional Platform Blind Teaser',
      timelineEntry: 'Renamed teaser artifact to anonymized path.',
    });

    assert.equal(renamed.path, 'deals/regional-platform-blind-teaser.md');
    assert.equal(renamed.previous_path, 'deals/company-name-blind-teaser.md');
    assert.equal(renamed.title, 'Regional Platform Blind Teaser');
    assert.match(renamed.markdown, /^title: Regional Platform Blind Teaser$/m);
    assert.match(renamed.body, /^# Regional Platform Blind Teaser/m);
    assert.deepEqual(renamed.changed_pages, ['deals/company-name.md']);
    await assert.rejects(
      () => readBrainPage({ config, pagePath: 'deals/company-name-blind-teaser' }),
      /ENOENT/,
    );
    const deal = await readBrainPage({ config, pagePath: 'deals/company-name' });
    assert.match(deal.body, /\[Company Name Blind Teaser\]\(regional-platform-blind-teaser\.md\)/);
    assert.doesNotMatch(deal.body, /company-name-blind-teaser\.md/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('page ops reject nested raw file paths', async () => {
  const fixture = await createFixture('bigbrain-page-ops-raw-nested-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    await assert.rejects(
      () => createRawFile({
        config,
        rawPath: 'sources/.raw/uploads/source.txt',
        rawContentText: 'nested raw text',
      }),
      /Raw file path must use <collection>\/\.raw\/<file>/,
    );
    await assert.rejects(
      () => listRawFiles({ config, rawPath: 'sources/.raw/uploads/source.txt', recursive: true }),
      /Raw file list path must use <collection>\/\.raw/,
    );
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('page ops reject raw files over the configured decoded size limit before writing', async () => {
  const fixture = await createFixture('bigbrain-page-ops-raw-limit-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    config.rawFileMaxBytes = 10;

    await assert.rejects(() => createRawFile({
      config,
      rawPath: 'sources/.raw/uploads-too-large.txt',
      rawContentText: 'this is too large',
      mimeType: 'text/plain',
    }), /Raw file is too large: 17 bytes exceeds the configured limit of 10 bytes/);

    await assert.rejects(() => fs.stat(path.join(fixture.brainHome, 'sources', '.raw', 'uploads-too-large.txt')), /ENOENT/);

    await assert.rejects(() => createRawFileWithPage({
      config,
      rawPath: 'sources/.raw/uploads-too-large.pdf',
      rawContentBase64: Buffer.from('also too large', 'utf8').toString('base64'),
      pagePath: 'sources/too-large',
      title: 'Too Large',
      body: 'This page should not be written.',
      timelineEntry: 'Attempted oversized upload.',
    }), /Raw file is too large/);

    await assert.rejects(() => fs.stat(path.join(fixture.brainHome, 'sources', '.raw', 'uploads-too-large.pdf')), /ENOENT/);
    await assert.rejects(() => fs.stat(path.join(fixture.brainHome, 'sources', 'too-large.md')), /ENOENT/);

    await createRawFile({
      config,
      rawPath: 'sources/.raw/uploads-existing.txt',
      rawContentText: 'small',
      mimeType: 'text/plain',
    });
    await assert.rejects(() => updateRawFile({
      config,
      rawPath: 'sources/.raw/uploads-existing.txt',
      rawContentText: 'replacement is too large',
      mimeType: 'text/plain',
    }), /Raw file is too large/);
    assert.equal(await fs.readFile(path.join(fixture.brainHome, 'sources', '.raw', 'uploads-existing.txt'), 'utf8'), 'small');
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

test('page visibility is internal by default and changes only through dedicated page op', async () => {
  const fixture = await createFixture('bigbrain-page-ops-visibility-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    await fs.writeFile(path.join(fixture.brainHome, 'people', 'visibility.md'), `---
type: note
title: Visibility
visibility: accidental
tags:
  - example-brain
---

# Visibility

Current body.

---

## Timeline

- **2026-06-28** | Created.
`, 'utf8');

    const original = await readBrainPage({ config, pagePath: 'people/visibility.md' });
    assert.equal(pageVisibility(original.frontmatter), 'internal');

    const updated = await updatePageVisibility({
      config,
      pagePath: 'people/visibility.md',
      visibility: 'public',
      timelineEntry: 'Published intentionally.',
    });
    assert.equal(pageVisibility(updated.frontmatter), 'public');
    assert.match(updated.markdown, /visibility: public/);
    assert.doesNotMatch(updated.markdown, /visibility: accidental/);
    assert.match(updated.markdown, /tags:\n  - example-brain/);
    assert.match(updated.timeline, /Published intentionally/);

    const internal = await updatePageVisibility({
      config,
      pagePath: 'people/visibility.md',
      visibility: 'internal',
      timelineEntry: 'Made internal again.',
    });
    assert.equal(pageVisibility(internal.frontmatter), 'internal');
    assert.match(internal.markdown, /visibility: internal/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('page visibility rejects public raw files that do not exist', async () => {
  const fixture = await createFixture('bigbrain-page-ops-public-raw-missing-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    await fs.writeFile(path.join(fixture.brainHome, 'people', 'visibility.md'), `---
type: note
title: Visibility
---

# Visibility

Current body.

---

## Timeline

- **2026-06-28** | Created.
`, 'utf8');

    await assert.rejects(() => updatePageVisibility({
      config,
      pagePath: 'people/visibility.md',
      visibility: 'public',
      publicRawFiles: ['people/.raw/missing.pdf'],
      timelineEntry: 'Attempted publish with missing raw file.',
    }), /Cannot publish raw file people\/\.raw\/missing\.pdf: file does not exist/);

    const unchanged = await readBrainPage({ config, pagePath: 'people/visibility.md' });
    assert.equal(pageVisibility(unchanged.frontmatter), 'internal');
    assert.equal(unchanged.frontmatter.public_raw_files, undefined);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('page visibility rejects active public raw file types', async () => {
  const fixture = await createFixture('bigbrain-page-ops-public-raw-unsafe-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    await fs.mkdir(path.join(fixture.brainHome, 'people', '.raw'), { recursive: true });
    await fs.writeFile(path.join(fixture.brainHome, 'people', '.raw', 'active.svg'), '<svg><script>alert(1)</script></svg>');
    await fs.writeFile(path.join(fixture.brainHome, 'people', 'visibility.md'), `---
type: note
title: Visibility
---

# Visibility

Current body with [Active SVG](.raw/active.svg).

---

## Timeline

- **2026-06-28** | Created.
`, 'utf8');

    await assert.rejects(() => updatePageVisibility({
      config,
      pagePath: 'people/visibility.md',
      visibility: 'public',
      publicRawFiles: ['people/.raw/active.svg'],
      timelineEntry: 'Attempted publish with unsafe raw file.',
    }), /Public raw files may only use these file types/);

    const unchanged = await readBrainPage({ config, pagePath: 'people/visibility.md' });
    assert.equal(pageVisibility(unchanged.frontmatter), 'internal');
    assert.equal(unchanged.frontmatter.public_raw_files, undefined);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('page visibility rejects public raw files that are not linked or attached to the page', async () => {
  const fixture = await createFixture('bigbrain-page-ops-public-raw-unrelated-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    await fs.mkdir(path.join(fixture.brainHome, 'people', '.raw'), { recursive: true });
    await fs.writeFile(path.join(fixture.brainHome, 'people', '.raw', 'same-collection.pdf'), 'pdf bytes');
    await fs.writeFile(path.join(fixture.brainHome, 'people', 'visibility.md'), `---
type: note
title: Visibility
---

# Visibility

Current body without a raw link.

---

## Timeline

- **2026-06-28** | Created.
`, 'utf8');

    await assert.rejects(() => updatePageVisibility({
      config,
      pagePath: 'people/visibility.md',
      visibility: 'public',
      publicRawFiles: ['people/.raw/same-collection.pdf'],
      timelineEntry: 'Attempted publish with unrelated raw file.',
    }), /not linked from page people\/visibility\.md and does not match that page's raw_file frontmatter/);

    const unchanged = await readBrainPage({ config, pagePath: 'people/visibility.md' });
    assert.equal(pageVisibility(unchanged.frontmatter), 'internal');
    assert.equal(unchanged.frontmatter.public_raw_files, undefined);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('page visibility accepts linked and frontmatter-attached public raw files', async () => {
  const fixture = await createFixture('bigbrain-page-ops-public-raw-valid-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    await fs.mkdir(path.join(fixture.brainHome, 'people', '.raw'), { recursive: true });
    await fs.writeFile(path.join(fixture.brainHome, 'people', '.raw', 'linked.pdf'), 'linked pdf bytes');
    await fs.writeFile(path.join(fixture.brainHome, 'people', '.raw', 'attached.pdf'), 'attached pdf bytes');
    await fs.writeFile(path.join(fixture.brainHome, 'people', 'visibility.md'), `---
type: note
title: Visibility
raw_file: people/.raw/attached.pdf
---

# Visibility

Current body with [Linked PDF](.raw/linked.pdf).

---

## Timeline

- **2026-06-28** | Created.
`, 'utf8');

    const updated = await updatePageVisibility({
      config,
      pagePath: 'people/visibility.md',
      visibility: 'public',
      publicRawFiles: ['people/.raw/linked.pdf', 'people/.raw/attached.pdf'],
      timelineEntry: 'Published with validated raw files.',
    });

    assert.equal(pageVisibility(updated.frontmatter), 'public');
    assert.deepEqual(updated.frontmatter.public_raw_files, ['people/.raw/attached.pdf', 'people/.raw/linked.pdf']);
    assert.match(updated.timeline, /Published with validated raw files/);
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
