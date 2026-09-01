import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageJson = require('../../package.json');
const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const BIGBRAIN_RELEASE_VERSION = packageJson.version;
export const BIGBRAIN_DESKTOP_RELEASE_VERSION = componentVersion('BIGBRAIN_DESKTOP_VERSION');
export const BIGBRAIN_MCP_RELEASE_VERSION = componentVersion('BIGBRAIN_MCP_VERSION');
export const BIGBRAIN_RELEASE_MANIFEST_SCHEMA_VERSION = 1;

export function createReleaseManifest({
  repoRoot = DEFAULT_REPO_ROOT,
  desktopVersion = BIGBRAIN_DESKTOP_RELEASE_VERSION,
  mcpVersion = BIGBRAIN_MCP_RELEASE_VERSION,
} = {}) {
  const version = BIGBRAIN_RELEASE_VERSION;
  return {
    schema_version: BIGBRAIN_RELEASE_MANIFEST_SCHEMA_VERSION,
    name: packageJson.name,
    version,
    version_source: 'package.json',
    components: {
      desktop: normalizeComponentVersion(desktopVersion, 'desktop'),
      cli: normalizeComponentVersion(mcpVersion, 'cli'),
      dashboard: normalizeComponentVersion(mcpVersion, 'dashboard'),
      local_mcp: normalizeComponentVersion(mcpVersion, 'local_mcp'),
      server: normalizeComponentVersion(mcpVersion, 'server'),
      skills: normalizeComponentVersion(mcpVersion, 'skills'),
      automations: normalizeComponentVersion(mcpVersion, 'automations'),
    },
    bundles: {
      skills: {
        release_version: version,
        ids: listBundleIds(path.join(repoRoot, 'skills'), 'SKILL.md'),
      },
      automations: {
        release_version: version,
        ids: listBundleIds(path.join(repoRoot, 'automations'), 'automation.toml'),
      },
    },
  };
}

export const BIGBRAIN_RELEASE_MANIFEST = deepFreeze(createReleaseManifest());

function listBundleIds(rootDir, markerFilename) {
  let entries;
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(rootDir, entry.name, markerFilename)))
    .map((entry) => entry.name)
    .sort();
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function componentVersion(environmentKey) {
  const value = String(process.env[environmentKey] || '').trim();
  return value || BIGBRAIN_RELEASE_VERSION;
}

function normalizeComponentVersion(value, component) {
  const version = String(value || '').trim();
  if (!version) throw new Error(`The ${component} component version is required.`);
  return version;
}
