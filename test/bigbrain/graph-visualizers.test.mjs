import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  buildJarvisLayout,
  buildNeuralMeshLayout,
  buildNetworkConstellationLayout,
  buildSignalBloomLayout,
  buildSpaciousConstellationLayout,
  normalizeGraph,
} from '../../src/dashboard-client/graph/shared.js';
import {
  getGraphColorPalette,
  getGraphNodeColor,
  getUpdatedNodeColor,
  GRAPH_DEFAULT_PALETTE_ID,
  GRAPH_COLOR_PALETTE_OPTIONS,
  sanitizeGraphTypeColors,
  TYPE_ORDER,
} from '../../src/dashboard-client/graph/colors.js';
import { resolveThemeMode } from '../../src/dashboard-client/graph/theme.js';
import { graphTypeIconSvg } from '../../src/dashboard-client/graph/graph-type-icon-data.js';
import { blendArcColors, GRAPH_ARC_ANIMATIONS, startArcAnimation } from '../../src/dashboard-client/graph/arc-animation.js';
import {
  GRAPH_FALLBACK_ICON_NAMES,
  GRAPH_TYPE_ICON_NAMES,
  getGraphTypeIconName,
} from '../../src/dashboard-client/graph/type-icons.js';
import {
  buildVisNetworkFocusUpdates,
  buildVisNetworkNodes,
  findNearestVisNetworkNode,
  getVisNetworkLabelSlugs,
  seedVisNetworkNodePosition,
} from '../../src/dashboard-client/graph/vis-network-data.js';
import {
  deriveGraphMotion,
  graphPayloadsEqual,
} from '../../src/dashboard-client/graph/live-graph.js';
import {
  GRAPH_MEMBERSHIP_TRANSITION_MS,
  graphTransitionProgress,
  prepareGraphTransitionData,
} from '../../src/dashboard-client/graph/graph-transition.js';
import { prepareForceGraphData } from '../../src/dashboard-client/graph/force-graph-data.js';
import {
  GRAPH_NODE_SIZES,
  getGraphNodeConnectionScale,
  getGraphNodeScreenScale,
  getGraphNodeSizeScale,
  getGraphNodeTransformScale,
  getGraphNodeZoomMultiplier,
} from '../../src/dashboard-client/graph/node-sizes.js';
import {
  buildFocusedNetworkGraph,
  normalizeFocusedGraphSlug,
} from '../../src/dashboard-client/graph/focused-network-data.js';
import { buildFocusedSubgraphGraph } from '../../src/dashboard-client/graph/focused-subgraph-data.js';
import { layoutGraphScreenLabels } from '../../src/dashboard-client/graph/screen-label-layout.js';

test('screen-fixed graph labels keep the focus anchored and separate nearby neighbors', () => {
  const labels = layoutGraphScreenLabels([
    { slug: 'focus', x: 100, y: 90, width: 95, height: 24, focus: true },
    { slug: 'neighbor-a', x: 105, y: 92, width: 95, height: 24 },
    { slug: 'neighbor-b', x: 104, y: 94, width: 95, height: 24 },
  ], { width: 400, height: 250 });
  assert.deepEqual(labels[0], { slug: 'focus', left: 112, top: 90 });
  for (let index = 0; index < labels.length; index += 1) {
    for (let other = index + 1; other < labels.length; other += 1) {
      const left = labels[index];
      const right = labels[other];
      assert.ok(Math.abs(left.top - right.top) >= 24 || Math.abs(left.left - right.left) >= 95);
    }
  }
});

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

test('focused network canonicalizes cyclical lineage and keeps only upstream edges', () => {
  const graph = {
    nodes: [
      { slug: 'people/focus', title: 'Focus' },
      { slug: 'projects/gpu', title: 'GPU' },
      { slug: 'projects/cpu', title: 'CPU' },
      { slug: 'concepts/shared', title: 'Shared' },
    ],
    edges: [
      { source: 'people/focus', target: 'projects/gpu' },
      { source: 'projects/gpu', target: 'people/focus.md' },
      { source: 'projects/cpu', target: 'people/focus' },
      { source: 'concepts/shared', target: 'projects/gpu' },
      { source: 'concepts/shared', target: 'projects/cpu' },
    ],
  };
  const network = buildFocusedNetworkGraph(graph, {
    page: { slug: 'people/focus.md', title: 'Focus' },
    backlinks: [{ from_slug: 'projects/cpu.md' }],
    link_events: [{
      from_page: 'people/focus.md',
      to_page: 'projects/gpu.md',
      timestamp: '2026-09-01T10:00:00Z',
    }],
  }, 'people/focus.md');

  assert.equal(normalizeFocusedGraphSlug('/people/focus.md'), 'people/focus');
  assert.equal(network.nodes.filter((node) => node.slug === 'people/focus').length, 1);
  assert.deepEqual(network.nodes.map((node) => node.slug).sort(), [
    'concepts/shared',
    'people/focus',
    'projects/cpu',
    'projects/gpu',
  ]);
  assert.equal(network.edges.some((edge) => edge.source === 'people/focus'), false);
  assert.deepEqual(network.edges.map((edge) => `${edge.source}:${edge.target}`).sort(), [
    'concepts/shared:projects/cpu',
    'concepts/shared:projects/gpu',
    'projects/cpu:people/focus',
    'projects/gpu:people/focus',
  ]);
  assert.equal(network.meta.focused_slug, 'people/focus');
});

