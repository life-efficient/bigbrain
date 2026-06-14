import React, { forwardRef, useId, useMemo } from 'react';

import { buildCurvedEdgePath, buildSignalBloomLayout, pickLabelNodes } from './shared.js';
import {
  GraphBackdropDefs,
  GraphFixedLabels,
  GraphTypeDefs,
  useGraphTheme,
  useGraphViewport,
} from './visualizer-core.jsx';

export const SignalBloomVisualizer = forwardRef(function SignalBloomVisualizer({ graph, onNodeOpen }, ref) {
  const theme = useGraphTheme();
  const defsId = useId().replace(/:/g, '-');
  const laidOut = useMemo(() => buildSignalBloomLayout(graph), [graph]);
  const { viewport, bind } = useGraphViewport(ref, laidOut);
  const labeled = useMemo(() => pickLabelNodes(laidOut.nodes, 6), [laidOut]);

  return (
    <div className="graph-canvas-shell">
      <svg
        className="graph-svg futuristic-graph bloom-graph"
        viewBox={`0 0 ${laidOut.width} ${laidOut.height}`}
        preserveAspectRatio="xMidYMid slice"
        {...bind}
      >
        <defs>
          <GraphBackdropDefs idPrefix={defsId} theme={theme} />
          <GraphTypeDefs idPrefix={defsId} />
        </defs>

        <rect width={laidOut.width} height={laidOut.height} fill={theme.graphBase} />

        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
          {laidOut.clusters.map((cluster) => (
            <circle
              key={cluster.type}
              cx={cluster.x}
              cy={cluster.y}
              r={cluster.radius}
              fill="none"
              stroke={theme.graphCluster}
              strokeWidth="1"
            />
          ))}

          {laidOut.edges.map((edge) => (
            <path
              key={edge.key}
              d={buildCurvedEdgePath(edge, 0.1)}
              fill="none"
              stroke={theme.graphEdgeStrong}
              strokeOpacity="0.4"
              strokeWidth="1"
            />
          ))}

          {laidOut.nodes.map((node) => {
            const side = node.radius * 1.65;
            return (
              <g
                key={node.slug}
                onClick={(event) => {
                  event.stopPropagation();
                  onNodeOpen?.(node.slug);
                }}
                style={{ cursor: 'pointer' }}
              >
                <path
                  d={`M ${node.x} ${node.y - side} L ${node.x + side * 0.86} ${node.y - side * 0.34} L ${node.x + side * 0.86} ${node.y + side * 0.34} L ${node.x} ${node.y + side} L ${node.x - side * 0.86} ${node.y + side * 0.34} L ${node.x - side * 0.86} ${node.y - side * 0.34} Z`}
                  fill="none"
                  stroke={theme.graphNodeStroke}
                  strokeWidth="1"
                />
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={Math.max(1.6, node.radius * 0.3)}
                  fill={theme.accentStrong}
                />
              </g>
            );
          })}
        </g>

        <GraphFixedLabels nodes={laidOut.nodes} viewport={viewport} labeled={labeled} theme={theme} />
      </svg>
    </div>
  );
});
