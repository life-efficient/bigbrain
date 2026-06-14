import React, { forwardRef, useId, useMemo } from 'react';

import { TYPE_COLORS } from './colors.js';
import { buildCurvedEdgePath, buildSignalBloomLayout, pickLabelNodes } from './shared.js';
import {
  GraphBackdropDefs,
  GraphNodeLabel,
  GraphTypeDefs,
  useGraphTheme,
  useGraphViewport,
} from './visualizer-core.jsx';

export const SignalBloomVisualizer = forwardRef(function SignalBloomVisualizer({ graph, onNodeOpen }, ref) {
  const theme = useGraphTheme();
  const defsId = useId().replace(/:/g, '-');
  const laidOut = useMemo(() => buildSignalBloomLayout(graph), [graph]);
  const { viewport, bind } = useGraphViewport(ref, laidOut);
  const labeled = useMemo(() => pickLabelNodes(laidOut.nodes, 20), [laidOut]);

  return (
    <div className="graph-canvas-shell">
      <svg
        className="graph-svg futuristic-graph bloom-graph"
        viewBox={`0 0 ${laidOut.width} ${laidOut.height}`}
        {...bind}
      >
        <defs>
          <GraphBackdropDefs idPrefix={defsId} theme={theme} />
          <GraphTypeDefs idPrefix={defsId} />
        </defs>

        <rect width={laidOut.width} height={laidOut.height} fill={`url(#${defsId}-surface-gradient)`} rx="18" />

        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
          {laidOut.clusters?.map((cluster) => (
            <circle
              key={cluster.type}
              cx={cluster.x}
              cy={cluster.y}
              r={cluster.radius}
              fill={cluster.color}
              fillOpacity="0.08"
              stroke={theme.graphCluster}
              strokeWidth="1"
            />
          ))}

          {laidOut.edges.map((edge) => (
            <path
              key={edge.key}
              d={buildCurvedEdgePath(edge)}
              fill="none"
              stroke={theme.graphEdgeStrong}
              strokeOpacity="0.34"
              strokeWidth="1.15"
            />
          ))}

          {laidOut.nodes.map((node) => (
            <g
              key={node.slug}
              onClick={(event) => {
                event.stopPropagation();
                onNodeOpen?.(node.slug);
              }}
              style={{ cursor: 'pointer' }}
            >
              <circle
                cx={node.x}
                cy={node.y}
                r={node.radius * 2.5}
                fill={TYPE_COLORS[node.type] || theme.accent}
                fillOpacity="0.12"
                filter={`url(#${defsId}-node-glow-${node.type})`}
              />
              <circle
                cx={node.x}
                cy={node.y}
                r={node.radius * 1.45}
                fill={TYPE_COLORS[node.type] || theme.accent}
                fillOpacity="0.18"
              />
              <circle
                cx={node.x}
                cy={node.y}
                r={node.radius}
                fill={`url(#${defsId}-node-gradient-${node.type})`}
                stroke={theme.graphNodeStroke}
                strokeWidth="1"
              />
              <GraphNodeLabel node={node} theme={theme} visible={labeled.has(node.slug)} />
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
});
