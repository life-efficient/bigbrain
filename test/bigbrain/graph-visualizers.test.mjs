import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  buildJarvisLayout,
  buildNeuralMeshLayout,
  buildSignalBloomLayout,
  buildSpaciousConstellationLayout,
} from '../../src/dashboard-client/graph/shared.js';
import { getGraphNodeColor, getUpdatedNodeColor } from '../../src/dashboard-client/graph/colors.js';
import { resolveThemeMode } from '../../src/dashboard-client/graph/theme.js';
import { buildVisNetworkNodes, getVisNetworkLabelSlugs } from '../../src/dashboard-client/graph/vis-network-data.js';

test('responsive graph visualizers do not paint letterboxed viewBox backdrops', async () => {
  const sources = await Promise.all([
    'composable-graph-visualizer.jsx',
    'signal-bloom-visualizer.jsx',
    'neural-mesh-visualizer.jsx',
    'jarvis-hud-visualizer.jsx',
  ].map((file) => fs.readFile(new URL(`../../src/dashboard-client/graph/${file}`, import.meta.url), 'utf8')));

  for (const source of sources) {
    assert.doesNotMatch(source, /<rect width=\{laidOut\.width\} height=\{laidOut\.height\}/);
  }
});

test('spacious and signal bloom use larger node and cluster labels without changing the custom baseline', async () => {
  const [core, composable, spacious, bloom, visNetwork] = await Promise.all([
    'visualizer-core.jsx',
    'composable-graph-visualizer.jsx',
    'spacious-constellation-visualizer.jsx',
    'signal-bloom-visualizer.jsx',
    'vis-network-visualizer.jsx',
  ].map((file) => fs.readFile(new URL(`../../src/dashboard-client/graph/${file}`, import.meta.url), 'utf8')));

  assert.match(core, /DEFAULT_GRAPH_LABEL_FONT_SIZE = 11/);
  assert.match(core, /PRESET_GRAPH_LABEL_FONT_SIZE = 18/);
  assert.match(core, /PRESET_GRAPH_CLUSTER_LABEL_FONT_SIZE = 14/);
  assert.match(composable, /fontSize=\{labelFontSize\}/);
  assert.match(spacious, /labelFontSize=\{PRESET_GRAPH_LABEL_FONT_SIZE\}/);
  assert.match(bloom, /fontSize=\{PRESET_GRAPH_LABEL_FONT_SIZE\}/);
  assert.match(bloom, /fontSize=\{PRESET_GRAPH_CLUSTER_LABEL_FONT_SIZE\}/);
  assert.match(visNetwork, /size: PRESET_GRAPH_LABEL_FONT_SIZE/);
});

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

test('vis network honors graph color and label settings', () => {
  const nodes = Array.from({ length: 8 }, (_, index) => ({
    slug: `projects/node-${index}`,
    title: `Node ${index}`,
    type: index % 2 ? 'people' : 'projects',
    degree: index,
  }));
  const theme = { graphNodeStroke: '#123456' };

  const allLabels = buildVisNetworkNodes(nodes, { colorMode: 'type', labelStyle: 'all', theme });
  assert.equal(allLabels.every((node) => node.label), true);
  assert.equal(allLabels[0].color.background, '#b8c0ff');
  assert.equal(allLabels[1].color.background, '#8ecae6');

  const noLabelsOrColors = buildVisNetworkNodes(nodes, { colorMode: 'none', labelStyle: 'off', theme });
  assert.equal(noLabelsOrColors.every((node) => node.label === ''), true);
  assert.equal(noLabelsOrColors.every((node) => !Object.hasOwn(node, 'color')), true);
  assert.equal(noLabelsOrColors.every((node) => !Object.hasOwn(node, 'group')), true);

  const keyLabels = getVisNetworkLabelSlugs(nodes, 'selected');
  assert.equal(keyLabels.size, 6);
  assert.equal(keyLabels.has('projects/node-7'), true);
  assert.equal(keyLabels.has('projects/node-0'), false);
});

test('vis network label controls remain available in the graph style menu', async () => {
  const main = await fs.readFile(new URL('../../src/dashboard-client/main.jsx', import.meta.url), 'utf8');
  const labelsGroup = main.match(/<GraphStyleOptionGroup\s+label="Labels"[\s\S]*?\/>/)?.[0] || '';

  assert.match(labelsGroup, /options=\{GRAPH_LABEL_STYLES\}/);
  assert.doesNotMatch(labelsGroup, /disabled=/);
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

test('relationship layout groups connected pages and prevents node collisions', () => {
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
  for (let i = 0; i < layout.nodes.length; i += 1) {
    for (let j = i + 1; j < layout.nodes.length; j += 1) {
      const a = layout.nodes[i];
      const b = layout.nodes[j];
      assert.equal(Math.hypot(a.x - b.x, a.y - b.y) + 0.5 >= a.radius + b.radius, true);
    }
  }
});

test('spacious layout fits its camera bounds to its natural node positions', () => {
  const nodes = [
    { slug: 'projects/a', title: 'Project A', type: 'projects', degree: 2 },
    { slug: 'people/a', title: 'Person A', type: 'people', degree: 1 },
    { slug: 'projects/b', title: 'Project B', type: 'projects', degree: 2 },
    { slug: 'people/b', title: 'Person B', type: 'people', degree: 1 },
  ];
  const edges = [
    { source: 'projects/a', target: 'people/a' },
    { source: 'projects/b', target: 'people/b' },
  ];
  const layout = buildSpaciousConstellationLayout({ nodes, edges });
  assert.equal(layout.nodes.every((node) => node.x >= 0 && node.x <= layout.width), true);
  assert.equal(layout.nodes.every((node) => node.y >= 0 && node.y <= layout.height), true);
  assert.equal(layout.width < 1280, true);
  assert.equal(layout.height < 920, true);
  assert.equal(layout.clusters.length >= 2, true);
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
    assert.equal(cluster.x - cluster.radius >= 0, true);
    assert.equal(cluster.x + cluster.radius <= layout.width, true);
    assert.equal(cluster.y - cluster.radius >= 0, true);
    assert.equal(cluster.y + cluster.radius <= layout.height, true);
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
