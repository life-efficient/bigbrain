import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { startDashboard } from '../../src/bigbrain/dashboard.js';
import {
  BIGBRAIN_RELEASE_MANIFEST,
  BIGBRAIN_RELEASE_VERSION,
  createReleaseManifest,
} from '../../src/bigbrain/release-manifest.js';
import { runtimeMetadata } from '../../src/bigbrain/runtime-metadata.js';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const packageJson = require('../../package.json');
const packageLock = require('../../package-lock.json');

test('one package version identifies every public BigBrain component and bundled integration', async () => {
  const manifest = createReleaseManifest({ repoRoot });
  const expectedSkills = await bundleIds('skills', 'SKILL.md');
  const expectedAutomations = await bundleIds('automations', 'automation.toml');

  assert.equal(BIGBRAIN_RELEASE_VERSION, packageJson.version);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[''].version, packageJson.version);
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.version_source, 'package.json');
  assert.deepEqual(new Set(Object.values(manifest.components)), new Set([packageJson.version]));
  assert.equal(manifest.bundles.skills.release_version, packageJson.version);
  assert.equal(manifest.bundles.automations.release_version, packageJson.version);
  assert.deepEqual(manifest.bundles.skills.ids, expectedSkills);
  assert.deepEqual(manifest.bundles.automations.ids, expectedAutomations);
  assert.deepEqual(BIGBRAIN_RELEASE_MANIFEST, manifest);
  assert.equal(runtimeMetadata().release.version, packageJson.version);
});

test('release manifests can identify desktop and MCP components independently', () => {
  const manifest = createReleaseManifest({ repoRoot, desktopVersion: '1.4.0', mcpVersion: '0.25.0' });
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.components.desktop, '1.4.0');
  assert.equal(manifest.components.cli, '0.25.0');
  assert.equal(manifest.components.local_mcp, '0.25.0');
  assert.equal(manifest.components.server, '0.25.0');
  assert.equal(manifest.components.skills, '0.25.0');
});

test('CLI version output and dashboard health expose the canonical release version', async () => {
  const plain = await execFileAsync(process.execPath, [path.join(repoRoot, 'bin', 'bigbrain.js'), '--version'], { cwd: repoRoot });
  assert.equal(plain.stdout.trim(), packageJson.version);

  const json = await execFileAsync(process.execPath, [path.join(repoRoot, 'bin', 'bigbrain.js'), '--version', '--json'], { cwd: repoRoot });
  assert.equal(JSON.parse(json.stdout).version, packageJson.version);

  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bigbrain-release-version-'));
  let server;
  try {
    const brainHome = path.join(rootDir, 'brain');
    const initialized = await initializeBrainHome(brainHome, {
      env: {
        ...process.env,
        BIGBRAIN_POINTER_PATH: path.join(rootDir, 'pointer'),
        BIGBRAIN_STATE_ROOT: path.join(rootDir, 'state'),
      },
    });
    const config = await loadConfig({ configPath: initialized.configPath });
    server = await startDashboard(config, { host: '127.0.0.1', port: 0 });
    const address = server.address();
    assert.equal(typeof address, 'object');
    const health = await fetch(`http://127.0.0.1:${address.port}/api/health`).then((response) => response.json());
    assert.equal(health.runtime.application.version, packageJson.version);
    assert.equal(health.runtime.release.version, packageJson.version);
    assert.deepEqual(health.runtime.release.bundles.skills.ids, BIGBRAIN_RELEASE_MANIFEST.bundles.skills.ids);
    assert.deepEqual(health.runtime.release.bundles.automations.ids, BIGBRAIN_RELEASE_MANIFEST.bundles.automations.ids);
  } finally {
    if (server) {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test('desktop and server artifacts carry the versioned skill and automation bundles', async () => {
  assert.ok(packageJson.build.files.includes('src/**/*'));
  assert.ok(packageJson.build.files.includes('skills/**/*'));
  assert.ok(packageJson.build.files.includes('automations/**/*'));

  const dockerfile = await fs.readFile(path.join(repoRoot, 'deploy', 'bundled-postgres', 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /COPY automations \.\/automations/);
  assert.match(dockerfile, /COPY skills \.\/skills/);
  assert.match(dockerfile, /COPY src \.\/src/);
});

test('desktop and MCP release workflows are independently scoped to release tags', async () => {
  const desktopWorkflow = await fs.readFile(path.join(repoRoot, '.github', 'workflows', 'release-macos.yml'), 'utf8');
  const mcpWorkflow = await fs.readFile(path.join(repoRoot, '.github', 'workflows', 'release-mcp.yml'), 'utf8');
  assert.doesNotMatch(desktopWorkflow, /publish_server:/);
  assert.doesNotMatch(desktopWorkflow, /docker\/build-push-action/);
  assert.match(mcpWorkflow, /name: Release BigBrain MCP runtime/);
  assert.match(mcpWorkflow, /if: github\.ref_type == 'tag'/);
  assert.match(mcpWorkflow, /npm run mcp:bundle/);
  assert.match(mcpWorkflow, /docker\/build-push-action/);
  assert.match(mcpWorkflow, /gh release upload/);
});

async function bundleIds(relativeRoot, markerFilename) {
  const root = path.join(repoRoot, relativeRoot);
  const entries = await fs.readdir(root, { withFileTypes: true });
  const ids = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const marker = path.join(root, entry.name, markerFilename);
    if (await fs.stat(marker).then((value) => value.isFile()).catch(() => false)) ids.push(entry.name);
  }
  return ids.sort();
}
