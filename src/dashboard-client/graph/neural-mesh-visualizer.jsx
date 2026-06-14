import React, { forwardRef, useId, useMemo } from 'react';

import { TYPE_COLORS } from './colors.js';
import { buildNeuralMeshLayout, pickLabelNodes } from './shared.js';
import {
  GraphBackdropDefs,
  GraphNodeLabel,
  GraphTypeDefs,
  useGraphTheme,
  useGraphViewport,
} from './visualizer-core.jsx';

export const NeuralMeshVisualizer = forwardRef(function NeuralMeshVisualizer({ graph, onNodeOpen }, ref) {
  const theme = useGraphTheme();
  const defsId = useId().replace(/:/g, '-');
  const laidOut = useMemo(() => buildNeuralMeshLayout(graph), [graph]);
  const { viewport, bind } = useGraphViewport(ref, laidOut);
  const labeled = useMemo(() => pickLabelNodes(laidOut.nodes, 14), [laidOut]);

  return (
    <div className="graph-canvas-shell">
      <svg
        className="graph-svg futuristic-graph neural-graph"
        viewBox={`0 0 ${laidOut.width} ${laidOut.height}`}
        {...bind}
      >
        <defs>
          <GraphBackdropDefs idPrefix={defsId} theme={theme} />
          <GraphTypeDefs idPrefix={defsId} />
        </defs>

        <rect width={laidOut.width} height={laidOut.height} fill={`url(#${defsId}-surface-gradient)`} rx="18" />
        <rect width={laidOut.width} height={laidOut.height} fill={`url(#${defsId}-grid-pattern)`} rx="18" />

        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
          {Array.from({ length: 7 }, (_, index) => (
            <line
              key={`layer-${index}`}
              x1={120 + index * 120}
              y1="34"
              x2={120 + index * 120}
              y2={laidOut.height - 34}
              stroke={theme.graphGrid}
              strokeDasharray="4 12"
            />
          ))}

          {laidOut.edges.map((edge) => (
            <g key={edge.key}>
              <line
                x1={edge.source.x}
                y1={edge.source.y}
                x2={edge.target.x}
                y2={edge.target.y}
                stroke={theme.graphEdge}
                strokeWidth="1.2"
              />
              <line
                x1={edge.source.x}
                y1={edge.source.y}
                x2={edge.target.x}
                y2={edge.target.y}
                stroke={theme.graphEdgeStrong}
                strokeOpacity="0.55"
                strokeDasharray="7 16"
                className="graph-pulse-line"
              />
            </g>
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
                r={node.radius * 1.8}
                fill={TYPE_COLORS[node.type] || theme.accent}
                fillOpacity="0.18"
                filter={`url(#${defsId}-node-glow-${node.type})`}
              />
              <rect
                x={node.x - node.radius}
                y={node.y - node.radius}
                width={node.radius * 2}
                height={node.radius * 2}
                rx={node.radius * 0.55}
                fill={`url(#${defsId}-node-gradient-${node.type})`}
                stroke={theme.graphNodeStroke}
                strokeWidth="1"
                transform={`rotate(${18 + (node.index % 5) * 8} ${node.x} ${node.y})`}
              />
              <circle
                cx={node.x}
                cy={node.y}
                r={Math.max(2.6, node.radius * 0.28)}
                fill={theme.accentWarm}
              />
              <GraphNodeLabel node={node} theme={theme} visible={labeled.has(node.slug)} />
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
});
