import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { startDashboard } from '../../src/bigbrain/dashboard.js';
import { buildAuthConfig } from '../../src/bigbrain/mcp-auth.js';
import { startMcpServer } from '../../src/bigbrain/mcp-server.js';
import {
  canonicalPagePath,
  canonicalPageUrl,
  isLoopbackHost,
  normalizeCanonicalPageSlug,
  parseCanonicalPagePath,
} from '../../src/bigbrain/page-links.js';
import { privatePageRouteFromPath } from '../../src/dashboard-client/page-links.js';

test('canonical page links are deterministic and preserve canonical identity', () => {
  const brainId = 'brn_01234567-89ab-4cde-8fab-0123456789ab';
  const expectedPath = `/dashboard/page/${brainId}/organizations/acme-intralog`;
  assert.equal(normalizeCanonicalPageSlug('organizations/acme-intralog.md'), 'organizations/acme-intralog');
  assert.equal(canonicalPagePath(brainId, 'organizations/acme-intralog.md'), expectedPath);
  assert.equal(canonicalPageUrl('http://127.0.0.1:55560', brainId, 'organizations/acme-intralog'), `http://127.0.0.1:55560${expectedPath}`);
  assert.deepEqual(parseCanonicalPagePath(expectedPath), {
    brainId,
    slug: 'organizations/acme-intralog',
  });
  assert.deepEqual(privatePageRouteFromPath(expectedPath), {
    brainId,
    slug: 'organizations/acme-intralog',
  });
  assert.equal(privatePageRouteFromPath(`/dashboard/page/${brainId}/organizations/%252e%252e`), null);
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('localhost'), true);
  assert.equal(isLoopbackHost('::1'), true);
  assert.equal(isLoopbackHost('0.0.0.0'), false);
  assert.equal(isLoopbackHost('brain.example.test'), false);
  const previouslyAcceptedBrainId = `brn_${'a'.repeat(35)}-`;
  assert.match(
    canonicalPagePath(previouslyAcceptedBrainId, 'organizations/acme-intralog'),
    new RegExp(`/dashboard/page/${previouslyAcceptedBrainId}/organizations/acme-intralog$`),
  );
});

test('canonical page links reject malformed IDs, traversal, separators, and encoded input', () => {
  const brainId = 'brn_01234567-89ab-4cde-8fab-0123456789ab';
  for (const slug of [
    '../organizations/acme',
    'organizations/../people/alice',
    'organizations\\acme',
    '/organizations/acme',
    'organizations//acme',
    'organizations/%2e%2e',
    'organizations/acme?debug=1',
    'organizations/acme#private',
  ]) {
    assert.throws(() => canonicalPagePath(brainId, slug), /Invalid canonical page slug|Invalid page path/);
  }
  assert.throws(() => canonicalPagePath('personal', 'organizations/acme'), /Invalid canonical brain ID/);
  assert.throws(
    () => parseCanonicalPagePath(`/dashboard/page/${brainId}/organizations/%252e%252e`),
    /Malformed canonical page route/,
  );
  assert.throws(
    () => parseCanonicalPagePath(`/dashboard/page/${brainId}/organizations/%5cacme`),
    /Malformed canonical page route/,
  );
});

