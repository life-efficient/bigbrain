import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { initializeBrainHome, loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { metricGlossary } from './eval-metrics.js';
import { searchBrain } from './search.js';
import { syncBrain } from './sync.js';

const DEFAULT_LIMIT = 5;
const DEFAULT_MODE = 'conservative';
const DEFAULT_REPLAY_K = 3;
const QUALITY_FAMILIES = Object.freeze([
  'title-substring',
  'generic-to-named',
  'alias-synonym',
  'multi-chunk-dilution',
  'short-vs-rich',
  'graph-relationship',
  'hard-negative',
]);

const DEFAULT_GATES = Object.freeze({
  'title-substring': { hit_at_1_rate: 0.95 },
  'multi-chunk-dilution': { hit_at_3_rate: 1 },
  'alias-synonym': { hit_at_1_rate: 0.98 },
});

const SOFT_GATES = Object.freeze({
  'generic-to-named': { hit_at_3_rate: 0.8 },
  'short-vs-rich': { hit_at_3_rate: 0.8 },
  'graph-relationship': { hit_at_3_rate: 0.8 },
  'hard-negative': { negative_clean_rate: 0.8 },
});

const FIXTURE_PAGES = [
  {
    path: 'people/aurora-vale.md',
    markdown: `---
title: Aurora Vale
aliases: [AV Lead]
---
# Aurora Vale

Aurora Vale owns the Lumen Orchard partner process.
`,
  },
  {
    path: 'projects/lumen-orchard.md',
    markdown: `---
title: Lumen Orchard
aliases: Light Grove
---
# Lumen Orchard

Lumen Orchard is the canonical operating project for the partner launch.
Aurora Vale is the project owner.
`,
  },
  {
    path: 'deals/lumen-orchard-process-status.md',
    markdown: `---
title: Lumen Orchard Process Status
---
# Lumen Orchard Process Status

The current state with Aurora Vale and Rowan Pike is a monthly preparation cycle before a broader partner process.
Next step is to review buyer priorities and confirm the next check-in.
`,
  },
  {
    path: 'people/rowan-pike.md',
    markdown: `---
title: Rowan Pike
---
# Rowan Pike

Rowan Pike is involved in the Lumen Orchard process discussions.
`,
  },
  {
    path: 'projects/cinder-canvas.md',
    markdown: `---
title: Cinder Canvas
---
# Cinder Canvas

Cinder Canvas is the canonical operating project page for the app workstream.
`,
  },
  {
    path: 'concepts/cinder-proposal-notes.md',
    markdown: `---
title: Cinder Proposal Notes
---
# Cinder Proposal Notes

Notes from proposal drafting for the Cinder Canvas app.
`,
  },
  {
    path: 'ops/current-priorities.md',
    markdown: `---
title: Current Priorities
---
# Current Priorities

Next on my TODO list is to review the buyer priorities, tighten the website copy, and follow up on the app proposal.
`,
  },
  {
    path: 'companies/ember-ai.md',
    markdown: `---
title: Ember AI
---
# Ember AI

I mention Ember AI recently in advisory discussions as a reference point for AI implementation services.
`,
  },
  {
    path: 'projects/seed-stage-advisory.md',
    markdown: `---
title: Seed-Stage Advisory
---
# Seed-Stage Advisory

Seed-stage companies I have advised include software, education, and workflow startups at the early operating stage.
`,
  },
  {
    path: 'concepts/solarium.md',
    markdown: `---
title: Solarium
aliases: [Sun Room]
---
# Solarium

Canonical concept page for the sun room.
`,
  },
  {
    path: 'notes/room-naming-mention.md',
    markdown: `---
title: Room Naming Mention
---
# Room Naming Mention

A passing note about room naming without canonical concept evidence.
`,
  },
  {
    path: 'projects/long-mosaic.md',
    markdown: `---
title: Long Mosaic
---
# Long Mosaic

Long Mosaic is the canonical source for the multi-chunk dilution target.

## Notes

The durable retrieval phrase is prism ledger route.

${Array.from({ length: 24 }, (_, index) => `Background paragraph ${index + 1} repeats ordinary planning text without the target phrase.`).join('\n\n')}
`,
  },
  {
    path: 'projects/short-mosaic-summary.md',
    markdown: `---
title: Short Mosaic Summary
---
# Short Mosaic Summary

Brief note that references Long Mosaic without carrying the prism ledger route evidence.
`,
  },
  {
    path: 'people/harbor-contact.md',
    markdown: `---
title: Harbor Contact
---
# Harbor Contact

The Harbor Contact page links to [Lumen Orchard](../projects/lumen-orchard.md) as the related project.
`,
  },
  {
    path: 'notes/decoy-prism-ledger.md',
    markdown: `---
title: Decoy Prism Ledger
---
# Decoy Prism Ledger

This note mentions prism ledger route as an unrelated negative example.
`,
  },
];

const FIXTURE_CASES = [
  { id: 'title-substring-person', family: 'title-substring', query: 'Aurora Vale', expected_slug: 'people/aurora-vale' },
  { id: 'title-substring-project', family: 'title-substring', query: 'Lumen Orchard', expected_slug: 'projects/lumen-orchard' },
  { id: 'generic-to-named-current-state', family: 'generic-to-named', query: 'Aurora Rowan current state', expected_slug: 'deals/lumen-orchard-process-status' },
  { id: 'generic-to-named-todo', family: 'generic-to-named', query: "What's next on my TODO list?", expected_slug: 'ops/current-priorities' },
  { id: 'alias-synonym-inline-array', family: 'alias-synonym', query: 'Sun Room', expected_slug: 'concepts/solarium' },
  { id: 'alias-synonym-string', family: 'alias-synonym', query: 'Light Grove', expected_slug: 'projects/lumen-orchard' },
  { id: 'multi-chunk-dilution', family: 'multi-chunk-dilution', query: 'prism ledger route', expected_slug: 'projects/long-mosaic', acceptable_slugs: ['notes/decoy-prism-ledger'] },
  { id: 'short-vs-rich', family: 'short-vs-rich', query: 'canonical operating project for Cinder Canvas app', expected_slug: 'projects/cinder-canvas' },
  { id: 'graph-relationship', family: 'graph-relationship', query: 'Harbor Contact related project', expected_slug: 'people/harbor-contact', acceptable_slugs: ['projects/lumen-orchard'] },
  { id: 'hard-negative', family: 'hard-negative', query: 'prism ledger route unrelated negative', expected_slug: 'notes/decoy-prism-ledger', forbidden_slugs: ['projects/long-mosaic'] },
  { id: 'recent-mention', family: 'generic-to-named', query: 'what did i mention recently about ember ai?', expected_slug: 'companies/ember-ai' },
  { id: 'advisory-history', family: 'generic-to-named', query: 'What seed-stage companies have I advised?', expected_slug: 'projects/seed-stage-advisory' },
];

export function defaultPrivateRetrievalEvalCasesPath(env = process.env) {
  return path.join(path.resolve(env.HOME || os.homedir()), '.config', 'bigbrain', 'evals', 'retrieval-cases.jsonl');
}

export async function maybeLoadDefaultPrivateRetrievalEvalCases(env = process.env) {
  const filePath = defaultPrivateRetrievalEvalCasesPath(env);
  try {
    return { path: filePath, cases: await loadRetrievalEvalCases(filePath) };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function runRetrievalEval({
  mode = DEFAULT_MODE,
  limit = DEFAULT_LIMIT,
  apiKey = null,
  cases = FIXTURE_CASES,
  pages = FIXTURE_PAGES,
  failOnRegression = true,
  redact = false,
} = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-eval-retrieval-'));
  try {
    const brainHome = path.join(rootDir, 'brain-home');
    const init = await initializeBrainHome(brainHome, {
      env: {
        ...process.env,
        BIGBRAIN_POINTER_PATH: path.join(rootDir, 'pointer'),
        BIGBRAIN_STATE_ROOT: path.join(rootDir, 'state-root'),
      },
    });
    for (const page of pages) {
      const fullPath = path.join(brainHome, page.path);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, page.markdown, 'utf8');
    }

    const config = await loadConfig({ configPath: init.configPath });
    await syncBrain({ config, apiKey: null });
    return await runRetrievalEvalOnConfig({
      config,
      mode,
      limit,
      apiKey,
      cases,
      caseSource: 'fixture',
      failOnRegression,
      redact,
    });
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

export async function runRetrievalEvalOnConfig({
  config,
  mode = DEFAULT_MODE,
  limit = DEFAULT_LIMIT,
  apiKey = null,
  cases,
  caseSource = 'external',
  failOnRegression = false,
  redact = false,
}) {
  const normalizedCases = validateCases(cases);
  const db = await openDatabase(config);
  try {
    const results = [];
    for (const testCase of normalizedCases) {
      const started = performance.now();
      const search = await searchBrain({
        db,
        config,
        query: testCase.query,
        limit,
        mode,
        apiKey,
        explain: true,
      });
      const latencyMs = Math.round(performance.now() - started);
      results.push(scoreCase({ testCase, search, latencyMs, redact }));
    }
    return buildEvalReport({ mode, limit, results, caseSource, failOnRegression, redact });
  } finally {
    await db.close?.();
  }
}

export async function loadRetrievalEvalCases(filePath) {
  const resolved = path.resolve(filePath);
  const raw = await fs.readFile(resolved, 'utf8');
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`Retrieval eval cases file is empty: ${filePath}`);
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      return validateCases(Array.isArray(parsed) ? parsed : parsed.cases);
    } catch (error) {
      if (!trimmed.includes('\n')) throw error;
    }
  }
  return validateCases(trimmed
    .split('\n')
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
    .map((line) => JSON.parse(line)));
}

export async function exportRetrievalEvalBaseline({
  config,
  mode = DEFAULT_MODE,
  limit = DEFAULT_LIMIT,
  apiKey = null,
  cases,
  caseSource = 'external',
  redact = false,
} = {}) {
  const report = await runRetrievalEvalOnConfig({ config, mode, limit, apiKey, cases, caseSource, redact });
  const exportedAt = new Date().toISOString();
  return report.results.map((result) => ({
    schema_version: 1,
    exported_at: exportedAt,
    suite: 'retrieval',
    mode,
    limit,
    case_source: report.case_source,
    case_id: result.id,
    family: result.family,
    query: result.query,
    expected_slug: result.expected_slug,
    relevant_slugs: result.relevant_slugs,
    forbidden_slugs: result.forbidden_slugs,
    result_slugs: result.result_slugs,
    top_slug: result.top_slug,
    latency_ms: result.latency_ms,
  }));
}

export function renderRetrievalEvalBaselineNdjson(rows) {
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
}

export async function replayRetrievalEvalBaseline({
  config,
  baselinePath,
  mode = null,
  limit = null,
  apiKey = null,
  redact = false,
} = {}) {
  const baseline = await loadBaselineRows(baselinePath);
  const cases = baseline.map((row) => ({
    id: row.case_id,
    family: row.family,
    query: row.query,
    expected_slug: row.expected_slug,
    relevant_slugs: row.relevant_slugs,
    forbidden_slugs: row.forbidden_slugs,
  }));
  const effectiveMode = mode || baseline[0]?.mode || DEFAULT_MODE;
  const effectiveLimit = limit || baseline[0]?.limit || DEFAULT_LIMIT;
  const current = await runRetrievalEvalOnConfig({
    config,
    mode: effectiveMode,
    limit: effectiveLimit,
    apiKey,
    cases,
    caseSource: 'replay',
    redact,
  });
  const currentById = new Map(current.results.map((result) => [result.id, result]));
  const comparisons = baseline.map((row) => {
    const result = currentById.get(row.case_id);
    const baselineSlugs = row.result_slugs ?? [];
    const currentSlugs = result?.result_slugs ?? [];
    const k = Math.min(DEFAULT_REPLAY_K, Math.max(baselineSlugs.length, currentSlugs.length, DEFAULT_REPLAY_K));
    return {
      case_id: row.case_id,
      family: row.family ?? 'default',
      baseline_top_slug: row.top_slug ?? baselineSlugs[0] ?? null,
      current_top_slug: result?.top_slug ?? null,
      top1_stable: (row.top_slug ?? baselineSlugs[0] ?? null) === (result?.top_slug ?? null),
      jaccard_at_k: jaccardAtK(baselineSlugs, currentSlugs, k),
      baseline_latency_ms: row.latency_ms ?? null,
      current_latency_ms: result?.latency_ms ?? null,
      latency_delta_ms: Number.isFinite(row.latency_ms) && Number.isFinite(result?.latency_ms)
        ? result.latency_ms - row.latency_ms
        : null,
      moved: (row.top_slug ?? baselineSlugs[0] ?? null) !== (result?.top_slug ?? null),
    };
  });
  const latencyDeltas = comparisons.map((row) => row.latency_delta_ms).filter(Number.isFinite);
  return {
    schema_version: 1,
    baseline_path: path.resolve(baselinePath),
    mode: effectiveMode,
    limit: effectiveLimit,
    case_count: comparisons.length,
    metrics: {
      mean_jaccard_at_k: mean(comparisons.map((row) => row.jaccard_at_k)),
      top1_stability_rate: rate(comparisons, (row) => row.top1_stable),
      mean_latency_delta_ms: latencyDeltas.length ? mean(latencyDeltas) : null,
    },
    moved_queries: comparisons.filter((row) => row.moved),
    comparisons,
    _meta: {
      metric_glossary: metricGlossary(['jaccard_at_k', 'top1_stability', 'mean_latency_delta_ms']),
    },
  };
}

export async function compareRetrievalEvalModes({
  config,
  modes = ['conservative', 'balanced', 'tokenmax'],
  limit = DEFAULT_LIMIT,
  apiKey = null,
  cases,
  caseSource = 'external',
  failOnRegression = false,
  redact = false,
} = {}) {
  const reports = [];
  for (const mode of modes) {
    reports.push(await runRetrievalEvalOnConfig({
      config,
      mode,
      limit,
      apiKey,
      cases,
      caseSource,
      failOnRegression,
      redact,
    }));
  }
  return {
    schema_version: 1,
    suite: 'retrieval',
    limit,
    case_source: caseSource,
    modes: Object.fromEntries(reports.map((report) => [report.mode, {
      metrics: report.metrics,
      family_metrics: report.family_metrics,
      gates: report.gates,
      warnings: report.warnings,
    }])),
    reports,
    _meta: {
      metric_glossary: metricGlossary(),
    },
  };
}

export function renderRetrievalEvalText(report) {
  const lines = [
    `Retrieval eval (${report.mode}, limit ${report.limit})`,
    `Cases: ${report.case_count}`,
    `Hit@1: ${report.metrics.hit_at_1}/${report.case_count} (${formatPct(report.metrics.hit_at_1_rate)})`,
    `Hit@3: ${report.metrics.hit_at_3}/${report.case_count} (${formatPct(report.metrics.hit_at_3_rate)})`,
    `MRR: ${formatNumber(report.metrics.mrr)}`,
    `Recall@k: ${formatPct(report.metrics.recall_at_k)}`,
    `Negative clean: ${report.metrics.negative_case_count ? `${report.metrics.negative_clean}/${report.metrics.negative_case_count} (${formatPct(report.metrics.negative_clean_rate)})` : 'n/a'}`,
    `Gates: ${report.gates.passed ? 'PASS' : 'FAIL'} (${report.gates.failures.length} failure(s), ${report.gates.warnings.length} warning(s))`,
    '',
  ];
  for (const [family, metrics] of Object.entries(report.family_metrics)) {
    lines.push(`${family}: Hit@1 ${formatPct(metrics.hit_at_1_rate)}, Hit@3 ${formatPct(metrics.hit_at_3_rate)}, MRR ${formatNumber(metrics.mrr)}`);
  }
  lines.push('');
  for (const result of report.results) {
    const status = result.passed ? 'PASS' : 'FAIL';
    const rank = result.rank === null ? 'missing' : `rank ${result.rank}`;
    lines.push(`${status} ${result.id}: expected ${result.expected_slug}, got ${result.top_slug ?? 'none'} (${rank})`);
  }
  if (report.gates.failures.length) {
    lines.push('', 'Gate failures:', ...report.gates.failures.map((failure) => `- ${failure.family} ${failure.metric}: ${formatNumber(failure.actual)} < ${formatNumber(failure.expected)}`));
  }
  if (report.gates.warnings.length) {
    lines.push('', 'Gate warnings:', ...report.gates.warnings.map((warning) => `- ${warning.family} ${warning.metric}: ${formatNumber(warning.actual)} < ${formatNumber(warning.expected)}`));
  }
  return lines.join('\n');
}

export function renderRetrievalReplayText(report) {
  return [
    `Retrieval replay (${report.mode}, limit ${report.limit})`,
    `Cases: ${report.case_count}`,
    `Mean Jaccard@${DEFAULT_REPLAY_K}: ${formatNumber(report.metrics.mean_jaccard_at_k)}`,
    `Top-1 stability: ${formatPct(report.metrics.top1_stability_rate)}`,
    `Mean latency delta: ${report.metrics.mean_latency_delta_ms === null ? 'n/a' : `${formatNumber(report.metrics.mean_latency_delta_ms)}ms`}`,
    `Moved queries: ${report.moved_queries.length}`,
    ...report.moved_queries.map((row) => `- ${row.case_id}: ${row.baseline_top_slug ?? 'none'} -> ${row.current_top_slug ?? 'none'}`),
  ].join('\n');
}

export function renderRetrievalCompareText(report, { markdown = false } = {}) {
  const rows = Object.entries(report.modes).map(([mode, value]) => ({
    mode,
    hit1: value.metrics.hit_at_1_rate,
    hit3: value.metrics.hit_at_3_rate,
    mrr: value.metrics.mrr,
    recall: value.metrics.recall_at_k,
    gates: value.gates.passed ? 'PASS' : 'FAIL',
  }));
  if (markdown) {
    return [
      '| Mode | Hit@1 | Hit@3 | MRR | Recall@k | Gates |',
      '| --- | ---: | ---: | ---: | ---: | --- |',
      ...rows.map((row) => `| ${row.mode} | ${formatPct(row.hit1)} | ${formatPct(row.hit3)} | ${formatNumber(row.mrr)} | ${formatPct(row.recall)} | ${row.gates} |`),
    ].join('\n');
  }
  return [
    `Retrieval compare (limit ${report.limit})`,
    ...rows.map((row) => `${row.mode}: Hit@1 ${formatPct(row.hit1)}, Hit@3 ${formatPct(row.hit3)}, MRR ${formatNumber(row.mrr)}, Recall@k ${formatPct(row.recall)}, Gates ${row.gates}`),
  ].join('\n');
}

function scoreCase({ testCase, search, latencyMs, redact }) {
  const slugs = search.fused.map((row) => row.slug);
  const relevantSlugs = testCase.relevant_slugs.length ? testCase.relevant_slugs : [testCase.expected_slug].filter(Boolean);
  const ranks = relevantSlugs
    .map((slug) => slugs.indexOf(slug))
    .filter((rank) => rank >= 0);
  const bestRank = ranks.length ? Math.min(...ranks) : -1;
  const forbiddenHits = testCase.forbidden_slugs.filter((slug) => slugs.includes(slug));
  const negativeClean = testCase.forbidden_slugs.length ? forbiddenHits.length === 0 : null;
  const recallHits = relevantSlugs.filter((slug) => slugs.includes(slug)).length;
  const query = redact ? null : testCase.query;
  return {
    id: testCase.id,
    family: testCase.family,
    query,
    expected_slug: redact ? redactSlug(testCase.expected_slug) : testCase.expected_slug,
    acceptable_slugs: redact ? testCase.acceptable_slugs.map(redactSlug) : testCase.acceptable_slugs,
    relevant_slugs: redact ? relevantSlugs.map(redactSlug) : relevantSlugs,
    forbidden_slugs: redact ? testCase.forbidden_slugs.map(redactSlug) : testCase.forbidden_slugs,
    forbidden_hits: redact ? forbiddenHits.map(redactSlug) : forbiddenHits,
    top_slug: redact ? redactSlug(slugs[0] ?? null) : slugs[0] ?? null,
    rank: bestRank >= 0 ? bestRank + 1 : null,
    reciprocal_rank: bestRank >= 0 ? 1 / (bestRank + 1) : 0,
    hit_at_1: bestRank === 0,
    hit_at_3: bestRank >= 0 && bestRank < 3,
    recall_at_k: relevantSlugs.length ? recallHits / relevantSlugs.length : 0,
    negative_clean: negativeClean,
    passed: bestRank >= 0 && negativeClean !== false,
    result_slugs: redact ? slugs.map(redactSlug) : slugs,
    latency_ms: latencyMs,
    warnings: search.warnings,
  };
}

function buildEvalReport({ mode, limit, results, caseSource = 'fixture', failOnRegression = false, redact = false }) {
  const metrics = summarizeResults(results);
  const familyMetrics = summarizeFamilies(results);
  const gates = evaluateGates({ familyMetrics, failOnRegression });
  const warnings = [
    ...new Set(results.flatMap((result) => result.warnings ?? [])),
    ...gates.warnings.map((warning) => `soft gate warning: ${warning.family} ${warning.metric} ${formatNumber(warning.actual)} < ${formatNumber(warning.expected)}`),
  ];
  return {
    schema_version: 2,
    suite: 'retrieval',
    mode,
    limit,
    case_source: caseSource,
    case_count: results.length,
    families: QUALITY_FAMILIES,
    metrics,
    family_metrics: familyMetrics,
    gates,
    warnings,
    redacted: redact,
    results,
    _meta: {
      metric_glossary: metricGlossary(['hit_at_1', 'hit_at_3', 'mrr', 'recall_at_k', 'negative_clean_rate']),
    },
  };
}

function summarizeResults(results) {
  const hitAt1 = results.filter((result) => result.hit_at_1).length;
  const hitAt3 = results.filter((result) => result.hit_at_3).length;
  const negativeCases = results.filter((result) => result.negative_clean !== null);
  const negativeClean = negativeCases.filter((result) => result.negative_clean).length;
  return {
    hit_at_1: hitAt1,
    hit_at_1_rate: rate(results, (result) => result.hit_at_1),
    hit_at_3: hitAt3,
    hit_at_3_rate: rate(results, (result) => result.hit_at_3),
    mrr: mean(results.map((result) => result.reciprocal_rank)),
    recall_at_k: mean(results.map((result) => result.recall_at_k)),
    negative_case_count: negativeCases.length,
    negative_clean: negativeClean,
    negative_clean_rate: negativeCases.length ? negativeClean / negativeCases.length : 1,
    latency_ms_avg: mean(results.map((result) => result.latency_ms)),
  };
}

function summarizeFamilies(results) {
  const grouped = new Map();
  for (const result of results) {
    const family = result.family || 'default';
    if (!grouped.has(family)) grouped.set(family, []);
    grouped.get(family).push(result);
  }
  return Object.fromEntries([...grouped.entries()].map(([family, rows]) => [family, {
    case_count: rows.length,
    ...summarizeResults(rows),
  }]));
}

function evaluateGates({ familyMetrics, failOnRegression }) {
  const hardFailures = gateFailures(familyMetrics, DEFAULT_GATES);
  const softFailures = gateFailures(familyMetrics, SOFT_GATES);
  const promotedSoftFailures = failOnRegression ? softFailures : [];
  return {
    passed: hardFailures.length === 0 && promotedSoftFailures.length === 0,
    hard_failures: hardFailures,
    soft_failures: softFailures,
    failures: [...hardFailures, ...promotedSoftFailures],
    warnings: failOnRegression ? [] : softFailures,
  };
}

function gateFailures(familyMetrics, gates) {
  const failures = [];
  for (const [family, requirements] of Object.entries(gates)) {
    const metrics = familyMetrics[family];
    if (!metrics) continue;
    for (const [metric, expected] of Object.entries(requirements)) {
      const actual = metrics[metric] ?? 0;
      if (actual < expected) failures.push({ family, metric, expected, actual });
    }
  }
  return failures;
}

function validateCases(cases) {
  if (!Array.isArray(cases) || cases.length === 0) throw new Error('Retrieval eval requires at least one case.');
  return cases.map((testCase, index) => {
    if (!testCase || typeof testCase !== 'object') throw new Error(`Invalid retrieval eval case at index ${index}.`);
    const id = typeof testCase.id === 'string' && testCase.id.trim() ? testCase.id.trim() : `case-${index + 1}`;
    const query = requireCaseString(testCase.query, `case ${id} query`);
    const expectedSlug = optionalCaseString(testCase.expected_slug);
    const acceptableSlugs = stringArray(testCase.acceptable_slugs);
    const relevantSlugs = stringArray(testCase.relevant_slugs);
    const finalRelevantSlugs = relevantSlugs.length
      ? relevantSlugs
      : [expectedSlug, ...acceptableSlugs].filter(Boolean);
    if (!expectedSlug && finalRelevantSlugs.length === 0) {
      throw new Error(`Missing case ${id} expected_slug or relevant_slugs.`);
    }
    const family = optionalCaseString(testCase.family) || 'default';
    return {
      id,
      family,
      query,
      expected_slug: expectedSlug || finalRelevantSlugs[0],
      acceptable_slugs: acceptableSlugs,
      relevant_slugs: finalRelevantSlugs,
      forbidden_slugs: stringArray(testCase.forbidden_slugs),
      notes: optionalCaseString(testCase.notes) || null,
      metadata: testCase.metadata && typeof testCase.metadata === 'object' ? testCase.metadata : {},
    };
  });
}

async function loadBaselineRows(filePath) {
  const raw = await fs.readFile(path.resolve(filePath), 'utf8');
  const rows = raw.trim()
    .split('\n')
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
    .map((line) => JSON.parse(line));
  if (!rows.length) throw new Error(`Retrieval replay baseline is empty: ${filePath}`);
  return rows;
}

function requireCaseString(value, label) {
  const string = optionalCaseString(value);
  if (!string) throw new Error(`Missing ${label}.`);
  return string;
}

function optionalCaseString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : [];
}

function jaccardAtK(left, right, k) {
  const leftSet = new Set(left.slice(0, k));
  const rightSet = new Set(right.slice(0, k));
  const union = new Set([...leftSet, ...rightSet]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const slug of leftSet) {
    if (rightSet.has(slug)) intersection += 1;
  }
  return intersection / union.size;
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0;
}

function rate(rows, predicate) {
  return rows.length ? rows.filter(predicate).length / rows.length : 0;
}

function redactSlug(slug) {
  if (!slug) return null;
  let hash = 0;
  for (const char of slug) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return `slug-${Math.abs(hash).toString(16)}`;
}

function formatPct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(3) : 'n/a';
}
