import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const skillPath = new URL('../../skills/bigbrain-action-review/SKILL.md', import.meta.url);
const agentPath = new URL('../../skills/bigbrain-action-review/agents/openai.yaml', import.meta.url);
const casesPath = new URL('../../skills/bigbrain-action-review/tests/cases.md', import.meta.url);
const meetingPath = new URL('../../skills/bigbrain-meeting-ingest/SKILL.md', import.meta.url);
const granolaPath = new URL('../../skills/bigbrain-granola-ingest/SKILL.md', import.meta.url);
const resolverPath = new URL('../../skills/RESOLVER.md', import.meta.url);

test('shared action review contract preserves ownership without requiring a task schema', async () => {
  const [skill, agent, resolver] = await Promise.all([
    fs.readFile(skillPath, 'utf8'),
    fs.readFile(agentPath, 'utf8'),
    fs.readFile(resolverPath, 'utf8'),
  ]);

  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/u)?.[1] ?? '';
  assert.deepEqual(
    frontmatter.split('\n').filter((line) => /^[a-z_]+:/u.test(line)).map((line) => line.split(':', 1)[0]),
    ['name', 'description'],
  );
  assert.match(frontmatter, /^name: bigbrain-action-review$/mu);
  assert.match(frontmatter, /source-ingestion workflow/iu);
  assert.match(skill, /## Contract Checklist/);
  assert.match(skill, /## Workflow/);
  assert.match(skill, /## Anti-Patterns/);
  assert.match(skill, /## Output/);
  assert.equal((skill.match(/Anti-patterns:/g) ?? []).length, 6);
  assert.match(skill, /speaker or sender, responsible actor|speaker versus grammatical actor|speaker-level ownership/i);
  assert.match(skill, /external (?:action|commitment|owner)|third-party (?:action|commitment)/i);
  assert.match(skill, /optional offer/i);
  assert.match(skill, /Use Brain context to make supported actions more intuitive/i);
  assert.match(skill, /Never use context alone to manufacture a commitment, reassign the responsible actor/i);
  assert.match(skill, /Using Brain context to rewrite source ownership/i);
  assert.match(skill, /Split work when the actor, purpose, dependency, communication channel, approval boundary, or completion test differs/i);
  assert.match(skill, /conditional/i);
  assert.match(skill, /vague/i);
  assert.match(skill, /approval/i);
  assert.doesNotMatch(skill, /persist(?:ed|ing)? action[- ]register/i);
  assert.doesNotMatch(skill, /required JSON (?:shape|schema)/i);
  assert.match(agent, /\$bigbrain-action-review/);
  assert.match(resolver, /source-ingestion workflow[\s\S]*bigbrain-action-review/u);
});

test('forward cases cover the Canada ownership and specificity regression', async () => {
  const cases = await fs.readFile(casesPath, 'utf8');

  assert.match(cases, /## Should not replace a source adapter/);
  assert.match(cases, /Route the raw communication through the WhatsApp review workflow first/);
  assert.match(cases, /Return proposals to the caller rather than creating tasks directly/);

  assert.match(cases, /## External owner action and optional offer/);
  assert.match(cases, /owners need to introduce WSP to Bloom/);
  assert.match(cases, /optional offer/);
  assert.match(cases, /Create no Harry task for either item/);

  assert.match(cases, /## Corrected Danny and Luciano next actions/);
  assert.match(cases, /one atomic, specific Danny action/);
  assert.match(cases, /separate atomic, specific Luciano action/);
  assert.match(cases, /investor-roadshow work conditional/);
  assert.match(cases, /Find equity, EPC, and end-user partners/);

  assert.match(cases, /## Brain context cannot manufacture ownership/);
  assert.match(cases, /keep the obligation[\s\S]{0,80}external owners/);
  assert.match(cases, /Converting contextual capability into a commitment/);
});

test('meeting and Granola ingest delegate action judgment to the shared skill', async () => {
  const [meeting, granola] = await Promise.all([
    fs.readFile(meetingPath, 'utf8'),
    fs.readFile(granolaPath, 'utf8'),
  ]);

  for (const [source, content] of [['Meeting', meeting], ['Granola', granola]]) {
    assert.match(content, /\$bigbrain-action-review/, `${source} ingest must invoke the shared action review skill`);
    assert.match(content, /summary[\s\S]{0,700}transcript|transcript[\s\S]{0,700}summary/i, `${source} ingest must preserve both evidence layers for action review`);
    assert.match(content, /before[\s\S]{0,160}(?:creating|updating|writing|mutating|proposing)[\s\S]{0,80}tasks?|before any task (?:creation|update|write|mutation)/i, `${source} ingest must run action review before task writes`);
  }
});
