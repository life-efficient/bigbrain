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
    assert.equal(listed.result.tools.some((tool) => tool.name === 'create_raw_file_with_page'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'create_raw_file'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'read_raw_file'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'update_raw_file'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'delete_raw_file'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'get_page_visibility'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'set_page_visibility'), true);
    const visibilityTool = listed.result.tools.find((tool) => tool.name === 'set_page_visibility');
    assert.equal(visibilityTool.inputSchema.properties.public_raw_files.type, 'array');

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
    assert.equal(published.result.structuredContent.public_url, '/public/people/mcp-test');
    assert.deepEqual(published.result.structuredContent.public_raw_files, ['people/.raw/public.pdf']);

    const visibility = await rpc(running.url, 'tools/call', {
      name: 'get_page_visibility',
      arguments: { path: 'people/mcp-test' },
    }, 'secret');
    assert.equal(visibility.result.structuredContent.visibility, 'public');
    assert.deepEqual(visibility.result.structuredContent.public_raw_files, ['people/.raw/public.pdf']);

    const db = await openDatabase(config);
    const record = await getPageRecord(db, 'people/mcp-test');
    assert.equal(record.title, 'MCP Test');
    assert.match(record.compiled_truth, /Created through the MCP server/);
    const auditRows = await listMcpAuditLog(db);
    const createdAudit = auditRows.find((row) => row.action === 'mcp.tool.create_page');
    assert.equal(createdAudit.actor_email, null);
    const details = JSON.parse(createdAudit.details_json);
    assert.equal(details.status, 'success');
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

    const listed = await rpc(running.url, 'tools/call', {
      name: 'list_raw_files',
      arguments: { path: 'sources/.raw' },
    }, 'secret');
    assert.deepEqual(listed.result.structuredContent.map((entry) => entry.path), ['sources/.raw/mcp-crud.txt']);

    const deleted = await rpc(running.url, 'tools/call', {
      name: 'delete_raw_file',
      arguments: { path: 'sources/.raw/mcp-crud.txt' },
    }, 'secret');
    assert.deepEqual(deleted.result.structuredContent, { path: 'sources/.raw/mcp-crud.txt', deleted: true });
    await assert.rejects(() => fs.stat(path.join(fixture.brainHome, 'sources', '.raw', 'mcp-crud.txt')), /ENOENT/);
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
        page_path: 'sources/mcp-upload',
        title: 'MCP Upload',
        body: 'Uploaded through the MCP raw file tool.',
        timeline_entry: 'Uploaded source PDF through MCP.',
        frontmatter: { tags: ['mcp', 'source'] },
      },
    }, 'secret');

    assert.equal(created.error, undefined, created.error?.message);
    assert.equal(created.result.structuredContent.raw_file.path, 'sources/.raw/mcp-upload.pdf');
    assert.equal(created.result.structuredContent.raw_file.size, pdfBytes.length);
    assert.equal(created.result.structuredContent.page.slug, 'sources/mcp-upload');
    assert.equal(created.result.structuredContent.page.frontmatter.raw_file, 'sources/.raw/mcp-upload.pdf');
    assert.match(created.result.structuredContent.page.markdown, /- \[mcp-upload\.pdf\]\(\.raw\/mcp-upload\.pdf\)/);

    const storedRaw = await fs.readFile(path.join(fixture.brainHome, 'sources', '.raw', 'mcp-upload.pdf'));
    assert.deepEqual(storedRaw, pdfBytes);

    const db = await openDatabase(config);
    const record = await getPageRecord(db, 'sources/mcp-upload');
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
    assert.deepEqual(alpha.result.structuredContent.map((entry) => entry.path), [
      'people/person-1.md',
      'people/person-2.md',
      'people/person-10.md',
    ]);
    assert.match(alpha.result.structuredContent[0].created_at, /^\d{4}-\d{2}-\d{2}T/);

    const recent = await rpc(running.url, 'tools/call', {
      name: 'list',
      arguments: { path: 'people', recursive: false, order_by: 'updated_at', limit: 2 },
    }, 'secret');
    assert.deepEqual(recent.result.structuredContent.map((entry) => entry.path), [
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
        serviceName: 'Example Brain Cortex',
        appName: 'Example Brain',
      },
      syncIntervalMs: 0,
      gitBackupEnabled: false,
    });

    const connect = await fetch(running.url.replace('/mcp', '/connect'));
    assert.equal(connect.status, 200);
    const connectHtml = await connect.text();
    assert.match(connectHtml, /<h1>Example Brain<\/h1>/);
    assert.match(connectHtml, /Give the instructions below to your agent to allow them to query and update the brain/);
    assert.match(connectHtml, /First, connect to the following MCP server and test it/);
    assert.match(connectHtml, /After that, update your system prompt to include/);
    assert.match(connectHtml, /Anything related to Example Brain should be stored, and searched for from the remote Example Brain brain via MCP/);
    assert.match(connectHtml, /\[mcp_servers\.example-brain-cortex\]/);
    assert.match(connectHtml, /aria-label="Copy config"/);
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
  const adminToken = 'bbmcp_admin-token';
  const tokenStorePath = path.join(fixture.rootDir, 'tokens.json');
  await fs.writeFile(tokenStorePath, `${JSON.stringify({
    tokens: [
      scopedToken(readToken, 'reader@example.com', 'brain:read'),
      scopedToken(createToken, 'creator@example.com', 'brain:read brain:create'),
      scopedToken(publishToken, 'publisher@example.com', 'brain:read brain:publish'),
      scopedToken(rawDeleteToken, 'raw@example.com', 'brain:read brain:raw:destructive'),
      scopedToken(gitToken, 'git@example.com', 'brain:read brain:git-backup'),
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
        allowedEmails: ['reader@example.com', 'creator@example.com', 'publisher@example.com', 'raw@example.com', 'git@example.com', 'admin@example.com'],
        allowedDomains: [],
        tokenStorePath,
        allowSharedToken: false,
        serviceName: 'Example Brain Cortex',
        appName: 'Example Brain',
      },
      syncIntervalMs: 0,
      gitBackupEnabled: false,
    });

    const readTools = toolNames(await rpc(running.url, 'tools/list', {}, readToken));
    assert.equal(readTools.includes('read'), true);
    assert.equal(readTools.includes('get_page_visibility'), true);
    assert.equal(readTools.includes('set_page_visibility'), false);
    assert.equal(readTools.includes('create_page'), false);
    assert.equal(readTools.includes('update_raw_file'), false);
    assert.equal(readTools.includes('maintenance/sync'), false);
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
    const createRawDelete = await rpc(running.url, 'tools/call', {
      name: 'delete_raw_file',
      arguments: { path: 'sources/.raw/missing.txt' },
    }, createToken);
    assert.equal(createRawDelete.error.code, -32003);
    assert.match(createRawDelete.error.message, /requires brain:raw:destructive scope/);

    const publishTools = toolNames(await rpc(running.url, 'tools/list', {}, publishToken));
    assert.equal(publishTools.includes('set_page_visibility'), true);
    assert.equal(publishTools.includes('create_page'), false);
    const published = await rpc(running.url, 'tools/call', {
      name: 'set_page_visibility',
      arguments: { path: 'people/create-allowed', visibility: 'public' },
    }, publishToken);
    assert.equal(published.error, undefined, published.error?.message);
    assert.equal(published.result.structuredContent.visibility, 'public');

    const rawTools = toolNames(await rpc(running.url, 'tools/list', {}, rawDeleteToken));
    assert.equal(rawTools.includes('update_raw_file'), true);
    assert.equal(rawTools.includes('delete_raw_file'), true);
    assert.equal(rawTools.includes('create_page'), false);

    const gitTools = toolNames(await rpc(running.url, 'tools/list', {}, gitToken));
    assert.equal(gitTools.includes('maintenance/git_backup'), true);
    assert.equal(gitTools.includes('maintenance/sync'), false);
    assert.equal(gitTools.includes('create_page'), false);

    const adminTools = toolNames(await rpc(running.url, 'tools/list', {}, adminToken));
    assert.equal(adminTools.includes('maintenance/git_backup'), true);
    assert.equal(adminTools.includes('maintenance/sync'), true);
    assert.equal(adminTools.includes('delete_raw_file'), true);
    assert.equal(adminTools.includes('create_page'), true);
    assert.equal(adminTools.includes('set_page_visibility'), true);
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
        serviceName: 'Example Brain Cortex',
        appName: 'Example Brain',
      },
      syncIntervalMs: 0,
      gitBackupEnabled: false,
    });

    const listed = await rpc(running.url, 'tools/list', {}, token);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'me'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'tasks/list'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'tasks_list'), false);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'tasks/enrich'), false);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'tasks_enrich'), false);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'members/list'), true);
    const listTool = listed.result.tools.find((tool) => tool.name === 'tasks/list');
    assert.deepEqual(listTool.inputSchema.properties.status.enum, ['open', 'in_progress', 'waiting', 'done', 'archived']);
    assert.deepEqual(listTool.inputSchema.properties.readiness.enum, ['underspecified', 'ready']);
    assert.deepEqual(listTool.inputSchema.properties.execution_mode.enum, ['agent', 'user', 'interactive']);
    const createTool = listed.result.tools.find((tool) => tool.name === 'tasks/create');
    assert.deepEqual(createTool.inputSchema.properties.status.enum, ['open', 'in_progress', 'waiting', 'done', 'archived']);
    assert.deepEqual(createTool.inputSchema.properties.readiness.enum, ['underspecified', 'ready']);
    assert.deepEqual(createTool.inputSchema.properties.execution_mode.enum, ['agent', 'user', 'interactive']);

    const me = await rpc(running.url, 'tools/call', { name: 'me', arguments: {} }, token);
    assert.equal(me.result.structuredContent.actor.email, 'teammate@example.com');
    assert.equal(me.result.structuredContent.member.person_slug, 'people/team-mate');

    const members = await rpc(running.url, 'tools/call', { name: 'members/list', arguments: {} }, token);
    assert.deepEqual(members.result.structuredContent.map((member) => member.person_slug), ['people/team-mate']);

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
    assert.deepEqual(mine.result.structuredContent.map((task) => task.slug), ['tasks/draft-icaire-update']);

    const readyTasks = await rpc(running.url, 'tools/call', {
      name: 'tasks/list',
      arguments: { readiness: 'ready' },
    }, token);
    assert.deepEqual(readyTasks.result.structuredContent.map((task) => task.slug), ['tasks/draft-icaire-update']);

    const agentTasks = await rpc(running.url, 'tools/call', {
      name: 'tasks/list',
      arguments: { readiness: 'ready', execution_mode: 'agent' },
    }, token);
    assert.deepEqual(agentTasks.result.structuredContent.map((task) => task.slug), ['tasks/draft-icaire-update']);

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
    assert.deepEqual(interactiveTasks.result.structuredContent.map((task) => task.slug), ['tasks/draft-icaire-update']);

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
    assert.deepEqual(agentTasksAfterModeChange.result.structuredContent, []);

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
    assert.deepEqual(allTasks.result.structuredContent.map((task) => task.slug), ['tasks/draft-icaire-update', 'tasks/granola-thin-follow-up']);

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
    assert.deepEqual(underspecifiedTasks.result.structuredContent.map((task) => task.slug), ['tasks/clarify-follow-up']);

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
    assert.equal(allReadyTasks.result.structuredContent.some((task) => task.slug === 'tasks/clarify-follow-up'), true);
  } finally {
    if (running) await running.close();
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
    assert.deepEqual(mine.result.structuredContent.map((task) => task.slug), ['tasks/handle-local-assignment']);

    const explicit = await rpc(running.url, 'tools/call', {
      name: 'tasks/list',
      arguments: { assignee: 'people/local-owner', status: 'open' },
    });
    assert.equal(explicit.error, undefined, explicit.error?.message);
    assert.deepEqual(explicit.result.structuredContent.map((task) => task.slug), ['tasks/handle-local-assignment']);
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
    assert.deepEqual(mine.result.structuredContent.map((task) => task.slug), ['tasks/handle-token-assignment']);
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
        serviceName: 'Example Brain Cortex',
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
        serviceName: 'Example Brain Cortex',
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

    store.states = [];
    const authCode = 'bbmcp_code_test';
    store.codes = [{
      code_hash: hashToken(authCode),
      client_id: client.client_id,
      redirect_uri: 'http://127.0.0.1:1455/callback',
      code_challenge: computePkceChallenge(codeVerifier),
      scope: 'brain:read brain:write',
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
