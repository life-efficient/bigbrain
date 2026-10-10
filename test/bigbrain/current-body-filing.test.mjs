import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderSchemaMarkdown } from '../../src/bigbrain/schema.js';
import { filingRulesForBrain } from '../../src/bigbrain/filing-rules.js';

test('current subject briefing guidance survives custom filing principles and page shape', async () => {
  const brainDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-current-body-'));
  try {
    await fs.writeFile(path.join(brainDir, 'FILING.md'), '# Filing\n\n## Filing Principles\n- Custom principle.\n\n## Page Shape\n- Custom shape.\n');
    const rules = await filingRulesForBrain({ config: { brainDir } });
    assert.deepEqual(rules.page_shape, ['Custom shape.']);
    assert.deepEqual(rules.filing_principles, ['Custom principle.']);
    const guidance = rules.current_body_guidance.join('\n');
    assert.match(guidance, /synthesized current briefing/);
    assert.match(guidance, /replace or qualify superseded claims/);
    assert.match(guidance, /Preserve useful current commercial and technical details/);
    assert.match(guidance, /Do not append dated Update/);
    assert.match(guidance, /deadline, freshness, or uncertainty/);
    const timeline = rules.timeline_guidance.join('\n');
    assert.match(timeline, /inventory substantive source events/);
    assert.match(timeline, /occurred_at from the evidenced event date/);
    assert.match(timeline, /recorded_at from the actual write time/);
    assert.match(timeline, /Preserve existing entries, avoid duplicates/);
    assert.match(timeline, /one present-day cleanup entry does not replace/);
    for (const instruction of rules.timeline_guidance) assert.ok(rules.markdown.includes(instruction));
    assert.match(rules.markdown, /## Current Body Writing/);
    for (const instruction of rules.current_body_guidance) assert.ok(rules.markdown.includes(instruction));
  } finally {
    await fs.rm(brainDir, { recursive: true, force: true });
  }
});

test('schema explains consolidation without erasing useful current detail', () => {
  const markdown = renderSchemaMarkdown();
  assert.match(markdown, /replace or qualify superseded claims/);
  assert.match(markdown, /Preserve useful current technical details, attribution, and uncertainty/);
  assert.match(markdown, /Do not append dated update sections/);
  assert.match(markdown, /dates defining material facts or deadlines may remain/);
  assert.match(markdown, /inventory substantive source events/);
  assert.match(markdown, /do not guess dates or turn plans into completed actions/);
  assert.match(markdown, /Record administrative filing corrections separately/);
});
