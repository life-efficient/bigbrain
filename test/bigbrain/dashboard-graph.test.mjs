import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { openDatabase, upsertPageProvenance, upsertSharedGroup } from '../../src/bigbrain/db.js';
import { createBrainDomain } from '../../src/bigbrain/domains.js';
import {
  buildExplorerFilePayload,
  buildExplorerRecentPayload,
  buildExplorerTreePayload,
  buildGraphPayload,
  buildGraphLineagePayload,
  graphChangeFromAuditRow,
  buildContinuousActivity,
  buildPagePayload,
  buildPublicPagePayload,
  buildPublicRawFilePayload,
  buildSharedGroupPayload,
  buildSharedRawFilePayload,
} from '../../src/bigbrain/dashboard.js';
import { syncBrain } from '../../src/bigbrain/sync.js';

test('graph change stream exposes only confirmed privacy-safe MCP mutations', () => {
  const created = graphChangeFromAuditRow({
    id: 42,
    event_id: 'evt_safe',
    action: 'mcp.tool.create_page',
    outcome: 'success',
    resource_type: 'page',
    resource_id: 'projects/relay',
    details_json: JSON.stringify({ arguments: { path: 'projects/relay', body: 'private page body' } }),
    created_at: '2026-08-22T12:00:00.000Z',
  });

  assert.deepEqual(created, {
    id: '42',
    event_id: 'evt_safe',
    kind: 'created',
    slug: 'projects/relay',
    action: 'create_page',
    created_at: '2026-08-22T12:00:00.000Z',
  });
  assert.doesNotMatch(JSON.stringify(created), /private page body/);
  const read = graphChangeFromAuditRow({
    id: 43,
    action: 'mcp.tool.read',
    outcome: 'success',
    resource_type: 'page',
    resource_id: 'projects/relay',
    details_json: JSON.stringify({ arguments: { path: 'projects/relay' } }),
  });
  assert.equal(read.kind, 'read');
  assert.equal(read.slug, 'projects/relay');
  const visibilityRead = graphChangeFromAuditRow({
    id: 44,
    action: 'mcp.tool.get_page_visibility',
    outcome: 'success',
    resource_type: 'page',
    resource_id: 'projects/relay',
    details_json: JSON.stringify({ arguments: { path: 'projects/relay' } }),
  });
  assert.equal(visibilityRead.kind, 'read');
  assert.equal(graphChangeFromAuditRow({ ...created, action: 'mcp.tool.create_page', outcome: 'error' }), null);
  assert.equal(graphChangeFromAuditRow({ ...created, action: 'mcp.tool.pages/query', outcome: 'success' }), null);
});

