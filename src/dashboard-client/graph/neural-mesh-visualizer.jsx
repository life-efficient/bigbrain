import React, { forwardRef, useId, useMemo, useState } from 'react';

import { getGraphNodeColor } from './colors.js';
import { normalizeGraph, pickLabelNodes } from './shared.js';
import {
  GraphBackdropDefs,
  GraphFixedLabels,
  GraphTypeDefs,
  useGraphTheme,
  useGraphViewport,
} from './visualizer-core.jsx';

const LANE_GAP = 152;
const ROW_GAP = 58;

export const NeuralMeshVisualizer = forwardRef(function NeuralMeshVisualizer({
  graph,
  onNodeOpen,
  nodeStyle = 'diamond',
  labelStyle = 'selected',
  colorMode = 'updated',
  activeSlug = null,
  onActiveSlugChange,
}, ref) {
  const theme = useGraphTheme();
  const defsId = useId().replace(/:/g, '-');
  const [hoveredSlug, setHoveredSlug] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const laidOut = useMemo(() => buildMeshLayout(graph), [graph]);
  const { viewport, bind } = useGraphViewport(ref, laidOut, {
    minScale: 0.35,
    maxScale: 4.5,
    onDragStateChange(dragging) {
      setIsDragging(dragging);
      if (dragging) setHoveredSlug(null);
    },
  });
  const labeled = useMemo(() => {
    const next = labelStyle === 'all'
      ? new Set(laidOut.nodes.map((node) => node.slug))
      : labelStyle === 'off'
        ? new Set()
        : pickLabelNodes(laidOut.nodes, 12);
    if (activeSlug) next.add(activeSlug);
    if (hoveredSlug) next.add(hoveredSlug);
    return next;
  }, [activeSlug, hoveredSlug, labelStyle, laidOut]);

  return (
    <div className="graph-canvas-shell">
      <svg
        className="graph-svg futuristic-graph neural-mesh-graph"
        viewBox={`0 0 ${laidOut.width} ${laidOut.height}`}
        preserveAspectRatio="xMidYMid meet"
        {...bind}
      >
        <defs>
          <GraphBackdropDefs idPrefix={defsId} theme={theme} />
          <GraphTypeDefs idPrefix={defsId} />
          <filter id={`${defsId}-mesh-glow`} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <linearGradient id={`${defsId}-edge-signal`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={theme.graphEdgeStrong} stopOpacity="0.08" />
            <stop offset="0.5" stopColor={theme.accentStrong} stopOpacity="0.72" />
            <stop offset="1" stopColor={theme.graphEdgeStrong} stopOpacity="0.08" />
          </linearGradient>
        </defs>
        <style>{`
          .neural-mesh-graph .mesh-boot { opacity: 0; animation: mesh-materialize .62s cubic-bezier(.2,.8,.2,1) forwards; }
          .neural-mesh-graph .mesh-scan { animation: mesh-scan 5.5s linear infinite; }
          .neural-mesh-graph .mesh-pulse { animation: mesh-pulse 2.8s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
          @keyframes mesh-materialize { from { opacity: 0; transform: scale(.72); } to { opacity: 1; transform: scale(1); } }
          @keyframes mesh-scan { from { transform: translateY(-90px); } to { transform: translateY(${laidOut.height + 90}px); } }
          @keyframes mesh-pulse { 0%,100% { opacity:.32; transform:scale(.9); } 50% { opacity:.82; transform:scale(1.2); } }
          @media (prefers-reduced-motion: reduce) { .neural-mesh-graph .mesh-boot { opacity:1; animation:none; } .neural-mesh-graph .mesh-scan,.neural-mesh-graph .mesh-pulse { animation:none; } }
        `}</style>

        <rect width={laidOut.width} height={laidOut.height} fill={theme.graphBase} />
        <rect width={laidOut.width} height={laidOut.height} fill={`url(#${defsId}-surface-gradient)`} opacity="0.46" />
        <rect width={laidOut.width} height={laidOut.height} fill={`url(#${defsId}-grid-pattern)`} opacity="0.11" />

        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
          {laidOut.lanes.map((lane, index) => (
            <g key={lane.type} className="mesh-boot" style={{ animationDelay: `${Math.min(index * 55, 420)}ms` }}>
              <line x1={lane.x} y1="72" x2={lane.x} y2={laidOut.height - 54} stroke={theme.graphGrid} strokeOpacity="0.46" strokeDasharray="2 15" />
              <path d={`M ${lane.x - 38} 58 H ${lane.x + 38}`} stroke={theme.graphEdgeStrong} strokeOpacity="0.7" />
              <text x={lane.x} y="43" textAnchor="middle" fill={theme.graphMutedLabel} fontSize="9" letterSpacing=".18em">{lane.type.toUpperCase()}</text>
            </g>
          ))}

          {laidOut.edges.map((edge, index) => (
            <g key={edge.key} className="mesh-boot" style={{ animationDelay: `${Math.min(180 + index * 2, 620)}ms` }}>
              <path d={meshArc(edge)} fill="none" stroke={theme.graphEdge} strokeOpacity="0.12" strokeWidth="5" />
              <path d={meshArc(edge)} fill="none" stroke={`url(#${defsId}-edge-signal)`} strokeOpacity="0.64" strokeWidth="1" strokeLinecap="round" />
            </g>
          ))}

          {laidOut.nodes.map((node, index) => {
            const emphasized = node.slug === activeSlug || node.slug === hoveredSlug;
            const color = getGraphNodeColor(node, colorMode) || theme.graphNodeStroke;
            return (
              <g
                key={node.slug}
                className="mesh-boot"
                style={{ cursor: 'pointer', animationDelay: `${Math.min(260 + index * 9, 980)}ms` }}
                onPointerDown={(event) => event.stopPropagation()}
                onPointerEnter={() => { if (!isDragging) setHoveredSlug(node.slug); }}
                onPointerLeave={() => { if (!isDragging) setHoveredSlug((current) => current === node.slug ? null : current); }}
                onClick={(event) => {
                  event.stopPropagation();
                  onActiveSlugChange?.(node.slug);
                  onNodeOpen?.(node.slug);
                }}
              >
                <circle cx={node.x} cy={node.y} r={Math.max(17, node.radius * 2.7)} fill="#fff" fillOpacity=".001" />
                {emphasized && <circle className="mesh-pulse" cx={node.x} cy={node.y} r={node.radius * 2.35} fill="none" stroke={color} strokeWidth="1" />}
                <MeshNode node={node} nodeStyle={nodeStyle} color={color} emphasized={emphasized} glowId={`${defsId}-mesh-glow`} theme={theme} />
              </g>
            );
          })}

          <g className="mesh-scan" pointerEvents="none">
            <line x1="45" y1="0" x2={laidOut.width - 45} y2="0" stroke={theme.accentStrong} strokeOpacity=".2" />
          </g>
        </g>

        <GraphFixedLabels nodes={laidOut.nodes} viewport={viewport} labeled={labeled} theme={theme} />
      </svg>
    </div>
  );
});

function buildMeshLayout(graph) {
  const normalized = normalizeGraph(graph);
  const grouped = new Map();
  normalized.nodes.forEach((node) => {
    if (!grouped.has(node.type)) grouped.set(node.type, []);
    grouped.get(node.type).push(node);
  });
  const groups = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const laneCount = Math.max(1, groups.length);
  const width = Math.max(1280, 176 + (laneCount - 1) * LANE_GAP + 176);
  const longestLane = Math.max(1, ...groups.map(([, nodes]) => nodes.length));
  const height = Math.max(920, 150 + longestLane * ROW_GAP);
  const left = (width - (laneCount - 1) * LANE_GAP) / 2;
  const lanes = groups.map(([type, nodes], laneIndex) => {
    const x = left + laneIndex * LANE_GAP;
    nodes.sort((a, b) => (b.degree || 0) - (a.degree || 0) || a.slug.localeCompare(b.slug));
    const available = height - 150;
    const gap = Math.min(ROW_GAP, available / Math.max(1, nodes.length));
    const startY = 92 + (available - gap * Math.max(0, nodes.length - 1)) / 2;
    nodes.forEach((node, row) => {
      node.x = x + (row % 2 ? 10 : -10);
      node.y = startY + row * gap;
    });
    return { type, x };
  });
  return { ...normalized, width, height, centerX: width / 2, centerY: height / 2, lanes };
}

function meshArc(edge) {
  const dx = edge.target.x - edge.source.x;
  const direction = dx < 0 ? -1 : 1;
  const shoulder = Math.min(62, Math.max(22, Math.abs(dx) * 0.28));
  return `M ${edge.source.x} ${edge.source.y} C ${edge.source.x + direction * shoulder} ${edge.source.y}, ${edge.target.x - direction * shoulder} ${edge.target.y}, ${edge.target.x} ${edge.target.y}`;
}

function MeshNode({ node, nodeStyle, color, emphasized, glowId, theme }) {
  const r = node.radius * (emphasized ? 1.25 : 1);
  const common = { fill: theme.graphBase, stroke: color, strokeWidth: emphasized ? 1.8 : 1.1 };
  let shape;
  if (nodeStyle === 'hex') {
    const points = Array.from({ length: 6 }, (_, index) => {
      const angle = -Math.PI / 2 + index * Math.PI / 3;
      return `${node.x + Math.cos(angle) * r * 1.55},${node.y + Math.sin(angle) * r * 1.55}`;
    }).join(' ');
    shape = <polygon points={points} {...common} />;
  } else if (nodeStyle === 'orb') {
    shape = <circle cx={node.x} cy={node.y} r={r * 1.25} {...common} />;
  } else {
    shape = <rect x={node.x - r} y={node.y - r} width={r * 2} height={r * 2} transform={`rotate(45 ${node.x} ${node.y})`} {...common} />;
  }
  return (
    <g filter={emphasized ? `url(#${glowId})` : undefined}>
      {shape}
      <circle cx={node.x} cy={node.y} r={Math.max(1.6, r * .28)} fill={color} />
      <line x1={node.x - r * .45} y1={node.y} x2={node.x + r * .45} y2={node.y} stroke={color} strokeOpacity=".7" />
    </g>
  );
}
