import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  deletePageIndex,
  FULL_DOCUMENT_EMBEDDING_KEY,
  FULL_DOCUMENT_EMBEDDING_KIND,
  FULL_DOCUMENT_EMBEDDING_PAYLOAD_VERSION,
  getEmbeddingRecords,
  listPageSlugs,
  openDatabase,
  PAGE_EMBEDDING_SOURCE_TYPE,
  replaceLinksForPage,
  replacePageIndex,
  upsertFullDocumentEmbeddingForPage,
} from './db.js';
import { isAttachmentSidecarPath, isExcludedPath, matchesIncludeGlobs, shouldSkipSystemPath } from './file-selection.js';
import { isBrainProfileDocument } from './brain-profile.js';
import { embedTexts } from './openai.js';
import { extractLinks, parseMarkdownPage, slugFromPath } from './markdown.js';
import { latestTimelineDate } from './timeline.js';

export async function syncBrain({ config, apiKey = process.env.OPENAI_API_KEY, embedder = embedTexts } = {}) {
  const db = await openDatabase(config);
  try {
    const files = await collectMarkdownFiles(config);
    const knownSlugs = new Set();
    const pages = [];

    for (const fullPath of files) {
      const slug = slugFromPath(config.brainDir, fullPath);
      const fileStat = await fs.stat(fullPath);
      const raw = await fs.readFile(fullPath, 'utf8');
      if (slug === 'BRAIN' && isBrainProfileDocument(raw)) continue;
      const parsed = parseMarkdownPage(raw, slug);
      parsed.pageKind = isAttachmentSidecarPath(relativePath(config.brainDir, fullPath)) ? 'attachment' : 'canonical';
      parsed.path = fullPath;
      parsed.updatedAt = latestTimelineDate(parsed.timeline_entries) || fileStat.mtime.toISOString();
      parsed.contentHash = sha256(raw);
      parsed.links = extractLinks(raw, slug);
      knownSlugs.add(slug);
      pages.push(parsed);
    }

  for (const indexedSlug of await listPageSlugs(db)) {
    if (!knownSlugs.has(indexedSlug)) await deletePageIndex(db, indexedSlug);
  }

  for (const page of pages) await replacePageIndex(db, page);
  for (const page of pages) await replaceLinksForPage(db, page.slug, page.links, knownSlugs);

  const embeddingSelection = {
    pages_scanned: pages.length,
    pages_unchanged: 0,
    pages_missing_embeddings: 0,
    pages_model_changed: 0,
    pages_content_changed: 0,
    pages_selected_for_embedding: 0,
  };
  const pagesNeedingEmbeddings = [];
  for (const page of pages) {
    const refresh = await embeddingRefreshStatus(db, page, config.openaiEmbeddingModel);
    if (!refresh.needsRefresh) {
      embeddingSelection.pages_unchanged += 1;
      continue;
    }
    if (refresh.reason === 'missing') embeddingSelection.pages_missing_embeddings += 1;
    if (refresh.reason === 'model_changed') embeddingSelection.pages_model_changed += 1;
    if (refresh.reason === 'content_changed') embeddingSelection.pages_content_changed += 1;
    pagesNeedingEmbeddings.push(page);
  }
  embeddingSelection.pages_selected_for_embedding = pagesNeedingEmbeddings.length;
  const embeddingsNeeded = pagesNeedingEmbeddings.length;
  const maxEmbeddingPagesPerSync = Number.isInteger(config.maxEmbeddingPagesPerSync) && config.maxEmbeddingPagesPerSync > 0
    ? config.maxEmbeddingPagesPerSync
    : Number.POSITIVE_INFINITY;
  const embeddingBatchGuardTriggered = Boolean(apiKey && pagesNeedingEmbeddings.length > maxEmbeddingPagesPerSync);
  const warnings = [];
  if (embeddingBatchGuardTriggered) {
    warnings.push(
      `Skipped embedding generation: ${pagesNeedingEmbeddings.length} page(s) need embeddings, above max_embedding_pages_per_sync=${maxEmbeddingPagesPerSync}. Raise the cap intentionally for a backfill.`,
    );
  }
  const pagesAttemptedForEmbedding = apiKey && !embeddingBatchGuardTriggered ? pagesNeedingEmbeddings : [];

  let embeddingsGenerated = 0;
  const embeddingFailures = [];

  if (apiKey && pagesAttemptedForEmbedding.length > 0) {
    for (const page of pagesAttemptedForEmbedding) {
      const inputText = buildFullDocumentEmbeddingInput(page);
      try {
        const vectors = await embedder([inputText], config.openaiEmbeddingModel, apiKey);
        const vector = vectors[0];
        if (!Array.isArray(vector) || vector.length === 0) {
          throw new Error('Embedding provider returned no vector for the full document.');
        }
        await upsertFullDocumentEmbeddingForPage(db, {
          pageSlug: page.slug,
          inputText,
          model: config.openaiEmbeddingModel,
          vector,
        });
        embeddingsGenerated += 1;
      } catch (error) {
        embeddingFailures.push({
          page_slug: page.slug,
          embedding_count: 1,
          chunk_count: 1,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

  }

  const pagesWithFailedEmbeddings = embeddingFailures.length;
  const pagesWithGeneratedEmbeddings = pagesAttemptedForEmbedding.length - pagesWithFailedEmbeddings;
  const outstandingPagesNeedingEmbeddings = apiKey && !embeddingBatchGuardTriggered
    ? pagesWithFailedEmbeddings
    : pagesNeedingEmbeddings.length;
  const outstandingEmbeddings = apiKey && !embeddingBatchGuardTriggered
    ? embeddingFailures.length
    : embeddingsNeeded;

  const report = {
    indexed_pages: pages.length,
    indexed_links: pages.reduce((sum, page) => sum + page.links.length, 0),
    embeddings_generated: pagesWithGeneratedEmbeddings,
    embedding_chunks_generated: embeddingsGenerated,
    embedding_pages_failed: pagesWithFailedEmbeddings,
    embedding_failures: embeddingFailures,
    warnings,
    used_embedding_model: apiKey ? config.openaiEmbeddingModel : null,
    embedding_selection: embeddingSelection,
    embedding_guard: {
      max_embedding_pages_per_sync: Number.isFinite(maxEmbeddingPagesPerSync) ? maxEmbeddingPagesPerSync : null,
      triggered: embeddingBatchGuardTriggered,
      skipped_pages: embeddingBatchGuardTriggered ? pagesNeedingEmbeddings.length : 0,
      skipped_embeddings: embeddingBatchGuardTriggered ? embeddingsNeeded : 0,
      skipped_chunks: embeddingBatchGuardTriggered ? embeddingsNeeded : 0,
    },
    index_totals_after_sync: {
      pages: pages.length,
      links: pages.reduce((sum, page) => sum + page.links.length, 0),
    },
    outstanding_work: {
      pages_needing_embeddings: outstandingPagesNeedingEmbeddings,
      embeddings_pending: outstandingEmbeddings,
      embedding_chunks_pending: outstandingEmbeddings,
      pages_with_embedding_failures: pagesWithFailedEmbeddings,
      links_pending_indexing: 0,
    },
    run_work: {
      pages_embedded: pagesWithGeneratedEmbeddings,
      embeddings_created: embeddingsGenerated,
      embedding_chunks_created: embeddingsGenerated,
      pages_embedding_failed: pagesWithFailedEmbeddings,
      pages_embedding_skipped_by_guard: embeddingBatchGuardTriggered ? pagesNeedingEmbeddings.length : 0,
    },
  };
    return report;
  } catch (error) {
    throw error;
  } finally {
    await db.close?.();
  }
}

export function buildFullDocumentEmbeddingInput(page) {
  const title = String(page?.title || page?.slug || '').trim();
  const aliases = normalizeEmbeddingAliases(page?.frontmatter?.aliases);
  const body = normalizeEmbeddingBody(page?.bodyContentMarkdown);
  return [
    `Title: ${title || 'Untitled'}`,
    aliases.length > 0 ? `Aliases: ${aliases.join(', ')}` : null,
    `Content:\n${body || title || page?.slug || 'Untitled'}`,
  ].filter(Boolean).join('\n\n');
}

async function embeddingRefreshStatus(db, page, model) {
  const expectedInput = buildFullDocumentEmbeddingInput(page);
  const existing = await getEmbeddingRecords(db, {
    sourceType: PAGE_EMBEDDING_SOURCE_TYPE,
    sourceId: page.slug,
    embeddingKind: FULL_DOCUMENT_EMBEDDING_KIND,
  });
  if (existing.length === 0) return { needsRefresh: true, reason: 'missing' };
  if (existing.length !== 1) return { needsRefresh: true, reason: 'content_changed' };
  const current = existing.find((row) => row.embedding_key === FULL_DOCUMENT_EMBEDDING_KEY);
  if (!current) return { needsRefresh: true, reason: 'content_changed' };
  if (current.embedding_model !== model) return { needsRefresh: true, reason: 'model_changed' };
  if (Number(current.payload_version) !== FULL_DOCUMENT_EMBEDDING_PAYLOAD_VERSION
    || current.input_hash !== sha256(expectedInput)) {
    return { needsRefresh: true, reason: 'content_changed' };
  }
  return { needsRefresh: false, reason: 'up_to_date' };
}

function normalizeEmbeddingAliases(value) {
  const aliases = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return [...new Set(aliases.map((alias) => String(alias).trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function normalizeEmbeddingBody(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/^[ \t]*<!--\s*bigbrain:timeline\b[\s\S]*?-->[ \t]*(?:\n|$)/gim, '')
    .trim();
}

async function collectMarkdownFiles(config) {
  const files = [];
  const brainDir = path.resolve(config.brainDir);
  const legacyTasksFile = config.tasksFile ? path.resolve(config.tasksFile) : null;

  await walk(brainDir, async (fullPath, relative) => {
    const normalizedRelative = relative.split(path.sep).join('/');
    if (!normalizedRelative.endsWith('.md')) return;
    if (!matchesIncludeGlobs(normalizedRelative, config.includeGlobs)) return;
    if (!isAttachmentSidecarPath(normalizedRelative)
      && isExcludedPath(fullPath, normalizedRelative, config.excludeGlobs, legacyTasksFile)) return;
    files.push(fullPath);
  });
  return files;
}

function relativePath(root, fullPath) {
  return path.relative(root, fullPath).split(path.sep).join('/');
}

async function walk(rootDir, onFile, relativeDir = '') {
  const current = relativeDir ? path.join(rootDir, relativeDir) : rootDir;
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const relative = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (shouldSkipSystemPath(relative)) continue;
      await walk(rootDir, onFile, relative);
      continue;
    }
    if (entry.isFile()) await onFile(path.join(rootDir, relative), relative);
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
