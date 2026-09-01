import crypto from 'node:crypto';

import { TIMELINE_SIGNIFICANCE_VALUES } from './source-taxonomy.js';

export const TIMELINE_SCHEMA_VERSION = 1;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const TIMELINE_METADATA_RE = /^\s*<!--\s*bigbrain:timeline\s+(\{[\s\S]*\})\s*-->\s*$/i;
const TIMELINE_HEADING_RE = /^\s*##\s+Timeline\s*$/i;
const PROVENANCE_KEYS = [
  'event_id',
  'origin_id',
  'listener_id',
  'source_type',
  'source_label',
  'source_icon',
  'source_url',
  'occurred_at',
  'received_at',
  'codex_execution_id',
  'codex_thread_id',
  'raw_ref',
  'outcome',
  'commit_message',
];

export function parseTimeline(timeline) {
  if (Array.isArray(timeline)) {
    const entries = timeline.map((entry, index) => normalizeTimelineEntry(entry, {
      index,
      includeMetadata: true,
    }));
    const sorted = sortTimelineEntries(entries);
    return {
      entries: sorted,
      original_entries: entries,
      order_changed: timelineOrderChanged(entries, sorted),
      clean: true,
      hasMetadata: entries.some((entry) => entry._includeMetadata),
      source: 'structured',
    };
  }

  const raw = stripTimelineHeading(String(timeline || ''));
  if (!raw) return { entries: [], original_entries: [], order_changed: false, clean: true, hasMetadata: false, source: 'empty' };

  const entries = [];
  let clean = true;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const metadataMatch = line.match(TIMELINE_METADATA_RE);
    if (metadataMatch) {
      if (!entries.length) {
        clean = false;
        continue;
      }
      try {
        const metadata = JSON.parse(metadataMatch[1]);
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('metadata must be an object');
        applyTimelineMetadata(entries.at(-1), metadata);
      } catch {
        clean = false;
      }
      continue;
    }

    const visible = parseVisibleTimelineLine(line);
    if (!visible) {
      clean = false;
      continue;
    }
    const entry = normalizeTimelineEntry(visible, { index: entries.length, recordedAt: null, includeMetadata: false });
    entries.push(entry);
  }
  const sorted = sortTimelineEntries(entries);
  return {
    entries: sorted,
    original_entries: entries,
    order_changed: timelineOrderChanged(entries, sorted),
    clean,
    hasMetadata: entries.some((entry) => entry._includeMetadata),
    source: 'markdown',
  };
}

export function normalizeTimelineEntry(input, {
  recordedAt = new Date().toISOString(),
  fallbackOccurredAt = recordedAt,
  index = 0,
  significance = null,
  includeMetadata = typeof input === 'object' && input !== null,
} = {}) {
  const value = typeof input === 'string'
    ? parseVisibleTimelineLine(input) || { text: input }
    : input && typeof input === 'object'
      ? input
      : null;
  if (!value) throw new Error('Timeline entry must be a string or object.');

  const text = String(value.text ?? value.entry ?? value.timeline_entry ?? '').trim();
  if (!text) throw new Error('Timeline entry text is required.');

  const rawOccurredAt = value.occurred_at ?? value.timestamp ?? value.date ?? fallbackOccurredAt;
  const occurredAt = normalizeOccurredAt(rawOccurredAt, 'occurred_at');
  const rawRecordedAt = Object.prototype.hasOwnProperty.call(value, 'recorded_at') ? value.recorded_at : recordedAt;
  const normalizedRecordedAt = rawRecordedAt === null ? null : normalizeTimestamp(rawRecordedAt, 'recorded_at');
  const provenance = normalizeTimelineProvenance(value.provenance);
  const entrySignificance = value.significance ?? provenance?.significance ?? significance ?? null;
  if (entrySignificance !== null && !TIMELINE_SIGNIFICANCE_VALUES.includes(entrySignificance)) {
    throw new Error(`Timeline significance must be one of: ${TIMELINE_SIGNIFICANCE_VALUES.join(', ')}.`);
  }
  const eventId = provenance?.event_id || null;
  return {
    schema_version: TIMELINE_SCHEMA_VERSION,
    entry_id: value.entry_id ? String(value.entry_id).trim() : eventId || null,
    occurred_at: occurredAt,
    recorded_at: normalizedRecordedAt,
    text,
    provenance,
    significance: entrySignificance,
    _includeMetadata: Boolean(includeMetadata),
    _order: index,
  };
}

