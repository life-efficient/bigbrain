import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { allEmbeddings, listPageSlugs, openDatabase } from '../../src/bigbrain/db.js';
import { searchBrain } from '../../src/bigbrain/search.js';
import { syncBrain } from '../../src/bigbrain/sync.js';

test('sync removes stale index rows after a page rename', async () => {
  const fixture = await createFixture('bigbrain-sync-rename-');
  try {
    await writeMarkdown(fixture.brainHome, 'companies/old-name.md', `---
title: Old Name
---
# Old Name

Renamed company.
---
2026-05-18 | Added.
`);

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });

    const oldPath = path.join(fixture.brainHome, 'companies', 'old-name.md');
    const newPath = path.join(fixture.brainHome, 'companies', 'new-name.md');
    await fs.rename(oldPath, newPath);
    await fs.writeFile(newPath, `---
title: New Name
---
# New Name

Renamed company.
---
2026-05-18 | Renamed.
`, 'utf8');

    await syncBrain({ config, apiKey: null });

    const db = await openDatabase(config);
    const oldResult = await searchBrain({ db, config, query: 'old name', apiKey: null });
    const newResult = await searchBrain({ db, config, query: 'new name', apiKey: null });

    assert.equal(oldResult.fused.some((row) => row.slug === 'companies/old-name'), false);
    assert.equal(newResult.fused.some((row) => row.slug === 'companies/new-name'), true);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('sync respects include_globs and exclude_globs from config', async () => {
  const fixture = await createFixture('bigbrain-sync-globs-');
  try {
    await writeMarkdown(fixture.brainHome, 'people/alice.md', `---
title: Alice
---
# Alice

Included person.
---
2026-05-18 | Added.
`);
    await writeMarkdown(fixture.brainHome, 'projects/hidden.md', `---
title: Hidden Project
---
# Hidden Project

Should be excluded.
---
2026-05-18 | Added.
`);
    await writeMarkdown(fixture.brainHome, 'companies/acme.md', `---
title: Acme
---
# Acme

Should be excluded by include_globs.
---
2026-05-18 | Added.
`);

    const rawConfig = JSON.parse(await fs.readFile(fixture.configPath, 'utf8'));
    rawConfig.include_globs = ['people/**', 'projects/**'];
    rawConfig.exclude_globs = ['projects/**'];
    await fs.writeFile(fixture.configPath, `${JSON.stringify(rawConfig, null, 2)}\n`, 'utf8');

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });

    const db = await openDatabase(config);
    const slugs = await listPageSlugs(db);
    assert.deepEqual(slugs, ['people/alice']);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('sync exclude_globs supports nested filename patterns like **/README.md', async () => {
  const fixture = await createFixture('bigbrain-sync-readme-glob-');
  try {
    await writeMarkdown(fixture.brainHome, 'companies/README.md', `---
title: Companies
---
# Companies

Guide page.
---
2026-05-18 | Added.
`);
    await writeMarkdown(fixture.brainHome, 'companies/acme.md', `---
title: Acme
---
# Acme

Real company page.
---
2026-05-18 | Added.
`);

    const rawConfig = JSON.parse(await fs.readFile(fixture.configPath, 'utf8'));
    rawConfig.exclude_globs = [...rawConfig.exclude_globs, '**/README.md'];
    await fs.writeFile(fixture.configPath, `${JSON.stringify(rawConfig, null, 2)}\n`, 'utf8');

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });

    const db = await openDatabase(config);
    const slugs = await listPageSlugs(db);
    assert.deepEqual(slugs, ['companies/acme']);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('init excludes nested README and FILING pages from indexing by default', async () => {
  const fixture = await createFixture('bigbrain-sync-default-readme-');
  try {
    await writeMarkdown(fixture.brainHome, 'companies/README.md', `---
title: Companies
---
# Companies

Guide page.
`);
    await writeMarkdown(fixture.brainHome, 'companies/FILING.md', `---
title: Company Filing
---
# Company Filing

Filing guide page.
`);
    await writeMarkdown(fixture.brainHome, 'companies/acme.md', `---
title: Acme
---
# Acme

Real company page.
---
2026-05-18 | Added.
`);

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });

    const db = await openDatabase(config);
    const slugs = await listPageSlugs(db);
    assert.deepEqual(slugs, ['companies/acme']);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('sync only regenerates missing or stale embeddings when api key is set', async () => {
  const fixture = await createFixture('bigbrain-sync-embeddings-');
  try {
    await writeMarkdown(fixture.brainHome, 'people/alice.md', `---
title: Alice
---
# Alice

Original person note.
`);
    await writeMarkdown(fixture.brainHome, 'companies/acme.md', `---
title: Acme
---
# Acme

Original company note.
`);

    const config = await loadConfig({ configPath: fixture.configPath });
    const calls = [];
    const embedder = async (texts, model, apiKey) => {
      calls.push({ texts, model, apiKey });
      return texts.map((_, index) => [index + 0.1, index + 0.2]);
    };

    const firstSync = await syncBrain({ config, apiKey: 'test-key', embedder });
    assert.equal(firstSync.embeddings_generated, 2);
    assert.equal(firstSync.embedding_chunks_generated, 2);
    assert.deepEqual(firstSync.index_totals_after_sync, { pages: 2, links: 0 });
    assert.deepEqual(firstSync.outstanding_work, {
      pages_needing_embeddings: 0,
      embedding_chunks_pending: 0,
      pages_with_embedding_failures: 0,
      links_pending_indexing: 0,
    });
    assert.deepEqual(firstSync.run_work, {
      pages_embedded: 2,
      embedding_chunks_created: 2,
      pages_embedding_failed: 0,
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].texts.length, 1);
    assert.equal(calls[1].texts.length, 1);

    const secondSync = await syncBrain({ config, apiKey: 'test-key', embedder });
    assert.equal(secondSync.embeddings_generated, 0);
    assert.equal(secondSync.outstanding_work.pages_needing_embeddings, 0);
    assert.equal(secondSync.outstanding_work.embedding_chunks_pending, 0);
    assert.equal(secondSync.run_work.pages_embedded, 0);
    assert.equal(calls.length, 2);

    await writeMarkdown(fixture.brainHome, 'people/alice.md', `---
title: Alice
---
# Alice

Updated person note.
`);

    const thirdSync = await syncBrain({ config, apiKey: 'test-key', embedder });
    assert.equal(thirdSync.embeddings_generated, 1);
    assert.equal(thirdSync.embedding_chunks_generated, 1);
    assert.equal(thirdSync.outstanding_work.pages_needing_embeddings, 0);
    assert.equal(thirdSync.run_work.pages_embedded, 1);
    assert.equal(calls.length, 3);
    assert.equal(calls[2].texts.length, 1);
    assert.match(calls[2].texts[0], /Updated person note/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('sync chunks oversized page content before embedding', async () => {
  const fixture = await createFixture('bigbrain-sync-embedding-chunks-');
  try {
    const longBody = Array.from({ length: 3300 }, (_, index) => `word${index}`).join(' ');
    await writeMarkdown(fixture.brainHome, 'concepts/long-note.md', `---
title: Long Note
---
# Long Note

${longBody}
`);

    const config = await loadConfig({ configPath: fixture.configPath });
    const calls = [];
    const embedder = async (texts, model, apiKey) => {
      calls.push({ texts, model, apiKey });
      return texts.map((_, index) => [index + 0.1, index + 0.2]);
    };

    const result = await syncBrain({ config, apiKey: 'test-key', embedder });
    assert.equal(result.embeddings_generated, 1);
    assert.equal(result.embedding_chunks_generated, 3);
    assert.equal(result.embedding_pages_failed, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].texts.length, 3);
    assert.equal(calls[0].texts.every((text) => text.split(/\s+/).length <= 1500), true);

    const db = await openDatabase(config);
    const embeddings = await allEmbeddings(db);
    assert.equal(embeddings.length, 3);
    assert.deepEqual(embeddings.map((row) => row.page_slug), [
      'concepts/long-note',
      'concepts/long-note',
      'concepts/long-note',
    ]);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('sync reports per-page embedding failures without aborting indexing', async () => {
  const fixture = await createFixture('bigbrain-sync-embedding-failure-');
  try {
    await writeMarkdown(fixture.brainHome, 'people/alice.md', `---
title: Alice
---
# Alice

Short person note.
`);
    await writeMarkdown(fixture.brainHome, 'companies/acme.md', `---
title: Acme
---
# Acme

Short company note.
`);

    const config = await loadConfig({ configPath: fixture.configPath });
    const embedder = async (texts) => {
      if (texts[0].includes('Alice')) throw new Error('OpenAI embeddings failed: 400 oversized input');
      return texts.map(() => [0.1, 0.2]);
    };

    const result = await syncBrain({ config, apiKey: 'test-key', embedder });
    assert.equal(result.indexed_pages, 2);
    assert.equal(result.embeddings_generated, 1);
    assert.equal(result.embedding_chunks_generated, 1);
    assert.equal(result.embedding_pages_failed, 1);
    assert.equal(result.embedding_failures[0].page_slug, 'people/alice');
    assert.match(result.embedding_failures[0].error, /oversized input/);
    assert.deepEqual(result.index_totals_after_sync, { pages: 2, links: 0 });
    assert.deepEqual(result.outstanding_work, {
      pages_needing_embeddings: 1,
      embedding_chunks_pending: 1,
      pages_with_embedding_failures: 1,
      links_pending_indexing: 0,
    });
    assert.deepEqual(result.run_work, {
      pages_embedded: 1,
      embedding_chunks_created: 1,
      pages_embedding_failed: 1,
    });

    const db = await openDatabase(config);
    assert.deepEqual(await listPageSlugs(db), ['companies/acme', 'people/alice']);
    assert.equal((await allEmbeddings(db)).length, 1);
  } finally {
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
