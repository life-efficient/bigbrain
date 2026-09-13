import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('Keep in Touch skill owns the review protocol and visible report contract', async () => {
  const skill = await fs.readFile(new URL('../../skills/bigbrain-keep-in-touch/SKILL.md', import.meta.url), 'utf8');
  const agent = await fs.readFile(new URL('../../skills/bigbrain-keep-in-touch/agents/openai.yaml', import.meta.url), 'utf8');
  const cases = await fs.readFile(new URL('../../skills/bigbrain-keep-in-touch/tests/cases.md', import.meta.url), 'utf8');
  const resolver = await fs.readFile(new URL('../../skills/RESOLVER.md', import.meta.url), 'utf8');

  assert.match(skill, /^---\nname: bigbrain-keep-in-touch\ndescription: .+\n---/);
  for (const heading of ['Contract Checklist', 'Workflow', 'Anti-Patterns', 'Output']) {
    assert.match(skill, new RegExp(`^## ${heading}$`, 'm'));
  }
  const steps = [...skill.matchAll(/^\d+\. [^\n]+:\n([\s\S]*?)(?=^\d+\. |^## )/gm)];
  assert.equal(steps.length, 4);
  for (const [, body] of steps) assert.match(body, /Anti-patterns:/);
  for (const phrase of [
    'playbooks/keep-in-touch/review',
    'playbooks/keep-in-touch/record_review',
    'playbooks/keep-in-touch/set_frequency',
    'one outcome for every candidate',
    '7 days as the default frequency',
    '3, 7, 14, 30, or 60 days',
    'ordinary natural-language output, not raw MCP JSON',
    'Do not add Keep in Touch markers',
    'never send, queue, or log an external message',
  ]) assert.match(skill, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(agent, /\$bigbrain-keep-in-touch/);
  assert.match(cases, /research-only/);
  assert.match(cases, /needs_review/);
  assert.match(resolver, /bigbrain-keep-in-touch\/SKILL\.md/);
  assert.doesNotMatch(skill, /—/);
  assert.doesNotMatch(agent, /—/);
  assert.doesNotMatch(cases, /—/);
});
