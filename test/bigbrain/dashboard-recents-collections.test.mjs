import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { openDatabase, upsertSharedGroup } from '../../src/bigbrain/db.js';
import { buildRecentsPayload, recordDashboardPageView } from '../../src/bigbrain/dashboard.js';
import { syncBrain } from '../../src/bigbrain/sync.js';

test('Recents exposes collections and filters pages and images by collection membership', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-recents-collections-'));
  const brainHome = path.join(rootDir, 'brain');
  let db;
  try {
    const env = {
      ...process.env,
      BIGBRAIN_POINTER_PATH: path.join(rootDir, 'pointer'),
      BIGBRAIN_STATE_ROOT: path.join(rootDir, 'state'),
    };
    const { configPath } = await initializeBrainHome(brainHome, { env });
    for (const [slug, title] of [['people/alice', 'Alice'], ['people/bob', 'Bob'], ['projects/relay', 'Relay']]) {
      const filePath = path.join(brainHome, `${slug}.md`);
      const imagePath = `${path.posix.dirname(slug)}/.raw/${path.posix.basename(slug)}.png`;
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.mkdir(path.dirname(path.join(brainHome, imagePath)), { recursive: true });
      await fs.writeFile(filePath, `---\ntitle: ${title}\nimages: [{"path":"${imagePath}"}]\n---\n# ${title}\n`);
      await fs.writeFile(path.join(brainHome, imagePath), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    }
    const config = await loadConfig({ configPath });
    await syncBrain({ config, apiKey: null });
    db = await openDatabase(config);
    await upsertSharedGroup(db, {
      slug: 'people',
      title: 'People',
      visibility: 'internal',
      redirect_from: ['old-people'],
      pages: [{ page_slug: 'people/alice' }, { page_slug: 'people/bob' }],
    });
    await upsertSharedGroup(db, {
      slug: 'projects',
      title: 'Projects',
      visibility: 'public',
      pages: [{ page_slug: 'projects/relay' }],
    });
    const query = (suffix = '') => new URL(`/api/recents?activity=updated&kind=pages${suffix}`, 'http://127.0.0.1');

    const all = await buildRecentsPayload(config, db, query());
    assert.deepEqual(new Set(all.items.map((item) => item.slug)), new Set(['people/alice', 'people/bob', 'projects/relay']));
    assert.deepEqual(all.collections, [
      { id: 'people', title: 'People', count: 2 },
      { id: 'projects', title: 'Projects', count: 1 },
    ]);
    assert.equal(all.meta.collection, null);

    const people = await buildRecentsPayload(config, db, query('&collection=people'));
    assert.deepEqual(new Set(people.items.map((item) => item.slug)), new Set(['people/alice', 'people/bob']));
    assert.equal(people.meta.collection, 'people');
    assert.equal(people.meta.total_count, 2);
    assert.deepEqual((await buildRecentsPayload(config, db, query('&collection=old-people'))).items.map((item) => item.slug).sort(), ['people/alice', 'people/bob']);

    const images = await buildRecentsPayload(config, db, new URL('/api/recents?activity=updated&kind=images&collection=projects', 'http://127.0.0.1'));
    assert.deepEqual(images.items.map((item) => item.slug), ['projects/relay']);

    await recordDashboardPageView(db, 'people/alice');
    const viewed = await buildRecentsPayload(config, db, new URL('/api/recents?activity=viewed&kind=pages&collection=people', 'http://127.0.0.1'));
    assert.deepEqual(viewed.items.map((item) => item.slug), ['people/alice']);

    const missing = await buildRecentsPayload(config, db, query('&collection=does-not-exist'));
    assert.deepEqual(missing.items, []);
    assert.equal(missing.meta.collection, 'does-not-exist');
    assert.deepEqual(missing.collections, all.collections);
  } finally {
    db?.raw.close();
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});
