import fs from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_RAW_FILE_MAX_BYTES } from './constants.js';
import { assertRegisteredPageDomains } from './domains.js';
import { parseMarkdownPage } from './markdown.js';
import { assertSafePublicRawPath, isSafePublicRawPath } from './public-raw-policy.js';
import { appendTimelineEntries, formatTimelineEntries } from './timeline.js';
import { validatePageShape } from './schema.js';

export const DEFAULT_COLLECTIONS = [
  'archive',
  'components',
  'concepts',
  'deals',
  'ideas',
  'meetings',
  'organizations',
  'people',
  'processes',
  'products',
  'protocol',
  'projects',
  'tasks',
  'writing',
];

const PAGE_IMAGE_KINDS = new Set(['product', 'component', 'system', 'installation', 'diagram', 'other']);
const PAGE_IMAGE_CONFIDENCES = new Set(['high', 'medium', 'low']);
const PAGE_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.heic']);
const MAX_PAGE_IMAGES = 100;

const LIST_ORDER_BY = new Set(['updated_at', 'created_at', 'alphanumeric']);

// Provenance describes a particular update event. It must live on the
// timeline entry that records that update, never on mutable page metadata.
const PROVENANCE_FRONTMATTER_KEYS = new Set([
  'event_id',
  'origin_id',
  'listener_id',
  'source_type',
  'source_label',
  'source_message',
  'source_icon',
  'source_url',
  'source_endpoint',
  'occurred_at',
  'received_at',
  'codex_execution_id',
  'codex_thread_id',
  'raw_ref',
  'outcome',
  'commit_message',
  'mutation_metadata',
  'provenance',
]);

function withTimelineProvenance(input, provenance) {
  if (provenance === null || provenance === undefined) return input;
  if (Array.isArray(input)) return input.map((entry) => withTimelineProvenance(entry, provenance));
  if (typeof input === 'string') return { text: input, provenance };
  if (input && typeof input === 'object') {
    return {
      ...input,
      provenance: {
        ...provenance,
        ...(input.provenance || {}),
      },
    };
  }
  return input;
}

export async function listBrainPath({
  config,
  relativePath = '',
  recursive = true,
  limit = null,
  orderBy = 'alphanumeric',
  updatedSince = null,
  updatedUntil = null,
  createdSince = null,
  createdUntil = null,
} = {}) {
  const normalizedOrderBy = normalizeListOrderBy(orderBy);
  const normalizedLimit = normalizeListLimit(limit);
  const timeFilters = normalizeListTimeFilters({ updatedSince, updatedUntil, createdSince, createdUntil });
  const root = config.brainDir;
  const fullPath = safeBrainPath(root, relativePath);
  const stats = await fs.stat(fullPath);
  if (stats.isFile()) {
    const entry = await entryForPath(root, fullPath, stats);
    return !timeFilters || matchesListTimeFilters(entry, timeFilters) ? [entry] : [];
  }
  if (!stats.isDirectory()) throw new Error(`Path is neither a file nor a directory: ${relativePath}`);

  const entries = [];
  await walkList(root, fullPath, entries, recursive, timeFilters);
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
    compiled_truth: parsed.compiledTruth,
    timeline: parsed.timeline,
    timeline_entries: parsed.timeline_entries,
    markdown,
  };
}

