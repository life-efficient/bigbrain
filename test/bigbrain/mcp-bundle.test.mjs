import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  MCP_BUNDLE_RUNTIME_PATHS,
  createMcpBundleManifest,
} from '../../scripts/build-mcp-bundle.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const execFileAsync = promisify(execFile);

test('MCP bundle manifest identifies an independently versioned runtime', async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['mcp:bundle'], 'node ./scripts/build-mcp-bundle.mjs');
  const manifest = createMcpBundleManifest({ packageJson, repoRoot, mcpVersion: '0.25.0' });
  assert.equal(manifest.kind, 'bigbrain_mcp_bundle');
  assert.equal(manifest.mcp_version, '0.25.0');
  assert.equal(manifest.source_version, packageJson.version);
  assert.equal(manifest.entrypoint, 'bin/bigbrain.js');
  assert.equal(manifest.release_manifest.components.local_mcp, '0.25.0');
  assert.deepEqual(manifest.runtime_paths, [...MCP_BUNDLE_RUNTIME_PATHS, 'mcp-bundle.json', 'MCP-BUNDLE.md']);
});

test('MCP bundle runtime paths exist in the source checkout', async () => {
  await execFileAsync(process.execPath, [path.join(repoRoot, 'scripts', 'build-dashboard-client.mjs')], { cwd: repoRoot });
  for (const relativePath of MCP_BUNDLE_RUNTIME_PATHS) {
    await assert.doesNotReject(() => fs.stat(path.join(repoRoot, relativePath)), relativePath);
  }
});
