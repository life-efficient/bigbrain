import React, { forwardRef, useId, useMemo, useState } from 'react';

import { getGraphNodeColor } from './colors.js';
import { buildCurvedEdgePath, buildSignalBloomLayout, pickLabelNodes } from './shared.js';
import {
  GraphBackdropDefs,
  GraphFixedLabels,
  GraphTypeDefs,
  useGraphTheme,
  useGraphViewport,
} from './visualizer-core.jsx';

/**
 * Signal Bloom is a deliberately theatrical cluster view: page types become
 * isolated radar sectors, while relationships light up as curved signal arcs.
 * It shares the graph controls' public options, but owns its visual language.
 */
export const SignalBloomVisualizer = forwardRef(function SignalBloomVisualizer({
  graph,
  onNodeOpen,
  nodeStyle = 'orb',
  labelStyle = 'selected',
  colorMode = 'updated',
  activeSlug = null,
  onActiveSlugChange,
}, ref) {
  const theme = useGraphTheme();
  const defsId = useId().replace(/:/g, '-');
  const [hoveredSlug, setHoveredSlug] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const laidOut = useMemo(() => buildSignalBloomLayout(graph), [graph]);
  const { viewport, bind } = useGraphViewport(ref, laidOut, {
    minScale: 0.35,
    maxScale: 4,
    onDragStateChange(dragging) {
      setIsDragging(dragging);
      if (dragging) setHoveredSlug(null);
    },
  });
  const labeled = useMemo(() => {
    const visible = labelStyle === 'all'
      ? new Set(laidOut.nodes.map((node) => node.slug))
      : labelStyle === 'off'
        ? new Set()
        : pickLabelNodes(laidOut.nodes, 8);
    if (activeSlug) visible.add(activeSlug);
    if (hoveredSlug) visible.add(hoveredSlug);
    return visible;
  }, [activeSlug, hoveredSlug, labelStyle, laidOut]);

  return (
    <div className="graph-canvas-shell">
      <svg
        className="graph-svg futuristic-graph bloom-graph"
        viewBox={`0 0 ${laidOut.width} ${laidOut.height}`}
        preserveAspectRatio="xMidYMid meet"
        {...bind}
      >
        <defs>
          <GraphBackdropDefs idPrefix={defsId} theme={theme} />
          <GraphTypeDefs idPrefix={defsId} />
          <radialGradient id={`${defsId}-bloom-vignette`} cx="50%" cy="48%" r="68%">
            <stop offset="0%" stopColor={theme.graphInset} stopOpacity="0.15" />
            <stop offset="70%" stopColor={theme.graphBase} stopOpacity="0.12" />
            <stop offset="100%" stopColor={theme.graphShadow} stopOpacity="0.42" />
          </radialGradient>
          <filter id={`${defsId}-signal-glow`} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3.2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <style>{`
          @keyframes bloom-sector-in { from { opacity: 0; transform: scale(.72) rotate(-3deg); } to { opacity: 1; transform: scale(1) rotate(0); } }
          @keyframes bloom-link-in { from { opacity: 0; stroke-dashoffset: 80; } to { opacity: 1; stroke-dashoffset: 0; } }
          @keyframes bloom-node-in { 0% { opacity: 0; transform: scale(0); } 65% { opacity: 1; transform: scale(1.28); } 100% { opacity: 1; transform: scale(1); } }
          @keyframes bloom-pulse { 0%, 100% { opacity: .22; } 50% { opacity: .68; } }
          .bloom-sector { transform-box: fill-box; transform-origin: center; animation: bloom-sector-in .75s cubic-bezier(.2,.8,.2,1) both; }
          .bloom-link { stroke-dasharray: 80; animation: bloom-link-in .9s ease-out both; }
          .bloom-node { transform-box: fill-box; transform-origin: center; animation: bloom-node-in .58s cubic-bezier(.2,.9,.25,1.15) both; }
          .bloom-scan { animation: bloom-pulse 3.6s ease-in-out infinite; }
          @media (prefers-reduced-motion: reduce) { .bloom-sector, .bloom-link, .bloom-node, .bloom-scan { animation: none !important; } }
        `}</style>

        <rect width={laidOut.width} height={laidOut.height} fill={theme.graphBase} />
        <rect width={laidOut.width} height={laidOut.height} fill={`url(#${defsId}-surface-gradient)`} opacity="0.32" />
        <rect width={laidOut.width} height={laidOut.height} fill={`url(#${defsId}-grid-pattern)`} opacity="0.14" />
        <rect width={laidOut.width} height={laidOut.height} fill={`url(#${defsId}-bloom-vignette)`} />

        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
          <BloomSectors laidOut={laidOut} theme={theme} />
          <BloomLinks laidOut={laidOut} theme={theme} />
          {laidOut.nodes.map((node, index) => {
            const emphasized = activeSlug === node.slug || hoveredSlug === node.slug;
            return (
              <g
                className="bloom-node"
                key={node.slug}
                style={{ cursor: 'pointer', animationDelay: `${Math.min(620, 170 + index * 7)}ms` }}
                onPointerDown={(event) => event.stopPropagation()}
                onPointerEnter={() => { if (!isDragging) setHoveredSlug(node.slug); }}
                onPointerLeave={() => { if (!isDragging) setHoveredSlug((slug) => slug === node.slug ? null : slug); }}
                onClick={(event) => {
                  event.stopPropagation();
                  onActiveSlugChange?.(node.slug);
                  onNodeOpen?.(node.slug);
                }}
              >
                <BloomNode node={node} nodeStyle={nodeStyle} colorMode={colorMode} emphasized={emphasized} theme={theme} glowId={`${defsId}-signal-glow`} />
              </g>
            );
          })}
        </g>

        <GraphFixedLabels nodes={laidOut.nodes} viewport={viewport} labeled={labeled} theme={theme} />
      </svg>
    </div>
  );
});

