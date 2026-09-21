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
  quickPageHealthCheck,
  readBrainPage,
  readRawFile,
  renameBrainPage,
  renameRawFile,
  updateRawFile,
  updateBrainPage,
  updateBrainPageImages,
  updatePageVisibility,
} from '../../src/bigbrain/page-ops.js';
import { syncBrain } from '../../src/bigbrain/sync.js';

const TEST_TIMELINE_PROVENANCE = {
  event_id: 'test:page-ops',
  source_type: 'assistant_chat',
  source_label: 'Page ops test',
  source_message: 'Page ops test source message',
};

test('page ops create and update brain pages with frontmatter, body, and timeline', async () => {
  const fixture = await createFixture('bigbrain-page-ops-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const created = await createBrainPage({
      config,
      pagePath: 'people/jordan-lee',
      title: 'Jordan Lee',
      compiledTruth: 'Jordan Lee is a example contact for Example Brain.',
      timelineEntry: 'Created from MCP contribution.',
      timelineProvenance: TEST_TIMELINE_PROVENANCE,
      frontmatter: {
        tags: ['example-brain', 'person'],
        visibility: 'public',
        public: true,
        source_type: 'gmail',
        source_label: 'Legacy source label',
        source_message: 'Legacy source message',
        source_url: 'https://example.test/source',
        commit_message: 'Legacy page metadata',
      },
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
    assert.doesNotMatch(created.markdown, /^source_type:/m);
    assert.doesNotMatch(created.markdown, /^source_label:/m);
    assert.doesNotMatch(created.markdown, /^source_message:/m);
    assert.doesNotMatch(created.markdown, /^source_url:/m);
    assert.doesNotMatch(created.markdown, /^commit_message:/m);
    assert.match(created.markdown, /\n---\n\n## Timeline\n\n- \*\*\d{4}-\d{2}-\d{2}\*\* \| Created from MCP contribution\./);

    const updated = await updateBrainPage({
      config,
      pagePath: 'people/jordan-lee.md',
      compiledTruth: 'Jordan Lee is the current Example Brain example contact.',
      timelineEntry: 'Updated current role from team contribution.',
      timelineProvenance: TEST_TIMELINE_PROVENANCE,
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

test('page ops keep legacy Brains writable until a page schema registry is migrated', async () => {
  const fixture = await createFixture('bigbrain-page-ops-legacy-schema-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const registryPath = path.join(fixture.brainHome, 'page-schemas.yaml');
    await fs.rm(registryPath);

    const created = await createBrainPage({
      config,
      pagePath: 'meetings/schema-migration-check',
      title: 'Schema migration check',
      compiledTruth: 'A normal meeting page remains writable before registry migration.',
      timelineEntry: 'Created while the legacy Brain had no page schema registry.',
      timelineProvenance: TEST_TIMELINE_PROVENANCE,
    });
    assert.equal(created.path, 'meetings/schema-migration-check.md');

    const updated = await updateBrainPage({
      config,
      pagePath: 'meetings/schema-migration-check',
      compiledTruth: 'The normal meeting page can also be updated before registry migration.',
      timelineEntry: 'Updated while the legacy Brain had no page schema registry.',
      timelineProvenance: TEST_TIMELINE_PROVENANCE,
    });
    assert.match(updated.body, /can also be updated/);
    await assert.rejects(() => fs.stat(registryPath), { code: 'ENOENT' });

    await assert.rejects(() => createBrainPage({
      config,
      pagePath: 'meetings/explicit-schema-without-registry',
      title: 'Explicit schema without registry',
      compiledTruth: 'An explicit schema still requires a registry.',
      timelineEntry: 'Attempted an explicit schema without a registry.',
      timelineProvenance: TEST_TIMELINE_PROVENANCE,
      frontmatter: { page_schema: 'meetings' },
    }), /unknown page_schema: meetings/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('page ops fail closed when an existing page schema registry is invalid', async () => {
  const fixture = await createFixture('bigbrain-page-ops-invalid-schema-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    await fs.writeFile(path.join(fixture.brainHome, 'page-schemas.yaml'), 'schema_version: 1\nschemas: [invalid]\n', 'utf8');

    await assert.rejects(() => createBrainPage({
      config,
      pagePath: 'meetings/invalid-registry-check',
      title: 'Invalid registry check',
      compiledTruth: 'This page must not be written.',
      timelineEntry: 'Attempted a write with an invalid registry.',
      timelineProvenance: TEST_TIMELINE_PROVENANCE,
    }), /Page schema registry is invalid/);
    await assert.rejects(() => fs.stat(path.join(fixture.brainHome, 'meetings', 'invalid-registry-check.md')), { code: 'ENOENT' });
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('page ops rejects frontmatter fields not declared by a strict page schema', async () => {
  const fixture = await createFixture('bigbrain-page-ops-schema-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    await assert.rejects(() => createBrainPage({
      config,
      pagePath: 'articles/invalid-capture',
      title: 'Invalid capture',
      compiledTruth: 'Invalid capture should never be written.',
      timelineEntry: 'Attempted invalid capture.',
      timelineProvenance: TEST_TIMELINE_PROVENANCE,
      frontmatter: {
        published_date: '2026-09-17',
        article_url: 'https://example.test/article',
        archival_sha256: 'not-allowed',
      },
    }), /archival_sha256 is not declared/);
    await assert.rejects(() => fs.stat(path.join(fixture.brainHome, 'articles/invalid-capture.md')), { code: 'ENOENT' });
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('page ops store multiple image attachments and support append or replace', async () => {
  const fixture = await createFixture('bigbrain-page-ops-images-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    await fs.mkdir(path.join(fixture.brainHome, 'meetings', '.raw'), { recursive: true });
    await fs.writeFile(path.join(fixture.brainHome, 'meetings', '.raw', 'first.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
    await fs.writeFile(path.join(fixture.brainHome, 'meetings', '.raw', 'second.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fs.writeFile(path.join(fixture.brainHome, 'meetings', '.raw', 'third.webp'), Buffer.from('webp'));

    const created = await createBrainPage({
      config,
      pagePath: 'products/image-enabled',
      title: 'Image Enabled',
      body: 'A page with image evidence.',
      images: [{ path: 'meetings/.raw/first.jpg', caption: 'First frame', kind: 'product', timestamp: '01:30' }],
      timelineEntry: 'Created with one image.',
      timelineProvenance: TEST_TIMELINE_PROVENANCE,
    });
    assert.deepEqual(created.frontmatter.images, [{
      path: 'meetings/.raw/first.jpg',
      caption: 'First frame',
      kind: 'product',
      timestamp: '01:30',
    }]);
    assert.match(created.markdown, /images:/);
    assert.match(created.markdown, /meetings\/.raw\/first\.jpg/);

    const appended = await updateBrainPageImages({
      config,
      pagePath: 'products/image-enabled',
      images: [{ path: 'meetings/.raw/second.png', alt_text: 'Second frame', confidence: 'high' }],
      timelineEntry: 'Appended a second image.',
      timelineProvenance: TEST_TIMELINE_PROVENANCE,
    });
    assert.deepEqual(appended.frontmatter.images, [
      { path: 'meetings/.raw/first.jpg', caption: 'First frame', kind: 'product', timestamp: '01:30' },
      { path: 'meetings/.raw/second.png', alt_text: 'Second frame', confidence: 'high' },
    ]);

    const replaced = await updateBrainPageImages({
      config,
      pagePath: 'products/image-enabled',
      images: [{ path: 'meetings/.raw/third.webp', caption: 'Replacement frame' }],
      mode: 'replace',
      timelineEntry: 'Replaced the image set.',
      timelineProvenance: TEST_TIMELINE_PROVENANCE,
    });
    assert.deepEqual(replaced.frontmatter.images, [{ path: 'meetings/.raw/third.webp', caption: 'Replacement frame' }]);
    assert.match(replaced.timeline, /Appended a second image/);
    assert.match(replaced.timeline, /Replaced the image set/);
    await assert.rejects(() => updateBrainPageImages({
      config,
      pagePath: 'products/image-enabled',
      images: [{ path: 'meetings/.raw/missing.png' }],
      timelineEntry: 'Should fail.',
      timelineProvenance: TEST_TIMELINE_PROVENANCE,
    }), /does not exist under the brain/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('page ops reject writer-owned timeline content in the current body', async () => {
  const fixture = await createFixture('bigbrain-page-ops-body-boundary-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    await assert.rejects(() => createBrainPage({
      config,
      pagePath: 'people/bad-body',
      title: 'Bad Body',
      body: '# Bad Body\n\nCurrent context.\n\n---\n\n## Timeline\n\n- Existing evidence.',
      timelineEntry: 'Created page.',
    }), /timeline boundary and timeline are writer-managed/);
    await assert.rejects(() => fs.stat(path.join(fixture.brainHome, 'people/bad-body.md')), /ENOENT/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('page ops reject source-less timeline entries for new pages', async () => {
  const fixture = await createFixture('bigbrain-page-ops-provenance-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    await assert.rejects(() => createBrainPage({
      config,
      pagePath: 'people/missing-source',
      title: 'Missing source',
      body: 'This page must not be written without timeline provenance.',
      timelineEntry: 'Created without source.',
    }), /Timeline entry provenance is required/);
    await assert.rejects(() => fs.stat(path.join(fixture.brainHome, 'people/missing-source.md')), /ENOENT/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('page ops normalizes legacy timeline separators before appending evidence', async () => {
  const fixture = await createFixture('bigbrain-page-ops-timeline-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const pagePath = path.join(fixture.brainHome, 'organizations', 'example.md');
    await fs.mkdir(path.dirname(pagePath), { recursive: true });
    await fs.writeFile(pagePath, `---\ntitle: Example\ncreated: 2026-08-26\n---\n\n# Example\n\nCurrent context.\n\n---\n\n## Timeline\n\n- **2026-08-25** | Existing evidence.\n`, 'utf8');
    const updated = await updateBrainPage({
      config,
      pagePath: 'organizations/example',
      body: '# Example\n\nCurrent context with a new fact.',
      timelineEntry: 'Appended evidence.',
      timelineProvenance: TEST_TIMELINE_PROVENANCE,
    });
    assert.equal((updated.markdown.match(/## Timeline/g) || []).length, 1);
    assert.equal((updated.markdown.match(/\n---\n\n## Timeline/g) || []).length, 1);
    assert.doesNotMatch(updated.markdown, /## Timeline\n\n---/);
    assert.match(updated.timeline, /Existing evidence/);
    assert.match(updated.timeline, /Appended evidence/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('quick page health catches duplicate timeline boundaries and accepts valid pages', async () => {
  const fixture = await createFixture('bigbrain-page-ops-health-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    await fs.mkdir(path.join(fixture.brainHome, 'organizations'), { recursive: true });
    await fs.writeFile(path.join(fixture.brainHome, 'organizations/duplicate.md'), `---\ntitle: Duplicate\n---\n# Duplicate\n\nCurrent context.\n\n---\n\n## Timeline\n\n- Existing evidence.\n\n---\n\n## Timeline\n\n- Repeated evidence.\n`, 'utf8');
    const invalid = await quickPageHealthCheck({ config, pagePath: 'organizations/duplicate' });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.assertions.single_timeline, false);
    assert.equal(invalid.findings.some((finding) => finding.type === 'duplicate_timeline'), true);

    await fs.writeFile(path.join(fixture.brainHome, 'organizations', 'malformed.md'), `---\ntitle: Malformed\n---\n# Malformed\n\nCurrent context.\n\n---\n\n## Timeline\n\n- **2026-09-01** | Valid-looking evidence.\n\n## Notes\n\nThis does not belong in the timeline.\n`, 'utf8');
    const malformed = await quickPageHealthCheck({ config, pagePath: 'organizations/malformed' });
    assert.equal(malformed.ok, false);
    assert.equal(malformed.assertions.timeline_clean, false);
    assert.equal(malformed.findings.some((finding) => finding.type === 'invalid_timeline'), true);

    const valid = await createBrainPage({
      config,
      pagePath: 'organizations/valid',
      title: 'Valid',
      body: '# Valid\n\nCurrent context.\n\n---\n\n## Additional context\n\nA useful current detail.',
      timelineEntry: 'Created valid page.',
      timelineProvenance: TEST_TIMELINE_PROVENANCE,
    });
    const health = await quickPageHealthCheck({ config, pagePath: valid.path });
    assert.equal(health.ok, true);
    assert.deepEqual(health.findings, []);
    assert.equal(health.assertions.timeline_clean, true);
    assert.equal(health.assertions.single_timeline, true);
    assert.match(valid.body, /Additional context/);
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
      pagePath: 'sources/.raw/example-deck',
      title: 'Example Brain Deck',
      body: 'Source deck for the Example Brain program.',
      timelineEntry: 'Uploaded source deck and created page.',
      timelineProvenance: TEST_TIMELINE_PROVENANCE,
      frontmatter: { tags: ['example-brain', 'source'] },
    });

    assert.equal(result.raw_file.path, 'sources/.raw/example-deck.pdf');
    assert.equal(result.raw_file.size, pdfBytes.length);
    assert.equal(result.page.slug, 'sources/.raw/example-deck');
    assert.equal(result.page.frontmatter.raw_file, 'sources/.raw/example-deck.pdf');
    assert.match(result.page.markdown, /raw_mime_type: application\/pdf/);
    assert.doesNotMatch(result.page.markdown, /## Source File/);

    const storedRaw = await fs.readFile(path.join(fixture.brainHome, 'sources', '.raw', 'example-deck.pdf'));
    assert.deepEqual(storedRaw, pdfBytes);

    await syncBrain({ config, apiKey: null });
    const db = await openDatabase(config);
    assert.equal((await getPageRecord(db, 'sources/.raw/example-deck')).title, 'Example Brain Deck');
    assert.equal((await getPageRecord(db, 'sources/.raw/example-deck')).page_kind, 'attachment');
    assert.equal(await getPageRecord(db, 'sources/.raw/example-deck.pdf'), undefined);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('attachment creation derives sidecar paths and rejects placement ambiguity', async () => {
  const fixture = await createFixture('bigbrain-sidecar-placement-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const created = await createRawFileWithPage({
      config,
      rawPath: 'deals/.raw/plan.pdf',
      rawContentBase64: Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64'),
      mimeType: 'application/pdf',
      title: 'Plan',
      body: 'Comprehensive extracted plan.',
      timelineEntry: 'Uploaded plan.',
      timelineProvenance: TEST_TIMELINE_PROVENANCE,
    });
    assert.equal(created.page.path, 'deals/.raw/plan.md');
    await assert.rejects(() => createRawFileWithPage({
      config,
      rawPath: 'deals/.raw/other.pdf',
      rawContentBase64: Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64'),
      pagePath: 'deals/other',
      title: 'Other',
      body: 'Other plan.',
      timelineEntry: 'Uploaded other.',
    }), /deterministic sidecar path/);
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
      pagePath: 'deals/.raw/company-name-blind-teaser',
      title: 'Company Name Blind Teaser',
      body: 'Current teaser.',
      timelineEntry: 'Uploaded teaser.',
      timelineProvenance: TEST_TIMELINE_PROVENANCE,
      frontmatter: { public_raw_files: ['deals/.raw/company-name-blind-teaser.pdf'] },
    });

    const renamed = await renameRawFile({
      config,
      fromRawPath: 'deals/.raw/company-name-blind-teaser.pdf',
      toRawPath: 'deals/.raw/regional-platform-blind-teaser.pdf',
    });

    assert.equal(renamed.path, 'deals/.raw/regional-platform-blind-teaser.pdf');
    assert.equal(renamed.previous_path, 'deals/.raw/company-name-blind-teaser.pdf');
    assert.deepEqual(renamed.changed_pages, ['deals/.raw/regional-platform-blind-teaser.md']);
    await assert.rejects(
      () => readRawFile({ config, rawPath: 'deals/.raw/company-name-blind-teaser.pdf' }),
      /ENOENT/,
    );
    await assert.rejects(() => readBrainPage({ config, pagePath: 'deals/.raw/company-name-blind-teaser' }), /ENOENT/);
    const page = await readBrainPage({ config, pagePath: 'deals/.raw/regional-platform-blind-teaser' });
    assert.equal(page.frontmatter.raw_file, 'deals/.raw/regional-platform-blind-teaser.pdf');
    assert.deepEqual(page.frontmatter.public_raw_files, ['deals/.raw/regional-platform-blind-teaser.pdf']);
    assert.match(page.markdown, /raw_file: deals\/.raw\/regional-platform-blind-teaser\.pdf/);
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
      timelineProvenance: TEST_TIMELINE_PROVENANCE,
    });
    await createBrainPage({
      config,
      pagePath: 'deals/company-name',
      title: 'Company Name',
      body: 'Related: [Company Name Blind Teaser](company-name-blind-teaser.md).',
      timelineEntry: 'Created deal.',
      timelineProvenance: TEST_TIMELINE_PROVENANCE,
    });

    const renamed = await renameBrainPage({
      config,
      fromPagePath: 'deals/company-name-blind-teaser',
      toPagePath: 'deals/regional-platform-blind-teaser',
      title: 'Regional Platform Blind Teaser',
      timelineEntry: 'Renamed teaser artifact to anonymized path.',
      timelineProvenance: TEST_TIMELINE_PROVENANCE,
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
      pagePath: 'sources/.raw/uploads-too-large',
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
      timelineProvenance: TEST_TIMELINE_PROVENANCE,
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
      timelineProvenance: TEST_TIMELINE_PROVENANCE,
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
      timelineProvenance: TEST_TIMELINE_PROVENANCE,
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
      timelineProvenance: TEST_TIMELINE_PROVENANCE,
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
