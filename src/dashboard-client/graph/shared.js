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
    updated_at: node.updated_at || null,
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

  const clusterEntries = [...groups.entries()].map(([type, nodes]) => ({
    type,
    nodes,
    estimatedRadius: estimateClusterRadius(nodes),
  }));
  const clusterCenters = buildAdaptiveClusterCenters(clusterEntries, layout.width, layout.height);
  const clusters = [];
  for (const entry of clusterEntries) {
    const center = clusterCenters.get(entry.type) || { x: layout.centerX, y: layout.centerY };
    const clusterRadius = placePackedCluster(entry.nodes, {
      centerX: center.x,
      centerY: center.y,
    });
    clusters.push({
      type: entry.type,
      x: center.x,
      y: center.y,
      radius: clusterRadius,
    });
  }

  const clusterCenterMap = new Map(clusters.map((cluster) => [cluster.type, cluster]));
  relaxLayout(layout, {
    padding: 18,
    centerPull: 0.0004,
    linkPull: 0.0022,
    iterations: 12,
    anchorPull: 0.028,
    getAnchor(node) {
      return clusterCenterMap.get(node.type) || null;
    },
  });
  return {
    ...layout,
    clusters,
  };
}

export function buildSpaciousConstellationLayout(graph) {
  const base = normalizeGraph(graph);
  if (!base.nodes.length) return { ...base, rings: [] };

  const ordered = orderByConnectivity(base.nodes, base.edges);
  const ringGap = 58;
  const nodeGap = 58;
  const xScale = 1.22;
  const yScale = 0.84;
  const rings = [];
  let cursor = 0;
  let radius = 0;

  while (cursor < ordered.length) {
    const capacity = radius === 0 ? 1 : Math.max(6, Math.floor((Math.PI * 2 * radius) / nodeGap));
    const slice = ordered.slice(cursor, cursor + capacity);
    rings.push({ radius, nodes: slice });
    cursor += slice.length;
    radius += ringGap;
  }

  const outerRadius = Math.max(0, rings.at(-1)?.radius || 0);
  const width = Math.max(GRAPH_LAYOUT_SIZE.width, Math.ceil(outerRadius * xScale * 2 + 180));
  const height = Math.max(GRAPH_LAYOUT_SIZE.height, Math.ceil(outerRadius * yScale * 2 + 180));
  const centerX = width / 2;
  const centerY = height / 2;

  for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
    const ring = rings[ringIndex];
    const angleOffset = -Math.PI / 2 + (ringIndex % 2) * (Math.PI / Math.max(1, ring.nodes.length));
    ring.nodes.forEach((node, index) => {
      const angle = angleOffset + (index / Math.max(1, ring.nodes.length)) * Math.PI * 2;
      node.x = centerX + Math.cos(angle) * ring.radius * xScale;
      node.y = centerY + Math.sin(angle) * ring.radius * yScale;
    });
  }

  resolveCollisions(base.nodes, 22, width, height);
  resolveCollisions(base.nodes, 22, width, height);

  return {
    ...base,
    width,
    height,
    centerX,
    centerY,
    rings: rings.map((ring) => ring.radius).filter(Boolean),
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

function orderByConnectivity(nodes, edges) {
  const adjacency = new Map(nodes.map((node) => [node.slug, []]));
  for (const edge of edges) {
    adjacency.get(edge.source.slug)?.push(edge.target);
    adjacency.get(edge.target.slug)?.push(edge.source);
  }
  for (const neighbors of adjacency.values()) neighbors.sort(sortByWeight);

  const remaining = new Set(nodes.map((node) => node.slug));
  const seeds = [...nodes].sort(sortByWeight);
  const ordered = [];
  for (const seed of seeds) {
    if (!remaining.has(seed.slug)) continue;
    const queue = [seed];
    remaining.delete(seed.slug);
    while (queue.length) {
      const node = queue.shift();
      ordered.push(node);
      for (const neighbor of adjacency.get(node.slug) || []) {
        if (!remaining.delete(neighbor.slug)) continue;
        queue.push(neighbor);
      }
    }
  }
  return ordered;
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

function relaxLayout(layout, options) {
  const {
    padding,
    centerPull,
    linkPull,
    iterations,
    horizontalBias = 0,
    anchorPull = 0,
    getAnchor = null,
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
      const anchor = typeof getAnchor === 'function' ? getAnchor(node) : null;
      if (anchor) {
        node.x += (anchor.x - node.x) * anchorPull;
        node.y += (anchor.y - node.y) * anchorPull;
      }
      node.x += (layout.centerX - node.x) * centerPull;
      node.y += (layout.centerY - node.y) * centerPull;
      node.x += Math.sign(layout.centerX - node.x) * horizontalBias;
      node.x = clamp(node.x, 40, layout.width - 40);
      node.y = clamp(node.y, 40, layout.height - 40);
    }
  }
}

function estimateClusterRadius(nodes) {
  if (!nodes.length) return 0;
  if (nodes.length === 1) return nodes[0].radius + 28;

  let index = 0;
  let radius = 34;
  let outer = 0;
  while (index < nodes.length) {
    const budget = Math.PI * 2 * radius * 0.84;
    let used = 0;
    let taken = 0;
    while (index + taken < nodes.length) {
      const node = nodes[index + taken];
      const footprint = node.radius * 2 + 16;
      if (taken > 0 && used + footprint > budget) break;
      used += footprint;
      taken += 1;
    }
    if (taken === 0) {
      taken = 1;
    }
    const ringNodes = nodes.slice(index, index + taken);
    const largest = Math.max(...ringNodes.map((node) => node.radius));
    outer = Math.max(outer, radius + largest + 24);
    index += taken;
    radius += 46 + largest * 0.4;
  }
  return outer;
}

function placePackedCluster(nodes, { centerX, centerY }) {
  if (!nodes.length) return 0;
  if (nodes.length === 1) {
    nodes[0].x = centerX;
    nodes[0].y = centerY;
    return nodes[0].radius + 28;
  }

  let index = 0;
  let ringRadius = 34;
  let outer = 0;
  let ringIndex = 0;

  while (index < nodes.length) {
    const budget = Math.PI * 2 * ringRadius * 0.84;
    let used = 0;
    let taken = 0;
    while (index + taken < nodes.length) {
      const node = nodes[index + taken];
      const footprint = node.radius * 2 + 16;
      if (taken > 0 && used + footprint > budget) break;
      used += footprint;
      taken += 1;
    }
    if (taken === 0) {
      taken = 1;
      used = nodes[index].radius * 2 + 16;
    }

    const slice = nodes.slice(index, index + taken);
    const largest = Math.max(...slice.map((node) => node.radius));
    const sweep = slice.length === 1
      ? 0
      : clamp((used / Math.max(1, ringRadius)) * 1.08, Math.PI * 0.72, Math.PI * 1.82);
    const angleCenter = -Math.PI / 2 + ringIndex * 0.42;
    const angleStart = angleCenter - sweep / 2;
    let cursor = 0;
    for (const node of slice) {
      const footprint = node.radius * 2 + 16;
      const segment = sweep === 0 ? 0 : (footprint / used) * sweep;
      const angle = sweep === 0 ? angleCenter : angleStart + cursor + segment / 2;
      node.x = centerX + Math.cos(angle) * ringRadius;
      node.y = centerY + Math.sin(angle) * ringRadius;
      cursor += segment;
    }

    outer = Math.max(outer, ringRadius + largest + 24);
    index += slice.length;
    ringRadius += 46 + largest * 0.4;
    ringIndex += 1;
  }

  return outer;
}

function buildAdaptiveClusterCenters(clusterEntries, width, height) {
  if (!clusterEntries.length) {
    return new Map();
  }

  if (clusterEntries.length === 1) {
    return new Map([[clusterEntries[0].type, { x: width / 2, y: height / 2 }]]);
  }

  const maxRadius = Math.max(...clusterEntries.map((entry) => entry.estimatedRadius));
  const totalRadius = clusterEntries.reduce((sum, entry) => sum + entry.estimatedRadius, 0);
  const orbitX = clamp(width * 0.08 + totalRadius * 0.14 + maxRadius * 0.55, width * 0.14, width * 0.24);
  const orbitY = clamp(height * 0.06 + totalRadius * 0.11 + maxRadius * 0.42, height * 0.1, height * 0.19);
  const centers = clusterEntries.map((entry, index) => {
    const angle = ((index + 0.5) / clusterEntries.length) * Math.PI * 2 - Math.PI / 2;
    return {
      type: entry.type,
      radius: entry.estimatedRadius,
      preferredX: width / 2 + Math.cos(angle) * orbitX,
      preferredY: height / 2 + Math.sin(angle) * orbitY,
      x: width / 2 + Math.cos(angle) * orbitX,
      y: height / 2 + Math.sin(angle) * orbitY,
    };
  });

  for (let step = 0; step < 18; step += 1) {
    for (let i = 0; i < centers.length; i += 1) {
      const a = centers[i];
      for (let j = i + 1; j < centers.length; j += 1) {
        const b = centers[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy) || 0.001;
        const minimum = a.radius + b.radius + 42;
        if (distance >= minimum) continue;
        const overlap = (minimum - distance) / 2;
        const nx = dx / distance;
        const ny = dy / distance;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;
      }
    }
    for (const center of centers) {
      center.x += (center.preferredX - center.x) * 0.16;
      center.y += (center.preferredY - center.y) * 0.16;
      center.x = clamp(center.x, 120, width - 120);
      center.y = clamp(center.y, 120, height - 120);
    }
  }

  return new Map(centers.map((center) => [center.type, { x: center.x, y: center.y }]));
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
