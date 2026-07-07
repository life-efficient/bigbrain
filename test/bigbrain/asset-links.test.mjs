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
    await writeFile(path.join(fixture.brainHome, 'concepts', '.raw', 'deck-poster.png'), 'png');
    await writeMarkdown(fixture.brainHome, 'concepts/deck.md', `---
title: Deck
---
# Deck

- Existing asset: [poster](.raw/deck-poster.png)
- Missing asset: [transcript](.raw/deck-transcript.txt)
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
    assert.equal(unresolved[0].details.target_slug, 'concepts/.raw/deck-transcript.txt');
    assert.equal(unresolved[0].details.link_kind, 'asset');
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('health flags nested raw file paths', async () => {
  const fixture = await createFixture('bigbrain-nested-raw-health-');
  try {
    await writeFile(path.join(fixture.brainHome, 'concepts', '.raw', 'deck', 'poster.png'), 'png');
    await writeMarkdown(fixture.brainHome, 'concepts/deck.md', `---
title: Deck
---
# Deck

Nested raw fixture.
---
## Timeline
- **2026-05-19** | Added.
`);

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    const report = await runHealthCheck(config);

    const nested = report.findings.filter((finding) => finding.finding_type === 'nested_raw_file_path');
    assert.equal(nested.length, 1);
    assert.equal(nested[0].details.path, 'concepts/.raw/deck/poster.png');
    assert.equal(nested[0].details.expected_shape, '<collection>/.raw/<filename>');
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('health flags metadata-only raw sidecars outside .raw', async () => {
  const fixture = await createFixture('bigbrain-raw-sidecar-health-');
  try {
    await writeFile(path.join(fixture.brainHome, 'sources', '.raw', 'upload.pdf'), 'pdf');
    await writeMarkdown(fixture.brainHome, 'sources/upload.md', `---
title: Upload
raw_file: sources/.raw/upload.pdf
raw_mime_type: application/pdf
---
# Upload

## Source File

- [upload.pdf](.raw/upload.pdf)
`);

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    const report = await runHealthCheck(config);

    const sidecars = report.findings.filter((finding) => finding.finding_type === 'possible_misplaced_raw_sidecar');
    assert.equal(sidecars.length, 1);
    assert.equal(sidecars[0].page_slug, 'sources/upload');
    assert.equal(sidecars[0].details.raw_file, 'sources/.raw/upload.pdf');
    assert.equal(sidecars[0].details.expected_sidecar_path, 'sources/.raw/upload.md');
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('health accepts canonical pages that link to raw files', async () => {
  const fixture = await createFixture('bigbrain-raw-canonical-health-');
  try {
    await writeFile(path.join(fixture.brainHome, 'deliverables', '.raw', 'brief.pdf'), 'pdf');
    await writeMarkdown(fixture.brainHome, 'deliverables/brief.md', `---
title: Brief
raw_file: deliverables/.raw/brief.pdf
raw_mime_type: application/pdf
---
# Brief

## Summary

This canonical deliverable page explains what the attached brief is for and why
it matters in the brain.

## Source File

- [brief.pdf](.raw/brief.pdf)

---

## Timeline

- **2026-07-08** | Added the brief.
`);

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    const report = await runHealthCheck(config);

    const sidecars = report.findings.filter((finding) => finding.finding_type === 'possible_misplaced_raw_sidecar');
    assert.equal(sidecars.length, 0);
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
