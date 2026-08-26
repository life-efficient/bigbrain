import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  buildDemoExplorer,
  buildDemoExplorerFile,
  buildDemoGraph,
  buildDemoPagePreview,
  buildDemoTaskSections,
  buildDemoTasks,
  demoTitleForNode,
} from '../../src/dashboard-client/demo-mode.js';

test('demo graph replaces page titles with stable, type-aware names', () => {
  const graph = {
    nodes: [
      { slug: 'people/real-person', title: 'Real Person', type: 'people' },
      { slug: 'projects/real-project', title: 'Real Project', type: 'projects' },
    ],
    edges: [{ source: 'people/real-person', target: 'projects/real-project' }],
  };

  const demo = buildDemoGraph(graph, 'seed-a');
  assert.notEqual(demo.nodes[0].title, graph.nodes[0].title);
  assert.notEqual(demo.nodes[1].title, graph.nodes[1].title);
  assert.match(demo.nodes[0].title, /^[A-Z][a-z]+ [A-Z][a-z]+$/);
  assert.match(demo.nodes[1].title, /^Project|[A-Z][a-z]+/);
  assert.deepEqual(demo.edges, graph.edges);
  assert.equal(buildDemoGraph(graph, 'seed-a').nodes[0].title, demo.nodes[0].title);
  assert.notEqual(buildDemoGraph(graph, 'seed-b').nodes[0].title, demo.nodes[0].title);
});

test('demo tasks remove assignees and provide safe task copy', () => {
  const tasks = [{ slug: 'tasks/real-task', title: 'Real Task', status: 'in_progress', assignees: [{ name: 'Real Person' }] }];
  const demo = buildDemoTasks(tasks, 'seed-a');
  assert.equal(demo.length, 1);
  assert.notEqual(demo[0].title, tasks[0].title);
  assert.deepEqual(demo[0].assignees, []);
  assert.doesNotMatch(demo[0].markdown, /Real Task|Real Person/);
  assert.equal(buildDemoTaskSections([{ heading: 'Today', items: tasks }], 'seed-a')[0].items[0].title, demo[0].title);
});

test('demo page previews use type-specific synthetic templates without links', () => {
  const preview = buildDemoPagePreview({ slug: 'people/real-person', title: 'Real Person', type: 'people' }, 'seed-a');
  assert.equal(preview.status, 'ready');
  assert.equal(preview.demo, true);
  assert.equal(preview.slug, 'people/real-person');
  assert.notEqual(preview.title, 'Real Person');
  assert.match(preview.summary, /fictional contact/i);
  assert.match(preview.markdown, /Example collaborator/);
  assert.deepEqual(preview.links, { outgoing: [], backlinks: [] });
  assert.doesNotMatch(preview.path, /real-person/);
  assert.equal(demoTitleForNode({ slug: 'people/real-person', type: 'people' }, 'seed-a'), preview.title);
});

test('demo explorer masks file names and file previews', () => {
  const explorer = buildDemoExplorer({
    root: {
      type: 'directory',
      path: '',
      name: 'brain',
      children: [{ type: 'directory', path: 'people', name: 'people', children: [{ type: 'file', path: 'people/real-person.md', name: 'real-person.md', kind: 'markdown' }] }],
    },
    recent: { files: [{ type: 'file', path: 'projects/real-project.md', name: 'real-project.md', kind: 'markdown' }] },
  }, 'seed-a');
  assert.notEqual(explorer.root.children[0].children[0].name, 'real-person.md');
  assert.notEqual(explorer.recent.files[0].name, 'real-project.md');
  const file = buildDemoExplorerFile('people/real-person.md', { kind: 'markdown' }, 'seed-a');
  assert.equal(file.demo, true);
  assert.equal(file.kind, 'markdown');
  assert.doesNotMatch(file.path, /real-person/);
  assert.doesNotMatch(file.text, /real-person|Real Person/i);
  assert.equal(file.blob_url, null);
});

test('dashboard exposes Demo mode as a persistent graph setting and privacy boundary', async () => {
  const main = await fs.readFile(new URL('../../src/dashboard-client/main.jsx', import.meta.url), 'utf8');
  assert.match(main, /saved\.demoMode/);
  assert.match(main, /localStorage\.setItem\('bigbrain:graph-preferences'/);
  assert.match(main, /role="switch"[\s\S]*aria-checked=\{demoMode\}/);
  assert.match(main, /if \(demoModeRef\.current\) \{[\s\S]*buildDemoPagePreview/);
  assert.match(main, /!preview\?\.demo/);
});
