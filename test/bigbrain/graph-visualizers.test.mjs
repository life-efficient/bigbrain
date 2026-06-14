import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildJarvisLayout,
  buildNeuralMeshLayout,
  buildSignalBloomLayout,
} from '../../src/dashboard-client/graph/shared.js';
import { resolveThemeMode } from '../../src/dashboard-client/graph/theme.js';

test('resolveThemeMode respects auto and manual modes', () => {
  assert.equal(resolveThemeMode('auto', true), 'dark');
  assert.equal(resolveThemeMode('auto', false), 'light');
  assert.equal(resolveThemeMode('dark', false), 'dark');
  assert.equal(resolveThemeMode('light', true), 'light');
});

test('graph layouts safely handle empty and single-node graphs', () => {
  const empty = { nodes: [], edges: [] };
  const single = {
    nodes: [{ slug: 'projects/bigbrain', title: 'BigBrain', type: 'projects', degree: 0 }],
    edges: [],
  };

  for (const builder of [buildJarvisLayout, buildNeuralMeshLayout, buildSignalBloomLayout]) {
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

  for (const builder of [buildJarvisLayout, buildNeuralMeshLayout, buildSignalBloomLayout]) {
    const layout = builder(graph);
    assert.equal(layout.nodes.length, nodes.length);
    assert.equal(layout.edges.length, edges.length);
    for (const node of layout.nodes) {
      assert.equal(node.x >= 0 && node.x <= layout.width, true);
      assert.equal(node.y >= 0 && node.y <= layout.height, true);
    }
  }
});
