import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createBrainDomain,
  deleteBrainDomain,
  listBrainDomains,
  loadDomainRegistry,
  updateBrainDomain,
} from '../../src/bigbrain/domains.js';
import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { createBrainPage } from '../../src/bigbrain/page-ops.js';
import { runHealthCheck } from '../../src/bigbrain/health.js';
import { syncBrain } from '../../src/bigbrain/sync.js';

test('domain registry CRUD is authoritative and protects referenced domains', async () => {
  const fixture = await createFixture('bigbrain-domains-registry-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    assert.deepEqual((await listBrainDomains(config)).domains, []);

    await createBrainDomain(config, {
      id: 'ai-infrastructure',
      name: 'AI infrastructure',
      guidance: 'Use for the companies, concepts, meetings, and process knowledge that explain AI infrastructure supply chains.',
    });
    const created = await loadDomainRegistry(config);
    assert.equal(created.valid, true);
    assert.equal(created.registry.domains['ai-infrastructure'].name, 'AI infrastructure');

    await updateBrainDomain(config, {
      id: 'ai-infrastructure',
      name: 'AI infrastructure',
      guidance: 'Use for the end-to-end AI infrastructure supply chain and operating process.',
    });
    assert.match((await listBrainDomains(config)).domains[0].guidance, /end-to-end/);

    await createBrainPage({
      config,
      pagePath: 'concepts/ai-infrastructure',
      title: 'AI infrastructure',
      body: 'A knowledge domain test page.',
      timelineEntry: 'Created for the domain test.',
      timelineSignificance: 'minor',
      domains: ['ai-infrastructure'],
    });
    await assert.rejects(
      () => deleteBrainDomain(config, { id: 'ai-infrastructure' }),
      /still assigned to page\(s\): concepts\/ai-infrastructure/,
    );
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('health flags page domains that are absent from the Brain registry', async () => {
  const fixture = await createFixture('bigbrain-domains-health-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    await createBrainDomain(config, {
      id: 'ai-infrastructure',
      name: 'AI infrastructure',
      guidance: 'Use for AI infrastructure knowledge.',
    });
    await fs.mkdir(path.join(fixture.brainHome, 'concepts'), { recursive: true });
    await fs.writeFile(path.join(fixture.brainHome, 'concepts', 'unregistered.md'), `---
title: Unregistered
domains: [ai-infrastructure, startups]
---
# Unregistered

This page intentionally contains an unregistered domain.
`, 'utf8');
    await syncBrain({ config, apiKey: null });

    const report = await runHealthCheck(config, { cliCommand: process.execPath });
    const findings = report.findings.filter((finding) => finding.finding_type === 'unregistered_domain');
    assert.equal(findings.length, 1);
    assert.equal(findings[0].page_slug, 'concepts/unregistered');
    assert.equal(findings[0].details.domain, 'startups');
    assert.equal(report.domain_registry.domain_count, 1);
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
  const init = await initializeBrainHome(brainHome, { env, brainName: 'Test Brain' });
  return { rootDir, brainHome, configPath: init.configPath };
}
