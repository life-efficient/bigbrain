import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { startDashboard } from '../../src/bigbrain/dashboard.js';
import { syncBrain } from '../../src/bigbrain/sync.js';

test('dashboard serves the Recents API for pages and attached images', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-recents-route-'));
  const brainHome = path.join(rootDir, 'brain');
  let server;
  try {
    const env = {
      ...process.env,
      BIGBRAIN_POINTER_PATH: path.join(rootDir, 'pointer'),
      BIGBRAIN_STATE_ROOT: path.join(rootDir, 'state'),
    };
    const { configPath } = await initializeBrainHome(brainHome, { env });
    await fs.mkdir(path.join(brainHome, 'people', '.raw'), { recursive: true });
    await fs.writeFile(path.join(brainHome, 'people', 'alice.md'), `---
title: Alice
images: [{"path":"people/.raw/alice.png","caption":"Portrait"}]
---
# Alice
`);
    await fs.writeFile(path.join(brainHome, 'people', '.raw', 'alice.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const config = await loadConfig({ configPath });
    await syncBrain({ config, apiKey: null });
    server = await startDashboard(config, { host: '127.0.0.1', port: 0 });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    for (const kind of ['pages', 'images']) {
      const response = await fetch(`${baseUrl}/api/recents?activity=updated&kind=${kind}`);
      assert.equal(response.status, 200, `${kind} endpoint should exist`);
      assert.match(response.headers.get('content-type') || '', /application\/json/);
      const payload = await response.json();
      assert.equal(payload.meta.kind, kind);
      assert.equal(payload.items[0].slug, 'people/alice');
    }
  } finally {
    await server?.close();
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});
