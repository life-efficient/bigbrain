import React, { forwardRef, useId, useMemo } from 'react';

import { buildJarvisLayout, pickLabelNodes } from './shared.js';
import {
  GraphBackdropDefs,
  GraphFixedLabels,
  GraphTypeDefs,
  useGraphTheme,
  useGraphViewport,
} from './visualizer-core.jsx';

export const JarvisHudVisualizer = forwardRef(function JarvisHudVisualizer({ graph, onNodeOpen }, ref) {
  const theme = useGraphTheme();
  const defsId = useId().replace(/:/g, '-');
  const laidOut = useMemo(() => buildJarvisLayout(graph), [graph]);
  const { viewport, bind } = useGraphViewport(ref, laidOut);
  const labeled = useMemo(() => pickLabelNodes(laidOut.nodes, 4), [laidOut]);

  return (
    <div className="graph-canvas-shell">
      <svg
        className="graph-svg futuristic-graph jarvis-graph"
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
          {laidOut.rings.map((radius) => (
            <circle
              key={radius}
              cx={laidOut.centerX}
              cy={laidOut.centerY}
              r={radius}
              fill="none"
              stroke={theme.graphRing}
              strokeDasharray="10 14"
            />
          ))}

          {Array.from({ length: 18 }, (_, index) => {
            const angle = (index / 18) * Math.PI * 2;
            return (
              <line
                key={index}
                x1={laidOut.centerX + Math.cos(angle) * 68}
                y1={laidOut.centerY + Math.sin(angle) * 68}
                x2={laidOut.centerX + Math.cos(angle) * 420}
                y2={laidOut.centerY + Math.sin(angle) * 420}
                stroke={theme.graphGrid}
              />
            );
          })}

          {laidOut.edges.map((edge) => (
            <line
              key={edge.key}
              x1={edge.source.x}
              y1={edge.source.y}
              x2={edge.target.x}
              y2={edge.target.y}
              stroke={theme.graphEdgeStrong}
              strokeOpacity="0.52"
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
              <circle
                cx={node.x}
                cy={node.y}
                r={node.radius * 1.45}
                fill="none"
                stroke={theme.graphNodeStroke}
                strokeWidth="1"
              />
              <circle
                cx={node.x}
                cy={node.y}
                r={Math.max(1.8, node.radius * 0.42)}
                fill={theme.accentStrong}
              />
            </g>
          ))}
        </g>

        <GraphFixedLabels nodes={laidOut.nodes} viewport={viewport} labeled={labeled} theme={theme} />
      </svg>
    </div>
  );
});
