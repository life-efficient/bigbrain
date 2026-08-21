import { getGraphNodeColor } from './colors.js';
import { pickLabelNodes } from './shared.js';

export const VIS_NETWORK_KEY_LABEL_COUNT = 6;

export function buildVisNetworkNodes(nodes, {
  colorMode = 'updated',
  labelStyle = 'selected',
  theme,
} = {}) {
  const labeled = getVisNetworkLabelSlugs(nodes, labelStyle);

  return nodes.map((node) => ({
    id: node.slug,
    label: labeled.has(node.slug) ? node.title : '',
    title: `${node.title} (${node.type})`,
    value: Math.max(8, node.degree || 1),
    ...(colorMode === 'none' ? {} : { color: resolveNodeNetworkColor(node, colorMode, theme) }),
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
