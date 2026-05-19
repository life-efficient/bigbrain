import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { configPathForBrainHome, initializeBrainHome, loadConfig, metaDirForBrainHome } from '../../src/bigbrain/config.js';
import { openDatabase } from '../../src/bigbrain/db.js';
import { runHealthCheck } from '../../src/bigbrain/health.js';
import { migrateBrain } from '../../src/bigbrain/migrate.js';
import { fuseResults, searchBrain } from '../../src/bigbrain/search.js';
import { renderSchemaMarkdown, recommendFolderForInput } from '../../src/bigbrain/schema.js';
import { syncBrain } from '../../src/bigbrain/sync.js';

test('init creates an external brain home with runtime state under the home-level state root', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-init-'));
  const pointerPath = path.join(rootDir, 'pointer');
  const stateRoot = path.join(rootDir, 'state-root');
  const brainHome = path.join(rootDir, 'brain-home');
  try {
    const env = { ...process.env, BIGBRAIN_POINTER_PATH: pointerPath, BIGBRAIN_STATE_ROOT: stateRoot };
    const result = await initializeBrainHome(brainHome, { env });
    assert.equal(result.brainHome, brainHome);
    assert.equal(result.configPath, configPathForBrainHome(brainHome, env));
    await fs.stat(path.join(metaDirForBrainHome(brainHome, env), 'config.json'));
    await fs.stat(path.join(metaDirForBrainHome(brainHome, env), 'state.json'));
    await fs.stat(path.join(brainHome, 'ops/tasks.md'));
    await assert.rejects(fs.stat(path.join(brainHome, '.bigbrain', 'config.json')));
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test('sync indexes markdown pages and search finds lexical matches', async () => {
  const fixture = await createFixture('bigbrain-sync-');
  try {
    await writeMarkdown(fixture.brainHome, 'people/alice-example.md', `---
title: Alice Example
---
# Alice Example

AI operator working on retrieval systems.
---
2026-05-18 | Met to discuss retrieval.
`);
    const config = await loadConfig({ configPath: fixture.configPath });
    const sync = await syncBrain({ config, apiKey: null });
    assert.equal(sync.indexed_pages >= 1, true);

    const db = await openDatabase(config);
    const result = await searchBrain({ db, config, query: 'retrieval systems', apiKey: null });
    assert.equal(result.fused[0].slug, 'people/alice-example');
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('health reports page-shape issues', async () => {
  const fixture = await createFixture('bigbrain-health-');
  try {
    await writeMarkdown(fixture.brainHome, 'people/broken.md', '# Broken Page Without Frontmatter');
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    const report = await runHealthCheck(config);
    assert.equal(report.finding_count > 0, true);
    assert.equal(report.findings.some((finding) => finding.finding_type === 'missing_frontmatter'), true);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('health does not flag meeting pages for missing separator or timeline', async () => {
  const fixture = await createFixture('bigbrain-meeting-health-');
  try {
    await writeMarkdown(fixture.brainHome, 'meetings/client-sync.md', `---
title: Client Sync
date: 2026-05-19
---
# Client Sync

**Attendees:** Alex, Jordan
**Date:** 2026-05-19

## Prep
### Context
- Discuss renewal and open commercial questions.

### Meeting Plan
- Confirm decision-maker.
- Push for next step.

## Summary
- Good call.

## Key Decisions
- Follow up with revised draft.

## Action Items
- Alex to send the draft.

## Discussion Notes
- Commercial terms remain open.
`);
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    const report = await runHealthCheck(config);
    const meetingFindings = report.findings.filter((finding) => finding.page_slug === 'meetings/client-sync');
    assert.equal(meetingFindings.some((finding) => finding.finding_type === 'missing_separator'), false);
    assert.equal(meetingFindings.some((finding) => finding.finding_type === 'missing_timeline'), false);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('health flags missing required meeting headings clearly', async () => {
  const fixture = await createFixture('bigbrain-meeting-headings-');
  try {
    await writeMarkdown(fixture.brainHome, 'meetings/missing-sections.md', `---
title: Missing Sections
date: 2026-05-19
---
# Missing Sections

**Attendees:** Alex
**Date:** 2026-05-19

## Summary
- Only summary exists.
`);
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    const report = await runHealthCheck(config);
    const finding = report.findings.find((item) => item.page_slug === 'meetings/missing-sections' && item.finding_type === 'missing_meeting_heading');
    assert.equal(Boolean(finding), true);
    assert.deepEqual(finding.details.missing, ['Key Decisions', 'Action Items', 'Discussion Notes']);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('health flags prep sections missing required subheadings', async () => {
  const fixture = await createFixture('bigbrain-meeting-prep-headings-');
  try {
    await writeMarkdown(fixture.brainHome, 'meetings/prep-missing-plan.md', `---
title: Prep Missing Plan
date: 2026-05-19
---
# Prep Missing Plan

**Attendees:** Alex
**Date:** 2026-05-19

## Prep
### Context
- Background only.

## Summary
- Good call.

## Key Decisions
- None yet.

## Action Items
- Follow up.

## Discussion Notes
- Notes.
`);
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    const report = await runHealthCheck(config);
    const finding = report.findings.find((item) => item.page_slug === 'meetings/prep-missing-plan' && item.finding_type === 'invalid_meeting_prep_heading');
    assert.equal(Boolean(finding), true);
    assert.deepEqual(finding.details.missing, ['Meeting Plan']);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('fusion prefers lexical hits over semantic-only ties for direct lookups', () => {
  const fused = fuseResults(
    [
      {
        slug: 'companies/professional-expertise-trading-company',
        title: 'Professional Expertise Trading Company',
        type: 'companies',
        summary: '# Professional Expertise Trading Company',
        snippet: 'Example Ventures exact hit',
      },
    ],
    [
      {
        slug: 'companies/bugshan-investment',
        snippet: 'semantic-only near miss',
        semantic_score: 0.9,
      },
    ],
    10,
  );

  assert.equal(fused[0].slug, 'companies/professional-expertise-trading-company');
});

test('migrate copies a brain-style source tree into a separate brain home', async () => {
  const fixture = await createFixture('bigbrain-migrate-');
  const sourceDir = path.join(fixture.rootDir, 'source-brain');
  try {
    await fs.mkdir(path.join(sourceDir, 'companies'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'companies/acme.md'), `---
title: Acme
---
# Acme

Important company.
---
2026-05-18 | Added.
`, 'utf8');

    const config = await loadConfig({ configPath: fixture.configPath });
    const report = await migrateBrain({ sourceDir, config });
    assert.equal(report.copied_files.includes('companies/acme.md'), true);
    await fs.stat(path.join(fixture.brainHome, 'companies/acme.md'));
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('schema and filing guidance stay inspectable', async () => {
  const markdown = renderSchemaMarkdown();
  const recommendation = recommendFolderForInput('board meeting prep for Acme');
  assert.match(markdown, /Directory Structure/);
  assert.match(markdown, /Meeting Page Shape/);
  assert.equal(recommendation.folder, 'meetings');
});

async function createFixture(prefix) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const pointerPath = path.join(rootDir, 'pointer');
  const stateRoot = path.join(rootDir, 'state-root');
  const brainHome = path.join(rootDir, 'brain-home');
  const init = await initializeBrainHome(brainHome, { env: { ...process.env, BIGBRAIN_POINTER_PATH: pointerPath, BIGBRAIN_STATE_ROOT: stateRoot } });
  return { rootDir, brainHome, configPath: init.configPath, statePath: init.statePath };
}

async function writeMarkdown(brainHome, relativePath, content) {
  const fullPath = path.join(brainHome, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
}
