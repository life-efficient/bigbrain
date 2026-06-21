import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { deletePageIndex, getEmbeddingRecord, listPageSlugs, openDatabase, replaceEmbeddingsForPage, replaceLinksForPage, replacePageIndex } from './db.js';
import { isExcludedPath, matchesIncludeGlobs, shouldSkipSystemPath } from './file-selection.js';
import { embedTexts } from './openai.js';
import { extractLinks, parseMarkdownPage, slugFromPath } from './markdown.js';

export async function syncBrain({ config, apiKey = process.env.OPENAI_API_KEY, embedder = embedTexts } = {}) {
  const db = await openDatabase(config);
  const files = await collectMarkdownFiles(config);
  const knownSlugs = new Set();
  const pages = [];

  for (const fullPath of files) {
    const slug = slugFromPath(config.brainDir, fullPath);
    const fileStat = await fs.stat(fullPath);
    const raw = await fs.readFile(fullPath, 'utf8');
    const parsed = parseMarkdownPage(raw, slug);
    parsed.path = fullPath;
    parsed.updatedAt = latestTimelineDate(parsed.timeline) || fileStat.mtime.toISOString();
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
  const embeddingChunksNeeded = pagesNeedingEmbeddings.reduce((sum, page) => sum + chunkPageForEmbedding(page).length, 0);
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

  let embeddingChunksGenerated = 0;
  const embeddingFailures = [];

  if (apiKey && pagesAttemptedForEmbedding.length > 0) {
    for (const page of pagesAttemptedForEmbedding) {
      const chunks = chunkPageForEmbedding(page);
      try {
        const vectors = await embedder(chunks.map((chunk) => chunk.text), config.openaiEmbeddingModel, apiKey);
        await replaceEmbeddingsForPage(db, {
          pageSlug: page.slug,
          chunks,
          model: config.openaiEmbeddingModel,
          vectors,
          contentHash: page.contentHash,
        });
        embeddingChunksGenerated += vectors.filter(Boolean).length;
      } catch (error) {
        embeddingFailures.push({
          page_slug: page.slug,
          chunk_count: chunks.length,
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
  const outstandingEmbeddingChunks = apiKey && !embeddingBatchGuardTriggered
    ? embeddingFailures.reduce((sum, failure) => sum + failure.chunk_count, 0)
    : embeddingChunksNeeded;

  const report = {
    indexed_pages: pages.length,
    indexed_links: pages.reduce((sum, page) => sum + page.links.length, 0),
    embeddings_generated: pagesWithGeneratedEmbeddings,
    embedding_chunks_generated: embeddingChunksGenerated,
    embedding_pages_failed: pagesWithFailedEmbeddings,
    embedding_failures: embeddingFailures,
    warnings,
    used_embedding_model: apiKey ? config.openaiEmbeddingModel : null,
    embedding_selection: embeddingSelection,
    embedding_guard: {
      max_embedding_pages_per_sync: Number.isFinite(maxEmbeddingPagesPerSync) ? maxEmbeddingPagesPerSync : null,
      triggered: embeddingBatchGuardTriggered,
      skipped_pages: embeddingBatchGuardTriggered ? pagesNeedingEmbeddings.length : 0,
      skipped_chunks: embeddingBatchGuardTriggered ? embeddingChunksNeeded : 0,
    },
    index_totals_after_sync: {
      pages: pages.length,
      links: pages.reduce((sum, page) => sum + page.links.length, 0),
    },
    outstanding_work: {
      pages_needing_embeddings: outstandingPagesNeedingEmbeddings,
      embedding_chunks_pending: outstandingEmbeddingChunks,
      pages_with_embedding_failures: pagesWithFailedEmbeddings,
      links_pending_indexing: 0,
    },
    run_work: {
      pages_embedded: pagesWithGeneratedEmbeddings,
      embedding_chunks_created: embeddingChunksGenerated,
      pages_embedding_failed: pagesWithFailedEmbeddings,
      pages_embedding_skipped_by_guard: embeddingBatchGuardTriggered ? pagesNeedingEmbeddings.length : 0,
    },
  };
  await db.close?.();
  return report;
}

const MAX_EMBEDDING_CHUNK_WORDS = 1500;

function chunkPageForEmbedding(page) {
  const text = `${page.title}\n\n${page.compiledTruth}`.trim();
  if (!text) return [{ id: `${page.slug}:compiled_truth:0`, text: page.title || page.slug }];

  const words = text.split(/\s+/);
  if (words.length <= MAX_EMBEDDING_CHUNK_WORDS) return [{ id: `${page.slug}:compiled_truth:0`, text }];

  const chunks = [];
  for (let start = 0; start < words.length; start += MAX_EMBEDDING_CHUNK_WORDS) {
    chunks.push({
      id: `${page.slug}:compiled_truth:${chunks.length}`,
      text: words.slice(start, start + MAX_EMBEDDING_CHUNK_WORDS).join(' '),
    });
  }
  return chunks;
}

async function embeddingRefreshStatus(db, page, model) {
  const existing = await getEmbeddingRecord(db, page.slug);
  if (!existing) return { needsRefresh: true, reason: 'missing' };
  if (existing.embedding_model !== model) return { needsRefresh: true, reason: 'model_changed' };
  if (existing.content_hash !== page.contentHash) return { needsRefresh: true, reason: 'content_changed' };
  return { needsRefresh: false, reason: 'up_to_date' };
}

async function collectMarkdownFiles(config) {
  const files = [];
  const brainDir = path.resolve(config.brainDir);
  const legacyTasksFile = config.tasksFile ? path.resolve(config.tasksFile) : null;

  await walk(brainDir, async (fullPath, relative) => {
    const normalizedRelative = relative.split(path.sep).join('/');
    if (!normalizedRelative.endsWith('.md')) return;
    if (!matchesIncludeGlobs(normalizedRelative, config.includeGlobs)) return;
    if (isExcludedPath(fullPath, normalizedRelative, config.excludeGlobs, legacyTasksFile)) return;
    files.push(fullPath);
  });
  return files;
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

function latestTimelineDate(timeline) {
  if (!timeline) return null;
  const matches = [...String(timeline).matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)];
  const latest = matches.map((match) => match[1]).sort().at(-1);
  return latest ? `${latest}T00:00:00.000Z` : null;
}
