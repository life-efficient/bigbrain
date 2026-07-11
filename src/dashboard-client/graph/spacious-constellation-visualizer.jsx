import React, { forwardRef } from 'react';

import { ComposableGraphVisualizer } from './composable-graph-visualizer.jsx';

export const SpaciousConstellationVisualizer = forwardRef(function SpaciousConstellationVisualizer(props, ref) {
  return <ComposableGraphVisualizer {...props} ref={ref} layoutStyle="clusters" />;
});