test('public attachment sidecars expose only their bound safe artifact', async () => {
  const fixture = await createFixture('bigbrain-public-attachment-sidecar-');
  try {
    await writeFile(fixture.brainHome, 'deals/.raw/plan.pdf', '%PDF-1.4\nsecret bytes\n%%EOF\n');
    await writeFile(fixture.brainHome, 'deals/.raw/sibling.pdf', '%PDF-1.4\nsibling\n%%EOF\n');
    await fs.symlink(path.join(fixture.brainHome, 'deals', '.raw', 'plan.pdf'), path.join(fixture.brainHome, 'deals', '.raw', 'linked.pdf'));
    await writeMarkdown(fixture.brainHome, 'deals/.raw/plan.md', `---
title: Confidential Plan
visibility: public
raw_file: deals/.raw/plan.pdf
raw_mime_type: application/pdf
---
# Confidential Plan

Private extracted knowledge must not be returned publicly.
`);
    const config = await loadConfig({ configPath: fixture.configPath });
    const page = await buildPublicPagePayload(config, new URL('/api/public/page?slug=deals/.raw/plan', 'http://127.0.0.1'));
    assert.equal(page.page_kind, 'attachment');
    assert.equal(page.markdown, '');
    assert.doesNotMatch(JSON.stringify(page), /Private extracted knowledge/);
    const raw = await buildPublicRawFilePayload(config, new URL('/api/public/raw?slug=deals/.raw/plan&path=deals/.raw/plan.pdf', 'http://127.0.0.1'));
    assert.equal(raw.filename, 'plan.pdf');
    const sibling = await buildPublicRawFilePayload(config, new URL('/api/public/raw?slug=deals/.raw/plan&path=deals/.raw/sibling.pdf', 'http://127.0.0.1'));
    assert.equal(sibling, null);
    const traversal = await buildPublicRawFilePayload(config, new URL('/api/public/raw?slug=deals/.raw/plan&path=deals/.raw/../secret.pdf', 'http://127.0.0.1'));
    assert.equal(traversal, null);
    await writeMarkdown(fixture.brainHome, 'deals/.raw/linked.md', `---
title: Linked Plan
visibility: public
raw_file: deals/.raw/linked.pdf
---
Private linked extraction.
`);
    const linked = await buildPublicRawFilePayload(config, new URL('/api/public/raw?slug=deals/.raw/linked&path=deals/.raw/linked.pdf', 'http://127.0.0.1'));
    assert.equal(linked, null);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('dashboard graph excludes root infrastructure files from nodes and types', async () => {
  const fixture = await createFixture('bigbrain-dashboard-graph-');
  try {
    await writeMarkdown(fixture.brainHome, 'index.md', '# Index\n\nSee [Alice](people/alice.md).\n');
    await writeMarkdown(fixture.brainHome, 'schema.md', '# Schema\n\nSee [Relay](projects/relay.md).\n');
    await writeMarkdown(fixture.brainHome, 'resolver.md', '# Resolver\n\nInternal resolver notes.\n');
    await writeMarkdown(fixture.brainHome, 'people/alice.md', [
      '# Alice',
      '',
      'Works on [Relay](../projects/relay.md) and reads [Index](../index.md).',
      '',
      '---',
      '',
      '## Timeline',
      '- **2026-06-28** | First graph update.',
      '- **2026-06-29** | Latest graph update.',
    ].join('\n'));
    await writeMarkdown(fixture.brainHome, 'projects/relay.md', '# Relay\n\nRelated to [Alice](../people/alice.md).\n');

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    const db = await openDatabase(config);
    const graph = await buildGraphPayload(db);

    assert.deepEqual(graph.nodes.map((node) => node.slug), ['people/alice', 'projects/relay']);
    assert.deepEqual([...new Set(graph.nodes.map((node) => node.type))].sort(), ['people', 'projects']);
    assert.equal(graph.meta.page_count, 2);
    assert.equal(graph.meta.node_count, 2);
    assert.match(graph.nodes[0].updated_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(graph.nodes[0].created_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(graph.nodes.find((node) => node.slug === 'people/alice').latest_timeline_entry, '2026-06-29 | Latest graph update.');
    assert.deepEqual(graph.edges, [
      { source: 'people/alice', target: 'projects/relay' },
      { source: 'projects/relay', target: 'people/alice' },
    ]);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('dashboard graph nodes expose normalized domains from indexed frontmatter', async () => {
  const fixture = await createFixture('bigbrain-dashboard-graph-domains-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    await createBrainDomain(config, {
      id: 'ai-infrastructure',
      name: 'AI infrastructure',
      guidance: 'Use for AI infrastructure knowledge.',
    });
    await createBrainDomain(config, {
      id: 'startups',
      name: 'Startups',
      guidance: 'Use for startup knowledge.',
    });
    await writeMarkdown(fixture.brainHome, 'companies/acme.md', '# Acme\n');
    await writeMarkdown(fixture.brainHome, 'people/alice.md', [
      '---',
      'domains: [ startups, ai-infrastructure, startups, ]',
      '---',
      '# Alice',
    ].join('\n'));
    await writeMarkdown(fixture.brainHome, 'projects/relay.md', [
      '---',
      'domains: ai-infrastructure',
      '---',
      '# Relay',
    ].join('\n'));

    await syncBrain({ config, apiKey: null });
    const db = await openDatabase(config);

    await writeMarkdown(fixture.brainHome, 'people/alice.md', [
      '---',
      'domains: [not-indexed-yet]',
      '---',
      '# Alice',
    ].join('\n'));

    const graph = await buildGraphPayload(db, config);
    const domainsBySlug = Object.fromEntries(graph.nodes.map((node) => [node.slug, node.domains]));

    assert.deepEqual(domainsBySlug, {
      'companies/acme': [],
      'people/alice': ['ai-infrastructure', 'startups'],
      'projects/relay': ['ai-infrastructure'],
    });
    assert.deepEqual(graph.meta.domain_definitions, [
      { id: 'ai-infrastructure', name: 'AI infrastructure' },
      { id: 'startups', name: 'Startups' },
    ]);
    await db.close?.();
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('dashboard graph recent timestamps reflect current markdown file edits', async () => {
  const fixture = await createFixture('bigbrain-dashboard-graph-mtime-');
  try {
    await writeMarkdown(fixture.brainHome, 'people/alice.md', '# Alice\n\nWorks on [Relay](../projects/relay.md).\n');
    await writeMarkdown(fixture.brainHome, 'projects/relay.md', '# Relay\n\nRelated to [Alice](../people/alice.md).\n');

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    const db = await openDatabase(config);
    const editedAt = new Date('2026-01-04T00:00:00Z');
    await fs.utimes(path.join(fixture.brainHome, 'people/alice.md'), editedAt, editedAt);

    const graph = await buildGraphPayload(db, config);

    assert.equal(graph.nodes.find((node) => node.slug === 'people/alice').updated_at, editedAt.toISOString());
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('dashboard graph exposes only filed provenance inputs with source snapshots', async () => {
  const fixture = await createFixture('bigbrain-dashboard-provenance-');
  try {
    await writeMarkdown(fixture.brainHome, 'organizations/openai.md', '# OpenAI\n\nNews.\n');
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    const db = await openDatabase(config);
    await upsertPageProvenance(db, {
      page_slug: 'organizations/openai',
      event_id: 'openai-news:event-1',
      listener_id: 'openai-news',
      source_type: 'rss',
      source: 'OpenAI News',
      source_icon: 'Rss',
      source_endpoint: 'https://openai.com/news/rss.xml',
      received_at: '2026-08-26T13:00:00.000Z',
      outcome: 'filed',
      codex_thread_id: 'thread-1',
      commit_message: 'Record the OpenAI news update',
    });
    await upsertPageProvenance(db, {
      page_slug: 'organizations/openai',
      event_id: 'ignored:event-2',
      listener_id: 'openai-news',
      source_type: 'rss',
      source: 'OpenAI News',
      received_at: '2026-08-26T14:00:00.000Z',
      outcome: 'ignored',
      commit_message: 'Ignore the duplicate OpenAI news item',
    });
    const graph = await buildGraphPayload(db, config);
    assert.equal(graph.meta.input_count, 1);
    assert.deepEqual(graph.inputs[0], {
      id: 'event:openai-news:event-1',
      event_id: 'openai-news:event-1',
      source_message: 'OpenAI News',
      occurred_at: null,
      received_at: '2026-08-26T13:00:00.000Z',
      source: { id: 'openai-news', type: 'rss', label: 'OpenAI News', icon: 'Rss' },
      listener_id: 'openai-news',
      codex_execution_id: null,
      codex_thread_id: 'thread-1',
      source_url: 'https://openai.com/news/rss.xml',
      raw_ref: null,
      outcome: 'filed',
      commit_message: 'Record the OpenAI news update',
      target_pages: [{ slug: 'organizations/openai', title: 'OpenAI' }],
      target_count: 1,
    });
    await db.close?.();
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('dashboard graph represents one source event once when it files multiple pages', async () => {
  const fixture = await createFixture('bigbrain-dashboard-graph-multi-target-');
  try {
    await writeMarkdown(fixture.brainHome, 'people/alice.md', '# Alice\n');
    await writeMarkdown(fixture.brainHome, 'projects/relay.md', '# Relay\n');
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    const db = await openDatabase(config);
    const provenance = {
      event_id: 'assistant-chat:event-1',
      source_type: 'assistant_chat',
      source: 'Capture the partner context',
      source_icon: 'MessageSquare',
      received_at: '2026-08-26T13:00:00.000Z',
      outcome: 'filed',
      codex_thread_id: 'thread-1',
      commit_message: 'Record the partner context',
    };
    await upsertPageProvenance(db, { ...provenance, page_slug: 'people/alice' });
    await upsertPageProvenance(db, { ...provenance, page_slug: 'projects/relay' });

    const graph = await buildGraphPayload(db, config);

    assert.equal(graph.meta.input_count, 1);
    assert.equal(graph.inputs.length, 1);
    assert.equal(graph.inputs[0].source_message, 'Capture the partner context');
    assert.equal(graph.inputs[0].target_count, 2);
    assert.deepEqual(graph.inputs[0].target_pages, [
      { slug: 'people/alice', title: 'Alice' },
      { slug: 'projects/relay', title: 'Relay' },
    ]);
    await db.close?.();
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('dashboard graph derives inputs from per-page timeline provenance', async () => {
  const fixture = await createFixture('bigbrain-dashboard-timeline-inputs-');
  try {
    const timeline = (title) => `# ${title}\n\nCurrent context.\n\n---\n\n## Timeline\n\n- **2026-08-27** | Updated from one source event.\n  <!-- bigbrain:timeline ${JSON.stringify({
      schema_version: 1,
      entry_id: 'whatsapp:event-1',
      occurred_at: '2026-08-27',
      recorded_at: '2026-09-01T12:00:00.000Z',
      text: 'Updated from one source event.',
      provenance: {
        event_id: 'whatsapp:event-1',
        source_type: 'whatsapp',
        source_label: 'Harry chat',
        source_message: 'Please carry the updated commercial terms into both pages.',
        source_icon: 'MessageCircle',
        received_at: '2026-09-01T12:00:00.000Z',
        outcome: 'filed',
      },
      significance: 'minor',
    })} -->\n`;
    await writeMarkdown(fixture.brainHome, 'people/alice.md', timeline('Alice'));
    await writeMarkdown(fixture.brainHome, 'projects/relay.md', timeline('Relay'));
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    const db = await openDatabase(config);

    const graph = await buildGraphPayload(db, config);

    assert.equal(graph.meta.input_count, 1);
    assert.equal(graph.inputs[0].source_message, 'Please carry the updated commercial terms into both pages.');
    assert.deepEqual(graph.inputs[0].source, {
      id: 'whatsapp',
      type: 'whatsapp',
      label: 'Harry chat',
      icon: 'MessageCircle',
    });
    assert.deepEqual(graph.inputs[0].target_pages, [
      { slug: 'people/alice', title: 'Alice' },
      { slug: 'projects/relay', title: 'Relay' },
    ]);
    await db.close?.();
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('graph lineage combines current connections with source events', async () => {
  const fixture = await createFixture('bigbrain-dashboard-lineage-');
  try {
    await writeMarkdown(fixture.brainHome, 'people/friend.md', '# Friend\n\nIntroduced [Mentor](../people/mentor.md).\n');
    await writeMarkdown(fixture.brainHome, 'people/mentor.md', '# Mentor\n');
    await writeMarkdown(fixture.brainHome, 'projects/deal.md', '# Deal\n\nLinked to [[people/mentor]].\n');
    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    const db = await openDatabase(config);
    await upsertPageProvenance(db, {
      page_slug: 'people/mentor',
      event_id: 'gmail:event-1',
      source_type: 'gmail',
      source_label: 'Mentor thread',
      source_message: 'Mentor thread',
      received_at: '2026-08-28T10:00:00.000Z',
      outcome: 'filed',
      commit_message: 'Record the mentor update',
    });
    const lineage = await buildGraphLineagePayload(db, config, 'people/mentor');
    assert.deepEqual(lineage.page, { slug: 'people/mentor', title: 'Mentor', type: 'people' });
    assert.equal(lineage.backlinks.length, 2);
    assert.deepEqual(lineage.provenance, [{
      event_id: 'gmail:event-1',
      source_type: 'gmail',
      source_label: 'Mentor thread',
      source_message: 'Mentor thread',
      source_icon: null,
      source_url: null,
      commit_message: 'Record the mentor update',
      occurred_at: null,
      received_at: '2026-08-28T10:00:00.000Z',
    }]);
    assert.ok(Array.isArray(lineage.link_events));
    await db.close?.();
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('graph activity includes every day since the first brain commit', () => {
  const nodes = [
    { slug: 'people/alice', updated_at: '2026-04-29T12:00:00.000Z' },
    { slug: 'projects/relay', updated_at: '2026-05-01T12:00:00.000Z' },
  ];
  const gitLog = [
    '\x1e2026-04-26T09:00:00+03:00',
    'people/alice.md',
    '',
    '\x1e2026-04-28T12:00:00+03:00',
    'people/alice.md',
    'projects/relay.md',
  ].join('\n');
  assert.deepEqual(buildContinuousActivity(nodes, gitLog, '2026-04-30'), [
    { day: '2026-04-26', count: 1 },
    { day: '2026-04-27', count: 0 },
    { day: '2026-04-28', count: 2 },
    { day: '2026-04-29', count: 0 },
    { day: '2026-04-30', count: 0 },
  ]);
});

test('dashboard page payload includes file explorer metadata and nearby links', async () => {
  const fixture = await createFixture('bigbrain-dashboard-page-');
  try {
    await writeMarkdown(fixture.brainHome, 'people/alice.md', [
      '---',
      'title: Alice Example',
      '---',
      '# Alice Example',
      '',
      'Works on [Relay](../projects/relay.md) with a long operational summary that should remain visible in the page reader instead of being cut at an arbitrary character limit because the sidecar can scroll naturally.',
      '',
      'This second sentence should also remain visible so the reader preview does not look accidentally truncated.',
      '',
      '---',
      '',
      '## Timeline',
    ].join('\n'));
    await writeMarkdown(fixture.brainHome, 'projects/relay.md', '# Relay\n\nRelated to [Alice](../people/alice.md).\n');

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    const db = await openDatabase(config);
    const payload = await buildPagePayload(
      config,
      db,
      new URL('/api/page?slug=people/alice', 'http://127.0.0.1'),
    );

    assert.equal(payload.slug, 'people/alice');
    assert.equal(payload.title, 'Alice Example');
    assert.equal(payload.type, 'people');
    assert.equal(payload.path, 'people/alice.md');
    assert.equal(payload.visibility, 'internal');
    assert.equal(payload.public_url, null);
    assert.match(payload.summary, /Works on/);
    assert.match(payload.summary, /second sentence should also remain visible/);
    assert.equal(payload.frontmatter.title, 'Alice Example');
    assert.equal(payload.links.outgoing.some((link) => link.slug === 'projects/relay'), true);
    assert.equal(payload.links.backlinks.some((link) => link.slug === 'projects/relay'), true);
    assert.match(payload.updated_at, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('dashboard explorer includes raw folders and classifies obvious file previews', async () => {
  const fixture = await createFixture('bigbrain-dashboard-explorer-');
  try {
    await writeMarkdown(fixture.brainHome, 'BRAIN.md', '# Existing Brain Notes\n\nKeep this visible.\n');
    await writeMarkdown(fixture.brainHome, 'people/alice.md', '# Alice\n\nHas files.\n');
    await writeFile(fixture.brainHome, 'sources/.raw/deck.pdf', Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8'));
    await writeFile(fixture.brainHome, 'sources/.raw/slides.pptx', Buffer.from('PK\x03\x04fake pptx fixture', 'binary'));
    await writeFile(fixture.brainHome, 'sources/.raw/chart.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(fixture.brainHome, 'sources/.raw/notes.txt', 'plain notes');

    const config = await loadConfig({ configPath: fixture.configPath });
    const tree = await buildExplorerTreePayload(config);
    assert.ok(tree.root.children.some((entry) => entry.name === 'BRAIN.md'));
    const sources = tree.root.children.find((entry) => entry.name === 'sources');
    const raw = sources.children.find((entry) => entry.name === '.raw');
    assert.equal(raw.type, 'directory');
    assert.deepEqual(raw.children.map((entry) => [entry.name, entry.kind]), [
      ['chart.png', 'image'],
      ['deck.pdf', 'pdf'],
      ['notes.txt', 'text'],
      ['slides.pptx', 'presentation'],
    ]);

    const markdown = await buildExplorerFilePayload(
      config,
      new URL('/api/explorer/file?path=people/alice.md', 'http://127.0.0.1'),
    );
    assert.equal(markdown.kind, 'markdown');
    assert.match(markdown.text, /# Alice/);

    const image = await buildExplorerFilePayload(
      config,
      new URL('/api/explorer/file?path=sources/.raw/chart.png', 'http://127.0.0.1'),
    );
    assert.equal(image.kind, 'image');
    assert.equal(image.mime_type, 'image/png');
    assert.match(image.blob_url, /sources%2F.raw%2Fchart.png/);

    const presentation = await buildExplorerFilePayload(
      config,
      new URL('/api/explorer/file?path=sources/.raw/slides.pptx', 'http://127.0.0.1'),
    );
    assert.equal(presentation.kind, 'presentation');
    assert.equal(presentation.mime_type, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    assert.match(presentation.blob_url, /sources%2F.raw%2Fslides.pptx/);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('dashboard explorer recents lists files by latest edit time', async () => {
  const fixture = await createFixture('bigbrain-dashboard-explorer-recents-');
  try {
    await writeMarkdown(fixture.brainHome, 'people/alice.md', '# Alice\n');
    await writeMarkdown(fixture.brainHome, 'projects/relay.md', '# Relay\n');
    await writeFile(fixture.brainHome, 'sources/.raw/notes.txt', 'notes');
    await writeFile(fixture.brainHome, '.bigbrain-state/ignored.txt', 'ignored');
    await fs.utimes(path.join(fixture.brainHome, 'people/alice.md'), new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
    await fs.utimes(path.join(fixture.brainHome, 'projects/relay.md'), new Date('2026-01-03T00:00:00Z'), new Date('2026-01-03T00:00:00Z'));
    await fs.utimes(path.join(fixture.brainHome, 'sources/.raw/notes.txt'), new Date('2026-01-02T00:00:00Z'), new Date('2026-01-02T00:00:00Z'));

    const config = await loadConfig({ configPath: fixture.configPath });
    const recents = await buildExplorerRecentPayload(
      config,
      new URL('/api/explorer/recent?limit=2', 'http://127.0.0.1'),
    );

    assert.deepEqual(recents.files.map((entry) => entry.path), [
      'projects/relay.md',
      'sources/.raw/notes.txt',
    ]);
    assert.equal(recents.meta.total_file_count, 3);
    assert.equal(recents.meta.limit, 2);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('domain-scoped page payload redacts links outside the selected knowledge domain at render time', async () => {
  const fixture = await createFixture('bigbrain-dashboard-domain-redaction-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    await createBrainDomain(config, {
      id: 'ai-infrastructure',
      name: 'AI infrastructure',
      guidance: 'Use for end-to-end AI infrastructure supply chain knowledge.',
    });
    await createBrainDomain(config, {
      id: 'startups',
      name: 'Startups',
      guidance: 'Use for startup knowledge from articles, writing, and meetings.',
    });
    await writeMarkdown(fixture.brainHome, 'concepts/source.md', [
      '---',
      'domains: [ai-infrastructure]',
      '---',
      '# Source',
      '',
      'See [In scope](in-scope.md), [Out of scope](out-of-scope.md), and [[out-of-scope|Out of scope wiki]].',
    ].join('\n'));
    await writeMarkdown(fixture.brainHome, 'concepts/in-scope.md', [
      '---',
      'domains: [ai-infrastructure]',
      '---',
      '# In scope',
    ].join('\n'));
    await writeMarkdown(fixture.brainHome, 'concepts/out-of-scope.md', [
      '---',
      'domains: [startups]',
      '---',
      '# Out of scope',
    ].join('\n'));
    await syncBrain({ config, apiKey: null });
    const db = await openDatabase(config);

    const scoped = await buildPagePayload(
      config,
      db,
      new URL('/api/page?slug=concepts/source&domains=ai-infrastructure', 'http://127.0.0.1'),
    );
    assert.match(scoped.markdown, /\[In scope\]\(in-scope\.md\)/);
    assert.match(scoped.markdown, /Out of scope/);
    assert.doesNotMatch(scoped.markdown, /\[Out of scope\]\(out-of-scope\.md\)/);
    assert.doesNotMatch(scoped.markdown, /\[Out of scope wiki\]\(.*out-of-scope/);
    assert.deepEqual(scoped.links.outgoing.map((link) => link.slug), ['concepts/in-scope']);
    assert.deepEqual(scoped.domain_scope, ['ai-infrastructure']);

    const canonical = await buildPagePayload(
      config,
      db,
      new URL('/api/page?slug=concepts/source', 'http://127.0.0.1'),
    );
    assert.match(canonical.markdown, /\[Out of scope\]\(out-of-scope\.md\)/);
    assert.match(canonical.markdown, /\[\[out-of-scope\|Out of scope wiki\]\]/);
    assert.equal(canonical.domain_scope, null);
    await db.close?.();
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('public page payload exposes only approved body content and safe links', async () => {
  const fixture = await createFixture('bigbrain-dashboard-public-page-');
  try {
    await writeMarkdown(fixture.brainHome, 'people/alice.md', [
      '---',
      'title: Alice Public',
      'visibility: public',
      'public_raw_files: [sources/.raw/deck.pdf, sources/.raw/unlinked.pdf]',
      '---',
      '# Alice Public',
      '',
      'Visible body with [Relay](../projects/relay.md), [Secret](../projects/secret.md), [Deck](../sources/.raw/deck.pdf), [Private Deck](../sources/.raw/private.pdf), [External](https://example.com), and [[projects/relay|Relay Wiki]].',
      '',
      '---',
      '',
      '## Timeline',
      '',
      '- 2026-06-28 | Private provenance should not publish.',
    ].join('\n'));
    await writeMarkdown(fixture.brainHome, 'projects/relay.md', [
      '---',
      'title: Relay Public',
      'visibility: public',
      '---',
      '# Relay Public',
      '',
      'Public target.',
    ].join('\n'));
    await writeMarkdown(fixture.brainHome, 'projects/secret.md', [
      '---',
      'title: Secret Private',
      '---',
      '# Secret Private',
      '',
      'Private target.',
    ].join('\n'));
    await fs.mkdir(path.join(fixture.brainHome, 'sources', '.raw'), { recursive: true });
    await fs.writeFile(path.join(fixture.brainHome, 'sources', '.raw', 'deck.pdf'), 'pdf bytes');
    await fs.writeFile(path.join(fixture.brainHome, 'sources', '.raw', 'unlinked.pdf'), 'unlinked pdf bytes');
    await fs.writeFile(path.join(fixture.brainHome, 'sources', '.raw', 'private.pdf'), 'private pdf bytes');

    const config = await loadConfig({ configPath: fixture.configPath });
    const payload = await buildPublicPagePayload(
      config,
      new URL('/api/public/page?slug=people/alice', 'http://127.0.0.1'),
    );

    assert.equal(payload.slug, 'people/alice');
    assert.equal(payload.title, 'Alice Public');
    assert.match(payload.summary, /Visible body/);
    assert.match(payload.markdown, /Visible body/);
    assert.doesNotMatch(payload.markdown, /^# Alice Public/m);
    assert.match(payload.markdown, /\[Relay\]\(\/public\/projects\/relay\)/);
    assert.match(payload.markdown, /\[Relay Wiki\]\(\/public\/projects\/relay\)/);
    assert.match(payload.markdown, /\[Deck\]\(\/api\/public\/raw\?slug=people%2Falice&path=sources%2F\.raw%2Fdeck\.pdf\)/);
    assert.deepEqual(payload.raw_files, [
      {
        filename: 'deck.pdf',
        url: '/api/public/raw?slug=people%2Falice&path=sources%2F.raw%2Fdeck.pdf',
      },
    ]);
    assert.match(payload.markdown, /\[External\]\(https:\/\/example\.com\)/);
    assert.doesNotMatch(payload.markdown, /frontmatter/i);
    assert.doesNotMatch(payload.markdown, /Private provenance/);
    assert.doesNotMatch(payload.markdown, /projects\/secret/);
    assert.doesNotMatch(JSON.stringify(payload), /unlinked\.pdf/);
    assert.doesNotMatch(payload.markdown, /sources\/\.raw\/private\.pdf/);

    const privatePayload = await buildPublicPagePayload(
      config,
      new URL('/api/public/page?slug=projects/secret', 'http://127.0.0.1'),
    );
    assert.equal(privatePayload, null);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('public domain-scoped payload keeps canonical links unchanged while hiding out-of-domain targets', async () => {
  const fixture = await createFixture('bigbrain-dashboard-public-domain-');
  try {
    const config = await loadConfig({ configPath: fixture.configPath });
    await createBrainDomain(config, {
      id: 'ai-infrastructure',
      name: 'AI infrastructure',
      guidance: 'Use for AI infrastructure knowledge.',
    });
    await createBrainDomain(config, {
      id: 'startups',
      name: 'Startups',
      guidance: 'Use for startup knowledge.',
    });
    await writeMarkdown(fixture.brainHome, 'concepts/public-source.md', [
      '---',
      'visibility: public',
      'domains: [ai-infrastructure]',
      '---',
      '# Public source',
      '',
      'See [Infrastructure](infrastructure.md) and [Startups](startups.md).',
    ].join('\n'));
    await writeMarkdown(fixture.brainHome, 'concepts/infrastructure.md', [
      '---',
      'visibility: public',
      'domains: [ai-infrastructure]',
      '---',
      '# Infrastructure',
    ].join('\n'));
    await writeMarkdown(fixture.brainHome, 'concepts/startups.md', [
      '---',
      'visibility: public',
      'domains: [startups]',
      '---',
      '# Startups',
    ].join('\n'));

    const scoped = await buildPublicPagePayload(
      config,
      new URL('/api/public/page?slug=concepts/public-source&domain=ai-infrastructure', 'http://127.0.0.1'),
    );
    assert.match(scoped.markdown, /\[Infrastructure\]\(\/public\/concepts\/infrastructure\)/);
    assert.match(scoped.markdown, /Startups/);
    assert.doesNotMatch(scoped.markdown, /\[Startups\]\(\/public\/concepts\/startups\)/);
    assert.deepEqual(scoped.domain_scope, ['ai-infrastructure']);

    const canonical = await buildPublicPagePayload(
      config,
      new URL('/api/public/page?slug=concepts/public-source', 'http://127.0.0.1'),
    );
    assert.match(canonical.markdown, /\[Startups\]\(\/public\/concepts\/startups\)/);
    assert.equal(canonical.domain_scope, null);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('public page payload resolves redirect_from slugs for pages and raw files', async () => {
  const fixture = await createFixture('bigbrain-dashboard-public-redirect-');
  try {
    await writeMarkdown(fixture.brainHome, 'people/alice-new.md', [
      '---',
      'title: Alice Public',
      'visibility: public',
      'redirect_from: [people/alice-old]',
      'public_raw_files: [sources/.raw/deck.pdf]',
      '---',
      '# Alice Public',
      '',
      'Visible body with [Deck](../sources/.raw/deck.pdf).',
    ].join('\n'));
    await writeMarkdown(fixture.brainHome, 'people/private-target.md', [
      '---',
      'title: Private Target',
      'redirect_from: [people/private-old]',
      '---',
      '# Private Target',
      '',
      'Not public.',
    ].join('\n'));
    await fs.mkdir(path.join(fixture.brainHome, 'sources', '.raw'), { recursive: true });
    await fs.writeFile(path.join(fixture.brainHome, 'sources', '.raw', 'deck.pdf'), 'pdf bytes');

    const config = await loadConfig({ configPath: fixture.configPath });
    const payload = await buildPublicPagePayload(
      config,
      new URL('/api/public/page?slug=people/alice-old', 'http://127.0.0.1'),
    );

    assert.equal(payload.slug, 'people/alice-new');
    assert.equal(payload.redirect_to, '/public/people/alice-new');
    assert.match(payload.markdown, /Visible body/);
    assert.deepEqual(payload.raw_files, [
      {
        filename: 'deck.pdf',
        url: '/api/public/raw?slug=people%2Falice-new&path=sources%2F.raw%2Fdeck.pdf',
      },
    ]);

    const rawPayload = await buildPublicRawFilePayload(
      config,
      new URL('/api/public/raw?slug=people/alice-old&path=sources/.raw/deck.pdf', 'http://127.0.0.1'),
    );
    assert.equal(rawPayload.slug, 'people/alice-new');
    assert.equal(rawPayload.filename, 'deck.pdf');

    const privateRedirectPayload = await buildPublicPagePayload(
      config,
      new URL('/api/public/page?slug=people/private-old', 'http://127.0.0.1'),
    );
    assert.equal(privateRedirectPayload, null);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test('shared group payload exposes ordered member summaries and safe raw files', async () => {
  const fixture = await createFixture('bigbrain-dashboard-shared-group-');
  try {
    await writeMarkdown(fixture.brainHome, 'deals/platform-one.md', [
      '---',
      'title: Platform One',
      '---',
      '# Platform One',
      '',
      'First public-safe teaser summary.',
    ].join('\n'));
    await writeMarkdown(fixture.brainHome, 'deals/platform-two.md', [
      '---',
      'title: Platform Two',
      'raw_file: deals/.raw/platform-two.exe',
      '---',
      '# Platform Two',
      '',
      'Second teaser summary.',
    ].join('\n'));
    await fs.mkdir(path.join(fixture.brainHome, 'deals', '.raw'), { recursive: true });
    await fs.writeFile(path.join(fixture.brainHome, 'deals', '.raw', 'platform-one.pdf'), 'pdf bytes');
    await fs.writeFile(path.join(fixture.brainHome, 'deals', '.raw', 'platform-two.exe'), 'not safe');

    const config = await loadConfig({ configPath: fixture.configPath });
    await syncBrain({ config, apiKey: null });
    const db = await openDatabase(config);
    await upsertSharedGroup(db, {
      slug: 'active-deals',
      title: 'Active Deals',
      description: 'Current shared deal teasers.',
      visibility: 'public',
      redirect_from: ['deals/active-deals', 'deals/active-deals-blind-teasers-group'],
      pages: [
        { page_slug: 'deals/platform-two', sort_order: 1 },
        {
          page_slug: 'deals/platform-one',
          sort_order: 0,
          label: 'Platform One Teaser',
          public_summary: 'Curated public summary for platform one.',
          raw_files: ['deals/.raw/platform-one.pdf'],
        },
      ],
    });

    const payload = await buildSharedGroupPayload(
      config,
      db,
      new URL('/api/shared/group?slug=active-deals', 'http://127.0.0.1'),
    );

    assert.equal(payload.slug, 'active-deals');
    assert.equal(payload.title, 'Active Deals');
    assert.deepEqual(payload.pages.map((page) => page.slug), ['deals/platform-one', 'deals/platform-two']);
    assert.equal(payload.pages[0].title, 'Platform One Teaser');
    assert.equal(payload.pages[0].summary, 'Curated public summary for platform one.');
    assert.deepEqual(payload.pages[0].raw_files.map((file) => file.filename), ['platform-one.pdf']);
    assert.equal(payload.pages[1].summary, null);
    assert.deepEqual(payload.pages[1].raw_files, []);

    const redirected = await buildSharedGroupPayload(
      config,
      db,
      new URL('/api/shared/group?slug=deals/active-deals', 'http://127.0.0.1'),
    );
    assert.equal(redirected.slug, 'active-deals');
    assert.equal(redirected.redirect_to, '/shared/active-deals');

    const rawPayload = await buildSharedRawFilePayload(
      config,
      db,
      new URL('/api/shared/raw?group=active-deals&page=deals/platform-one&path=deals/.raw/platform-one.pdf', 'http://127.0.0.1'),
    );
    assert.equal(rawPayload.filename, 'platform-one.pdf');

    const blockedRawPayload = await buildSharedRawFilePayload(
      config,
      db,
      new URL('/api/shared/raw?group=active-deals&page=deals/platform-two&path=deals/.raw/platform-two.exe', 'http://127.0.0.1'),
    );
    assert.equal(blockedRawPayload, null);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
});

async function createFixture(prefix) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const pointerPath = path.join(rootDir, 'pointer');
  const stateRoot = path.join(rootDir, 'state-root');
  const brainHome = path.join(rootDir, 'brain-home');
  const init = await initializeBrainHome(brainHome, {
    env: { ...process.env, BIGBRAIN_POINTER_PATH: pointerPath, BIGBRAIN_STATE_ROOT: stateRoot },
  });
  return { rootDir, brainHome, configPath: init.configPath };
}

async function writeMarkdown(brainHome, relativePath, content) {
  return writeFile(brainHome, relativePath, content);
}

async function writeFile(brainHome, relativePath, content) {
  const fullPath = path.join(brainHome, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content);
}
