import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  exactTwoSidedMcNemarPValue,
  loadRetrievalEvalCases,
  pairedEndpointHitComparison,
  scoreRetrievalEvalCase,
  summarizeRetrievalEvalResults,
  validateRetrievalEvalCases,
  wilson95ConfidenceInterval,
} from '../../src/bigbrain/eval-retrieval.js';

test('v2 labels normalize without changing legacy relevant slug behavior', async () => {
  const [legacy, v2] = validateRetrievalEvalCases([
    {
      id: 'legacy',
      query: 'legacy query',
      expected_slug: 'people/primary',
      acceptable_slugs: ['people/alternate'],
    },
    {
      id: 'v2',
      query: 'relationship query',
      expected_slug: 'organizations/endpoint',
      relevant_slugs: ['organizations/endpoint', 'organizations/endpoint'],
      supporting_slugs: ['meetings/path', 'meetings/path'],
      distractor_slugs: ['organizations/near-match'],
      required_source_groups: [
        ['meetings/path', 'meetings/alternate-path', 'meetings/path'],
        ['people/participant'],
      ],
    },
  ]);

  assert.deepEqual(legacy.relevant_slugs, ['people/primary', 'people/alternate']);
  assert.deepEqual(legacy.supporting_slugs, []);
  assert.deepEqual(legacy.distractor_slugs, []);
  assert.deepEqual(legacy.required_source_groups, []);

  assert.deepEqual(v2.relevant_slugs, ['organizations/endpoint']);
  assert.deepEqual(v2.supporting_slugs, ['meetings/path']);
  assert.deepEqual(v2.distractor_slugs, ['organizations/near-match']);
  assert.deepEqual(v2.required_source_groups, [
    ['meetings/path', 'meetings/alternate-path'],
    ['people/participant'],
  ]);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-eval-v2-'));
  try {
    const casesPath = path.join(root, 'cases.jsonl');
    await fs.writeFile(casesPath, `# v2 case\n${JSON.stringify({
      id: 'loaded-v2',
      query: 'loaded query',
      relevant_slugs: ['projects/endpoint'],
      supporting_slugs: ['meetings/support'],
      distractor_slugs: ['projects/distractor'],
      required_source_groups: [['meetings/support']],
    })}\n`, 'utf8');
    const [loaded] = await loadRetrievalEvalCases(casesPath);
    assert.deepEqual(loaded.supporting_slugs, ['meetings/support']);
    assert.deepEqual(loaded.required_source_groups, [['meetings/support']]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('v2 labels reject contradictory roles and empty required source groups', () => {
  const base = {
    id: 'invalid-v2',
    query: 'invalid labels',
    expected_slug: 'projects/endpoint',
  };

  assert.throws(
    () => validateRetrievalEvalCases([{ ...base, supporting_slugs: ['projects/endpoint'] }]),
    /both endpoint and supporting/,
  );
  assert.throws(
    () => validateRetrievalEvalCases([{ ...base, distractor_slugs: ['projects/endpoint'] }]),
    /both endpoint and distractor/,
  );
  assert.throws(
    () => validateRetrievalEvalCases([{ ...base, required_source_groups: [[]] }]),
    /must contain at least one slug/,
  );
  assert.throws(
    () => validateRetrievalEvalCases([{ ...base, required_source_groups: 'projects/source' }]),
    /must be an array/,
  );
});

test('supporting and distractor labels stay separate from endpoint metrics', () => {
  const [testCase] = validateRetrievalEvalCases([{
    id: 'ranked-v2',
    family: 'two_hop_relation',
    query: 'find the endpoint',
    expected_slug: 'organizations/expected',
    relevant_slugs: ['organizations/expected', 'organizations/acceptable'],
    supporting_slugs: ['meetings/support-one', 'people/support-two'],
    distractor_slugs: ['organizations/distractor'],
    required_source_groups: [
      ['meetings/support-one', 'meetings/support-alternate'],
      ['people/group-two'],
    ],
  }]);

  const result = scoreRetrievalEvalCase({
    testCase,
    search: {
      fused: [
        { slug: 'organizations/distractor' },
        { slug: 'organizations/acceptable' },
        { slug: 'meetings/support-one' },
        { slug: 'people/group-two' },
        { slug: 'organizations/expected' },
      ],
      warnings: [],
    },
    latencyMs: 7,
  });

  assert.equal(result.rank, 2);
  assert.equal(result.endpoint_rank, 2);
  assert.equal(result.hit_at_3, true);
  assert.equal(result.endpoint_recall_at_k, 1);
  assert.equal(result.expected_rank, 5);
  assert.equal(result.expected_hit_at_5, true);
  assert.equal(result.supporting_recall_at_k, 0.5);
  assert.deepEqual(result.supporting_hits, ['meetings/support-one']);
  assert.equal(result.distractor_clean, false);
  assert.equal(result.expected_outranks_distractors, false);
  assert.equal(result.required_source_group_recall, 1);
  assert.deepEqual(result.missing_source_groups, []);
  assert.equal(result.passed, true, 'distractors are diagnostic and do not fail the case');
});

test('supporting hits never satisfy endpoint success and required source groups do', () => {
  const [supportOnlyCase, missingGroupCase] = validateRetrievalEvalCases([
    {
      id: 'support-only',
      query: 'support is not the answer',
      expected_slug: 'projects/endpoint',
      supporting_slugs: ['meetings/support'],
    },
    {
      id: 'missing-group',
      query: 'endpoint needs sources',
      expected_slug: 'projects/endpoint',
      required_source_groups: [['sources/one'], ['sources/two']],
    },
  ]);

  const supportOnly = scoreRetrievalEvalCase({
    testCase: supportOnlyCase,
    search: { fused: [{ slug: 'meetings/support' }], warnings: [] },
    latencyMs: 1,
  });
  assert.equal(supportOnly.supporting_recall_at_k, 1);
  assert.equal(supportOnly.rank, null);
  assert.equal(supportOnly.hit_at_1, false);
  assert.equal(supportOnly.passed, false);

  const missingGroup = scoreRetrievalEvalCase({
    testCase: missingGroupCase,
    search: {
      fused: [{ slug: 'projects/endpoint' }, { slug: 'sources/one' }],
      warnings: [],
    },
    latencyMs: 1,
  });
  assert.equal(missingGroup.rank, 1);
  assert.equal(missingGroup.required_source_group_recall, 0.5);
  assert.deepEqual(missingGroup.missing_source_groups, [['sources/two']]);
  assert.equal(missingGroup.passed, false);
});

test('v2 aggregate metrics report endpoint, support, distractor, and source coverage independently', () => {
  const cases = validateRetrievalEvalCases([
    {
      id: 'first',
      query: 'first',
      expected_slug: 'projects/expected-one',
      relevant_slugs: ['projects/expected-one', 'projects/alternate-one'],
      supporting_slugs: ['sources/support-one', 'sources/support-two'],
      distractor_slugs: ['projects/distractor'],
      required_source_groups: [['sources/support-one'], ['people/group-two']],
    },
    {
      id: 'second',
      query: 'second',
      expected_slug: 'projects/expected-two',
      supporting_slugs: ['sources/support-three'],
      distractor_slugs: ['projects/absent-distractor'],
      required_source_groups: [['sources/group-three'], ['sources/missing']],
    },
  ]);
  const first = scoreRetrievalEvalCase({
    testCase: cases[0],
    search: { fused: [
      { slug: 'projects/distractor' },
      { slug: 'projects/alternate-one' },
      { slug: 'sources/support-one' },
      { slug: 'people/group-two' },
      { slug: 'projects/expected-one' },
    ], warnings: [] },
    latencyMs: 3,
  });
  const second = scoreRetrievalEvalCase({
    testCase: cases[1],
    search: { fused: [
      { slug: 'projects/expected-two' },
      { slug: 'sources/group-three' },
    ], warnings: [] },
    latencyMs: 5,
  });

  const metrics = summarizeRetrievalEvalResults([first, second]);
  assert.equal(metrics.endpoint_hit_at_1, 1);
  assert.equal(metrics.endpoint_hit_at_3, 2);
  assert.equal(metrics.expected_hit_at_1, 1);
  assert.equal(metrics.expected_hit_at_5, 2);
  assert.equal(metrics.supporting_recall_at_k, 0.25);
  assert.equal(metrics.distractor_case_count, 2);
  assert.equal(metrics.distractor_clean_rate, 0.5);
  assert.equal(metrics.expected_vs_distractor_case_count, 1);
  assert.equal(metrics.expected_outranks_distractors_rate, 0);
  assert.equal(metrics.required_source_group_recall, 0.75);
  assert.equal(metrics.required_source_groups_satisfied, 1);
  assert.equal(metrics.required_source_groups_satisfied_rate, 0.5);
});

test('redaction covers all v2 slug labels and nested source groups', () => {
  const [testCase] = validateRetrievalEvalCases([{
    id: 'redacted-v2',
    query: 'private relationship',
    expected_slug: 'projects/private-endpoint',
    supporting_slugs: ['meetings/private-support'],
    distractor_slugs: ['projects/private-distractor'],
    required_source_groups: [['meetings/private-support', 'people/private-alternative']],
  }]);
  const result = scoreRetrievalEvalCase({
    testCase,
    search: { fused: [
      { slug: 'projects/private-endpoint' },
      { slug: 'meetings/private-support' },
      { slug: 'projects/private-distractor' },
    ], warnings: [] },
    latencyMs: 1,
    redact: true,
  });

  assert.equal(result.query, null);
  assert.match(result.supporting_slugs[0], /^slug-/);
  assert.match(result.distractor_hits[0], /^slug-/);
  assert.match(result.required_source_groups[0][0], /^slug-/);
  assert.equal(JSON.stringify(result).includes('private-support'), false);
});

test('Wilson intervals are deterministic for endpoint hit rates', () => {
  const interval = wilson95ConfidenceInterval(2, 4);
  assert.equal(interval.method, 'wilson');
  assert.equal(interval.confidence_level, 0.95);
  assert.ok(Math.abs(interval.lower - 0.15003898915214947) < 1e-12);
  assert.ok(Math.abs(interval.upper - 0.8499610108478506) < 1e-12);
  assert.deepEqual(wilson95ConfidenceInterval(0, 0), {
    method: 'wilson',
    confidence_level: 0.95,
    lower: null,
    upper: null,
  });
  assert.throws(() => wilson95ConfidenceInterval(5, 4), /integer successes/);
});

test('paired endpoint comparisons use case ids and exact two-sided McNemar p-values', () => {
  const referenceReport = {
    arm: 'hybrid-fusion',
    results: [
      { id: 'a', endpoint_hit_at_1: true, endpoint_hit_at_5: true },
      { id: 'b', endpoint_hit_at_1: false, endpoint_hit_at_5: true },
      { id: 'c', endpoint_hit_at_1: true, endpoint_hit_at_5: false },
      { id: 'd', endpoint_hit_at_1: false, endpoint_hit_at_5: false },
    ],
  };
  const candidateReport = {
    arm: 'hybrid-reranked',
    results: [
      { id: 'd', endpoint_hit_at_1: false, endpoint_hit_at_5: false },
      { id: 'c', endpoint_hit_at_1: false, endpoint_hit_at_5: true },
      { id: 'b', endpoint_hit_at_1: true, endpoint_hit_at_5: false },
      { id: 'a', endpoint_hit_at_1: true, endpoint_hit_at_5: true },
    ],
  };

  const comparison = pairedEndpointHitComparison({ referenceReport, candidateReport });
  assert.deepEqual(comparison.endpoint_hit_at_1, {
    wins: 1,
    losses: 1,
    ties: 2,
    delta: 0,
    exact_two_sided_mcnemar_p_value: 1,
  });
  assert.deepEqual(comparison.endpoint_hit_at_5, {
    wins: 1,
    losses: 1,
    ties: 2,
    delta: 0,
    exact_two_sided_mcnemar_p_value: 1,
  });
  assert.equal(exactTwoSidedMcNemarPValue(4, 0), 0.125);
  assert.equal(exactTwoSidedMcNemarPValue(0, 0), 1);
  assert.throws(
    () => pairedEndpointHitComparison({
      referenceReport,
      candidateReport: { arm: 'semantic-only', results: [{ id: 'different' }] },
    }),
    /identical case ids/,
  );
});
