import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);

test('the page skill contains the page writing standard', async () => {
  const skillName = 'bigbrain-page';
  const skill = await fs.readFile(path.join(repoRoot, 'skills', skillName, 'SKILL.md'), 'utf8');
  const metadata = await fs.readFile(path.join(repoRoot, 'skills', skillName, 'agents', 'openai.yaml'), 'utf8');
  const cases = await fs.readFile(path.join(repoRoot, 'skills', skillName, 'tests', 'cases.md'), 'utf8');

  assert.match(skill, new RegExp(`name: ${skillName}`));
  assert.match(skill, /## Contract Checklist/);
  assert.match(skill, /## Workflow/);
  assert.match(skill, /## Anti-Patterns/);
  assert.match(skill, /## Output/);
  assert.match(skill, /create_page/);
  assert.match(skill, /update_page/);
  assert.match(skill, /## Timeline/);
  assert.match(skill, /Standard ordinary pages use YAML frontmatter/);
  assert.match(skill, /one canonical page for one primary subject/);
  assert.match(skill, /best standalone 80\/20 rundown/);
  assert.match(skill, /could read only this page about the subject/);
  assert.match(skill, /if the reader had only one paragraph/);
  assert.match(skill, /Find which Brain owns the page/);
  assert.match(skill, /Use the selected Brain's relevant MCP/);
  assert.match(skill, /Read the page back and verify the result/);
  assert.match(skill, /concise, subject-first summary of the durable page change/);
  assert.match(skill, /do not lead with the current user's name/);
  assert.match(skill, /provenance\.source_message/);
  assert.match(skill, /Prefer `Added X after approval`/);
  assert.match(skill, /evidence and scope boundaries as contextual prose and links by default/);
  assert.match(skill, /do not add generic `## Evidence` or `## Boundaries` headings/);
  for (const phrase of ['current[- ]context', 'what the subject is', 'why it matters', 'boundaries', 'material relationships', 'inline links']) {
    assert.match(skill, new RegExp(phrase));
  }
  assert.ok(skill.split('\n').length <= 50, `${skillName} should remain lightweight`);
  assert.match(metadata, /\$bigbrain-page/);
  assert.match(cases, /## Should trigger/);
  assert.doesNotMatch(skill, /—/);
  assert.doesNotMatch(skill, /active Brain|one-pager|canonical-page-one-pager-standard/);
  assert.doesNotMatch(skill, /For regulated or fast-changing subjects/);
  assert.doesNotMatch(metadata, /—/);
  assert.doesNotMatch(cases, /—/);
});

test('page resolver and core workflows route page writes through the page skill', async () => {
  const resolver = await fs.readFile(path.join(repoRoot, 'skills', 'RESOLVER.md'), 'utf8');
  const understand = await fs.readFile(path.join(repoRoot, 'skills', 'bigbrain-understand', 'SKILL.md'), 'utf8');
  const enrich = await fs.readFile(path.join(repoRoot, 'skills', 'bigbrain-enrich', 'SKILL.md'), 'utf8');
  const ingest = await fs.readFile(path.join(repoRoot, 'skills', 'bigbrain-ingest', 'SKILL.md'), 'utf8');

  assert.match(resolver, /bigbrain-page\/SKILL\.md/);
  assert.match(understand, /BigBrain: Create or Update Page/);
  for (const content of [enrich, ingest]) {
    assert.match(content, /bigbrain-page/);
    assert.doesNotMatch(content, /bigbrain-(?:create|update)-page/);
  }
  assert.doesNotMatch(resolver, /bigbrain-(?:create|update)-page\/SKILL\.md/);
  assert.doesNotMatch(understand, /BigBrain: (?:Create|Update) Page/);
  assert.doesNotMatch(resolver, /bigbrain-conversation-ingest/);
  assert.match(ingest, /## Conversation guidance/);
  assert.match(ingest, /including corrections/);
  assert.match(ingest, /routine operational chatter/);
  assert.match(ingest, /conversation provenance/);
});
