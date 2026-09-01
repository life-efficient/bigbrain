#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { createReleaseManifest } from '../src/bigbrain/release-manifest.js';

const execFileAsync = promisify(execFile);
const SCRIPT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_ROOT, '..');
export const MCP_BUNDLE_RUNTIME_PATHS = Object.freeze([
  'bin',
  'src',
  'schemas',
  'skills',
  'automations',
  '.bigbrain-dashboard',
  'package.json',
  'package-lock.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
]);

export async function buildMcpBundle({
  repoRoot = DEFAULT_REPO_ROOT,
  outputDir = path.join(repoRoot, 'dist', 'mcp'),
  mcpVersion = null,
} = {}) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const resolvedOutputDir = path.resolve(outputDir);
  const packageJson = JSON.parse(await fs.readFile(path.join(resolvedRepoRoot, 'package.json'), 'utf8'));
  const version = String(mcpVersion || process.env.BIGBRAIN_MCP_VERSION || packageJson.version || '').trim();
  validateVersion(version);

  await execFileAsync(process.execPath, [path.join(resolvedRepoRoot, 'scripts', 'build-dashboard-client.mjs')], {
    cwd: resolvedRepoRoot,
    maxBuffer: 128 * 1024,
  });
  await fs.mkdir(resolvedOutputDir, { recursive: true });

  const bundleName = `bigbrain-mcp-${version}`;
  const stageDir = path.join(resolvedOutputDir, `.stage-${bundleName}-${process.pid}`);
  const bundleRoot = path.join(stageDir, bundleName);
  const archivePath = path.join(resolvedOutputDir, `${bundleName}.tar.gz`);
  const checksumPath = `${archivePath}.sha256`;
  await fs.rm(stageDir, { recursive: true, force: true });
  await fs.mkdir(bundleRoot, { recursive: true });

  try {
    for (const relativePath of MCP_BUNDLE_RUNTIME_PATHS) {
      await copyRuntimePath(resolvedRepoRoot, bundleRoot, relativePath);
    }
    const manifest = createMcpBundleManifest({ packageJson, repoRoot: resolvedRepoRoot, mcpVersion: version });
    await fs.writeFile(path.join(bundleRoot, 'mcp-bundle.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await fs.writeFile(path.join(bundleRoot, 'MCP-BUNDLE.md'), renderBundleInstructions(version));

    await execFileAsync('tar', ['-czf', archivePath, '-C', stageDir, bundleName], { maxBuffer: 128 * 1024 });
    const checksum = createHash('sha256').update(await fs.readFile(archivePath)).digest('hex');
    await fs.writeFile(checksumPath, `${checksum}  ${path.basename(archivePath)}\n`);
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true });
  }

  return {
    kind: 'bigbrain_mcp_bundle',
    version,
    archivePath,
    checksumPath,
    manifestPath: `${bundleName}/mcp-bundle.json`,
  };
}

export function createMcpBundleManifest({ packageJson, repoRoot, mcpVersion }) {
  const version = String(mcpVersion || '').trim();
  validateVersion(version);
  return {
    schema_version: 1,
    kind: 'bigbrain_mcp_bundle',
    name: packageJson.name,
    mcp_version: version,
    source_version: packageJson.version,
    entrypoint: 'bin/bigbrain.js',
    command: 'node bin/bigbrain.js mcp',
    runtime: { node: '>=22.5.0' },
    release_manifest: createReleaseManifest({ repoRoot, mcpVersion: version }),
    runtime_paths: [...MCP_BUNDLE_RUNTIME_PATHS, 'mcp-bundle.json', 'MCP-BUNDLE.md'],
  };
}

async function copyRuntimePath(repoRoot, bundleRoot, relativePath) {
  const source = path.join(repoRoot, relativePath);
  const destination = path.join(bundleRoot, relativePath);
  const stats = await fs.stat(source);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  if (stats.isDirectory()) {
    await fs.cp(source, destination, { recursive: true });
  } else {
    await fs.copyFile(source, destination);
  }
}

function renderBundleInstructions(version) {
  return `# BigBrain MCP bundle ${version}

This archive contains the independently runnable BigBrain MCP runtime.

1. Extract this archive.
2. Run \`npm ci --omit=dev\` in the extracted directory.
3. Start the runtime with \`node bin/bigbrain.js mcp --brain-home /path/to/brain\`.

The runtime advertises its MCP protocol, API contract, and release version
through its health and readiness endpoints.
`;
}

function validateVersion(version) {
  if (!version || !/^[0-9A-Za-z.+-]+$/u.test(version)) {
    throw new Error(`Invalid MCP bundle version: ${version || '(empty)'}`);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  buildMcpBundle()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
