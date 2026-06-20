import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { openDatabase, getPageRecord } from '../../src/bigbrain/db.js';
import { upsertMember } from '../../src/bigbrain/members.js';
import { startMcpServer } from '../../src/bigbrain/mcp-server.js';

test('MCP server lists tools and writes pages through tools/call', async () => {
  const fixture = await createFixture('bigbrain-mcp-server-');
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

    const listed = await rpc(running.url, 'tools/list', {}, 'secret');
    assert.equal(listed.result.tools.some((tool) => tool.name === 'create_page'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'filing_rules'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'create_raw_file_with_page'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'create_raw_file'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'read_raw_file'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'update_raw_file'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'delete_raw_file'), true);

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
        body: 'Created through the MCP server.',
        timeline_entry: 'Created through MCP endpoint test.',
      },
    }, 'secret');

    assert.equal(created.error, undefined, created.error?.message);
    assert.equal(created.result.structuredContent.slug, 'people/mcp-test');
    assert.match(created.result.structuredContent.markdown, /Created through MCP endpoint test/);

    const db = await openDatabase(config);
    const record = await getPageRecord(db, 'people/mcp-test');
    assert.equal(record.title, 'MCP Test');
    assert.match(record.compiled_truth, /Created through the MCP server/);
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

- YAML frontmatter with type and title.
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
      'YAML frontmatter with type and title.',
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
    assert.equal(listed.result.tools.some((tool) => tool.name === 'tasks_list'), true);
    assert.equal(listed.result.tools.some((tool) => tool.name === 'members/list'), true);

    const me = await rpc(running.url, 'tools/call', { name: 'me', arguments: {} }, token);
    assert.equal(me.result.structuredContent.actor.email, 'teammate@example.com');
    assert.equal(me.result.structuredContent.member.person_slug, 'people/team-mate');

    const members = await rpc(running.url, 'tools/call', { name: 'members/list', arguments: {} }, token);
    assert.deepEqual(members.result.structuredContent.map((member) => member.person_slug), ['people/team-mate']);

    const created = await rpc(running.url, 'tools/call', {
      name: 'tasks/create',
      arguments: {
        title: 'Draft ICAIRE update',
        body: 'Prepare the weekly ICAIRE progress update.',
        assignees: ['me'],
        priority: 'p1',
        source: ['initiatives/gfeai-2026'],
        timeline_entry: 'Task created in MCP task test.',
      },
    }, token);
    assert.equal(created.result.structuredContent.slug, 'tasks/draft-icaire-update');
    assert.equal(created.result.structuredContent.assignees[0].person_slug, 'people/team-mate');

    const mine = await rpc(running.url, 'tools/call', {
      name: 'tasks/list',
      arguments: { assignee: 'me', status: 'open' },
    }, token);
    assert.deepEqual(mine.result.structuredContent.map((task) => task.slug), ['tasks/draft-icaire-update']);

    const allTasks = await rpc(running.url, 'tools/call', {
      name: 'tasks/list',
      arguments: {},
    }, token);
    assert.deepEqual(allTasks.result.structuredContent.map((task) => task.slug), ['tasks/draft-icaire-update']);

    const updated = await rpc(running.url, 'tools/call', {
      name: 'tasks/update',
      arguments: {
        path: 'tasks/draft-icaire-update',
        status: 'done',
        timeline_entry: 'Marked complete in MCP task test.',
      },
    }, token);
    assert.equal(updated.result.structuredContent.status, 'done');
    assert.match(updated.result.structuredContent.timeline, /Marked complete in MCP task test\. \(via teammate@example\.com\)/);

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
