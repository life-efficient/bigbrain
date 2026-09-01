import fs from 'node:fs/promises';
import path from 'node:path';

import { parseMarkdownPage } from './markdown.js';
import {
  legacyTimelineEntryId,
  normalizeTimelineEntry,
  renderTimelineBlock,
  sortTimelineEntries,
  TIMELINE_SCHEMA_VERSION,
} from './timeline.js';

const TIMELINE_BOUNDARY_PATTERN = /\n---\n(?=\s*##\s+(?:Timeline|History)\b)|\n<!--\s*timeline\s*-->\s*/gi;
const TIMELINE_HEADING_RE = /^\s*##\s+Timeline\s*$/i;
const STRUCTURAL_SEPARATOR_RE = /^\s*---\s*$/;
const TIMELINE_METADATA_RE = /^\s*<!--\s*bigbrain:timeline\s+(\{[\s\S]*\})\s*-->\s*$/i;
const LEGACY_EVENT_RE = /^\s*-\s+\*\*((?:\d{4}-\d{2}-\d{2})|(?:\d{4}-(?:early|mid|late)))\*\*\s*(\||:|—)\s*(.*?)\s*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function repairTimelinePages({
  config,
  apply = false,
  limit = 50,
  pagePaths = null,
  sourceOnlyPaths = [],
} = {}) {
  const normalizedLimit = normalizeLimit(limit);
  const files = await walkMarkdownFiles(config.brainDir);
  const requested = pagePaths ? new Set(pagePaths.map(normalizePagePath)) : null;
  const sourceOnly = new Set(sourceOnlyPaths.map(normalizePagePath));
  const report = {
    mode: apply ? 'apply' : 'dry-run',
    scanned: 0,
    repairable: 0,
    repaired: 0,
    unchanged: 0,
    skipped: [],
    changes: [],
  };

  for (const file of files) {
    const slug = file.relative.replace(/\.md$/i, '');
    if (requested && !requested.has(slug)) continue;
    const raw = await fs.readFile(file.fullPath, 'utf8');
    const result = repairTimelinePage(raw, slug, {
      preserveMode: sourceOnly.has(slug) ? 'source-only' : 'auto',
    });
    report.scanned += 1;
    if (result.reason) {
      report.skipped.push({ path: file.relative, reason: result.reason });
      continue;
    }
    if (!result.changed) {
      report.unchanged += 1;
      continue;
    }
    report.repairable += 1;
    if (report.changes.length < normalizedLimit) {
      report.changes.push({
        path: file.relative,
        entries: result.entries,
        duplicate_entries_removed: result.duplicateEntriesRemoved,
        preserved_content: Boolean(result.preservedContent),
      });
    }
    if (apply && report.repaired < normalizedLimit) {
      await fs.writeFile(file.fullPath, result.markdown, 'utf8');
      report.repaired += 1;
    }
  }

  report.remaining_repairable = Math.max(0, report.repairable - (apply ? report.repaired : report.changes.length));
  return report;
}

export function repairTimelinePage(markdown, slug, { preserveMode = 'auto' } = {}) {
  const parsed = parseMarkdownPage(markdown, slug);
  if (!parsed.hasSeparator || !parsed.timeline.trim()) return { changed: false, reason: 'no_timeline' };

  const collected = collectTimelineEntries(parsed.timeline);
  const normalized = dedupeTimelineEntries(collected.entries, slug);
  const preservedContent = preserveContent(collected.remainingLines, preserveMode);
  if (!normalized.length && !preservedContent) return { changed: false, reason: 'no_entries_or_content' };

  const entries = sortTimelineEntries(normalized.map((entry, index) => ({
    ...entry,
    entry_id: entry.entry_id || legacyTimelineEntryId(slug, entry, index),
    recorded_at: entry.recorded_at ?? null,
    provenance: entry.provenance || null,
    significance: entry.significance || null,
    _includeMetadata: true,
    _order: index,
  })));
  const timelineBlock = renderTimelineBlock(entries, { includeMetadata: true });
  const repaired = replaceTimelineTail(markdown, timelineBlock, preservedContent);
  return {
    changed: repaired !== markdown,
    markdown: repaired,
    entries: entries.length,
    duplicateEntriesRemoved: collected.entries.length - normalized.length,
    preservedContent,
  };
}

function collectTimelineEntries(rawTimeline) {
  const lines = String(rawTimeline || '').split(/\r?\n/);
  const remaining = [...lines];
  const entries = [];
  let current = null;

  const flush = () => {
    if (current) entries.push(current);
    current = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const event = line.match(LEGACY_EVENT_RE);
    if (event) {
      flush();
      const label = event[1];
      current = {
        occurred_at: DATE_RE.test(label) ? label : null,
        occurred_label: DATE_RE.test(label) ? null : label,
        recorded_at: null,
        text: event[3].trim(),
        provenance: null,
        significance: null,
        entry_id: null,
        _metadata: false,
      };
      remaining[index] = null;
      continue;
    }

    const metadata = line.match(TIMELINE_METADATA_RE);
    if (metadata && current) {
      if (applyMetadata(current, metadata[1])) {
        current._metadata = true;
        remaining[index] = null;
      }
      continue;
    }

    if (current && isContinuationLine(line)) {
      current.text = `${current.text} ${line.trim()}`.trim();
      remaining[index] = null;
      continue;
    }

    flush();
    if (TIMELINE_HEADING_RE.test(line) || STRUCTURAL_SEPARATOR_RE.test(line)) remaining[index] = null;
  }
  flush();

  return {
    entries,
    remainingLines: remaining,
  };
}

function applyMetadata(entry, rawMetadata) {
  try {
    const metadata = JSON.parse(rawMetadata);
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
    if (metadata.schema_version !== TIMELINE_SCHEMA_VERSION) return false;
    if (metadata.entry_id) entry.entry_id = String(metadata.entry_id).trim();
    if (metadata.occurred_at !== undefined) entry.occurred_at = metadata.occurred_at;
    if (metadata.occurred_label !== undefined) entry.occurred_label = metadata.occurred_label;
    if (metadata.recorded_at !== undefined) entry.recorded_at = metadata.recorded_at;
    if (metadata.provenance !== undefined) entry.provenance = metadata.provenance;
    if (metadata.significance !== undefined) entry.significance = metadata.significance;
    return true;
  } catch {
    return false;
  }
}

function isContinuationLine(line) {
  const value = String(line || '');
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (!/^\s{2,}\S/.test(value)) return false;
  if (TIMELINE_HEADING_RE.test(value) || STRUCTURAL_SEPARATOR_RE.test(value)) return false;
  if (/^\s*[-*]\s+/.test(value)) return false;
  if (/^\s*<!--/.test(value)) return false;
  return true;
}

function dedupeTimelineEntries(entries, slug) {
  const seen = new Map();
  for (const [index, input] of entries.entries()) {
    const entry = normalizeTimelineEntry(input, {
      recordedAt: null,
      fallbackOccurredAt: null,
      index,
      includeMetadata: true,
    });
    const key = entry.entry_id
      ? `id:${entry.entry_id}`
      : `value:${entry.occurred_at || entry.occurred_label || ''}\n${entry.text}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, entry);
      continue;
    }
    if ((!existing.provenance && entry.provenance) || (!existing.entry_id && entry.entry_id)) {
      seen.set(key, { ...existing, ...entry, text: existing.text.length >= entry.text.length ? existing.text : entry.text });
    }
  }
  return [...seen.values()].map((entry, index) => ({ ...entry, _order: index }));
}

function preserveContent(lines, mode) {
  const cleaned = lines
    .filter((line) => line !== null)
    .filter((line) => !STRUCTURAL_SEPARATOR_RE.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!cleaned || mode === 'none') return '';
  if (mode === 'source-only') return extractSections(cleaned, /^##\s+Source File\s*$/im);

  const headings = [...cleaned.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim().toLowerCase());
  if (!headings.length || headings.every((heading) => ['source file', 'sources', 'open questions'].includes(heading))) return cleaned;
  if (/^\[[^\n]+\]\([^\n]+\)$/m.test(cleaned) && !headings.length) return cleaned;
  return `## Legacy Notes\n\n${cleaned.replace(/^##\s+/gm, '### ')}`;
}

function extractSections(text, headingPattern) {
  const matches = [...String(text || '').matchAll(/^##\s+.+$/gm)];
  const blocks = [];
  for (let index = 0; index < matches.length; index += 1) {
    const heading = matches[index][0];
    if (!headingPattern.test(heading)) continue;
    const end = matches[index + 1]?.index ?? text.length;
    blocks.push(text.slice(matches[index].index, end).trim());
  }
  return blocks.join('\n\n');
}

function replaceTimelineTail(markdown, timelineBlock, preservedContent) {
  const match = [...String(markdown).matchAll(TIMELINE_BOUNDARY_PATTERN)][0];
  if (!match) throw new Error('Cannot repair timeline without a timeline boundary.');
  const beforeBoundary = String(markdown).slice(0, match.index).replace(/\n+$/, '');
  const boundary = match[0];
  const prefix = preservedContent
    ? `${beforeBoundary}\n\n${preservedContent}`
    : beforeBoundary;
  return `${prefix}${boundary}\n${timelineBlock.trim()}\n`;
}

async function walkMarkdownFiles(rootDir, relativeDir = '', files = []) {
  const current = path.join(rootDir, relativeDir);
  const entries = await fs.readdir(current, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    if (['.git', '.bigbrain', '.bigbrain-state', 'node_modules'].includes(entry.name)) continue;
    const relative = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
    if (entry.isDirectory()) {
      await walkMarkdownFiles(rootDir, relative, files);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const normalized = relative.split(path.sep).join('/');
      if (!['readme.md', 'filing.md'].includes(entry.name.toLowerCase())) files.push({ fullPath: path.join(rootDir, relative), relative: normalized });
    }
  }
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

function normalizePagePath(value) {
  return String(value || '').trim().replace(/^\/+/, '').replace(/\.md$/i, '');
}

function normalizeLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return 50;
  return Math.min(Math.floor(number), 1000);
}
