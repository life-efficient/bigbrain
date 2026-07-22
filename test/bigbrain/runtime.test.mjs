import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import { loadBrainProfile } from '../../src/bigbrain/brain-profile.js';
import { configPathForBrainHome, initializeBrainHome, loadConfig, loadUserEnv, metaDirForBrainHome, updateBrainName, userEnvPath } from '../../src/bigbrain/config.js';
import { getHostedBrainGitState, openDatabase } from '../../src/bigbrain/db.js';
import { filingRulesForBrain } from '../../src/bigbrain/filing-rules.js';
import { runHealthCheck } from '../../src/bigbrain/health.js';
import { migrateBrain } from '../../src/bigbrain/migrate.js';
import { boostResultsForQuery, classifyQueryIntent, DEFAULT_SEARCH_MODE, formatAnswerContext, fuseResults, queryBrain, searchBrain, shouldAutoExpandQuery } from '../../src/bigbrain/search.js';
import { renderSchemaMarkdown, recommendFolderForInput } from '../../src/bigbrain/schema.js';
import { syncBrain } from '../../src/bigbrain/sync.js';

const execFileAsync = promisify(execFile);

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
    await fs.stat(path.join(brainHome, 'tasks'));
    await fs.stat(path.join(brainHome, 'organizations'));
    await fs.stat(path.join(brainHome, 'protocol'));
    await assert.rejects(fs.stat(path.join(brainHome, 'companies')));
    await assert.rejects(fs.stat(path.join(brainHome, 'sources')));
    await assert.rejects(fs.stat(path.join(brainHome, 'ops')));
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
    assert.match(storedConfig.brain_id, /^brn_[0-9a-f-]{36}$/);
    assert.equal(storedConfig.brain_name, 'Brain Home');
    assert.equal('tasks_file' in storedConfig, false);
    assert.equal('sqlite_path' in storedConfig, false);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test('brain identity supports an explicit editable name and immutable ID', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-identity-'));
  try {
    const brainHome = path.join(rootDir, 'brain');
    const env = { ...process.env, BIGBRAIN_POINTER_PATH: path.join(rootDir, 'pointer'), BIGBRAIN_STATE_ROOT: path.join(rootDir, 'state') };
    const init = await initializeBrainHome(brainHome, { env, brainName: 'Personal Brain' });
    const before = await loadConfig({ configPath: init.configPath });
    assert.equal(before.brainName, 'Personal Brain');
    const after = await updateBrainName({ configPath: init.configPath }, 'Private Brain');
    assert.equal(after.brainName, 'Private Brain');
    assert.equal(after.brainId, before.brainId);
    const profile = await loadBrainProfile(after);
    assert.equal(profile.profile.identity.brain_name, 'Private Brain');
    assert.equal(profile.profile.identity.brain_id, before.brainId);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test('CLI shows the conservative routing profile as unapproved review-only metadata', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-about-cli-'));
  try {
    const brainHome = path.join(rootDir, 'brain');
    const env = {
      ...process.env,
      BIGBRAIN_POINTER_PATH: path.join(rootDir, 'pointer'),
      BIGBRAIN_STATE_ROOT: path.join(rootDir, 'state'),
    };
    const init = await initializeBrainHome(brainHome, { env, brainName: 'CLI Profile Brain' });
    const result = await runNode(['./bin/bigbrain.js', '--config', init.configPath, 'about', 'show', '--json'], { cwd: process.cwd() });
    assert.equal(result.code, 0, result.stderr);
    const about = JSON.parse(result.stdout);
    assert.equal(about.brain_name, 'CLI Profile Brain');
    assert.equal(about.manifest.reviewed, false);
    assert.equal(about.routing.effective_ingestion_mode, 'review');
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test('legacy read-only config gets stable in-memory identity without a config write', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-legacy-identity-'));
  try {
    const brainHome = path.join(rootDir, 'legacy-brain');
    const configPath = path.join(rootDir, 'config.json');
    await fs.mkdir(brainHome, { recursive: true });
    await fs.writeFile(configPath, `${JSON.stringify({ brain_dir: brainHome })}\n`, 'utf8');
    const before = await fs.readFile(configPath, 'utf8');
    const first = await loadConfig({ configPath });
    const second = await loadConfig({ configPath });
    assert.equal(first.brainId, second.brainId);
    assert.equal(first.brainName, 'Legacy Brain');
    assert.equal(await fs.readFile(configPath, 'utf8'), before);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test('loads BigBrain user env from the current home config directory', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-user-env-'));
  try {
    const env = { HOME: path.join(rootDir, 'home') };
    const envPath = userEnvPath(env);
    await fs.mkdir(path.dirname(envPath), { recursive: true });
    await fs.writeFile(envPath, `
# BigBrain local secrets
OPENAI_API_KEY="from-user-env"
export BIGBRAIN_TEST_VALUE='quoted value'
`, 'utf8');

    const result = await loadUserEnv(env);
    assert.equal(result.missing, false);
    assert.equal(result.path, envPath);
    assert.deepEqual(result.loaded, ['OPENAI_API_KEY', 'BIGBRAIN_TEST_VALUE']);
    assert.equal(env.OPENAI_API_KEY, 'from-user-env');
    assert.equal(env.BIGBRAIN_TEST_VALUE, 'quoted value');
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test('BigBrain user env does not override existing process values', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-user-env-existing-'));
  try {
    const env = {
      HOME: path.join(rootDir, 'home'),
      OPENAI_API_KEY: 'already-set',
    };
    const envPath = userEnvPath(env);
    await fs.mkdir(path.dirname(envPath), { recursive: true });
    await fs.writeFile(envPath, 'OPENAI_API_KEY=from-user-env\n', 'utf8');

    const result = await loadUserEnv(env);
    assert.deepEqual(result.loaded, []);
    assert.equal(env.OPENAI_API_KEY, 'already-set');
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test('CLI commands honor explicit --config paths', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-cli-config-'));
  try {
    const brainHome = path.join(rootDir, 'brain-home');
    const runtimeDir = path.join(rootDir, 'runtime');
    const configPath = path.join(runtimeDir, 'config.json');
    await fs.mkdir(path.join(brainHome, 'people'), { recursive: true });
    await fs.mkdir(runtimeDir, { recursive: true });
    await fs.writeFile(path.join(brainHome, 'people', 'cli-config.md'), `---
title: CLI Config
---
# CLI Config

Explicit config path page.
`, 'utf8');
    await fs.writeFile(configPath, `${JSON.stringify({
      brain_dir: brainHome,
      sqlite_path: path.join(runtimeDir, 'bigbrain.sqlite'),
      include_globs: ['**/*.md'],
      exclude_globs: [],
    }, null, 2)}\n`, 'utf8');

    const sync = await runNode(['./bin/bigbrain.js', '--config', configPath, 'sync', '--json'], { cwd: process.cwd() });
    assert.equal(sync.code, 0, sync.stderr);
    const result = await runNode(['./bin/bigbrain.js', '--config', configPath, 'list', '--json'], { cwd: process.cwd() });
    assert.equal(result.code, 0, result.stderr);
    const rows = JSON.parse(result.stdout);
    assert.equal(rows.some((row) => row.slug === 'people/cli-config'), true);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test('CLI reports search mode bundles', async () => {
  const result = await runNode(['./bin/bigbrain.js', 'search', 'modes', '--json'], { cwd: process.cwd() });
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.default_mode, 'balanced');
  assert.equal(report.active_mode, 'balanced');
  assert.equal(report.bundles.balanced.rerank, true);
  assert.equal(report.bundles.tokenmax.expansion, true);
});

test('CLI dashboard starts the browser dashboard server', async () => {
  const fixture = await createFixture('bigbrain-cli-dashboard-');
  let child;
  try {
    child = spawn(process.execPath, [
      './bin/bigbrain.js',
      '--config',
      fixture.configPath,
      'dashboard',
      '--port',
      '0',
      '--no-open',
    ], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });

    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    const line = await waitForStdoutLine(child, stdout, /Dashboard running at http:\/\/127\.0\.0\.1:\d+/);
    const url = line.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    assert.ok(url);
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /dashboard-client\.js/);
    assert.equal(Buffer.concat(stderr).toString('utf8'), '');
  } finally {
    child?.kill();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('CLI runs deterministic retrieval evals', async () => {
  const text = await runNode(['./bin/bigbrain.js', 'eval', 'retrieval'], { cwd: process.cwd() });
  assert.equal(text.code, 0, text.stderr);
  assert.match(text.stdout, /Retrieval eval \(conservative, limit 5\)/);
  assert.match(text.stdout, /Hit@1:/);

  const json = await runNode(['./bin/bigbrain.js', 'eval', 'retrieval', '--json'], { cwd: process.cwd() });
  assert.equal(json.code, 0, json.stderr);
  const report = JSON.parse(json.stdout);
  assert.equal(report.schema_version, 2);
  assert.equal(report.mode, 'conservative');
  assert.equal(report.case_count >= 8, true);
  assert.equal(report.metrics.hit_at_1, report.case_count);
  assert.equal(report.gates.passed, true);
  assert.equal(report.family_metrics['alias-synonym'].hit_at_1, 2);
  assert.equal(typeof report._meta.metric_glossary.mrr, 'string');
});

test('CLI retrieval eval can load private cases outside the repo', async () => {
  const fixture = await createFixture('bigbrain-private-eval-');
  try {
    await writeMarkdown(fixture.brainHome, 'people/private-eval.md', `---
title: Private Eval
---
# Private Eval

Private eval retrieval target.
`);
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    const casesPath = path.join(fixture.rootDir, 'private-cases.json');
    await fs.writeFile(casesPath, `${JSON.stringify([
      {
        id: 'private-target',
        query: 'Private Eval',
        expected_slug: 'people/private-eval',
      },
    ], null, 2)}\n`, 'utf8');

    const result = await runNode([
      './bin/bigbrain.js',
      '--config',
      fixture.configPath,
      'eval',
      'retrieval',
      '--cases',
      casesPath,
      '--json',
    ], { cwd: process.cwd() });
    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.case_source, 'external');
    assert.equal(report.metrics.hit_at_1, 1);
    assert.equal(report.results[0].expected_slug, 'people/private-eval');
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('CLI retrieval eval supports default private cases, redaction, replay, and compare', async () => {
  const fixture = await createFixture('bigbrain-private-eval-default-');
  const homeDir = path.join(fixture.rootDir, 'home');
  try {
    await writeMarkdown(fixture.brainHome, 'people/private-eval.md', `---
title: Private Eval
---
# Private Eval

Private eval retrieval target.
`);
    await writeMarkdown(fixture.brainHome, 'notes/private-decoy.md', `---
title: Private Decoy
---
# Private Decoy

Private eval retrieval target decoy.
`);
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    const defaultCasesPath = path.join(homeDir, '.config', 'bigbrain', 'evals', 'retrieval-cases.jsonl');
    await fs.mkdir(path.dirname(defaultCasesPath), { recursive: true });
    await fs.writeFile(defaultCasesPath, [
      JSON.stringify({
        id: 'private-target',
        family: 'title-substring',
        query: 'Private Eval',
        expected_slug: 'people/private-eval',
      }),
      JSON.stringify({
        id: 'private-negative',
        family: 'hard-negative',
        query: 'Private Decoy',
        expected_slug: 'notes/private-decoy',
        forbidden_slugs: ['people/private-eval'],
      }),
      '',
    ].join('\n'), 'utf8');

    const env = { HOME: homeDir };
    const evalResult = await runNode([
      './bin/bigbrain.js',
      '--config',
      fixture.configPath,
      'eval',
      'retrieval',
      '--private',
      '--redact',
      '--json',
    ], { cwd: process.cwd(), env });
    assert.equal(evalResult.code, 0, evalResult.stderr);
    const report = JSON.parse(evalResult.stdout);
    assert.equal(report.case_source, 'default-private');
    assert.equal(report.redacted, true);
    assert.equal(report.results[0].query, null);
    assert.equal(report.results[0].expected_slug.startsWith('slug-'), true);

    const exported = await runNode([
      './bin/bigbrain.js',
      '--config',
      fixture.configPath,
      'eval',
      'export',
    ], { cwd: process.cwd(), env });
    assert.equal(exported.code, 0, exported.stderr);
    const baselinePath = path.join(fixture.rootDir, 'baseline.ndjson');
    await fs.writeFile(baselinePath, exported.stdout, 'utf8');
    const baselineRows = exported.stdout.trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(baselineRows.length, 2);
    assert.equal(baselineRows[0].case_id, 'private-target');

    const replay = await runNode([
      './bin/bigbrain.js',
      '--config',
      fixture.configPath,
      'eval',
      'replay',
      '--against',
      baselinePath,
      '--json',
    ], { cwd: process.cwd(), env });
    assert.equal(replay.code, 0, replay.stderr);
    const replayReport = JSON.parse(replay.stdout);
    assert.equal(replayReport.metrics.top1_stability_rate, 1);
    assert.equal(replayReport.moved_queries.length, 0);

    const compare = await runNode([
      './bin/bigbrain.js',
      '--config',
      fixture.configPath,
      'eval',
      'compare',
      '--private',
      '--modes',
      'conservative',
      '--markdown',
    ], { cwd: process.cwd(), env });
    assert.equal(compare.code, 0, compare.stderr);
    assert.match(compare.stdout, /\| Mode \| Hit@1 \| Hit@3 \| MRR \| Recall@k \| Gates \|/);
    assert.match(compare.stdout, /\| conservative \|/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('folder recommendation routes operating preferences to protocol', () => {
  const result = recommendFolderForInput('Calendar organization preference for travel days');
  assert.equal(result.folder, 'protocol');
  assert.equal(result.relative_path.startsWith('protocol/'), true);
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

test('search warns when semantic search is skipped because api key is missing', async () => {
  const fixture = await createFixture('bigbrain-search-no-api-key-');
  try {
    await writeMarkdown(fixture.brainHome, 'people/alex-rivera.md', `---
title: Alex Rivera
---
# Alex Rivera

Alex Rivera is the founder of ExampleCo.
`);
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });

    const db = await openDatabase(config);
    const result = await searchBrain({ db, config, query: 'Alex Rivera', apiKey: null });
    assert.equal(result.fused[0].slug, 'people/alex-rivera');
    assert.match(result.warnings.join('\n'), /semantic search skipped because OPENAI_API_KEY is not set/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('query warns when answer generation is skipped because api key is missing', async () => {
  const fixture = await createFixture('bigbrain-query-no-api-key-');
  try {
    await writeMarkdown(fixture.brainHome, 'people/alex-rivera.md', `---
title: Alex Rivera
---
# Alex Rivera

Alex Rivera is the founder of ExampleCo.
`);
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });

    const db = await openDatabase(config);
    const result = await queryBrain({ db, config, question: 'Alex Rivera', apiKey: null });
    assert.equal(result.answer, null);
    assert.equal(result.preferred_sources[0], 'people/alex-rivera');
    assert.match(result.warnings.join('\n'), /OpenAI answer generation skipped because OPENAI_API_KEY is not set/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('search warns when semantic search is skipped because the index has no embeddings', async () => {
  const fixture = await createFixture('bigbrain-search-no-embeddings-');
  try {
    await writeMarkdown(fixture.brainHome, 'people/alex-rivera.md', `---
title: Alex Rivera
---
# Alex Rivera

Alex Rivera is the founder of ExampleCo.
`);
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });

    const db = await openDatabase(config);
    const result = await searchBrain({ db, config, query: 'Alex Rivera', apiKey: 'test-key' });
    assert.equal(result.fused[0].slug, 'people/alex-rivera');
    assert.match(result.warnings.join('\n'), /semantic search skipped because the index has no embeddings/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('search defaults to balanced mode and applies mocked OpenAI reranking', async () => {
  const fixture = await createFixture('bigbrain-search-rerank-');
  try {
    await writeMarkdown(fixture.brainHome, 'projects/alpha.md', `---
title: Alpha Result
---
# Alpha Result

shared retrieval target
`);
    await writeMarkdown(fixture.brainHome, 'projects/beta.md', `---
title: Beta Result
---
# Beta Result

shared retrieval target
`);
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });

    const db = await openDatabase(config);
    const result = await searchBrain({
      db,
      config,
      query: 'shared retrieval target',
      apiKey: 'test-key',
      explain: true,
      reranker: async ({ results }) => results.map((row, index) => ({
        index,
        score: row.slug === 'projects/beta' ? 1 : 0.1,
      })),
    });
    assert.equal(DEFAULT_SEARCH_MODE, 'balanced');
    assert.equal(result.mode, 'balanced');
    assert.equal(result.fused[0].slug, 'projects/beta');
    assert.equal(result.fused[0].rerank_score, 1);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('tokenmax mode enables query expansion', async () => {
  const fixture = await createFixture('bigbrain-search-tokenmax-expansion-');
  const originalFetch = globalThis.fetch;
  try {
    await writeMarkdown(fixture.brainHome, 'tasks/current-priorities.md', `---
title: Current Priorities
---
# Current Priorities

Next on my TODO list is retrieval quality and MCP query behavior.
`);
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ output_text: '["retrieval quality priorities","MCP query behavior"]' }),
    });

    const db = await openDatabase(config);
    const result = await searchBrain({
      db,
      config,
      query: "What's next on my TODO list?",
      apiKey: 'test-key',
      mode: 'tokenmax',
      reranker: async ({ results }) => results.map((row, index) => ({ index, score: 1 - (index * 0.01) })),
    });
    assert.equal(result.mode, 'tokenmax');
    assert.equal(result.expanded, true);
    assert.equal(result.queries.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('search matches frontmatter aliases and stamps create safety', async () => {
  const fixture = await createFixture('bigbrain-search-alias-');
  try {
    await writeMarkdown(fixture.brainHome, 'concepts/mingtang.md', `---
title: Mingtang
aliases: [Hall of Light]
---
# Mingtang

Canonical concept page for the hall.
`);
    await writeMarkdown(fixture.brainHome, 'notes/hall-of-light-mention.md', `---
title: Hall of Light Mention
---
# Hall of Light Mention

A passing note that mentions Hall of Light.
`);
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });

    const db = await openDatabase(config);
    const result = await searchBrain({ db, config, query: 'Hall of Light', apiKey: null, mode: 'conservative', explain: true });
    assert.equal(result.fused[0].slug, 'concepts/mingtang');
    assert.equal(result.fused[0].evidence, 'alias_hit');
    assert.equal(result.fused[0].create_safety, 'exists');
  } finally {
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

test('health flags folders missing FILING.md', async () => {
  const fixture = await createFixture('bigbrain-filing-health-');
  try {
    await writeAllDefaultFilingRules(fixture.brainHome);
    await writeMarkdown(fixture.brainHome, 'projects/acme-rollout.md', `---
type: project
title: Acme Rollout
---
# Acme Rollout

Operational rollout notes.

---

## Timeline

- 2026-06-29: Created.
`);
    await fs.mkdir(path.join(fixture.brainHome, 'projects', 'client-work'), { recursive: true });
    await fs.mkdir(path.join(fixture.brainHome, 'projects', '.raw', 'nested-asset-folder'), { recursive: true });
    await fs.mkdir(path.join(fixture.brainHome, '.bigbrain-state', 'runtime'), { recursive: true });

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    const report = await runHealthCheck(config);
    const missing = report.findings.filter((finding) => finding.finding_type === 'missing_filing_rules');

    assert.equal(report.filing_rules_status.missing_count, 1);
    assert.deepEqual(missing.map((finding) => finding.details.expected_path), ['projects/client-work/FILING.md']);

    await writeMarkdown(fixture.brainHome, 'projects/client-work/FILING.md', '# Client Work Filing\n\nUse for client work project subfolders.\n');
    await syncBrain({ config, apiKey: null });
    const repaired = await runHealthCheck(config);

    assert.equal(repaired.filing_rules_status.missing_count, 0);
    assert.equal(repaired.findings.some((finding) => finding.finding_type === 'missing_filing_rules'), false);
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

test('health persists compact hosted brain git durability state', async () => {
  const fixture = await createFixture('bigbrain-git-health-');
  try {
    await writeMarkdown(fixture.brainHome, 'projects/git-health.md', `---
title: Git Health
---
# Git Health

Git durability status page.
`);
    const remoteDir = path.join(fixture.rootDir, 'remote.git');
    await execFileAsync('git', ['init', '--bare', remoteDir]);
    await execFileAsync('git', ['-C', fixture.brainHome, 'init']);
    await execFileAsync('git', ['-C', fixture.brainHome, 'config', 'user.email', 'test@example.com']);
    await execFileAsync('git', ['-C', fixture.brainHome, 'config', 'user.name', 'Test User']);
    await execFileAsync('git', ['-C', fixture.brainHome, 'add', '.']);
    await execFileAsync('git', ['-C', fixture.brainHome, 'commit', '-m', 'initial brain']);
    await execFileAsync('git', ['-C', fixture.brainHome, 'branch', '-M', 'main']);
    await execFileAsync('git', ['-C', fixture.brainHome, 'remote', 'add', 'origin', remoteDir]);
    await execFileAsync('git', ['-C', fixture.brainHome, 'push', '-u', 'origin', 'main']);

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    await execFileAsync('git', ['-C', fixture.brainHome, 'add', '.']);
    await execFileAsync('git', ['-C', fixture.brainHome, 'commit', '-m', 'sync state']);
    await execFileAsync('git', ['-C', fixture.brainHome, 'push']);
    const cleanReport = await runHealthCheck(config, { cliCommand: process.execPath });

    assert.equal(cleanReport.git_status.sync_status, 'in_sync');
    assert.equal(cleanReport.git_status.needs_attention, false);
    assert.equal(cleanReport.findings.some((finding) => finding.finding_type === 'git_status'), false);

    await fs.appendFile(path.join(fixture.brainHome, 'projects/git-health.md'), '\nUncommitted runtime edit.\n', 'utf8');
    await syncBrain({ config, apiKey: null });
    const report = await runHealthCheck(config, { cliCommand: process.execPath });

    assert.equal(report.git_status.canonical_remote, 'origin');
    assert.equal(report.git_status.canonical_branch, 'main');
    assert.equal(report.git_status.ahead_count, 0);
    assert.equal(report.git_status.behind_count, 0);
    assert.equal(report.git_status.sync_status, 'dirty');
    assert.equal(report.git_status.needs_attention, true);
    const gitFinding = report.findings.find((finding) => finding.finding_type === 'git_status');
    assert.equal(gitFinding.severity, 'medium');

    const db = await openDatabase(config);
    const state = await getHostedBrainGitState(db, config.brainDir);
    assert.equal(state.brain_dir, config.brainDir);
    assert.equal(state.canonical_remote, 'origin');
    assert.equal(state.canonical_branch, 'main');
    assert.equal(state.sync_status, 'dirty');
    assert.equal(state.health_status, 'needs_attention');
    assert.equal(state.needs_attention, true);
    assert.equal(state.dirty, true);
    assert.equal(state.latest_error_code, null);
    await db.close?.();
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('health treats an unconfigured Git upstream as an optional backup recommendation', async () => {
  const fixture = await createFixture('bigbrain-git-backup-optional-');
  try {
    await writeMarkdown(fixture.brainHome, 'projects/local-only.md', `---
title: Local Only
---
# Local Only

Git backup is optional.
`);
    await execFileAsync('git', ['-C', fixture.brainHome, 'init']);
    await execFileAsync('git', ['-C', fixture.brainHome, 'config', 'user.email', 'test@example.com']);
    await execFileAsync('git', ['-C', fixture.brainHome, 'config', 'user.name', 'Test User']);
    await execFileAsync('git', ['-C', fixture.brainHome, 'add', '.']);
    await execFileAsync('git', ['-C', fixture.brainHome, 'commit', '-m', 'local brain']);

    const config = await loadConfig({ configPath: fixture.configPath });
    const report = await runHealthCheck(config, { cliCommand: process.execPath });

    assert.equal(report.git_status.sync_status, 'no_upstream');
    assert.equal(report.git_status.needs_attention, false);
    assert.equal(report.git_status.health_status, 'ok');
    const gitFinding = report.findings.find((finding) => finding.finding_type === 'git_status');
    assert.equal(gitFinding.severity, 'low');
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('health treats a brain without Git as an optional backup recommendation', async () => {
  const fixture = await createFixture('bigbrain-without-git-');
  try {
    await writeMarkdown(fixture.brainHome, 'projects/workshop-brain.md', `---
title: Workshop Brain
---
# Workshop Brain

No Git setup is required.
`);
    const config = await loadConfig({ configPath: fixture.configPath });
    const report = await runHealthCheck(config, { cliCommand: process.execPath });

    assert.equal(report.git_status.sync_status, 'no_repository');
    assert.equal(report.git_status.needs_attention, false);
    assert.equal(report.git_status.health_status, 'ok');
    const gitFinding = report.findings.find((finding) => finding.finding_type === 'git_status');
    assert.equal(gitFinding.severity, 'low');
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
    await fs.mkdir(path.join(sourceDir, 'inbox'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'inbox/legacy-note.md'), `---
title: Legacy Note
---
# Legacy Note

Historical unresolved capture.
`, 'utf8');

    const config = await loadConfig({ configPath: fixture.configPath });
    assert.equal(config.schemaDirs.includes('inbox'), false);
    const report = await migrateBrain({ sourceDir, config });
    assert.equal(report.copied_files.includes('companies/acme.md'), true);
    assert.equal(report.copied_files.includes('inbox/legacy-note.md'), true);
    await fs.stat(path.join(fixture.brainHome, 'companies/acme.md'));
    await fs.stat(path.join(fixture.brainHome, 'inbox/legacy-note.md'));
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('schema and filing guidance stay inspectable', async () => {
  const fixture = await createFixture('bigbrain-schema-filing-');
  const markdown = renderSchemaMarkdown();
  const recommendation = recommendFolderForInput('board meeting prep for Acme');
  try {
    assert.match(markdown, /Directory Structure/);
    assert.match(markdown, /Meeting Page Shape/);
    assert.match(markdown, /Task Page Shape/);
    assert.match(markdown, /status.*open.*in_progress.*waiting.*done.*archived/s);
    assert.match(markdown, /readiness.*underspecified.*ready/s);
    assert.match(markdown, /execution_mode.*agent.*user.*interactive/s);
    assert.match(markdown, /Status and readiness are independent/);
    assert.match(markdown, /What Counts as Completed/);
    assert.match(markdown, /No successor task needed/);
    assert.match(markdown, /Do not use `ops\/tasks\.md`/);
    assert.match(markdown, /Use `tasks\/` for actionable work by default/);
    assert.equal(recommendation.folder, 'meetings');
    assert.equal(recommendFolderForInput('follow up task for the launch owner').folder, 'tasks');
    assert.equal(recommendFolderForInput('Acme LLC relationship note').folder, 'organizations');
    assert.equal(recommendFolderForInput('raw PDF snapshot with unclear owner').folder, 'writing');
    assert.equal(recommendFolderForInput('unclassified note with no obvious subject').folder, 'ideas');

    const config = await loadConfig({ configPath: fixture.configPath });
    const filingRules = await filingRulesForBrain({ config });
    assert.match(filingRules.markdown, /Task Page Schema/);
    assert.match(filingRules.markdown, /Pattern: `tasks\/<task-slug>\.md`/);
    assert.match(filingRules.markdown, /does not need to match or mirror the full task title/);
    assert.deepEqual(filingRules.task_schema.frontmatter.status, ['open', 'in_progress', 'waiting', 'done', 'archived']);
    assert.deepEqual(filingRules.task_schema.frontmatter.readiness, ['underspecified', 'ready']);
    assert.deepEqual(filingRules.task_schema.frontmatter.execution_mode, ['agent', 'user', 'interactive']);
    assert.deepEqual(filingRules.task_schema.frontmatter.priority, ['p0', 'p1', 'p2', 'p3']);
    assert.match(filingRules.task_schema.guidance.join('\n'), /readiness: underspecified/);
    assert.match(filingRules.task_schema.guidance.join('\n'), /human-readable identifier/);
    assert.match(filingRules.task_schema.guidance.join('\n'), /status to in_progress/);
    assert.match(filingRules.task_schema.guidance.join('\n'), /Status and readiness are independent/);
    assert.match(filingRules.task_schema.guidance.join('\n'), /execution_mode: interactive/);
    assert.match(filingRules.task_schema.guidance.join('\n'), /Anti-Patterns/);
    assert.match(filingRules.task_schema.guidance.join('\n'), /Next task: tasks\/<slug>/);
    assert.match(filingRules.task_schema.guidance.join('\n'), /Do not use ops\/tasks\.md/);
    assert.match(filingRules.filing_principles.join('\n'), /Use tasks\/ for assignable work by default/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('check-update skill applies filing-rule updates without clobbering user customizations', async () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const [skill, automation] = await Promise.all([
    fs.readFile(path.join(repoRoot, 'skills/bigbrain-check-update/SKILL.md'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'automations/bigbrain-check-update/automation.toml'), 'utf8'),
  ]);

  assert.match(skill, /## Filing-Rule Update Policy/);
  assert.match(skill, /matches the default wording from the previous/);
  assert.match(skill, /merge the new release's filing-rule changes/);
  assert.match(skill, /keep the user's\s+rule/);
  assert.match(automation, /apply release filing-rule changes/);
  assert.match(automation, /preserving the user's rules/);
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

async function writeAllDefaultFilingRules(brainHome) {
  await writeMarkdown(brainHome, 'FILING.md', '# Brain Filing\n\nShared filing rules.\n');
  const entries = await fs.readdir(brainHome, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    await writeMarkdown(brainHome, `${entry.name}/FILING.md`, `# ${entry.name} Filing\n\nRules for ${entry.name}.\n`);
  }
}

async function writeAutomationToml(automationRoot, id, content) {
  const fullPath = path.join(automationRoot, id, 'automation.toml');
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
}

async function runNode(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      ...options,
      env: { ...process.env, ...(options.env || {}) },
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('exit', (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

async function waitForStdoutLine(child, chunks, pattern) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${pattern}. Stdout: ${Buffer.concat(chunks).toString('utf8')}`));
    }, 10_000);
    const onData = () => {
      const line = Buffer.concat(chunks).toString('utf8').split(/\r?\n/).find((candidate) => pattern.test(candidate));
      if (line) {
        cleanup();
        resolve(line);
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`Process exited before ${pattern} with code ${code}. Stdout: ${Buffer.concat(chunks).toString('utf8')}`));
    };
    function cleanup() {
      clearTimeout(timeout);
      child.stdout.off('data', onData);
      child.off('exit', onExit);
    }
    child.stdout.on('data', onData);
    child.once('exit', onExit);
    onData();
  });
}
