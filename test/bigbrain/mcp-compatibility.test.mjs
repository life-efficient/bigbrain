import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DESKTOP_MCP_API_COMPATIBILITY,
  DESKTOP_MCP_PROTOCOL_VERSIONS,
  assessMcpCompatibility,
  desktopMcpSupportMetadata,
} from '../../src/bigbrain/mcp-compatibility.js';

test('desktop publishes the MCP contract it supports', () => {
  assert.deepEqual(desktopMcpSupportMetadata(), {
    api_contract: { ...DESKTOP_MCP_API_COMPATIBILITY },
    protocol_versions: [...DESKTOP_MCP_PROTOCOL_VERSIONS],
  });
});

test('MCP compatibility accepts the current runtime contract', () => {
  assert.deepEqual(assessMcpCompatibility({
    runtime: {
      application: { version: '0.25.0' },
      contracts: { api: 1, mcp_protocol: '2024-11-05' },
      compatibility: { api_contract: { minimum: 1, maximum: 1 } },
    },
  }), {
    state: 'compatible',
    server_version: '0.25.0',
    api_contract: { minimum: 1, maximum: 1 },
    protocol_version: '2024-11-05',
    message: 'MCP 0.25.0 is compatible with this desktop.',
  });
});

test('MCP compatibility identifies unsupported contracts without blocking legacy connections', () => {
  assert.equal(assessMcpCompatibility({
    runtime: {
      application: { version: '2.0.0' },
      contracts: { api: 2, mcp_protocol: '2024-11-05' },
      compatibility: { api_contract: { minimum: 2, maximum: 2 } },
    },
  }).state, 'incompatible');
  assert.equal(assessMcpCompatibility({ ok: true, brain_id: 'brn_legacy' }).state, 'legacy');
});
