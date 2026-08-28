import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { runHealthCheck } from '../../src/bigbrain/health.js';
import { syncBrain } from '../../src/bigbrain/sync.js';

const execFileAsync = promisify(execFile);

test('health reports canonical pages with missing or invalid source attribution', async () => {
  const fixture = await createFixture('bigbrain-health-provenance-pages-');
  try {
    await writeMarkdown(fixture.brainHome, 'projects/missing.md', page('Missing source metadata'));
    await writeMarkdown(fixture.brainHome, 'projects/invalid.md', page('Invalid source metadata', `
event_id: event-1
source_type: not-a-source
source_label: Unknown source
commit_message: Record the change
`));

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    const report = await runHealthCheck(config, { cliCommand: process.execPath, repairUnknownSource: false });
    const findings = report.findings.filter((finding) => finding.finding_type === 'missing_source_attribution');

    assert.equal(report.provenance_status.pages_missing_source_attribution, 2);
    assert.equal(findings.length, 2);
    assert.deepEqual(
      new Map(findings.map((finding) => [finding.page_slug, finding.details.reason])),
      new Map([
        ['projects/invalid', 'invalid'],
        ['projects/missing', 'missing'],
      ]),
    );
    const invalid = findings.find((finding) => finding.page_slug === 'projects/invalid');
    assert.equal(invalid.details.normalized_source_type, 'unknown');
    assert.equal(invalid.details.scope, 'page');
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('health accepts explicit taxonomy-backed page attribution without rewriting it', async () => {
  const fixture = await createFixture('bigbrain-health-provenance-valid-');
  try {
    const original = page('Attributed page', `
event_id: gmail:event-1
source_type: gmail
source_label: Data center thread
commit_message: Record the Gmail update
`);
    await writeMarkdown(fixture.brainHome, 'projects/attributed.md', original);

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    const report = await runHealthCheck(config, { cliCommand: process.execPath, repairUnknownSource: false });

    assert.equal(report.provenance_status.pages_with_source_attribution, 1);
    assert.equal(report.findings.some((finding) => finding.page_slug === 'projects/attributed' && finding.finding_type === 'missing_source_attribution'), false);
    assert.equal(await fs.readFile(path.join(fixture.brainHome, 'projects/attributed.md'), 'utf8'), original);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('health reports changed Git-backed content without source attribution', async () => {
  const fixture = await createFixture('bigbrain-health-provenance-git-');
  try {
    await writeMarkdown(fixture.brainHome, 'projects/ready.md', page('Ready page', `
event_id: cli:initial
source_type: cli
source_label: BigBrain test setup
commit_message: Add the initial page
`));
    await execFileAsync('git', ['-C', fixture.brainHome, 'init']);
    await execFileAsync('git', ['-C', fixture.brainHome, 'config', 'user.email', 'test@example.com']);
    await execFileAsync('git', ['-C', fixture.brainHome, 'config', 'user.name', 'Test User']);
    await execFileAsync('git', ['-C', fixture.brainHome, 'add', '.']);
    await execFileAsync('git', ['-C', fixture.brainHome, 'commit', '-m', 'initial brain']);

    await writeMarkdown(fixture.brainHome, 'projects/unattributed.md', page('Unattributed change'));
    await fs.mkdir(path.join(fixture.brainHome, 'projects', '.raw'), { recursive: true });
    await fs.writeFile(path.join(fixture.brainHome, 'projects', '.raw', 'evidence.pdf'), 'pdf', 'utf8');

    const config = await loadConfig({ configPath: fixture.configPath });
    const report = await runHealthCheck(config, { cliCommand: process.execPath, repairUnknownSource: false });
    const findings = report.findings.filter((finding) => finding.finding_type === 'missing_source_attribution' && finding.details.scope === 'git_change');

    assert.equal(report.provenance_status.git_backed_change_count, 2);
    assert.equal(report.provenance_status.git_backed_changes_missing_source_attribution, 2);
    assert.deepEqual(findings.map((finding) => finding.details.source_path).sort(), [
      'projects/.raw/evidence.md',
      'projects/unattributed.md',
    ]);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('health repairs missing page attribution with explicit unknown metadata', async () => {
  const fixture = await createFixture('bigbrain-health-provenance-repair-');
  try {
    await writeMarkdown(fixture.brainHome, 'projects/repairable.md', page('Repairable page'));
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    const report = await runHealthCheck(config, { cliCommand: process.execPath, repairUnknownSource: true });
    const repaired = await fs.readFile(path.join(fixture.brainHome, 'projects/repairable.md'), 'utf8');
    assert.equal(report.provenance_status.repaired_unknown_count, 1);
    assert.match(repaired, /source_type: unknown/);
    assert.match(repaired, /source_label: Unknown source/);
    assert.match(repaired, /event_id: health:unknown:projects\/repairable/);
    assert.match(repaired, /commit_message: Repair missing source attribution/);
    assert.equal(report.findings.some((finding) => finding.page_slug === 'projects/repairable' && finding.finding_type === 'missing_source_attribution'), false);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

function page(title, frontmatter = '') {
  return `---
title: ${title}${frontmatter}
---
# ${title}

## Summary

This page has a current summary.

---
## Timeline

- **2026-08-28** | Created.
`;
}

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
