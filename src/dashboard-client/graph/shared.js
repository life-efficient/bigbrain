export const GRAPH_LAYOUT_SIZE = {
  width: 1280,
  height: 920,
};

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function getNodeRadius(degree) {
  return clamp(4 + Math.sqrt(Math.max(1, degree || 1)) * 0.9, 5, 11);
}

export function normalizeGraph(graph, { width = GRAPH_LAYOUT_SIZE.width, height = GRAPH_LAYOUT_SIZE.height } = {}) {
  const rawNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const nodes = rawNodes.map((node, index) => ({
    slug: node.slug,
    title: node.title || node.slug,
    type: node.type || 'unknown',
    degree: Number.isFinite(node.degree) ? node.degree : 0,
    index,
    radius: getNodeRadius(node.degree),
    neighbors: 0,
    x: width / 2,
    y: height / 2,
  }));
  const nodeMap = new Map(nodes.map((node) => [node.slug, node]));
  const edges = (Array.isArray(graph?.edges) ? graph.edges : [])
    .map((edge, index) => {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) return null;
      source.neighbors += 1;
      target.neighbors += 1;
      return {
        key: `${source.slug}:${target.slug}:${index}`,
        source,
        target,
      };
    })
    .filter(Boolean);

  const types = [...new Set(nodes.map((node) => node.type))];
  const typeCenters = buildTypeCenters(types, width, height);
  return {
    width,
    height,
    centerX: width / 2,
    centerY: height / 2,
    nodes,
    edges,
    types,
    typeCenters,
  };
}

export function buildJarvisLayout(graph) {
  const layout = normalizeGraph(graph);
  const sorted = [...layout.nodes].sort(sortByWeight);
  const rings = [120, 220, 320, 420, 520];
  placeOnRings(sorted, { centerX: layout.centerX, centerY: layout.centerY, rings, gap: 26, startAngle: -Math.PI / 2 });
  resolveCollisions(layout.nodes, 20, layout.width, layout.height);
  return {
    ...layout,
    rings,
  };
}

export function buildNeuralMeshLayout(graph) {
  const layout = normalizeGraph(graph);
  const sorted = [...layout.nodes].sort(sortByWeight);
  const laneCount = 6;
  const laneWidth = (layout.width - 240) / (laneCount - 1);
  const lanes = Array.from({ length: laneCount }, () => []);

  sorted.forEach((node, index) => {
    const laneIndex = index % laneCount;
    lanes[laneIndex].push(node);
  });

  lanes.forEach((laneNodes, laneIndex) => {
    const x = 120 + laneWidth * laneIndex;
    const verticalGap = (layout.height - 180) / Math.max(1, laneNodes.length);
    laneNodes.forEach((node, index) => {
      node.x = x + (laneIndex % 2 === 0 ? -18 : 18);
      node.y = 90 + verticalGap * (index + 0.5);
    });
  });

  relaxLayout(layout, { padding: 24, centerPull: 0.002, linkPull: 0.018, iterations: 22, horizontalBias: 0.012 });
  return {
    ...layout,
    lanes: Array.from({ length: laneCount }, (_, laneIndex) => 120 + laneWidth * laneIndex),
  };
}

export function buildSignalBloomLayout(graph) {
  const layout = normalizeGraph(graph);
  const groups = new Map(layout.types.map((type) => [type, []]));
  layout.nodes
    .sort(sortByWeight)
    .forEach((node) => {
      if (!groups.has(node.type)) groups.set(node.type, []);
      groups.get(node.type).push(node);
    });

  const clusterEntries = [...groups.entries()];
  const clusters = [];
  for (const [type, nodes] of clusterEntries) {
    const center = layout.typeCenters.get(type) || { x: layout.centerX, y: layout.centerY };
    const radii = buildClusterRings(nodes.length);
    placeOnRings(nodes, {
      centerX: center.x,
      centerY: center.y,
      rings: radii,
      gap: 16,
      startAngle: -Math.PI / 2,
    });
    clusters.push({
      type,
      x: center.x,
      y: center.y,
      radius: (radii[radii.length - 1] || 48) + 48,
    });
  }

  relaxLayout(layout, { padding: 20, centerPull: 0.0005, linkPull: 0.0015, iterations: 8 });
  return {
    ...layout,
    clusters,
  };
}

export function pickLabelNodes(nodes, maxCount = 16) {
  const selected = [];
  const minDistance = 140;
  for (const node of [...nodes].sort(sortByWeight)) {
    const tooClose = selected.some((candidate) => {
      const dx = candidate.x - node.x;
      const dy = candidate.y - node.y;
      return Math.sqrt(dx * dx + dy * dy) < minDistance;
    });
    if (tooClose) continue;
    selected.push(node);
    if (selected.length >= maxCount) break;
  }
  return new Set(selected.map((node) => node.slug));
}

