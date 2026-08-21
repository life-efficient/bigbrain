import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  buildJarvisLayout,
  buildNeuralMeshLayout,
  buildNetworkConstellationLayout,
  buildSignalBloomLayout,
  buildSpaciousConstellationLayout,
} from '../../src/dashboard-client/graph/shared.js';
import { getGraphNodeColor, getUpdatedNodeColor } from '../../src/dashboard-client/graph/colors.js';
import { resolveThemeMode } from '../../src/dashboard-client/graph/theme.js';
import {
  buildVisNetworkFocusUpdates,
  buildVisNetworkNodes,
  findNearestVisNetworkNode,
  getVisNetworkLabelSlugs,
  seedVisNetworkNodePosition,
} from '../../src/dashboard-client/graph/vis-network-data.js';
import { deriveGraphMotion, graphPayloadsEqual } from '../../src/dashboard-client/graph/live-graph.js';

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

test('vis network honors graph color, node style, and label settings', () => {
  const nodes = Array.from({ length: 8 }, (_, index) => ({
    slug: `projects/node-${index}`,
    title: `Node ${index}`,
    type: index % 2 ? 'people' : 'projects',
    degree: index,
  }));
  const theme = { graphNodeStroke: '#123456' };

  const styledNodes = buildVisNetworkNodes(nodes, { colorMode: 'type', nodeStyle: 'hex', theme });
  assert.equal(styledNodes.every((node) => node.label === ''), true);
  assert.equal(styledNodes.every((node) => node.shape === 'hexagon'), true);
  assert.equal(styledNodes[0].color.background, '#b8c0ff');
  assert.equal(styledNodes[1].color.background, '#8ecae6');

  const noColors = buildVisNetworkNodes(nodes, { colorMode: 'none', nodeStyle: 'diamond', theme });
  assert.equal(noColors.every((node) => node.shape === 'diamond'), true);
  assert.equal(noColors.every((node) => node.color === undefined), true);
  assert.equal(noColors.every((node) => !Object.hasOwn(node, 'group')), true);

  const keyLabels = getVisNetworkLabelSlugs(nodes, 'selected');
  assert.equal(keyLabels.size, 6);
  assert.equal(keyLabels.has('projects/node-7'), true);
  assert.equal(keyLabels.has('projects/node-0'), false);
});

test('vis network proximity targeting uses a forgiving screen-space radius', () => {
  const positions = {
    'projects/near': { x: 100, y: 100 },
    'projects/closer': { x: 105, y: 100 },
    'projects/far': { x: 220, y: 220 },
  };

  assert.equal(findNearestVisNetworkNode({ x: 103, y: 100 }, positions), 'projects/closer');
  assert.equal(findNearestVisNetworkNode({ x: 133, y: 100 }, positions), 'projects/closer');
  assert.equal(findNearestVisNetworkNode({ x: 134, y: 100 }, positions), null);
});

test('new vis network nodes enter beside connected knowledge without moving the settled graph', () => {
  const seeded = seedVisNetworkNodePosition('projects/new', [
    { source: 'projects/new', target: 'people/alice' },
    { source: 'projects/new', target: 'people/bob' },
  ], {
    'people/alice': { x: 80, y: 90 },
    'people/bob': { x: 120, y: 110 },
  });

  assert.equal(Math.hypot(seeded.x - 100, seeded.y - 100) < 33, true);
  assert.equal(Number.isFinite(seeded.x), true);
  assert.equal(Number.isFinite(seeded.y), true);
});

test('confirmed graph refreshes identify created and updated pages for live motion', () => {
  const before = { nodes: [{ slug: 'people/alice', updated_at: '2026-08-20T10:00:00Z', degree: 1 }] };
  const after = { nodes: [
    { slug: 'people/alice', updated_at: '2026-08-22T10:00:00Z', degree: 1 },
    { slug: 'projects/relay', updated_at: '2026-08-22T10:00:00Z', degree: 1 },
  ] };
  const motion = deriveGraphMotion(before, after, [{ id: '42', slug: 'projects/relay', kind: 'created' }]);

  assert.equal(motion.id, '42');
  assert.deepEqual(motion.changes, [
    { slug: 'people/alice', kind: 'updated' },
    { slug: 'projects/relay', kind: 'created' },
  ]);

  const linkedOnly = deriveGraphMotion(
    { nodes: [{ slug: 'projects/jarvis', updated_at: '2026-08-22T10:00:00Z', degree: 1 }] },
    { nodes: [{ slug: 'projects/jarvis', updated_at: '2026-08-22T10:00:00Z', degree: 2 }] },
    [],
  );
  assert.deepEqual(linkedOnly.changes, []);
});

