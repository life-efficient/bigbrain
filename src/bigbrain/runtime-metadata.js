import { BIGBRAIN_STORAGE_SCHEMA_VERSION } from './db.js';
import {
  BIGBRAIN_RELEASE_MANIFEST,
  BIGBRAIN_MCP_RELEASE_VERSION,
} from './release-manifest.js';
import {
  DESKTOP_MCP_PROTOCOL_VERSIONS,
  MCP_API_CONTRACT_VERSION,
  MCP_PROTOCOL_VERSION,
} from './mcp-compatibility.js';

export const BIGBRAIN_APP_VERSION = BIGBRAIN_MCP_RELEASE_VERSION;
export const BIGBRAIN_API_CONTRACT_VERSION = MCP_API_CONTRACT_VERSION;
export const BIGBRAIN_MCP_PROTOCOL_VERSION = MCP_PROTOCOL_VERSION;
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
      name: BIGBRAIN_RELEASE_MANIFEST.name,
      version: BIGBRAIN_APP_VERSION,
    },
    release: BIGBRAIN_RELEASE_MANIFEST,
    installation: installationMetadata(env),
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
      mcp_protocols: [...DESKTOP_MCP_PROTOCOL_VERSIONS],
    },
    capabilities: [
      'health.live',
      'health.ready',
      'mcp.tools',
    ],
  };
}

function installationMetadata(env) {
  const management = ['desktop', 'source'].includes(env.BIGBRAIN_SERVICE_MANAGER)
    ? env.BIGBRAIN_SERVICE_MANAGER
    : null;
  const source = ['desktop-bundle', 'source-checkout'].includes(env.BIGBRAIN_SERVICE_SOURCE)
    ? env.BIGBRAIN_SERVICE_SOURCE
    : null;
  const owner = management === 'desktop' && source === 'desktop-bundle'
    ? 'desktop_bundle'
    : management === 'source' && source === 'source-checkout'
      ? 'source'
      : 'unknown';
  return {
    owner,
    management,
    source,
    release_version: BIGBRAIN_APP_VERSION,
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
