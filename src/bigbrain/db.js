import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export async function openDatabase(config) {
  await fs.mkdir(path.dirname(config.sqlitePath), { recursive: true });
  const db = new DatabaseSync(config.sqlitePath);
  initializeSchema(db);
  return db;
}

export function initializeSchema(db) {
  db.exec(`
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

export function replacePageIndex(db, page) {
  const now = new Date().toISOString();
  db.prepare(`
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

  db.prepare('DELETE FROM pages_fts WHERE slug = ?').run(page.slug);
  db.prepare('INSERT INTO pages_fts (slug, title, summary, compiled_truth, timeline, body_text) VALUES (?, ?, ?, ?, ?, ?)')
    .run(page.slug, page.title, page.summary, page.compiledTruth, page.timeline, page.bodyText);
}

export function replaceLinksForPage(db, slug, links, knownSlugs) {
  db.prepare('DELETE FROM links WHERE from_slug = ?').run(slug);
  const insert = db.prepare('INSERT INTO links (from_slug, to_slug, link_text, link_kind, is_resolved) VALUES (?, ?, ?, ?, ?)');
  for (const link of links) {
    insert.run(slug, link.toSlug, link.linkText, link.kind, knownSlugs.has(link.toSlug) ? 1 : 0);
  }
}

export function replaceEmbeddingsForPage(db, { pageSlug, chunks, model, vectors, contentHash }) {
  db.prepare('DELETE FROM embeddings WHERE page_slug = ?').run(pageSlug);
  const insert = db.prepare(`
    INSERT INTO embeddings (page_slug, chunk_id, chunk_text, embedding_model, embedding_json, content_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (let index = 0; index < chunks.length; index += 1) {
    if (!vectors[index]) continue;
    insert.run(pageSlug, chunks[index].id, chunks[index].text, model, JSON.stringify(vectors[index]), contentHash);
  }
}

export function getEmbeddingRecord(db, pageSlug) {
  return db.prepare('SELECT embedding_model, content_hash FROM embeddings WHERE page_slug = ? LIMIT 1').get(pageSlug);
}

export function listPageSlugs(db) {
  return db.prepare('SELECT slug FROM pages ORDER BY slug').all().map((row) => row.slug);
}

export function deletePageIndex(db, slug) {
  db.prepare('DELETE FROM embeddings WHERE page_slug = ?').run(slug);
  db.prepare('DELETE FROM links WHERE from_slug = ? OR to_slug = ?').run(slug, slug);
  db.prepare('DELETE FROM sources WHERE page_slug = ?').run(slug);
  db.prepare('DELETE FROM activity_log WHERE page_slug = ?').run(slug);
  db.prepare('DELETE FROM health_findings WHERE page_slug = ?').run(slug);
  db.prepare('DELETE FROM pages_fts WHERE slug = ?').run(slug);
  db.prepare('DELETE FROM pages WHERE slug = ?').run(slug);
}

export function listPages(db, { type = null } = {}) {
  if (type) return db.prepare('SELECT slug, title, type, summary, updated_at FROM pages WHERE type = ? ORDER BY slug').all(type);
  return db.prepare('SELECT slug, title, type, summary, updated_at FROM pages ORDER BY slug').all();
}

export function getPageRecord(db, slug) {
  return db.prepare('SELECT * FROM pages WHERE slug = ?').get(slug);
}

export function getPagesBySlugs(db, slugs) {
  if (slugs.length === 0) return [];
  const placeholders = slugs.map(() => '?').join(', ');
  return db.prepare(`
    SELECT slug, title, type, summary, compiled_truth
    FROM pages
    WHERE slug IN (${placeholders})
  `).all(...slugs);
}

export function getOutgoingLinks(db, slug) {
  return db.prepare('SELECT to_slug, link_text, link_kind, is_resolved FROM links WHERE from_slug = ? ORDER BY to_slug').all(slug);
}

export function getBacklinks(db, slug) {
  return db.prepare('SELECT from_slug, link_text, link_kind FROM links WHERE to_slug = ? ORDER BY from_slug').all(slug);
}

export function lexicalSearch(db, query, limit = 10) {
  if (!query.trim()) return [];
  return db.prepare(`
    SELECT p.slug, p.title, p.type, p.summary,
           snippet(pages_fts, 3, '[', ']', ' … ', 10) AS snippet,
           bm25(pages_fts) AS lexical_score
    FROM pages_fts
    JOIN pages p ON p.slug = pages_fts.slug
    WHERE pages_fts MATCH ?
    ORDER BY lexical_score
    LIMIT ?
  `).all(query, limit);
}

export function allEmbeddings(db) {
  return db.prepare('SELECT page_slug, chunk_text, embedding_model, embedding_json FROM embeddings').all();
}

export function clearHealthFindings(db) {
  db.prepare('DELETE FROM health_findings').run();
}

export function insertHealthFinding(db, finding) {
  db.prepare('INSERT INTO health_findings (finding_type, severity, page_slug, details_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(
      finding.findingType,
      finding.severity,
      finding.pageSlug ?? null,
      JSON.stringify(finding.details ?? {}),
      finding.createdAt ?? new Date().toISOString(),
    );
}

export function listHealthFindings(db) {
  return db.prepare('SELECT finding_type, severity, page_slug, details_json, created_at FROM health_findings ORDER BY severity DESC, finding_type, page_slug').all();
}
