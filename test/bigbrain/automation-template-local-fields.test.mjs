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
    const active = template.replace('cwds = ["<brain-home>"]', 'cwds = ["/workspace/brain-home"]');

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

test('health flags duplicate, retired, and backup Granola writers in the live automation root', async () => {
  const fixture = await createFixture('bigbrain-automation-conflicts-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const templateDir = path.join(fixture.rootDir, 'templates', 'automations');
    const activeDir = path.join(fixture.rootDir, 'active', 'automations');
    await fs.mkdir(templateDir, { recursive: true });
    await fs.writeFile(path.join(templateDir, 'retired.json'), JSON.stringify({
      automation_ids: ['legacy-granola-ingest'],
    }), 'utf8');
    await writeAutomationToml(activeDir, 'legacy-granola-ingest', automation({
      id: 'legacy-granola-ingest',
      name: 'Legacy Granola Ingest',
    }));
    await writeAutomationToml(activeDir, 'legacy-granola-ingest.before-cutover', automation({
      id: 'legacy-granola-ingest',
      name: 'Legacy Granola Ingest Backup',
    }));
    await writeAutomationToml(activeDir, 'bigbrain-route-granola', automation({
      id: 'bigbrain-route-granola',
      name: 'BigBrain Route Granola',
    }));

    const report = await runHealthCheck(config, {
      cliCommand: process.execPath,
      automationTemplateDir: templateDir,
      automationActiveDir: activeDir,
      skillTemplateDir: path.join(fixture.rootDir, 'skills'),
      skillActiveDir: path.join(fixture.rootDir, 'active', 'skills'),
    });

    assert.equal(report.automation_conflict_status.active_granola_writer_count, 3);
    assert.deepEqual(
      new Set(report.automation_conflict_status.conflicts.map((conflict) => conflict.type)),
      new Set([
        'multiple_active_granola_writers',
        'retired_automation_active',
        'active_backup_in_live_automation_root',
        'duplicate_automation_id',
      ]),
    );
    assert.equal(
      report.findings.filter((finding) => finding.finding_type === 'automation_conflict').every((finding) => finding.severity === 'high'),
      true,
    );
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('health accepts one paused router alongside no active Granola writers', async () => {
  const fixture = await createFixture('bigbrain-automation-paused-router-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const templateDir = path.join(fixture.rootDir, 'templates', 'automations');
    const activeDir = path.join(fixture.rootDir, 'active', 'automations');
    await fs.mkdir(templateDir, { recursive: true });
    await fs.writeFile(path.join(templateDir, 'retired.json'), JSON.stringify({ automation_ids: [] }), 'utf8');
    await writeAutomationToml(activeDir, 'bigbrain-route-granola', automation({
      id: 'bigbrain-route-granola',
      name: 'BigBrain Route Granola',
      status: 'PAUSED',
    }));

    const report = await runHealthCheck(config, {
      cliCommand: process.execPath,
      automationTemplateDir: templateDir,
      automationActiveDir: activeDir,
      skillTemplateDir: path.join(fixture.rootDir, 'skills'),
      skillActiveDir: path.join(fixture.rootDir, 'active', 'skills'),
    });

    assert.equal(report.automation_conflict_status.active_granola_writer_count, 0);
    assert.equal(report.automation_conflict_status.conflict_count, 0);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('health does not mistake a non-Granola workflow that mentions the router for a writer', async () => {
  const fixture = await createFixture('bigbrain-automation-non-writer-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const templateDir = path.join(fixture.rootDir, 'templates', 'automations');
    const activeDir = path.join(fixture.rootDir, 'active', 'automations');
    await fs.mkdir(templateDir, { recursive: true });
    await fs.writeFile(path.join(templateDir, 'retired.json'), JSON.stringify({ automation_ids: [] }), 'utf8');
    await writeAutomationToml(activeDir, 'sync-board-and-brain', `version = 1
id = "sync-board-and-brain"
kind = "cron"
name = "Sync Board And Brain"
prompt = "Do not call Granola; the BigBrain router owns Granola ingestion."
status = "ACTIVE"
rrule = "FREQ=DAILY;BYHOUR=8"
`);

    const report = await runHealthCheck(config, {
      cliCommand: process.execPath,
      automationTemplateDir: templateDir,
      automationActiveDir: activeDir,
      skillTemplateDir: path.join(fixture.rootDir, 'skills'),
      skillActiveDir: path.join(fixture.rootDir, 'active', 'skills'),
    });

    assert.equal(report.automation_conflict_status.active_granola_writer_count, 0);
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

function automation({ id, name, status = 'ACTIVE' }) {
  return `version = 1
id = "${id}"
kind = "cron"
name = "${name}"
prompt = "Ingest and route Granola meetings."
status = "${status}"
rrule = "FREQ=DAILY;BYHOUR=4"
`;
}
