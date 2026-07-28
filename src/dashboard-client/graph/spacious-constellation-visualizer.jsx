import React, { forwardRef } from 'react';

import { ComposableGraphVisualizer } from './composable-graph-visualizer.jsx';
import { PRESET_GRAPH_LABEL_FONT_SIZE } from './visualizer-core.jsx';

export const SpaciousConstellationVisualizer = forwardRef(function SpaciousConstellationVisualizer(props, ref) {
  return (
    <ComposableGraphVisualizer
      {...props}
      ref={ref}
      layoutStyle="spacious"
      labelFontSize={PRESET_GRAPH_LABEL_FONT_SIZE}
    />
  );
});
