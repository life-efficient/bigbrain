import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
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
      page_kind TEXT NOT NULL DEFAULT 'canonical',
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
    CREATE TABLE IF NOT EXISTS hosted_brain_git_state (
      brain_key TEXT PRIMARY KEY,
      brain_dir TEXT NOT NULL,
      canonical_remote TEXT,
      canonical_branch TEXT,
      canonical_head TEXT,
      runtime_branch TEXT,
      runtime_head TEXT,
      dirty INTEGER NOT NULL DEFAULT 0,
      ahead_count INTEGER,
      behind_count INTEGER,
      sync_status TEXT NOT NULL,
      health_status TEXT NOT NULL,
      needs_attention INTEGER NOT NULL DEFAULT 0,
      latest_error_code TEXT,
      latest_error_summary TEXT,
      checked_at TEXT NOT NULL,
      details_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mcp_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT,
      request_id TEXT,
      actor_email TEXT,
      actor_type TEXT,
      actor_id TEXT,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      outcome TEXT,
      error_code TEXT,
      auth_mode TEXT,
      service_name TEXT,
      brain_id TEXT,
      brain_name TEXT,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
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
    CREATE TABLE IF NOT EXISTS shared_groups (
      slug TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'internal',
      redirect_from_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shared_group_pages (
      group_slug TEXT NOT NULL,
      page_slug TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      label TEXT,
      public_summary TEXT,
      raw_files_json TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (group_slug, page_slug)
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
  ensureSqliteSharedGroupColumns(raw);
  ensureSqlitePageKindColumn(raw);
  ensureSqliteAuditColumns(raw);
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
      page_kind TEXT NOT NULL DEFAULT 'canonical',
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
      event_id TEXT,
      request_id TEXT,
      actor_email TEXT,
      actor_type TEXT,
      actor_id TEXT,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      outcome TEXT,
      error_code TEXT,
      auth_mode TEXT,
      service_name TEXT,
      brain_id TEXT,
      brain_name TEXT,
      details_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS hosted_brain_git_state (
      brain_key TEXT PRIMARY KEY,
      brain_dir TEXT NOT NULL,
      canonical_remote TEXT,
      canonical_branch TEXT,
      canonical_head TEXT,
      runtime_branch TEXT,
      runtime_head TEXT,
      dirty BOOLEAN NOT NULL DEFAULT false,
      ahead_count INTEGER,
      behind_count INTEGER,
      sync_status TEXT NOT NULL,
      health_status TEXT NOT NULL,
      needs_attention BOOLEAN NOT NULL DEFAULT false,
      latest_error_code TEXT,
      latest_error_summary TEXT,
      checked_at TIMESTAMPTZ NOT NULL,
      details_json JSONB NOT NULL
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
    CREATE TABLE IF NOT EXISTS shared_groups (
      slug TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'internal',
      redirect_from_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shared_group_pages (
      group_slug TEXT NOT NULL REFERENCES shared_groups(slug) ON DELETE CASCADE,
      page_slug TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      label TEXT,
      public_summary TEXT,
      raw_files_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      PRIMARY KEY (group_slug, page_slug)
    );
    CREATE INDEX IF NOT EXISTS pages_slug_idx ON pages (slug);
    CREATE INDEX IF NOT EXISTS links_from_slug_idx ON links (from_slug);
    CREATE INDEX IF NOT EXISTS links_to_slug_idx ON links (to_slug);
    CREATE INDEX IF NOT EXISTS embeddings_page_slug_idx ON embeddings (page_slug);
    CREATE INDEX IF NOT EXISTS hosted_brain_git_state_checked_at_idx ON hosted_brain_git_state (checked_at DESC);
    CREATE INDEX IF NOT EXISTS mcp_audit_log_created_at_idx ON mcp_audit_log (created_at DESC);
    CREATE INDEX IF NOT EXISTS shared_group_pages_group_slug_idx ON shared_group_pages (group_slug, sort_order);
  `);
  await ensurePostgresSharedGroupColumns(db);
  await ensurePostgresAuditColumns(db);
  await db.query("ALTER TABLE pages ADD COLUMN IF NOT EXISTS page_kind TEXT NOT NULL DEFAULT 'canonical'");
}

const AUDIT_COLUMNS = {
  event_id: 'TEXT', request_id: 'TEXT', actor_type: 'TEXT', actor_id: 'TEXT',
  resource_type: 'TEXT', resource_id: 'TEXT', outcome: 'TEXT', error_code: 'TEXT',
  auth_mode: 'TEXT', service_name: 'TEXT', brain_id: 'TEXT', brain_name: 'TEXT',
};

function ensureSqliteAuditColumns(raw) {
  const columns = new Set(raw.prepare('PRAGMA table_info(mcp_audit_log)').all().map((row) => row.name));
  for (const [name, type] of Object.entries(AUDIT_COLUMNS)) {
    if (!columns.has(name)) raw.exec(`ALTER TABLE mcp_audit_log ADD COLUMN ${name} ${type}`);
  }
  raw.exec('CREATE UNIQUE INDEX IF NOT EXISTS mcp_audit_log_event_id_idx ON mcp_audit_log (event_id) WHERE event_id IS NOT NULL');
  raw.exec('CREATE INDEX IF NOT EXISTS mcp_audit_log_request_id_idx ON mcp_audit_log (request_id)');
}

async function ensurePostgresAuditColumns(db) {
  const definitions = Object.entries(AUDIT_COLUMNS).map(([name, type]) => `ADD COLUMN IF NOT EXISTS ${name} ${type}`).join(', ');
  await unwrapPostgres(db).query(`ALTER TABLE mcp_audit_log ${definitions}`);
  await unwrapPostgres(db).query('CREATE UNIQUE INDEX IF NOT EXISTS mcp_audit_log_event_id_idx ON mcp_audit_log (event_id) WHERE event_id IS NOT NULL');
  await unwrapPostgres(db).query('CREATE INDEX IF NOT EXISTS mcp_audit_log_request_id_idx ON mcp_audit_log (request_id)');
}

function ensureSqlitePageKindColumn(raw) {
  const columns = raw.prepare('PRAGMA table_info(pages)').all().map((row) => row.name);
  if (!columns.includes('page_kind')) raw.exec("ALTER TABLE pages ADD COLUMN page_kind TEXT NOT NULL DEFAULT 'canonical'");
}

function ensureSqliteSharedGroupColumns(raw) {
  const columns = raw.prepare('PRAGMA table_info(shared_group_pages)').all().map((row) => row.name);
  if (!columns.includes('raw_files_json')) {
    raw.exec("ALTER TABLE shared_group_pages ADD COLUMN raw_files_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (!columns.includes('public_summary')) {
    raw.exec('ALTER TABLE shared_group_pages ADD COLUMN public_summary TEXT');
  }
}

async function ensurePostgresSharedGroupColumns(db) {
  const pg = unwrapPostgres(db);
  await pg.query("ALTER TABLE shared_group_pages ADD COLUMN IF NOT EXISTS raw_files_json JSONB NOT NULL DEFAULT '[]'::jsonb");
  await pg.query('ALTER TABLE shared_group_pages ADD COLUMN IF NOT EXISTS public_summary TEXT');
}

export async function replacePageIndex(db, page) {
  if (db.backend === 'postgres') {
    const now = new Date().toISOString();
    const updatedAt = await resolvePageUpdatedAt(page, now);
    await db.query(`
      INSERT INTO pages (
        slug, path, type, page_kind, title, summary, frontmatter_json, compiled_truth, timeline,
        body_markdown, body_text, content_hash, updated_at, last_indexed_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT(slug) DO UPDATE SET
        path = EXCLUDED.path,
        type = EXCLUDED.type,
        page_kind = EXCLUDED.page_kind,
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
      page.pageKind || 'canonical',
      page.title,
      page.summary,
      JSON.stringify(page.frontmatter),
      page.compiledTruth,
      page.timeline,
      page.bodyMarkdown,
      page.bodyText,
      page.contentHash,
      updatedAt,
      now,
    ]);
    return;
  }

  const raw = unwrapSqlite(db);
  const now = new Date().toISOString();
  const updatedAt = await resolvePageUpdatedAt(page, now);
  raw.prepare(`
    INSERT INTO pages (
      slug, path, type, page_kind, title, summary, frontmatter_json, compiled_truth, timeline,
      body_markdown, body_text, content_hash, updated_at, last_indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      path = excluded.path,
      type = excluded.type,
      page_kind = excluded.page_kind,
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
    page.pageKind || 'canonical',
    page.title,
    page.summary,
    JSON.stringify(page.frontmatter),
    page.compiledTruth,
    page.timeline,
    page.bodyMarkdown,
    page.bodyText,
    page.contentHash,
    updatedAt,
    now,
  );

  raw.prepare('DELETE FROM pages_fts WHERE slug = ?').run(page.slug);
  raw.prepare('INSERT INTO pages_fts (slug, title, summary, compiled_truth, timeline, body_text) VALUES (?, ?, ?, ?, ?, ?)')
    .run(page.slug, page.title, page.summary, page.compiledTruth, page.timeline, page.bodyText);
}

async function resolvePageUpdatedAt(page, fallback) {
  if (page?.updatedAt) return page.updatedAt;
  const timelineDate = latestTimelineDate(page?.timeline);
  if (timelineDate) return timelineDate;
  if (page?.path) {
    try {
      const stats = await fs.stat(page.path);
      return stats.mtime.toISOString();
    } catch {
      // Fall through to the indexing timestamp only when the source file is unavailable.
    }
  }
  return fallback;
}

function latestTimelineDate(timeline) {
  if (!timeline) return null;
  const matches = [...String(timeline).matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)];
  const latest = matches.map((match) => match[1]).sort().at(-1);
  return latest ? `${latest}T00:00:00.000Z` : null;
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

export async function listPages(db, { type = null, includeTimeline = false } = {}) {
  const columns = includeTimeline
    ? 'slug, title, type, summary, updated_at, timeline'
    : 'slug, title, type, summary, updated_at';
  if (db.backend === 'postgres') {
    const result = type
      ? await db.query(`SELECT ${columns} FROM pages WHERE type = $1 ORDER BY slug`, [type])
      : await db.query(`SELECT ${columns} FROM pages ORDER BY slug`);
    return result.rows.map(normalizeTimestampRow);
  }
  const raw = unwrapSqlite(db);
  if (type) return raw.prepare(`SELECT ${columns} FROM pages WHERE type = ? ORDER BY slug`).all(type);
  return raw.prepare(`SELECT ${columns} FROM pages ORDER BY slug`).all();
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

export async function listSharedGroups(db) {
  if (db.backend === 'postgres') {
    const groups = (await db.query(`
      SELECT slug, title, description, visibility, redirect_from_json, created_at, updated_at
      FROM shared_groups
      ORDER BY slug
    `)).rows.map(normalizeSharedGroupRow);
    return Promise.all(groups.map(async (group) => ({
      ...group,
      pages: await listSharedGroupPages(db, group.slug),
    })));
  }
  const rows = unwrapSqlite(db).prepare(`
    SELECT slug, title, description, visibility, redirect_from_json, created_at, updated_at
    FROM shared_groups
    ORDER BY slug
  `).all().map(normalizeSharedGroupRow);
  return Promise.all(rows.map(async (group) => ({
    ...group,
    pages: await listSharedGroupPages(db, group.slug),
  })));
}

export async function getSharedGroup(db, slug, { includePages = true, resolveRedirect = false } = {}) {
  const normalized = normalizeSharedGroupSlug(slug);
  if (!normalized) {
    if (!resolveRedirect) return null;
    const redirectOnly = await findSharedGroupRedirect(db, slug);
    if (!redirectOnly) return null;
    return includePages ? { ...redirectOnly, pages: await listSharedGroupPages(db, redirectOnly.slug) } : redirectOnly;
  }
  const row = await getSharedGroupRow(db, normalized);
  if (row) {
    const group = normalizeSharedGroupRow(row);
    return includePages ? { ...group, pages: await listSharedGroupPages(db, group.slug) } : group;
  }
  if (!resolveRedirect) return null;
  const redirect = await findSharedGroupRedirect(db, normalized);
  if (!redirect) return null;
  return includePages ? { ...redirect, pages: await listSharedGroupPages(db, redirect.slug) } : redirect;
}

export async function upsertSharedGroup(db, input) {
  const slug = normalizeSharedGroupSlug(input?.slug);
  if (!slug) throw new Error('Shared group slug is required and must be a simple URL slug.');
  const title = String(input?.title || '').trim();
  if (!title) throw new Error('Shared group title is required.');
  const description = String(input?.description || '').trim();
  const visibility = normalizeSharedGroupVisibility(input?.visibility);
  const pages = normalizeSharedGroupPages(input?.pages || input?.page_slugs || []);
  if (!pages.length) throw new Error('Shared group requires at least one page.');
  await assertSharedGroupPagesExist(db, pages.map((page) => page.page_slug));
  const existing = await getSharedGroup(db, slug, { includePages: false });
  const now = new Date().toISOString();
  const redirectFrom = mergeRedirects(existing?.redirect_from, input?.redirect_from);

  if (db.backend === 'postgres') {
    await db.query(`
      INSERT INTO shared_groups (slug, title, description, visibility, redirect_from_json, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(slug) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        visibility = EXCLUDED.visibility,
        redirect_from_json = EXCLUDED.redirect_from_json,
        updated_at = EXCLUDED.updated_at
    `, [slug, title, description, visibility, JSON.stringify(redirectFrom), existing?.created_at || now, now]);
    await db.query('DELETE FROM shared_group_pages WHERE group_slug = $1', [slug]);
    for (const page of pages) {
      await db.query(`
        INSERT INTO shared_group_pages (group_slug, page_slug, sort_order, label, public_summary, raw_files_json)
        VALUES ($1,$2,$3,$4,$5,$6)
      `, [slug, page.page_slug, page.sort_order, page.label || null, page.public_summary || null, JSON.stringify(page.raw_files || [])]);
    }
    return getSharedGroup(db, slug);
  }

  const raw = unwrapSqlite(db);
  raw.prepare(`
    INSERT INTO shared_groups (slug, title, description, visibility, redirect_from_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      visibility = excluded.visibility,
      redirect_from_json = excluded.redirect_from_json,
      updated_at = excluded.updated_at
  `).run(slug, title, description, visibility, JSON.stringify(redirectFrom), existing?.created_at || now, now);
  raw.prepare('DELETE FROM shared_group_pages WHERE group_slug = ?').run(slug);
  const insert = raw.prepare('INSERT INTO shared_group_pages (group_slug, page_slug, sort_order, label, public_summary, raw_files_json) VALUES (?, ?, ?, ?, ?, ?)');
  for (const page of pages) insert.run(slug, page.page_slug, page.sort_order, page.label || null, page.public_summary || null, JSON.stringify(page.raw_files || []));
  return getSharedGroup(db, slug);
}

export function normalizeSharedGroupSlug(value) {
  const slug = String(value || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!slug || slug === '.' || slug.includes('/') || slug.startsWith('.') || slug.endsWith('.md')) return '';
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug)) return '';
  return slug;
}

function normalizeSharedGroupVisibility(value) {
  const visibility = String(value || 'internal').trim().toLowerCase();
  if (visibility === 'public' || visibility === 'internal') return visibility;
  throw new Error('Shared group visibility must be internal or public.');
}

async function getSharedGroupRow(db, slug) {
  if (db.backend === 'postgres') {
    return (await db.query(`
      SELECT slug, title, description, visibility, redirect_from_json, created_at, updated_at
      FROM shared_groups
      WHERE slug = $1
    `, [slug])).rows[0] || null;
  }
  return unwrapSqlite(db).prepare(`
    SELECT slug, title, description, visibility, redirect_from_json, created_at, updated_at
    FROM shared_groups
    WHERE slug = ?
  `).get(slug) || null;
}

async function listSharedGroupPages(db, groupSlug) {
  if (db.backend === 'postgres') {
    return (await db.query(`
      SELECT page_slug, sort_order, label, public_summary, raw_files_json
      FROM shared_group_pages
      WHERE group_slug = $1
      ORDER BY sort_order, page_slug
    `, [groupSlug])).rows.map(normalizeSharedGroupPageRow);
  }
  return unwrapSqlite(db).prepare(`
    SELECT page_slug, sort_order, label, public_summary, raw_files_json
    FROM shared_group_pages
    WHERE group_slug = ?
    ORDER BY sort_order, page_slug
  `).all(groupSlug).map(normalizeSharedGroupPageRow);
}

async function findSharedGroupRedirect(db, requestedSlug) {
  const wanted = normalizeSharedGroupRedirect(requestedSlug);
  if (!wanted) return null;
  const groups = await listSharedGroups(db);
  return groups.find((group) => group.redirect_from.includes(wanted)) || null;
}

function normalizeSharedGroupRow(row) {
  return {
    slug: row.slug,
    title: row.title,
    description: row.description || '',
    visibility: row.visibility || 'internal',
    redirect_from: parseJsonArray(row.redirect_from_json),
    created_at: normalizeTimestampValue(row.created_at),
    updated_at: normalizeTimestampValue(row.updated_at),
  };
}

function normalizeSharedGroupPageRow(row) {
  return {
    page_slug: row.page_slug,
    sort_order: Number(row.sort_order) || 0,
    label: row.label || null,
    public_summary: row.public_summary || null,
    raw_files: parseJsonArray(row.raw_files_json),
  };
}

function normalizeSharedGroupPages(input) {
  const values = Array.isArray(input) ? input : [];
  return values.map((entry, index) => {
    if (typeof entry === 'string') {
      return { page_slug: normalizePageSlug(entry), sort_order: index, label: null, public_summary: null, raw_files: [] };
    }
    return {
      page_slug: normalizePageSlug(entry?.page_slug || entry?.slug || entry?.path),
      sort_order: Number.isInteger(entry?.sort_order) ? entry.sort_order : index,
      label: String(entry?.label || '').trim() || null,
      public_summary: String(entry?.public_summary || '').trim() || null,
      raw_files: normalizeRawFileList(entry?.raw_files),
    };
  }).filter((entry) => entry.page_slug);
}

function normalizePageSlug(value) {
  return String(value || '').trim().replace(/^\/+/, '').replace(/\.md$/i, '');
}

function normalizeRawFileList(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))];
}

async function assertSharedGroupPagesExist(db, pageSlugs) {
  const unique = [...new Set(pageSlugs)];
  const records = await getPagesBySlugs(db, unique);
  const found = new Set(records.map((record) => record.slug));
  const missing = unique.filter((slug) => !found.has(slug));
  if (missing.length) throw new Error(`Shared group references unknown page(s): ${missing.join(', ')}`);
}

function mergeRedirects(existing = [], next = []) {
  const values = Array.isArray(next) ? next : [next];
  return [...new Set([...(existing || []), ...values]
    .map((value) => normalizeSharedGroupRedirect(value))
    .filter(Boolean))];
}

function normalizeSharedGroupRedirect(value) {
  const redirect = String(value || '').trim().replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.md$/i, '');
  if (!redirect || redirect === '.' || redirect.startsWith('.') || redirect.startsWith('../') || path.posix.isAbsolute(redirect)) return '';
  const normalized = path.posix.normalize(redirect);
  if (normalized === '.' || normalized.startsWith('../') || normalized.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) return '';
  return normalized;
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value.map(String);
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function normalizeTimestampValue(value) {
  return value instanceof Date ? value.toISOString() : String(value || '');
}

export async function lexicalSearch(db, query, limit = 10) {
  if (!query.trim()) return [];
  if (db.backend === 'postgres') {
    const result = await db.query(`
      WITH search AS (
        SELECT websearch_to_tsquery('simple', $1) AS q
      )
      SELECT p.slug, p.title, p.type, p.page_kind, p.summary, p.frontmatter_json,
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
    SELECT p.slug, p.title, p.type, p.page_kind, p.summary, p.frontmatter_json,
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
           p.page_kind,
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
    page_kind: row.page_kind ?? 'canonical',
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

export async function upsertHostedBrainGitState(db, state) {
  const checkedAt = state.checkedAt || new Date().toISOString();
  const details = state.details || {};
  if (db.backend === 'postgres') {
    await db.query(`
      INSERT INTO hosted_brain_git_state (
        brain_key, brain_dir, canonical_remote, canonical_branch, canonical_head,
        runtime_branch, runtime_head, dirty, ahead_count, behind_count,
        sync_status, health_status, needs_attention, latest_error_code,
        latest_error_summary, checked_at, details_json
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (brain_key) DO UPDATE SET
        brain_dir = EXCLUDED.brain_dir,
        canonical_remote = EXCLUDED.canonical_remote,
        canonical_branch = EXCLUDED.canonical_branch,
        canonical_head = EXCLUDED.canonical_head,
        runtime_branch = EXCLUDED.runtime_branch,
        runtime_head = EXCLUDED.runtime_head,
        dirty = EXCLUDED.dirty,
        ahead_count = EXCLUDED.ahead_count,
        behind_count = EXCLUDED.behind_count,
        sync_status = EXCLUDED.sync_status,
        health_status = EXCLUDED.health_status,
        needs_attention = EXCLUDED.needs_attention,
        latest_error_code = EXCLUDED.latest_error_code,
        latest_error_summary = EXCLUDED.latest_error_summary,
        checked_at = EXCLUDED.checked_at,
        details_json = EXCLUDED.details_json
    `, [
      state.brainKey,
      state.brainDir,
      state.canonicalRemote ?? null,
      state.canonicalBranch ?? null,
      state.canonicalHead ?? null,
      state.runtimeBranch ?? null,
      state.runtimeHead ?? null,
      Boolean(state.dirty),
      state.aheadCount ?? null,
      state.behindCount ?? null,
      state.syncStatus,
      state.healthStatus,
      Boolean(state.needsAttention),
      state.latestErrorCode ?? null,
      state.latestErrorSummary ?? null,
      checkedAt,
      JSON.stringify(details),
    ]);
    return;
  }
  unwrapSqlite(db).prepare(`
    INSERT INTO hosted_brain_git_state (
      brain_key, brain_dir, canonical_remote, canonical_branch, canonical_head,
      runtime_branch, runtime_head, dirty, ahead_count, behind_count,
      sync_status, health_status, needs_attention, latest_error_code,
      latest_error_summary, checked_at, details_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(brain_key) DO UPDATE SET
      brain_dir = excluded.brain_dir,
      canonical_remote = excluded.canonical_remote,
      canonical_branch = excluded.canonical_branch,
      canonical_head = excluded.canonical_head,
      runtime_branch = excluded.runtime_branch,
      runtime_head = excluded.runtime_head,
      dirty = excluded.dirty,
      ahead_count = excluded.ahead_count,
      behind_count = excluded.behind_count,
      sync_status = excluded.sync_status,
      health_status = excluded.health_status,
      needs_attention = excluded.needs_attention,
      latest_error_code = excluded.latest_error_code,
      latest_error_summary = excluded.latest_error_summary,
      checked_at = excluded.checked_at,
      details_json = excluded.details_json
  `).run(
    state.brainKey,
    state.brainDir,
    state.canonicalRemote ?? null,
    state.canonicalBranch ?? null,
    state.canonicalHead ?? null,
    state.runtimeBranch ?? null,
    state.runtimeHead ?? null,
    Boolean(state.dirty) ? 1 : 0,
    state.aheadCount ?? null,
    state.behindCount ?? null,
    state.syncStatus,
    state.healthStatus,
    Boolean(state.needsAttention) ? 1 : 0,
    state.latestErrorCode ?? null,
    state.latestErrorSummary ?? null,
    checkedAt,
    JSON.stringify(details),
  );
}

export async function getHostedBrainGitState(db, brainKey) {
  if (db.backend === 'postgres') {
    const row = (await db.query('SELECT * FROM hosted_brain_git_state WHERE brain_key = $1', [brainKey])).rows[0];
    return normalizeHostedBrainGitState(row);
  }
  const row = unwrapSqlite(db).prepare('SELECT * FROM hosted_brain_git_state WHERE brain_key = ?').get(brainKey);
  return normalizeHostedBrainGitState(row);
}

export async function insertMcpAuditLog(db, record) {
  const { actorEmail = null, action, details = {}, createdAt = null } = record;
  const created = createdAt || new Date().toISOString();
  const values = [record.eventId || `evt_${crypto.randomUUID()}`, record.requestId || null, actorEmail,
    record.actorType || null, record.actorId || null, action, record.resourceType || null,
    record.resourceId || null, record.outcome || 'success', record.errorCode || null,
    record.authMode || null, record.serviceName || null, record.brainId || null, record.brainName || null,
    JSON.stringify(details || {}), created];
  if (db.backend === 'postgres') {
    await db.query(`
      INSERT INTO mcp_audit_log (event_id, request_id, actor_email, actor_type, actor_id, action,
        resource_type, resource_id, outcome, error_code, auth_mode, service_name, brain_id, brain_name, details_json, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    `, values);
    return;
  }
  unwrapSqlite(db).prepare(`INSERT INTO mcp_audit_log (event_id, request_id, actor_email, actor_type, actor_id, action,
    resource_type, resource_id, outcome, error_code, auth_mode, service_name, brain_id, brain_name, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ).run(...values);
}

export async function listMcpAuditLog(db, { limit = 20, cursor = null } = {}) {
  const boundedLimit = normalizeLimit(limit, 20);
  if (db.backend === 'postgres') {
    return (await db.query(`
      SELECT *
      FROM mcp_audit_log
      WHERE ($2::bigint IS NULL OR id < $2)
      ORDER BY created_at DESC, id DESC
      LIMIT $1
    `, [boundedLimit, cursor])).rows.map((row) => ({
      ...row,
      created_at: normalizeTimestamp(row.created_at),
      details_json: JSON.stringify(row.details_json ?? {}),
    }));
  }
  return unwrapSqlite(db).prepare(`
    SELECT *
    FROM mcp_audit_log
    WHERE (? IS NULL OR id < ?)
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(cursor, cursor, boundedLimit);
}

export async function pruneMcpAuditLog(db, { before, limit = 1000 } = {}) {
  const boundedLimit = normalizeLimit(limit, 1000);
  if (!before) throw new Error('Audit retention cleanup requires a before timestamp.');
  if (db.backend === 'postgres') {
    return (await db.query(`DELETE FROM mcp_audit_log WHERE id IN (
      SELECT id FROM mcp_audit_log WHERE created_at < $1 ORDER BY created_at LIMIT $2
    ) RETURNING id`, [before, boundedLimit])).rowCount;
  }
  return unwrapSqlite(db).prepare(`DELETE FROM mcp_audit_log WHERE id IN (
    SELECT id FROM mcp_audit_log WHERE created_at < ? ORDER BY created_at LIMIT ?
  )`).run(before, boundedLimit).changes;
}

export async function getMcpAuditAnalytics(db, { recentLimit = 12 } = {}) {
  const boundedLimit = normalizeLimit(recentLimit, 12);
  if (db.backend === 'postgres') {
    const [summary, actions, outcomes, resources, recent] = await Promise.all([
      db.query(`SELECT count(*)::int AS total_events, count(DISTINCT actor_email)::int AS distinct_actors,
        min(created_at) AS first_event_at, max(created_at) AS last_event_at FROM mcp_audit_log`),
      db.query(`SELECT action, count(*)::int AS count FROM mcp_audit_log GROUP BY action ORDER BY count DESC, action LIMIT 10`),
      db.query(`SELECT coalesce(outcome, 'legacy') AS outcome, count(*)::int AS count FROM mcp_audit_log GROUP BY outcome ORDER BY count DESC`),
      db.query(`SELECT coalesce(resource_type, 'unspecified') AS resource_type, count(*)::int AS count FROM mcp_audit_log GROUP BY resource_type ORDER BY count DESC`),
      db.query(`SELECT event_id, action, actor_type, resource_type, resource_id, outcome, service_name, brain_name, created_at
        FROM mcp_audit_log ORDER BY created_at DESC, id DESC LIMIT $1`, [boundedLimit]),
    ]);
    return normalizeAuditAnalytics(summary.rows[0], actions.rows, outcomes.rows, resources.rows, recent.rows);
  }
  const raw = unwrapSqlite(db);
  return normalizeAuditAnalytics(
    raw.prepare(`SELECT count(*) AS total_events, count(DISTINCT actor_email) AS distinct_actors,
      min(created_at) AS first_event_at, max(created_at) AS last_event_at FROM mcp_audit_log`).get(),
    raw.prepare(`SELECT action, count(*) AS count FROM mcp_audit_log GROUP BY action ORDER BY count DESC, action LIMIT 10`).all(),
    raw.prepare(`SELECT coalesce(outcome, 'legacy') AS outcome, count(*) AS count FROM mcp_audit_log GROUP BY outcome ORDER BY count DESC`).all(),
    raw.prepare(`SELECT coalesce(resource_type, 'unspecified') AS resource_type, count(*) AS count FROM mcp_audit_log GROUP BY resource_type ORDER BY count DESC`).all(),
    raw.prepare(`SELECT event_id, action, actor_type, resource_type, resource_id, outcome, service_name, brain_name, created_at
      FROM mcp_audit_log ORDER BY created_at DESC, id DESC LIMIT ?`).all(boundedLimit),
  );
}

function normalizeAuditAnalytics(summary, actions, outcomes, resources, recent) {
  const normalizeCounts = (rows) => rows.map((row) => ({ ...row, count: Number(row.count) }));
  return {
    summary: {
      total_events: Number(summary?.total_events || 0),
      distinct_actors: Number(summary?.distinct_actors || 0),
      first_event_at: normalizeTimestamp(summary?.first_event_at),
      last_event_at: normalizeTimestamp(summary?.last_event_at),
    },
    actions: normalizeCounts(actions),
    outcomes: normalizeCounts(outcomes),
    resources: normalizeCounts(resources),
    recent: recent.map((row) => ({ ...row, created_at: normalizeTimestamp(row.created_at) })),
  };
}

export async function dbDoctor(config) {
  const db = await openDatabase(config);
  if (db.backend === 'sqlite') {
    const report = {
      backend: 'sqlite',
      ok: true,
      sqlite_path: config.sqlitePath,
      page_count: (await listPageSlugs(db)).length,
      embedding_count: (await allEmbeddings(db)).length,
      hosted_brain_git_state_count: unwrapSqlite(db).prepare('SELECT count(*) AS count FROM hosted_brain_git_state').get().count,
      audit_log_count: (await listMcpAuditLog(db, { limit: 100 })).length,
      warnings: [],
    };
    await db.close?.();
    return report;
  }
  const extension = await db.query("SELECT extname FROM pg_extension WHERE extname = 'vector'");
  const counts = await db.query(`
    SELECT
      (SELECT count(*)::int FROM pages) AS page_count,
      (SELECT count(*)::int FROM links) AS link_count,
      (SELECT count(*)::int FROM embeddings) AS embedding_count,
      (SELECT count(*)::int FROM hosted_brain_git_state) AS hosted_brain_git_state_count,
      (SELECT count(*)::int FROM mcp_audit_log) AS audit_log_count,
      (SELECT count(*)::int FROM mcp_oauth_tokens) AS token_count
  `).catch(async () => db.query(`
    SELECT
      (SELECT count(*)::int FROM pages) AS page_count,
      (SELECT count(*)::int FROM links) AS link_count,
      (SELECT count(*)::int FROM embeddings) AS embedding_count,
      0 AS hosted_brain_git_state_count,
      0 AS audit_log_count,
      0 AS token_count
  `));
  const report = {
    backend: 'postgres',
    ok: extension.rows.length === 1,
    vector_extension: extension.rows.length === 1,
    page_count: counts.rows[0].page_count,
    link_count: counts.rows[0].link_count,
    embedding_count: counts.rows[0].embedding_count,
    hosted_brain_git_state_count: counts.rows[0].hosted_brain_git_state_count,
    audit_log_count: counts.rows[0].audit_log_count,
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

function normalizeHostedBrainGitState(row) {
  if (!row) return row;
  return {
    ...row,
    dirty: row.dirty === true || row.dirty === 1,
    needs_attention: row.needs_attention === true || row.needs_attention === 1,
    checked_at: normalizeTimestamp(row.checked_at),
    details_json: JSON.stringify(row.details_json ?? {}),
  };
}

function normalizeTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function normalizeLimit(value, fallback) {
  const number = Number(value || fallback);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), 100);
}
