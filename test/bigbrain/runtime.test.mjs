import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { configPathForBrainHome, initializeBrainHome, loadConfig, metaDirForBrainHome } from '../../src/bigbrain/config.js';
import { openDatabase } from '../../src/bigbrain/db.js';
import { runHealthCheck } from '../../src/bigbrain/health.js';
import { migrateBrain } from '../../src/bigbrain/migrate.js';
import { boostResultsForQuery, classifyQueryIntent, formatAnswerContext, fuseResults, queryBrain, searchBrain, shouldAutoExpandQuery } from '../../src/bigbrain/search.js';
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
    await fs.stat(path.join(brainHome, 'personal-protocol'));
    await assert.rejects(fs.stat(path.join(brainHome, '.bigbrain', 'config.json')));
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test('init defaults runtime state under the selected brain home', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-init-local-state-'));
  try {
    const brainHome = path.join(rootDir, 'brain-home');
    const env = {
      ...process.env,
      HOME: path.join(rootDir, 'home'),
      BIGBRAIN_POINTER_PATH: path.join(rootDir, 'pointer'),
      BIGBRAIN_STATE_ROOT: undefined,
    };

    const init = await initializeBrainHome(brainHome, { env });
    assert.equal(init.configPath, path.join(brainHome, '.bigbrain-state', 'config.json'));
    await fs.stat(path.join(brainHome, '.bigbrain-state'));
    await assert.rejects(fs.stat(path.join(env.HOME, '.bigbrain-state', 'brains')));
    const storedConfig = JSON.parse(await fs.readFile(init.configPath, 'utf8'));
    assert.equal('tasks_file' in storedConfig, false);
    assert.equal('sqlite_path' in storedConfig, false);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test('folder recommendation routes personal operating preferences to personal-protocol', () => {
  const result = recommendFolderForInput('Calendar organization preference for travel days');
  assert.equal(result.folder, 'personal-protocol');
  assert.equal(result.relative_path.startsWith('personal-protocol/'), true);
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

test('search tolerates punctuation in natural-language queries', async () => {
  const fixture = await createFixture('bigbrain-search-punctuation-');
  try {
    await writeMarkdown(fixture.brainHome, 'deals/exampleco-process.md', `---
title: ExampleCo Process
---
# ExampleCo Process

Current ExampleCo sale timeline and next step.
`);
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });

    const db = await openDatabase(config);
    const result = await searchBrain({ db, config, query: 'What is the current ExampleCo sale timeline and next step?', apiKey: null });
    assert.equal(result.fused.length > 0, true);
    assert.equal(result.fused.some((row) => row.slug === 'deals/exampleco-process'), true);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('search falls back to lexical results and warns when OpenAI-backed retrieval fails', async () => {
  const fixture = await createFixture('bigbrain-search-fallback-');
  const originalFetch = globalThis.fetch;
  try {
    await writeMarkdown(fixture.brainHome, 'projects/seed-stage-advisory.md', `---
title: Seed-Stage Advisory
---
# Seed-Stage Advisory

Seed-stage companies I have advised include software, education, and workflow startups at the early operating stage.
`);
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({
      config,
      apiKey: 'test-key',
      embedder: async (texts) => texts.map(() => [0.1, 0.2, 0.3]),
    });

    globalThis.fetch = async () => {
      throw new Error('fetch failed');
    };

    const db = await openDatabase(config);
    const result = await searchBrain({ db, config, query: 'What seed-stage companies have I advised?', apiKey: 'test-key' });
    assert.equal(result.fused[0].slug, 'projects/seed-stage-advisory');
    assert.equal(result.warnings.length >= 1, true);
    assert.match(result.warnings.join('\n'), /falling back to lexical-only results/);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('query returns retrieved context and warns when OpenAI answer generation fails', async () => {
  const fixture = await createFixture('bigbrain-query-fallback-');
  const originalFetch = globalThis.fetch;
  try {
    await writeMarkdown(fixture.brainHome, 'people/alex-rivera.md', `---
title: Alex Rivera
---
# Alex Rivera

Alex Rivera is the founder of ExampleCo and a useful customer-discovery contact.
`);
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });

    globalThis.fetch = async () => {
      throw new Error('fetch failed');
    };

    const db = await openDatabase(config);
    const result = await queryBrain({ db, config, question: 'Who is Alex Rivera?', apiKey: 'test-key' });
    assert.equal(result.answer, null);
    assert.equal(result.search.fused[0].slug, 'people/alex-rivera');
    assert.equal(result.warnings.length >= 1, true);
    assert.match(result.warnings.join('\n'), /returning retrieved context only/);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('fused search favors the strongest semantic page across multiple ranked lists', () => {
  const fused = fuseResults(
    [
      { slug: 'deals/exampleco-jordan-engagement-proposal', title: 'Jordan Lee Engagement Proposal', type: 'deals', summary: '', snippet: 'next step', lexical_score: -1 },
      { slug: 'people/jordan-lee', title: 'Jordan Lee', type: 'people', summary: '', snippet: 'sale', lexical_score: -2 },
    ],
    [
      { slug: 'deals/exampleco-process', title: 'ExampleCo Process', type: 'deals', summary: '', snippet: 'sale timeline', semantic_score: 0.9 },
      { slug: 'deals/exampleco-jordan-engagement-proposal', title: 'Jordan Lee Engagement Proposal', type: 'deals', summary: '', snippet: 'next step', semantic_score: 0.7 },
    ],
    3,
  );

  assert.equal(fused[0].slug, 'deals/exampleco-jordan-engagement-proposal');
  assert.equal(fused.some((row) => row.slug === 'deals/exampleco-process'), true);
});

test('answer context emphasizes the top-ranked sources first', () => {
  const context = formatAnswerContext([
    {
      slug: 'deals/exampleco-process',
      title: 'ExampleCo Process',
      summary: '# ExampleCo Process',
      snippet: 'Competitive sale timeline.',
    },
    {
      slug: 'companies/exampleco',
      title: 'ExampleCo',
      summary: '# ExampleCo',
      snippet: 'Company context.',
    },
  ]);

  assert.match(context, /Top-ranked sources:/);
  assert.match(context, /1\. deals\/exampleco-process — ExampleCo Process/);
  assert.match(context, /Result 1\nSlug: deals\/exampleco-process/);
});

test('auto expansion stays off for direct entity lookups and on for broader questions', () => {
  assert.equal(shouldAutoExpandQuery('Jordan Lee'), false);
  assert.equal(shouldAutoExpandQuery('Who is Jordan Lee?'), false);
  assert.equal(shouldAutoExpandQuery("What's next on my TODO list?"), true);
  assert.equal(shouldAutoExpandQuery('what did i mention recently about example ai?'), true);
});

test('direct multi-word lookups classify as entity intent', () => {
  assert.equal(classifyQueryIntent('Alex Rivera'), 'entity');
  assert.equal(classifyQueryIntent('Wellness App'), 'entity');
  assert.equal(classifyQueryIntent('current buyer status'), 'general');
});

test('query boosts keep exact title matches ahead of semantic neighbors', () => {
  const results = [
    {
      slug: 'people/taylor-brooks',
      title: 'Taylor Brooks',
      type: 'people',
      summary: '',
      snippet: '',
      score: 1,
      lexicalHits: 0,
      semanticHits: 1,
    },
    {
      slug: 'people/alex-rivera',
      title: 'Alex Rivera',
      type: 'people',
      summary: '',
      snippet: '',
      score: 0.92,
      lexicalHits: 1,
      semanticHits: 1,
    },
  ];

  boostResultsForQuery(results, 'Alex Rivera');
  results.sort((left, right) => right.score - left.score || left.slug.localeCompare(right.slug));
  assert.equal(results[0].slug, 'people/alex-rivera');
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

test('health verifies the bigbrain command is available on PATH from outside the repo', async () => {
  const fixture = await createFixture('bigbrain-cli-health-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const fakeBinDir = path.join(fixture.rootDir, 'fake-bin');
    const probeDir = path.join(fixture.rootDir, 'probe-dir');
    await fs.mkdir(fakeBinDir, { recursive: true });
    await fs.mkdir(probeDir, { recursive: true });
    await fs.writeFile(path.join(fakeBinDir, 'bigbrain'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.resolve('bin/bigbrain.js'))} \"$@\"\n`, 'utf8');
    await fs.chmod(path.join(fakeBinDir, 'bigbrain'), 0o755);

    const report = await runHealthCheck(config, {
      env: { ...process.env, PATH: `${fakeBinDir}:${process.env.PATH}` },
      cliCwd: probeDir,
    });

    assert.equal(report.cli_status.available, true);
    assert.equal(report.findings.some((finding) => finding.finding_type === 'cli_not_available_globally'), false);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('health accepts active automations that match repo templates', async () => {
  const fixture = await createFixture('bigbrain-automation-template-health-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const templateDir = path.join(fixture.rootDir, 'templates', 'automations');
    const activeDir = path.join(fixture.rootDir, 'active', 'automations');
    const automation = `version = 1
id = "bigbrain-frequent-sync"
kind = "cron"
name = "BigBrain Frequent Sync"
prompt = "Run sync."
status = "ACTIVE"
rrule = "FREQ=MINUTELY;INTERVAL=45"
created_at = 1
updated_at = 2
`;

    await writeAutomationToml(templateDir, 'bigbrain-frequent-sync', automation);
    await writeAutomationToml(activeDir, 'bigbrain-frequent-sync', automation.replace('updated_at = 2', 'updated_at = 3'));

    const report = await runHealthCheck(config, {
      cliCommand: process.execPath,
      automationTemplateDir: templateDir,
      automationActiveDir: activeDir,
    });

    assert.equal(report.automation_template_status.checked_count, 1);
    assert.equal(report.automation_template_status.mismatch_count, 0);
    assert.equal(report.findings.some((finding) => finding.finding_type === 'automation_template_mismatch'), false);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('health flags active automation definitions that drift from repo templates', async () => {
  const fixture = await createFixture('bigbrain-automation-template-drift-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const templateDir = path.join(fixture.rootDir, 'templates', 'automations');
    const activeDir = path.join(fixture.rootDir, 'active', 'automations');
    await writeAutomationToml(templateDir, 'bigbrain-nightly-maintenance', `version = 1
id = "bigbrain-nightly-maintenance"
kind = "cron"
name = "BigBrain Nightly Maintenance"
prompt = "Run sync, health, and refresh."
status = "ACTIVE"
rrule = "FREQ=DAILY;BYHOUR=3;BYMINUTE=30;BYSECOND=0"
`);
    await writeAutomationToml(activeDir, 'bigbrain-nightly-maintenance', `version = 1
id = "bigbrain-nightly-maintenance"
kind = "cron"
name = "BigBrain Nightly Maintenance"
prompt = "Run only health."
status = "ACTIVE"
rrule = "FREQ=DAILY;BYHOUR=3;BYMINUTE=30;BYSECOND=0"
`);

    const report = await runHealthCheck(config, {
      cliCommand: process.execPath,
      automationTemplateDir: templateDir,
      automationActiveDir: activeDir,
    });
    const finding = report.findings.find((item) => item.finding_type === 'automation_template_mismatch');

    assert.equal(report.automation_template_status.mismatch_count, 1);
    assert.equal(Boolean(finding), true);
    assert.equal(finding.severity, 'medium');
    assert.equal(finding.details.id, 'bigbrain-nightly-maintenance');
    assert.equal(finding.details.status, 'mismatch');
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
        slug: 'companies/sample-investment',
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

async function writeAutomationToml(automationRoot, id, content) {
  const fullPath = path.join(automationRoot, id, 'automation.toml');
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
}
