import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { deletePageIndex, listPageSlugs, openDatabase, replaceEmbeddingForPage, replaceLinksForPage, replacePageIndex } from './db.js';
import { embedTexts } from './openai.js';
import { extractLinks, parseMarkdownPage, slugFromPath } from './markdown.js';

export async function syncBrain({ config, apiKey = process.env.OPENAI_API_KEY } = {}) {
  const db = await openDatabase(config);
  const files = await collectMarkdownFiles(config.brainDir);
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

  if (apiKey && pages.length > 0) {
    const texts = pages.map((page) => `${page.title}\n\n${page.compiledTruth}`);
    const vectors = await embedTexts(texts, config.openaiEmbeddingModel, apiKey);
    for (let index = 0; index < pages.length; index += 1) {
      if (!vectors[index]) continue;
      replaceEmbeddingForPage(db, {
        pageSlug: pages[index].slug,
        chunkId: `${pages[index].slug}:compiled_truth`,
        chunkText: pages[index].compiledTruth,
        model: config.openaiEmbeddingModel,
        vector: vectors[index],
        contentHash: pages[index].contentHash,
      });
    }
  }

  return {
    indexed_pages: pages.length,
    indexed_links: pages.reduce((sum, page) => sum + page.links.length, 0),
    embeddings_generated: apiKey ? pages.length : 0,
    used_embedding_model: apiKey ? config.openaiEmbeddingModel : null,
  };
}

async function collectMarkdownFiles(rootDir) {
  const files = [];
  await walk(rootDir, async (fullPath, relative) => {
    if (relative.endsWith('.md') && !shouldSkip(relative)) files.push(fullPath);
  });
  return files;
}

async function walk(rootDir, onFile, relativeDir = '') {
  const current = relativeDir ? path.join(rootDir, relativeDir) : rootDir;
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const relative = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (shouldSkip(relative)) continue;
      await walk(rootDir, onFile, relative);
      continue;
    }
    if (entry.isFile()) await onFile(path.join(rootDir, relative), relative);
  }
}

function shouldSkip(relative) {
  const normalized = relative.split(path.sep).join('/');
  if (normalized === '.git' || normalized.startsWith('.git/')) return true;
  if (normalized.startsWith('.bigbrain/')) return true;
  if (normalized === 'README.md') return true;
  if (normalized === 'ops/tasks.md') return true;
  if (normalized.startsWith('archive/')) return true;
  if (normalized.startsWith('.raw/') || normalized.includes('/.raw/')) return true;
  return false;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
