import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const skillPath = new URL('../../skills/bigbrain-meeting-ingest/SKILL.md', import.meta.url);
const casesPath = new URL('../../skills/bigbrain-meeting-ingest/tests/cases.md', import.meta.url);

test('Meeting Ingest prompts for verified task links, same-run repair, and direct failure reporting', async () => {
  const skill = await fs.readFile(skillPath, 'utf8');

  assert.match(skill, /Every action bullet backed by a created or updated task includes one concise inline link/iu);
  assert.match(skill, /verified path returned by the task write/iu);
  assert.match(skill, /Compute the link relative to the page being rendered/iu);
  assert.match(skill, /read that task back/iu);
  assert.match(skill, /repair the affected task or source page in the same run/iu);
  assert.match(skill, /explain the concrete failure directly in the current Codex chat/iu);
  assert.match(skill, /Do not introduce a fixed action or failure schema/iu);
});

test('Meeting Ingest forward cases cover links, repair, policy filtering, and external ownership', async () => {
  const cases = await fs.readFile(casesPath, 'utf8');

  assert.match(cases, /## Task-backed actions use the verified task path/iu);
  assert.match(cases, /## Repair a broken task link in the same run/iu);
  assert.match(cases, /## Approval guidance is not an action/iu);
  assert.match(cases, /## External owner remains external context/iu);
  assert.match(cases, /fixed persisted action-to-task mapping/iu);
  assert.match(cases, /current Codex chat/iu);
  assert.match(cases, /No external messages, introductions/iu);
  assert.match(cases, /Do not assign the introduction to Harry/iu);
});
