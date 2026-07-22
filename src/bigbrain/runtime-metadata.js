import { createRequire } from 'node:module';
import { BIGBRAIN_STORAGE_SCHEMA_VERSION } from './db.js';

const require = createRequire(import.meta.url);
const packageJson = require('../../package.json');

export const BIGBRAIN_APP_VERSION = packageJson.version;
export const BIGBRAIN_API_CONTRACT_VERSION = 1;
export const BIGBRAIN_MCP_PROTOCOL_VERSION = '2024-11-05';
export { BIGBRAIN_STORAGE_SCHEMA_VERSION };

const API_CONTRACT_COMPATIBILITY = Object.freeze({
  minimum: BIGBRAIN_API_CONTRACT_VERSION,
  maximum: BIGBRAIN_API_CONTRACT_VERSION,
});
const STORAGE_SCHEMA_COMPATIBILITY = Object.freeze({
  minimum: BIGBRAIN_STORAGE_SCHEMA_VERSION,
  maximum: BIGBRAIN_STORAGE_SCHEMA_VERSION,
});

export function runtimeMetadata(env = process.env) {
  return {
    application: {
      name: packageJson.name,
      version: BIGBRAIN_APP_VERSION,
    },
    build: {
      commit: buildCommit(env),
      built_at: buildTimestamp(env),
    },
    contracts: {
      mcp_protocol: BIGBRAIN_MCP_PROTOCOL_VERSION,
      api: BIGBRAIN_API_CONTRACT_VERSION,
    },
    storage_schema: BIGBRAIN_STORAGE_SCHEMA_VERSION,
    compatibility: {
      api_contract: API_CONTRACT_COMPATIBILITY,
      storage_schema: STORAGE_SCHEMA_COMPATIBILITY,
    },
    capabilities: [
      'health.live',
      'health.ready',
      'mcp.tools',
    ],
  };
}

function buildCommit(env) {
  const candidate = [
    env.BIGBRAIN_BUILD_COMMIT,
    env.SOURCE_COMMIT,
    env.GITHUB_SHA,
    env.RAILWAY_GIT_COMMIT_SHA,
    env.VERCEL_GIT_COMMIT_SHA,
  ].find(Boolean);
  const normalized = String(candidate || '').trim();
  return /^[a-f0-9]{7,64}$/i.test(normalized) ? normalized : null;
}

function buildTimestamp(env) {
  const candidate = String(env.BIGBRAIN_BUILD_TIMESTAMP || '').trim();
  if (!candidate) return null;
  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