function BloomSectors({ laidOut, theme }) {
  return laidOut.clusters.map((cluster, index) => (
    <g className="bloom-sector" key={cluster.type} style={{ animationDelay: `${index * 65}ms` }}>
      <circle cx={cluster.x} cy={cluster.y} r={cluster.radius + 14} fill={theme.graphInset} fillOpacity="0.08" stroke={theme.graphCluster} strokeOpacity="0.56" />
      <circle className="bloom-scan" cx={cluster.x} cy={cluster.y} r={cluster.radius * 0.78} fill="none" stroke={theme.graphGrid} strokeDasharray="3 10" />
      <path d={sectorTicks(cluster.x, cluster.y, cluster.radius + 14)} fill="none" stroke={theme.graphEdgeStrong} strokeOpacity="0.62" />
      <text x={cluster.x} y={cluster.y - cluster.radius - 25} textAnchor="middle" fill={theme.graphMutedLabel} fontSize="10" letterSpacing="0.18em">
        {String(cluster.type).toUpperCase()}
      </text>
    </g>
  ));
}

function BloomLinks({ laidOut, theme }) {
  return laidOut.edges.map((edge, index) => {
    const internal = edge.source.type === edge.target.type;
    const path = buildCurvedEdgePath(edge, internal ? 0.2 : 0.08);
    return (
      <g key={edge.key}>
        {internal && <path d={path} fill="none" stroke={theme.graphEdge} strokeOpacity="0.09" strokeWidth="5" />}
        <path
          className="bloom-link"
          d={path}
          fill="none"
          stroke={internal ? theme.graphEdgeStrong : theme.graphEdge}
          strokeOpacity={internal ? 0.48 : 0.22}
          strokeWidth={internal ? 1.15 : 0.8}
          style={{ animationDelay: `${Math.min(700, 120 + index * 3)}ms` }}
        />
      </g>
    );
  });
}

function BloomNode({ node, nodeStyle, colorMode, emphasized, theme, glowId }) {
  const color = getGraphNodeColor(node, colorMode) || theme.graphNodeStroke;
  const size = node.radius * (emphasized ? 1.95 : 1.62);
  const common = { fill: theme.graphBase, fillOpacity: '0.78', stroke: color, strokeWidth: emphasized ? 1.8 : 1 };
  let body;
  if (nodeStyle === 'diamond') {
    body = <rect x={node.x - size * 0.62} y={node.y - size * 0.62} width={size * 1.24} height={size * 1.24} transform={`rotate(45 ${node.x} ${node.y})`} {...common} />;
  } else if (nodeStyle === 'hex') {
    body = <path d={hexPath(node.x, node.y, size)} {...common} />;
  } else {
    body = <circle cx={node.x} cy={node.y} r={size} {...common} />;
  }
  return (
    <>
      <circle cx={node.x} cy={node.y} r={Math.max(15, size * 1.75)} fill="#fff" fillOpacity="0.001" />
      {emphasized && <circle cx={node.x} cy={node.y} r={size * 1.65} fill="none" stroke={color} strokeOpacity="0.35" filter={`url(#${glowId})`} />}
      {body}
      <circle cx={node.x} cy={node.y} r={Math.max(1.7, node.radius * 0.34)} fill={color} filter={emphasized ? `url(#${glowId})` : undefined} />
      <path d={`M ${node.x - size * 0.7} ${node.y} H ${node.x + size * 0.7}`} stroke={color} strokeOpacity="0.38" />
    </>
  );
}

function sectorTicks(x, y, radius) {
  return Array.from({ length: 12 }, (_, index) => {
    const angle = (index / 12) * Math.PI * 2;
    const inner = radius - (index % 3 === 0 ? 12 : 6);
    return `M ${x + Math.cos(angle) * inner} ${y + Math.sin(angle) * inner} L ${x + Math.cos(angle) * radius} ${y + Math.sin(angle) * radius}`;
  }).join(' ');
}

function hexPath(x, y, radius) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI / 3;
    return `${index ? 'L' : 'M'} ${x + Math.cos(angle) * radius} ${y + Math.sin(angle) * radius}`;
  }).join(' ') + ' Z';
}