export function normalizeTimelineProvenance(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Timeline provenance must be an object.');
  const normalized = {};
  for (const key of PROVENANCE_KEYS) {
    if (value[key] !== undefined && value[key] !== null && String(value[key]).trim() !== '') normalized[key] = value[key];
  }
  return Object.keys(normalized).length ? normalized : null;
}

export function sortTimelineEntries(entries) {
  return [...entries]
    .map((entry, index) => ({ ...entry, _order: Number.isFinite(entry?._order) ? entry._order : index }))
    .sort((a, b) => timelineSortValue(b) - timelineSortValue(a) || a._order - b._order);
}

export function formatTimelineEntries(input, {
  recordedAt = new Date().toISOString(),
  significance = null,
  includeMetadata = false,
} = {}) {
  const values = Array.isArray(input) ? input : [input];
  const entries = values.map((value, index) => normalizeTimelineEntry(value, {
    recordedAt,
    significance,
    index,
    includeMetadata: includeMetadata || typeof value === 'object',
  }));
  return renderTimelineEntries(sortTimelineEntries(entries), { includeMetadata });
}

export function renderTimelineEntries(entries, { includeMetadata = false } = {}) {
  return sortTimelineEntries(entries).map((entry) => {
    const normalized = normalizeTimelineEntry(entry, {
      recordedAt: entry.recorded_at || new Date().toISOString(),
      fallbackOccurredAt: entry.occurred_at,
      index: entry._order,
      includeMetadata: entry._includeMetadata,
    });
    const date = timelineDisplayDate(normalized.occurred_at);
    const line = `- **${date}** | ${normalized.text}`;
    if (!includeMetadata && !normalized._includeMetadata) return line;
    return `${line}\n  <!-- bigbrain:timeline ${JSON.stringify(timelineMetadata(normalized))} -->`;
  }).join('\n');
}

export function renderTimelineBlock(entries, options = {}) {
  return ['## Timeline', '', renderTimelineEntries(entries, options)].filter((value, index) => value || index === 0).join('\n');
}

export function appendTimelineEntries(timeline, input, {
  recordedAt = new Date().toISOString(),
  significance = null,
} = {}) {
  const parsed = parseTimeline(timeline);
  const values = Array.isArray(input) ? input : [input];
  const additions = values.map((value, index) => normalizeTimelineEntry(value, {
    recordedAt,
    significance,
    index: parsed.entries.length + index,
    includeMetadata: typeof value === 'object' || Boolean(normalizeTimelineProvenance(value?.provenance)),
  }));

  if (!parsed.clean) {
    const existing = stripTimelineHeading(String(timeline || ''));
    return [existing, renderTimelineEntries(additions, { includeMetadata: true })].filter(Boolean).join('\n');
  }

  const existingKeys = new Set(parsed.entries
    .filter((entry) => entry.entry_id)
    .map((entry) => `${entry.entry_id}\n${entry.text}`));
  const uniqueAdditions = additions.filter((entry) => !entry.entry_id || !existingKeys.has(`${entry.entry_id}\n${entry.text}`));
  return renderTimelineEntries([...parsed.entries, ...uniqueAdditions]);
}

export function timelineText(input) {
  if (Array.isArray(input)) return input.map((entry) => timelineText(entry)).filter(Boolean).join(' ');
  if (input && typeof input === 'object') return String(input.text ?? input.entry ?? input.timeline_entry ?? '').trim();
  return String(input || '').trim();
}

