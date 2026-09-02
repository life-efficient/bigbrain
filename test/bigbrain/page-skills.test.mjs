import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const sharedReference = path.join(repoRoot, 'skills', '_shared', 'canonical-page-one-pager-standard.md');

test('the page skill uses the canonical one-pager standard', async () => {
  const reference = await fs.readFile(sharedReference, 'utf8');
  const skillName = 'bigbrain-page';
  const skill = await fs.readFile(path.join(repoRoot, 'skills', skillName, 'SKILL.md'), 'utf8');
  const metadata = await fs.readFile(path.join(repoRoot, 'skills', skillName, 'agents', 'openai.yaml'), 'utf8');
  const cases = await fs.readFile(path.join(repoRoot, 'skills', skillName, 'tests', 'cases.md'), 'utf8');

  assert.match(skill, new RegExp(`name: ${skillName}`));
  assert.match(skill, /## Contract Checklist/);
  assert.match(skill, /## Workflow/);
  assert.match(skill, /## Anti-Patterns/);
  assert.match(skill, /## Output/);
  assert.match(skill, /_shared\/canonical-page-one-pager-standard\.md/);
  assert.match(skill, /create_page/);
  assert.match(skill, /update_page/);
  assert.match(skill, /compiled_truth/);
  assert.match(skill, /## Timeline/);
  assert.ok(skill.split('\n').length <= 50, `${skillName} should remain lightweight`);
  assert.match(metadata, /\$bigbrain-page/);
  assert.match(cases, /## Should trigger/);
  assert.doesNotMatch(skill, /—/);
  assert.doesNotMatch(metadata, /—/);
  assert.doesNotMatch(cases, /—/);

  assert.match(reference, /standalone briefing about the subject named in its title/);
  assert.match(reference, /compiled-truth zone/);
  assert.match(reference, /Links belong inline/);
  assert.match(reference, /verified canonical targets/);
  assert.match(reference, /authority, jurisdiction, effective date or rule version/);
  assert.match(reference, /Do not include Brain taxonomy/);
  assert.match(reference, /task pages retain task metadata/);
  assert.doesNotMatch(reference, /—/);
});

test('page resolver and core workflows route page writes through the page skill', async () => {
  const resolver = await fs.readFile(path.join(repoRoot, 'skills', 'RESOLVER.md'), 'utf8');
  const understand = await fs.readFile(path.join(repoRoot, 'skills', 'bigbrain-understand', 'SKILL.md'), 'utf8');
  const enrich = await fs.readFile(path.join(repoRoot, 'skills', 'bigbrain-enrich', 'SKILL.md'), 'utf8');
  const ingest = await fs.readFile(path.join(repoRoot, 'skills', 'bigbrain-ingest', 'SKILL.md'), 'utf8');
  const conversation = await fs.readFile(path.join(repoRoot, 'skills', 'bigbrain-conversation-ingest', 'SKILL.md'), 'utf8');

  assert.match(resolver, /bigbrain-page\/SKILL\.md/);
  assert.match(understand, /BigBrain: Create or Update Page/);
  for (const content of [enrich, ingest, conversation]) {
    assert.match(content, /bigbrain-page/);
    assert.doesNotMatch(content, /bigbrain-(?:create|update)-page/);
  }
  assert.doesNotMatch(resolver, /bigbrain-(?:create|update)-page\/SKILL\.md/);
  assert.doesNotMatch(understand, /BigBrain: (?:Create|Update) Page/);
});
