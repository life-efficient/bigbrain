import fs from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_RAW_FILE_MAX_BYTES } from './constants.js';
import { parseMarkdownPage } from './markdown.js';

export const DEFAULT_COLLECTIONS = [
  'archive',
  'companies',
  'concepts',
  'deals',
  'ideas',
  'inbox',
  'meetings',
  'people',
  'projects',
  'sources',
  'writing',
];

const LIST_ORDER_BY = new Set(['updated_at', 'created_at', 'alphanumeric']);

export async function listBrainPath({
  config,
  relativePath = '',
  recursive = true,
  limit = null,
  orderBy = 'alphanumeric',
} = {}) {
  const normalizedOrderBy = normalizeListOrderBy(orderBy);
  const normalizedLimit = normalizeListLimit(limit);
  const root = config.brainDir;
  const fullPath = safeBrainPath(root, relativePath);
  const stats = await fs.stat(fullPath);
  if (stats.isFile()) {
    return [await entryForPath(root, fullPath, stats)];
  }
  if (!stats.isDirectory()) throw new Error(`Path is neither a file nor a directory: ${relativePath}`);

  const entries = [];
  await walkList(root, fullPath, entries, recursive);
  entries.sort(listEntrySorter(normalizedOrderBy));
  return normalizedLimit === null ? entries : entries.slice(0, normalizedLimit);
}

export async function readBrainPage({ config, pagePath }) {
  const relative = normalizePagePath(pagePath);
  const fullPath = safeBrainPath(config.brainDir, relative);
  const markdown = await fs.readFile(fullPath, 'utf8');
  const parsed = parseMarkdownPage(markdown, relative.replace(/\.md$/i, ''));
  const parts = splitPageMarkdown(markdown);
  return {
    path: relative,
    slug: relative.replace(/\.md$/i, ''),
    title: parsed.title,
    type: parsed.type,
    frontmatter: parsed.frontmatter,
    frontmatter_raw: parts.frontmatterRaw,
    body: parsed.compiledTruth,
    timeline: parsed.timeline,
    markdown,
  };
}

export async function createBrainPage({
  config,
  pagePath,
  title,
  body,
  timelineEntry,
  frontmatter = {},
}) {
  const relative = normalizePagePath(pagePath);
  assertAllowedPagePath(relative);
  const fullPath = safeBrainPath(config.brainDir, relative);
  if (await exists(fullPath)) throw new Error(`Page already exists: ${relative}`);

  const now = new Date().toISOString().slice(0, 10);
  const metadata = {
    type: 'note',
    title: requireNonEmpty(title, 'title'),
    created: now,
    ...omitReservedFrontmatter(frontmatter),
  };
  const markdown = renderPageMarkdown({
    frontmatterRaw: renderFrontmatter(metadata),
    title: metadata.title,
    body: requireNonEmpty(body, 'body'),
    timeline: formatTimelineEntry(timelineEntry, now),
  });

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, markdown, 'utf8');
  return readBrainPage({ config, pagePath: relative });
}

