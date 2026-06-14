import { TYPE_COLORS } from './colors.js';

export const GRAPH_LAYOUT_SIZE = {
  width: 960,
  height: 560,
};

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function getNodeRadius(degree) {
  return clamp(5 + Math.sqrt(Math.max(1, degree || 1)) * 1.6, 7, 20);
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
    vx: 0,
    vy: 0,
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
  const maxDegree = Math.max(1, ...layout.nodes.map((node) => node.degree || 1));

  for (const node of layout.nodes) {
    const angle = ((node.index + 1) / Math.max(layout.nodes.length, 1)) * Math.PI * 2;
    const tier = 1 - (node.degree || 0) / maxDegree;
    const orbit = 82 + tier * 168 + (node.index % 5) * 8;
    node.x = layout.centerX + Math.cos(angle) * orbit;
    node.y = layout.centerY + Math.sin(angle) * orbit;
  }

  simulateLayout(layout, {
    steps: 200,
    repulsion: 3100,
    springLength: 112,
    springStrength: 0.0034,
    centerStrength: 0.0015,
    orbitStrength: 0.0055,
    orbitRadius(node) {
      const tier = 1 - (node.degree || 0) / maxDegree;
      return 70 + tier * 185;
    },
  });

  return {
    ...layout,
    rings: [74, 132, 194, 252],
  };
}

export function buildNeuralMeshLayout(graph) {
  const layout = normalizeGraph(graph);
  const maxDegree = Math.max(1, ...layout.nodes.map((node) => node.degree || 1));
  const columns = Math.max(3, Math.ceil(Math.sqrt(Math.max(layout.nodes.length, 1))));

  for (const node of layout.nodes) {
    const col = node.index % columns;
    const row = Math.floor(node.index / columns);
    const depth = (node.degree || 0) / maxDegree;
    node.depth = depth;
    node.x = ((col + 1) / (columns + 1)) * layout.width + (row % 2) * 12;
    node.y = ((row + 1) / (Math.ceil(layout.nodes.length / columns) + 1)) * layout.height;
  }

  simulateLayout(layout, {
    steps: 220,
    repulsion: 2650,
    springLength: 92,
    springStrength: 0.0045,
    centerStrength: 0.0008,
    layerStrength: 0.0042,
    layerTarget(node) {
      const depth = node.depth || 0;
      return {
        x: 120 + depth * (layout.width - 240),
        y: layout.centerY + Math.sin(node.index * 1.17) * (layout.height * 0.22),
      };
    },
  });

  return layout;
}

export function buildSignalBloomLayout(graph) {
  const layout = normalizeGraph(graph);
  const centers = layout.typeCenters;
  const haloSizes = new Map();

  for (const node of layout.nodes) {
    const center = centers.get(node.type) || { x: layout.centerX, y: layout.centerY };
    const angle = ((node.index + 1) / Math.max(layout.nodes.length, 1)) * Math.PI * 2;
    const spread = 26 + (node.index % 6) * 14;
    node.x = center.x + Math.cos(angle) * spread;
    node.y = center.y + Math.sin(angle) * spread;
    haloSizes.set(node.type, Math.max(haloSizes.get(node.type) || 0, spread + node.radius * 7));
  }

  simulateLayout(layout, {
    steps: 210,
    repulsion: 2900,
    springLength: 108,
    springStrength: 0.0035,
    centerStrength: 0.0007,
    clusterStrength: 0.006,
    clusterCenter(node) {
      return centers.get(node.type) || { x: layout.centerX, y: layout.centerY };
    },
  });

  return {
    ...layout,
    clusters: [...centers.entries()].map(([type, center]) => ({
      type,
      x: center.x,
      y: center.y,
      radius: haloSizes.get(type) || 84,
      color: TYPE_COLORS[type] || '#9dd9ff',
    })),
  };
}

export function pickLabelNodes(nodes, maxCount = 18) {
  return new Set(
    [...nodes]
      .sort((a, b) => (b.degree || 0) - (a.degree || 0) || b.radius - a.radius)
      .slice(0, maxCount)
      .map((node) => node.slug),
  );
}

export function buildCurvedEdgePath(edge, bend = 0.14) {
  const midX = (edge.source.x + edge.target.x) / 2;
  const midY = (edge.source.y + edge.target.y) / 2;
  const dx = edge.target.x - edge.source.x;
  const dy = edge.target.y - edge.source.y;
  const length = Math.sqrt(dx * dx + dy * dy) || 1;
  const normalX = -dy / length;
  const normalY = dx / length;
  const curve = Math.min(36, length * bend);
  const controlX = midX + normalX * curve;
  const controlY = midY + normalY * curve;
  return `M ${edge.source.x} ${edge.source.y} Q ${controlX} ${controlY} ${edge.target.x} ${edge.target.y}`;
}

function simulateLayout(layout, options) {
  const {
    steps,
    repulsion,
    springLength,
    springStrength,
    centerStrength,
    orbitStrength,
    orbitRadius,
    clusterStrength,
    clusterCenter,
    layerStrength,
    layerTarget,
  } = options;

  for (let step = 0; step < steps; step += 1) {
    for (let i = 0; i < layout.nodes.length; i += 1) {
      for (let j = i + 1; j < layout.nodes.length; j += 1) {
        const a = layout.nodes[i];
        const b = layout.nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist2 = dx * dx + dy * dy + 0.01;
        const force = repulsion / dist2;
        a.vx -= dx * force * 0.00065;
        a.vy -= dy * force * 0.00065;
        b.vx += dx * force * 0.00065;
        b.vy += dy * force * 0.00065;
      }
    }

    for (const edge of layout.edges) {
      const dx = edge.target.x - edge.source.x;
      const dy = edge.target.y - edge.source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - springLength) * springStrength;
      edge.source.vx += (dx / dist) * force;
      edge.source.vy += (dy / dist) * force;
      edge.target.vx -= (dx / dist) * force;
      edge.target.vy -= (dy / dist) * force;
    }

    for (const node of layout.nodes) {
      node.vx += (layout.centerX - node.x) * centerStrength;
      node.vy += (layout.centerY - node.y) * centerStrength;

      if (orbitStrength && orbitRadius) {
        const dx = node.x - layout.centerX;
        const dy = node.y - layout.centerY;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const target = orbitRadius(node);
        const force = (dist - target) * orbitStrength;
        node.vx -= (dx / dist) * force;
        node.vy -= (dy / dist) * force;
      }

      if (clusterStrength && clusterCenter) {
        const target = clusterCenter(node);
        node.vx += (target.x - node.x) * clusterStrength;
        node.vy += (target.y - node.y) * clusterStrength;
      }

      if (layerStrength && layerTarget) {
        const target = layerTarget(node);
        node.vx += (target.x - node.x) * layerStrength;
        node.vy += (target.y - node.y) * layerStrength;
      }

      node.x += node.vx;
      node.y += node.vy;
      node.vx *= 0.84;
      node.vy *= 0.84;
      node.x = clamp(node.x, 34, layout.width - 34);
      node.y = clamp(node.y, 34, layout.height - 34);
    }
  }
}

function buildTypeCenters(types, width, height) {
  if (!types.length) {
    return new Map();
  }

  const radiusX = width * 0.28;
  const radiusY = height * 0.24;
  return new Map(types.map((type, index) => {
    const angle = ((index + 1) / types.length) * Math.PI * 2 - Math.PI / 2;
    return [type, {
      x: width / 2 + Math.cos(angle) * radiusX,
      y: height / 2 + Math.sin(angle) * radiusY,
    }];
  }));
}
