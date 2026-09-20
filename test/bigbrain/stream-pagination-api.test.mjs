import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { openDatabase, upsertSharedGroup } from '../../src/bigbrain/db.js';
import { buildRecentsPayload, recordDashboardPageView } from '../../src/bigbrain/dashboard.js';
import { SOURCE_TYPE_DEFINITIONS } from '../../src/bigbrain/source-taxonomy.js';
import { syncBrain } from '../../src/bigbrain/sync.js';

test('Stream paginates pages and images after activity and collection filtering', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-stream-pagination-'));
  let db;
  try {
    const brainHome = path.join(rootDir, 'brain-home');
    const init = await initializeBrainHome(brainHome, {
      env: {
        ...process.env,
        BIGBRAIN_POINTER_PATH: path.join(rootDir, 'pointer'),
        BIGBRAIN_STATE_ROOT: path.join(rootDir, 'state-root'),
      },
    });
    for (let index = 1; index <= 6; index += 1) {
      const pagePath = path.join(brainHome, 'projects', `page-${index}.md`);
      const imagePath = path.join(brainHome, 'projects', '.raw', `page-${index}.png`);
      await fs.mkdir(path.dirname(imagePath), { recursive: true });
      await fs.writeFile(pagePath, `---\ntitle: Page ${index}\ncreated_at: 2026-01-0${7 - index}\nimages: [{"path":"projects/.raw/page-${index}.png"}]\n---\n# Page ${index}\n`);
      await fs.writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const modified = new Date(`2026-02-0${index}T00:00:00Z`);
      await fs.utimes(pagePath, modified, modified);
      await fs.utimes(imagePath, modified, modified);
    }
    const config = await loadConfig({ configPath: init.configPath });
    await syncBrain({ config, apiKey: null });
    db = await openDatabase(config);
    await upsertSharedGroup(db, {
      slug: 'selected-pages',
      title: 'Selected Pages',
      pages: ['projects/page-2', 'projects/page-3', 'projects/page-4', 'projects/page-5'],
    });
    for (const index of [2, 4, 6]) {
      await recordDashboardPageView(db, `projects/page-${index}`, {
        now: new Date(`2026-03-0${index}T00:00:00Z`),
      });
    }

    const query = (params) => new URL(`/api/recents?${new URLSearchParams({ limit: '2', ...params })}`, 'http://127.0.0.1');
    const first = await buildRecentsPayload(config, db, query({ activity: 'updated', kind: 'pages' }));
    const second = await buildRecentsPayload(config, db, query({ activity: 'updated', kind: 'pages', offset: first.meta.next_offset }));
    const third = await buildRecentsPayload(config, db, query({ activity: 'updated', kind: 'pages', offset: second.meta.next_offset }));
    assert.deepEqual([first, second, third].flatMap((page) => page.items.map((item) => item.slug)), [
      'projects/page-6', 'projects/page-5', 'projects/page-4',
      'projects/page-3', 'projects/page-2', 'projects/page-1',
    ]);
    assert.deepEqual([first.meta.offset, second.meta.offset, third.meta.offset], [0, 2, 4]);
    assert.deepEqual([first.meta.has_more, second.meta.has_more, third.meta.has_more], [true, true, false]);
    assert.deepEqual([first.meta.next_offset, second.meta.next_offset, third.meta.next_offset], [2, 4, null]);
    assert.equal(first.meta.total_count, 6);
    assert.deepEqual(first.source_types, Object.entries(SOURCE_TYPE_DEFINITIONS)
      .map(([type, definition]) => ({ type, label: definition.label })));

    const added = await buildRecentsPayload(config, db, query({ activity: 'added', kind: 'pages', offset: 2 }));
    assert.deepEqual(added.items.map((item) => item.slug), ['projects/page-3', 'projects/page-4']);
    const viewed = await buildRecentsPayload(config, db, query({ activity: 'viewed', kind: 'pages', offset: 2 }));
    assert.deepEqual(viewed.items.map((item) => item.slug), ['projects/page-2']);
    assert.deepEqual([viewed.meta.total_count, viewed.meta.has_more, viewed.meta.next_offset], [3, false, null]);
    const collected = await buildRecentsPayload(config, db, query({
      activity: 'updated', kind: 'pages', collection: 'selected-pages', offset: 2,
    }));
    assert.deepEqual(collected.items.map((item) => item.slug), ['projects/page-3', 'projects/page-2']);
    assert.deepEqual([collected.meta.total_count, collected.meta.has_more, collected.meta.next_offset], [4, false, null]);

    const images = await buildRecentsPayload(config, db, query({ activity: 'updated', kind: 'images', offset: 2 }));
    assert.deepEqual(images.items.map((item) => item.image.path), [
      'projects/.raw/page-4.png', 'projects/.raw/page-3.png',
    ]);
    assert.deepEqual([images.meta.total_count, images.meta.has_more, images.meta.next_offset], [6, true, 4]);
    const pastEnd = await buildRecentsPayload(config, db, query({ activity: 'updated', kind: 'pages', offset: 100 }));
    assert.deepEqual(pastEnd.items, []);
    assert.deepEqual([pastEnd.meta.has_more, pastEnd.meta.next_offset], [false, null]);
  } finally {
    await db?.close?.();
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});
