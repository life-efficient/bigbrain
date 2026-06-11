import { CustomConstellationVisualizer } from './custom-constellation-visualizer.jsx';
import { VisNetworkVisualizer } from './vis-network-visualizer.jsx';

export const GRAPH_CONTROL_LABELS = {
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  resetView: 'Reset',
};

export const graphVisualizers = [
  {
    id: 'vis-network',
    label: 'Vis Network',
    Component: VisNetworkVisualizer,
    description: 'Third-party graph explorer',
    interactionModel: 'library',
    controls: ['resetView'],
    capabilities: {
      ownsPan: false,
      ownsWheelZoom: false,
    },
  },
  {
    id: 'constellation',
    label: 'Constellation',
    Component: CustomConstellationVisualizer,
    description: 'Custom SVG renderer',
    interactionModel: 'custom',
    controls: ['zoomIn', 'zoomOut', 'resetView'],
    capabilities: {
      ownsPan: true,
      ownsWheelZoom: true,
    },
  },
];
