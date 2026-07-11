import { ComposableGraphVisualizer } from './composable-graph-visualizer.jsx';
import { JarvisHudVisualizer } from './jarvis-hud-visualizer.jsx';
import { NeuralMeshVisualizer } from './neural-mesh-visualizer.jsx';
import { SignalBloomVisualizer } from './signal-bloom-visualizer.jsx';
import { VisNetworkVisualizer } from './vis-network-visualizer.jsx';

export const GRAPH_CONTROL_LABELS = {
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  resetView: 'Reset view',
};

export const GRAPH_DEFAULTS = {
  visualizerId: 'jarvis-orbital',
  nodeStyle: 'diamond',
  arcStyle: 'curve',
  layoutStyle: 'lanes',
  labelStyle: 'off',
  colorMode: 'updated',
};

export const GRAPH_NODE_STYLES = [
  { id: 'orb', label: 'Orb' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'hex', label: 'Hex' },
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
    id: 'jarvis-orbital',
    label: 'Jarvis Orbital',
    Component: JarvisHudVisualizer,
    description: 'Radar command graph with collision-free orbital spacing',
    interactionModel: 'custom',
    controls: ['zoomIn', 'zoomOut', 'resetView'],
    capabilities: { ownsPan: true, ownsWheelZoom: true },
  },
  {
    id: 'jarvis-mesh',
    label: 'Jarvis Mesh',
    Component: NeuralMeshVisualizer,
    description: 'Structured page-type lanes with animated neural signals',
    interactionModel: 'custom',
    controls: ['zoomIn', 'zoomOut', 'resetView'],
    capabilities: { ownsPan: true, ownsWheelZoom: true },
  },
  {
    id: 'jarvis-bloom',
    label: 'Jarvis Bloom',
    Component: SignalBloomVisualizer,
    description: 'Page-type signal clusters with radar-sector choreography',
    interactionModel: 'custom',
    controls: ['zoomIn', 'zoomOut', 'resetView'],
    capabilities: { ownsPan: true, ownsWheelZoom: true },
  },
  {
    id: 'vis-network',
    label: 'Vis Network',
    Component: VisNetworkVisualizer,
    description: 'Third-party graph explorer',
    interactionModel: 'library',
    controls: ['zoomIn', 'zoomOut', 'resetView'],
    capabilities: {
      ownsPan: true,
      ownsWheelZoom: true,
    },
  },
];
