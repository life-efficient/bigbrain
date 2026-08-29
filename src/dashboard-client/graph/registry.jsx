import { ComposableGraphVisualizer } from './composable-graph-visualizer.jsx';
import { GRAPH_DEFAULT_PALETTE_ID } from './colors.js';
import { ForceGraph3DVisualizer } from './force-graph-3d-visualizer.jsx';
import { NetworkConstellationVisualizer } from './network-constellation-visualizer.jsx';
import { SignalBloomVisualizer } from './signal-bloom-visualizer.jsx';
import { SpaciousConstellationVisualizer } from './spacious-constellation-visualizer.jsx';

export { GRAPH_NODE_SIZES } from './node-sizes.js';

export const GRAPH_CONTROL_LABELS = {
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  resetView: 'Reset view',
};

export const GRAPH_DEFAULTS = {
  visualizerId: 'jarvis-bloom',
  nodeShape: 'diamond',
  nodeFill: 'outline',
  nodeIcon: 'none',
  nodeSize: 'medium',
  arcStyle: 'curve',
  layoutStyle: 'lanes',
  labelStyle: 'off',
  colorMode: 'updated',
  colorPaletteId: GRAPH_DEFAULT_PALETTE_ID,
  flowVisible: false,
  autoRotate: false,
  demoMode: false,
};

export const GRAPH_NODE_SHAPES = [
  { id: 'orb', label: 'Orb' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'hex', label: 'Hex' },
  { id: 'pixel', label: 'Pixel' },
];

export const GRAPH_NODE_FILLS = [
  { id: 'solid', label: 'Solid' },
  { id: 'outline', label: 'Outline' },
  { id: 'none', label: 'None' },
];

export const GRAPH_NODE_ICONS = [
  { id: 'solid', label: 'Solid' },
  { id: 'outline', label: 'Outline' },
  { id: 'none', label: 'None' },
];

export const GRAPH_FLOW_VISIBILITY_OPTIONS = [
  { id: 'visible', label: 'Visible' },
  { id: 'hidden', label: 'Hidden' },
];

export const GRAPH_AUTO_ROTATION_OPTIONS = [
  { id: 'off', label: 'Off' },
  { id: 'on', label: 'On' },
];

const LEGACY_NODE_STYLE_PREFERENCES = {
  orb: { nodeShape: 'orb', nodeFill: 'outline', nodeIcon: 'none' },
  diamond: { nodeShape: 'diamond', nodeFill: 'outline', nodeIcon: 'none' },
  hex: { nodeShape: 'hex', nodeFill: 'outline', nodeIcon: 'none' },
  pixel: { nodeShape: 'pixel', nodeFill: 'outline', nodeIcon: 'outline' },
  'pixel-solid': { nodeShape: 'pixel', nodeFill: 'solid', nodeIcon: 'outline' },
  icon: { nodeShape: 'orb', nodeFill: 'outline', nodeIcon: 'outline' },
  'icon-bare': { nodeShape: 'orb', nodeFill: 'none', nodeIcon: 'outline' },
  'icon-solid': { nodeShape: 'orb', nodeFill: 'none', nodeIcon: 'solid' },
  'icon-soft': { nodeShape: 'orb', nodeFill: 'outline', nodeIcon: 'outline' },
  'icon-hex': { nodeShape: 'hex', nodeFill: 'outline', nodeIcon: 'outline' },
};

export function migrateGraphPreferences(saved) {
  const next = saved && typeof saved === 'object' ? { ...saved } : {};
  const legacy = LEGACY_NODE_STYLE_PREFERENCES[next.nodeStyle];
  if (!next.nodeShape && legacy) Object.assign(next, legacy);
  return next;
}

export const GRAPH_ARC_STYLES = [
  { id: 'straight', label: 'Straight' },
  { id: 'curve', label: 'Curve' },
  { id: 'beam', label: 'Beam' },
];

export const GRAPH_LAYOUT_STYLES = [
  { id: 'orbital', label: 'Orbital' },
  { id: 'lanes', label: 'Lanes' },
  { id: 'clusters', label: 'Clusters' },
];

export const GRAPH_LABEL_STYLES = [
  { id: 'selected', label: 'Key' },
  { id: 'all', label: 'All' },
  { id: 'off', label: 'Off' },
];

export const GRAPH_COLOR_MODES = [
  { id: 'updated', label: 'Updated' },
  { id: 'type', label: 'Type' },
  { id: 'none', label: 'None' },
];

export const graphVisualizers = [
  {
    id: 'force-graph-3d',
    label: '3D Force',
    Component: ForceGraph3DVisualizer,
    description: 'GPU-rendered 3D force graph with live relationship motion',
    interactionModel: 'orbit',
    controls: ['zoomIn', 'zoomOut', 'resetView'],
    capabilities: {
      ownsPan: true,
      ownsWheelZoom: true,
    },
  },
  {
    id: 'custom',
    label: 'Custom',
    Component: ComposableGraphVisualizer,
    description: 'Composable monochrome graph renderer',
    interactionModel: 'custom',
    controls: ['zoomIn', 'zoomOut', 'resetView'],
    capabilities: {
      ownsPan: true,
      ownsWheelZoom: true,
    },
  },
  {
    id: 'spacious-constellation',
    label: 'Spacious',
    Component: SpaciousConstellationVisualizer,
    description: 'A naturally expanding, well-spaced relationship map',
    interactionModel: 'custom',
    controls: ['zoomIn', 'zoomOut', 'resetView'],
    capabilities: {
      ownsPan: true,
      ownsWheelZoom: true,
    },
  },
  {
    id: 'jarvis-bloom',
    label: 'Bloom',
    Component: SignalBloomVisualizer,
    description: 'Page-type signal clusters with radar-sector choreography',
    interactionModel: 'custom',
    controls: ['zoomIn', 'zoomOut', 'resetView'],
    capabilities: { ownsPan: true, ownsWheelZoom: true },
  },
  {
    id: 'network-constellation',
    label: 'Network',
    Component: NetworkConstellationVisualizer,
    description: 'Fast relationship clusters with naturally placed standalone pages',
    interactionModel: 'custom',
    controls: ['zoomIn', 'zoomOut', 'resetView'],
    capabilities: {
      ownsPan: true,
      ownsWheelZoom: true,
    },
  },
];
