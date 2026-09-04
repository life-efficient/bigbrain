import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { startMcpServer } from '../../src/bigbrain/mcp-server.js';
import { syncBrain } from '../../src/bigbrain/sync.js';

test('MCP exposes Comprehension setup and iterative session summary tools without mutation metadata', async () => {
  const fixture = await createFixture('bigbrain-mcp-comprehension-');
  let server;
  try {
    await writeMarkdown(fixture.brainHome, 'concepts/systems-thinking.md', '# Systems Thinking\n\nSource exposition.\n');
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    server = await startMcpServer({
      config,
      host: '127.0.0.1',
      port: 0,
      authToken: 'secret',
      syncIntervalMs: 0,
      gitBackupEnabled: false,
    });

    const listed = await rpc(server.url, 'tools/list', {});
    const names = listed.result.tools.map((tool) => tool.name);
    assert.ok(names.includes('playbooks/comprehension'));
    assert.ok(names.includes('playbooks/comprehension/setup'));
    assert.ok(names.includes('playbooks/comprehension/session'));

    const setup = await rpc(server.url, 'tools/call', {
      name: 'playbooks/comprehension/setup',
      arguments: { guidance: 'Prioritise first principles and practical transfer.' },
    });
    assert.equal(setup.error, undefined, setup.error?.message);
    assert.equal(setup.result.structuredContent.guidance, 'Prioritise first principles and practical transfer.');

    const saved = await rpc(server.url, 'tools/call', {
      name: 'playbooks/comprehension/session',
      arguments: {
        page_slug: 'concepts/systems-thinking',
        session_id: 'systems-1',
        summary: 'Strengths: explains the core model.\nGaps: needs transfer.\nTutor notes: ask for an example.\nNext resume step: closed-book analogy.',
      },
    });
    assert.equal(saved.error, undefined, saved.error?.message);
    assert.equal(saved.result.structuredContent.page_slug, 'concepts/systems-thinking');

    const read = await rpc(server.url, 'tools/call', {
      name: 'playbooks/comprehension',
      arguments: { page_slug: 'concepts/systems-thinking' },
    });
    assert.equal(read.error, undefined, read.error?.message);
    assert.equal(read.result.structuredContent.setup.guidance, 'Prioritise first principles and practical transfer.');
    assert.equal(read.result.structuredContent.page.latest_session.summary, saved.result.structuredContent.summary);
  } finally {
    await server?.close();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

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

async function writeMarkdown(brainHome, relativePath, markdown) {
  const fullPath = path.join(brainHome, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, markdown, 'utf8');
}
