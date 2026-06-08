import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { listPageSlugs, openDatabase } from '../../src/bigbrain/db.js';
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
    const slugs = listPageSlugs(db);
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
    const slugs = listPageSlugs(db);
    assert.deepEqual(slugs, ['companies/acme']);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('init excludes nested README pages from indexing by default', async () => {
  const fixture = await createFixture('bigbrain-sync-default-readme-');
  try {
    await writeMarkdown(fixture.brainHome, 'companies/README.md', `---
title: Companies
---
# Companies

Guide page.
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
    const slugs = listPageSlugs(db);
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
    assert.equal(calls.length, 1);
    assert.equal(calls[0].texts.length, 2);

    const secondSync = await syncBrain({ config, apiKey: 'test-key', embedder });
    assert.equal(secondSync.embeddings_generated, 0);
    assert.equal(calls.length, 1);

    await writeMarkdown(fixture.brainHome, 'people/alice.md', `---
title: Alice
---
# Alice

Updated person note.
`);

    const thirdSync = await syncBrain({ config, apiKey: 'test-key', embedder });
    assert.equal(thirdSync.embeddings_generated, 1);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].texts.length, 1);
    assert.match(calls[1].texts[0], /Updated person note/);
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
