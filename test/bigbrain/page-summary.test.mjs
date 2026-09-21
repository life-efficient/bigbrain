import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { createBrainPage, readBrainPage, updateBrainPage } from '../../src/bigbrain/page-ops.js';

const provenance = {
  event_id: 'test:page-summary',
  source_type: 'assistant_chat',
  source_label: 'Page summary test',
  source_message: 'Tests the first-class page summary field.',
};

test('page summaries are stored once in frontmatter and read separately from the detailed body', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-page-summary-'));
  try {
    const brainHome = path.join(rootDir, 'brain');
    const init = await initializeBrainHome(brainHome, { brainName: 'Summary Test Brain' });
    const config = await loadConfig({ configPath: init.configPath });

    const created = await createBrainPage({
      config,
      pagePath: 'concepts/summary-model',
      title: 'Summary Model',
      summary: 'The summary is the concise standalone takeaway for a page.',
      body: 'The body contains the detailed current understanding without repeating the summary.',
      timelineEntry: 'Created the summary model page.',
      timelineProvenance: provenance,
    });

    assert.equal(created.summary, 'The summary is the concise standalone takeaway for a page.');
    assert.equal(created.frontmatter.summary, created.summary);
    assert.match(created.body, /detailed current understanding/);
    assert.doesNotMatch(created.body, /concise standalone takeaway/);
    assert.equal((created.markdown.match(/summary:/g) || []).length, 1);

    const updated = await updateBrainPage({
      config,
      pagePath: created.path,
      summary: 'The summary remains a separate, high-signal retrieval field.',
      body: 'The detailed body can evolve independently of the summary.',
      timelineEntry: 'Updated the summary and detailed body separately.',
      timelineProvenance: provenance,
    });
    const readBack = await readBrainPage({ config, pagePath: updated.path });

    assert.equal(readBack.summary, 'The summary remains a separate, high-signal retrieval field.');
    assert.match(readBack.body, /evolve independently/);
    assert.doesNotMatch(readBack.body, /high-signal retrieval field/);

    const summaryOnly = await updateBrainPage({
      config,
      pagePath: created.path,
      summary: 'The final summary explains the page subject without changing its detailed content.',
      timelineEntry: 'Refined the summary without rewriting the body.',
      timelineProvenance: provenance,
    });

    assert.equal(summaryOnly.summary, 'The final summary explains the page subject without changing its detailed content.');
    assert.match(summaryOnly.body, /evolve independently/);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});