export async function quickPageHealthCheck({ config, pagePath }) {
  const relative = normalizePagePath(pagePath);
  const fullPath = safeBrainPath(config.brainDir, relative);
  const markdown = await fs.readFile(fullPath, 'utf8');
  const parsed = parseMarkdownPage(markdown, relative.replace(/\.md$/i, ''));
  const findings = validatePageShape(parsed);
  const timelineEvidence = String(parsed.timeline || '')
    .replace(/^##\s+(?:Timeline|History)\s*\n?/i, '')
    .trim();
  return {
    ok: findings.length === 0,
    assertions: {
      frontmatter: parsed.hasFrontmatter,
      title: Boolean(parsed.title),
      compiled_truth: Boolean(parsed.compiledTruth.trim()),
      timeline_boundary: parsed.hasSeparator,
      timeline_evidence: Boolean(timelineEvidence),
      timeline_clean: parsed.timeline_clean !== false,
      single_timeline: parsed.timelineBoundaryCount === 1 && parsed.timelineHeadingCount === 1,
    },
    findings,
  };
}

export async function createBrainPage({
  config,
  pagePath,
  title,
  compiledTruth = undefined,
  body = undefined,
  timelineEntry,
  timelineEntries = null,
  timelineProvenance = null,
  timelineSignificance = null,
  frontmatter = {},
  domains = undefined,
  images = undefined,
}) {
  const relative = normalizePagePath(pagePath);
  assertAllowedPagePath(relative);
  const fullPath = safeBrainPath(config.brainDir, relative);
  if (await exists(fullPath)) throw new Error(`Page already exists: ${relative}`);
  const currentBody = requireNonEmpty(compiledTruth ?? body, 'compiled_truth');
  assertWritablePageBody(currentBody);

  const now = new Date().toISOString();
  const timelineInput = withTimelineProvenance(timelineEntries ?? timelineEntry, timelineProvenance);
  const suppliedFrontmatter = frontmatter || {};
  if (domains !== undefined && suppliedFrontmatter.domains !== undefined && !sameDomainMembership(domains, suppliedFrontmatter.domains)) {
    throw new Error('Page domains must match frontmatter.domains when both are provided.');
  }
  const suppliedDomains = domains !== undefined ? domains : suppliedFrontmatter.domains;
  const normalizedDomains = suppliedDomains === undefined
    ? undefined
    : await assertRegisteredPageDomains(config, suppliedDomains);
  const suppliedImages = images !== undefined ? images : suppliedFrontmatter.images;
  const normalizedImages = suppliedImages === undefined
    ? undefined
    : await normalizePageImages({ config, images: suppliedImages });
  const metadata = {
    title: requireNonEmpty(title, 'title'),
    created: now.slice(0, 10),
    ...omitReservedFrontmatter(suppliedFrontmatter),
  };
  if (normalizedDomains !== undefined) metadata.domains = normalizedDomains;
  if (normalizedImages !== undefined) metadata.images = normalizedImages;
  const markdown = renderPageMarkdown({
    frontmatterRaw: renderFrontmatter(metadata),
    title: metadata.title,
    body: currentBody,
    timeline: formatTimelineEntries(timelineInput, {
      recordedAt: now,
      significance: timelineSignificance,
      requireProvenance: true,
    }),
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
  timelineEntries = null,
  timelineProvenance = null,
  timelineSignificance = null,
  frontmatter = {},
  domains = undefined,
  mimeType = null,
}) {
  const rawRelative = normalizeRawPath(rawPath);
  const expectedSidecar = sidecarPathForRawFile(rawRelative);
  const pageRelative = pagePath ? normalizePagePath(pagePath) : expectedSidecar;
  if (pageRelative !== expectedSidecar) {
    throw new Error(`Raw attachment page must use the deterministic sidecar path ${expectedSidecar}.`);
  }
  assertAllowedPagePath(pageRelative);

  const rawFullPath = safeBrainPath(config.brainDir, rawRelative);
  const pageFullPath = safeBrainPath(config.brainDir, pageRelative);
  if (await exists(rawFullPath)) throw new Error(`Raw file already exists: ${rawRelative}`);
  if (await exists(pageFullPath)) throw new Error(`Page already exists: ${pageRelative}`);

  const rawBytes = decodeRawContent({ rawContentBase64, rawContentText });
  assertRawFileSize(rawBytes, config);
  const pageBody = requireNonEmpty(body, 'body');
  assertWritablePageBody(pageBody);

  await fs.mkdir(path.dirname(rawFullPath), { recursive: true });
  await fs.writeFile(rawFullPath, rawBytes);
  try {
    const page = await createBrainPage({
      config,
      pagePath: pageRelative,
      title,
      compiledTruth: pageBody,
      timelineEntry,
      timelineEntries,
      timelineProvenance,
      timelineSignificance,
      frontmatter: {
        ...frontmatter,
        raw_file: rawRelative,
        ...(mimeType ? { raw_mime_type: mimeType } : {}),
      },
      domains,
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

export async function renameRawFile({
  config,
  fromRawPath,
  toRawPath,
}) {
  const fromRelative = normalizeRawPath(fromRawPath);
  const toRelative = normalizeRawPath(toRawPath);
  if (fromRelative === toRelative) throw new Error('Raw file source and destination must differ.');
  const fromFullPath = safeBrainPath(config.brainDir, fromRelative);
  const toFullPath = safeBrainPath(config.brainDir, toRelative);
  const stats = await fs.stat(fromFullPath);
  if (!stats.isFile()) throw new Error(`Raw file is not a file: ${fromRelative}`);
  if (await exists(toFullPath)) throw new Error(`Raw file already exists: ${toRelative}`);
  const fromSidecar = sidecarPathForRawFile(fromRelative);
  const toSidecar = sidecarPathForRawFile(toRelative);
  const fromSidecarFull = safeBrainPath(config.brainDir, fromSidecar);
  const toSidecarFull = safeBrainPath(config.brainDir, toSidecar);
  if (await exists(fromSidecarFull) && await exists(toSidecarFull)) {
    throw new Error(`Attachment sidecar already exists: ${toSidecar}`);
  }
  await fs.mkdir(path.dirname(toFullPath), { recursive: true });
  await fs.rename(fromFullPath, toFullPath);
  if (await exists(fromSidecarFull)) {
    await fs.rename(fromSidecarFull, toSidecarFull);
  }
  await pruneEmptyRawParents(config.brainDir, path.dirname(fromFullPath));
  const changed_pages = await rewriteMarkdownReferencesAcrossBrain({
    config,
    kind: 'raw',
    fromPath: fromRelative,
    toPath: toRelative,
  });
  return {
    ...(await rawFileMetadata(config, toRelative)),
    previous_path: fromRelative,
    changed_pages,
  };
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

export async function updateBrainPage({ config, pagePath, compiledTruth = undefined, body = undefined, timelineEntry, timelineEntries = null, timelineProvenance = null, timelineSignificance = null, frontmatterValues = {} }) {
  const relative = normalizePagePath(pagePath);
  assertAllowedPagePath(relative);
  const currentBody = requireNonEmpty(compiledTruth ?? body, 'compiled_truth');
  assertWritablePageBody(currentBody);
  const existing = await readBrainPage({ config, pagePath: relative });
  const now = new Date().toISOString();
  const timelineInput = withTimelineProvenance(timelineEntries ?? timelineEntry, timelineProvenance);
  const nextTimeline = appendTimelineEntries(existing.timeline, timelineInput, {
    recordedAt: now,
    significance: timelineSignificance,
    requireProvenance: true,
  });
  const nextFrontmatterValues = { ...(frontmatterValues || {}) };
  if (Object.prototype.hasOwnProperty.call(nextFrontmatterValues, 'domains')) {
    nextFrontmatterValues.domains = await assertRegisteredPageDomains(config, nextFrontmatterValues.domains);
  }
  if (Object.prototype.hasOwnProperty.call(nextFrontmatterValues, 'images')) {
    nextFrontmatterValues.images = await normalizePageImages({ config, images: nextFrontmatterValues.images });
  }
  let frontmatterRaw = existing.frontmatter_raw;
  for (const [key, value] of Object.entries(nextFrontmatterValues)) {
    if (!PROVENANCE_FRONTMATTER_KEYS.has(key)) frontmatterRaw = setFrontmatterValue(frontmatterRaw, key, value);
  }
  const markdown = renderPageMarkdown({
    frontmatterRaw,
    title: existing.title,
    body: currentBody,
    timeline: nextTimeline,
  });
  await fs.writeFile(safeBrainPath(config.brainDir, relative), markdown, 'utf8');
  return readBrainPage({ config, pagePath: relative });
}

export async function updateBrainPageImages({
  config,
  pagePath,
  images,
  mode = 'append',
  timelineEntry,
  timelineEntries = null,
  timelineProvenance = null,
  timelineSignificance = null,
}) {
  const relative = normalizePagePath(pagePath);
  assertAllowedPagePath(relative);
  const existing = await readBrainPage({ config, pagePath: relative });
  const normalizedMode = String(mode || 'append').trim().toLowerCase();
  if (!['append', 'replace'].includes(normalizedMode)) throw new Error('Image attachment mode must be append or replace.');
  const currentImages = existing.frontmatter.images === undefined ? [] : existing.frontmatter.images;
  const candidate = normalizedMode === 'replace'
    ? images
    : [...(Array.isArray(currentImages) ? currentImages : []), ...(Array.isArray(images) ? images : [])];
  const normalizedImages = await normalizePageImages({ config, images: candidate });
  const now = new Date().toISOString();
  const timelineInput = withTimelineProvenance(
    timelineEntries ?? timelineEntry ?? `Attached ${normalizedImages.length} page image${normalizedImages.length === 1 ? '' : 's'}.`,
    timelineProvenance,
  );
  let frontmatterRaw = setFrontmatterValue(existing.frontmatter_raw, 'images', normalizedImages);
  const markdown = renderPageMarkdown({
    frontmatterRaw,
    title: existing.title,
    body: existing.body,
    timeline: appendTimelineEntries(existing.timeline, timelineInput, {
      recordedAt: now,
      significance: timelineSignificance,
      requireProvenance: true,
    }),
  });
  await fs.writeFile(safeBrainPath(config.brainDir, relative), markdown, 'utf8');
  return readBrainPage({ config, pagePath: relative });
}

export async function normalizePageImages({ config, images }) {
  if (!Array.isArray(images)) throw new Error('images must be an array.');
  if (images.length > MAX_PAGE_IMAGES) throw new Error(`A page may have at most ${MAX_PAGE_IMAGES} images.`);
  const normalized = [];
  const seen = new Set();
  for (const [index, image] of images.entries()) {
    if (!image || typeof image !== 'object' || Array.isArray(image)) throw new Error(`images[${index}] must be an object.`);
    const rawPath = normalizeRawPath(image.path);
    const extension = path.posix.extname(rawPath).toLowerCase();
    if (!PAGE_IMAGE_EXTENSIONS.has(extension)) throw new Error(`images[${index}].path must point to a supported image file.`);
    if (seen.has(rawPath)) throw new Error(`Duplicate page image path: ${rawPath}`);
    seen.add(rawPath);
    const stats = await fs.lstat(safeBrainPath(config.brainDir, rawPath)).catch((error) => {
      if (error?.code === 'ENOENT') throw new Error(`Page image does not exist under the brain: ${rawPath}`);
      throw error;
    });
    if (stats.isSymbolicLink()) throw new Error(`Page image path may not be a symbolic link: ${rawPath}`);
    if (!stats.isFile()) throw new Error(`Page image path is not a file: ${rawPath}`);
    const item = { path: rawPath };
    for (const key of ['caption', 'alt_text', 'source', 'timestamp', 'captured_at']) {
      if (image[key] === undefined || image[key] === null) continue;
      if (typeof image[key] !== 'string' || !image[key].trim()) throw new Error(`images[${index}].${key} must be a non-empty string.`);
      item[key] = image[key].trim();
    }
    if (image.kind !== undefined) {
      if (typeof image.kind !== 'string' || !PAGE_IMAGE_KINDS.has(image.kind.trim().toLowerCase())) {
        throw new Error(`images[${index}].kind must be one of: ${[...PAGE_IMAGE_KINDS].join(', ')}.`);
      }
      item.kind = image.kind.trim().toLowerCase();
    }
    if (image.confidence !== undefined) {
      if (typeof image.confidence !== 'string' || !PAGE_IMAGE_CONFIDENCES.has(image.confidence.trim().toLowerCase())) {
        throw new Error(`images[${index}].confidence must be high, medium, or low.`);
      }
      item.confidence = image.confidence.trim().toLowerCase();
    }
    normalized.push(item);
  }
  return normalized;
}

export async function renameBrainPage({
  config,
  fromPagePath,
  toPagePath,
  title = null,
  timelineEntry,
  timelineEntries = null,
  timelineProvenance = null,
  timelineSignificance = null,
  frontmatterValues = {},
}) {
  const fromRelative = normalizePagePath(fromPagePath);
  const toRelative = normalizePagePath(toPagePath);
  if (fromRelative === toRelative) throw new Error('Page source and destination must differ.');
  assertAllowedPagePath(fromRelative);
  assertAllowedPagePath(toRelative);
  const fromFullPath = safeBrainPath(config.brainDir, fromRelative);
  const toFullPath = safeBrainPath(config.brainDir, toRelative);
  const stats = await fs.stat(fromFullPath);
  if (!stats.isFile()) throw new Error(`Page is not a file: ${fromRelative}`);
  if (await exists(toFullPath)) throw new Error(`Page already exists: ${toRelative}`);

  const existing = await readBrainPage({ config, pagePath: fromRelative });
  const now = new Date().toISOString();
  const timelineInput = withTimelineProvenance(timelineEntries ?? timelineEntry, timelineProvenance);
  const nextTitle = title ? requireNonEmpty(title, 'title') : existing.title;
  const nextBody = title ? replaceLeadingHeading(existing.body, existing.title, nextTitle) : existing.body;
  let frontmatterRaw = title
    ? setFrontmatterValue(existing.frontmatter_raw, 'title', nextTitle)
    : existing.frontmatter_raw;
  frontmatterRaw = setFrontmatterValue(
    frontmatterRaw,
    'redirect_from',
    appendUniqueFrontmatterList(existing.frontmatter.redirect_from, fromRelative.replace(/\.md$/i, '')),
  );
  for (const [key, value] of Object.entries(frontmatterValues || {})) {
    if (!PROVENANCE_FRONTMATTER_KEYS.has(key)) frontmatterRaw = setFrontmatterValue(frontmatterRaw, key, value);
  }
  const markdown = renderPageMarkdown({
    frontmatterRaw,
    title: nextTitle,
    body: nextBody,
    timeline: appendTimelineEntries(existing.timeline, timelineInput, {
      recordedAt: now,
      significance: timelineSignificance,
      requireProvenance: true,
    }),
  });

  await fs.mkdir(path.dirname(toFullPath), { recursive: true });
  await fs.writeFile(toFullPath, markdown, 'utf8');
  await fs.rm(fromFullPath);
  await pruneEmptyMarkdownParents(config.brainDir, path.dirname(fromFullPath));
  const changed_pages = await rewriteMarkdownReferencesAcrossBrain({
    config,
    kind: 'page',
    fromPath: fromRelative,
    toPath: toRelative,
  });
  return {
    ...(await readBrainPage({ config, pagePath: toRelative })),
    previous_path: fromRelative,
    changed_pages,
  };
}

export async function updatePageVisibility({ config, pagePath, visibility, timelineEntry, timelineEntries = null, timelineProvenance = null, timelineSignificance = null, publicRawFiles, frontmatterValues = {} }) {
  const relative = normalizePagePath(pagePath);
  assertAllowedPagePath(relative);
  const nextVisibility = normalizePageVisibility(visibility);
  const existing = await readBrainPage({ config, pagePath: relative });
  if (nextVisibility === 'public' && isAttachmentSidecarPath(relative)) {
    const rawPath = requireAttachmentRawFile(existing);
    await assertPublicRawFileExists(config, rawPath);
    assertPublicRawTypeAllowed(rawPath);
    if (publicRawFiles !== undefined && normalizePublicRawFiles(publicRawFiles).some((item) => item !== rawPath)) {
      throw new Error('Attachment sidecars publish only their same-basename raw_file; public_raw_files cannot expose siblings.');
    }
  }
  const now = new Date().toISOString();
  const timelineInput = withTimelineProvenance(
    timelineEntries ?? timelineEntry ?? `Visibility set to ${nextVisibility}.`,
    timelineProvenance,
  );
  let frontmatterRaw = setFrontmatterValue(existing.frontmatter_raw, 'visibility', nextVisibility);
  if (publicRawFiles !== undefined) {
    frontmatterRaw = setFrontmatterValue(
      frontmatterRaw,
      'public_raw_files',
      await validatePublicRawFilesForPage({ config, page: existing, publicRawFiles }),
    );
  }
  for (const [key, value] of Object.entries(frontmatterValues || {})) {
    if (!PROVENANCE_FRONTMATTER_KEYS.has(key)) frontmatterRaw = setFrontmatterValue(frontmatterRaw, key, value);
  }
  const markdown = renderPageMarkdown({
    frontmatterRaw,
    title: existing.title,
    body: existing.body,
    timeline: appendTimelineEntries(existing.timeline, timelineInput, {
      recordedAt: now,
      significance: timelineSignificance,
      requireProvenance: true,
    }),
  });
  await fs.writeFile(safeBrainPath(config.brainDir, relative), markdown, 'utf8');
  return readBrainPage({ config, pagePath: relative });
}

function isAttachmentSidecarPath(relativePath) {
  const parts = String(relativePath || '').split('/');
  return parts.length === 3 && parts[1] === '.raw' && parts[2].endsWith('.md');
}

function requireAttachmentRawFile(page) {
  const rawPath = normalizeRawPath(page?.frontmatter?.raw_file);
  const expectedSidecar = sidecarPathForRawFile(rawPath);
  if (expectedSidecar !== page.path) {
    throw new Error(`Attachment sidecar ${page.path} must declare its same-basename raw_file.`);
  }
  return rawPath;
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
  return normalizePublicRawFiles(frontmatter?.public_raw_files || [], { rejectUnsafe: false });
}

export function normalizePublicRawFiles(value = [], { rejectUnsafe = true } = {}) {
  const values = Array.isArray(value) ? value : [value];
  const normalized = values
    .map((item) => normalizeRawPath(item))
    .filter((item) => {
      if (isSafePublicRawPath(item)) return true;
      if (rejectUnsafe) assertPublicRawTypeAllowed(item);
      return false;
    })
    .filter(Boolean);
  return [...new Set(normalized)].sort();
}

export async function validatePublicRawFilesForPage({ config, page, publicRawFiles }) {
  const normalized = normalizePublicRawFiles(publicRawFiles);
  if (!normalized.length) return normalized;

  const linkedRawFiles = rawFilesLinkedFromPage(page);
  const attachedRawFiles = rawFilesAttachedToPage(page);
  for (const rawPath of normalized) {
    await assertPublicRawFileExists(config, rawPath);
    if (linkedRawFiles.has(rawPath) || attachedRawFiles.has(rawPath)) continue;
    throw new Error(
      `Cannot publish raw file ${rawPath}: it is not linked from page ${page.path} and does not match that page's raw_file frontmatter. `
      + `Add a markdown link to ${rawPath} in the page body, or attach it by setting raw_file: ${rawPath} before listing it in public_raw_files.`,
    );
  }
  return normalized;
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
  const isAttachmentSidecar = parts.length === 3 && parts[1] === '.raw' && relativePath.endsWith('.md');
  if (!isAttachmentSidecar && parts.some((part) => part.startsWith('.'))) throw new Error(`Hidden paths are not allowed: ${relativePath}`);
  if (isAttachmentSidecar && parts[2].startsWith('.')) throw new Error(`Invalid attachment sidecar path: ${relativePath}`);
  if (!relativePath.endsWith('.md')) throw new Error('Page path must end in .md.');
}

export function sidecarPathForRawFile(rawPath) {
  const normalized = normalizeRawPath(rawPath);
  const extension = path.posix.extname(normalized);
  if (!extension || extension.toLowerCase() === '.md') {
    throw new Error('Raw attachment must have a non-Markdown file extension.');
  }
  return `${normalized.slice(0, -extension.length)}.md`;
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

export function assertWritablePageBody(body) {
  const value = String(body || '');
  if (/^##\s+(?:Timeline|History)\s*$/im.test(value) || /<!--\s*timeline\s*-->/i.test(value)) {
    throw new Error('Page body must contain current content only; the timeline boundary and timeline are writer-managed.');
  }
}

function replaceLeadingHeading(body, oldTitle, nextTitle) {
  const lines = String(body || '').split('\n');
  const index = lines.findIndex((line) => line.trim());
  if (index < 0) return `# ${nextTitle}`;
  const heading = lines[index].match(/^#\s+(.+)$/);
  if (!heading) return body;
  if (heading[1].trim() !== oldTitle) return body;
  lines[index] = `# ${nextTitle}`;
  return lines.join('\n');
}

function renderFrontmatter(frontmatter) {
  return Object.entries(frontmatter)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}: ${formatYamlValue(value)}`)
    .join('\n');
}

function omitReservedFrontmatter(frontmatter) {
  const { type, title, created, visibility, public: legacyPublic, ...rest } = frontmatter || {};
  return Object.fromEntries(Object.entries(rest).filter(([key]) => !PROVENANCE_FRONTMATTER_KEYS.has(key)));
}

function setFrontmatterValue(frontmatterRaw, key, value) {
  const lines = String(frontmatterRaw || '').split('\n');
  const next = lines.filter((line) => !new RegExp(`^\\s*${escapeRegExp(key)}\\s*:`).test(line));
  next.push(`${key}: ${formatYamlValue(value)}`);
  return next.filter((line, index, array) => line.trim() || index < array.length - 1).join('\n');
}

function appendUniqueFrontmatterList(existing, value) {
  const values = Array.isArray(existing) ? existing : [existing];
  return [...new Set([...values, value].map((item) => String(item || '').trim()).filter(Boolean))];
}

function sameDomainMembership(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  return [...new Set(left.map((value) => String(value).trim()))].sort().join('\n')
    === [...new Set(right.map((value) => String(value).trim()))].sort().join('\n');
}

function formatYamlValue(value) {
  if (Array.isArray(value)) {
    if (value.some((item) => item && typeof item === 'object')) return JSON.stringify(value);
    return `[${value.map((item) => String(item)).join(', ')}]`;
  }
  if (value && typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const text = String(value);
  return /[:#\n]|^\s|\s$/.test(text) ? JSON.stringify(text) : text;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function splitPageMarkdown(markdown) {
  if (!markdown.startsWith('---\n')) return { frontmatterRaw: '' };
  const end = markdown.indexOf('\n---\n', 4);
  if (end < 0) return { frontmatterRaw: '' };
  return { frontmatterRaw: markdown.slice(4, end) };
}

async function walkList(root, current, entries, recursive, timeFilters = null) {
  const dirents = await fs.readdir(current, { withFileTypes: true });
  for (const dirent of dirents) {
    if (shouldHideEntry(dirent.name)) continue;
    const fullPath = path.join(current, dirent.name);
    const stats = await fs.stat(fullPath);
    const entry = await entryForPath(root, fullPath, stats);
    if (!timeFilters || matchesListTimeFilters(entry, timeFilters)) entries.push(entry);
    if (recursive && stats.isDirectory()) await walkList(root, fullPath, entries, recursive, timeFilters);
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

async function walkMarkdownFiles(root, current, files = []) {
  const dirents = await fs.readdir(current, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const dirent of dirents) {
    if (dirent.name === '.git' || dirent.name === '.bigbrain' || dirent.name === '.bigbrain-state' || dirent.name === 'node_modules') continue;
    const fullPath = path.join(current, dirent.name);
    if (dirent.isDirectory()) {
      await walkMarkdownFiles(root, fullPath, files);
      continue;
    }
    if (!dirent.isFile() || !dirent.name.endsWith('.md')) continue;
    const relative = path.relative(root, fullPath).split(path.sep).join('/');
    files.push({ fullPath, relative });
  }
  return files;
}

async function rewriteMarkdownReferencesAcrossBrain({ config, kind, fromPath, toPath }) {
  const files = await walkMarkdownFiles(config.brainDir, config.brainDir);
  const changed = [];
  for (const file of files) {
    const markdown = await fs.readFile(file.fullPath, 'utf8');
    const next = rewriteMarkdownReferences({
      markdown,
      currentPagePath: file.relative,
      kind,
      fromPath,
      toPath,
    });
    if (next === markdown) continue;
    await fs.writeFile(file.fullPath, next, 'utf8');
    changed.push(file.relative);
  }
  return changed;
}

function rewriteMarkdownReferences({ markdown, currentPagePath, kind, fromPath, toPath }) {
  const sourceSlug = currentPagePath.replace(/\.md$/i, '');
  const sourceDir = path.posix.dirname(currentPagePath);
  let next = String(markdown || '');
  if (kind === 'raw') {
    next = next.replace(
      /(^\s*(?:raw_file|public_raw_files|images)\s*:\s*)([^\n]+)/gm,
      (match, prefix, value) => `${prefix}${rewriteRawFrontmatterValue(value, fromPath, toPath)}`,
    );
  }
  return next.replace(/(!?\[[^\]]*\]\()([^)#]+)(#[^)]*)?(\))/g, (match, prefix, target, anchor = '', suffix) => {
    const replacement = kind === 'raw'
      ? rewriteRawLinkTarget({ sourceSlug, target, fromPath, toPath })
      : rewritePageLinkTarget({ sourceDir, target, fromPath, toPath });
    if (!replacement) return match;
    const nextPrefix = kind === 'raw'
      ? prefix.replace(path.posix.basename(fromPath), path.posix.basename(toPath))
      : prefix;
    return `${nextPrefix}${replacement}${anchor}${suffix}`;
  });
}

function rewriteRawFrontmatterValue(value, fromPath, toPath) {
  const rewritten = String(value || '').replaceAll(fromPath, toPath);
  return rewritten;
}

function rewriteRawLinkTarget({ sourceSlug, target, fromPath, toPath }) {
  const resolved = resolveRawLinkTarget(sourceSlug, target);
  if (resolved !== fromPath) return null;
  const currentDir = path.posix.dirname(`${sourceSlug}.md`);
  return path.posix.relative(currentDir, toPath) || path.posix.basename(toPath);
}

function rewritePageLinkTarget({ sourceDir, target, fromPath, toPath }) {
  const resolved = resolvePageLinkTarget(sourceDir, target);
  if (resolved !== fromPath) return null;
  return path.posix.relative(sourceDir, toPath) || path.posix.basename(toPath);
}

function resolvePageLinkTarget(sourceDir, target) {
  const trimmed = String(target || '').trim();
  if (!trimmed || /^(https?:|mailto:|#)/i.test(trimmed)) return null;
  const withoutQuery = trimmed.split('?')[0].trim();
  if (!withoutQuery || withoutQuery.split('/').includes('.raw')) return null;
  const candidate = path.posix.normalize(
    withoutQuery.startsWith('/') ? withoutQuery.replace(/^\/+/, '') : path.posix.join(sourceDir, withoutQuery),
  );
  try {
    return normalizePagePath(candidate);
  } catch {
    return null;
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

async function assertPublicRawFileExists(config, rawPath) {
  const fullPath = safeBrainPath(config.brainDir, rawPath);
  let stats;
  try {
    stats = await fs.stat(fullPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Cannot publish raw file ${rawPath}: file does not exist under the brain. Create it first or remove it from public_raw_files.`);
    }
    throw error;
  }
  if (!stats.isFile()) {
    throw new Error(`Cannot publish raw file ${rawPath}: path exists but is not a file. Choose a specific file under <collection>/.raw/.`);
  }
}

function assertPublicRawTypeAllowed(rawPath) {
  try {
    assertSafePublicRawPath(rawPath);
  } catch (error) {
    throw new Error(`Cannot publish raw file ${rawPath}: ${error.message}`);
  }
}

function rawFilesLinkedFromPage(page) {
  const linked = new Set();
  const sourceSlug = page.slug || String(page.path || '').replace(/\.md$/i, '');
  for (const match of String(page.body || '').matchAll(/!?\[([^\]]*)\]\(([^)]+)\)/g)) {
    const rawPath = resolveRawLinkTarget(sourceSlug, match[2]);
    if (rawPath) linked.add(rawPath);
  }
  return linked;
}

function rawFilesAttachedToPage(page) {
  const attached = new Set();
  const values = Array.isArray(page?.frontmatter?.raw_file)
    ? page.frontmatter.raw_file
    : [page?.frontmatter?.raw_file];
  for (const value of values) {
    if (!value) continue;
    try {
      attached.add(normalizeRawPath(value));
    } catch {
      // Ignore malformed legacy raw_file values. Publishing still requires a valid public_raw_files path.
    }
  }
  for (const image of Array.isArray(page?.frontmatter?.images) ? page.frontmatter.images : []) {
    try {
      attached.add(normalizeRawPath(image?.path));
    } catch {
      // Ignore malformed image metadata. Publishing still requires a valid file path.
    }
  }
  return attached;
}

function resolveRawLinkTarget(sourceSlug, target) {
  const trimmed = String(target || '').trim();
  if (!trimmed || /^(https?:|mailto:|#)/i.test(trimmed)) return null;
  const withoutAnchor = trimmed.split('#')[0].trim();
  if (!withoutAnchor) return null;
  const sourceDir = path.posix.dirname(sourceSlug);
  const candidate = path.posix.normalize(
    withoutAnchor.startsWith('/') ? withoutAnchor.replace(/^\/+/, '') : path.posix.join(sourceDir, withoutAnchor),
  );
  if (!candidate.split('/').includes('.raw')) return null;
  try {
    return normalizeRawPath(candidate);
  } catch {
    return null;
  }
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

async function pruneEmptyMarkdownParents(brainDir, currentDir) {
  const root = path.resolve(brainDir);
  let cursor = path.resolve(currentDir);
  while (cursor.startsWith(`${root}${path.sep}`)) {
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

function normalizeListTimeFilters({ updatedSince, updatedUntil, createdSince, createdUntil }) {
  const filters = {};
  for (const [key, value] of Object.entries({ updatedSince, updatedUntil, createdSince, createdUntil })) {
    if (value === null || value === undefined || value === '') continue;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error(`${key} must be a valid timestamp.`);
    filters[key] = date.getTime();
  }
  if (filters.updatedSince !== undefined && filters.updatedUntil !== undefined && filters.updatedSince > filters.updatedUntil) {
    throw new Error('updatedSince cannot be after updatedUntil.');
  }
  if (filters.createdSince !== undefined && filters.createdUntil !== undefined && filters.createdSince > filters.createdUntil) {
    throw new Error('createdSince cannot be after createdUntil.');
  }
  return filters;
}

function matchesListTimeFilters(entry, filters) {
  const updated = Date.parse(entry.updated_at);
  const created = Date.parse(entry.created_at);
  if (filters.updatedSince !== undefined && updated < filters.updatedSince) return false;
  if (filters.updatedUntil !== undefined && updated > filters.updatedUntil) return false;
  if (filters.createdSince !== undefined && created < filters.createdSince) return false;
  if (filters.createdUntil !== undefined && created > filters.createdUntil) return false;
  return true;
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
