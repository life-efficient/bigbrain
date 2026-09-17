import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import yaml from 'js-yaml';

const read = relative => fs.readFile(new URL(`../../${relative}`, import.meta.url), 'utf8');

test('generic RSS worker owns preflight before retrieval and returns a held Substack claim to its adapter', async () => {
  const skill = await read('skills/bigbrain-source-article-ingest/SKILL.md');
  const workflow = skill.split('## Workflow')[1].split('## Article Page Template')[0];
  const firstStep = workflow.split('2. Apply the shared relevance gate')[0];
  assert.ok(firstStep.indexOf('`rss/workflow`') < firstStep.indexOf('Visit the supplied article URL'));
  assert.ok(firstStep.indexOf('atomically claim unresolved work') < firstStep.indexOf('Visit the supplied article URL'));
  assert.match(firstStep, /Substack-originated URL or Substack RSS event/);
  assert.match(firstStep, /substack_context: \{ledger_preflight_complete: true, claimed: true\}/);
  assert.match(firstStep, /Do not open a second generic RSS claim or complete its claim here/);
  assert.match(firstStep, /terminal outcomes for the same Brain without another fetch or write/);
  assert.match(firstStep, /live competing claim is deferred/);
  assert.match(skill, /complete shared `rss\/ledger` state only after same-Brain read-back/);
  assert.match(skill, /Record irrelevant articles as reviewed `ignored` without content writes/);
  assert.match(skill, /sole article relevance and filing owner/);
  assert.match(skill, /shared ingestion completeness checklist/);
  assert.match(skill, /one paragraph summarizing the article's substance whenever the article was readable, whether ingested or skipped/);
});

test('RSS contract preserves feed identity, query identities, holes, and scoped verification', async () => {
  const reference = await read('skills/bigbrain-source-article-ingest/references/rss-ledger.md');
  for (const operation of ['feed-upsert', 'discover', 'status', 'claim', 'renew', 'complete', 'release', 'retry']) {
    assert.ok(reference.includes(`| \`${operation}\` |`));
  }
  for (const field of ['feed_id', 'filed_low_watermark', 'filed_high_watermark', 'outstanding_count', 'nextOffset']) {
    assert.ok(reference.includes(`\`${field}\``));
  }
  assert.match(reference, /Every feed is distinct even when two feeds share a publisher origin/);
  assert.match(reference, /Preserve query parameters that identify content/);
  assert.match(reference, /exact publication timestamp with a timezone/);
  assert.match(reference, /without verified retained records show unset values/);
  assert.match(reference, /low watermark is the earliest retained verified post; the high watermark is the latest/);
  assert.match(reference, /These bounds do not prove contiguous coverage/);
  assert.match(reference, /including holes below the high watermark/);
  assert.match(reference, /Keep removed or excluded feeds excluded/);
  assert.match(reference, /read back the exact article's saved source and canonical coverage/);
  const example = JSON.parse(reference.match(/```json\n(\{\n[\s\S]*?)\n```/)[1]);
  assert.equal(example.operation, 'complete');
  assert.equal(example.input.verification.readBack, true);
  assert.ok(example.input.verification.brainId);
  assert.ok(example.input.verification.paths.length >= 3);
  assert.ok(example.input.verification.evidence);
  assert.ok(Number.isFinite(Date.parse(example.input.verification.verifiedAt)));
  assert.match(reference, /`ignored` requires the actual relevance reason/);
  assert.match(reference, /`needs_review` preserves an explicit outstanding hole/);
});

test('RSS workflow is discoverable without desktop file access and keeps routing metadata coherent', async () => {
  const skill = await read('skills/bigbrain-source-article-ingest/SKILL.md');
  const reference = await read('skills/bigbrain-source-article-ingest/references/rss-ledger.md');
  const substack = await read('skills/bigbrain-substack-ingest/SKILL.md');
  const metadata = yaml.load(await read('skills/bigbrain-source-article-ingest/agents/openai.yaml'));
  for (const text of [skill, reference]) {
    assert.match(text, /rss\/workflow/);
    assert.match(text, /rss\/ledger/);
    assert.match(text, /rss_workflow/);
    assert.match(text, /rss_ledger/);
    assert.match(text, /Never (?:open|use) TextEdit, Finder, Terminal UI/);
    assert.match(text, /\$find-missing-tools/);
    assert.match(text, /(?:state unchanged|unchanged)/);
  }
  assert.match(skill, /\[the RSS ledger contract\]\(references\/rss-ledger\.md\)/);
  assert.match(substack, /shared article ledger used by generic RSS and this Substack adapter/);
  assert.match(metadata.interface.default_prompt, /\$bigbrain-source-article-ingest/);
  assert.match(metadata.interface.default_prompt, /rss\/workflow and rss\/ledger/);
  assert.match(metadata.interface.default_prompt, /stop unchanged without desktop file workarounds/);
  const frontmatter = yaml.load(skill.match(/^---\n([\s\S]*?)\n---/)[1]);
  assert.deepEqual(Object.keys(frontmatter).sort(), ['description', 'name']);
  assert.equal(frontmatter.name, 'bigbrain-source-article-ingest');
  assert.ok(frontmatter.description.length <= 1024);
  // Description-only selection: RSS belongs here, Substack starts at the adapter,
  // and human correspondence belongs to email rather than either article route.
  assert.match(frontmatter.description, /RSS article/);
  assert.match(frontmatter.description, /For Substack posts, start with `bigbrain-substack-ingest`/);
  assert.match(frontmatter.description, /for human email correspondence, use `bigbrain-email-ingest`/);
});
