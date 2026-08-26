import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { openDatabase } from '../../src/bigbrain/db.js';
import { queryPagesByFrontmatter } from '../../src/bigbrain/frontmatter-query.js';
import { syncBrain } from '../../src/bigbrain/sync.js';

test('structured page queries filter, order, paginate, and count flat front matter', async () => {
  const fixture = await createFixture('bigbrain-frontmatter-query-');
  let db;
  try {
    await fs.mkdir(path.join(fixture.brainHome, 'people'), { recursive: true });
    await fs.mkdir(path.join(fixture.brainHome, 'deals'), { recursive: true });
    await fs.writeFile(path.join(fixture.brainHome, 'people', 'alpha.md'), page('Alpha', {
      status: 'active',
      score: '2',
      enabled: 'true',
      next_touchpoint_at: '2026-08-27T09:00:00Z',
    }), 'utf8');
    await fs.writeFile(path.join(fixture.brainHome, 'people', 'beta.md'), page('Beta', {
      score: '10',
      enabled: 'false',
    }), 'utf8');
    await fs.writeFile(path.join(fixture.brainHome, 'people', 'gamma.md'), page('Gamma', {
      status: 'inactive',
      score: '5',
      enabled: 'true',
    }), 'utf8');
    await fs.writeFile(path.join(fixture.brainHome, 'deals', 'delta.md'), page('Delta', {
      status: 'active',
      score: '1',
    }), 'utf8');

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config });
    db = await openDatabase(config);

    const filtered = await queryPagesByFrontmatter({
      db,
      type: 'people',
      filters: [
        { field: 'status', operator: 'eq', value: 'active' },
        { field: 'score', operator: 'lte', value: 2 },
        { field: 'next_touchpoint_at', operator: 'lte', value: '$as_of', value_type: 'timestamp' },
      ],
      fields: ['status', 'score', 'next_touchpoint_at'],
      orderBy: [{ field: 'score', direction: 'asc', value_type: 'number' }],
      asOf: '2026-08-27T12:00:00Z',
      limit: 10,
    });
    assert.equal(filtered.total, 1);
    assert.deepEqual(filtered.pages.map((item) => item.slug), ['people/alpha']);
    assert.deepEqual(filtered.pages[0].frontmatter, {
      status: 'active',
      score: '2',
      next_touchpoint_at: '2026-08-27T09:00:00Z',
    });

    const ordered = await queryPagesByFrontmatter({
      db,
      type: 'people',
      filters: [{ field: 'enabled', operator: 'eq', value: true }],
      orderBy: [{ field: 'score', direction: 'desc', value_type: 'number' }],
      limit: 1,
    });
    assert.equal(ordered.total, 2);
    assert.deepEqual(ordered.pages.map((item) => item.slug), ['people/gamma']);
    assert.equal(ordered.next_cursor, 1);

    const secondPage = await queryPagesByFrontmatter({
      db,
      type: 'people',
      filters: [{ field: 'enabled', operator: 'eq', value: true }],
      orderBy: [{ field: 'score', direction: 'desc', value_type: 'number' }],
      limit: 1,
      cursor: 1,
    });
    assert.deepEqual(secondPage.pages.map((item) => item.slug), ['people/alpha']);
    assert.equal(secondPage.next_cursor, null);

    const missing = await queryPagesByFrontmatter({
      db,
      type: 'people',
      filters: [{ field: 'status', operator: 'exists', value: false }],
      countOnly: true,
    });
    assert.equal(missing.total, 1);
    assert.deepEqual(missing.pages, []);
  } finally {
    await db?.close?.();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('structured page queries work against a pre-existing SQLite pages table without page backfill', async () => {
  const fixture = await createFixture('bigbrain-frontmatter-query-legacy-');
  let db;
  let legacy;
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    await fs.mkdir(path.dirname(config.sqlitePath), { recursive: true });
    legacy = new DatabaseSync(config.sqlitePath);
    legacy.exec(`
      CREATE TABLE pages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        path TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        frontmatter_json TEXT NOT NULL,
        compiled_truth TEXT NOT NULL,
        timeline TEXT NOT NULL,
        body_markdown TEXT NOT NULL,
        body_text TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_indexed_at TEXT NOT NULL
      );
    `);
    legacy.prepare(`
      INSERT INTO pages (
        slug, path, type, title, summary, frontmatter_json, compiled_truth, timeline,
        body_markdown, body_text, content_hash, updated_at, last_indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'people/legacy',
      'people/legacy.md',
      'people',
      'Legacy',
      'Legacy person',
      JSON.stringify({ status: 'active' }),
      'Legacy person',
      '',
      '# Legacy',
      'Legacy',
      'legacy-hash',
      '2026-08-27T00:00:00.000Z',
      '2026-08-27T00:00:00.000Z',
    );
    legacy.close();
    legacy = null;

    db = await openDatabase(config);
    const result = await queryPagesByFrontmatter({
      db,
      type: 'people',
      filters: [{ field: 'status', operator: 'eq', value: 'active' }],
      countOnly: true,
    });
    assert.equal(result.total, 1);
    assert.equal(db.raw.prepare('PRAGMA table_info(pages)').all().some((column) => column.name === 'page_kind'), true);
    assert.equal(db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'pages_type_slug_idx'").get()?.name, 'pages_type_slug_idx');
  } finally {
    legacy?.close();
    await db?.close?.();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('structured page queries build equivalent Postgres JSONB predicates', async () => {
  const calls = [];
  const db = {
    backend: 'postgres',
    query: async (text, params) => {
      calls.push({ text, params });
      if (/COUNT\(\*\)/.test(text)) return { rows: [{ total: '1' }] };
      return {
        rows: [{
          slug: 'people/alice',
          path: 'people/alice.md',
          type: 'people',
          page_kind: 'canonical',
          title: 'Alice',
          summary: 'Alice person',
          updated_at: new Date('2026-08-27T00:00:00Z'),
          frontmatter_json: { status: 'active', score: '2' },
        }],
      };
    },
  };

  const result = await queryPagesByFrontmatter({
    db,
    type: 'people',
    filters: [
      { field: 'status', operator: 'eq', value: 'active' },
      { field: 'score', operator: 'gte', value: 2 },
    ],
    fields: ['status', 'score'],
    limit: 10,
  });

  assert.equal(result.total, 1);
  assert.equal(result.pages[0].updated_at, '2026-08-27T00:00:00.000Z');
  assert.equal(calls.length, 2);
  assert.match(calls[0].text, /frontmatter_json\s*->>/);
  assert.match(calls[0].text, /frontmatter_json\s*\?/);
  assert.match(calls[0].text, /CAST\(/);
});

function page(title, fields) {
  return [
    '---',
    `title: ${title}`,
    ...Object.entries(fields).map(([key, value]) => `${key}: ${value}`),
    '---',
    `# ${title}`,
    '',
    `${title} page.`,
    '',
  ].join('\n');
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
