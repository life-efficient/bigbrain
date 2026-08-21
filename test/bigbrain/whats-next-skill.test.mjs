import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const skillUrl = new URL('../../skills/bigbrain-whats-next/SKILL.md', import.meta.url);
const metadataUrl = new URL('../../skills/bigbrain-whats-next/agents/openai.yaml', import.meta.url);

test('what is next discovers and filters registered Brains safely', async () => {
  const [skill, metadata] = await Promise.all([
    fs.readFile(skillUrl, 'utf8'),
    fs.readFile(metadataUrl, 'utf8'),
  ]);

  assert.match(skill, /^---\nname: bigbrain-whats-next\ndescription: .+\n---/);
  assert.match(skill, /bigbrain brains list --json/);
  assert.match(skill, /every registered, verified Brain by default/i);
  assert.match(skill, /filter the registry before querying tasks/i);
  assert.match(skill, /what's next in my personal brain/i);
  assert.match(skill, /connection\.handle/);
  assert.match(skill, /about\.brain_id/);
  assert.match(skill, /capabilities\.read: true/);
  assert.match(skill, /Call `me` separately through each verified Brain/);
  assert.match(skill, /Follow `next_cursor`/);
  assert.match(skill, /Brain ID plus task slug/);
  assert.match(skill, /X\/Y registered Brains queried/);
  assert.match(skill, /Unavailable Brains/);
  assert.match(skill, /Defaulting a failed specialized Brain query to Personal Brain/);
  assert.match(skill, /Do not call `tasks\/get` during discovery or ranking/);
  assert.match(skill, /owning Brain/);
  assert.match(metadata, /\$bigbrain-whats-next/);
  assert.doesNotMatch(skill, /Start with the installed Codex skills whose names end in `whats-next`/);
});
