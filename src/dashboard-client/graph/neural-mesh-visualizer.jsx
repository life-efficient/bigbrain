import React, { forwardRef, useId, useMemo } from 'react';

import { buildNeuralMeshLayout, pickLabelNodes } from './shared.js';
import {
  GraphBackdropDefs,
  GraphFixedLabels,
  GraphTypeDefs,
  useGraphTheme,
  useGraphViewport,
} from './visualizer-core.jsx';

export const NeuralMeshVisualizer = forwardRef(function NeuralMeshVisualizer({ graph, onNodeOpen }, ref) {
  const theme = useGraphTheme();
  const defsId = useId().replace(/:/g, '-');
  const laidOut = useMemo(() => buildNeuralMeshLayout(graph), [graph]);
  const { viewport, bind } = useGraphViewport(ref, laidOut);
  const labeled = useMemo(() => pickLabelNodes(laidOut.nodes, 5), [laidOut]);

  return (
    <div className="graph-canvas-shell">
      <svg
        className="graph-svg futuristic-graph neural-graph"
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
          {laidOut.lanes.map((x) => (
            <line
              key={x}
              x1={x}
              y1="0"
              x2={x}
              y2={laidOut.height}
              stroke={theme.graphGrid}
              strokeDasharray="8 18"
            />
          ))}

          {laidOut.edges.map((edge) => (
            <line
              key={edge.key}
              x1={edge.source.x}
              y1={edge.source.y}
              x2={edge.target.x}
              y2={edge.target.y}
              stroke={theme.graphEdge}
              strokeWidth="1"
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
              <rect
                x={node.x - node.radius}
                y={node.y - node.radius}
                width={node.radius * 2}
                height={node.radius * 2}
                fill="none"
                stroke={theme.graphNodeStroke}
                strokeWidth="1"
                transform={`rotate(45 ${node.x} ${node.y})`}
              />
              <circle
                cx={node.x}
                cy={node.y}
                r={Math.max(1.6, node.radius * 0.34)}
                fill={theme.accentWarm}
              />
            </g>
          ))}
        </g>

        <GraphFixedLabels nodes={laidOut.nodes} viewport={viewport} labeled={labeled} theme={theme} />
      </svg>
    </div>
  );
});