test('loopback dashboard route opens one known page and defaults to 404 for missing, malformed, or other-brain targets', async () => {
  const fixture = await createFixture('bigbrain-page-link-route-');
  let server;
  try {
    await writeMarkdown(fixture.brainHome, 'organizations/acme-intralog.md', '# Acme Intralog\n\nCanonical local page body.\n');
    await writeMarkdown(fixture.brainHome, 'FILING.md', '# Brain Filing\n\nRoot filing rules remain readable.\n');
    const config = await loadConfig({ configPath: fixture.configPath });
    server = await startDashboard(config, { host: '127.0.0.1', port: 0 });
    const origin = serverOrigin(server);
    const route = canonicalPagePath(config.brainId, 'organizations/acme-intralog', { basePath: '' });
    const serviceRoute = canonicalPagePath(config.brainId, 'organizations/acme-intralog');

    const known = await fetch(`${origin}${route}`);
    assert.equal(known.status, 200);
    assert.match(await known.text(), /dashboard-client\.js/);
    assert.equal((await fetch(`${origin}${serviceRoute}`)).status, 200);

    const payload = await fetch(`${origin}/api/page?slug=organizations/acme-intralog`);
    assert.equal(payload.status, 200);
    const page = await payload.json();
    assert.equal(page.brain_id, config.brainId);
    assert.equal(page.page_url_path, serviceRoute);
    assert.equal(page.title, 'Acme Intralog');
    assert.match(page.markdown, /Canonical local page body/);
    const rootPayload = await fetch(`${origin}/api/page?slug=FILING`);
    assert.equal(rootPayload.status, 200);
    const rootPage = await rootPayload.json();
    assert.equal(rootPage.slug, 'FILING');
    assert.equal(rootPage.page_url_path, null);
    assert.match(rootPage.markdown, /Root filing rules remain readable/);

    const missing = await fetch(`${origin}${canonicalPagePath(config.brainId, 'organizations/missing', { basePath: '' })}`);
    assert.equal(missing.status, 404);
    const otherBrain = await fetch(`${origin}${canonicalPagePath('brn_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'organizations/acme-intralog', { basePath: '' })}`);
    assert.equal(otherBrain.status, 404);
    const encodedTraversal = await fetch(`${origin}/page/${config.brainId}/organizations/%252e%252e`);
    assert.equal(encodedTraversal.status, 404);
    assert.doesNotMatch(await encodedTraversal.text(), /Canonical local page body/);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('MCP defaults to loopback and returns an exact clickable local URL without guessed identifiers', async () => {
  const fixture = await createFixture('bigbrain-page-link-mcp-');
  let running;
  try {
    await writeMarkdown(fixture.brainHome, 'organizations/acme-intralog.md', '# Acme Intralog\n\nCanonical MCP page body.\n');
    await writeMarkdown(fixture.brainHome, 'FILING.md', '# Brain Filing\n\nRoot MCP read remains compatible.\n');
    const config = await loadConfig({ configPath: fixture.configPath });
    running = await startMcpServer({
      config,
      port: 0,
      authConfig: buildAuthConfig({ env: { BIGBRAIN_MCP_AUTH_MODE: 'none' }, authToken: null }),
      syncIntervalMs: 0,
      gitBackupEnabled: false,
    });
    const address = running.server.address();
    assert.equal(typeof address, 'object');
    assert.ok(address);
    assert.equal(address.address, '127.0.0.1');

    const response = await fetch(running.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'get_page_visibility',
          arguments: { path: 'organizations/acme-intralog.md' },
        },
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    const expected = running.url.replace(
      '/mcp',
      `/dashboard/page/${config.brainId}/organizations/acme-intralog`,
    );
    assert.equal(payload.result.structuredContent.page_url, expected);
    assert.equal(
      payload.result.structuredContent.local_url,
      `http://127.0.0.1:55559/page/${config.brainId}/organizations/acme-intralog`,
    );
    assert.equal((await fetch(expected)).status, 200);

    const rootReadResponse = await fetch(running.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'read', arguments: { path: 'FILING.md' } },
      }),
    });
    const rootRead = await rootReadResponse.json();
    assert.equal(rootRead.error, undefined);
    assert.equal(rootRead.result.structuredContent.path, 'FILING.md');
    assert.equal(rootRead.result.structuredContent.local_url, null);
    assert.equal(rootRead.result.structuredContent.page_url, null);
    assert.match(rootRead.result.structuredContent.body, /Root MCP read remains compatible/);
  } finally {
    await running?.close();
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

async function writeMarkdown(brainHome, relativePath, content) {
  const fullPath = path.join(brainHome, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf8');
}

function serverOrigin(server) {
  const address = server.address();
  assert.equal(typeof address, 'object');
  assert.ok(address);
  return `http://127.0.0.1:${address.port}`;
}
