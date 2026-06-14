import { JarvisHudVisualizer } from './jarvis-hud-visualizer.jsx';
import { NeuralMeshVisualizer } from './neural-mesh-visualizer.jsx';
import { SignalBloomVisualizer } from './signal-bloom-visualizer.jsx';
import { VisNetworkVisualizer } from './vis-network-visualizer.jsx';

export const GRAPH_CONTROL_LABELS = {
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  resetView: 'Reset',
};

export const graphVisualizers = [
  {
    id: 'jarvis-hud',
    label: 'Jarvis HUD',
    Component: JarvisHudVisualizer,
    description: 'Orbital control-room visualizer',
    interactionModel: 'custom',
    controls: ['zoomIn', 'zoomOut', 'resetView'],
    capabilities: {
      ownsPan: true,
      ownsWheelZoom: true,
    },
  },
  {
    id: 'neural-mesh',
    label: 'Neural Mesh',
    Component: NeuralMeshVisualizer,
    description: 'Layered dense network view',
    interactionModel: 'custom',
    controls: ['zoomIn', 'zoomOut', 'resetView'],
    capabilities: {
      ownsPan: true,
      ownsWheelZoom: true,
    },
  },
  {
    id: 'signal-bloom',
    label: 'Signal Bloom',
    Component: SignalBloomVisualizer,
    description: 'Cluster-first cinematic graph',
    interactionModel: 'custom',
    controls: ['zoomIn', 'zoomOut', 'resetView'],
    capabilities: {
      ownsPan: true,
      ownsWheelZoom: true,
    },
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