test('unchanged graph refreshes do not restart vis network stabilization', async () => {
  const graph = {
    nodes: [{ slug: 'projects/jarvis', updated_at: '2026-08-22T10:00:00Z', degree: 1 }],
    edges: [],
    activity: [{ day: '2026-08-22', count: 1 }],
  };
  assert.equal(graphPayloadsEqual(graph, structuredClone(graph)), true);
  assert.equal(graphPayloadsEqual(graph, { ...graph, edges: [{ source: 'a', target: 'b' }] }), false);

  const visualizer = await fs.readFile(new URL('../../src/dashboard-client/graph/vis-network-visualizer.jsx', import.meta.url), 'utf8');
  assert.match(visualizer, /skipNextGraphSyncRef\.current = true/);
  assert.match(visualizer, /skipNextActiveSyncRef\.current = true/);
});

test('vis network focus emphasizes one-hop relationships and mutes the rest', () => {
  const nodes = ['a', 'b', 'c'].map((slug) => ({ slug }));
  const edges = [{ source: 'a', target: 'b' }];
  const theme = { graphEdge: '#111111', graphEdgeStrong: '#ffffff' };
  const focus = buildVisNetworkFocusUpdates(nodes, edges, 'a', theme);

  assert.deepEqual(focus.nodes.map((node) => node.opacity), [1, 0.86, 0.18]);
  assert.equal(focus.edges[0].color.opacity, 0.95);

  const missing = buildVisNetworkFocusUpdates(nodes, edges, 'missing', theme);
  assert.deepEqual(missing.nodes.map((node) => node.opacity), [1, 1, 1]);
  assert.equal(missing.edges[0].color.opacity, 1);
});

test('graph label and node controls remain available in the graph style menu', async () => {
  const main = await fs.readFile(new URL('../../src/dashboard-client/main.jsx', import.meta.url), 'utf8');
  const labelsGroup = main.match(/<GraphStyleOptionGroup\s+label="Labels"[\s\S]*?\/>/)?.[0] || '';
  const nodesGroup = main.match(/<GraphStyleOptionGroup\s+label="Node"[\s\S]*?\/>/)?.[0] || '';

  assert.match(labelsGroup, /options=\{GRAPH_LABEL_STYLES\}/);
  assert.doesNotMatch(labelsGroup, /disabled=/);
  assert.match(nodesGroup, /options=\{GRAPH_NODE_STYLES\}/);
  assert.doesNotMatch(nodesGroup, /disabled=/);
});

