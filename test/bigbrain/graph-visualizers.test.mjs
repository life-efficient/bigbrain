import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildJarvisLayout,
  buildNeuralMeshLayout,
  buildSignalBloomLayout,
  buildSpaciousConstellationLayout,
} from '../../src/dashboard-client/graph/shared.js';
import { getGraphNodeColor, getUpdatedNodeColor } from '../../src/dashboard-client/graph/colors.js';
import { resolveThemeMode } from '../../src/dashboard-client/graph/theme.js';

test('resolveThemeMode respects auto and manual modes', () => {
  assert.equal(resolveThemeMode('auto', true), 'dark');
  assert.equal(resolveThemeMode('auto', false), 'light');
  assert.equal(resolveThemeMode('dark', false), 'dark');
  assert.equal(resolveThemeMode('light', true), 'light');
});

test('updated node colors use acid green on a five-day eased scale', () => {
  const now = Date.parse('2026-06-21T12:00:00.000Z');

  assert.equal(getUpdatedNodeColor('2026-06-21T12:00:00.000Z', now), '#00FF66');
  assert.equal(getUpdatedNodeColor('2026-06-16T12:00:00.000Z', now), '#FFFFFF');
  assert.equal(getUpdatedNodeColor(null, now), '#FFFFFF');

  const midpoint = getUpdatedNodeColor('2026-06-18T12:00:00.000Z', now);
  assert.match(midpoint, /^#[0-9A-F]{6}$/);
  assert.notEqual(midpoint, '#00FF66');
  assert.notEqual(midpoint, '#FFFFFF');
});

test('none graph color mode leaves node color unmodified', () => {
  assert.equal(getGraphNodeColor({
    type: 'projects',
    updated_at: '2026-06-21T12:00:00.000Z',
  }, 'none'), null);
});

test('graph layouts safely handle empty and single-node graphs', () => {
  const empty = { nodes: [], edges: [] };
  const single = {
    nodes: [{ slug: 'projects/bigbrain', title: 'BigBrain', type: 'projects', degree: 0 }],
    edges: [],
  };

  for (const builder of [buildJarvisLayout, buildNeuralMeshLayout, buildSignalBloomLayout, buildSpaciousConstellationLayout]) {
    const emptyLayout = builder(empty);
    assert.equal(emptyLayout.nodes.length, 0);
    assert.equal(emptyLayout.edges.length, 0);

    const singleLayout = builder(single);
    assert.equal(singleLayout.nodes.length, 1);
    assert.equal(singleLayout.edges.length, 0);
    assert.equal(Number.isFinite(singleLayout.nodes[0].x), true);
    assert.equal(Number.isFinite(singleLayout.nodes[0].y), true);
  }
});

test('graph layouts preserve dense graph structure within bounds', () => {
  const nodes = Array.from({ length: 24 }, (_, index) => ({
    slug: `projects/node-${index}`,
    title: `Node ${index}`,
    type: index % 2 === 0 ? 'projects' : 'people',
    degree: 8 + (index % 5),
  }));
  const edges = [];
  for (let index = 0; index < nodes.length; index += 1) {
    edges.push({ source: nodes[index].slug, target: nodes[(index + 1) % nodes.length].slug });
    edges.push({ source: nodes[index].slug, target: nodes[(index + 5) % nodes.length].slug });
  }
  const graph = { nodes, edges };

  for (const builder of [buildJarvisLayout, buildNeuralMeshLayout, buildSignalBloomLayout, buildSpaciousConstellationLayout]) {
    const layout = builder(graph);
    assert.equal(layout.nodes.length, nodes.length);
    assert.equal(layout.edges.length, edges.length);
    for (const node of layout.nodes) {
      assert.equal(node.x >= 0 && node.x <= layout.width, true);
      assert.equal(node.y >= 0 && node.y <= layout.height, true);
    }
  }
});

test('spacious constellation expands dense brains and prevents node collisions', () => {
  const nodes = Array.from({ length: 320 }, (_, index) => ({
    slug: `pages/node-${index}`,
    title: `Node ${index}`,
    type: index % 4 === 0 ? 'people' : 'pages',
    degree: 3 + (index % 12),
  }));
  const edges = nodes.flatMap((node, index) => [
    { source: node.slug, target: nodes[(index + 1) % nodes.length].slug },
    { source: node.slug, target: nodes[(index + 17) % nodes.length].slug },
  ]);
  const layout = buildSpaciousConstellationLayout({ nodes, edges });

  assert.equal(layout.width > 1280, true);
  assert.equal(layout.height > 920, true);
  for (let i = 0; i < layout.nodes.length; i += 1) {
    for (let j = i + 1; j < layout.nodes.length; j += 1) {
      const a = layout.nodes[i];
      const b = layout.nodes[j];
      assert.equal(Math.hypot(a.x - b.x, a.y - b.y) + 0.5 >= a.radius + b.radius + 22, true);
    }
  }
});

test('signal bloom keeps small type clusters compact and non-overlapping', () => {
  const graph = {
    nodes: [
      { slug: 'people/alex', title: 'Alex', type: 'people', degree: 8 },
      { slug: 'people/blair', title: 'Blair', type: 'people', degree: 6 },
      { slug: 'projects/bigbrain', title: 'BigBrain', type: 'projects', degree: 7 },
      { slug: 'projects/jarvis', title: 'Jarvis', type: 'projects', degree: 5 },
      { slug: 'organizations/acme', title: 'Acme', type: 'organizations', degree: 6 },
      { slug: 'organizations/zenith', title: 'Zenith', type: 'organizations', degree: 4 },
    ],
    edges: [],
  };

  const layout = buildSignalBloomLayout(graph);

  for (const cluster of layout.clusters) {
    assert.equal(cluster.radius < 70, true);
    const distanceFromCenter = Math.hypot(cluster.x - layout.centerX, cluster.y - layout.centerY);
    assert.equal(distanceFromCenter < 240, true);
  }

  for (let i = 0; i < layout.nodes.length; i += 1) {
    for (let j = i + 1; j < layout.nodes.length; j += 1) {
      const a = layout.nodes[i];
      const b = layout.nodes[j];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      assert.equal(distance + 0.5 >= a.radius + b.radius + 16, true);
    }
  }
});
