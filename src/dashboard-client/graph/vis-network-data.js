import { getGraphNodeColor } from './colors.js';
import { pickLabelNodes } from './shared.js';

export const VIS_NETWORK_KEY_LABEL_COUNT = 6;
export const VIS_NETWORK_HOVER_RADIUS = 28;

export function buildVisNetworkNodes(nodes, {
  colorMode = 'updated',
  nodeShape = 'orb',
  theme,
} = {}) {
  return nodes.map((node) => ({
    id: node.slug,
    label: '',
    value: Math.max(8, node.degree || 1),
    shape: resolveVisNetworkShape(nodeShape),
    color: colorMode === 'none' ? undefined : resolveNodeNetworkColor(node, colorMode, theme),
  }));
}

export function buildVisNetworkEdges(edges, theme) {
  return indexVisNetworkEdges(edges).map(({ edge, id }) => ({
    id,
    from: edge.source,
    to: edge.target,
    color: {
      color: theme.graphEdge,
      highlight: theme.graphEdgeStrong,
      hover: theme.graphEdgeStrong,
      opacity: 1,
    },
  }));
}

export function getVisNetworkLabelSlugs(nodes, labelStyle) {
  if (labelStyle === 'all') {
    return new Set(nodes.map((node) => node.slug));
  }
  if (labelStyle === 'off') {
    return new Set();
  }
  return new Set(pickLabelNodes(nodes, VIS_NETWORK_KEY_LABEL_COUNT));
}

export function resolveVisNetworkShape(nodeShape) {
  if (nodeShape === 'diamond') return 'diamond';
  if (nodeShape === 'hex') return 'hexagon';
  return 'dot';
}

export function findNearestVisNetworkNode(point, positions, radius = VIS_NETWORK_HOVER_RADIUS) {
  let nearest = null;
  let nearestDistanceSquared = radius * radius;
  for (const [slug, position] of Object.entries(positions || {})) {
    const dx = Number(position?.x) - Number(point?.x);
    const dy = Number(position?.y) - Number(point?.y);
    const distanceSquared = dx * dx + dy * dy;
    if (!Number.isFinite(distanceSquared) || distanceSquared > nearestDistanceSquared) continue;
    nearest = slug;
    nearestDistanceSquared = distanceSquared;
  }
  return nearest;
}

export function seedVisNetworkNodePosition(slug, edges, positions, fallback = { x: 0, y: 0 }) {
  const connected = [];
  for (const edge of edges || []) {
    const neighbor = edge.source === slug ? edge.target : edge.target === slug ? edge.source : null;
    const position = neighbor ? positions?.[neighbor] : null;
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) connected.push(position);
  }
  const origin = connected.length
    ? {
      x: connected.reduce((sum, position) => sum + position.x, 0) / connected.length,
      y: connected.reduce((sum, position) => sum + position.y, 0) / connected.length,
    }
    : fallback;
  const angle = stableSlugAngle(slug);
  const distance = connected.length ? 32 : 18;
  return {
    x: origin.x + Math.cos(angle) * distance,
    y: origin.y + Math.sin(angle) * distance,
  };
}

export function buildVisNetworkFocusUpdates(nodes, edges, focusSlug, theme) {
  const nodeSlugs = new Set(nodes.map((node) => node.slug));
  if (!focusSlug || !nodeSlugs.has(focusSlug)) {
    return {
      nodes: nodes.map((node) => ({ id: node.slug, opacity: 1 })),
      edges: indexVisNetworkEdges(edges).map(({ edge, id }) => ({
        id,
        color: { color: theme.graphEdge, highlight: theme.graphEdgeStrong, hover: theme.graphEdgeStrong, opacity: 1 },
      })),
    };
  }

  const neighbors = new Set([focusSlug]);
  for (const edge of edges) {
    if (edge.source === focusSlug) neighbors.add(edge.target);
    if (edge.target === focusSlug) neighbors.add(edge.source);
  }

  return {
    nodes: nodes.map((node) => ({
      id: node.slug,
      opacity: node.slug === focusSlug ? 1 : neighbors.has(node.slug) ? 0.86 : 0.18,
    })),
    edges: indexVisNetworkEdges(edges).map(({ edge, id }) => {
      const connected = edge.source === focusSlug || edge.target === focusSlug;
      return {
        id,
        color: {
          color: connected ? theme.graphEdgeStrong : theme.graphEdge,
          highlight: theme.graphEdgeStrong,
          hover: theme.graphEdgeStrong,
          opacity: connected ? 0.95 : 0.08,
        },
      };
    }),
  };
}

function indexVisNetworkEdges(edges) {
  const occurrences = new Map();
  return edges.map((edge) => {
    const key = `${edge.source}->${edge.target}`;
    const occurrence = occurrences.get(key) || 0;
    occurrences.set(key, occurrence + 1);
    return { edge, id: `${key}#${occurrence}` };
  });
}

function stableSlugAngle(slug) {
  let hash = 0;
  for (const character of String(slug || '')) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return (hash % 360) * (Math.PI / 180);
}

function resolveNodeNetworkColor(node, colorMode, theme) {
  const color = getGraphNodeColor(node, colorMode);
  return {
    background: color,
    border: theme.graphNodeStroke,
    highlight: {
      background: color,
      border: theme.graphNodeStroke,
    },
    hover: {
      background: color,
      border: theme.graphNodeStroke,
    },
  };
}
