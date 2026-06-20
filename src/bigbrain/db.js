import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export async function openDatabase(config) {
  if (config.storageBackend === 'postgres') return openPostgresDatabase(config);
  await fs.mkdir(path.dirname(config.sqlitePath), { recursive: true });
  const db = new DatabaseSync(config.sqlitePath);
  initializeSqliteSchema(db);
  return { backend: 'sqlite', raw: db };
}

export function initializeSqliteSchema(db) {
  const raw = unwrapSqlite(db);
  raw.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS pages (
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
    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_slug TEXT NOT NULL,
      to_slug TEXT NOT NULL,
      link_text TEXT NOT NULL,
      link_kind TEXT NOT NULL,
      is_resolved INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_slug TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_ref TEXT,
      source_url TEXT,
      source_note TEXT
    );
    CREATE TABLE IF NOT EXISTS embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_slug TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      chunk_text TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      content_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_slug TEXT,
      activity_type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      details_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS automation_state (
      name TEXT PRIMARY KEY,
      last_run_at TEXT,
      last_success_at TEXT,
      last_status TEXT,
      cursor_json TEXT
    );
    CREATE TABLE IF NOT EXISTS health_findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      finding_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      page_slug TEXT,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      person_slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      role TEXT NOT NULL DEFAULT 'member',
      oauth_provider TEXT,
      oauth_subject TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
      slug UNINDEXED,
      title,
      summary,
      compiled_truth,
      timeline,
      body_text
    );
  `);
}

export async function initializePostgresSchema(db) {
  const pg = unwrapPostgres(db);
  await pg.query('CREATE EXTENSION IF NOT EXISTS vector');
  await pg.query(`
    CREATE TABLE IF NOT EXISTS pages (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      path TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      frontmatter_json JSONB NOT NULL,
      compiled_truth TEXT NOT NULL,
      timeline TEXT NOT NULL,
      body_markdown TEXT NOT NULL,
      body_text TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      last_indexed_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS links (
      id BIGSERIAL PRIMARY KEY,
      from_slug TEXT NOT NULL,
      to_slug TEXT NOT NULL,
      link_text TEXT NOT NULL,
      link_kind TEXT NOT NULL,
      is_resolved BOOLEAN NOT NULL DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS sources (
      id BIGSERIAL PRIMARY KEY,
      page_slug TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_ref TEXT,
      source_url TEXT,
      source_note TEXT
    );
    CREATE TABLE IF NOT EXISTS embeddings (
      id BIGSERIAL PRIMARY KEY,
      page_slug TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      chunk_text TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      embedding vector,
      embedding_json JSONB NOT NULL,
      content_hash TEXT NOT NULL,
      UNIQUE (page_slug, chunk_id)
    );
    CREATE TABLE IF NOT EXISTS activity_log (
      id BIGSERIAL PRIMARY KEY,
      page_slug TEXT,
      activity_type TEXT NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL,
      details_json JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS automation_state (
      name TEXT PRIMARY KEY,
      last_run_at TIMESTAMPTZ,
      last_success_at TIMESTAMPTZ,
      last_status TEXT,
      cursor_json JSONB
    );
    CREATE TABLE IF NOT EXISTS health_findings (
      id BIGSERIAL PRIMARY KEY,
      finding_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      page_slug TEXT,
      details_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
      client_id TEXT PRIMARY KEY,
      client_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mcp_oauth_states (
      state_hash TEXT PRIMARY KEY,
      state_json JSONB NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
      code_hash TEXT PRIMARY KEY,
      code_json JSONB NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
      token_hash TEXT PRIMARY KEY,
      token_json JSONB NOT NULL,
      email TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS mcp_audit_log (
      id BIGSERIAL PRIMARY KEY,
      actor_email TEXT,
      action TEXT NOT NULL,
      details_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS members (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      person_slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      role TEXT NOT NULL DEFAULT 'member',
      oauth_provider TEXT,
      oauth_subject TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS pages_slug_idx ON pages (slug);
    CREATE INDEX IF NOT EXISTS links_from_slug_idx ON links (from_slug);
    CREATE INDEX IF NOT EXISTS links_to_slug_idx ON links (to_slug);
    CREATE INDEX IF NOT EXISTS embeddings_page_slug_idx ON embeddings (page_slug);
  `);
}

export async function replacePageIndex(db, page) {
  if (db.backend === 'postgres') {
    const now = new Date().toISOString();
    await db.query(`
      INSERT INTO pages (
        slug, path, type, title, summary, frontmatter_json, compiled_truth, timeline,
        body_markdown, body_text, content_hash, updated_at, last_indexed_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT(slug) DO UPDATE SET
        path = EXCLUDED.path,
        type = EXCLUDED.type,
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        frontmatter_json = EXCLUDED.frontmatter_json,
        compiled_truth = EXCLUDED.compiled_truth,
        timeline = EXCLUDED.timeline,
        body_markdown = EXCLUDED.body_markdown,
        body_text = EXCLUDED.body_text,
        content_hash = EXCLUDED.content_hash,
        updated_at = EXCLUDED.updated_at,
        last_indexed_at = EXCLUDED.last_indexed_at
    `, [
      page.slug,
      page.path,
      page.type,
      page.title,
      page.summary,
      JSON.stringify(page.frontmatter),
      page.compiledTruth,
      page.timeline,
      page.bodyMarkdown,
      page.bodyText,
      page.contentHash,
      now,
      now,
    ]);
    return;
  }

  const raw = unwrapSqlite(db);
  const now = new Date().toISOString();
  raw.prepare(`
    INSERT INTO pages (
      slug, path, type, title, summary, frontmatter_json, compiled_truth, timeline,
      body_markdown, body_text, content_hash, updated_at, last_indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      path = excluded.path,
      type = excluded.type,
      title = excluded.title,
      summary = excluded.summary,
      frontmatter_json = excluded.frontmatter_json,
      compiled_truth = excluded.compiled_truth,
      timeline = excluded.timeline,
      body_markdown = excluded.body_markdown,
      body_text = excluded.body_text,
      content_hash = excluded.content_hash,
      updated_at = excluded.updated_at,
      last_indexed_at = excluded.last_indexed_at
  `).run(
    page.slug,
    page.path,
    page.type,
    page.title,
    page.summary,
    JSON.stringify(page.frontmatter),
    page.compiledTruth,
    page.timeline,
    page.bodyMarkdown,
    page.bodyText,
    page.contentHash,
    now,
    now,
  );

  raw.prepare('DELETE FROM pages_fts WHERE slug = ?').run(page.slug);
  raw.prepare('INSERT INTO pages_fts (slug, title, summary, compiled_truth, timeline, body_text) VALUES (?, ?, ?, ?, ?, ?)')
    .run(page.slug, page.title, page.summary, page.compiledTruth, page.timeline, page.bodyText);
}

export async function replaceLinksForPage(db, slug, links, knownSlugs) {
  if (db.backend === 'postgres') {
    await db.query('DELETE FROM links WHERE from_slug = $1', [slug]);
    for (const link of links) {
      await db.query(
        'INSERT INTO links (from_slug, to_slug, link_text, link_kind, is_resolved) VALUES ($1,$2,$3,$4,$5)',
        [slug, link.toSlug, link.linkText, link.kind, knownSlugs.has(link.toSlug)],
      );
    }
    return;
  }
  const raw = unwrapSqlite(db);
  raw.prepare('DELETE FROM links WHERE from_slug = ?').run(slug);
  const insert = raw.prepare('INSERT INTO links (from_slug, to_slug, link_text, link_kind, is_resolved) VALUES (?, ?, ?, ?, ?)');
  for (const link of links) {
    insert.run(slug, link.toSlug, link.linkText, link.kind, knownSlugs.has(link.toSlug) ? 1 : 0);
  }
}

export async function replaceEmbeddingsForPage(db, { pageSlug, chunks, model, vectors, contentHash }) {
  if (db.backend === 'postgres') {
    await db.query('DELETE FROM embeddings WHERE page_slug = $1', [pageSlug]);
    for (let index = 0; index < chunks.length; index += 1) {
      if (!vectors[index]) continue;
      await db.query(`
        INSERT INTO embeddings (page_slug, chunk_id, chunk_text, embedding_model, embedding, embedding_json, content_hash)
        VALUES ($1,$2,$3,$4,$5::vector,$6,$7)
      `, [pageSlug, chunks[index].id, chunks[index].text, model, vectorLiteral(vectors[index]), JSON.stringify(vectors[index]), contentHash]);
    }
    return;
  }
  const raw = unwrapSqlite(db);
  raw.prepare('DELETE FROM embeddings WHERE page_slug = ?').run(pageSlug);
  const insert = raw.prepare(`
    INSERT INTO embeddings (page_slug, chunk_id, chunk_text, embedding_model, embedding_json, content_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (let index = 0; index < chunks.length; index += 1) {
    if (!vectors[index]) continue;
    insert.run(pageSlug, chunks[index].id, chunks[index].text, model, JSON.stringify(vectors[index]), contentHash);
  }
}

export async function getEmbeddingRecord(db, pageSlug) {
  if (db.backend === 'postgres') {
    return (await db.query('SELECT embedding_model, content_hash FROM embeddings WHERE page_slug = $1 LIMIT 1', [pageSlug])).rows[0];
  }
  return unwrapSqlite(db).prepare('SELECT embedding_model, content_hash FROM embeddings WHERE page_slug = ? LIMIT 1').get(pageSlug);
}

export async function listPageSlugs(db) {
  if (db.backend === 'postgres') {
    return (await db.query('SELECT slug FROM pages ORDER BY slug')).rows.map((row) => row.slug);
  }
  return unwrapSqlite(db).prepare('SELECT slug FROM pages ORDER BY slug').all().map((row) => row.slug);
}

export async function deletePageIndex(db, slug) {
  if (db.backend === 'postgres') {
    await db.query('DELETE FROM embeddings WHERE page_slug = $1', [slug]);
    await db.query('DELETE FROM links WHERE from_slug = $1 OR to_slug = $1', [slug]);
    await db.query('DELETE FROM sources WHERE page_slug = $1', [slug]);
    await db.query('DELETE FROM activity_log WHERE page_slug = $1', [slug]);
    await db.query('DELETE FROM health_findings WHERE page_slug = $1', [slug]);
    await db.query('DELETE FROM pages WHERE slug = $1', [slug]);
    return;
  }
  const raw = unwrapSqlite(db);
  raw.prepare('DELETE FROM embeddings WHERE page_slug = ?').run(slug);
  raw.prepare('DELETE FROM links WHERE from_slug = ? OR to_slug = ?').run(slug, slug);
  raw.prepare('DELETE FROM sources WHERE page_slug = ?').run(slug);
  raw.prepare('DELETE FROM activity_log WHERE page_slug = ?').run(slug);
  raw.prepare('DELETE FROM health_findings WHERE page_slug = ?').run(slug);
  raw.prepare('DELETE FROM pages_fts WHERE slug = ?').run(slug);
  raw.prepare('DELETE FROM pages WHERE slug = ?').run(slug);
}

export async function listPages(db, { type = null } = {}) {
  if (db.backend === 'postgres') {
    const result = type
      ? await db.query('SELECT slug, title, type, summary, updated_at FROM pages WHERE type = $1 ORDER BY slug', [type])
      : await db.query('SELECT slug, title, type, summary, updated_at FROM pages ORDER BY slug');
    return result.rows.map(normalizeTimestampRow);
  }
  const raw = unwrapSqlite(db);
  if (type) return raw.prepare('SELECT slug, title, type, summary, updated_at FROM pages WHERE type = ? ORDER BY slug').all(type);
  return raw.prepare('SELECT slug, title, type, summary, updated_at FROM pages ORDER BY slug').all();
}

export async function getPageRecord(db, slug) {
  if (db.backend === 'postgres') {
    return normalizePageRecord((await db.query('SELECT * FROM pages WHERE slug = $1', [slug])).rows[0]);
  }
  return unwrapSqlite(db).prepare('SELECT * FROM pages WHERE slug = ?').get(slug);
}

export async function getPagesBySlugs(db, slugs) {
  if (slugs.length === 0) return [];
  if (db.backend === 'postgres') {
    return (await db.query(`
      SELECT slug, title, type, summary, compiled_truth, frontmatter_json
      FROM pages
      WHERE slug = ANY($1::text[])
    `, [slugs])).rows;
  }
  const placeholders = slugs.map(() => '?').join(', ');
  return unwrapSqlite(db).prepare(`
    SELECT slug, title, type, summary, compiled_truth, frontmatter_json
    FROM pages
    WHERE slug IN (${placeholders})
  `).all(...slugs);
}

export async function getOutgoingLinks(db, slug) {
  if (db.backend === 'postgres') {
    return (await db.query('SELECT to_slug, link_text, link_kind, is_resolved FROM links WHERE from_slug = $1 ORDER BY to_slug', [slug]))
      .rows.map((row) => ({ ...row, is_resolved: row.is_resolved ? 1 : 0 }));
  }
  return unwrapSqlite(db).prepare('SELECT to_slug, link_text, link_kind, is_resolved FROM links WHERE from_slug = ? ORDER BY to_slug').all(slug);
}

export async function getBacklinks(db, slug) {
  if (db.backend === 'postgres') {
    return (await db.query('SELECT from_slug, link_text, link_kind FROM links WHERE to_slug = $1 ORDER BY from_slug', [slug])).rows;
  }
  return unwrapSqlite(db).prepare('SELECT from_slug, link_text, link_kind FROM links WHERE to_slug = ? ORDER BY from_slug').all(slug);
}

export async function lexicalSearch(db, query, limit = 10) {
  if (!query.trim()) return [];
  if (db.backend === 'postgres') {
    const result = await db.query(`
      WITH search AS (
        SELECT websearch_to_tsquery('simple', $1) AS q
      )
      SELECT p.slug, p.title, p.type, p.summary, p.frontmatter_json,
             ts_headline('simple', p.compiled_truth, search.q, 'StartSel=[, StopSel=], MaxWords=20, MinWords=5') AS snippet,
             ts_rank_cd(
               to_tsvector('simple', p.title || ' ' || p.summary || ' ' || p.compiled_truth || ' ' || p.timeline || ' ' || p.body_text),
               search.q
             ) AS lexical_score
      FROM pages p, search
      WHERE to_tsvector('simple', p.title || ' ' || p.summary || ' ' || p.compiled_truth || ' ' || p.timeline || ' ' || p.body_text) @@ search.q
      ORDER BY lexical_score DESC, p.slug
      LIMIT $2
    `, [query, limit]);
    return result.rows;
  }
  return unwrapSqlite(db).prepare(`
    SELECT p.slug, p.title, p.type, p.summary, p.frontmatter_json,
           snippet(pages_fts, 3, '[', ']', ' … ', 10) AS snippet,
           bm25(pages_fts) AS lexical_score
    FROM pages_fts
    JOIN pages p ON p.slug = pages_fts.slug
    WHERE pages_fts MATCH ?
    ORDER BY lexical_score
    LIMIT ?
  `).all(query, limit);
}

export async function semanticSearch(db, queryVector, limit = 10) {
  if (db.backend !== 'postgres') return null;
  const result = await db.query(`
    SELECT e.page_slug,
           e.chunk_id,
           e.chunk_text,
           e.embedding_model,
           p.slug,
           p.title,
           p.type,
           p.summary,
           1 - (e.embedding <=> $1::vector) AS semantic_score
    FROM embeddings e
    JOIN pages p ON p.slug = e.page_slug
    WHERE e.embedding IS NOT NULL
    ORDER BY e.embedding <=> $1::vector
    LIMIT $2
  `, [vectorLiteral(queryVector), limit]);
  return result.rows.map((row) => ({
    slug: row.page_slug,
    title: row.title ?? row.page_slug,
    type: row.type ?? null,
    summary: row.summary ?? '',
    snippet: row.chunk_text.slice(0, 240),
    chunk_id: row.chunk_id,
    chunk_text: row.chunk_text,
    semantic_score: Number(row.semantic_score),
  }));
}

export async function allEmbeddings(db) {
  if (db.backend === 'postgres') {
    const rows = (await db.query('SELECT page_slug, chunk_id, chunk_text, embedding_model, embedding_json FROM embeddings')).rows;
    return rows.map((row) => ({ ...row, embedding_json: JSON.stringify(row.embedding_json) }));
  }
  return unwrapSqlite(db).prepare('SELECT page_slug, chunk_id, chunk_text, embedding_model, embedding_json FROM embeddings').all();
}

export async function clearHealthFindings(db) {
  if (db.backend === 'postgres') {
    await db.query('DELETE FROM health_findings');
    return;
  }
  unwrapSqlite(db).prepare('DELETE FROM health_findings').run();
}

export async function insertHealthFinding(db, finding) {
  if (db.backend === 'postgres') {
    await db.query(`
      INSERT INTO health_findings (finding_type, severity, page_slug, details_json, created_at)
      VALUES ($1,$2,$3,$4,$5)
    `, [
      finding.findingType,
      finding.severity,
      finding.pageSlug ?? null,
      JSON.stringify(finding.details ?? {}),
      finding.createdAt ?? new Date().toISOString(),
    ]);
    return;
  }
  unwrapSqlite(db).prepare('INSERT INTO health_findings (finding_type, severity, page_slug, details_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(
      finding.findingType,
      finding.severity,
      finding.pageSlug ?? null,
      JSON.stringify(finding.details ?? {}),
      finding.createdAt ?? new Date().toISOString(),
    );
}

export async function listHealthFindings(db) {
  if (db.backend === 'postgres') {
    return (await db.query('SELECT finding_type, severity, page_slug, details_json, created_at FROM health_findings ORDER BY severity DESC, finding_type, page_slug'))
      .rows.map((row) => ({
        ...row,
        details_json: JSON.stringify(row.details_json ?? {}),
        created_at: normalizeTimestamp(row.created_at),
      }));
  }
  return unwrapSqlite(db).prepare('SELECT finding_type, severity, page_slug, details_json, created_at FROM health_findings ORDER BY severity DESC, finding_type, page_slug').all();
}

export async function dbDoctor(config) {
  const db = await openDatabase(config);
  if (db.backend === 'sqlite') {
    return {
      backend: 'sqlite',
      ok: true,
      sqlite_path: config.sqlitePath,
      page_count: (await listPageSlugs(db)).length,
      embedding_count: (await allEmbeddings(db)).length,
      warnings: [],
    };
  }
  const extension = await db.query("SELECT extname FROM pg_extension WHERE extname = 'vector'");
  const counts = await db.query(`
    SELECT
      (SELECT count(*)::int FROM pages) AS page_count,
      (SELECT count(*)::int FROM links) AS link_count,
      (SELECT count(*)::int FROM embeddings) AS embedding_count,
      (SELECT count(*)::int FROM mcp_oauth_tokens) AS token_count
  `).catch(async () => db.query(`
    SELECT
      (SELECT count(*)::int FROM pages) AS page_count,
      (SELECT count(*)::int FROM links) AS link_count,
      (SELECT count(*)::int FROM embeddings) AS embedding_count,
      0 AS token_count
  `));
  const report = {
    backend: 'postgres',
    ok: extension.rows.length === 1,
    vector_extension: extension.rows.length === 1,
    page_count: counts.rows[0].page_count,
    link_count: counts.rows[0].link_count,
    embedding_count: counts.rows[0].embedding_count,
    token_count: counts.rows[0].token_count,
    warnings: extension.rows.length === 1 ? [] : ['pgvector extension is not installed.'],
  };
  await db.close?.();
  return report;
}

export function sqliteRawDatabase(db) {
  return unwrapSqlite(db);
}

async function openPostgresDatabase(config) {
  const envName = config.databaseUrlEnv || 'DATABASE_URL';
  const connectionString = process.env[envName];
  if (!connectionString) throw new Error(`Postgres storage requires ${envName} to be set.`);
  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString,
    max: Number(process.env.BIGBRAIN_PG_POOL_MAX || 8),
  });
  const db = {
    backend: 'postgres',
    raw: pool,
    query: (text, params) => pool.query(text, params),
    close: () => pool.end(),
  };
  await initializePostgresSchema(db);
  return db;
}

function unwrapSqlite(db) {
  return db?.backend === 'sqlite' ? db.raw : db;
}

function unwrapPostgres(db) {
  if (db?.backend !== 'postgres') throw new Error('Expected Postgres database.');
  return db;
}

function vectorLiteral(vector) {
  return `[${vector.map((value) => Number(value)).join(',')}]`;
}

function normalizeTimestampRow(row) {
  return row ? { ...row, updated_at: normalizeTimestamp(row.updated_at) } : row;
}

function normalizePageRecord(row) {
  if (!row) return row;
  return {
    ...row,
    frontmatter_json: JSON.stringify(row.frontmatter_json ?? {}),
    updated_at: normalizeTimestamp(row.updated_at),
    last_indexed_at: normalizeTimestamp(row.last_indexed_at),
  };
}

function normalizeTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  return value;
}