test('vis network boot and MCP activity animations are bounded and accessible', async () => {
  const [visualizer, dashboard, main] = await Promise.all([
    fs.readFile(new URL('../../src/dashboard-client/graph/vis-network-visualizer.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/bigbrain/dashboard.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/main.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(visualizer, /stabilizationIterationsDone[\s\S]*network\.once\('animationFinished'/);
  assert.match(visualizer, /vis-network-boot-overlay" aria-hidden="true"/);
  assert.match(visualizer, /MCP CREATE/);
  assert.match(dashboard, /@media \(prefers-reduced-motion: reduce\)[\s\S]*vis-network-boot-overlay/);
  assert.doesNotMatch(dashboard.match(/\.vis-network-boot-overlay[\s\S]*?\.futuristic-graph/)?.[0] || '', /infinite/);
  assert.match(main, /new EventSource\('\/api\/graph\/events'\)/);
});

test('vis network transforms frozen geometry instead of redrawing it during camera gestures', async () => {
  const [visualizer, dashboard] = await Promise.all([
    fs.readFile(new URL('../../src/dashboard-client/graph/vis-network-visualizer.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/bigbrain/dashboard.js', import.meta.url), 'utf8'),
  ]);

  assert.match(visualizer, /dragView: false/);
  assert.match(visualizer, /zoomView: false/);
  assert.match(visualizer, /translate3d\(\$\{translateX\}px, \$\{translateY\}px, 0\) scale\(\$\{ratio\}\)/);
  assert.match(visualizer, /network\.moveTo\(\{ position: next\.position, scale: next\.scale, animation: false \}\)/);
  assert.doesNotMatch(visualizer, /network\.on\('afterDrawing'/);
  assert.match(visualizer, /vis-network-camera-moving/);
  assert.match(visualizer, /if \(cameraMoving\) return/);
  assert.match(dashboard, /\.vis-network-camera-moving \.vis-network-label-layer \{ opacity: 0/);
  assert.doesNotMatch(dashboard.match(/\.vis-network-surface \{[\s\S]*?\.vis-network-label-layer/)?.[0] || '', /filter:/);
});

test('graph layouts safely handle empty and single-node graphs', () => {
  const empty = { nodes: [], edges: [] };
  const single = {
    nodes: [{ slug: 'projects/bigbrain', title: 'BigBrain', type: 'projects', degree: 0 }],
    edges: [],
  };

  for (const builder of [buildJarvisLayout, buildNeuralMeshLayout, buildSignalBloomLayout, buildSpaciousConstellationLayout, buildNetworkConstellationLayout]) {
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

  for (const builder of [buildJarvisLayout, buildNeuralMeshLayout, buildSignalBloomLayout, buildSpaciousConstellationLayout, buildNetworkConstellationLayout]) {
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

test('network constellation preserves relationship clusters and places isolates on one outer rim', () => {
  const nodes = [
    ...Array.from({ length: 18 }, (_, index) => ({
      slug: `connected/node-${index}`,
      title: `Connected ${index}`,
      type: 'projects',
      degree: 2,
    })),
    ...Array.from({ length: 12 }, (_, index) => ({
      slug: `isolated/node-${index}`,
      title: `Isolated ${index}`,
      type: 'writing',
      degree: 0,
    })),
  ];
  const edges = Array.from({ length: 18 }, (_, index) => ({
    source: `connected/node-${index}`,
    target: `connected/node-${(index + 1) % 18}`,
  }));
  const layout = buildNetworkConstellationLayout({ nodes, edges });
  const isolates = layout.nodes.filter((node) => node.slug.startsWith('isolated/'));
  const connected = layout.nodes.filter((node) => node.slug.startsWith('connected/'));
  const rimRadii = isolates.map((node) => Math.hypot(
    node.x - layout.orphanRim.x,
    node.y - layout.orphanRim.y,
  ));
  const connectedRadius = Math.max(...connected.map((node) => Math.hypot(
    node.x - layout.orphanRim.x,
    node.y - layout.orphanRim.y,
  )));

  assert.equal(layout.orphanRim.count, isolates.length);
  assert.equal(Math.max(...rimRadii) - Math.min(...rimRadii) < 0.001, true);
  assert.equal(Math.min(...rimRadii) > connectedRadius + 100, true);
});

test('network constellation coordinates are deterministic across input ordering', () => {
  const nodes = Array.from({ length: 40 }, (_, index) => ({
    slug: `pages/node-${index}`,
    title: `Node ${index}`,
    type: index % 3 ? 'projects' : 'people',
    degree: index < 34 ? 3 : 0,
  }));
  const edges = Array.from({ length: 34 }, (_, index) => ({
    source: `pages/node-${index}`,
    target: `pages/node-${(index + 5) % 34}`,
  }));
  const first = buildNetworkConstellationLayout({ nodes, edges });
  const second = buildNetworkConstellationLayout({
    nodes: [...nodes].reverse(),
    edges: [...edges].reverse(),
  });
  const positions = (layout) => Object.fromEntries(layout.nodes.map((node) => [
    node.slug,
    [Number(node.x.toFixed(6)), Number(node.y.toFixed(6))],
  ]));

  assert.deepEqual(positions(first), positions(second));
});

test('network constellation replaces vis network in the selectable renderer registry', async () => {
  const [registry, main] = await Promise.all([
    fs.readFile(new URL('../../src/dashboard-client/graph/registry.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/main.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(registry, /id: 'network-constellation'/);
  assert.doesNotMatch(registry, /VisNetworkVisualizer|id: 'vis-network'/);
  assert.match(main, /saved\.visualizerId === 'vis-network'[\s\S]*network-constellation/);
});
