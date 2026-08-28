import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const repoUrl = new URL('../../', import.meta.url);

test('source update fallback skill has the standard contract and installed metadata', async () => {
  const [skill, metadata, resolver] = await Promise.all([
    fs.readFile(new URL('skills/bigbrain-check-update/SKILL.md', repoUrl), 'utf8'),
    fs.readFile(new URL('skills/bigbrain-check-update/agents/openai.yaml', repoUrl), 'utf8'),
    fs.readFile(new URL('skills/RESOLVER.md', repoUrl), 'utf8'),
  ]);

  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/)?.[1] || '';
  const keys = [...frontmatter.matchAll(/^([a-z_]+):/gm)].map((match) => match[1]);
  assert.deepEqual(keys, ['name', 'description']);
  assert.match(frontmatter, /^name: bigbrain-check-update$/m);
  assert.match(frontmatter, /source-managed BigBrain checkout/);
  for (const heading of ['Contract Checklist', 'Workflow', 'Anti-Patterns', 'Output']) {
    assert.match(skill, new RegExp(`^## ${heading}$`, 'm'));
  }

  const steps = [...skill.matchAll(/^\d+\. [^\n]+:\n([\s\S]*?)(?=^\d+\. |^## )/gm)];
  assert.ok(steps.length >= 10);
  for (const [, body] of steps) assert.match(body, /Anti-patterns:/);
  assert.match(metadata, /\$bigbrain-check-update/);
  assert.match(resolver, /source-managed BigBrain checkout/);
});

test('packaged desktop routes away from the source fallback and its schedule is paused', async () => {
  const [skill, automation, installDocs] = await Promise.all([
    fs.readFile(new URL('skills/bigbrain-check-update/SKILL.md', repoUrl), 'utf8'),
    fs.readFile(new URL('automations/bigbrain-check-update/automation.toml', repoUrl), 'utf8'),
    fs.readFile(new URL('INSTALL_FOR_AGENTS.md', repoUrl), 'utf8'),
  ]);

  assert.match(skill, /packaged desktop installations to the in-app updater/i);
  assert.match(skill, /Do not restart .*newer independently managed service/i);
  assert.match(skill, /remote.*untouched/i);
  assert.match(automation, /^status = "PAUSED"$/m);
  assert.match(automation, /Route packaged desktop installs to the in-app updater/);
  assert.doesNotMatch(installDocs, /for id in [^\n]*bigbrain-check-update/);
});