export function buildCurvedEdgePath(edge, bend = 0.12) {
  const midX = (edge.source.x + edge.target.x) / 2;
  const midY = (edge.source.y + edge.target.y) / 2;
  const dx = edge.target.x - edge.source.x;
  const dy = edge.target.y - edge.source.y;
  const length = Math.sqrt(dx * dx + dy * dy) || 1;
  const normalX = -dy / length;
  const normalY = dx / length;
  const curve = Math.min(40, length * bend);
  const controlX = midX + normalX * curve;
  const controlY = midY + normalY * curve;
  return `M ${edge.source.x} ${edge.source.y} Q ${controlX} ${controlY} ${edge.target.x} ${edge.target.y}`;
}

function sortByWeight(a, b) {
  return (b.degree || 0) - (a.degree || 0) || b.neighbors - a.neighbors || a.slug.localeCompare(b.slug);
}

function placeOnRings(nodes, { centerX, centerY, rings, gap, startAngle }) {
  let index = 0;
  for (const radius of rings) {
    const circumference = Math.PI * 2 * radius;
    const capacity = Math.max(1, Math.floor(circumference / (18 + gap)));
    const slice = nodes.slice(index, index + capacity);
    if (!slice.length) break;
    slice.forEach((node, offset) => {
      const angle = startAngle + (offset / slice.length) * Math.PI * 2;
      node.x = centerX + Math.cos(angle) * radius;
      node.y = centerY + Math.sin(angle) * radius;
    });
    index += slice.length;
  }

  if (index < nodes.length) {
    const fallbackRadius = (rings[rings.length - 1] || 40) + 72;
    nodes.slice(index).forEach((node, offset) => {
      const angle = startAngle + (offset / Math.max(1, nodes.length - index)) * Math.PI * 2;
      node.x = centerX + Math.cos(angle) * fallbackRadius;
      node.y = centerY + Math.sin(angle) * fallbackRadius;
    });
  }
}

function buildClusterRings(count) {
  if (count <= 1) return [0];
  const rings = [];
  let placed = 0;
  let radius = 44;
  while (placed < count) {
    rings.push(radius);
    const capacity = Math.max(6, Math.floor((Math.PI * 2 * radius) / 28));
    placed += capacity;
    radius += 48;
  }
  return rings;
}

function relaxLayout(layout, options) {
  const {
    padding,
    centerPull,
    linkPull,
    iterations,
    horizontalBias = 0,
  } = options;

  for (let step = 0; step < iterations; step += 1) {
    resolveCollisions(layout.nodes, padding, layout.width, layout.height);

    for (const edge of layout.edges) {
      const dx = edge.target.x - edge.source.x;
      const dy = edge.target.y - edge.source.y;
      edge.source.x += dx * linkPull * 0.5;
      edge.source.y += dy * linkPull * 0.5;
      edge.target.x -= dx * linkPull * 0.5;
      edge.target.y -= dy * linkPull * 0.5;
    }

    for (const node of layout.nodes) {
      node.x += (layout.centerX - node.x) * centerPull;
      node.y += (layout.centerY - node.y) * centerPull;
      node.x += Math.sign(layout.centerX - node.x) * horizontalBias;
      node.x = clamp(node.x, 40, layout.width - 40);
      node.y = clamp(node.y, 40, layout.height - 40);
    }
  }
}

function resolveCollisions(nodes, padding, width, height) {
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 0.001;
      const minimum = a.radius + b.radius + padding;
      if (distance >= minimum) continue;
      const overlap = (minimum - distance) / 2;
      const nx = dx / distance;
      const ny = dy / distance;
      a.x -= nx * overlap;
      a.y -= ny * overlap;
      b.x += nx * overlap;
      b.y += ny * overlap;
      a.x = clamp(a.x, 40, width - 40);
      a.y = clamp(a.y, 40, height - 40);
      b.x = clamp(b.x, 40, width - 40);
      b.y = clamp(b.y, 40, height - 40);
    }
  }
}

function buildTypeCenters(types, width, height) {
  if (!types.length) {
    return new Map();
  }

  const radiusX = width * 0.28;
  const radiusY = height * 0.21;
  return new Map(types.map((type, index) => {
    const angle = ((index + 1) / types.length) * Math.PI * 2 - Math.PI / 2;
    return [type, {
      x: width / 2 + Math.cos(angle) * radiusX,
      y: height / 2 + Math.sin(angle) * radiusY,
    }];
  }));
}
