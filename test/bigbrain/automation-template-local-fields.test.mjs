import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { runHealthCheck } from '../../src/bigbrain/health.js';

test('health allows active automation cwd to be install-local', async () => {
  const fixture = await createFixture('bigbrain-automation-local-cwd-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const templateDir = path.join(fixture.rootDir, 'templates', 'automations');
    const activeDir = path.join(fixture.rootDir, 'active', 'automations');
    const template = `version = 1
id = "bigbrain-frequent-sync"
kind = "cron"
name = "BigBrain Frequent Sync"
prompt = "Run sync."
status = "ACTIVE"
rrule = "FREQ=MINUTELY;INTERVAL=45"
cwds = ["<brain-home>"]
`;
    const active = template.replace('cwds = ["<brain-home>"]', 'cwds = ["/workspace/example/projects/brain"]');

    await writeAutomationToml(templateDir, 'bigbrain-frequent-sync', template);
    await writeAutomationToml(activeDir, 'bigbrain-frequent-sync', active);

    const report = await runHealthCheck(config, {
      cliCommand: process.execPath,
      automationTemplateDir: templateDir,
      automationActiveDir: activeDir,
      skillTemplateDir: path.join(fixture.rootDir, 'skills'),
      skillActiveDir: path.join(fixture.rootDir, 'active', 'skills'),
    });

    assert.equal(report.automation_template_status.checked_count, 1);
    assert.equal(report.automation_template_status.mismatch_count, 0);
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

async function writeAutomationToml(automationRoot, id, content) {
  const fullPath = path.join(automationRoot, id, 'automation.toml');
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
}
