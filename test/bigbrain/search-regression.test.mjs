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
    await writeMarkdown(fixture.brainHome, 'people/jordan-vale.md', `---
title: Jordan Vale
---
# Jordan Vale

Jordan Vale is an operating partner focused on industrial software.
`);
    await writeMarkdown(fixture.brainHome, 'projects/vale-automation-playbook.md', `---
title: Vale Automation Playbook
---
# Vale Automation Playbook

This playbook packages Jordan Vale's operating approach for factory software rollouts.
`);

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });

    const db = await openDatabase(config);
    const result = await searchBrain({ db, config, query: 'Who is Jordan Vale?', apiKey: null });
    assert.equal(result.fused[0].slug, 'people/jordan-vale');
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('regression: process query with punctuation still finds the process page', async () => {
  const fixture = await createFixture('bigbrain-search-regression-process-');
  try {
    await writeMarkdown(fixture.brainHome, 'deals/northstar-sale-process.md', `---
title: Northstar Sale Process
---
# Northstar Sale Process

Current sale timeline and next step for Northstar Robotics.
`);
    await writeMarkdown(fixture.brainHome, 'companies/northstar-robotics.md', `---
title: Northstar Robotics
---
# Northstar Robotics

Northstar Robotics builds warehouse robots.
`);

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });

    const db = await openDatabase(config);
    const result = await searchBrain({ db, config, query: 'What is the current Northstar sale timeline and next step?', apiKey: null });
    assert.equal(result.fused.some((row) => row.slug === 'deals/northstar-sale-process'), true);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('regression: overview query returns the canonical project page before adjacent notes', async () => {
  const fixture = await createFixture('bigbrain-search-regression-overview-');
  try {
    await writeMarkdown(fixture.brainHome, 'projects/lighthouse-analytics.md', `---
title: Lighthouse Analytics
---
# Lighthouse Analytics

Lighthouse Analytics is the canonical operating project page for a retail reporting platform.
`);
    await writeMarkdown(fixture.brainHome, 'concepts/lighthouse-launch-notes.md', `---
title: Lighthouse Launch Notes
---
# Lighthouse Launch Notes

Notes from the Lighthouse Analytics launch and onboarding sprint.
`);

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });

    const db = await openDatabase(config);
    const result = await searchBrain({ db, config, query: 'Lighthouse Analytics', apiKey: null });
    assert.equal(result.fused[0].slug, 'projects/lighthouse-analytics');
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
