import { ComposableGraphVisualizer } from './composable-graph-visualizer.jsx';
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
  nodeStyle: 'diamond',
  nodeSize: 'medium',
  arcStyle: 'curve',
  layoutStyle: 'lanes',
  labelStyle: 'off',
  colorMode: 'updated',
};

export const GRAPH_NODE_STYLES = [
  { id: 'orb', label: 'Orb' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'hex', label: 'Hex' },
  { id: 'icon', label: 'Icon Ring' },
  { id: 'icon-bare', label: 'Icon Bare' },
  { id: 'icon-solid', label: 'Icon Solid' },
  { id: 'icon-soft', label: 'Icon Soft' },
  { id: 'icon-hex', label: 'Icon Hex' },
];

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
    description: 'Fast relationship clusters with an outer orphan rim',
    interactionModel: 'custom',
    controls: ['zoomIn', 'zoomOut', 'resetView'],
    capabilities: {
      ownsPan: true,
      ownsWheelZoom: true,
    },
  },
];
