import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { openDatabase } from '../../src/bigbrain/db.js';
import {
  buildExplorerFilePayload,
  buildExplorerTreePayload,
  buildGraphPayload,
  buildPagePayload,
} from '../../src/bigbrain/dashboard.js';
import { syncBrain } from '../../src/bigbrain/sync.js';

test('dashboard graph excludes root infrastructure files from nodes and types', async () => {
  const fixture = await createFixture('bigbrain-dashboard-graph-');
  try {
    await writeMarkdown(fixture.brainHome, 'index.md', '# Index\n\nSee [Alice](people/alice.md).\n');
    await writeMarkdown(fixture.brainHome, 'schema.md', '# Schema\n\nSee [Relay](projects/relay.md).\n');
    await writeMarkdown(fixture.brainHome, 'resolver.md', '# Resolver\n\nInternal resolver notes.\n');
    await writeMarkdown(fixture.brainHome, 'people/alice.md', '# Alice\n\nWorks on [Relay](../projects/relay.md) and reads [Index](../index.md).\n');
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
    assert.deepEqual(graph.edges, [
      { source: 'people/alice', target: 'projects/relay' },
      { source: 'projects/relay', target: 'people/alice' },
    ]);
  } finally {
    await fs.rm(fixture.rootDir, { recursive: true, force: true });
  }
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
    await writeMarkdown(fixture.brainHome, 'people/alice.md', '# Alice\n\nHas files.\n');
    await writeFile(fixture.brainHome, 'sources/.raw/deck.pdf', Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8'));
    await writeFile(fixture.brainHome, 'sources/.raw/slides.pptx', Buffer.from('PK\x03\x04fake pptx fixture', 'binary'));
    await writeFile(fixture.brainHome, 'sources/.raw/chart.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(fixture.brainHome, 'sources/.raw/notes.txt', 'plain notes');

    const config = await loadConfig({ configPath: fixture.configPath });
    const tree = await buildExplorerTreePayload(config);
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
