import React, { forwardRef, useId, useMemo } from 'react';

import { TYPE_COLORS } from './colors.js';
import { buildJarvisLayout, pickLabelNodes } from './shared.js';
import {
  GraphBackdropDefs,
  GraphNodeLabel,
  GraphTypeDefs,
  useGraphTheme,
  useGraphViewport,
} from './visualizer-core.jsx';

export const JarvisHudVisualizer = forwardRef(function JarvisHudVisualizer({ graph, onNodeOpen }, ref) {
  const theme = useGraphTheme();
  const defsId = useId().replace(/:/g, '-');
  const laidOut = useMemo(() => buildJarvisLayout(graph), [graph]);
  const { viewport, bind } = useGraphViewport(ref, laidOut);
  const labeled = useMemo(() => pickLabelNodes(laidOut.nodes, 16), [laidOut]);

  return (
    <div className="graph-canvas-shell">
      <svg
        className="graph-svg futuristic-graph jarvis-graph"
        viewBox={`0 0 ${laidOut.width} ${laidOut.height}`}
        {...bind}
      >
        <defs>
          <GraphBackdropDefs idPrefix={defsId} theme={theme} />
          <GraphTypeDefs idPrefix={defsId} />
        </defs>

        <rect width={laidOut.width} height={laidOut.height} fill={`url(#${defsId}-surface-gradient)`} rx="18" />
        <rect width={laidOut.width} height={laidOut.height} fill={`url(#${defsId}-scanline-pattern)`} rx="18" opacity="0.45" />

        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
          <g opacity="0.95">
            {laidOut.rings.map((radius) => (
              <circle
                key={radius}
                cx={laidOut.centerX}
                cy={laidOut.centerY}
                r={radius}
                fill="none"
                stroke={theme.graphRing}
                strokeDasharray="6 10"
              />
            ))}
            {Array.from({ length: 12 }, (_, index) => {
              const angle = (index / 12) * Math.PI * 2;
              const x = laidOut.centerX + Math.cos(angle) * 252;
              const y = laidOut.centerY + Math.sin(angle) * 252;
              return (
                <line
                  key={index}
                  x1={laidOut.centerX}
                  y1={laidOut.centerY}
                  x2={x}
                  y2={y}
                  stroke={theme.graphGrid}
                />
              );
            })}
            <g>
              <path
                d={`M ${laidOut.centerX - 14} ${laidOut.centerY - 252} A 252 252 0 0 1 ${laidOut.centerX + 14} ${laidOut.centerY - 252}`}
                fill="none"
                stroke={theme.graphSweep}
                strokeWidth="18"
                strokeLinecap="round"
              >
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from={`0 ${laidOut.centerX} ${laidOut.centerY}`}
                  to={`360 ${laidOut.centerX} ${laidOut.centerY}`}
                  dur="24s"
                  repeatCount="indefinite"
                />
              </path>
            </g>
          </g>

          {laidOut.edges.map((edge) => (
            <line
              key={edge.key}
              x1={edge.source.x}
              y1={edge.source.y}
              x2={edge.target.x}
              y2={edge.target.y}
              stroke={theme.graphEdgeStrong}
              strokeOpacity="0.52"
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
                r={node.radius * 1.95}
                fill={TYPE_COLORS[node.type] || theme.accent}
                fillOpacity="0.22"
                filter={`url(#${defsId}-node-glow-${node.type})`}
              />
              <circle
                cx={node.x}
                cy={node.y}
                r={node.radius + 3}
                fill="none"
                stroke={theme.graphNodeStroke}
                strokeOpacity="0.45"
                strokeDasharray="2 3"
              />
              <circle
                cx={node.x}
                cy={node.y}
                r={node.radius}
                fill={`url(#${defsId}-node-gradient-${node.type})`}
                stroke={theme.graphNodeStroke}
                strokeWidth="1.15"
              />
              <GraphNodeLabel node={node} theme={theme} visible={labeled.has(node.slug)} />
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
});
