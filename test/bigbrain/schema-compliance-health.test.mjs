import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { runHealthCheck } from '../../src/bigbrain/health.js';
import { syncBrain } from '../../src/bigbrain/sync.js';

test('health reports page-schema defaults, required fields, types, enums, and unknown explicit schemas', async () => {
  const fixture = await createFixture('bigbrain-schema-compliance-health-');
  try {
    await fs.writeFile(path.join(fixture.brainHome, 'page-schemas.yaml'), `schema_version: 1
schemas:
  record:
    path_prefix: records
    fields:
      stage:
        type: string
        enum: [draft, final]
        default: draft
      owner:
        type: string
        required: true
      rank:
        type: number
`, 'utf8');
    await writePage(fixture.brainHome, 'records/default-needed.md', `---
title: Default needed
---
# Default needed

Current state.

---

## Timeline
`);
    await writePage(fixture.brainHome, 'records/invalid.md', `---
title: Invalid record
stage: retired
rank: urgent
---
# Invalid record

Current state.

---

## Timeline
`);
    await writePage(fixture.brainHome, 'notes/explicit-unknown.md', `---
title: Explicit unknown
page_schema: disappeared
---
# Explicit unknown

Current state.

---

## Timeline
`);

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    const report = await runHealthCheck(config, isolatedHealthOptions(fixture));
    const schemaFindings = report.findings.filter((finding) => finding.finding_type.startsWith('schema_') || finding.finding_type === 'unknown_page_schema');

    assert.deepEqual(schemaFindings.map((finding) => [finding.page_slug, finding.finding_type, finding.details.field ?? null]).sort(compareFinding), [
      ['notes/explicit-unknown', 'unknown_page_schema', null],
      ['records/default-needed', 'schema_required_field_missing', 'owner'],
      ['records/invalid', 'schema_field_invalid_enum', 'stage'],
      ['records/invalid', 'schema_required_field_missing', 'owner'],
      ['records/invalid', 'schema_field_type_mismatch', 'rank'],
      ['records/default-needed', 'schema_default_missing', 'stage'],
    ].sort(compareFinding));
    assert.deepEqual(schemaFindings.find((finding) => finding.finding_type === 'schema_default_missing').details.default_value, 'draft');
    assert.equal(report.page_schema_registry.status, 'valid');
    assert.equal(report.page_schema_registry.schema_count, 1);
    assert.equal(report.page_schema_registry.pages_with_schema, 2);
    assert.equal(report.page_schema_registry.violation_count, 6);

    await fs.rm(path.join(fixture.brainHome, 'page-schemas.yaml'));
    const missingRegistry = await runHealthCheck(config, isolatedHealthOptions(fixture));
    assert.equal(missingRegistry.findings.some((finding) => finding.finding_type === 'page_schema_registry_missing'), true);
    assert.equal(missingRegistry.page_schema_registry.status, 'missing');
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

async function createFixture(prefix) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const brainHome = path.join(rootDir, 'brain');
  const env = {
    ...process.env,
    BIGBRAIN_POINTER_PATH: path.join(rootDir, 'pointer'),
    BIGBRAIN_STATE_ROOT: path.join(rootDir, 'state'),
  };
  const init = await initializeBrainHome(brainHome, { env });
  return { rootDir, brainHome, configPath: init.configPath };
}

async function writePage(brainHome, relativePath, markdown) {
  const fullPath = path.join(brainHome, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, markdown, 'utf8');
}

function isolatedHealthOptions(fixture) {
  return {
    cliCommand: process.execPath,
    automationTemplateDir: path.join(fixture.rootDir, 'automations-template'),
    automationActiveDir: path.join(fixture.rootDir, 'automations-active'),
    skillTemplateDir: path.join(fixture.rootDir, 'skills-template'),
    skillActiveDir: path.join(fixture.rootDir, 'skills-active'),
  };
}

function compareFinding(left, right) {
  return left.join('\u0000').localeCompare(right.join('\u0000'));
}
