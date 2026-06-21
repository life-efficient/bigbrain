import { DatabaseSync } from 'node:sqlite';

import { openDatabase } from './db.js';

export async function migrateSqliteToPostgres(config) {
  const sqlite = new DatabaseSync(config.sqlitePath);
  const postgres = await openDatabase({ ...config, storageBackend: 'postgres' });

  await postgres.query('BEGIN');
  try {
    await clearPostgresIndex(postgres);
    const pages = sqlite.prepare('SELECT * FROM pages ORDER BY slug').all();
    for (const page of pages) {
      await postgres.query(`
        INSERT INTO pages (
          slug, path, type, title, summary, frontmatter_json, compiled_truth, timeline,
          body_markdown, body_text, content_hash, updated_at, last_indexed_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      `, [
        page.slug,
        page.path,
        page.type,
        page.title,
        page.summary,
        page.frontmatter_json || '{}',
        page.compiled_truth,
        page.timeline,
        page.body_markdown,
        page.body_text,
        page.content_hash,
        page.updated_at,
        page.last_indexed_at,
      ]);
    }

    const links = sqlite.prepare('SELECT * FROM links ORDER BY id').all();
    for (const link of links) {
      await postgres.query(`
        INSERT INTO links (from_slug, to_slug, link_text, link_kind, is_resolved)
        VALUES ($1,$2,$3,$4,$5)
      `, [link.from_slug, link.to_slug, link.link_text, link.link_kind, Boolean(link.is_resolved)]);
    }

    const sources = sqlite.prepare('SELECT * FROM sources ORDER BY id').all();
    for (const source of sources) {
      await postgres.query(`
        INSERT INTO sources (page_slug, source_type, source_ref, source_url, source_note)
        VALUES ($1,$2,$3,$4,$5)
      `, [source.page_slug, source.source_type, source.source_ref, source.source_url, source.source_note]);
    }

    const embeddings = sqlite.prepare('SELECT * FROM embeddings ORDER BY id').all();
    for (const embedding of embeddings) {
      await postgres.query(`
        INSERT INTO embeddings (page_slug, chunk_id, chunk_text, embedding_model, embedding, embedding_json, content_hash)
        VALUES ($1,$2,$3,$4,$5::vector,$6,$7)
      `, [
        embedding.page_slug,
        embedding.chunk_id,
        embedding.chunk_text,
        embedding.embedding_model,
        vectorLiteral(JSON.parse(embedding.embedding_json)),
        embedding.embedding_json,
        embedding.content_hash,
      ]);
    }

    const findings = sqlite.prepare('SELECT * FROM health_findings ORDER BY id').all();
    for (const finding of findings) {
      await postgres.query(`
        INSERT INTO health_findings (finding_type, severity, page_slug, details_json, created_at)
        VALUES ($1,$2,$3,$4,$5)
      `, [finding.finding_type, finding.severity, finding.page_slug, finding.details_json || '{}', finding.created_at]);
    }

    const syncRuns = tableExists(sqlite, 'sync_runs')
      ? sqlite.prepare('SELECT * FROM sync_runs ORDER BY id').all()
      : [];
    for (const run of syncRuns) {
      await postgres.query(`
        INSERT INTO sync_runs (started_at, finished_at, status, report_json, error)
        VALUES ($1,$2,$3,$4,$5)
      `, [run.started_at, run.finished_at, run.status, run.report_json || '{}', run.error]);
    }

    const auditRows = tableExists(sqlite, 'mcp_audit_log')
      ? sqlite.prepare('SELECT * FROM mcp_audit_log ORDER BY id').all()
      : [];
    for (const audit of auditRows) {
      await postgres.query(`
        INSERT INTO mcp_audit_log (actor_email, action, details_json, created_at)
        VALUES ($1,$2,$3,$4)
      `, [audit.actor_email, audit.action, audit.details_json || '{}', audit.created_at]);
    }

    await postgres.query('COMMIT');
    return {
      backend: 'postgres',
      source_sqlite_path: config.sqlitePath,
      pages: pages.length,
      links: links.length,
      sources: sources.length,
      embeddings: embeddings.length,
      health_findings: findings.length,
      sync_runs: syncRuns.length,
      mcp_audit_log_entries: auditRows.length,
    };
  } catch (error) {
    await postgres.query('ROLLBACK');
    throw error;
  } finally {
    sqlite.close();
    await postgres.close?.();
  }
}

async function clearPostgresIndex(db) {
  await db.query('DELETE FROM mcp_audit_log');
  await db.query('DELETE FROM sync_runs');
  await db.query('DELETE FROM health_findings');
  await db.query('DELETE FROM activity_log');
  await db.query('DELETE FROM embeddings');
  await db.query('DELETE FROM sources');
  await db.query('DELETE FROM links');
  await db.query('DELETE FROM pages');
}

function vectorLiteral(vector) {
  return `[${vector.map((value) => Number(value)).join(',')}]`;
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}