export async function createRawFileWithPage({
  config,
  rawPath,
  rawContentBase64,
  rawContentText,
  pagePath,
  title,
  body,
  timelineEntry,
  frontmatter = {},
  mimeType = null,
}) {
  const rawRelative = normalizeRawPath(rawPath);
  const pageRelative = normalizePagePath(pagePath);
  assertAllowedPagePath(pageRelative);

  const rawFullPath = safeBrainPath(config.brainDir, rawRelative);
  const pageFullPath = safeBrainPath(config.brainDir, pageRelative);
  if (await exists(rawFullPath)) throw new Error(`Raw file already exists: ${rawRelative}`);
  if (await exists(pageFullPath)) throw new Error(`Page already exists: ${pageRelative}`);

  const rawBytes = decodeRawContent({ rawContentBase64, rawContentText });
  assertRawFileSize(rawBytes, config);
  const rawLink = path.posix.relative(path.posix.dirname(pageRelative), rawRelative) || path.posix.basename(rawRelative);
  const pageBody = appendRawFileSection(requireNonEmpty(body, 'body'), rawRelative, rawLink);

  await fs.mkdir(path.dirname(rawFullPath), { recursive: true });
  await fs.writeFile(rawFullPath, rawBytes);
  try {
    const page = await createBrainPage({
      config,
      pagePath: pageRelative,
      title,
      body: pageBody,
      timelineEntry,
      frontmatter: {
        ...frontmatter,
        raw_file: rawRelative,
        ...(mimeType ? { raw_mime_type: mimeType } : {}),
      },
    });
    return {
      page,
      raw_file: {
        path: rawRelative,
        size: rawBytes.length,
        mime_type: mimeType || null,
      },
    };
  } catch (error) {
    await fs.rm(rawFullPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function createRawFile({
  config,
  rawPath,
  rawContentBase64,
  rawContentText,
  mimeType = null,
}) {
  const rawRelative = normalizeRawPath(rawPath);
  const rawFullPath = safeBrainPath(config.brainDir, rawRelative);
  if (await exists(rawFullPath)) throw new Error(`Raw file already exists: ${rawRelative}`);
  const rawBytes = decodeRawContent({ rawContentBase64, rawContentText });
  assertRawFileSize(rawBytes, config);
  await fs.mkdir(path.dirname(rawFullPath), { recursive: true });
  await fs.writeFile(rawFullPath, rawBytes);
  return rawFileMetadata(config, rawRelative, { mimeType });
}

export async function readRawFile({ config, rawPath }) {
  const rawRelative = normalizeRawPath(rawPath);
  const rawFullPath = safeBrainPath(config.brainDir, rawRelative);
  const stats = await fs.stat(rawFullPath);
  if (!stats.isFile()) throw new Error(`Raw file is not a file: ${rawRelative}`);
  const bytes = await fs.readFile(rawFullPath);
  return {
    ...(await rawFileMetadata(config, rawRelative, { stats })),
    content_base64: bytes.toString('base64'),
  };
}

export async function updateRawFile({
  config,
  rawPath,
  rawContentBase64,
  rawContentText,
  mimeType = null,
}) {
  const rawRelative = normalizeRawPath(rawPath);
  const rawFullPath = safeBrainPath(config.brainDir, rawRelative);
  const stats = await fs.stat(rawFullPath);
  if (!stats.isFile()) throw new Error(`Raw file is not a file: ${rawRelative}`);
  const rawBytes = decodeRawContent({ rawContentBase64, rawContentText });
  assertRawFileSize(rawBytes, config);
  await fs.writeFile(rawFullPath, rawBytes);
  return rawFileMetadata(config, rawRelative, { mimeType });
}

export async function deleteRawFile({ config, rawPath }) {
  const rawRelative = normalizeRawPath(rawPath);
  const rawFullPath = safeBrainPath(config.brainDir, rawRelative);
  const stats = await fs.stat(rawFullPath);
  if (!stats.isFile()) throw new Error(`Raw file is not a file: ${rawRelative}`);
  await fs.rm(rawFullPath);
  await pruneEmptyRawParents(config.brainDir, path.dirname(rawFullPath));
  return {
    path: rawRelative,
    deleted: true,
  };
}

export async function listRawFiles({
  config,
  rawPath = '',
  recursive = true,
  limit = null,
  orderBy = 'alphanumeric',
} = {}) {
  const normalizedOrderBy = normalizeListOrderBy(orderBy);
  const normalizedLimit = normalizeListLimit(limit);
  const prefix = normalizeRawListPath(rawPath);
  const root = config.brainDir;
  const entries = [];
  await walkRawFiles(root, root, entries, recursive, prefix);
  entries.sort(listEntrySorter(normalizedOrderBy));
  return normalizedLimit === null ? entries : entries.slice(0, normalizedLimit);
}

export async function updateBrainPage({ config, pagePath, body, timelineEntry }) {
  const relative = normalizePagePath(pagePath);
  assertAllowedPagePath(relative);
  const existing = await readBrainPage({ config, pagePath: relative });
  const now = new Date().toISOString().slice(0, 10);
  const nextTimeline = appendTimelineEntry(existing.timeline, timelineEntry, now);
  const markdown = renderPageMarkdown({
    frontmatterRaw: existing.frontmatter_raw,
    title: existing.title,
    body: requireNonEmpty(body, 'body'),
    timeline: nextTimeline,
  });
  await fs.writeFile(safeBrainPath(config.brainDir, relative), markdown, 'utf8');
  return readBrainPage({ config, pagePath: relative });
}

export async function updatePageVisibility({ config, pagePath, visibility, timelineEntry, publicRawFiles }) {
  const relative = normalizePagePath(pagePath);
  assertAllowedPagePath(relative);
  const nextVisibility = normalizePageVisibility(visibility);
  const existing = await readBrainPage({ config, pagePath: relative });
  const now = new Date().toISOString().slice(0, 10);
  let frontmatterRaw = setFrontmatterValue(existing.frontmatter_raw, 'visibility', nextVisibility);
  if (publicRawFiles !== undefined) {
    frontmatterRaw = setFrontmatterValue(frontmatterRaw, 'public_raw_files', normalizePublicRawFiles(publicRawFiles));
  }
  const markdown = renderPageMarkdown({
    frontmatterRaw,
    title: existing.title,
    body: existing.body,
    timeline: appendTimelineEntry(existing.timeline, timelineEntry || `Visibility set to ${nextVisibility}.`, now),
  });
  await fs.writeFile(safeBrainPath(config.brainDir, relative), markdown, 'utf8');
  return readBrainPage({ config, pagePath: relative });
}

export function pageVisibility(frontmatter = {}) {
  return frontmatter?.visibility === 'public' ? 'public' : 'internal';
}

export function normalizePageVisibility(value) {
  const normalized = String(value || 'internal').trim().toLowerCase();
  if (normalized === 'public' || normalized === 'internal') return normalized;
  throw new Error('visibility must be internal or public.');
}

export function publicRawFiles(frontmatter = {}) {
  return normalizePublicRawFiles(frontmatter?.public_raw_files || []);
}

export function normalizePublicRawFiles(value = []) {
  const values = Array.isArray(value) ? value : [value];
  const normalized = values
    .map((item) => normalizeRawPath(item))
    .filter(Boolean);
  return [...new Set(normalized)].sort();
}

export function normalizePagePath(input) {
  const trimmed = requireNonEmpty(input, 'path').replace(/\\/g, '/').replace(/^\/+/, '');
  const normalized = path.posix.normalize(trimmed);
  if (normalized === '.' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw new Error(`Invalid brain path: ${input}`);
  }
  return normalized.endsWith('.md') ? normalized : `${normalized}.md`;
}

export function normalizeRawPath(input) {
  const trimmed = requireNonEmpty(input, 'raw_path').replace(/\\/g, '/').replace(/^\/+/, '');
  const normalized = path.posix.normalize(trimmed);
  if (normalized === '.' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw new Error(`Invalid raw file path: ${input}`);
  }
  const parts = normalized.split('/');
  if (parts.length !== 3 || parts[1] !== '.raw') {
    throw new Error('Raw file path must use <collection>/.raw/<file>.');
  }
  if (parts.some((part, index) => !part || part === '.' || part === '..' || (part.startsWith('.') && index !== 1))) {
    throw new Error(`Invalid raw file path: ${input}`);
  }
  return normalized;
}

export function normalizeRawListPath(input = '') {
  const trimmed = String(input || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!trimmed) return '';
  const normalized = path.posix.normalize(trimmed);
  if (normalized === '.' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw new Error(`Invalid raw file list path: ${input}`);
  }
  const parts = normalized.split('/');
  if (parts[1] !== '.raw' || parts.length > 3) {
    throw new Error('Raw file list path must use <collection>/.raw or <collection>/.raw/<file>.');
  }
  if (parts.some((part, index) => !part || part === '.' || part === '..' || (part.startsWith('.') && part !== '.raw'))) {
    throw new Error(`Invalid raw file list path: ${input}`);
  }
  return normalized;
}

export function safeBrainPath(brainDir, relativePath = '') {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const fullPath = path.resolve(brainDir, normalized);
  const root = path.resolve(brainDir);
  if (fullPath !== root && !fullPath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path escapes brain root: ${relativePath}`);
  }
  return fullPath;
}

export function assertAllowedPagePath(relativePath) {
  const parts = relativePath.split('/');
  if (parts.length < 2) throw new Error('Page path must include a collection folder.');
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error(`Invalid page path: ${relativePath}`);
  if (parts.some((part) => part.startsWith('.'))) throw new Error(`Hidden paths are not allowed: ${relativePath}`);
  if (!relativePath.endsWith('.md')) throw new Error('Page path must end in .md.');
}

function renderPageMarkdown({ frontmatterRaw, title, body, timeline }) {
  return [
    '---',
    frontmatterRaw.trim(),
    '---',
    '',
    normalizeCurrentBody(title, body),
    '',
    '---',
    '',
    '## Timeline',
    '',
    timeline.trim(),
    '',
  ].join('\n');
}

function normalizeCurrentBody(title, body) {
  const trimmed = body.trim();
  if (/^#\s+/m.test(trimmed)) return trimmed;
  return [`# ${title}`, '', trimmed].join('\n');
}

function renderFrontmatter(frontmatter) {
  return Object.entries(frontmatter)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}: ${formatYamlValue(value)}`)
    .join('\n');
}

function omitReservedFrontmatter(frontmatter) {
  const { type, title, created, visibility, public: legacyPublic, ...rest } = frontmatter || {};
  return rest;
}

function setFrontmatterValue(frontmatterRaw, key, value) {
  const lines = String(frontmatterRaw || '').split('\n');
  const next = lines.filter((line) => !new RegExp(`^\\s*${escapeRegExp(key)}\\s*:`).test(line));
  next.push(`${key}: ${formatYamlValue(value)}`);
  return next.filter((line, index, array) => line.trim() || index < array.length - 1).join('\n');
}

function formatYamlValue(value) {
  if (Array.isArray(value)) return `[${value.map((item) => String(item)).join(', ')}]`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const text = String(value);
  return /[:#\n]|^\s|\s$/.test(text) ? JSON.stringify(text) : text;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function appendTimelineEntry(timeline, entry, date) {
  const formatted = formatTimelineEntry(entry, date);
  return [normalizeTimelineEntries(timeline), formatted].filter(Boolean).join('\n');
}

function normalizeTimelineEntries(timeline) {
  return String(timeline || '')
    .trim()
    .replace(/^##\s+Timeline\s*/i, '')
    .trim();
}

function appendRawFileSection(body, rawRelative, rawLink) {
  const label = path.posix.basename(rawRelative);
  return [
    body.trim(),
    '',
    '## Source File',
    '',
    `- [${label}](${rawLink})`,
  ].join('\n');
}

function decodeRawContent({ rawContentBase64, rawContentText }) {
  const hasBase64 = typeof rawContentBase64 === 'string' && rawContentBase64.length > 0;
  const hasText = typeof rawContentText === 'string' && rawContentText.length > 0;
  if (hasBase64 === hasText) throw new Error('Provide exactly one of raw_content_base64 or raw_content_text.');
  if (hasBase64) return Buffer.from(rawContentBase64, 'base64');
  return Buffer.from(rawContentText, 'utf8');
}

function assertRawFileSize(rawBytes, config) {
  const limit = normalizeRawFileMaxBytes(config?.rawFileMaxBytes);
  if (rawBytes.length <= limit) return;
  throw new Error(
    `Raw file is too large: ${formatBytes(rawBytes.length)} exceeds the configured limit of ${formatBytes(limit)}. `
    + 'Compress the file before upload, store only a summary/link in the brain, or raise raw_file_max_bytes/BIGBRAIN_RAW_FILE_MAX_BYTES only if the git backup can handle it.',
  );
}

function normalizeRawFileMaxBytes(value) {
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_RAW_FILE_MAX_BYTES;
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} bytes`;
}

function formatTimelineEntry(entry, date) {
  const text = requireNonEmpty(entry, 'timeline_entry');
  if (/^\s*-\s+\*\*\d{4}-\d{2}-\d{2}\*\*/.test(text)) return text.trim();
  return `- **${date}** | ${text.trim()}`;
}

function splitPageMarkdown(markdown) {
  if (!markdown.startsWith('---\n')) return { frontmatterRaw: '' };
  const end = markdown.indexOf('\n---\n', 4);
  if (end < 0) return { frontmatterRaw: '' };
  return { frontmatterRaw: markdown.slice(4, end) };
}

async function walkList(root, current, entries, recursive) {
  const dirents = await fs.readdir(current, { withFileTypes: true });
  for (const dirent of dirents) {
    if (shouldHideEntry(dirent.name)) continue;
    const fullPath = path.join(current, dirent.name);
    const stats = await fs.stat(fullPath);
    entries.push(await entryForPath(root, fullPath, stats));
    if (recursive && stats.isDirectory()) await walkList(root, fullPath, entries, recursive);
  }
}

async function walkRawFiles(root, current, entries, recursive, prefix) {
  const dirents = await fs.readdir(current, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const dirent of dirents) {
    if (dirent.name === '.git' || dirent.name === '.bigbrain' || dirent.name === '.bigbrain-state' || dirent.name === 'node_modules') continue;
    const fullPath = path.join(current, dirent.name);
    const relative = path.relative(root, fullPath).split(path.sep).join('/');
    const stats = await fs.stat(fullPath);
    if (stats.isDirectory()) {
      const segments = relative.split('/');
      if (recursive || !segments.includes('.raw') || path.basename(fullPath) === '.raw') {
        await walkRawFiles(root, fullPath, entries, recursive, prefix);
      }
      continue;
    }
    if (!relative.split('/').includes('.raw')) continue;
    if (prefix && relative !== prefix && !relative.startsWith(`${prefix}/`)) continue;
    entries.push(await entryForPath(root, fullPath, stats));
  }
}

async function entryForPath(root, fullPath, stats) {
  return {
    path: path.relative(root, fullPath).split(path.sep).join('/'),
    kind: stats.isDirectory() ? 'directory' : 'file',
    size: stats.isFile() ? stats.size : null,
    created_at: stats.birthtime.toISOString(),
    updated_at: stats.mtime.toISOString(),
  };
}

async function rawFileMetadata(config, rawRelative, { stats = null, mimeType = null } = {}) {
  const fullPath = safeBrainPath(config.brainDir, rawRelative);
  const fileStats = stats || await fs.stat(fullPath);
  return {
    path: rawRelative,
    size: fileStats.size,
    mime_type: mimeType || null,
    created_at: fileStats.birthtime.toISOString(),
    updated_at: fileStats.mtime.toISOString(),
  };
}

async function pruneEmptyRawParents(brainDir, currentDir) {
  const root = path.resolve(brainDir);
  let cursor = path.resolve(currentDir);
  while (cursor.startsWith(`${root}${path.sep}`) && path.basename(cursor) !== '.raw') {
    const entries = await fs.readdir(cursor).catch(() => null);
    if (!entries || entries.length > 0) return;
    await fs.rmdir(cursor);
    cursor = path.dirname(cursor);
  }
}

function listEntrySorter(orderBy) {
  if (orderBy === 'updated_at' || orderBy === 'created_at') {
    return (left, right) => right[orderBy].localeCompare(left[orderBy]) || comparePath(left.path, right.path);
  }
  return (left, right) => comparePath(left.path, right.path);
}

function comparePath(left, right) {
  return left.localeCompare(right, undefined, { numeric: true });
}

function normalizeListOrderBy(value) {
  const normalized = String(value || 'alphanumeric').trim();
  if (!LIST_ORDER_BY.has(normalized)) {
    throw new Error(`order_by must be one of: ${Array.from(LIST_ORDER_BY).join(', ')}`);
  }
  return normalized;
}

function normalizeListLimit(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error('limit must be a positive number.');
  return Math.floor(number);
}

function shouldHideEntry(name) {
  return name.startsWith('.') || name === 'node_modules';
}

async function exists(fullPath) {
  return fs.stat(fullPath).then(() => true).catch(() => false);
}

function requireNonEmpty(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}
