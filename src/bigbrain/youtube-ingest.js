import { slugify } from './event-ingestor.js';

const PLACEHOLDER_METADATA = new Set([
  'n/a',
  'na',
  'missing',
  'none',
  'null',
  'tbd',
  'unknown',
  'undefined',
  'untitled',
]);

const TIMESTAMP_LINE = /^\s*((?:(\d{1,2}):)?(\d{1,2}):(\d{2}))\s*[-–—]\s*(.+?)\s*$/u;
const TIMESTAMP_HEADER = /^\s*(?:timestamps?|chapters?)\s*:?\s*$/iu;

export function validateYouTubeMetadata(metadata = {}) {
  const youtubeId = requiredMetadataValue(metadata.youtube_id ?? metadata.id, 'YouTube video ID');
  const youtubeTitle = requiredMetadataValue(metadata.youtube_title ?? metadata.title, 'exact YouTube video title');
  const channel = resolvedChannel(metadata);

  assertNoConflictingMetadata(metadata.youtube_title, metadata.title, 'YouTube video title');
  assertNoConflictingMetadata(metadata.channel, metadata.uploader, 'YouTube channel name');

  return {
    youtubeId,
    youtubeTitle,
    channel,
  };
}

export function buildYouTubeIdentity(metadata, { disambiguator = '' } = {}) {
  const { youtubeId, youtubeTitle, channel } = validateYouTubeMetadata(metadata);
  const titleSlug = slugify(youtubeTitle, 'untitled');
  const channelSlug = slugify(channel, 'channel');
  const idSlug = disambiguator ? slugify(disambiguator, youtubeId.slice(0, 8).toLowerCase()) : '';
  const basename = idSlug
    ? `${titleSlug}-${idSlug}-${channelSlug}`
    : `${titleSlug}-${channelSlug}`;

  return {
    youtubeId,
    youtubeTitle,
    channel,
    displayTitle: `${youtubeTitle} - ${channel}`,
    basename,
  };
}

export function parseYouTubeChapters(description = '') {
  const lines = String(description || '').split(/\r?\n/);
  const chapters = [];
  let inChapterBlock = false;
  let foundChapter = false;

  for (const line of lines) {
    if (!inChapterBlock && TIMESTAMP_HEADER.test(line)) {
      inChapterBlock = true;
      continue;
    }
    if (!inChapterBlock) continue;

    const match = line.match(TIMESTAMP_LINE);
    if (match) {
      const [, timestamp, hours, minutes, seconds, label] = match;
      chapters.push({
        timestamp,
        label,
        startSeconds: (Number(hours || 0) * 60 * 60) + (Number(minutes) * 60) + Number(seconds),
        heading: `${timestamp} - ${label}`,
      });
      foundChapter = true;
      continue;
    }

    if (!foundChapter && !line.trim()) continue;
    if (foundChapter && !line.trim()) continue;
    break;
  }

  assertChapterOrdering(chapters);
  return chapters;
}

export function findYouTubeRecordById(records = [], youtubeId) {
  const normalizedId = requiredMetadataValue(youtubeId, 'YouTube video ID');
  const matches = records.filter((record) => recordYouTubeId(record) === normalizedId);
  if (matches.length > 1) {
    throw new Error(`Multiple existing Brain records use YouTube video ID ${normalizedId}. Read and resolve the duplicates before writing.`);
  }
  return matches[0] || null;
}

export function assertExistingYouTubeRecordCompatible(record, identity) {
  if (!record) return;
  const existingTitle = record.youtube_title ?? record.youtubeTitle ?? record.frontmatter?.youtube_title;
  const existingChannel = record.channel ?? record.frontmatter?.channel;
  if (existingTitle && existingTitle !== identity.youtubeTitle) {
    throw new Error(`Existing YouTube record ${identity.youtubeId} has a conflicting exact title. Stop before writing.`);
  }
  if (existingChannel && existingChannel !== identity.channel) {
    throw new Error(`Existing YouTube record ${identity.youtubeId} has a conflicting channel. Stop before writing.`);
  }
}

export function extractPrimaryChapterHeadings(markdown, { level = 3 } = {}) {
  const headingPattern = new RegExp(`^#{${level}}\\s+(.+?)\\s*$`, 'gmu');
  return [...String(markdown || '').matchAll(headingPattern)].map((match) => match[1]);
}

export function validateYouTubeSidecar({ metadata, description = '', frontmatter = {}, body = '', existingRecords = [] } = {}) {
  const identity = buildYouTubeIdentity(metadata);
  const existingRecord = findYouTubeRecordById(existingRecords, identity.youtubeId);
  assertExistingYouTubeRecordCompatible(existingRecord, identity);

  assertEqual(frontmatter.youtube_id, identity.youtubeId, 'frontmatter.youtube_id');
  assertEqual(frontmatter.youtube_title, identity.youtubeTitle, 'frontmatter.youtube_title');
  assertEqual(frontmatter.channel, identity.channel, 'frontmatter.channel');
  assertEqual(frontmatter.title, identity.displayTitle, 'frontmatter.title');
  const h1 = String(body || '').match(/^#\s+(.+?)\s*$/mu)?.[1];
  assertEqual(h1, identity.displayTitle, 'sidecar H1');

  const chapters = parseYouTubeChapters(description);
  const actualHeadings = extractPrimaryChapterHeadings(body);
  if (chapters.length) {
    const expectedHeadings = chapters.map((chapter) => chapter.heading);
    if (JSON.stringify(actualHeadings) !== JSON.stringify(expectedHeadings)) {
      throw new Error('Sidecar primary headings must preserve every YouTube chapter label and its order exactly.');
    }
  } else if (frontmatter.chapter_source !== 'none') {
    throw new Error('Sidecar must declare chapter_source: none when YouTube provides no chapters.');
  }

  return { identity, chapters, existingRecord };
}

function resolvedChannel(metadata) {
  return requiredMetadataValue(metadata.channel ?? metadata.uploader, 'exact YouTube channel name');
}

function recordYouTubeId(record) {
  return String(record?.youtube_id ?? record?.youtubeId ?? record?.frontmatter?.youtube_id ?? '').trim();
}

function requiredMetadataValue(value, fieldName) {
  const raw = String(value ?? '');
  const normalized = raw.trim();
  if (!normalized || PLACEHOLDER_METADATA.has(normalized.toLowerCase())) {
    throw new Error(`Cannot ingest YouTube source without ${fieldName}. Stop before writing.`);
  }
  if (raw !== normalized || /[\r\n]/u.test(raw)) {
    throw new Error(`${fieldName} metadata must be preserved as one exact line. Stop before writing.`);
  }
  return raw;
}

function assertNoConflictingMetadata(primary, secondary, fieldName) {
  if (primary == null || secondary == null) return;
  const first = String(primary);
  const second = String(secondary);
  if (first && second && first !== second) {
    throw new Error(`Conflicting ${fieldName} metadata was returned. Stop before writing.`);
  }
}

function assertChapterOrdering(chapters) {
  for (let index = 1; index < chapters.length; index += 1) {
    if (chapters[index].startSeconds <= chapters[index - 1].startSeconds) {
      throw new Error('YouTube chapters must be in strictly increasing timestamp order.');
    }
  }
}

function assertEqual(actual, expected, fieldName) {
  if (actual !== expected) {
    throw new Error(`${fieldName} must preserve the exact source value.`);
  }
}
