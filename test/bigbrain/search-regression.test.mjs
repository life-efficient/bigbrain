import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { openDatabase } from '../../src/bigbrain/db.js';
import { searchBrain } from '../../src/bigbrain/search.js';
import { syncBrain } from '../../src/bigbrain/sync.js';

test('regression: direct entity lookup keeps the exact entity page first', async () => {
  const fixture = await createFixture('bigbrain-search-regression-entity-');
  try {
    await writeMarkdown(fixture.brainHome, 'people/jordan-lee.md', `---
title: Jordan Lee
---
# Jordan Lee

Jordan Lee is the founder of ExampleCo.
`);
    await writeMarkdown(fixture.brainHome, 'projects/exampleco-outreach-playbook.md', `---
title: ExampleCo Outreach Playbook
---
# ExampleCo Outreach Playbook

This playbook packages outreach ideas for Jordan Lee and the ExampleCo sale process.
`);

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });

    const db = await openDatabase(config);
    const result = await searchBrain({ db, config, query: 'Who is Jordan Lee?', apiKey: null });
    assert.equal(result.fused[0].slug, 'people/jordan-lee');
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('regression: bare exact entity query keeps the entity page first', async () => {
  const fixture = await createFixture('bigbrain-search-regression-bare-entity-');
  try {
    await writeMarkdown(fixture.brainHome, 'people/alex-rivera.md', `---
title: Alex Rivera
---
# Alex Rivera

Alex Rivera is the founder of ExampleCo and a useful customer-discovery contact.
`);
    await writeMarkdown(fixture.brainHome, 'projects/ai-advisory.md', `---
title: AI Advisory
---
# AI Advisory

Alex Rivera mentioned a partner referral as a route to customers for this work.
`);

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });

    const db = await openDatabase(config);
    const result = await searchBrain({ db, config, query: 'Alex Rivera', apiKey: null });
    assert.equal(result.fused[0].slug, 'people/alex-rivera');
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('regression: process query with punctuation still finds the process page', async () => {
  const fixture = await createFixture('bigbrain-search-regression-process-');
  try {
    await writeMarkdown(fixture.brainHome, 'deals/exampleco-process-status.md', `---
title: ExampleCo Process Status
---
# ExampleCo Process Status

Current state with Jordan Lee and Casey is a monthly preparation cycle before a broader process.
Next step is to review buyer priorities and confirm the next check-in.
`);
    await writeMarkdown(fixture.brainHome, 'people/casey-morgan.md', `---
title: Casey Morgan
---
# Casey Morgan

Casey Morgan is involved in the ExampleCo process discussions.
`);
    await writeMarkdown(fixture.brainHome, 'people/jordan-lee.md', `---
title: Jordan Lee
---
# Jordan Lee

Jordan Lee is the founder of ExampleCo.
`);

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });

    const db = await openDatabase(config);
    const result = await searchBrain({ db, config, query: 'Jordan Casey state', apiKey: null });
    assert.equal(result.fused.some((row) => row.slug === 'deals/exampleco-process-status'), true);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('regression: overview query returns the canonical project page before adjacent notes', async () => {
  const fixture = await createFixture('bigbrain-search-regression-overview-');
  try {
    await writeMarkdown(fixture.brainHome, 'projects/wellness-app.md', `---
title: Wellness App
---
# Wellness App

Wellness App is the canonical operating project page for the app workstream.
`);
    await writeMarkdown(fixture.brainHome, 'concepts/wellness-proposal-notes.md', `---
title: Wellness Proposal Notes
---
# Wellness Proposal Notes

Notes from proposal drafting for the Wellness App.
`);

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });

    const db = await openDatabase(config);
    const result = await searchBrain({ db, config, query: 'Wellness App', apiKey: null });
    assert.equal(result.fused[0].slug, 'projects/wellness-app');
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('regression: todo-style query finds the current priorities page', async () => {
  const fixture = await createFixture('bigbrain-search-regression-todos-');
  try {
    await writeMarkdown(fixture.brainHome, 'ops/current-priorities.md', `---
title: Current Priorities
---
# Current Priorities

Next on my TODO list is to review the buyer priorities, tighten the website copy, and follow up on the app proposal.
`);
    await writeMarkdown(fixture.brainHome, 'ops/completed-items.md', `---
title: Completed Items
---
# Completed Items

Finished tasks from last week.
`);

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });

    const db = await openDatabase(config);
    const result = await searchBrain({ db, config, query: "What's next on my TODO list?", apiKey: null });
    assert.equal(result.fused[0].slug, 'ops/current-priorities');
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('regression: recent-mention query finds the example ai context page', async () => {
  const fixture = await createFixture('bigbrain-search-regression-example-ai-');
  try {
    await writeMarkdown(fixture.brainHome, 'companies/example-ai.md', `---
title: Example AI
---
# Example AI

I mention Example AI recently in advisory discussions as a reference point for AI implementation services.
`);
    await writeMarkdown(fixture.brainHome, 'projects/ai-advisory.md', `---
title: AI Advisory
---
# AI Advisory

General advisory positioning notes.
`);

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });

    const db = await openDatabase(config);
    const result = await searchBrain({ db, config, query: 'what did i mention recently about example ai?', apiKey: null });
    assert.equal(result.fused[0].slug, 'companies/example-ai');
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('regression: advisory-history query finds the seed-stage companies page', async () => {
  const fixture = await createFixture('bigbrain-search-regression-advisory-');
  try {
    await writeMarkdown(fixture.brainHome, 'projects/seed-stage-advisory.md', `---
title: Seed-Stage Advisory
---
# Seed-Stage Advisory

Seed-stage companies I have advised include software, education, and workflow startups at the early operating stage.
`);
    await writeMarkdown(fixture.brainHome, 'concepts/advisory-principles.md', `---
title: Advisory Principles
---
# Advisory Principles

Notes on how to advise founders effectively.
`);

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });

    const db = await openDatabase(config);
    const result = await searchBrain({ db, config, query: 'What seed-stage companies have I advised?', apiKey: null });
    assert.equal(result.fused[0].slug, 'projects/seed-stage-advisory');
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