export function latestTimelineEntry(input) {
  const entries = Array.isArray(input) ? input : parseTimeline(input).entries;
  const sorted = sortTimelineEntries(entries);
  const entry = sorted[0];
  if (!entry) return null;
  return {
    ...entry,
    display: `${timelineDisplayDate(entry.occurred_at)} | ${entry.text}`,
  };
}

export function latestTimelineDate(input) {
  const entry = latestTimelineEntry(input);
  if (!entry?.occurred_at) return null;
  const day = timelineDisplayDate(entry.occurred_at);
  return `${day}T00:00:00.000Z`;
}

export function legacyTimelineEntryId(slug, entry, index) {
  const digest = crypto.createHash('sha256')
    .update(`${slug}\n${index}\n${entry.occurred_at}\n${entry.text}`)
    .digest('hex')
    .slice(0, 20);
  return `legacy:${digest}`;
}

export function isTimelineEntryMetadataLine(line) {
  return TIMELINE_METADATA_RE.test(String(line || ''));
}

function applyTimelineMetadata(entry, metadata) {
  if (metadata.schema_version !== TIMELINE_SCHEMA_VERSION) throw new Error('Unsupported timeline metadata schema version.');
  if (metadata.entry_id) entry.entry_id = String(metadata.entry_id).trim();
  if (metadata.occurred_at !== undefined) entry.occurred_at = normalizeOccurredAt(metadata.occurred_at, 'occurred_at');
  if (metadata.recorded_at !== undefined) entry.recorded_at = metadata.recorded_at === null ? null : normalizeTimestamp(metadata.recorded_at, 'recorded_at');
  if (metadata.provenance !== undefined) entry.provenance = normalizeTimelineProvenance(metadata.provenance);
  if (metadata.significance !== undefined && metadata.significance !== null) {
    if (!TIMELINE_SIGNIFICANCE_VALUES.includes(metadata.significance)) throw new Error('Unsupported timeline significance.');
    entry.significance = metadata.significance;
  }
  entry._includeMetadata = true;
}

function timelineMetadata(entry) {
  return {
    schema_version: TIMELINE_SCHEMA_VERSION,
    entry_id: entry.entry_id,
    occurred_at: entry.occurred_at,
    recorded_at: entry.recorded_at,
    text: entry.text,
    provenance: entry.provenance,
    significance: entry.significance,
  };
}

function parseVisibleTimelineLine(line) {
  const match = String(line || '').match(/^\s*-\s+(?:\*\*)?(\d{4}-\d{2}-\d{2})(?:\*\*)?\s*\|\s*(.*?)\s*$/);
  if (!match || !match[2]) return null;
  return { date: match[1], text: match[2] };
}

function stripTimelineHeading(value) {
  return String(value || '').trim().replace(/^##\s+(?:Timeline|History)\s*/i, '').trim();
}

function normalizeOccurredAt(value, name) {
  const text = String(value || '').trim();
  if (DATE_RE.test(text)) return text;
  if (TIMESTAMP_RE.test(text)) return text;
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) throw new Error(`${name} must be YYYY-MM-DD or an ISO timestamp.`);
  return date.toISOString();
}

function normalizeTimestamp(value, name) {
  const text = String(value || '').trim();
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) throw new Error(`${name} must be an ISO timestamp.`);
  return date.toISOString();
}

function timelineSortValue(entry) {
  if (!entry?.occurred_at) return Number.NEGATIVE_INFINITY;
  const value = DATE_RE.test(entry.occurred_at)
    ? Date.parse(`${entry.occurred_at}T00:00:00.000Z`)
    : Date.parse(entry.occurred_at);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function timelineOrderChanged(original, sorted) {
  return original.some((entry, index) => {
    const next = sorted[index];
    return !next
      || entry.entry_id !== next.entry_id
      || entry.occurred_at !== next.occurred_at
      || entry.text !== next.text;
  });
}

function timelineDisplayDate(value) {
  const text = String(value || '');
  return DATE_RE.test(text) ? text : text.slice(0, 10);
}
