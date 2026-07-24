import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { getPageRecord, listMcpAuditLog, openDatabase } from '../../src/bigbrain/db.js';
import { upsertMember } from '../../src/bigbrain/members.js';
import { startMcpServer } from '../../src/bigbrain/mcp-server.js';
import {
  BIGBRAIN_API_CONTRACT_VERSION,
  BIGBRAIN_APP_VERSION,
  BIGBRAIN_MCP_PROTOCOL_VERSION,
  BIGBRAIN_STORAGE_SCHEMA_VERSION,
  runtimeMetadata,
} from '../../src/bigbrain/runtime-metadata.js';

test('runtime metadata reports release and compatibility information without reflecting arbitrary environment values', () => {
  const metadata = runtimeMetadata({
    BIGBRAIN_BUILD_COMMIT: 'abc1234',
    BIGBRAIN_BUILD_TIMESTAMP: '2026-07-22T10:30:00Z',
    DATABASE_URL: 'postgres://secret@example.test/brain',
    BIGBRAIN_MCP_TOKEN: 'super-secret',
  });

  assert.equal(metadata.application.version, BIGBRAIN_APP_VERSION);
  assert.equal(metadata.build.commit, 'abc1234');
  assert.equal(metadata.build.built_at, '2026-07-22T10:30:00.000Z');
  assert.equal(metadata.contracts.mcp_protocol, BIGBRAIN_MCP_PROTOCOL_VERSION);
  assert.equal(metadata.contracts.api, BIGBRAIN_API_CONTRACT_VERSION);
  assert.equal(metadata.storage_schema, BIGBRAIN_STORAGE_SCHEMA_VERSION);
  assert.deepEqual(metadata.compatibility.api_contract, { minimum: 1, maximum: 1 });
  assert.deepEqual(metadata.compatibility.storage_schema, { minimum: 1, maximum: 1 });
  assert.doesNotMatch(JSON.stringify(metadata), /secret|postgres/);
  assert.equal(runtimeMetadata({ BIGBRAIN_BUILD_COMMIT: 'not-a-commit' }).build.commit, null);
});

