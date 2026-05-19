import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { runHealthCheck } from '../../src/bigbrain/health.js';
import { syncBrain } from '../../src/bigbrain/sync.js';

test('health accepts existing asset links and flags missing asset links', async () => {
  const fixture = await createFixture('bigbrain-asset-links-');
  try {
    await writeFile(path.join(fixture.brainHome, 'concepts', '.raw', 'deck', 'poster.png'), 'png');
    await writeMarkdown(fixture.brainHome, 'concepts/deck.md', `---
title: Deck
---
# Deck

- Existing asset: [poster](.raw/deck/poster.png)
- Missing asset: [transcript](.raw/deck/transcript.txt)
---
## Timeline
- **2026-05-19** | Added.
`);

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    const report = await runHealthCheck(config);

    const unresolved = report.findings.filter((finding) => finding.finding_type === 'unresolved_link');
    assert.equal(unresolved.length, 1);
    assert.equal(unresolved[0].page_slug, 'concepts/deck');
    assert.equal(unresolved[0].details.target_slug, 'concepts/.raw/deck/transcript.txt');
    assert.equal(unresolved[0].details.link_kind, 'asset');
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

async function createFixture(prefix) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const pointerPath = path.join(rootDir, 'pointer');
  const stateRoot = path.join(rootDir, 'state-root');
  const brainHome = path.join(rootDir, 'brain-home');
  const init = await initializeBrainHome(brainHome, {
    env: { ...process.env, BIGBRAIN_POINTER_PATH: pointerPath, BIGBRAIN_STATE_ROOT: stateRoot },
  });
  return { rootDir, brainHome, configPath: init.configPath };
}

async function writeMarkdown(brainHome, relativePath, content) {
  const fullPath = path.join(brainHome, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
}

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}
