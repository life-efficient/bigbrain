import React, { forwardRef } from 'react';

import { ComposableGraphVisualizer } from './composable-graph-visualizer.jsx';
import { PRESET_GRAPH_LABEL_FONT_SIZE } from './visualizer-core.jsx';

export const NetworkConstellationVisualizer = forwardRef(function NetworkConstellationVisualizer(props, ref) {
  return (
    <ComposableGraphVisualizer
      {...props}
      ref={ref}
      layoutStyle="network"
      labelFontSize={PRESET_GRAPH_LABEL_FONT_SIZE}
    />
  );
});
