import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { allEmbeddings, dbDoctor, getPageRecord, listPageSlugs, openDatabase, semanticSearch } from '../../src/bigbrain/db.js';
import { createMcpAuthStore } from '../../src/bigbrain/mcp-auth-store.js';
import { migrateSqliteToPostgres } from '../../src/bigbrain/postgres-migrate.js';
import { searchBrain } from '../../src/bigbrain/search.js';
import { syncBrain } from '../../src/bigbrain/sync.js';

test('postgres backend syncs, searches, and preserves embeddings', async (t) => {
  const fixture = await createFixture('bigbrain-postgres-sync-', t);
  if (!fixture) return;
  try {
    await writeMarkdown(fixture.brainHome, 'people/alice.md', `---
title: Alice
---
# Alice

Works on Example Brain example partnerships and Postgres persistence.
`);

    const config = await postgresConfig(fixture);
    const embedder = async (texts) => texts.map(() => [0.1, 0.2, 0.3]);
    const first = await syncBrain({ config, apiKey: 'test-key', embedder });
    assert.equal(first.index_totals_after_sync.pages, 1);
    assert.equal(first.embedding_chunks_generated, 1);

    const second = await syncBrain({ config, apiKey: 'test-key', embedder });
    assert.equal(second.embedding_chunks_generated, 0);

    const db = await openDatabase(config);
    assert.deepEqual(await listPageSlugs(db), ['people/alice']);
    assert.equal((await allEmbeddings(db)).length, 1);
    const lexical = await searchBrain({ db, config, query: 'Example Brain example partnerships', apiKey: null });
    assert.equal(lexical.fused[0].slug, 'people/alice');
    const semantic = await semanticSearch(db, [0.1, 0.2, 0.3], 5);
    assert.equal(semantic[0].slug, 'people/alice');
    await db.close?.();
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('postgres backend removes stale rows after markdown rename', async (t) => {
  const fixture = await createFixture('bigbrain-postgres-rename-', t);
  if (!fixture) return;
  try {
    await writeMarkdown(fixture.brainHome, 'companies/old-name.md', `---
title: Old Name
---
# Old Name

Original company.
`);
    const config = await postgresConfig(fixture);
    await syncBrain({ config, apiKey: null });
    await fs.rename(
      path.join(fixture.brainHome, 'companies', 'old-name.md'),
      path.join(fixture.brainHome, 'companies', 'new-name.md'),
    );
    await writeMarkdown(fixture.brainHome, 'companies/new-name.md', `---
title: New Name
---
# New Name

Renamed company.
`);
    await syncBrain({ config, apiKey: null });
    const db = await openDatabase(config);
    assert.equal(await getPageRecord(db, 'companies/old-name'), undefined);
    assert.equal((await getPageRecord(db, 'companies/new-name')).title, 'New Name');
    await db.close?.();
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('postgres auth store persists OAuth records', async (t) => {
  const fixture = await createFixture('bigbrain-postgres-auth-', t);
  if (!fixture) return;
  try {
    const config = await postgresConfig(fixture);
    const store = await createMcpAuthStore(config, { tokenStorePath: '' });
    await store.write({
      clients: [{ client_id: 'client-1', redirect_uris: ['http://127.0.0.1/callback'], created_at: '2026-06-18T00:00:00.000Z' }],
      states: [{ state_hash: 'state-1', expires_at: '2999-01-01T00:00:00.000Z', created_at: '2026-06-18T00:00:00.000Z' }],
      codes: [{ code_hash: 'code-1', expires_at: '2999-01-01T00:00:00.000Z', created_at: '2026-06-18T00:00:00.000Z' }],
      tokens: [{ token_hash: 'token-1', email: 'alice@example.com', created_at: '2026-06-18T00:00:00.000Z', last_used_at: null, revoked_at: null }],
    });

    const reloadedStore = await createMcpAuthStore(config, { tokenStorePath: '' });
    const reloaded = await reloadedStore.read();
    assert.deepEqual(reloaded.clients.map((entry) => entry.client_id), ['client-1']);
    assert.deepEqual(reloaded.tokens.map((entry) => entry.email), ['alice@example.com']);
    await store.close?.();
    await reloadedStore.close?.();
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('sqlite-to-postgres migration copies indexed rows', async (t) => {
  const fixture = await createFixture('bigbrain-postgres-migrate-', t);
  if (!fixture) return;
  try {
    await writeMarkdown(fixture.brainHome, 'people/alice.md', `---
title: Alice
---
# Alice

Migration source page.
`);
    const rawConfig = JSON.parse(await fs.readFile(fixture.configPath, 'utf8'));
    rawConfig.storage_backend = 'sqlite';
    await fs.writeFile(fixture.configPath, `${JSON.stringify(rawConfig, null, 2)}\n`, 'utf8');
    const sqliteConfig = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({
      config: sqliteConfig,
      apiKey: 'test-key',
      embedder: async (texts) => texts.map(() => [0.4, 0.5, 0.6]),
    });
    rawConfig.database_url_env = 'TEST_DATABASE_URL';
    await fs.writeFile(fixture.configPath, `${JSON.stringify(rawConfig, null, 2)}\n`, 'utf8');

    const report = await migrateSqliteToPostgres(await loadConfig({ configPath: fixture.configPath }));
    assert.equal(report.pages, 1);
    assert.equal(report.embeddings, 1);

    rawConfig.storage_backend = 'postgres';
    await fs.writeFile(fixture.configPath, `${JSON.stringify(rawConfig, null, 2)}\n`, 'utf8');
    const config = await loadConfig({ configPath: fixture.configPath });
    const doctor = await dbDoctor(config);
    assert.equal(doctor.ok, true);
    assert.equal(doctor.page_count, 1);
    assert.equal(doctor.embedding_count, 1);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

async function createFixture(prefix, t) {
  if (!process.env.TEST_DATABASE_URL) {
    t.skip('TEST_DATABASE_URL is not set.');
    return null;
  }
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const pointerPath = path.join(rootDir, 'pointer');
  const stateRoot = path.join(rootDir, 'state-root');
  const brainHome = path.join(rootDir, 'brain-home');
  const init = await initializeBrainHome(brainHome, {
    env: { ...process.env, BIGBRAIN_POINTER_PATH: pointerPath, BIGBRAIN_STATE_ROOT: stateRoot },
  });
  const rawConfig = JSON.parse(await fs.readFile(init.configPath, 'utf8'));
  rawConfig.storage_backend = 'postgres';
  rawConfig.database_url_env = 'TEST_DATABASE_URL';
  await fs.writeFile(init.configPath, `${JSON.stringify(rawConfig, null, 2)}\n`, 'utf8');
  const config = await loadConfig({ configPath: init.configPath });
  try {
    const db = await openDatabase(config);
    await clearPostgres(db);
    await db.close?.();
  } catch (error) {
    await fs.rm(rootDir, { recursive: true, force: true });
    t.skip(`Postgres backend unavailable: ${error.message}`);
    return null;
  }
  return { rootDir, brainHome, configPath: init.configPath };
}

async function postgresConfig(fixture) {
  return loadConfig({ configPath: fixture.configPath });
}

async function clearPostgres(db) {
  await db.query('DELETE FROM mcp_oauth_tokens');
  await db.query('DELETE FROM mcp_oauth_codes');
  await db.query('DELETE FROM mcp_oauth_states');
  await db.query('DELETE FROM mcp_oauth_clients');
  await db.query('DELETE FROM health_findings');
  await db.query('DELETE FROM activity_log');
  await db.query('DELETE FROM embeddings');
  await db.query('DELETE FROM sources');
  await db.query('DELETE FROM links');
  await db.query('DELETE FROM pages');
}

async function writeMarkdown(brainHome, relativePath, content) {
  const fullPath = path.join(brainHome, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
}
