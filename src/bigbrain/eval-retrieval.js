import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { searchBrain } from './search.js';
import { syncBrain } from './sync.js';

const DEFAULT_LIMIT = 5;

const FIXTURE_PAGES = [
  {
    path: 'people/jordan-lee.md',
    markdown: `---
title: Jordan Lee
---
# Jordan Lee

Jordan Lee is the founder of ExampleCo.
`,
  },
  {
    path: 'projects/exampleco-outreach-playbook.md',
    markdown: `---
title: ExampleCo Outreach Playbook
---
# ExampleCo Outreach Playbook

This playbook packages outreach ideas for Jordan Lee and the ExampleCo sale process.
`,
  },
  {
    path: 'deals/exampleco-process-status.md',
    markdown: `---
title: ExampleCo Process Status
---
# ExampleCo Process Status

Current state with Jordan Lee and Casey is a monthly preparation cycle before a broader process.
Next step is to review buyer priorities and confirm the next check-in.
`,
  },
  {
    path: 'people/casey-morgan.md',
    markdown: `---
title: Casey Morgan
---
# Casey Morgan

Casey Morgan is involved in the ExampleCo process discussions.
`,
  },
  {
    path: 'projects/wellness-app.md',
    markdown: `---
title: Wellness App
---
# Wellness App

Wellness App is the canonical operating project page for the app workstream.
`,
  },
  {
    path: 'concepts/wellness-proposal-notes.md',
    markdown: `---
title: Wellness Proposal Notes
---
# Wellness Proposal Notes

Notes from proposal drafting for the Wellness App.
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
    path: 'companies/example-ai.md',
    markdown: `---
title: Example AI
---
# Example AI

I mention Example AI recently in advisory discussions as a reference point for AI implementation services.
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
    path: 'concepts/mingtang.md',
    markdown: `---
title: Mingtang
aliases: [Hall of Light]
---
# Mingtang

Canonical concept page for the hall.
`,
  },
  {
    path: 'notes/hall-of-light-mention.md',
    markdown: `---
title: Hall of Light Mention
---
# Hall of Light Mention

A passing note that mentions Hall of Light.
`,
  },
];

const FIXTURE_CASES = [
  { id: 'direct-question', query: 'Who is Jordan Lee?', expected_slug: 'people/jordan-lee' },
  { id: 'bare-entity', query: 'Jordan Lee', expected_slug: 'people/jordan-lee' },
  { id: 'process-state', query: 'Jordan Casey state', expected_slug: 'deals/exampleco-process-status' },
  { id: 'canonical-project', query: 'Wellness App', expected_slug: 'projects/wellness-app' },
  { id: 'todo-style', query: "What's next on my TODO list?", expected_slug: 'ops/current-priorities' },
  { id: 'recent-mention', query: 'what did i mention recently about example ai?', expected_slug: 'companies/example-ai' },
  { id: 'advisory-history', query: 'What seed-stage companies have I advised?', expected_slug: 'projects/seed-stage-advisory' },
  { id: 'alias-hop', query: 'Hall of Light', expected_slug: 'concepts/mingtang' },
];

export async function runRetrievalEval({
  mode = 'conservative',
  limit = DEFAULT_LIMIT,
  apiKey = null,
  cases = FIXTURE_CASES,
  pages = FIXTURE_PAGES,
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
    const db = await openDatabase(config);
    try {
      const results = [];
      for (const testCase of cases) {
        const search = await searchBrain({
          db,
          config,
          query: testCase.query,
          limit,
          mode,
          apiKey,
          explain: true,
        });
        const slugs = search.fused.map((row) => row.slug);
        const rank = slugs.indexOf(testCase.expected_slug);
        results.push({
          id: testCase.id,
          query: testCase.query,
          expected_slug: testCase.expected_slug,
          top_slug: slugs[0] ?? null,
          rank: rank >= 0 ? rank + 1 : null,
          hit_at_1: rank === 0,
          hit_at_3: rank >= 0 && rank < 3,
          result_slugs: slugs,
          warnings: search.warnings,
        });
      }
      return buildEvalReport({ mode, limit, results });
    } finally {
      await db.close?.();
    }
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

export function renderRetrievalEvalText(report) {
  const lines = [
    `Retrieval eval (${report.mode}, limit ${report.limit})`,
    `Cases: ${report.case_count}`,
    `Hit@1: ${report.metrics.hit_at_1}/${report.case_count} (${formatPct(report.metrics.hit_at_1_rate)})`,
    `Hit@3: ${report.metrics.hit_at_3}/${report.case_count} (${formatPct(report.metrics.hit_at_3_rate)})`,
    '',
  ];
  for (const result of report.results) {
    const status = result.hit_at_1 ? 'PASS' : 'FAIL';
    const rank = result.rank === null ? 'missing' : `rank ${result.rank}`;
    lines.push(`${status} ${result.id}: expected ${result.expected_slug}, got ${result.top_slug ?? 'none'} (${rank})`);
  }
  return lines.join('\n');
}

function buildEvalReport({ mode, limit, results }) {
  const hitAt1 = results.filter((result) => result.hit_at_1).length;
  const hitAt3 = results.filter((result) => result.hit_at_3).length;
  return {
    schema_version: 1,
    mode,
    limit,
    case_count: results.length,
    metrics: {
      hit_at_1: hitAt1,
      hit_at_1_rate: results.length ? hitAt1 / results.length : 0,
      hit_at_3: hitAt3,
      hit_at_3_rate: results.length ? hitAt3 / results.length : 0,
    },
    results,
  };
}

function formatPct(value) {
  return `${(value * 100).toFixed(1)}%`;
}
