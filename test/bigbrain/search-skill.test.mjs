import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import yaml from 'js-yaml';

test('search skill routes knowledge questions to budgeted evidence and harness synthesis', async () => {
  const skill = await fs.readFile(new URL('../../skills/bigbrain-search/SKILL.md', import.meta.url), 'utf8');
  const frontmatter = yaml.load(skill.match(/^---\n([\s\S]*?)\n---/)[1]);
  assert.deepEqual(Object.keys(frontmatter).sort(), ['description', 'name']);
  assert.equal(frontmatter.name, 'bigbrain-search');
  assert.equal(frontmatter.description.length <= 1024, true);
  assert.match(frontmatter.description, /existing knowledge/);
  assert.match(frontmatter.description, /Do not use for saving new information/);
  assert.match(frontmatter.description, /explaining how BigBrain software works/);
  for (const heading of ['Contract Checklist', 'Workflow', 'Anti-Patterns', 'Output']) {
    assert.match(skill, new RegExp(`^## ${heading}$`, 'm'));
  }
  const steps = [...skill.matchAll(/^\d+\. [^\n]+:\n([\s\S]*?)(?=^\d+\. |^## )/gm)];
  assert.equal(steps.length, 4);
  for (const [, body] of steps) assert.match(body, /Anti-patterns:/);
  assert.match(skill, /retrieval_context\.context/);
  assert.match(skill, /Read relevant omitted pages/);
  assert.match(skill, /Synthesize directly in the current harness/);
  assert.match(skill, /structured tool is separate from the deprecated/);
  assert.match(skill, /do not rebuild indexes or raise embedding guards/);

  const agent = yaml.load(await fs.readFile(new URL('../../skills/bigbrain-search/agents/openai.yaml', import.meta.url), 'utf8'));
  assert.match(agent.interface.default_prompt, /\$bigbrain-search/);
  const resolver = await fs.readFile(new URL('../../skills/RESOLVER.md', import.meta.url), 'utf8');
  assert.match(resolver, /skills\/bigbrain-search\/SKILL\.md/);
  assert.doesNotMatch(resolver, /skills\/bigbrain-query\/SKILL\.md/);
  const cases = await fs.readFile(new URL('../../skills/bigbrain-search/tests/cases.md', import.meta.url), 'utf8');
  for (const scenario of ['Positive trigger', 'Negative trigger', 'ambiguous request', 'Budget omission', 'Buried evidence', 'Keyword fallback', 'Structured request', 'Legacy invocation']) {
    assert.ok(cases.includes(scenario), scenario);
  }
});

test('retired query skill redirects only explicit legacy invocations to search', async () => {
  const skill = await fs.readFile(new URL('../../skills/bigbrain-query/SKILL.md', import.meta.url), 'utf8');
  const frontmatter = yaml.load(skill.match(/^---\n([\s\S]*?)\n---/)[1]);
  assert.deepEqual(Object.keys(frontmatter).sort(), ['description', 'name']);
  assert.equal(frontmatter.name, 'bigbrain-query');
  assert.match(frontmatter.description, /only when the user explicitly invokes/);
  assert.match(skill, /\.\.\/bigbrain-search\/SKILL\.md/);
  assert.doesNotMatch(skill, /bigbrain query/);
});
