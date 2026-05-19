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