test('readiness fails closed when the configured brain becomes unavailable while liveness remains healthy', async () => {
  const fixture = await createFixture('bigbrain-mcp-readiness-');
  let running;
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    running = await startMcpServer({
      config,
      host: '127.0.0.1',
      port: 0,
      authToken: 'secret',
      syncIntervalMs: 0,
    });
    await fs.rename(fixture.brainHome, `${fixture.brainHome}-offline`);

    const readyResponse = await fetch(running.url.replace('/mcp', '/ready'));
    assert.equal(readyResponse.status, 503);
    assert.deepEqual(await readyResponse.json().then(({ ok, status, reason, checks }) => ({ ok, status, reason, checks })), {
      ok: false,
      status: 'not_ready',
      reason: 'brain_unavailable',
      checks: { brain: 'unavailable', storage: 'not_checked' },
    });

    const liveResponse = await fetch(running.url.replace('/mcp', '/live'));
    assert.equal(liveResponse.status, 200);
    assert.equal((await liveResponse.json()).status, 'live');
  } finally {
    await running?.close();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('isolated MCP instances cannot read or search each other\'s brains', async () => {
  const first = await createFixture('bigbrain-isolation-a-');
  const second = await createFixture('bigbrain-isolation-b-');
  let firstServer;
  let secondServer;
  try {
    await fs.writeFile(path.join(first.brainHome, 'people', 'only-a.md'), '# Only Alpha\n\nalpha-isolation-token\n', 'utf8');
    await fs.writeFile(path.join(second.brainHome, 'people', 'only-b.md'), '# Only Beta\n\nbeta-isolation-token\n', 'utf8');
    const firstConfig = await loadConfig({ configPath: first.configPath });
    const secondConfig = await loadConfig({ configPath: second.configPath });
    firstServer = await startMcpServer({ config: firstConfig, host: '127.0.0.1', port: 0, authToken: 'first-secret', syncIntervalMs: 0 });
    secondServer = await startMcpServer({ config: secondConfig, host: '127.0.0.1', port: 0, authToken: 'second-secret', syncIntervalMs: 0 });

    const firstOwn = await rpc(firstServer.url, 'tools/call', { name: 'read', arguments: { path: 'people/only-a' } }, 'first-secret');
    const firstOther = await rpc(firstServer.url, 'tools/call', { name: 'read', arguments: { path: 'people/only-b' } }, 'first-secret');
    const secondOwn = await rpc(secondServer.url, 'tools/call', { name: 'read', arguments: { path: 'people/only-b' } }, 'second-secret');
    const secondOther = await rpc(secondServer.url, 'tools/call', { name: 'read', arguments: { path: 'people/only-a' } }, 'second-secret');
    assert.match(JSON.stringify(firstOwn), /alpha-isolation-token/);
    assert.ok(firstOther.error);
    assert.match(JSON.stringify(secondOwn), /beta-isolation-token/);
    assert.ok(secondOther.error);

    const escaped = await rpc(firstServer.url, 'tools/call', { name: 'read', arguments: { path: '../brain/people/only-b' } }, 'first-secret');
    assert.ok(escaped.error || /invalid|outside|not found/i.test(JSON.stringify(escaped)));

    const firstHealth = await fetch(firstServer.url.replace('/mcp', '/health')).then((response) => response.json());
    const secondHealth = await fetch(secondServer.url.replace('/mcp', '/health')).then((response) => response.json());
    assert.equal(firstHealth.brain_id, firstConfig.brainId);
    assert.equal(secondHealth.brain_id, secondConfig.brainId);
    assert.notEqual(firstHealth.brain_id, secondHealth.brain_id);

    const crossBrainRoute = firstServer.url.replace(
      '/mcp',
      `/dashboard/page/${secondConfig.brainId}/people/only-b`,
    );
    const crossBrainPage = await fetch(crossBrainRoute, {
      headers: { authorization: `Basic ${Buffer.from('user:first-secret').toString('base64')}` },
    });
    assert.equal(crossBrainPage.status, 404);
    assert.doesNotMatch(await crossBrainPage.text(), /beta-isolation-token/);
  } finally {
    await firstServer?.close();
    await secondServer?.close();
    await fs.rm(first.rootDir, { recursive: true, force: true });
    await fs.rm(second.rootDir, { recursive: true, force: true });
  }
});

test('MCP server lists tools and writes pages through tools/call', async () => {
  const fixture = await createFixture('bigbrain-mcp-server-');
  let running;
  try {
    await fs.mkdir(path.join(fixture.brainHome, 'people'), { recursive: true });
    await fs.mkdir(path.join(fixture.brainHome, 'people', '.raw'), { recursive: true });
    const publicPdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x0a, 0x00, 0xff, 0x62, 0x79, 0x74, 0x65, 0x73]);
    await fs.writeFile(path.join(fixture.brainHome, 'people', '.raw', 'public.pdf'), publicPdfBytes);
    await fs.writeFile(path.join(fixture.brainHome, 'people', '.raw', 'active.svg'), '<svg><script>alert(1)</script></svg>');
    await fs.writeFile(path.join(fixture.brainHome, 'people', '.raw', 'unlinked.pdf'), 'unlinked public pdf bytes');
    await fs.writeFile(path.join(fixture.brainHome, 'people', '.raw', 'private.pdf'), 'private pdf bytes');
    await fs.writeFile(path.join(fixture.brainHome, 'people', 'public.md'), [
      '---',
      'title: Public MCP Page',
      'visibility: public',
      'public_raw_files: [people/.raw/public.pdf, people/.raw/active.svg, people/.raw/unlinked.pdf]',
      '---',
      '# Public MCP Page',
      '',
      'Public body through hosted MCP wrapper. [PDF](.raw/public.pdf) [Active SVG](.raw/active.svg) [Private PDF](.raw/private.pdf).',
      '',
      '---',
      '',
      '## Timeline',
      '',
      '- 2026-06-28 | Private timeline.',
    ].join('\n'), 'utf8');
    const config = await loadConfig({ configPath: fixture.configPath });
    running = await startMcpServer({
      config,
      host: '127.0.0.1',
      port: 0,
      authToken: 'secret',
      syncIntervalMs: 0,
      gitBackupEnabled: false,
    });
    const handshake = await rpc(running.url, 'initialize', { protocolVersion: '2024-11-05' }, 'secret');
    assert.equal(handshake.result.serverInfo.name, 'Brain');
    assert.equal(handshake.result.serverInfo.version, BIGBRAIN_APP_VERSION);
    assert.equal(handshake.result.protocolVersion, BIGBRAIN_MCP_PROTOCOL_VERSION);
    const unsupportedHandshake = await rpc(running.url, 'initialize', { protocolVersion: '2099-01-01' }, 'secret');
    assert.equal(unsupportedHandshake.result.protocolVersion, BIGBRAIN_MCP_PROTOCOL_VERSION);

    const liveResponse = await fetch(running.url.replace('/mcp', '/live'));
    assert.equal(liveResponse.status, 200);
    const live = await liveResponse.json();
    assert.equal(live.status, 'live');
    assert.equal(live.runtime.application.version, BIGBRAIN_APP_VERSION);
    assert.equal('brain_id' in live, false);

    const readyResponse = await fetch(running.url.replace('/mcp', '/ready'));
    assert.equal(readyResponse.status, 200);
    const ready = await readyResponse.json();
    assert.equal(ready.status, 'ready');
    assert.deepEqual(ready.checks, { brain: 'ok', storage: 'ok' });
    assert.equal(ready.brain_id, config.brainId);
    assert.equal(ready.runtime.contracts.api, BIGBRAIN_API_CONTRACT_VERSION);

    const publicPage = await fetch(running.url.replace('/mcp', '/public/people/public'), { redirect: 'manual' });
    assert.equal(publicPage.status, 200);
    const publicHtml = await publicPage.text();
    assert.match(publicHtml, /dashboard-client\.js/);
    assert.match(publicHtml, /\.public-main \{[^}]*height: 100vh;[^}]*overflow: auto;/);

    const publicApi = await fetch(running.url.replace('/mcp', '/api/public/page?slug=people/public'));
    assert.equal(publicApi.status, 200);
    const publicPayload = await publicApi.json();
    assert.equal(publicPayload.title, 'Public MCP Page');
    assert.match(publicPayload.markdown, /Public body through hosted MCP wrapper/);
    assert.match(publicPayload.markdown, /\[PDF\]\(\/api\/public\/raw\?slug=people%2Fpublic&path=people%2F\.raw%2Fpublic\.pdf\)/);
    assert.doesNotMatch(JSON.stringify(publicPayload), /active\.svg/);
    assert.doesNotMatch(publicPayload.markdown, /private\.pdf/);
    assert.doesNotMatch(JSON.stringify(publicPayload), /unlinked\.pdf/);
    assert.deepEqual(publicPayload.raw_files, [
      {
        filename: 'public.pdf',
        url: '/api/public/raw?slug=people%2Fpublic&path=people%2F.raw%2Fpublic.pdf',
      },
    ]);
    assert.doesNotMatch(publicPayload.markdown, /Private timeline/);

    const publicRaw = await fetch(running.url.replace('/mcp', '/api/public/raw?slug=people%2Fpublic&path=people%2F.raw%2Fpublic.pdf'));
    assert.equal(publicRaw.status, 200);
    assert.equal(publicRaw.headers.get('content-type'), 'application/pdf');
    assert.equal(Number(publicRaw.headers.get('content-length')), publicPdfBytes.length);
    assert.match(publicRaw.headers.get('content-disposition'), /^inline; filename="public\.pdf"/);
    assert.match(publicRaw.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal(publicRaw.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await publicRaw.arrayBuffer()), publicPdfBytes);

    const activeRaw = await fetch(running.url.replace('/mcp', '/api/public/raw?slug=people%2Fpublic&path=people%2F.raw%2Factive.svg'));
    assert.equal(activeRaw.status, 404);
    assert.notEqual(activeRaw.headers.get('content-type'), 'image/svg+xml');
    assert.equal(activeRaw.headers.get('content-disposition'), null);

    const privateRaw = await fetch(running.url.replace('/mcp', '/api/public/raw?slug=people%2Fpublic&path=people%2F.raw%2Fprivate.pdf'));
    assert.equal(privateRaw.status, 404);

    const listed = await rpc(running.url, 'tools/list', {}, 'secret');
    assert.equal(listed.result.tools.some((tool) => tool.name === 'create_page'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'filing_rules'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'about'), true);
    const aboutUpdateTool = listed.result.tools.find((tool) => tool.name === 'about/update');
    assert.equal(aboutUpdateTool.inputSchema.properties.profile.properties.schema_version.const, 1);
    assert.deepEqual(aboutUpdateTool.inputSchema.properties.profile.required, ['schema_version', 'identity', 'purpose_tags', 'routing', 'privacy', 'provenance']);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'create_raw_file_with_page'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'create_raw_file'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'read_raw_file'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'update_raw_file'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'rename_raw_file'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'delete_raw_file'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'rename_page'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'get_page_visibility'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'set_page_visibility'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'groups_list'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'groups_get'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'groups_upsert'), true);
    const visibilityTool = listed.result.tools.find((tool) => tool.name === 'set_page_visibility');
    assert.equal(visibilityTool.inputSchema.properties.public_raw_files.type, 'array');
    assert.match(visibilityTool.description, /absolute public_url/);
    const getVisibilityTool = listed.result.tools.find((tool) => tool.name === 'get_page_visibility');
    assert.match(getVisibilityTool.description, /public_url is a directly shareable absolute public URL/);

    const about = await rpc(running.url, 'tools/call', { name: 'about', arguments: {} }, 'secret');
    assert.equal(about.error, undefined, about.error?.message);
    assert.equal(about.result.structuredContent.brain_id, config.brainId);
    assert.equal(about.result.structuredContent.manifest.valid, true);
    assert.equal(about.result.structuredContent.manifest.reviewed, false);
    assert.equal(about.result.structuredContent.routing.effective_ingestion_mode, 'review');
    assert.equal(about.result.structuredContent.auth_state, 'local_trusted');
    assert.equal('updated_by' in about.result.structuredContent.descriptor.provenance, false);

    const unauthorized = await fetch(running.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    assert.equal(unauthorized.status, 401);

    const initialized = await fetch(running.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer secret',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
    });
    assert.equal(initialized.status, 202);
    assert.equal(await initialized.text(), '');

    const created = await rpc(running.url, 'tools/call', {
      name: 'create_page',
      arguments: {
        path: 'people/mcp-test',
        title: 'MCP Test',
        body: 'Created through the MCP server. [PDF](.raw/public.pdf)',
        timeline_entry: 'Created through MCP endpoint test.',
      },
    }, 'secret');

    assert.equal(created.error, undefined, created.error?.message);
    assert.equal(created.result.structuredContent.slug, 'people/mcp-test');
    assert.match(created.result.structuredContent.markdown, /Created through MCP endpoint test/);
    assert.equal(created.result.structuredContent.frontmatter.visibility, undefined);

    const privateVisibility = await rpc(running.url, 'tools/call', {
      name: 'get_page_visibility',
      arguments: { path: 'people/mcp-test' },
    }, 'secret');
    assert.equal(privateVisibility.result.structuredContent.visibility, 'internal');
    assert.equal(privateVisibility.result.structuredContent.public_url, null);
    assert.equal(privateVisibility.result.structuredContent.public_url_path, null);
    assert.equal(privateVisibility.result.structuredContent.brain_id, config.brainId);
    assert.equal(
      privateVisibility.result.structuredContent.local_url,
      running.url.replace('/mcp', `/dashboard/page/${config.brainId}/people/mcp-test`),
    );
    assert.equal(privateVisibility.result.structuredContent.page_url, privateVisibility.result.structuredContent.local_url);
    assert.equal(
      privateVisibility.result.structuredContent.page_url_path,
      `/dashboard/page/${config.brainId}/people/mcp-test`,
    );
    const unauthenticatedPrivatePage = await fetch(privateVisibility.result.structuredContent.local_url);
    assert.equal(unauthenticatedPrivatePage.status, 401);
    const authenticatedPrivatePage = await fetch(privateVisibility.result.structuredContent.local_url, {
      headers: { authorization: `Basic ${Buffer.from('user:secret').toString('base64')}` },
    });
    assert.equal(authenticatedPrivatePage.status, 200);
    assert.match(await authenticatedPrivatePage.text(), /dashboard-client\.js/);

    const published = await rpc(running.url, 'tools/call', {
      name: 'set_page_visibility',
      arguments: {
        path: 'people/mcp-test',
        visibility: 'public',
        public_raw_files: ['people/.raw/public.pdf'],
        timeline_entry: 'Published through MCP endpoint test.',
      },
    }, 'secret');
    assert.equal(published.error, undefined, published.error?.message);
    assert.equal(published.result.structuredContent.visibility, 'public');
    assert.equal(published.result.structuredContent.public_url, running.url.replace('/mcp', '/public/people/mcp-test'));
    assert.equal(published.result.structuredContent.public_url_path, '/public/people/mcp-test');
    assert.deepEqual(published.result.structuredContent.public_raw_files, ['people/.raw/public.pdf']);

    const visibility = await rpc(running.url, 'tools/call', {
      name: 'get_page_visibility',
      arguments: { path: 'people/mcp-test' },
    }, 'secret');
    assert.equal(visibility.result.structuredContent.visibility, 'public');
    assert.equal(visibility.result.structuredContent.public_url, running.url.replace('/mcp', '/public/people/mcp-test'));
    assert.equal(visibility.result.structuredContent.public_url_path, '/public/people/mcp-test');
    assert.equal(visibility.result.structuredContent.local_url, privateVisibility.result.structuredContent.local_url);
    assert.deepEqual(visibility.result.structuredContent.public_raw_files, ['people/.raw/public.pdf']);

    const group = await rpc(running.url, 'tools/call', {
      name: 'groups_upsert',
      arguments: {
        slug: 'mcp-group',
        title: 'MCP Group',
        description: 'Shared through MCP.',
        visibility: 'public',
        redirect_from: ['people/legacy-group-page'],
        pages: [{ page_slug: 'people/mcp-test', public_summary: 'Curated public member summary.', raw_files: ['people/.raw/public.pdf'] }],
      },
    }, 'secret');
    assert.equal(group.error, undefined, group.error?.message);
    assert.equal(group.result.structuredContent.public_url, running.url.replace('/mcp', '/shared/mcp-group'));
    assert.deepEqual(group.result.structuredContent.pages.map((page) => page.page_slug), ['people/mcp-test']);
    assert.deepEqual(group.result.structuredContent.pages[0].raw_files, ['people/.raw/public.pdf']);
    assert.equal(group.result.structuredContent.pages[0].public_summary, 'Curated public member summary.');

    const groupRead = await rpc(running.url, 'tools/call', {
      name: 'groups_get',
      arguments: { slug: 'people/legacy-group-page' },
    }, 'secret');
    assert.equal(groupRead.result.structuredContent.slug, 'mcp-group');
    assert.deepEqual(groupRead.result.structuredContent.pages[0].raw_files, ['people/.raw/public.pdf']);
    assert.equal(groupRead.result.structuredContent.pages[0].public_summary, 'Curated public member summary.');

    const sharedGroupApi = await fetch(running.url.replace('/mcp', '/api/shared/group?slug=mcp-group'));
    assert.equal(sharedGroupApi.status, 200);
    assert.equal((await sharedGroupApi.json()).slug, 'mcp-group');

    const sharedGroupPage = await fetch(running.url.replace('/mcp', '/shared/mcp-group'));
    assert.equal(sharedGroupPage.status, 200);
    assert.match(await sharedGroupPage.text(), /dashboard-client\.js/);

    const dashboardUrl = running.url.replace('/mcp', '/dashboard');
    const dashboardUnauthenticated = await fetch(dashboardUrl, { redirect: 'manual' });
    assert.equal(dashboardUnauthenticated.status, 401);
    assert.match(dashboardUnauthenticated.headers.get('www-authenticate'), /Basic realm="BigBrain Dashboard"/);

    const dashboardAuthenticated = await fetch(dashboardUrl, {
      headers: { authorization: `Basic ${Buffer.from('user:secret').toString('base64')}` },
    });
    assert.equal(dashboardAuthenticated.status, 200);
    assert.match(await dashboardAuthenticated.text(), /dashboard-client\.js/);

    const db = await openDatabase(config);
    const record = await getPageRecord(db, 'people/mcp-test');
    assert.equal(record.title, 'MCP Test');
    assert.match(record.compiled_truth, /Created through the MCP server/);
    const auditRows = await listMcpAuditLog(db);
    assert.equal(auditRows.some((row) => row.action === 'mcp.tool.read'), false);
    const createdAudit = auditRows.find((row) => row.action === 'mcp.tool.create_page');
    assert.equal(createdAudit.actor_email, null);
    const details = JSON.parse(createdAudit.details_json);
    assert.equal('status' in details, false);
    assert.equal('category' in details, false);
    assert.equal(details.arguments.path, 'people/mcp-test');
    assert.deepEqual(details.arguments.body, { redacted: true, length: 'Created through the MCP server. [PDF](.raw/public.pdf)'.length });
    assert.equal(JSON.stringify(details.arguments).includes('Created through the MCP server'), false);
    await db.close?.();
  } finally {
    if (running) await running.close();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('MCP search/query tools expose GBrain-style retrieval parameters', async () => {
  const fixture = await createFixture('bigbrain-mcp-search-query-');
  let running;
  const originalApiKey = process.env.OPENAI_API_KEY;
  try {
    delete process.env.OPENAI_API_KEY;
    await fs.mkdir(path.join(fixture.brainHome, 'people'), { recursive: true });
    await fs.writeFile(path.join(fixture.brainHome, 'people', 'mcp-query.md'), `---
title: MCP Query
---
# MCP Query

MCP query retrieval target.
`, 'utf8');
    const config = await loadConfig({ configPath: fixture.configPath });
    running = await startMcpServer({
      config,
      host: '127.0.0.1',
      port: 0,
      authToken: 'secret',
      syncIntervalMs: 0,
      gitBackupEnabled: false,
    });

    const listed = await rpc(running.url, 'tools/list', {}, 'secret');
    const search = listed.result.tools.find((tool) => tool.name === 'search');
    const query = listed.result.tools.find((tool) => tool.name === 'query');
    assert.deepEqual(search.inputSchema.properties.mode.enum, ['conservative', 'balanced', 'tokenmax']);
    assert.equal(search.inputSchema.properties.explain.type, 'boolean');
    assert.equal(query.inputSchema.properties.query.type, 'string');
    assert.equal(query.inputSchema.required, undefined);

    const queried = await rpc(running.url, 'tools/call', {
      name: 'query',
      arguments: {
        query: 'MCP query retrieval target',
        mode: 'conservative',
        explain: true,
      },
    }, 'secret');
    assert.equal(queried.error, undefined, queried.error?.message);
    assert.equal(queried.result.structuredContent.search.fused[0].slug, 'people/mcp-query');
    assert.equal(queried.result.structuredContent.search.fused[0].evidence.length > 0, true);
  } finally {
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
    if (running) await running.close();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('MCP server exposes brain-specific filing rules for harness routing', async () => {
  const fixture = await createFixture('bigbrain-mcp-filing-rules-');
  let running;
  try {
    await fs.writeFile(path.join(fixture.brainHome, 'FILING.md'), `---
type: note
title: Filing Rules
created: 2026-06-19
---

# Filing Rules

Shared cross-folder routing guidance.

## Filing Principles

- File by primary subject, not recipient context.
- Use collection FILING files for folder-specific rules.

## Page Shape

- YAML frontmatter with title and optional metadata.
- Append-only timeline evidence.
`, 'utf8');

    await fs.mkdir(path.join(fixture.brainHome, 'organizations'), { recursive: true });
    await fs.writeFile(path.join(fixture.brainHome, 'organizations', 'FILING.md'), `---
type: note
title: Organizations
created: 2026-06-18
---

# Organizations

One page per organization.

## What Goes Here

- Institutional partners, government bodies, universities, vendors, companies, advisory groups, and other organizations.

## What Does Not Go Here

- Individual people; use [People](../people/README.md).
`, 'utf8');

    const config = await loadConfig({ configPath: fixture.configPath });
    running = await startMcpServer({
      config,
      host: '127.0.0.1',
      port: 0,
      authToken: 'secret',
      syncIntervalMs: 0,
      gitBackupEnabled: false,
    });

    const rules = await rpc(running.url, 'tools/call', {
      name: 'filing_rules',
      arguments: {},
    }, 'secret');

    assert.equal(rules.error, undefined, rules.error?.message);
    assert.match(rules.result.content[0].text, /# BigBrain Filing Rules/);
    assert.match(rules.result.content[0].text, /## Shared Guidance \(FILING.md\)/);
    assert.match(rules.result.content[0].text, /### organizations \(organizations\/FILING.md\)/);
    assert.doesNotMatch(rules.result.content[0].text, /recommendation/i);
    assert.equal(rules.result.structuredContent.recommendation, undefined);
    assert.equal(rules.result.structuredContent.shared_guidance.path, 'FILING.md');
    assert.match(rules.result.structuredContent.shared_guidance.markdown, /Shared cross-folder routing guidance/);
    assert.deepEqual(rules.result.structuredContent.filing_principles, [
      'File by primary subject, not recipient context.',
      'Use collection FILING files for folder-specific rules.',
    ]);
    assert.deepEqual(rules.result.structuredContent.page_shape, [
      'YAML frontmatter with title and optional metadata.',
      'Append-only timeline evidence.',
    ]);
    const organizations = rules.result.structuredContent.collections.find((collection) => collection.name === 'organizations');
    assert.equal(organizations.path, 'organizations/');
    assert.equal(organizations.filing_path, 'organizations/FILING.md');
    assert.equal(organizations.readme_path, null);
    assert.deepEqual(organizations.what_goes_here, [
      'Institutional partners, government bodies, universities, vendors, companies, advisory groups, and other organizations.',
    ]);
    assert.match(organizations.markdown, /One page per organization/);
    assert.equal(rules.result.structuredContent.raw_file_rules.create_with_page_tool, 'create_raw_file_with_page');
    assert.match(rules.result.content[0].text, /Use deliverables\/.raw when the raw file is an owned output/);
    assert.match(rules.result.content[0].text, /Every valuable raw artifact has exactly one same-basename Markdown sidecar/);
    assert.equal(
      rules.result.structuredContent.raw_file_rules.examples.some((example) => example.raw_path.startsWith('deliverables/.raw/')),
      true,
    );
  } finally {
    if (running) await running.close();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('MCP server supports raw file CRUD tools', async () => {
  const fixture = await createFixture('bigbrain-mcp-raw-crud-');
  let running;
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    running = await startMcpServer({
      config,
      host: '127.0.0.1',
      port: 0,
      authToken: 'secret',
      syncIntervalMs: 0,
      gitBackupEnabled: false,
    });

    const created = await rpc(running.url, 'tools/call', {
      name: 'create_raw_file',
      arguments: {
        path: 'sources/.raw/mcp-crud.txt',
        raw_content_text: 'first version',
        mime_type: 'text/plain',
      },
    }, 'secret');
    assert.equal(created.error, undefined, created.error?.message);
    assert.equal(created.result.structuredContent.path, 'sources/.raw/mcp-crud.txt');
    assert.equal(created.result.structuredContent.size, 'first version'.length);

    const readInitial = await rpc(running.url, 'tools/call', {
      name: 'read_raw_file',
      arguments: { path: 'sources/.raw/mcp-crud.txt' },
    }, 'secret');
    assert.equal(Buffer.from(readInitial.result.structuredContent.content_base64, 'base64').toString('utf8'), 'first version');

    const updated = await rpc(running.url, 'tools/call', {
      name: 'update_raw_file',
      arguments: {
        path: 'sources/.raw/mcp-crud.txt',
        raw_content_text: 'second version',
        mime_type: 'text/plain',
      },
    }, 'secret');
    assert.equal(updated.result.structuredContent.size, 'second version'.length);

    const renamed = await rpc(running.url, 'tools/call', {
      name: 'rename_raw_file',
      arguments: {
        from_path: 'sources/.raw/mcp-crud.txt',
        to_path: 'sources/.raw/mcp-crud-renamed.txt',
      },
    }, 'secret');
    assert.equal(renamed.result.structuredContent.previous_path, 'sources/.raw/mcp-crud.txt');
    assert.equal(renamed.result.structuredContent.path, 'sources/.raw/mcp-crud-renamed.txt');

    const listed = await rpc(running.url, 'tools/call', {
      name: 'list_raw_files',
      arguments: { path: 'sources/.raw' },
    }, 'secret');
    assert.deepEqual(listed.result.structuredContent.files.map((entry) => entry.path), ['sources/.raw/mcp-crud-renamed.txt']);

    const deleted = await rpc(running.url, 'tools/call', {
      name: 'delete_raw_file',
      arguments: { path: 'sources/.raw/mcp-crud-renamed.txt' },
    }, 'secret');
    assert.deepEqual(deleted.result.structuredContent, { path: 'sources/.raw/mcp-crud-renamed.txt', deleted: true });
    await assert.rejects(() => fs.stat(path.join(fixture.brainHome, 'sources', '.raw', 'mcp-crud-renamed.txt')), /ENOENT/);
  } finally {
    if (running) await running.close();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('MCP server rejects oversized raw uploads and oversized request bodies', async () => {
  const fixture = await createFixture('bigbrain-mcp-raw-limit-');
  let running;
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    config.rawFileMaxBytes = 10;
    running = await startMcpServer({
      config,
      host: '127.0.0.1',
      port: 0,
      authToken: 'secret',
      syncIntervalMs: 0,
      gitBackupEnabled: false,
    });

    const oversizedRaw = await rpc(running.url, 'tools/call', {
      name: 'create_raw_file',
      arguments: {
        path: 'sources/.raw/too-large.txt',
        raw_content_text: 'this is too large',
        mime_type: 'text/plain',
      },
    }, 'secret');
    assert.match(oversizedRaw.error.message, /Raw file is too large/);
    await assert.rejects(() => fs.stat(path.join(fixture.brainHome, 'sources', '.raw', 'too-large.txt')), /ENOENT/);

    const response = await fetch(running.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer secret',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 99,
        method: 'tools/call',
        params: {
          name: 'create_raw_file',
          arguments: {
            path: 'sources/.raw/request-too-large.txt',
            raw_content_text: 'x'.repeat(1_100_000),
          },
        },
      }),
    });
    assert.equal(response.status, 413);
    const payload = await response.json();
    assert.equal(payload.error.code, -32013);
    assert.match(payload.error.message, /MCP request body is too large/);
  } finally {
    if (running) await running.close();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('MCP server uploads raw files with associated brain pages', async () => {
  const fixture = await createFixture('bigbrain-mcp-raw-');
  let running;
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    running = await startMcpServer({
      config,
      host: '127.0.0.1',
      port: 0,
      authToken: 'secret',
      syncIntervalMs: 0,
      gitBackupEnabled: false,
    });

    const pdfBytes = Buffer.from('%PDF-1.4\nmcp upload\n%%EOF\n', 'utf8');
    const created = await rpc(running.url, 'tools/call', {
      name: 'create_raw_file_with_page',
      arguments: {
        raw_path: 'sources/.raw/mcp-upload.pdf',
        raw_content_base64: pdfBytes.toString('base64'),
        mime_type: 'application/pdf',
        page_path: 'sources/.raw/mcp-upload',
        title: 'MCP Upload',
        body: 'Uploaded through the MCP raw file tool.',
        timeline_entry: 'Uploaded source PDF through MCP.',
        frontmatter: { tags: ['mcp', 'source'] },
      },
    }, 'secret');

    assert.equal(created.error, undefined, created.error?.message);
    assert.equal(created.result.structuredContent.raw_file.path, 'sources/.raw/mcp-upload.pdf');
    assert.equal(created.result.structuredContent.raw_file.size, pdfBytes.length);
    assert.equal(created.result.structuredContent.page.slug, 'sources/.raw/mcp-upload');
    assert.equal(created.result.structuredContent.page.frontmatter.raw_file, 'sources/.raw/mcp-upload.pdf');
    assert.match(created.result.structuredContent.page.markdown, /- \[mcp-upload\.pdf\]\(mcp-upload\.pdf\)/);

    const storedRaw = await fs.readFile(path.join(fixture.brainHome, 'sources', '.raw', 'mcp-upload.pdf'));
    assert.deepEqual(storedRaw, pdfBytes);

    const db = await openDatabase(config);
    const record = await getPageRecord(db, 'sources/.raw/mcp-upload');
    assert.equal(record.title, 'MCP Upload');
    assert.match(record.compiled_truth, /Uploaded through the MCP raw file tool/);
  } finally {
    if (running) await running.close();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('MCP list tool supports limit and ordering params', async () => {
  const fixture = await createFixture('bigbrain-mcp-list-');
  let running;
  try {
    const peopleDir = path.join(fixture.brainHome, 'people');
    await fs.mkdir(peopleDir, { recursive: true });
    await fs.writeFile(path.join(peopleDir, 'person-2.md'), '# Person 2\n', 'utf8');
    await fs.writeFile(path.join(peopleDir, 'person-10.md'), '# Person 10\n', 'utf8');
    await fs.writeFile(path.join(peopleDir, 'person-1.md'), '# Person 1\n', 'utf8');
    await fs.utimes(path.join(peopleDir, 'person-2.md'), new Date('2026-06-17T10:00:00Z'), new Date('2026-06-17T10:00:00Z'));
    await fs.utimes(path.join(peopleDir, 'person-10.md'), new Date('2026-06-17T12:00:00Z'), new Date('2026-06-17T12:00:00Z'));
    await fs.utimes(path.join(peopleDir, 'person-1.md'), new Date('2026-06-17T11:00:00Z'), new Date('2026-06-17T11:00:00Z'));

    const config = await loadConfig({ configPath: fixture.configPath });
    running = await startMcpServer({
      config,
      host: '127.0.0.1',
      port: 0,
      authToken: 'secret',
      syncIntervalMs: 0,
      gitBackupEnabled: false,
    });

    const listedTools = await rpc(running.url, 'tools/list', {}, 'secret');
    const listTool = listedTools.result.tools.find((tool) => tool.name === 'list');
    assert.deepEqual(listTool.inputSchema.properties.order_by.enum, ['updated_at', 'created_at', 'alphanumeric']);

    const alpha = await rpc(running.url, 'tools/call', {
      name: 'list',
      arguments: { path: 'people', recursive: false },
    }, 'secret');
    assert.equal(Array.isArray(alpha.result.structuredContent), false);
    assert.deepEqual(alpha.result.structuredContent.pages.map((entry) => entry.path), [
      'people/person-1.md',
      'people/person-2.md',
      'people/person-10.md',
    ]);
    assert.match(alpha.result.structuredContent.pages[0].created_at, /^\d{4}-\d{2}-\d{2}T/);

    const recent = await rpc(running.url, 'tools/call', {
      name: 'list',
      arguments: { path: 'people', recursive: false, order_by: 'updated_at', limit: 2 },
    }, 'secret');
    assert.deepEqual(recent.result.structuredContent.pages.map((entry) => entry.path), [
      'people/person-10.md',
      'people/person-1.md',
    ]);
  } finally {
    if (running) await running.close();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('MCP OAuth allowlist mode accepts per-user tokens and attributes writes', async () => {
  const fixture = await createFixture('bigbrain-mcp-oauth-');
  const token = 'bbmcp_test-token';
  const tokenStorePath = path.join(fixture.rootDir, 'tokens.json');
  await fs.writeFile(tokenStorePath, `${JSON.stringify({
    tokens: [{
      token_hash: hashToken(token),
      email: 'teammate@example.com',
      name: 'Team Mate',
      provider: 'google',
      created_at: new Date().toISOString(),
      last_used_at: null,
      revoked_at: null,
    }],
    states: [],
  }, null, 2)}\n`);

  let running;
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    running = await startMcpServer({
      config,
      host: '127.0.0.1',
      port: 0,
      authConfig: {
        mode: 'oauth_allowlist',
        authToken: null,
        publicUrl: 'https://brain.example.test',
        provider: 'google',
        googleClientId: 'client-id',
        googleClientSecret: 'client-secret',
        allowedEmails: ['teammate@example.com'],
        allowedDomains: [],
        tokenStorePath,
        allowSharedToken: false,
        serviceName: 'Example Brain',
        appName: 'Example Brain',
      },
      syncIntervalMs: 0,
      gitBackupEnabled: false,
    });

    const connect = await fetch(running.url.replace('/mcp', '/connect'));
    assert.equal(connect.status, 200);
    const connectHtml = await connect.text();
    assert.match(connectHtml, /<h1>Example Brain<\/h1>/);
    assert.match(connectHtml, /Give the instructions below to your agent to connect Codex securely, verify access, and then query and update the brain/);
    assert.match(connectHtml, /Connect Codex to this BigBrain service with OAuth, then verify the authenticated connection/);
    assert.match(connectHtml, /bigbrain connect codex https:\/\/brain\.example\.test\/mcp --name example-brain --auth oauth/);
    assert.match(connectHtml, /OAuth is the default for BigBrain services/);
    assert.match(connectHtml, /this page never exposes a bearer token/);
    assert.match(connectHtml, /After that, update your system prompt to include/);
    assert.match(connectHtml, /Anything related to Example Brain should be stored in, and searched for from Example Brain via MCP/);
    assert.match(connectHtml, /If an expected MCP tool is missing or only part of a server&#39;s tool surface appears, use the Find Missing Tools skill before concluding the tool is unavailable/);
    assert.doesNotMatch(connectHtml, /\[mcp_servers\.example-brain\]/);
    assert.match(connectHtml, /aria-label="Copy instructions"/);
    assert.match(connectHtml, /viewBox="0 0 24 24"/);
    assert.doesNotMatch(connectHtml, /MCP config/);
    assert.doesNotMatch(connectHtml, /Copy endpoint/);
    assert.doesNotMatch(connectHtml, /No bearer token is shown here/);
    assert.doesNotMatch(connectHtml, /teammate@example\.com/);
    assert.doesNotMatch(connectHtml, /Continue with Google/);
    assert.doesNotMatch(connectHtml, /bbmcp_/);

    const manualStart = await fetch(running.url.replace('/mcp', '/auth/start'));
    assert.equal(manualStart.status, 404);

    const dashboard = await fetch(running.url.replace('/mcp', '/dashboard'), { redirect: 'manual' });
    assert.equal(dashboard.status, 302);
    assert.match(dashboard.headers.get('location'), /^\/dashboard\/auth\/start\?redirect=%2Fdashboard/);

    const dashboardStart = await fetch(running.url.replace('/mcp', '/dashboard/auth/start?redirect=/dashboard'), { redirect: 'manual' });
    assert.equal(dashboardStart.status, 302);
    assert.match(dashboardStart.headers.get('location'), /^https:\/\/accounts\.google\.com\//);

    const unauthorized = await fetch(running.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer nope',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    assert.equal(unauthorized.status, 401);

    const created = await rpc(running.url, 'tools/call', {
      name: 'create_page',
      arguments: {
        path: 'people/oauth-test',
        title: 'OAuth Test',
        body: 'Created with a per-user MCP token.',
        timeline_entry: 'Created through hosted MCP.',
      },
    }, token);

    assert.equal(created.error, undefined, created.error?.message);
    assert.match(created.result.structuredContent.timeline, /Created through hosted MCP\. \(via teammate@example\.com\)/);

    const stored = JSON.parse(await fs.readFile(tokenStorePath, 'utf8'));
    assert.match(stored.tokens[0].last_used_at, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    if (running) await running.close();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('MCP OAuth scopes filter hosted tools by policy layer', async () => {
  const fixture = await createFixture('bigbrain-mcp-policy-');
  const readToken = 'bbmcp_read-token';
  const createToken = 'bbmcp_create-token';
  const publishToken = 'bbmcp_publish-token';
  const rawDeleteToken = 'bbmcp_raw-delete-token';
  const gitToken = 'bbmcp_git-token';
  const maintenanceToken = 'bbmcp_maintenance-token';
  const legacyWriteToken = 'bbmcp_legacy-write-token';
  const dashboardToken = 'bbdash_not-an-mcp-token';
  const adminToken = 'bbmcp_admin-token';
  const tokenStorePath = path.join(fixture.rootDir, 'tokens.json');
  await fs.writeFile(tokenStorePath, `${JSON.stringify({
    tokens: [
      scopedToken(readToken, 'reader@example.com', 'brain:read'),
      scopedToken(createToken, 'creator@example.com', 'brain:read brain:create'),
      scopedToken(publishToken, 'publisher@example.com', 'brain:read brain:publish'),
      scopedToken(rawDeleteToken, 'raw@example.com', 'brain:read brain:raw:destructive'),
      scopedToken(gitToken, 'git@example.com', 'brain:read brain:git-backup'),
      scopedToken(maintenanceToken, 'maintenance@example.com', 'brain:read brain:maintenance'),
      scopedToken(legacyWriteToken, 'legacy@example.com', 'brain:read brain:write'),
      scopedToken(dashboardToken, 'dashboard@example.com', 'dashboard:read'),
      scopedToken(adminToken, 'admin@example.com', 'brain:admin'),
    ],
    states: [],
    clients: [],
    codes: [],
  }, null, 2)}\n`);

  let running;
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    running = await startMcpServer({
      config,
      host: '127.0.0.1',
      port: 0,
      authConfig: {
        mode: 'oauth_allowlist',
        authToken: null,
        publicUrl: 'https://brain.example.test',
        provider: 'google',
        googleClientId: 'client-id',
        googleClientSecret: 'client-secret',
        allowedEmails: ['reader@example.com', 'creator@example.com', 'publisher@example.com', 'raw@example.com', 'git@example.com', 'maintenance@example.com', 'legacy@example.com', 'dashboard@example.com', 'admin@example.com'],
        allowedDomains: [],
        tokenStorePath,
        allowSharedToken: false,
        serviceName: 'Example Brain',
        appName: 'Example Brain',
      },
      syncIntervalMs: 0,
      gitBackupEnabled: false,
    });

    const readTools = toolNames(await rpc(running.url, 'tools/list', {}, readToken));
    assert.equal(readTools.includes('read'), true);
    assert.equal(readTools.includes('tasks/summary'), true);
    assert.equal(readTools.includes('tasks/get'), true);
    assert.equal(readTools.includes('tasks/hygiene'), true);
    assert.equal(readTools.includes('get_page_visibility'), true);
    assert.equal(readTools.includes('groups_list'), true);
    assert.equal(readTools.includes('groups_get'), true);
    assert.equal(readTools.includes('groups_upsert'), false);
    assert.equal(readTools.includes('set_page_visibility'), false);
    assert.equal(readTools.includes('create_page'), false);
    assert.equal(readTools.includes('update_raw_file'), false);
    assert.equal(readTools.includes('maintenance/sync'), false);
    const unknown = await rpc(running.url, 'tools/call', { name: 'future_unmapped_tool', arguments: {} }, readToken);
    assert.equal(unknown.error.code, -32003);
    assert.match(unknown.error.message, /not enabled by hosted MCP tool policy/);
    const readWrite = await rpc(running.url, 'tools/call', {
      name: 'create_page',
      arguments: {
        path: 'people/read-denied',
        title: 'Read Denied',
        body: 'Should not write.',
        timeline_entry: 'Denied.',
      },
    }, readToken);
    assert.equal(readWrite.error.code, -32003);
    assert.match(readWrite.error.message, /requires brain:create or brain:write scope/);

    const createTools = toolNames(await rpc(running.url, 'tools/list', {}, createToken));
    assert.equal(createTools.includes('create_page'), true);
    assert.equal(createTools.includes('create_raw_file'), true);
    assert.equal(createTools.includes('groups_upsert'), false);
    assert.equal(createTools.includes('set_page_visibility'), false);
    assert.equal(createTools.includes('update_raw_file'), false);
    assert.equal(createTools.includes('maintenance/git_backup'), false);
    const created = await rpc(running.url, 'tools/call', {
      name: 'create_page',
      arguments: {
        path: 'people/create-allowed',
        title: 'Create Allowed',
        body: 'Created with create scope.',
        timeline_entry: 'Created by scoped policy test.',
      },
    }, createToken);
    assert.equal(created.error, undefined, created.error?.message);
    assert.match(created.result.structuredContent.timeline, /via creator@example\.com/);
    const createPublish = await rpc(running.url, 'tools/call', {
      name: 'set_page_visibility',
      arguments: { path: 'people/create-allowed', visibility: 'public' },
    }, createToken);
    assert.equal(createPublish.error.code, -32003);
    assert.match(createPublish.error.message, /requires brain:publish scope/);
    const createPublicGroup = await rpc(running.url, 'tools/call', {
      name: 'groups_upsert',
      arguments: { slug: 'scope-bypass', title: 'Scope Bypass', visibility: 'public', pages: [{ page_slug: 'people/create-allowed' }] },
    }, createToken);
    assert.equal(createPublicGroup.error.code, -32003);
    assert.match(createPublicGroup.error.message, /requires brain:publish scope/);
    const createRawDelete = await rpc(running.url, 'tools/call', {
      name: 'delete_raw_file',
      arguments: { path: 'sources/.raw/missing.txt' },
    }, createToken);
    assert.equal(createRawDelete.error.code, -32003);
    assert.match(createRawDelete.error.message, /requires brain:raw:destructive scope/);

    const publishTools = toolNames(await rpc(running.url, 'tools/list', {}, publishToken));
    assert.equal(publishTools.includes('set_page_visibility'), true);
    assert.equal(publishTools.includes('groups_upsert'), true);
    assert.equal(publishTools.includes('create_page'), false);
    const published = await rpc(running.url, 'tools/call', {
      name: 'set_page_visibility',
      arguments: { path: 'people/create-allowed', visibility: 'public' },
    }, publishToken);
    assert.equal(published.error, undefined, published.error?.message);
    assert.equal(published.result.structuredContent.visibility, 'public');
    assert.equal(published.result.structuredContent.public_url, 'https://brain.example.test/public/people/create-allowed');
    assert.equal(published.result.structuredContent.public_url_path, '/public/people/create-allowed');
    assert.equal(
      published.result.structuredContent.page_url,
      `https://brain.example.test/dashboard/page/${config.brainId}/people/create-allowed`,
    );
    assert.equal(published.result.structuredContent.local_url, null);
    const publicGroup = await rpc(running.url, 'tools/call', {
      name: 'groups_upsert',
      arguments: {
        slug: 'publish-allowed',
        title: 'Publish Allowed',
        visibility: 'public',
        pages: [{ page_slug: 'people/create-allowed', public_summary: 'Safe summary.' }],
      },
    }, publishToken);
    assert.equal(publicGroup.error, undefined, publicGroup.error?.message);
    assert.equal(publicGroup.result.structuredContent.public_url, 'https://brain.example.test/shared/publish-allowed');

    const rawTools = toolNames(await rpc(running.url, 'tools/list', {}, rawDeleteToken));
    assert.equal(rawTools.includes('update_raw_file'), true);
    assert.equal(rawTools.includes('rename_raw_file'), true);
    assert.equal(rawTools.includes('delete_raw_file'), true);
    assert.equal(rawTools.includes('create_page'), false);

    const gitTools = toolNames(await rpc(running.url, 'tools/list', {}, gitToken));
    assert.equal(gitTools.includes('maintenance/git_backup'), true);
    assert.equal(gitTools.includes('maintenance/sync'), false);
    assert.equal(gitTools.includes('create_page'), false);

    const maintenanceTools = toolNames(await rpc(running.url, 'tools/list', {}, maintenanceToken));
    assert.equal(maintenanceTools.includes('maintenance/sync'), true);
    assert.equal(maintenanceTools.includes('maintenance/git_backup'), false);
    assert.equal(maintenanceTools.includes('create_page'), false);

    const legacyTools = toolNames(await rpc(running.url, 'tools/list', {}, legacyWriteToken));
    assert.equal(legacyTools.includes('create_page'), true);
    assert.equal(legacyTools.includes('update_page'), true);
    assert.equal(legacyTools.includes('groups_upsert'), false);
    assert.equal(legacyTools.includes('set_page_visibility'), false);
    assert.equal(legacyTools.includes('update_raw_file'), false);
    assert.equal(legacyTools.includes('maintenance/git_backup'), false);
    assert.equal(legacyTools.includes('maintenance/sync'), false);
    assert.equal(legacyTools.includes('audit/list'), false);

    const dashboardTools = toolNames(await rpc(running.url, 'tools/list', {}, dashboardToken));
    assert.deepEqual(dashboardTools, []);

    const adminTools = toolNames(await rpc(running.url, 'tools/list', {}, adminToken));
    assert.equal(adminTools.includes('maintenance/git_backup'), true);
    assert.equal(adminTools.includes('maintenance/sync'), true);
    assert.equal(adminTools.includes('delete_raw_file'), true);
    assert.equal(adminTools.includes('create_page'), true);
    assert.equal(adminTools.includes('set_page_visibility'), true);
    assert.equal(adminTools.includes('groups_upsert'), true);
    assert.equal(adminTools.includes('audit/list'), true);
    assert.equal(adminTools.includes('audit/export'), true);
    const synced = await rpc(running.url, 'tools/call', { name: 'maintenance/sync', arguments: {} }, adminToken);
    assert.equal(synced.error, undefined, synced.error?.message);
    assert.equal(typeof synced.result.structuredContent.index_totals_after_sync.pages, 'number');
  } finally {
    if (running) await running.close();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('MCP task tools resolve the authenticated member and manage task pages', async () => {
  const fixture = await createFixture('bigbrain-mcp-tasks-');
  const token = 'bbmcp_task-token';
  const tokenStorePath = path.join(fixture.rootDir, 'tokens.json');
  await fs.writeFile(tokenStorePath, `${JSON.stringify({
    tokens: [{
      token_hash: hashToken(token),
      email: 'teammate@example.com',
      name: 'Team Mate',
      provider: 'google',
      created_at: new Date().toISOString(),
      last_used_at: null,
      revoked_at: null,
    }],
    states: [],
    clients: [],
    codes: [],
  }, null, 2)}\n`);

  let running;
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const db = await openDatabase(config);
    await upsertMember(db, {
      email: 'teammate@example.com',
      name: 'Team Mate',
      person_slug: 'people/team-mate',
      role: 'member',
    });
    await upsertMember(db, {
      email: 'inactive@example.com',
      name: 'Inactive',
      person_slug: 'people/inactive',
      status: 'inactive',
    });
    await db.close?.();

    await fs.writeFile(path.join(fixture.brainHome, 'tasks', 'FILING.md'), '# Task Filing\n\nGuidance only.\n', 'utf8');
    await fs.writeFile(path.join(fixture.brainHome, 'tasks', 'README.md'), '# Tasks\n\nCollection overview.\n', 'utf8');

    running = await startMcpServer({
      config,
      host: '127.0.0.1',
      port: 0,
      authConfig: {
        mode: 'oauth_allowlist',
        authToken: null,
        publicUrl: 'https://brain.example.test',
        provider: 'google',
        googleClientId: 'client-id',
        googleClientSecret: 'client-secret',
        allowedEmails: ['teammate@example.com'],
        allowedDomains: [],
        tokenStorePath,
        allowSharedToken: false,
        serviceName: 'Example Brain',
        appName: 'Example Brain',
      },
      syncIntervalMs: 0,
      gitBackupEnabled: false,
    });

    const listed = await rpc(running.url, 'tools/list', {}, token);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'me'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'tasks/list'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'tasks/summary'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'tasks/get'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'tasks/hygiene'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'tasks_list'), false);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'tasks/enrich'), false);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'tasks_enrich'), false);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'members/list'), true);
    const listTool = listed.result.tools.find((tool) => tool.name === 'tasks/list');
    assert.deepEqual(listTool.inputSchema.properties.status.enum, ['open', 'in_progress', 'waiting', 'done', 'archived']);
    assert.deepEqual(listTool.inputSchema.properties.readiness.enum, ['underspecified', 'ready']);
    assert.deepEqual(listTool.inputSchema.properties.execution_mode.enum, ['agent', 'user', 'interactive']);
    const summaryTool = listed.result.tools.find((tool) => tool.name === 'tasks/summary');
    assert.deepEqual(summaryTool.inputSchema.properties.statuses.items.enum, ['open', 'in_progress', 'waiting', 'done', 'archived']);
    assert.equal(summaryTool.inputSchema.properties.limit.maximum, 100);
    const hygieneTool = listed.result.tools.find((tool) => tool.name === 'tasks/hygiene');
    assert.equal(hygieneTool.inputSchema.properties.stale_days.default, 30);
    assert.equal(hygieneTool.inputSchema.properties.limit.maximum, 100);
    const createTool = listed.result.tools.find((tool) => tool.name === 'tasks/create');
    assert.deepEqual(createTool.inputSchema.properties.status.enum, ['open', 'in_progress', 'waiting', 'done', 'archived']);
    assert.deepEqual(createTool.inputSchema.properties.readiness.enum, ['underspecified', 'ready']);
    assert.deepEqual(createTool.inputSchema.properties.execution_mode.enum, ['agent', 'user', 'interactive']);

    const me = await rpc(running.url, 'tools/call', { name: 'me', arguments: {} }, token);
    assert.equal(me.result.structuredContent.actor.email, 'teammate@example.com');
    assert.equal(me.result.structuredContent.member.person_slug, 'people/team-mate');

    const members = await rpc(running.url, 'tools/call', { name: 'members/list', arguments: {} }, token);
    assert.deepEqual(members.result.structuredContent.members.map((member) => member.person_slug), ['people/team-mate']);

    const created = await rpc(running.url, 'tools/call', {
      name: 'tasks/create',
      arguments: {
        title: 'Draft ICAIRE update',
        body: `# Draft ICAIRE update

## Summary

Prepare the weekly ICAIRE progress update.

## What Counts as Completed

The update is drafted, checked against the linked initiative, and ready to send.

## Body Context

Use the linked GFEAI 2026 initiative as the source context.

## Open Questions

None.`,
        assignees: ['me'],
        priority: 'p1',
        readiness: 'ready',
        execution_mode: 'agent',
        source: ['initiatives/gfeai-2026'],
        timeline_entry: 'Task created in MCP task test.',
      },
    }, token);
    assert.equal(created.result.structuredContent.slug, 'tasks/draft-icaire-update');
    assert.equal(created.result.structuredContent.readiness, 'ready');
    assert.equal(created.result.structuredContent.execution_mode, 'agent');
    assert.equal(created.result.structuredContent.assignees[0].person_slug, 'people/team-mate');
    const createdTaskMarkdown = await fs.readFile(path.join(fixture.brainHome, 'tasks', 'draft-icaire-update.md'), 'utf8');
    assert.doesNotMatch(createdTaskMarkdown, /^type:/m);

    const inProgress = await rpc(running.url, 'tools/call', {
      name: 'tasks/update',
      arguments: {
        path: 'tasks/draft-icaire-update',
        status: 'in_progress',
        timeline_entry: 'Marked in progress in MCP task test.',
      },
    }, token);
    assert.equal(inProgress.error, undefined, inProgress.error?.message);
    assert.equal(inProgress.result.structuredContent.status, 'in_progress');

    const blockedRejected = await rpc(running.url, 'tools/call', {
      name: 'tasks/update',
      arguments: {
        path: 'tasks/draft-icaire-update',
        status: 'blocked',
        timeline_entry: 'Attempted legacy status in MCP task test.',
      },
    }, token);
    assert.equal(blockedRejected.result, undefined);
    assert.match(blockedRejected.error.message, /Invalid task status: blocked/);

    const mine = await rpc(running.url, 'tools/call', {
      name: 'tasks/list',
      arguments: { assignee: 'me', status: 'in_progress' },
    }, token);
    assert.equal(Array.isArray(mine.result.structuredContent), false);
    assert.deepEqual(mine.result.structuredContent.tasks.map((task) => task.slug), ['tasks/draft-icaire-update']);

    const readyTasks = await rpc(running.url, 'tools/call', {
      name: 'tasks/list',
      arguments: { readiness: 'ready' },
    }, token);
    assert.deepEqual(readyTasks.result.structuredContent.tasks.map((task) => task.slug), ['tasks/draft-icaire-update']);

    const agentTasks = await rpc(running.url, 'tools/call', {
      name: 'tasks/list',
      arguments: { readiness: 'ready', execution_mode: 'agent' },
    }, token);
    assert.deepEqual(agentTasks.result.structuredContent.tasks.map((task) => task.slug), ['tasks/draft-icaire-update']);

    const interactiveMode = await rpc(running.url, 'tools/call', {
      name: 'tasks/update',
      arguments: {
        path: 'tasks/draft-icaire-update',
        body: `# Draft ICAIRE update

## Summary

Prepare the weekly ICAIRE progress update.

## What Counts as Completed

The update is drafted, checked against the linked initiative, and ready to send.

## Body Context

Use the linked GFEAI 2026 initiative as the source context.

## Open Questions

What final send wording should be used during the guided review session?`,
        readiness: 'ready',
        execution_mode: 'interactive',
        timeline_entry: 'Marked as ready for guided interactive execution in MCP task test.',
      },
    }, token);
    assert.equal(interactiveMode.error, undefined, interactiveMode.error?.message);
    assert.equal(interactiveMode.result.structuredContent.readiness, 'ready');
    assert.equal(interactiveMode.result.structuredContent.execution_mode, 'interactive');

    const interactiveTasks = await rpc(running.url, 'tools/call', {
      name: 'tasks/list',
      arguments: { readiness: 'ready', execution_mode: 'interactive' },
    }, token);
    assert.deepEqual(interactiveTasks.result.structuredContent.tasks.map((task) => task.slug), ['tasks/draft-icaire-update']);

    const userMode = await rpc(running.url, 'tools/call', {
      name: 'tasks/update',
      arguments: {
        path: 'tasks/draft-icaire-update',
        execution_mode: 'user',
        timeline_entry: 'Marked as user-executed in MCP task test.',
      },
    }, token);
    assert.equal(userMode.error, undefined, userMode.error?.message);
    assert.equal(userMode.result.structuredContent.execution_mode, 'user');

    const agentTasksAfterModeChange = await rpc(running.url, 'tools/call', {
      name: 'tasks/list',
      arguments: { readiness: 'ready', execution_mode: 'agent' },
    }, token);
    assert.deepEqual(agentTasksAfterModeChange.result.structuredContent.tasks, []);

    const thinReady = await rpc(running.url, 'tools/call', {
      name: 'tasks/create',
      arguments: {
        title: 'Granola thin follow-up',
        body: 'Follow up on the meeting suggestion.',
        assignees: ['me'],
        readiness: 'ready',
        execution_mode: 'interactive',
        timeline_entry: 'Created thin ready task from meeting ingest; presentation layers decide whether it needs input.',
      },
    }, token);
    assert.equal(thinReady.error, undefined, thinReady.error?.message);
    assert.equal(thinReady.result.structuredContent.readiness, 'ready');
    assert.equal(thinReady.result.structuredContent.execution_mode, 'interactive');

    const allTasks = await rpc(running.url, 'tools/call', {
      name: 'tasks/list',
      arguments: {},
    }, token);
    assert.deepEqual(allTasks.result.structuredContent.tasks.map((task) => task.slug), ['tasks/draft-icaire-update', 'tasks/granola-thin-follow-up']);
    assert.equal(typeof allTasks.result.structuredContent.tasks[0].body, 'string');
    assert.equal(typeof allTasks.result.structuredContent.tasks[0].timeline, 'string');
    assert.equal(typeof allTasks.result.structuredContent.tasks[0].markdown, 'string');
    assert.deepEqual(allTasks.result.structuredContent.tasks[0].source_slugs, ['initiatives/gfeai-2026']);

    const compactFirst = await rpc(running.url, 'tools/call', {
      name: 'tasks/summary',
      arguments: { assignee: 'me', statuses: ['in_progress', 'open'], limit: 1 },
    }, token);
    assert.equal(compactFirst.error, undefined, compactFirst.error?.message);
    assert.equal(compactFirst.result.structuredContent.total, 2);
    assert.equal(compactFirst.result.structuredContent.next_cursor, 1);
    assert.deepEqual(compactFirst.result.structuredContent.tasks.map((task) => task.slug), ['tasks/draft-icaire-update']);
    assert.deepEqual(compactFirst.result.structuredContent.tasks[0].open_questions_state, 'present');
    assert.equal(compactFirst.result.structuredContent.tasks[0].has_substantive_open_questions, true);
    for (const omitted of ['body', 'timeline', 'markdown', 'source_slugs', 'assignees']) {
      assert.equal(omitted in compactFirst.result.structuredContent.tasks[0], false);
    }
    assert.doesNotMatch(JSON.stringify(compactFirst.result), /What final send wording/);

    const compactSecond = await rpc(running.url, 'tools/call', {
      name: 'tasks/summary',
      arguments: { assignee: 'me', statuses: ['in_progress', 'open'], limit: 1, cursor: 1 },
    }, token);
    assert.deepEqual(compactSecond.result.structuredContent.tasks.map((task) => task.slug), ['tasks/granola-thin-follow-up']);
    assert.equal(compactSecond.result.structuredContent.next_cursor, null);
    assert.equal(compactSecond.result.structuredContent.tasks[0].open_questions_state, 'missing');
    assert.equal(compactSecond.result.structuredContent.tasks[0].has_substantive_open_questions, null);

    const selected = await rpc(running.url, 'tools/call', {
      name: 'tasks/get',
      arguments: { path: 'tasks/draft-icaire-update' },
    }, token);
    assert.equal(selected.error, undefined, selected.error?.message);
    assert.match(selected.result.structuredContent.body, /What final send wording/);
    assert.match(selected.result.structuredContent.timeline, /Marked as user-executed/);
    assert.deepEqual(selected.result.structuredContent.source_slugs, ['initiatives/gfeai-2026']);
    assert.equal(typeof selected.result.structuredContent.markdown, 'string');

    const invalidCompactLimit = await rpc(running.url, 'tools/call', {
      name: 'tasks/summary',
      arguments: { limit: 101 },
    }, token);
    assert.match(invalidCompactLimit.error.message, /limit must be an integer between 1 and 100/);
    const invalidCompactCursor = await rpc(running.url, 'tools/call', {
      name: 'tasks/summary',
      arguments: { cursor: -1 },
    }, token);
    assert.match(invalidCompactCursor.error.message, /cursor must be a non-negative integer/);
    const nonTaskGet = await rpc(running.url, 'tools/call', {
      name: 'tasks/get',
      arguments: { path: 'people/team-mate' },
    }, token);
    assert.match(nonTaskGet.error.message, /Task path must live under tasks/);

    const rejectedCompletion = await rpc(running.url, 'tools/call', {
      name: 'tasks/update',
      arguments: {
        path: 'tasks/draft-icaire-update',
        status: 'done',
        timeline_entry: 'Marked complete in MCP task test.',
      },
    }, token);
    assert.equal(rejectedCompletion.result, undefined);
    assert.match(rejectedCompletion.error.message, /Completing a task requires a completion handoff/);

    const updated = await rpc(running.url, 'tools/call', {
      name: 'tasks/update',
      arguments: {
        path: 'tasks/draft-icaire-update',
        status: 'done',
        timeline_entry: 'Marked complete in MCP task test. Next task: tasks/example-follow-up.',
      },
    }, token);
    assert.equal(updated.result.structuredContent.status, 'done');
    assert.match(updated.result.structuredContent.timeline, /Marked complete in MCP task test\. Next task: tasks\/example-follow-up\. \(via teammate@example\.com\)/);

    const terminal = await rpc(running.url, 'tools/call', {
      name: 'tasks/create',
      arguments: {
        title: 'Terminal cleanup',
        body: 'Cleanup is complete and no further work remains.',
        assignees: ['me'],
        status: 'done',
        timeline_entry: 'Created completed terminal task. No successor task needed: terminal cleanup complete.',
      },
    }, token);
    assert.equal(terminal.error, undefined, terminal.error?.message);
    assert.equal(terminal.result.structuredContent.status, 'done');

    const rejected = await rpc(running.url, 'tools/call', {
      name: 'tasks/create',
      arguments: {
        title: 'Bad assignment',
        body: 'Should not be created.',
        assignees: ['people/inactive'],
      },
    }, token);
    assert.equal(rejected.result, undefined);
    assert.match(rejected.error.message, /not an active member/);

    const thin = await rpc(running.url, 'tools/call', {
      name: 'tasks/create',
      arguments: {
        title: 'Clarify follow-up',
        body: 'Ask the right person for missing context before fanout.',
        assignees: ['me'],
        priority: 'p2',
        timeline_entry: 'Created underspecified task in MCP readiness test.',
      },
    }, token);
    assert.equal(thin.error, undefined, thin.error?.message);
    assert.equal(thin.result.structuredContent.readiness, 'underspecified');

    const underspecifiedTasks = await rpc(running.url, 'tools/call', {
      name: 'tasks/list',
      arguments: { status: 'open', readiness: 'underspecified' },
    }, token);
    assert.deepEqual(underspecifiedTasks.result.structuredContent.tasks.map((task) => task.slug), ['tasks/clarify-follow-up']);

    const readinessUpdated = await rpc(running.url, 'tools/call', {
      name: 'tasks/update',
      arguments: {
        path: 'tasks/clarify-follow-up',
        readiness: 'ready',
        source: ['initiatives/gfeai-2026'],
        body: `# Clarify follow-up

## Summary

Ask the named stakeholder for the missing context.

## What Counts as Completed

The follow-up is sent and the response is recorded in the brain.

## Body Context

Use the linked GFEAI 2026 initiative as the source context.

## Open Questions

None.

## Anti-Patterns

- Do not mark this complete if the message is only drafted.`,
        timeline_entry: 'Task readiness clarified in MCP task test.',
      },
    }, token);
    assert.equal(readinessUpdated.error, undefined, readinessUpdated.error?.message);
    assert.equal(readinessUpdated.result.structuredContent.readiness, 'ready');

    const allReadyTasks = await rpc(running.url, 'tools/call', {
      name: 'tasks/list',
      arguments: { readiness: 'ready' },
    }, token);
    assert.equal(allReadyTasks.result.structuredContent.tasks.some((task) => task.slug === 'tasks/clarify-follow-up'), true);
    const explicitNoneSummary = await rpc(running.url, 'tools/call', {
      name: 'tasks/summary',
      arguments: { statuses: ['open'], readiness: 'ready' },
    }, token);
    const clarifiedSummary = explicitNoneSummary.result.structuredContent.tasks.find((task) => task.slug === 'tasks/clarify-follow-up');
    assert.equal(clarifiedSummary.open_questions_state, 'none');
    assert.equal(clarifiedSummary.open_question_count, 0);
    assert.equal(clarifiedSummary.has_substantive_open_questions, false);
  } finally {
    if (running) await running.close();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('MCP task hygiene audit reports advisory backlog signals without mutating task files', async () => {
  const fixture = await createFixture('bigbrain-mcp-task-hygiene-');
  let running;
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const db = await openDatabase(config);
    await upsertMember(db, {
      email: 'local@example.test',
      name: 'Local Owner',
      person_slug: 'people/local-owner',
      role: 'owner',
    });
    await db.close?.();
    running = await startMcpServer({
      config,
      host: '127.0.0.1',
      port: 0,
      authConfig: { mode: 'none', tokenStorePath: '', localPersonSlug: 'people/local-owner' },
      syncIntervalMs: 0,
      gitBackupEnabled: false,
    });

    const fixtures = [
      { title: 'Stale active work', status: 'in_progress', assignees: ['me'], readiness: 'ready' },
      { title: 'Old waiting work', status: 'waiting', assignees: ['me'], readiness: 'ready' },
      { title: 'Old unclear backlog', status: 'open', assignees: [], readiness: 'underspecified' },
      { title: 'Fresh assigned work', status: 'open', assignees: ['me'], readiness: 'ready' },
    ];
    for (const task of fixtures) {
      const created = await rpc(running.url, 'tools/call', {
        name: 'tasks/create',
        arguments: {
          ...task,
          body: `${task.title} body.`,
          timeline_entry: `Created ${task.title.toLowerCase()} test fixture.`,
        },
      });
      assert.equal(created.error, undefined, created.error?.message);
    }
    const oldTime = new Date(Date.now() - 60 * 86_400_000);
    for (const slug of ['stale-active-work', 'old-waiting-work', 'old-unclear-backlog']) {
      await fs.utimes(path.join(fixture.brainHome, 'tasks', `${slug}.md`), oldTime, oldTime);
    }

    const taskPaths = (await fs.readdir(path.join(fixture.brainHome, 'tasks')))
      .filter((name) => name.endsWith('.md'))
      .map((name) => path.join(fixture.brainHome, 'tasks', name));
    const before = new Map(await Promise.all(taskPaths.map(async (file) => {
      const stat = await fs.stat(file);
      return [file, { content: await fs.readFile(file, 'utf8'), mtimeMs: stat.mtimeMs }];
    })));

    const audit = await rpc(running.url, 'tools/call', {
      name: 'tasks/hygiene',
      arguments: { stale_days: 30, limit: 2 },
    });
    assert.equal(audit.error, undefined, audit.error?.message);
    assert.equal(audit.result.structuredContent.mutating, false);
    assert.equal(audit.result.structuredContent.total, 3);
    assert.equal(audit.result.structuredContent.findings.length, 2);
    assert.equal(audit.result.structuredContent.next_cursor, 2);
    assert.equal(JSON.stringify(audit.result.structuredContent).includes('Fresh assigned work'), false);
    assert.doesNotMatch(JSON.stringify(audit.result.structuredContent), /stale active work test fixture/i);
    for (const omitted of ['body', 'timeline', 'markdown', 'source_slugs', 'assignees']) {
      assert.equal(omitted in audit.result.structuredContent.findings[0], false);
    }
    const firstPageSignals = Object.fromEntries(
      audit.result.structuredContent.findings.map((finding) => [finding.slug, finding.signals]),
    );
    assert.deepEqual(firstPageSignals['tasks/stale-active-work'], ['stale_in_progress']);
    assert.deepEqual(firstPageSignals['tasks/old-unclear-backlog'], ['unassigned', 'backlogged_open', 'underspecified_backlog']);

    const auditSecond = await rpc(running.url, 'tools/call', {
      name: 'tasks/hygiene',
      arguments: { stale_days: 30, limit: 2, cursor: 2 },
    });
    assert.deepEqual(auditSecond.result.structuredContent.findings.map((finding) => finding.slug), ['tasks/old-waiting-work']);
    assert.equal(auditSecond.result.structuredContent.next_cursor, null);

    const waitingOnly = await rpc(running.url, 'tools/call', {
      name: 'tasks/hygiene',
      arguments: { statuses: ['waiting'], stale_days: 30 },
    });
    assert.deepEqual(waitingOnly.result.structuredContent.findings.map((finding) => finding.slug), ['tasks/old-waiting-work']);
    const invalidStaleDays = await rpc(running.url, 'tools/call', {
      name: 'tasks/hygiene',
      arguments: { stale_days: 0 },
    });
    assert.match(invalidStaleDays.error.message, /stale_days must be an integer between 1 and 3650/);

    for (const [file, expected] of before) {
      const stat = await fs.stat(file);
      assert.equal(await fs.readFile(file, 'utf8'), expected.content);
      assert.equal(stat.mtimeMs, expected.mtimeMs);
    }
  } finally {
    await running?.close();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('MCP task tools resolve me to a deterministic local member when auth is disabled', async () => {
  const fixture = await createFixture('bigbrain-mcp-local-me-');
  let running;
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const db = await openDatabase(config);
    await upsertMember(db, {
      email: 'local@example.test',
      name: 'Local Owner',
      person_slug: 'people/local-owner',
      role: 'owner',
    });
    await db.close?.();

    running = await startMcpServer({
      config,
      host: '127.0.0.1',
      port: 0,
      authConfig: { mode: 'none', tokenStorePath: '', localPersonSlug: '' },
      syncIntervalMs: 0,
      gitBackupEnabled: false,
    });

    const me = await rpc(running.url, 'tools/call', { name: 'me', arguments: {} });
    assert.equal(me.error, undefined, me.error?.message);
    assert.equal(me.result.structuredContent.actor, null);
    assert.equal(me.result.structuredContent.authenticated, false);
    assert.equal(me.result.structuredContent.person_slug, 'people/local-owner');

    const created = await rpc(running.url, 'tools/call', {
      name: 'tasks/create',
      arguments: {
        title: 'Handle local assignment',
        body: 'This local task should resolve assignee me without OAuth.',
        assignees: ['me'],
      },
    });
    assert.equal(created.error, undefined, created.error?.message);
    assert.deepEqual(created.result.structuredContent.assignee_slugs, ['people/local-owner']);

    const mine = await rpc(running.url, 'tools/call', {
      name: 'tasks/list',
      arguments: { assignee: 'me', status: 'open' },
    });
    assert.equal(mine.error, undefined, mine.error?.message);
    assert.deepEqual(mine.result.structuredContent.tasks.map((task) => task.slug), ['tasks/handle-local-assignment']);

    const explicit = await rpc(running.url, 'tools/call', {
      name: 'tasks/list',
      arguments: { assignee: 'people/local-owner', status: 'open' },
    });
    assert.equal(explicit.error, undefined, explicit.error?.message);
    assert.deepEqual(explicit.result.structuredContent.tasks.map((task) => task.slug), ['tasks/handle-local-assignment']);
  } finally {
    if (running) await running.close();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('MCP token auth resolves me only through the configured active member', async () => {
  const fixture = await createFixture('bigbrain-mcp-token-me-');
  let running;
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const db = await openDatabase(config);
    await upsertMember(db, {
      email: 'token-owner@example.test',
      name: 'Token Owner',
      person_slug: 'people/token-owner',
      role: 'owner',
    });
    await upsertMember(db, {
      email: 'other-owner@example.test',
      name: 'Other Owner',
      person_slug: 'people/other-owner',
      role: 'owner',
    });
    await db.close?.();

    running = await startMcpServer({
      config,
      host: '127.0.0.1',
      port: 0,
      authConfig: {
        mode: 'token',
        authToken: 'secret',
        tokenStorePath: '',
        localPersonSlug: 'people/token-owner',
      },
      syncIntervalMs: 0,
      gitBackupEnabled: false,
    });

    const unauthorized = await fetch(running.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    assert.equal(unauthorized.status, 401);

    const me = await rpc(running.url, 'tools/call', { name: 'me', arguments: {} }, 'secret');
    assert.equal(me.error, undefined, me.error?.message);
    assert.equal(me.result.structuredContent.actor, null);
    assert.equal(me.result.structuredContent.authenticated, false);
    assert.equal(me.result.structuredContent.person_slug, 'people/token-owner');

    const created = await rpc(running.url, 'tools/call', {
      name: 'tasks/create',
      arguments: {
        title: 'Handle token assignment',
        body: 'This hosted token-mode task should resolve assignee me deterministically.',
        assignees: ['me'],
      },
    }, 'secret');
    assert.equal(created.error, undefined, created.error?.message);
    assert.deepEqual(created.result.structuredContent.assignee_slugs, ['people/token-owner']);

    const mine = await rpc(running.url, 'tools/call', {
      name: 'tasks/list',
      arguments: { assignee: 'me', status: 'open' },
    }, 'secret');
    assert.equal(mine.error, undefined, mine.error?.message);
    assert.deepEqual(mine.result.structuredContent.tasks.map((task) => task.slug), ['tasks/handle-token-assignment']);
  } finally {
    if (running) await running.close();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('MCP OAuth identity takes precedence over configured member binding', async () => {
  const fixture = await createFixture('bigbrain-mcp-oauth-me-precedence-');
  const token = 'bbmcp_test-token';
  const tokenStorePath = path.join(fixture.rootDir, 'tokens.json');
  await fs.writeFile(tokenStorePath, `${JSON.stringify({
    tokens: [{
      token_hash: hashToken(token),
      email: 'teammate@example.com',
      name: 'Team Mate',
      provider: 'google',
      created_at: new Date().toISOString(),
      last_used_at: null,
      revoked_at: null,
      scope: 'brain:read brain:create',
    }],
    states: [],
    clients: [],
    codes: [],
  }, null, 2)}\n`);

  let running;
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const db = await openDatabase(config);
    await upsertMember(db, {
      email: 'teammate@example.com',
      name: 'Team Mate',
      person_slug: 'people/team-mate',
      role: 'member',
    });
    await upsertMember(db, {
      email: 'configured@example.com',
      name: 'Configured Owner',
      person_slug: 'people/configured-owner',
      role: 'owner',
    });
    await db.close?.();

    running = await startMcpServer({
      config,
      host: '127.0.0.1',
      port: 0,
      authConfig: {
        mode: 'oauth_allowlist',
        authToken: null,
        publicUrl: 'https://brain.example.test',
        provider: 'google',
        googleClientId: 'client-id',
        googleClientSecret: 'client-secret',
        allowedEmails: ['teammate@example.com'],
        allowedDomains: [],
        tokenStorePath,
        allowSharedToken: false,
        localPersonSlug: 'people/configured-owner',
        serviceName: 'Example Brain',
        appName: 'Example Brain',
      },
      syncIntervalMs: 0,
      gitBackupEnabled: false,
    });

    const me = await rpc(running.url, 'tools/call', { name: 'me', arguments: {} }, token);
    assert.equal(me.error, undefined, me.error?.message);
    assert.equal(me.result.structuredContent.actor.email, 'teammate@example.com');
    assert.equal(me.result.structuredContent.person_slug, 'people/team-mate');

    const created = await rpc(running.url, 'tools/call', {
      name: 'tasks/create',
      arguments: {
        title: 'Handle OAuth assignment',
        body: 'This OAuth task should resolve assignee me to the authenticated user.',
        assignees: ['me'],
      },
    }, token);
    assert.equal(created.error, undefined, created.error?.message);
    assert.deepEqual(created.result.structuredContent.assignee_slugs, ['people/team-mate']);
  } finally {
    if (running) await running.close();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('MCP task tools reject ambiguous local me resolution when auth is disabled', async () => {
  const fixture = await createFixture('bigbrain-mcp-local-me-ambiguous-');
  let running;
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    const db = await openDatabase(config);
    await upsertMember(db, {
      email: 'first@example.test',
      name: 'First Owner',
      person_slug: 'people/first-owner',
      role: 'owner',
    });
    await upsertMember(db, {
      email: 'second@example.test',
      name: 'Second Owner',
      person_slug: 'people/second-owner',
      role: 'owner',
    });
    await db.close?.();

    running = await startMcpServer({
      config,
      host: '127.0.0.1',
      port: 0,
      authConfig: { mode: 'none', tokenStorePath: '', localPersonSlug: '' },
      syncIntervalMs: 0,
      gitBackupEnabled: false,
    });

    const mine = await rpc(running.url, 'tools/call', {
      name: 'tasks/list',
      arguments: { assignee: 'me', status: 'open' },
    });
    assert.equal(mine.result, undefined);
    assert.match(mine.error.message, /multiple active owners/);
    assert.match(mine.error.message, /BIGBRAIN_MCP_LOCAL_PERSON_SLUG/);
  } finally {
    if (running) await running.close();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('MCP OAuth allowlist mode exposes Codex-native OAuth endpoints', async () => {
  const fixture = await createFixture('bigbrain-mcp-oauth-native-');
  const tokenStorePath = path.join(fixture.rootDir, 'tokens.json');
  let running;
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    running = await startMcpServer({
      config,
      host: '127.0.0.1',
      port: 0,
      authConfig: {
        mode: 'oauth_allowlist',
        authToken: null,
        publicUrl: 'https://brain.example.test',
        provider: 'google',
        googleClientId: 'client-id',
        googleClientSecret: 'client-secret',
        allowedEmails: ['teammate@example.com'],
        allowedDomains: [],
        tokenStorePath,
        allowSharedToken: false,
        serviceName: 'Example Brain',
      },
      syncIntervalMs: 0,
      gitBackupEnabled: false,
    });

    const protectedMetadata = await fetch(running.url.replace('/mcp', '/.well-known/oauth-protected-resource/mcp'));
    assert.equal(protectedMetadata.status, 200);
    assert.deepEqual((await protectedMetadata.json()).authorization_servers, ['https://brain.example.test']);

    const authMetadata = await fetch(running.url.replace('/mcp', '/.well-known/oauth-authorization-server'));
    assert.equal(authMetadata.status, 200);
    const authMetadataJson = await authMetadata.json();
    assert.equal(authMetadataJson.registration_endpoint, 'https://brain.example.test/oauth/register');
    assert.deepEqual(authMetadataJson.code_challenge_methods_supported, ['S256']);

    const registration = await fetch(running.url.replace('/mcp', '/oauth/register'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: ['http://127.0.0.1:1455/callback'],
        token_endpoint_auth_method: 'none',
      }),
    });
    assert.equal(registration.status, 200);
    const client = await registration.json();
    assert.match(client.client_id, /^bbmcp_client_/);
    assert.equal(client.scope, 'brain:read brain:create');

    const elevatedRegistration = await fetch(running.url.replace('/mcp', '/oauth/register'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: ['http://127.0.0.1:1456/callback'],
        scope: 'brain:read brain:admin',
        token_endpoint_auth_method: 'none',
      }),
    });
    assert.equal(elevatedRegistration.status, 500);
    assert.match(JSON.stringify(await elevatedRegistration.json()), /brain:admin/);

    const codeVerifier = 'a'.repeat(64);
    const authorizeUrl = new URL(running.url.replace('/mcp', '/oauth/authorize'));
    authorizeUrl.searchParams.set('client_id', client.client_id);
    authorizeUrl.searchParams.set('redirect_uri', 'http://127.0.0.1:1455/callback');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('code_challenge', computePkceChallenge(codeVerifier));
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('state', 'codex-state');
    const authorize = await fetch(authorizeUrl, { redirect: 'manual' });
    assert.equal(authorize.status, 302);
    assert.match(authorize.headers.get('location'), /^https:\/\/accounts\.google\.com\//);

    const store = JSON.parse(await fs.readFile(tokenStorePath, 'utf8'));
    const pendingState = store.states.find((entry) => entry.flow === 'agent_oauth');
    assert.equal(pendingState.client_id, client.client_id);
    assert.equal(pendingState.scope, 'brain:read brain:create');

    store.states = [];
    const authCode = 'bbmcp_code_test';
    store.codes = [{
      code_hash: hashToken(authCode),
      client_id: client.client_id,
      redirect_uri: 'http://127.0.0.1:1455/callback',
      code_challenge: computePkceChallenge(codeVerifier),
      scope: 'brain:read brain:create',
      email: 'teammate@example.com',
      name: 'Team Mate',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    }];
    await fs.writeFile(tokenStorePath, `${JSON.stringify(store, null, 2)}\n`);

    const token = await fetch(running.url.replace('/mcp', '/oauth/token'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: client.client_id,
        redirect_uri: 'http://127.0.0.1:1455/callback',
        code: authCode,
        code_verifier: codeVerifier,
      }),
    });
    assert.equal(token.status, 200);
    const tokenJson = await token.json();
    assert.equal(tokenJson.token_type, 'Bearer');
    assert.match(tokenJson.access_token, /^bbmcp_/);

    const listed = await rpc(running.url, 'tools/list', {}, tokenJson.access_token);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'list'), true);
  } finally {
    if (running) await running.close();
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

async function rpc(url, method, params, token) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
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

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function computePkceChallenge(codeVerifier) {
  return crypto.createHash('sha256').update(codeVerifier).digest('base64url');
}

function scopedToken(token, email, scope) {
  return {
    token_hash: hashToken(token),
    email,
    name: email,
    provider: 'google',
    created_at: new Date().toISOString(),
    last_used_at: null,
    revoked_at: null,
    scope,
  };
}

function toolNames(listed) {
  return listed.result.tools.map((tool) => tool.name);
}
