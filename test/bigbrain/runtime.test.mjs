import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { openDatabase } from '../../src/bigbrain/db.js';
import { runHealthCheck } from '../../src/bigbrain/health.js';
import { migrateBrain } from '../../src/bigbrain/migrate.js';
import { searchBrain } from '../../src/bigbrain/search.js';
import { renderSchemaMarkdown, recommendFolderForInput } from '../../src/bigbrain/schema.js';
import { syncBrain } from '../../src/bigbrain/sync.js';

test('init creates an external brain home with runtime state under .bigbrain', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-init-'));
  const pointerPath = path.join(rootDir, 'pointer');
  const brainHome = path.join(rootDir, 'brain-home');
  try {
    const result = await initializeBrainHome(brainHome, { env: { ...process.env, BIGBRAIN_POINTER_PATH: pointerPath } });
    assert.equal(result.brainHome, brainHome);
    await fs.stat(path.join(brainHome, '.bigbrain/config.json'));
    await fs.stat(path.join(brainHome, '.bigbrain/state.json'));
    await fs.stat(path.join(brainHome, 'ops/tasks.md'));
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test('sync indexes markdown pages and search finds lexical matches', async () => {
  const fixture = await createFixture('bigbrain-sync-');
  try {
    await writeMarkdown(fixture.brainHome, 'people/alice-example.md', `---
title: Alice Example
---
# Alice Example

AI operator working on retrieval systems.
---
2026-05-18 | Met to discuss retrieval.
`);
    const config = await loadConfig({ brainHome: fixture.brainHome });
    const sync = await syncBrain({ config, apiKey: null });
    assert.equal(sync.indexed_pages >= 1, true);

    const db = await openDatabase(config);
    const result = await searchBrain({ db, config, query: 'retrieval systems', apiKey: null });
    assert.equal(result.fused[0].slug, 'people/alice-example');
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('health reports page-shape issues', async () => {
  const fixture = await createFixture('bigbrain-health-');
  try {
    await writeMarkdown(fixture.brainHome, 'people/broken.md', '# Broken Page Without Frontmatter');
    const config = await loadConfig({ brainHome: fixture.brainHome });
    await syncBrain({ config, apiKey: null });
    const report = await runHealthCheck(config);
    assert.equal(report.finding_count > 0, true);
    assert.equal(report.findings.some((finding) => finding.finding_type === 'missing_frontmatter'), true);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('migrate copies a brain-style source tree into a separate brain home', async () => {
  const fixture = await createFixture('bigbrain-migrate-');
  const sourceDir = path.join(fixture.rootDir, 'source-brain');
  try {
    await fs.mkdir(path.join(sourceDir, 'companies'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'companies/acme.md'), `---
title: Acme
---
# Acme

Important company.
---
2026-05-18 | Added.
`, 'utf8');

    const config = await loadConfig({ brainHome: fixture.brainHome });
    const report = await migrateBrain({ sourceDir, config });
    assert.equal(report.copied_files.includes('companies/acme.md'), true);
    await fs.stat(path.join(fixture.brainHome, 'companies/acme.md'));
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('schema and filing guidance stay inspectable', async () => {
  const markdown = renderSchemaMarkdown();
  const recommendation = recommendFolderForInput('board meeting prep for Acme');
  assert.match(markdown, /Directory Structure/);
  assert.equal(recommendation.folder, 'meetings');
});

async function createFixture(prefix) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const pointerPath = path.join(rootDir, 'pointer');
  const brainHome = path.join(rootDir, 'brain-home');
  await initializeBrainHome(brainHome, { env: { ...process.env, BIGBRAIN_POINTER_PATH: pointerPath } });
  return { rootDir, brainHome };
}

async function writeMarkdown(brainHome, relativePath, content) {
  const fullPath = path.join(brainHome, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
}
