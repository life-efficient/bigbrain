import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseMarkdownPage } from '../../src/bigbrain/markdown.js';
import { migrateTimelinePages } from '../../src/bigbrain/timeline-migrate.js';
import {
  appendTimelineEntries,
  formatTimelineEntries,
  latestTimelineEntry,
  parseTimeline,
} from '../../src/bigbrain/timeline.js';

test('structured timeline entries sort by occurred_at and retain per-entry provenance', () => {
  const timeline = formatTimelineEntries([
    {
      date: '2026-05-01',
      text: 'Older event.',
      provenance: { event_id: 'evt-old', source_type: 'gmail', source_label: 'Old thread' },
    },
    {
      occurred_at: '2026-06-15T10:30:00Z',
      text: 'Newer event.',
      provenance: {
        event_id: 'evt-new',
        source_type: 'whatsapp',
        source_label: 'Harry chat',
        source_message: 'Can you send the revised proposal tomorrow?',
        source_url: 'https://example.test/event',
      },
      significance: 'minor',
    },
  ]);

  const parsed = parseTimeline(timeline);
  assert.equal(parsed.clean, true);
  assert.deepEqual(parsed.entries.map((entry) => entry.occurred_at), ['2026-06-15T10:30:00Z', '2026-05-01']);
  assert.equal(parsed.entries[0].provenance.event_id, 'evt-new');
  assert.equal(parsed.entries[0].provenance.source_message, 'Can you send the revised proposal tomorrow?');
  assert.equal(parsed.entries[0].significance, 'minor');
  assert.equal(latestTimelineEntry(parsed.entries).display, '2026-06-15 | Newer event.');
});

test('legacy timeline bullets remain readable while new historical entries are inserted in order', () => {
  const legacy = [
    '## Timeline',
    '',
    '- **2026-05-01** | Oldest.',
    '- **2026-06-01** | Newest.',
  ].join('\n');
  const updated = appendTimelineEntries(legacy, {
    date: '2026-05-15',
    text: 'Historical event received later.',
    provenance: { event_id: 'evt-historical', source_type: 'gmail', source_label: 'Backfill' },
  }, { recordedAt: '2026-09-01T12:00:00.000Z' });
  const parsed = parseTimeline(updated);
  assert.deepEqual(parsed.entries.map((entry) => entry.occurred_at), ['2026-06-01', '2026-05-15', '2026-05-01']);
  assert.match(updated, /bigbrain:timeline/);
  assert.equal(parsed.entries[1].recorded_at, '2026-09-01T12:00:00.000Z');
});

test('timeline migration is dry-run by default, bounded, and skips unsafe sections', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-timeline-migrate-'));
  try {
    await fs.mkdir(path.join(root, 'people'), { recursive: true });
    await fs.writeFile(path.join(root, 'people', 'alice.md'), [
      '---',
      'title: Alice',
      '---',
      '',
      '# Alice',
      '',
      'Current context.',
      '',
      '---',
      '',
      '## Timeline',
      '',
      '- **2026-04-01** | April.',
      '- **2026-05-01** | May.',
      '',
    ].join('\n'), 'utf8');
    await fs.writeFile(path.join(root, 'people', 'unsafe.md'), [
      '---',
      'title: Unsafe',
      '---',
      '',
      '# Unsafe',
      '',
      'Current context.',
      '',
      '---',
      '',
      '## Timeline',
      '',
      '- **2026-04-01** | April.',
      '',
      '## Notes',
      '',
      '- This is not timeline evidence.',
      '',
    ].join('\n'), 'utf8');

    const config = { brainDir: root };
    const dryRun = await migrateTimelinePages({ config, limit: 1 });
    assert.equal(dryRun.mode, 'dry-run');
    assert.equal(dryRun.candidates, 1);
    assert.equal(dryRun.changes.length, 1);
    assert.equal(dryRun.migrated, 0);
    assert.equal((await fs.readFile(path.join(root, 'people', 'alice.md'), 'utf8')).includes('bigbrain:timeline'), false);
    assert.ok(dryRun.skipped.some((item) => item.path === 'people/unsafe.md'));

    const applied = await migrateTimelinePages({ config, apply: true, limit: 1 });
    assert.equal(applied.migrated, 1);
    const migrated = await fs.readFile(path.join(root, 'people', 'alice.md'), 'utf8');
    assert.match(migrated, /## Timeline\n\n- \*\*2026-05-01\*\*/);
    assert.match(migrated, /bigbrain:timeline/);
    const parsed = parseMarkdownPage(migrated, 'people/alice');
    assert.deepEqual(parsed.timeline_entries.map((entry) => entry.occurred_at), ['2026-05-01', '2026-04-01']);
    assert.equal(parsed.timeline_entries[0].recorded_at, null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
