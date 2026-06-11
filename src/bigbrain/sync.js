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
    const raw = await fs.readFile(fullPath, 'utf8');
    const parsed = parseMarkdownPage(raw, slug);
    parsed.path = fullPath;
    parsed.contentHash = sha256(raw);
    parsed.links = extractLinks(raw, slug);
    knownSlugs.add(slug);
    pages.push(parsed);
  }

  for (const indexedSlug of listPageSlugs(db)) {
    if (!knownSlugs.has(indexedSlug)) deletePageIndex(db, indexedSlug);
  }

  for (const page of pages) replacePageIndex(db, page);
  for (const page of pages) replaceLinksForPage(db, page.slug, page.links, knownSlugs);

  const pagesNeedingEmbeddings = apiKey
    ? pages.filter((page) => shouldRefreshEmbedding(db, page, config.openaiEmbeddingModel))
    : [];

  let embeddingChunksGenerated = 0;
  const embeddingFailures = [];

  if (apiKey && pagesNeedingEmbeddings.length > 0) {
    for (const page of pagesNeedingEmbeddings) {
      const chunks = chunkPageForEmbedding(page);
      try {
        const vectors = await embedder(chunks.map((chunk) => chunk.text), config.openaiEmbeddingModel, apiKey);
        replaceEmbeddingsForPage(db, {
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
  const pagesWithGeneratedEmbeddings = pagesNeedingEmbeddings.length - pagesWithFailedEmbeddings;

  return {
    indexed_pages: pages.length,
    indexed_links: pages.reduce((sum, page) => sum + page.links.length, 0),
    embeddings_generated: pagesWithGeneratedEmbeddings,
    embedding_chunks_generated: embeddingChunksGenerated,
    embedding_pages_failed: pagesWithFailedEmbeddings,
    embedding_failures: embeddingFailures,
    used_embedding_model: apiKey ? config.openaiEmbeddingModel : null,
  };
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

function shouldRefreshEmbedding(db, page, model) {
  const existing = getEmbeddingRecord(db, page.slug);
  if (!existing) return true;
  if (existing.embedding_model !== model) return true;
  return existing.content_hash !== page.contentHash;
}

async function collectMarkdownFiles(config) {
  const files = [];
  const brainDir = path.resolve(config.brainDir);
  const tasksFile = path.resolve(config.tasksFile);

  await walk(brainDir, async (fullPath, relative) => {
    const normalizedRelative = relative.split(path.sep).join('/');
    if (!normalizedRelative.endsWith('.md')) return;
    if (!matchesIncludeGlobs(normalizedRelative, config.includeGlobs)) return;
    if (isExcludedPath(fullPath, normalizedRelative, config.excludeGlobs, tasksFile)) return;
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
