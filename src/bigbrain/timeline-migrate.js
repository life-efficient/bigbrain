import fs from 'node:fs/promises';
import path from 'node:path';

import { parseMarkdownPage, replaceTimelineSection } from './markdown.js';
import {
  legacyTimelineEntryId,
  parseTimeline,
  renderTimelineBlock,
  sortTimelineEntries,
} from './timeline.js';

export async function migrateTimelinePages({
  config,
  apply = false,
  limit = 50,
  pagePath = null,
  type = null,
} = {}) {
  const normalizedLimit = normalizeLimit(limit);
  const files = await walkMarkdownFiles(config.brainDir);
  const report = {
    mode: apply ? 'apply' : 'dry-run',
    scanned: 0,
    candidates: 0,
    migrated: 0,
    unchanged: 0,
    skipped: [],
    changes: [],
  };

  for (const file of files) {
    const slug = file.relative.replace(/\.md$/i, '');
    if (pagePath && slug !== normalizePagePath(pagePath)) continue;
    const raw = await fs.readFile(file.fullPath, 'utf8');
    const parsed = parseMarkdownPage(raw, slug);
    report.scanned += 1;
    if (type && parsed.type !== type) continue;
    if (!parsed.timeline.trim()) continue;

    const timeline = parseTimeline(parsed.timeline);
    if (!timeline.entries.length) {
      report.skipped.push({ path: file.relative, reason: 'no_recognized_entries' });
      continue;
    }
    if (!timeline.clean) {
      report.skipped.push({ path: file.relative, reason: 'timeline_contains_unrecognized_content' });
      continue;
    }

    const entries = sortTimelineEntries(timeline.entries.map((entry, index) => ({
      ...entry,
      entry_id: entry.entry_id || legacyTimelineEntryId(slug, entry, index),
      recorded_at: entry._includeMetadata ? entry.recorded_at : null,
      provenance: entry.provenance || null,
      significance: entry.significance || null,
      _includeMetadata: true,
      _order: index,
    })));
    const timelineBlock = renderTimelineBlock(entries, { includeMetadata: true });
    const migrated = replaceTimelineSection(raw, timelineBlock);
    if (migrated === raw) {
      report.unchanged += 1;
      continue;
    }

    report.candidates += 1;
    if (report.changes.length < normalizedLimit) {
      report.changes.push({
        path: file.relative,
        entries: entries.length,
        legacy_entries: timeline.entries.filter((entry) => !entry._includeMetadata).length,
        order_changed: timeline.order_changed,
        before_first_date: timeline.original_entries[0]?.occurred_at || null,
        after_first_date: entries[0]?.occurred_at || null,
      });
    }
    if (apply && report.migrated < normalizedLimit) {
      await fs.writeFile(file.fullPath, migrated, 'utf8');
      report.migrated += 1;
    }
  }

  if (!apply && report.candidates > normalizedLimit) {
    report.changes = report.changes.slice(0, normalizedLimit);
  }
  report.remaining_candidates = Math.max(0, report.candidates - (apply ? report.migrated : report.changes.length));
  return report;
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
