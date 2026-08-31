import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { runHealthCheck } from '../../src/bigbrain/health.js';

test('media ingest skill enforces YouTube video-title and channel-suffix naming', async () => {
  const skillPath = new URL('../../skills/bigbrain-media-ingest/SKILL.md', import.meta.url);
  const skill = await fs.readFile(skillPath, 'utf8');

  assert.match(skill, /<exact YouTube video title> - <exact YouTube channel name>/);
  assert.match(skill, /<slugified video title>-<slugified channel name>/);
  assert.match(skill, /Keep the channel name as the final suffix/);
  assert.match(skill, /Do not use a generated topic label/);
  assert.match(skill, /directly read back the canonical page and source sidecar/);
});

test('source article ingest keeps filing optional and gates writes on relevance', async () => {
  const skillPath = new URL('../../skills/bigbrain-source-article-ingest/SKILL.md', import.meta.url);
  const skill = await fs.readFile(skillPath, 'utf8');
  const agentPath = new URL('../../skills/bigbrain-source-article-ingest/agents/openai.yaml', import.meta.url);
  const agent = await fs.readFile(agentPath, 'utf8');

  assert.match(skill, /Filing is optional/);
  assert.match(skill, /first-party promotional material as `ignored` by default/);
  assert.match(skill, /Require a short user-specific relevance rationale before any raw-file or Brain-page write/);
  assert.match(skill, /Entity mention, topical similarity, regional relevance/);
  assert.match(skill, /Visit the supplied article page and confirm that you landed on the correct article/);
  assert.match(skill, /Do not substitute another page/);
  assert.doesNotMatch(skill, /source-retrieval fallback order/);
  assert.doesNotMatch(skill, /after all fallbacks/);
  assert.match(skill, /“ingest this article” or “put it in the right Brain pages”/);
  assert.match(skill, /For `ignored`, explicitly state that no raw artifact or Brain page was created/);
  assert.match(agent, /First decide whether it clears the digest-value gate; filing is optional/);
  assert.match(agent, /do not create a source artifact or Brain page unless it does/);
});

test('health accepts active skill symlinks that match repo skills', async () => {
  const fixture = await createFixture('bigbrain-skill-template-health-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const templateDir = path.join(fixture.rootDir, 'skills');
    const activeDir = path.join(fixture.rootDir, '.agents', 'skills');

    await writeSkill(templateDir, 'bigbrain-maintain', {
      skill: '---\nname: "BigBrain: Maintain"\n---\n# BigBrain: Maintain\n',
      agent: 'interface:\n  display_name: "BigBrain: Maintain"\n',
    });
    await fs.mkdir(activeDir, { recursive: true });
    await fs.symlink(path.join(templateDir, 'bigbrain-maintain'), path.join(activeDir, 'bigbrain-maintain'));

    const report = await runHealthCheck(config, {
      cliCommand: process.execPath,
      automationTemplateDir: path.join(fixture.rootDir, 'automations'),
      skillTemplateDir: templateDir,
      skillActiveDir: activeDir,
    });

    assert.equal(report.skill_template_status.checked_count, 1);
    assert.equal(report.skill_template_status.mismatch_count, 0);
    assert.equal(report.skill_template_status.checks[0].install_type, 'symlink');
    assert.equal(report.findings.some((finding) => finding.finding_type === 'skill_template_mismatch'), false);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('health flags active skill definitions that drift from repo skills', async () => {
  const fixture = await createFixture('bigbrain-skill-template-drift-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const templateDir = path.join(fixture.rootDir, 'skills');
    const activeDir = path.join(fixture.rootDir, '.agents', 'skills');

    await writeSkill(templateDir, 'bigbrain-query', {
      skill: '---\nname: "BigBrain: Query"\n---\n# BigBrain: Query\n',
      agent: 'interface:\n  display_name: "BigBrain: Query"\n',
    });
    await writeSkill(activeDir, 'bigbrain-query', {
      skill: '---\nname: bigbrain-query\n---\n# Query\n',
      agent: 'interface:\n  display_name: "Query"\n',
    });

    const report = await runHealthCheck(config, {
      cliCommand: process.execPath,
      automationTemplateDir: path.join(fixture.rootDir, 'automations'),
      skillTemplateDir: templateDir,
      skillActiveDir: activeDir,
    });
    const finding = report.findings.find((item) => item.finding_type === 'skill_template_mismatch');

    assert.equal(report.skill_template_status.mismatch_count, 1);
    assert.equal(Boolean(finding), true);
    assert.equal(finding.details.id, 'bigbrain-query');
    assert.equal(finding.details.status, 'mismatch');
    assert.deepEqual(finding.details.changed, ['SKILL.md', 'agents/openai.yaml']);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

async function createFixture(prefix) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const pointerPath = path.join(rootDir, 'pointer');
  const stateRoot = path.join(rootDir, 'state-root');
  const brainHome = path.join(rootDir, 'brain-home');
  const init = await initializeBrainHome(brainHome, { env: { ...process.env, BIGBRAIN_POINTER_PATH: pointerPath, BIGBRAIN_STATE_ROOT: stateRoot } });
  return { rootDir, brainHome, configPath: init.configPath };
}

async function writeSkill(skillsRoot, id, { skill, agent }) {
  const skillDir = path.join(skillsRoot, id);
  await fs.mkdir(path.join(skillDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), skill, 'utf8');
  await fs.writeFile(path.join(skillDir, 'agents', 'openai.yaml'), agent, 'utf8');
}