test('focused subgraph includes outgoing links and incoming backlinks for the selected page', () => {
  const graph = {
    nodes: [
      { slug: 'people/focus', title: 'Focus' },
      { slug: 'projects/outgoing', title: 'Outgoing' },
      { slug: 'projects/incoming', title: 'Incoming' },
    ],
    edges: [
      { source: 'people/focus', target: 'projects/outgoing' },
    ],
  };
  const lineage = {
    page: { slug: 'people/focus.md', title: 'Focus', type: 'people' },
    outgoing: [{ to_slug: 'projects/outgoing', is_resolved: 1 }],
    backlinks: [{ from_slug: 'projects/incoming' }],
    link_events: [],
  };

  const subgraph = buildFocusedSubgraphGraph(graph, lineage, 'people/focus.md');
  assert.deepEqual(subgraph.nodes.map((node) => node.slug).sort(), [
    'people/focus',
    'projects/incoming',
    'projects/outgoing',
  ]);
  assert.deepEqual(subgraph.edges.map((edge) => `${edge.source}:${edge.target}`).sort(), [
    'people/focus:projects/outgoing',
    'projects/incoming:people/focus',
  ]);

  const backlinkOnly = buildFocusedSubgraphGraph({
    nodes: [
      { slug: 'people/focus', title: 'Focus' },
      { slug: 'projects/incoming', title: 'Incoming' },
    ],
    edges: [],
  }, {
    page: { slug: 'people/focus', title: 'Focus', type: 'people' },
    outgoing: [],
    backlinks: [{ from_slug: 'projects/incoming' }],
    link_events: [],
  }, 'people/focus');
  assert.deepEqual(backlinkOnly.edges.map((edge) => `${edge.source}:${edge.target}`), [
    'projects/incoming:people/focus',
  ]);
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

test('arc hover animation modes expose the shared four-state contract', () => {
  assert.deepEqual(GRAPH_ARC_ANIMATIONS.map(({ id, label }) => [id, label]), [
    ['none', 'None'],
    ['instant', 'Instant'],
    ['grow', 'Grow'],
    ['shoot', 'Shoot'],
  ]);
  assert.equal(blendArcColors('#000000', '#FFFFFF', 0.5), '#808080');
});

test('arc animation can settle without replaying during renderer synchronization', () => {
  const state = startArcAnimation({}, 'shoot', new Set(['link']), null, { play: false });

  assert.equal(state.progress, 1);
  assert.equal(state.frame, 0);
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

test('graph palettes provide technical presets and editable type colors', () => {
  assert.equal(GRAPH_DEFAULT_PALETTE_ID, 'crimson-loom');
  assert.deepEqual(GRAPH_COLOR_PALETTE_OPTIONS.map(({ id }) => id), ['crimson-loom', 'kusama', 'irezumi', 'red-tiger', 'urban', 'jarvis', 'terminal', 'cobalt', 'soft', 'neural-lumen', 'thermal', 'desert', 'arctic', 'woodland', 'digital', 'blue-tiger', 'fall', 'spectral', 'aegis', 'inferno', 'frostveil', 'cherry-blossom', 'custom']);
  assert.equal(getGraphColorPalette('jarvis').people, '#00E5FF');
  assert.equal(getGraphColorPalette('crimson-loom').people, '#1769B0');
  assert.equal(getGraphColorPalette('crimson-loom').deals, '#D68724');
  assert.equal(Object.keys(getGraphColorPalette('crimson-loom')).length, TYPE_ORDER.length);
  assert.equal(getGraphColorPalette('neural-lumen').people, '#58D7FF');
  assert.equal(getGraphColorPalette('neural-lumen').deals, '#F6D365');
  assert.equal(Object.keys(getGraphColorPalette('neural-lumen')).length, TYPE_ORDER.length);
  assert.equal(getGraphColorPalette('thermal').people, '#00B8FF');
  assert.equal(getGraphColorPalette('thermal').deals, '#FFEA00');
  assert.equal(Object.keys(getGraphColorPalette('thermal')).length, TYPE_ORDER.length);
  assert.equal(getGraphColorPalette('irezumi').people, '#47BFC0');
  assert.equal(getGraphColorPalette('irezumi').deals, '#D9952F');
  assert.equal(Object.keys(getGraphColorPalette('irezumi')).length, TYPE_ORDER.length);
  for (const paletteId of ['desert', 'arctic', 'woodland', 'digital', 'urban', 'blue-tiger', 'red-tiger', 'fall']) {
    assert.equal(Object.keys(getGraphColorPalette(paletteId)).length, TYPE_ORDER.length);
  }
  assert.equal(getGraphColorPalette('blue-tiger').people, '#839CC5');
  assert.equal(getGraphColorPalette('red-tiger').people, '#D65A54');
  assert.equal(getGraphColorPalette('spectral').people, '#B9DDE1');
  assert.equal(getGraphColorPalette('spectral').deals, '#A48C6A');
  assert.equal(Object.keys(getGraphColorPalette('spectral')).length, TYPE_ORDER.length);
  assert.equal(getGraphColorPalette('aegis').people, '#D9E0E4');
  assert.equal(getGraphColorPalette('aegis').deals, '#C6A45B');
  assert.equal(Object.keys(getGraphColorPalette('aegis')).length, TYPE_ORDER.length);
  assert.equal(getGraphColorPalette('inferno').people, '#FF6A2A');
  assert.equal(getGraphColorPalette('inferno').deals, '#FFB12B');
  assert.equal(Object.keys(getGraphColorPalette('inferno')).length, TYPE_ORDER.length);
  assert.equal(getGraphColorPalette('frostveil').people, '#B8E2F2');
  assert.equal(getGraphColorPalette('frostveil').deals, '#B7A277');
  assert.equal(Object.keys(getGraphColorPalette('frostveil')).length, TYPE_ORDER.length);
  assert.equal(getGraphColorPalette('cherry-blossom').people, '#8FBCE8');
  assert.equal(getGraphColorPalette('cherry-blossom').deals, '#D8A84E');
  assert.equal(Object.keys(getGraphColorPalette('cherry-blossom')).length, TYPE_ORDER.length);
  assert.equal(getGraphColorPalette('kusama').people, '#13BDEB');
  assert.equal(getGraphColorPalette('kusama').deals, '#FFD21F');
  assert.equal(Object.keys(getGraphColorPalette('kusama')).length, TYPE_ORDER.length);
  assert.equal(typeof getGraphColorPalette('crimson-loom').components, 'string');
  assert.equal(typeof getGraphColorPalette('crimson-loom').products, 'string');
  assert.equal(typeof getGraphColorPalette('crimson-loom').processes, 'string');
  assert.equal(getGraphNodeColor({ type: 'people' }, 'type', { people: '#123456' }), '#123456');

  const colors = sanitizeGraphTypeColors({ people: '#abc123', deals: 'invalid' }, getGraphColorPalette('jarvis'));
  assert.equal(colors.people, '#ABC123');
  assert.equal(colors.deals, getGraphColorPalette('jarvis').deals);
});

test('vis network honors graph color, node shape, and label settings', () => {
  const nodes = Array.from({ length: 8 }, (_, index) => ({
    slug: `projects/node-${index}`,
    title: `Node ${index}`,
    type: index % 2 ? 'people' : 'projects',
    degree: index,
  }));
  const theme = { graphNodeStroke: '#123456' };

  const styledNodes = buildVisNetworkNodes(nodes, {
    colorMode: 'type',
    nodeShape: 'hex',
    typeColors: { projects: '#123456', people: '#ABCDEF' },
    theme,
  });
  assert.equal(styledNodes.every((node) => node.label === ''), true);
  assert.equal(styledNodes.every((node) => node.shape === 'hexagon'), true);
  assert.equal(styledNodes[0].color.background, '#123456');
  assert.equal(styledNodes[1].color.background, '#ABCDEF');

  const noColors = buildVisNetworkNodes(nodes, { colorMode: 'none', nodeShape: 'diamond', theme });
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

test('graph membership transitions visibly enter, exit, and reverse during a scrub', () => {
  const startTime = 10_000;
  const original = {
    nodes: [
      { id: 'old', slug: 'old' },
      { id: 'stays', slug: 'stays' },
    ],
    links: [{ id: 'old:stays', source: 'old', target: 'stays' }],
  };
  const earlier = {
    nodes: [{ id: 'stays', slug: 'stays' }],
    links: [],
  };
  const exiting = prepareGraphTransitionData(original, earlier, startTime);
  const exitingNode = exiting.displayData.nodes.find((node) => node.id === 'old');
  assert.equal(exiting.displayData.nodes.length, 2);
  assert.equal(exiting.displayData.links.length, 1);
  assert.equal(graphTransitionProgress(exitingNode, startTime), 1);
  assert.ok(graphTransitionProgress(exitingNode, startTime + GRAPH_MEMBERSHIP_TRANSITION_MS / 2) < 1);

  const later = {
    nodes: [
      { id: 'old', slug: 'old' },
      { id: 'stays', slug: 'stays' },
    ],
    links: [{ id: 'old:stays', source: 'old', target: 'stays' }],
  };
  const exitProgress = graphTransitionProgress(exitingNode, startTime + 120);
  const reversing = prepareGraphTransitionData(exiting.displayData, later, startTime + 120);
  const returningNode = reversing.displayData.nodes.find((node) => node.id === 'old');
  assert.equal(reversing.displayData.nodes.length, 2);
  assert.equal(graphTransitionProgress(returningNode, startTime + 120), exitProgress);
  assert.ok(graphTransitionProgress(returningNode, startTime + 120 + GRAPH_MEMBERSHIP_TRANSITION_MS / 2) > exitProgress);
});

test('force graph snapshots isolate links and keep endpoints as node ids', () => {
  const source = { id: 'pages/source', slug: 'pages/source', x: 10 };
  const target = { id: 'pages/target', slug: 'pages/target', y: 20 };
  const link = { id: 'source-target', source, target, color: '#fff' };
  const snapshot = prepareForceGraphData({ nodes: [source, target], links: [link] });

  assert.notEqual(snapshot.links[0], link);
  assert.equal(snapshot.links[0].source, source.id);
  assert.equal(snapshot.links[0].target, target.id);
  assert.equal(link.source, source);
  assert.equal(link.target, target);
});

test('force renderers focus eligible live page changes without remounting', async () => {
  const [main, force2d, force3d] = await Promise.all([
    fs.readFile(new URL('../../src/dashboard-client/main.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/graph/force-graph-2d-visualizer.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/graph/force-graph-3d-visualizer.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(main, /graphMotionEligibleRef\.current = view === 'graph' && !preview && !lineage/);
  assert.match(main, /if \(activityIndex >= 0 \|\| focusSlug\) return;\s*consumedMotionEventRef\.current = motionEvent;/);
  assert.match(main, /motionEvent=\{eligibleMotionEvent\}/);
  assert.match(main, /onBackgroundClick=\{onLineageClose\}/);
  assert.match(main, /visualizerRef\.current\?\.focusNode\?\.\(focusSlug\)/);
  assert.match(force2d, /focusNode\(slug\)/);
  assert.match(force3d, /focusForceGraphNodeBySlug\(graphRef\.current, slug\)/);
  assert.match(force2d, /forceGraph\.centerAt\(latestNode\.x, latestNode\.y, 850\)\.zoom\(/);
  assert.match(force2d, /forceGraph\.centerAt\(node\.x, node\.y, 850\)\.zoom\(/);
  assert.match(force3d, /forceGraph\.cameraPosition\(position, target, 850\)/);
  assert.match(force3d, /focusForceGraphNode\(forceGraph, node\)/);
  assert.match(force3d, /rotationPauseUntilRef\.current = Number\.POSITIVE_INFINITY/);
  assert.match(force2d, /SYSTEM_FOCUS_HOLD_DURATION = 5000/);
  assert.match(force3d, /SYSTEM_FOCUS_HOLD_DURATION = 5000/);
  assert.match(force2d, /SYSTEM_ACTIVITY_PREFOCUS_DURATION = 1200/);
  assert.match(force3d, /SYSTEM_ACTIVITY_PREFOCUS_DURATION = 1200/);
  assert.match(force2d, /updateForceGraphActivity\(forceGraph, data, \[target\.slug\]/);
  assert.match(force3d, /updateForceGraphActivity\(forceGraph, data, \[target\.slug\]/);
  assert.match(main, /const forceSourceNodes = activityFilteredNodes/);
  assert.doesNotMatch(force2d, /scheduleForceGraphReheat|forceGraph\.d3ReheatSimulation\?\.\(\)/);
  assert.doesNotMatch(force3d, /scheduleForceGraphReheat|forceGraph\.d3ReheatSimulation\?\.\(\)/);
  assert.match(force2d, /startGraphTransitionLoop/);
  assert.match(force3d, /startGraphTransitionLoop/);
  assert.match(force2d, /graphTransitionActive\(node\)/);
  assert.match(force3d, /graphTransitionActive\(node\)/);
  assert.match(force2d, /graphTransitionProgress\(node\)/);
  assert.match(force3d, /graphTransitionProgress\(node\)/);
  assert.doesNotMatch(force2d, /buildInitialGraphRevealStages|startInitialGraphReveal/);
  assert.doesNotMatch(force3d, /buildInitialGraphRevealStages|startInitialGraphReveal/);
  assert.match(force2d, /const transitioned = hadGraphData\s*\?\s*prepareGraphTransitionData/);
  assert.match(force3d, /const transitioned = hadGraphData\s*\?\s*prepareGraphTransitionData/);
  for (const renderer of [force2d, force3d]) {
    assert.match(renderer, /fitOnGraphChange = false/);
    assert.match(renderer, /fitAfterUpdate: fitOnGraphChange \|\| !forceGraph\.__bigBrainInitialized/);
  }
  assert.match(force2d, /__bigBrainInitialFadeElement/);
  assert.match(force3d, /__bigBrainInitialFadeElement/);
  assert.match(force2d, /__bigBrainInitialFadeContainer\?\.querySelector\('canvas'\)/);
  assert.match(force3d, /__bigBrainInitialFadeContainer\?\.querySelector\('canvas'\)/);
  assert.match(force2d, /prepareForceGraphInitialFade\(forceGraph\)/);
  assert.match(force3d, /prepareForceGraphInitialFade\(forceGraph\)/);
  assert.match(force2d, /startForceGraphInitialFade\(forceGraph\)/);
  assert.match(force3d, /startForceGraphInitialFade\(forceGraph\)/);
  assert.match(force2d, /classList\.add\('force-graph-canvas-initial-fade-visible'\)/);
  assert.match(force3d, /classList\.add\('force-graph-canvas-initial-fade-visible'\)/);
  assert.match(force2d, /\.backgroundColor\('rgba\(0,0,0,0\)'\)/);
  assert.match(force3d, /\.backgroundColor\('rgba\(0,0,0,0\)'\)/);
  assert.doesNotMatch(force2d, /\.backgroundColor\('transparent'\)/);
  assert.doesNotMatch(force3d, /\.backgroundColor\('transparent'\)/);
  assert.doesNotMatch(force2d, /className="graph-canvas-shell force2d-shell force-graph-initial-fade"/);
  assert.doesNotMatch(force3d, /className="graph-canvas-shell force3d-shell force-graph-initial-fade"/);
  assert.match(force2d, /focusNode\?\.id === node\.id/);
  assert.match(force3d, /syncForceGraphNodeState\(node, focusNode \? new Set\(\[focusNode\.id\]\)/);
  assert.match(force3d, /animatedLinks\.forEach\(\(link\) => forceGraph\.emitParticle/);
  assert.match(force3d, /linkDirectionalParticles\(\(link\) => shouldShowParticles/);
  assert.match(force2d, /forceGraph\.zoomToFit\(FIT_TO_CANVAS_DURATION, FIT_TO_CANVAS_PADDING\)/);
  assert.match(force3d, /forceGraph\.zoomToFit\(FIT_TO_CANVAS_DURATION, FIT_TO_CANVAS_PADDING\)/);
  assert.match(force3d, /rotationPauseUntilRef\.current/);
  assert.match(force2d, /updateForceGraphHighlight\(forceGraph, target\.slug, 'instant', false\)/);
  assert.match(force3d, /updateForceGraphHighlight\(forceGraph, latestData, target\.slug, 'instant', true, false\)/);
});

test('force graph arc modes keep grow line-only and shoot beam-driven', async () => {
  const [force2d, force3d] = await Promise.all([
    fs.readFile(new URL('../../src/dashboard-client/graph/force-graph-2d-visualizer.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/graph/force-graph-3d-visualizer.jsx', import.meta.url), 'utf8'),
  ]);

  for (const source of [force2d, force3d]) {
    assert.match(source, /function shouldShowParticles\(\) \{[\s\S]*?Directional particles are continuous\.[\s\S]*?return 0;/);
    assert.match(source, /arcAnimation === 'shoot'/);
    assert.match(source, /if \(playAnimation && arcAnimation === 'shoot'\)/);
    assert.match(source, /emitParticle/);
    assert.match(source, /applyForceGraphArcAccessors\(forceGraph\)/);
  }
  assert.match(force2d, /requestForceGraphRedraw\(forceGraph\)/);
  assert.doesNotMatch(force2d, /forceGraph\.tickFrame\?\.\(\)/);
  assert.match(force3d, /\.linkOpacity\(1\)/);
  assert.match(force3d, /hexToRgba\(/);
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
  const [main, focusedViews, focusedData, dashboard] = await Promise.all([
    fs.readFile(new URL('../../src/dashboard-client/main.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/graph/focused-views.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/graph/focused-network-data.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/bigbrain/dashboard.js', import.meta.url), 'utf8'),
  ]);
  const labelsGroup = main.match(/<GraphStyleOptionGroup\s+label="Labels"[\s\S]*?\/>/)?.[0] || '';
  const nodeShapeGroup = main.match(/<GraphStyleOptionGroup\s+label="Node shape"[\s\S]*?\/>/)?.[0] || '';
  const nodeFillGroup = main.match(/<GraphStyleOptionGroup\s+label="Node fill"[\s\S]*?\/>/)?.[0] || '';
  const nodeIconGroup = main.match(/<GraphStyleOptionGroup\s+label="Node icon"[\s\S]*?\/>/)?.[0] || '';
  const nodeSizeGroup = main.match(/<GraphStyleOptionGroup\s+label="Base size"[\s\S]*?\/>/)?.[0] || '';
  const arcGroup = main.match(/<GraphStyleOptionGroup\s+label="Arc"[\s\S]*?\/>/)?.[0] || '';
  const paletteGroup = main.match(/<GraphStyleOptionGroup\s+label="Palette"[\s\S]*?\/>/)?.[0] || '';
  const autoRotationGroup = main.match(/<GraphStyleOptionGroup\s+label="Auto rotation"[\s\S]*?\/>/)?.[0] || '';
  const arcAnimationGroup = main.match(/<GraphStyleOptionGroup\s+label="Arc animation"[\s\S]*?\/>/)?.[0] || '';

  assert.match(labelsGroup, /options=\{GRAPH_LABEL_STYLES\}/);
  assert.match(labelsGroup, /shortcut="l"/);
  assert.doesNotMatch(labelsGroup, /disabled=/);
  assert.match(nodeShapeGroup, /options=\{GRAPH_NODE_SHAPES\}/);
  assert.match(nodeFillGroup, /options=\{GRAPH_NODE_FILLS\}/);
  assert.match(nodeIconGroup, /options=\{GRAPH_NODE_ICONS\}/);
  assert.doesNotMatch(nodeShapeGroup, /disabled=/);
  assert.doesNotMatch(nodeFillGroup, /disabled=/);
  assert.doesNotMatch(nodeIconGroup, /disabled=/);
  assert.match(nodeSizeGroup, /options=\{GRAPH_NODE_SIZES\}/);
  assert.doesNotMatch(nodeSizeGroup, /disabled=/);
  assert.match(arcGroup, /options=\{GRAPH_ARC_STYLES\}/);
  assert.doesNotMatch(arcGroup, /disabled=/);
  assert.match(arcAnimationGroup, /options=\{GRAPH_ARC_ANIMATIONS\}/);
  assert.doesNotMatch(arcAnimationGroup, /disabled=/);
  assert.match(paletteGroup, /options=\{GRAPH_COLOR_PALETTE_OPTIONS\}/);
  assert.match(autoRotationGroup, /options=\{GRAPH_AUTO_ROTATION_OPTIONS\}/);
  assert.match(autoRotationGroup, /disabled=\{visualizerId !== 'force-graph-3d'\}/);
  assert.doesNotMatch(main, /label="Spacing"/);
  assert.doesNotMatch(main, /graph-recent-panel/);
  assert.ok(main.indexOf('label="Color"') > main.indexOf('label="Auto rotation"'));
  assert.ok(main.indexOf('function GraphTypeColorEditor(') > main.indexOf('label="Color"'));
  assert.match(main, /function GraphTypeColorEditor\(/);
  assert.match(main, /type="color"/);
  assert.doesNotMatch(main, /graph-type-color-code/);
  assert.match(main, /key === 'r'/);
  assert.match(main, /setAutoRotate\(\(current\) => !current\)/);
  assert.match(main, /GRAPH_ACTIVITY_MODES/);
  assert.match(main, /onPointerMove=\{handleActivityPointerMove\}/);
  assert.match(main, /const handleGraphNodeSelect = useEffectEvent/);
  assert.match(main, /Promise\.allSettled/);
  assert.match(main, /FocusedNetworkVisualizer/);
  assert.match(main, /FocusedTimelineView/);
  assert.match(main, /buildFocusedSubgraphGraph/);
  assert.match(main, /FOCUSED_VIEW_MODES = \['network', 'timeline', 'subgraph'\]/);
  assert.match(main, /focusedViewMode === 'subgraph'/);
  const focusedSubgraphRender = main.match(/focusedViewMode === 'subgraph' \? \([\s\S]*?\/\>\s*\)\s*:\s*\(/)?.[0] || '';
  assert.match(focusedSubgraphRender, /labelStyle=\{labelStyle\}/);
  assert.match(main, /key="full-graph"[\s\S]*?labelStyle=\{labelStyle\}/);
  assert.match(main, /if \(focusSlug && focusedViewMode === 'subgraph'\) setLabelStyle\('all'\)/);
  assert.match(main, /else if \(!focusSlug && wasFocusedRef\.current\) setLabelStyle\('off'\)/);
  assert.match(focusedSubgraphRender, /activeSlug=\{activeSlug\}/);
  assert.doesNotMatch(focusedSubgraphRender, /onBackgroundClick=\{onLineageClose\}/);
  assert.match(main, /setFocusedViewMode\(focusSlug \? 'subgraph' : 'network'\)/);
  assert.match(main, /shortcutsEnabled=\{!healthOpen && !settingsOpen && !menuOpen\}/);
  assert.match(main, /\} else if \(key === 'l'\) \{\s*setLabelStyle/);
  assert.doesNotMatch(main, /key === 's'/);
  assert.match(main, /className="graph-focus-mode-toggle"/);
  assert.match(main, /className=\{`graph-focus-mode-button/);
  assert.match(main, /<kbd className="settings-shortcut">T<\/kbd>/);
  assert.doesNotMatch(main, /<span>View<\/span>/);
  assert.match(dashboard, /\.graph-focus-mode-button \{/);
  assert.doesNotMatch(dashboard, /\.graph-focus-mode-toggle strong/);
  assert.match(main, /nextFocusedViewMode/);
  assert.match(main, /graph-wrap-focused/);
  assert.match(main, /event\.key\.toLowerCase\(\) !== 't'/);
  assert.match(main, /target\?\.closest\('\.sidecar-panel, \.page-image-lightbox-overlay, \.graph-wrap, \.graph-focus-banner, \.graph-footer'\)/);
  assert.match(main, /key="focused-subgraph"/);
  assert.doesNotMatch(main, /key=\{`focused-subgraph:\$\{focusSlug\}`\}/);
  assert.match(main, /if \(walking\) return undefined;/);
  assert.match(focusedSubgraphRender, /fitOnGraphChange=\{isForceRenderer\}/);
  assert.match(main, /key="full-graph"/);
  assert.match(main, /timeline_updates/);
  assert.match(main, /const focusSlug = normalizeFocusedGraphSlug\(lineage\?\.slug\);[\s\S]*\.filter\(\(update\) => normalizeFocusedGraphSlug\(update\?\.page\?\.slug\) === focusSlug\)/);
  assert.match(main, /find\(\(node\) => normalizeFocusedGraphSlug\(node\?\.slug\) === focusSlug && node\.latest_timeline_entry\)/);
  assert.match(main, /focusedNetworkStats\.direct/);
  assert.match(focusedData, /focus_branch/);
  assert.match(focusedData, /incomingByTarget/);
  assert.match(focusedData, /network_at: lineageAt \|\| sourceNode\?\.created_at/);
  assert.match(focusedData, /sourceHop >= targetHop/);
  assert.match(main, /closest\('\.sidecar-panel, \.page-image-lightbox-overlay, \.graph-wrap, \.graph-focus-banner, \.graph-footer'\)/);
  assert.doesNotMatch(focusedViews, /Related pages by update order/);
  assert.match(focusedViews, /NETWORK_HOP_COLUMN_GAP = 320/);
  assert.match(focusedViews, /scroll\.scrollLeft = Math\.max/);
  assert.match(focusedViews, /scroll\.scrollTop = focusedNode/);
  assert.doesNotMatch(focusedViews, /columnByDate/);
  assert.match(focusedViews, /width=\{layout\.width\}/);
  assert.match(focusedViews, /height=\{layout\.height\}/);
  assert.match(focusedViews, /NETWORK_NODES_PER_ROW = 4/);
  assert.match(focusedViews, /NETWORK_VISIBLE_CONTRIBUTORS = 5/);
  assert.match(focusedViews, /expandedContributorGroups/);
  assert.match(focusedViews, /collapsed_group_key/);
  assert.match(focusedViews, /collapsed_count/);
  assert.match(focusedViews, /collapsed_expanded/);
  assert.match(focusedViews, /setExpandedContributorGroups/);
  assert.match(focusedViews, /x: column\.centerX/);
  assert.match(focusedViews, /focused-network-branches/);
  assert.match(focusedViews, /for \(const branch of nonFocusBranches\) \{[\s\S]*branchBaseY\.set\(branch, nextBranchY\)[\s\S]*nextBranchY \+= maxRows \* rowGap \+ NETWORK_BRANCH_GAP/);
  assert.match(focusedViews, /key: 'focused-branch',[\s\S]*label: null/);
  assert.match(focusedViews, /networkNodeTitleLines/);
  assert.doesNotMatch(focusedViews, /compactNodeTitle/);
  assert.doesNotMatch(focusedViews, /className="focused-network-meta">\s*\{node\.type \|\| 'page'\} · hop/);
  assert.doesNotMatch(main, /graph-timeline-slider/);
  assert.doesNotMatch(main, /graph-activity-meta/);
  assert.match(main, /if \(!preview \|\| lineage \|\| healthOpen\) return undefined/);
  assert.match(main, /if \(!lineage\) return undefined/);
  assert.match(dashboard, /\.graph-focus-banner \{[\s\S]*flex: 0 0 auto;[\s\S]*width: 100%; max-width: none;[\s\S]*margin: 0 0 10px;/);
  assert.match(dashboard, /\.graph-wrap-focused \.focused-view-stage \{[\s\S]*position: absolute; inset: 0; width: 100%; height: 100%; min-height: 0; overflow: hidden;/);
  assert.match(dashboard, /\.graph-wrap-focused \{[^}]*border: 0; border-radius: 0;/);
  assert.match(dashboard, /\.focused-view-empty \{[^}]*height: 100%;/);
  assert.match(dashboard, /\.focused-network-view \{[^}]*padding: 0;/);
  assert.match(dashboard, /\.focused-network-scroll \{[^}]*border: 0; border-radius: 0; background: transparent;/);
  assert.match(dashboard, /\.focused-network-node\.collapsed circle:first-child/);
  assert.doesNotMatch(focusedViews, /focused-view-heading|Page updates and their sources|Structured timeline entries/);
});

test('force graph label modes produce static labels for key and all modes', async () => {
  const [force2d, force3d] = await Promise.all([
    'force-graph-2d-visualizer.jsx',
    'force-graph-3d-visualizer.jsx',
  ].map((file) => fs.readFile(new URL(`../../src/dashboard-client/graph/${file}`, import.meta.url), 'utf8')));

  for (const source of [force2d, force3d]) {
    assert.match(source, /if \(labelStyle === 'all'\) return new Set\(values\.map\(\(node\) => node\.slug\)\);/);
    assert.match(source, /if \(labelStyle === 'off'\) return new Set\(\);/);
  }
  assert.match(force2d, /settings\.labelSlugs\?\.has\(node\.slug\) \|\| emphasized/);
  assert.match(force3d, /screenLabelNodes = useMemo\([\s\S]*labelSlugs\.has\(node\.slug\)/);
  assert.match(force3d, /style=\{FORCE_GRAPH_SCREEN_LABEL_STYLE\}/);
  assert.doesNotMatch(force3d, /createForceGraphNodeLabel/);
});

test('force graph hover tooltips stay cursor based and above canvas content', async () => {
  const [force2d, force3d, dashboard] = await Promise.all([
    fs.readFile(new URL('../../src/dashboard-client/graph/force-graph-2d-visualizer.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/graph/force-graph-3d-visualizer.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/bigbrain/dashboard.js', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(force2d, /force2d-focus-label|showFocusLabel/);
  const force3dHoverBlock = force3d.match(/\.onNodeHover\(\(node\) => \{([\s\S]*?)\n      \}\);/)?.[1] || '';
  assert.doesNotMatch(force3dHoverBlock, /showFocusLabel|hideFocusLabel/);
  assert.match(dashboard, /\.force3d-surface \.float-tooltip-kap, \.force2d-surface \.float-tooltip-kap \{[^}]*z-index: 8 !important;/);
  assert.match(dashboard, /\.force3d-focus-label \{ z-index: 9 !important; \}/);
});

test('3D force uses bounded settle-then-fit and optional Z-axis rotation', async () => {
  const [registry, main, visualizer] = await Promise.all([
    fs.readFile(new URL('../../src/dashboard-client/graph/registry.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/main.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/graph/force-graph-3d-visualizer.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(registry, /visualizerId: 'force-graph-3d'/);
  assert.match(registry, /nodeShape: 'pixel'/);
  assert.match(registry, /nodeFill: 'solid'/);
  assert.match(registry, /nodeSize: 'small'/);
  assert.match(registry, /arcStyle: 'straight'/);
  assert.match(registry, /arcAnimation: 'shoot'/);
  assert.match(registry, /autoRotate: true/);
  assert.match(registry, /export const GRAPH_AUTO_ROTATION_OPTIONS = \[/);
  assert.match(registry, /\{ id: 'off', label: 'Off' \}/);
  assert.match(registry, /\{ id: 'on', label: 'On' \}/);
  assert.match(main, /typeof saved\.autoRotate === 'boolean'/);
  assert.match(main, /autoRotate, demoMode/);
  assert.match(visualizer, /\.cooldownTicks\(100\)/);
  assert.match(visualizer, /\.onEngineStop\(\(\) =>/);
  assert.match(visualizer, /if \(!forceGraph\.__bigBrainFitPending\) return;/);
  assert.match(visualizer, /const shouldFitAfterUpdate = options\.fitAfterUpdate[\s\S]*hadGraphData/);
  assert.match(visualizer, /forceGraph\.__bigBrainInitialized = true;/);
  assert.match(visualizer, /nodeVisibility/);
  assert.match(visualizer, /linkVisibility/);
  assert.match(visualizer, /forceGraph\.zoomToFit\(FIT_TO_CANVAS_DURATION, FIT_TO_CANVAS_PADDING\)/);
  assert.match(visualizer, /cleanupForceGraphTransientParticles\(forceGraph\);\s*forceGraph\._destructor\?\.\(\);/);
  assert.match(visualizer, /delete link\.__singleHopPhotonsObj/);
  assert.match(visualizer, /arcStyle = 'curve'/);
  assert.match(visualizer, /arcAnimation = 'instant'/);
  assert.match(visualizer, /startArcAnimation/);
  const dashboard = await fs.readFile(new URL('../../src/bigbrain/dashboard.js', import.meta.url), 'utf8');
  assert.match(dashboard, /graph-arc-hover-grow/);
  assert.match(dashboard, /\.force-graph-canvas-initial-fade \{ opacity: 0; transition: opacity 620ms ease-out; will-change: opacity; \}/);
  assert.match(dashboard, /\.force-graph-canvas-initial-fade-visible \{ opacity: 1; \}/);
  assert.match(dashboard, /@media \(prefers-reduced-motion: reduce\) \{ \.force-graph-canvas-initial-fade \{ opacity: 1; transition: none; \} \}/);
  assert.match(visualizer, /linkCurvature\(\(\) => getForceGraphLinkCurvature/);
  assert.match(visualizer, /renderedArcStyleRef/);
  assert.match(visualizer, /refreshForceGraphLinkCurves/);
  assert.match(visualizer, /createForceGraphLinkCurve/);
  assert.match(visualizer, /createForceGraphIconSprite/);
  assert.match(visualizer, /createForceGraphNodeGlow/);
  assert.match(visualizer, /createRadialGradient/);
  assert.match(visualizer, /glow\.scale\.setScalar\(radius \* 7\)/);
  assert.match(visualizer, /gradient\.addColorStop\(0\.86/);
  assert.match(visualizer, /color: '#FFFFFF'/);
  assert.match(visualizer, /visual\.glow\.visible = emphasized/);
  assert.match(visualizer, /glow\.raycast = \(\) => \{\}/);
  assert.match(visualizer, /force3d-focus-label/);
  assert.match(visualizer, /graph2ScreenCoords/);
  assert.match(visualizer, /showFocusLabel\(forceGraph, node\)/);
  assert.doesNotMatch(visualizer, /visual\.createLabel/);
  assert.match(visualizer, /screenLabelsRef\.current/);
  assert.match(visualizer, /updateScreenLabelPositions/);
  assert.match(visualizer, /force3d-node-label/);
  assert.match(visualizer, /window\.cancelAnimationFrame\(screenLabelFrameRef\.current\)/);
  assert.match(visualizer, /\.nodeLabel\(\(node\) => buildNodeTooltip\(node, settingsRef\.current\.colorMode\)\)/);
  assert.match(visualizer, /function buildNodeTooltip\(node, colorMode\)/);
  assert.match(visualizer, /settingsRef\.current\.arcAnimation,[\s\S]*Boolean\(hoveredSlugRef\.current\)/);
  assert.doesNotMatch(visualizer, /TYPE_GLYPHS/);
  assert.match(visualizer, /scene\.rotation\.z \+=/);
  assert.match(visualizer, /!hoveredSlugRef\.current && time >= rotationPauseUntilRef\.current/);
  assert.match(visualizer, /AUTO_ROTATION_RADIANS_PER_SECOND = 0\.035/);
  assert.doesNotMatch(visualizer, /requestAnimationFrame\(\(\) => forceGraph\.zoomToFit/);
});

test('3D force teardown leaves transient particle groups for the graph destructor', async () => {
  const forceGraph = await fs.readFile(
    new URL('../../src/dashboard-client/graph/force-graph-3d-visualizer.jsx', import.meta.url),
    'utf8',
  );
  const cleanup = forceGraph.match(/function cleanupForceGraphTransientParticles[\s\S]*?\n}\n\nfunction startForceGraphInitialFade/)?.[0] || '';

  assert.match(cleanup, /disposeForceGraphNodeChildren\(singlePhotonsObj\)/);
  assert.match(cleanup, /delete link\.__singleHopPhotonsObj/);
  assert.doesNotMatch(cleanup, /singlePhotonsObj\.parent\.remove/);
  assert.match(forceGraph, /cleanupForceGraphTransientParticles\(forceGraph\);\s*forceGraph\._destructor\?\.\(\);/);
});

test('force graphs refit after late canvas sizing and async first data', async () => {
  const sources = await Promise.all([
    'force-graph-2d-visualizer.jsx',
    'force-graph-3d-visualizer.jsx',
  ].map((file) => fs.readFile(new URL(`../../src/dashboard-client/graph/${file}`, import.meta.url), 'utf8')));

  for (const source of sources) {
    assert.match(source, /const sizeChanged = forceGraph\.width\(\) !== width \|\| forceGraph\.height\(\) !== height;/);
    assert.match(source, /forceGraph\.width\(width\)\.height\(height\);/);
    assert.match(source, /if \(forceGraph\.__bigBrainHasData && !forceGraph\.isEngineRunning\?\.\(\)\) scheduleForceGraphFit\(forceGraph\);/);
    assert.match(source, /function scheduleForceGraphFit\(forceGraph\)/);
    assert.match(source, /if \(width <= 1 \|\| height <= 1 \|\| !data\.nodes\?\.length\)/);
    assert.match(source, /forceGraph\.__bigBrainFitPending = true;/);
    assert.match(source, /const shouldFitAfterUpdate = options\.fitAfterUpdate[\s\S]*hadGraphData/);
    assert.match(source, /forceGraph\.__bigBrainFitNodeIds = shouldFitAfterUpdate \? targetNodeIds : null;/);
    assert.match(source, /forceGraph\.__bigBrainFitLinkIds = shouldFitAfterUpdate \? targetLinkIds : null;/);
    assert.match(source, /if \(forceGraph\.__bigBrainFitPending && \([\s\S]*fitNodeIds/);
    assert.match(source, /if \(nodes\.length > 0\) \{\s*forceGraph\.__bigBrainHasData = true;\s*startForceGraphInitialFade\(forceGraph\);\s*\}/);
    assert.match(source, /cancelScheduledForceGraphFit\(forceGraph\);/);
  }
});

test('node appearance controls are independent and migrate legacy styles', async () => {
  const registry = await fs.readFile(new URL('../../src/dashboard-client/graph/registry.jsx', import.meta.url), 'utf8');
  assert.match(registry, /nodeShape: 'diamond'/);
  assert.match(registry, /nodeFill: 'outline'/);
  assert.match(registry, /nodeIcon: 'none'/);
  assert.match(registry, /export const GRAPH_NODE_SHAPES = \[/);
  assert.match(registry, /export const GRAPH_NODE_FILLS = \[/);
  assert.match(registry, /export const GRAPH_NODE_ICONS = \[/);
  assert.match(registry, /'pixel-solid': \{ nodeShape: 'pixel', nodeFill: 'solid', nodeIcon: 'outline' \}/);
  assert.match(registry, /if \(next\.arcStyle === 'beam'\) next\.arcStyle = 'curve';/);
  assert.doesNotMatch(registry, /id: 'beam'/);
});

test('graph node sizes offer stable one, two, and three times choices', () => {
  assert.deepEqual(GRAPH_NODE_SIZES.map(({ id, scale }) => [id, scale]), [
    ['small', 1],
    ['medium', 2],
    ['large', 3],
  ]);
  assert.equal(getGraphNodeSizeScale('small'), 1);
  assert.equal(getGraphNodeSizeScale('medium'), 2);
  assert.equal(getGraphNodeSizeScale('large'), 3);
  assert.equal(getGraphNodeSizeScale('unknown'), 2);
});

test('graph node base sizes interpolate smoothly with semantic zoom', () => {
  const bounds = { minScale: 0.42, maxScale: 10 };
  assert.equal(getGraphNodeZoomMultiplier(0.42, bounds), 0.5);
  assert.equal(getGraphNodeZoomMultiplier(1, bounds), 1);
  assert.equal(getGraphNodeZoomMultiplier(10, bounds), 1.5);
  assert.equal(getGraphNodeScreenScale(2, 0.42, bounds), 1);
  assert.equal(getGraphNodeScreenScale(2, 1, bounds), 2);
  assert.equal(getGraphNodeScreenScale(2, 10, bounds), 3);
  assert.equal(getGraphNodeTransformScale(2, 10, bounds), 0.3);
});

test('arc-based node sizing makes area proportional and keeps isolated nodes visible', () => {
  const radiusForOne = getGraphNodeConnectionScale({ arcCount: 1 }, 'connections');
  for (const count of [1, 2, 4, 9, 100]) {
    const radius = getGraphNodeConnectionScale({ arcCount: count }, 'connections');
    assert.ok(Math.abs(radius ** 2 / radiusForOne ** 2 - count) < 1e-10);
    assert.equal(getGraphNodeConnectionScale({ arcCount: count }, 'default'), 1);
  }
  for (const count of [0, -1, NaN, Infinity, undefined]) {
    assert.equal(getGraphNodeConnectionScale({ arcCount: count }, 'connections'), 1);
  }
  assert.equal(getGraphNodeConnectionScale({ arcCount: 4, degree: 100 }, 'connections'), 2);
  assert.equal(getGraphNodeConnectionScale({ degree: 9 }, 'connections'), 3);
});

test('icon nodes cover built-in schema types and use stable custom fallbacks', async () => {
  const canonicalTypes = [
    'people', 'organizations', 'deals', 'projects', 'ideas', 'meetings',
    'tasks', 'concepts', 'components', 'products', 'processes', 'writing', 'protocol', 'archive',
  ];
  for (const type of canonicalTypes) {
    assert.equal(typeof GRAPH_TYPE_ICON_NAMES[type], 'string');
    assert.equal(getGraphTypeIconName(type), GRAPH_TYPE_ICON_NAMES[type]);
  }

  const customIcon = getGraphTypeIconName('research-notes');
  assert.equal(GRAPH_FALLBACK_ICON_NAMES.includes(customIcon), true);
  assert.equal(getGraphTypeIconName('research-notes'), customIcon);
  assert.equal(getGraphTypeIconName('RESEARCH-NOTES'), customIcon);
  assert.match(graphTypeIconSvg('people', { iconStyle: 'outline' }), /<svg[\s\S]*<circle/);
  assert.match(graphTypeIconSvg('people', { iconStyle: 'solid' }), /fill="#FFFFFF"/);
  assert.equal(graphTypeIconSvg('people', { iconStyle: 'none' }), null);

  const [registry, iconSource, composable, bloom] = await Promise.all([
    fs.readFile(new URL('../../src/dashboard-client/graph/registry.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/graph/graph-type-icon.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/graph/composable-graph-visualizer.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/graph/signal-bloom-visualizer.jsx', import.meta.url), 'utf8'),
  ]);
  for (const [id, label] of [
    ['orb', 'Orb'],
    ['diamond', 'Diamond'],
    ['hex', 'Hex'],
    ['pixel', 'Pixel'],
  ]) {
    assert.match(registry, new RegExp(`\\{ id: '${id}', label: '${label}' \\}`));
  }
  for (const [id, label] of [['solid', 'Solid'], ['outline', 'Outline'], ['none', 'None']]) {
    assert.match(registry, new RegExp(`\\{ id: '${id}', label: '${label}' \\}`));
  }
  assert.match(iconSource, /iconStyle = 'outline'/);
  assert.match(iconSource, /iconStyle === 'none'/);
  assert.match(iconSource, /nodeFill === 'solid' \? background : color/);
  assert.match(iconSource, /fill=\{solid \? iconColor : 'none'\}/);
  assert.match(composable, /nodeShape === 'pixel'/);
  assert.match(composable, /nodeFill === 'solid'/);
  assert.match(composable, /nodeIcon/);
  assert.match(bloom, /nodeShape === 'pixel'/);
  assert.match(bloom, /nodeFill === 'solid'/);
  assert.match(bloom, /nodeIcon/);
});

test('graph zoom applies responsive base sizing while expanding relationships', async () => {
  const [composable, bloom, dashboard] = await Promise.all([
    fs.readFile(new URL('../../src/dashboard-client/graph/composable-graph-visualizer.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/graph/signal-bloom-visualizer.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/bigbrain/dashboard.js', import.meta.url), 'utf8'),
  ]);
  assert.match(composable, /'--graph-node-scale': nodeTransformScale/);
  assert.match(bloom, /'--graph-node-scale': nodeTransformScale/);
  assert.match(composable, /className="graph-node-screen-scale"/);
  assert.match(bloom, /className="graph-node-screen-scale"/);
  assert.match(dashboard, /\.graph-node-screen-scale \{[^}]*transform: scale\(var\(--graph-node-scale, 1\)\)/);
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
  assert.doesNotMatch(dashboard.match(/\.vis-network-boot-overlay[\s\S]*?\.design-lab-page/)?.[0] || '', /infinite/);
  assert.match(main, /new EventSource\('\/api\/graph\/events'\)/);
});

test('network renderers allow deep zoom without redrawing vis geometry during gestures', async () => {
  const [visualizer, dashboard, networkConstellation, composable] = await Promise.all([
    fs.readFile(new URL('../../src/dashboard-client/graph/vis-network-visualizer.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/bigbrain/dashboard.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/graph/network-constellation-visualizer.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/graph/composable-graph-visualizer.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(visualizer, /dragView: false/);
  assert.match(visualizer, /zoomView: false/);
  assert.match(visualizer, /const VIS_NETWORK_MAX_SCALE = 10/);
  assert.equal((visualizer.match(/Math\.min\(VIS_NETWORK_MAX_SCALE/g) || []).length, 2);
  assert.match(networkConstellation, /maxScale=\{10\}/);
  assert.match(composable, /useGraphViewport\(ref, laidOut, \{[\s\S]*maxScale,/);
  assert.match(visualizer, /translate3d\(\$\{translateX\}px, \$\{translateY\}px, 0\) scale\(\$\{ratio\}\)/);
  assert.match(visualizer, /network\.moveTo\(\{ position: next\.position, scale: next\.scale, animation: false \}\)/);
  assert.doesNotMatch(visualizer, /network\.on\('afterDrawing'/);
  assert.match(visualizer, /vis-network-camera-moving/);
  assert.match(visualizer, /if \(cameraMoving\) return/);
  assert.match(dashboard, /\.vis-network-camera-moving \.vis-network-label-layer \{ opacity: 0/);
  assert.doesNotMatch(dashboard.match(/\.vis-network-surface \{[\s\S]*?\.vis-network-label-layer/)?.[0] || '', /filter:/);
});

test('graph flow arcs attach side cards to their matching graph nodes', async () => {
  const [main, composable, bloom] = await Promise.all([
    fs.readFile(new URL('../../src/dashboard-client/main.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/graph/composable-graph-visualizer.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/graph/signal-bloom-visualizer.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(main, /querySelectorAll\('\[data-graph-node-slug\]'\)/);
  assert.match(main, /graphFlowInputTargets\(item\)/);
  assert.match(main, /target: graphPointFor\(target\.slug\)/);
  assert.match(main, /visibleInputs\.flatMap\(\(item\) =>/);
  assert.match(main, /source: graphPointFor\(item\.slug\)/);
  assert.match(main, /function graphFlowDirectedPath\(source, target\)/);
  assert.match(main, /setTimeout\(scheduleMeasure, 1400\)/);
  assert.doesNotMatch(main, /layout\.brain/);
  assert.match(composable, /data-graph-node-slug=\{node\.slug\}/);
  assert.match(bloom, /data-graph-node-slug=\{node\.slug\}/);
});

test('graph flow limits the displayed input cards to the newest six', async () => {
  const main = await fs.readFile(new URL('../../src/dashboard-client/main.jsx', import.meta.url), 'utf8');

  assert.match(main, /const GRAPH_FLOW_INPUT_LIMIT = 6;/);
  assert.match(main, /\.map\(\(item\) => \(\{ \.\.\.item, target_pages: graphFlowInputTargets\(item\) \}\)\)\s*\.filter/);
  assert.match(main, /\.sort\(\(left, right\) => \{[\s\S]*graphFlowInputTimestamp\(left\)[\s\S]*graphFlowInputTimestamp\(right\)/);
  assert.match(main, /source_message/);
  assert.match(main, /GraphFlowSourceIcon/);
  assert.match(main, /assistant_chat: MessagesSquare/);
  assert.doesNotMatch(main, /assistant_chat: Bot/);
});

test('graph flow exposes a source-type filter above the input cards', async () => {
  const [main, dashboard] = await Promise.all([
    fs.readFile(new URL('../../src/dashboard-client/main.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/bigbrain/dashboard.js', import.meta.url), 'utf8'),
  ]);

  assert.match(main, /Filter inputs by source type/);
  assert.match(main, /sourceTypeOptions/);
  assert.match(main, /selectedSourceTypes/);
  assert.match(main, /All source types/);
  assert.match(main, /graph-flow-source-filter-button/);
  assert.match(dashboard, /\.graph-flow-column-head \.graph-flow-source-filter-button \{[^}]*border: 0[^}]*background: transparent/);
});

test('flow arcs sit below graph nodes while cards stay above the graph', async () => {
  const [main, dashboard] = await Promise.all([
    fs.readFile(new URL('../../src/dashboard-client/main.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/bigbrain/dashboard.js', import.meta.url), 'utf8'),
  ]);

  assert.match(main, /<>\s*<GraphFlowNetwork layout=\{layout\} \/>\s*<div ref=\{stageRef\} className="graph-flow-overlay">/);
  assert.match(dashboard, /\.graph-canvas-shell \{[^}]*z-index: 2/);
  assert.match(dashboard, /\.graph-flow-network \{[^}]*z-index: 1/);
  assert.match(dashboard, /\.graph-flow-overlay \{[^}]*z-index: 3/);
});

test('flow context uses the shared graph style pill group', async () => {
  const [main, registry, dashboard] = await Promise.all([
    fs.readFile(new URL('../../src/dashboard-client/main.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/graph/registry.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/bigbrain/dashboard.js', import.meta.url), 'utf8'),
  ]);

  const flowGroup = main.match(/<GraphStyleOptionGroup\s+label="Flow context"[\s\S]*?\/>/)?.[0] || '';
  assert.match(flowGroup, /options=\{GRAPH_FLOW_VISIBILITY_OPTIONS\}/);
  assert.match(flowGroup, /value=\{flowVisible \? 'visible' : 'hidden'\}/);
  assert.match(registry, /id: 'visible', label: 'Visible'/);
  assert.match(registry, /id: 'hidden', label: 'Hidden'/);
  assert.doesNotMatch(main, /graph-flow-toggle/);
  assert.doesNotMatch(dashboard, /\.graph-flow-toggle/);
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

test('network constellation gives standalone pages natural positions alongside relationship clusters', () => {
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
  const orphanCenter = {
    x: isolates.reduce((sum, node) => sum + node.x, 0) / isolates.length,
    y: isolates.reduce((sum, node) => sum + node.y, 0) / isolates.length,
  };
  const orphanRadii = isolates.map((node) => Math.hypot(
    node.x - orphanCenter.x,
    node.y - orphanCenter.y,
  ));

  assert.equal('orphanRim' in layout, false);
  assert.equal(isolates.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)), true);
  assert.equal(Math.max(...orphanRadii) - Math.min(...orphanRadii) > 20, true);
  assert.equal(connected.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)), true);
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

test('3D force renderer is registered with the shared graph controls', async () => {
  const [registry, forceGraph, forceGraph2d] = await Promise.all([
    fs.readFile(new URL('../../src/dashboard-client/graph/registry.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/graph/force-graph-3d-visualizer.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../src/dashboard-client/graph/force-graph-2d-visualizer.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(registry, /id: 'force-graph-3d'/);
  assert.match(registry, /label: '3D Force'/);
  assert.match(registry, /controls: \['zoomIn', 'zoomOut', 'resetView'\]/);
  assert.match(forceGraph, /new ForceGraph3D/);
  assert.match(forceGraph, /new ResizeObserver\(resize\)/);
  assert.match(forceGraph, /forceGraph\.width\(width\)/);
  assert.match(forceGraph, /getForceGraphLinkWidth\(link, getForceGraphHighlightLinks\(forceGraph\), forceGraph\)/);
  assert.doesNotMatch(forceGraph, /forceGraph\.refresh/);
  assert.match(forceGraph, /updateForceGraphAnimatedLinks/);
  assert.match(forceGraph, /forceGraph\.emitParticle/);
  assert.doesNotMatch(forceGraph, /source\?\.color/);
  assert.match(forceGraph, /d3AlphaDecay\(0\.06\)/);
  assert.doesNotMatch(forceGraph, /\.refresh\(\)/);
  assert.match(forceGraph, /nodeThreeObject/);
  assert.match(forceGraph, /linkDirectionalParticles/);
  assert.match(forceGraph, /onNodeClick/);
  assert.match(registry, /id: 'force-graph-2d'/);
  assert.match(registry, /label: '2D Force'/);
  assert.match(forceGraph2d, /new ForceGraph2D/);
  assert.match(forceGraph2d, /nodeCanvasObjectMode\('replace'\)/);
  assert.match(forceGraph2d, /nodeCanvasObject/);
  assert.match(forceGraph2d, /graphTypeIconSvg/);
  assert.doesNotMatch(forceGraph2d, /TYPE_GLYPHS/);
  assert.match(forceGraph2d, /onEngineStop/);
  assert.match(forceGraph2d, /arcAnimation = 'instant'/);
  assert.match(forceGraph2d, /nodeFill/);
  assert.match(forceGraph2d, /nodeIcon/);
  assert.match(forceGraph2d, /getForceGraphLinkCurvature/);
  assert.match(forceGraph2d, /startArcAnimation/);
  assert.match(forceGraph2d, /if \(!forceGraph\.__bigBrainFitPending\) return;/);
  assert.match(forceGraph2d, /const shouldFitAfterUpdate = options\.fitAfterUpdate[\s\S]*hadGraphData/);
  assert.match(forceGraph2d, /forceGraph\.__bigBrainInitialized = true;/);
  assert.match(forceGraph2d, /nodeVisibility/);
  assert.match(forceGraph2d, /linkVisibility/);
  assert.match(forceGraph2d, /activityDay = null/);
  assert.match(forceGraph2d, /aria-label="2D force-directed brain graph"/);
  assert.doesNotMatch(forceGraph2d, /source\?\.color/);
  assert.doesNotMatch(forceGraph2d, /autoRotate/);
});


test('arc-based node counts use valid displayed edges instead of global degree', () => {
  const graph = normalizeGraph({
    nodes: [
      { slug: 'a', degree: 99 },
      { slug: 'b', degree: 99 },
      { slug: 'isolated', degree: 99 },
    ],
    edges: [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
      { source: 'a', target: 'a' },
      { source: 'a', target: 'missing' },
    ],
  });
  assert.equal(graph.edges.length, 3);
  assert.deepEqual(graph.nodes.map((node) => node.arcCount), [3, 2, 0]);
  assert.deepEqual(graph.nodes.map((node) => node.degree), [99, 99, 99]);
  assert.equal(getGraphNodeConnectionScale(graph.nodes[0], 'connections'), Math.sqrt(3));
  assert.equal(getGraphNodeConnectionScale(graph.nodes[2], 'connections'), 1);
});
