import React, { forwardRef, memo, useId, useMemo, useState } from 'react';

import { getGraphNodeColor } from './colors.js';
import { GraphTypeIcon } from './graph-type-icon.jsx';
import {
  getGraphNodeScreenScale,
  getGraphNodeSizeScale,
  getGraphNodeTransformScale,
} from './node-sizes.js';
import { buildCurvedEdgePath, buildSignalBloomLayout, pickLabelNodes } from './shared.js';
import {
  GraphBackdropDefs,
  GraphFixedLabels,
  GraphTypeDefs,
  PRESET_GRAPH_CLUSTER_LABEL_FONT_SIZE,
  PRESET_GRAPH_LABEL_FONT_SIZE,
  useGraphTheme,
  useGraphViewport,
} from './visualizer-core.jsx';

const BLOOM_ANIMATED_NODE_LIMIT = 72;
const BLOOM_ANIMATED_LINK_LIMIT = 120;

/**
 * Signal Bloom is a deliberately theatrical cluster view: page types become
 * isolated radar sectors, while relationships light up as curved signal arcs.
 * It shares the graph controls' public options, but owns its visual language.
 */
export const SignalBloomVisualizer = forwardRef(function SignalBloomVisualizer({
  graph,
  onNodeOpen,
  nodeShape = 'orb',
  nodeFill = 'outline',
  nodeIcon = 'none',
  nodeSize = 'medium',
  labelStyle = 'selected',
  colorMode = 'updated',
  activeSlug = null,
  onActiveSlugChange,
}, ref) {
  const theme = useGraphTheme();
  const nodeSizeScale = getGraphNodeSizeScale(nodeSize);
  const defsId = useId().replace(/:/g, '-');
  const [hoveredSlug, setHoveredSlug] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const laidOut = useMemo(() => buildSignalBloomLayout(graph), [graph]);
  const viewportBounds = { minScale: 0.35, maxScale: 4 };
  const { viewport, bind } = useGraphViewport(ref, laidOut, {
    ...viewportBounds,
    onDragStateChange(dragging) {
      setIsDragging(dragging);
      if (dragging) setHoveredSlug(null);
    },
  });
  const nodeScreenScale = getGraphNodeScreenScale(nodeSizeScale, viewport.scale, viewportBounds);
  const nodeTransformScale = getGraphNodeTransformScale(nodeSizeScale, viewport.scale, viewportBounds);
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
          .bloom-link-animated { stroke-dasharray: 80; animation: bloom-link-in .9s ease-out both; }
          .bloom-node { transform-box: fill-box; transform-origin: center; animation: bloom-node-in .58s cubic-bezier(.2,.9,.25,1.15) both; }
          .bloom-scan { animation: bloom-pulse 3.6s ease-in-out infinite; }
          @media (prefers-reduced-motion: reduce) { .bloom-sector, .bloom-link-animated, .bloom-node, .bloom-scan { animation: none !important; } }
        `}</style>

        <g
          transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}
          style={{ '--graph-node-scale': nodeTransformScale }}
        >
          <BloomSectors laidOut={laidOut} theme={theme} />
          <BloomLinks laidOut={laidOut} theme={theme} />
          {laidOut.nodes.map((node, index) => (
            <BloomNodeItem
              key={node.slug}
              node={node}
              animated={index < BLOOM_ANIMATED_NODE_LIMIT}
              animationIndex={index}
              emphasized={activeSlug === node.slug || hoveredSlug === node.slug}
              isDragging={isDragging}
              setHoveredSlug={setHoveredSlug}
              onActiveSlugChange={onActiveSlugChange}
              onNodeOpen={onNodeOpen}
              nodeShape={nodeShape}
              nodeFill={nodeFill}
              nodeIcon={nodeIcon}
              colorMode={colorMode}
              theme={theme}
              glowId={`${defsId}-signal-glow`}
            />
          ))}
        </g>

        <GraphFixedLabels
          nodes={laidOut.nodes}
          viewport={viewport}
          labeled={labeled}
          theme={theme}
          fontSize={PRESET_GRAPH_LABEL_FONT_SIZE}
          nodeScreenScale={nodeScreenScale}
        />
      </svg>
    </div>
  );
});

const BloomSectors = memo(function BloomSectors({ laidOut, theme }) {
  return laidOut.clusters.map((cluster, index) => (
    <g className="bloom-sector" key={cluster.type} style={{ animationDelay: `${index * 65}ms` }}>
      <circle cx={cluster.x} cy={cluster.y} r={cluster.radius + 14} fill={theme.graphInset} fillOpacity="0.08" stroke={theme.graphCluster} strokeOpacity="0.56" />
      <circle className="bloom-scan" cx={cluster.x} cy={cluster.y} r={cluster.radius * 0.78} fill="none" stroke={theme.graphGrid} strokeDasharray="3 10" />
      <path d={sectorTicks(cluster.x, cluster.y, cluster.radius + 14)} fill="none" stroke={theme.graphEdgeStrong} strokeOpacity="0.62" />
      <text
        x={cluster.x}
        y={cluster.y - cluster.radius - 25}
        textAnchor="middle"
        fill={theme.graphMutedLabel}
        fontSize={PRESET_GRAPH_CLUSTER_LABEL_FONT_SIZE}
        letterSpacing="0.18em"
      >
        {String(cluster.type).toUpperCase()}
      </text>
    </g>
  ));
});

const BloomLinks = memo(function BloomLinks({ laidOut, theme }) {
  return laidOut.edges.map((edge, index) => {
    const internal = edge.source.type === edge.target.type;
    const path = buildCurvedEdgePath(edge, internal ? 0.2 : 0.08);
    const relationshipClass = index < BLOOM_ANIMATED_LINK_LIMIT ? 'graph-relationship-arc' : undefined;
    return (
      <g key={edge.key}>
        {internal && <path className={relationshipClass ? `${relationshipClass} graph-relationship-arc-glow` : undefined} d={path} fill="none" stroke={theme.graphEdge} strokeOpacity="0.09" strokeWidth="5" />}
        <path
          className={relationshipClass ? `${relationshipClass} bloom-link-animated` : undefined}
          d={path}
          fill="none"
          stroke={internal ? theme.graphEdgeStrong : theme.graphEdge}
          strokeOpacity={internal ? 0.48 : 0.22}
          strokeWidth={internal ? 1.15 : 0.8}
          style={index < BLOOM_ANIMATED_LINK_LIMIT ? { animationDelay: `${120 + index * 3}ms` } : undefined}
        />
      </g>
    );
  });
});

const BloomNodeItem = memo(function BloomNodeItem({
  node,
  animated,
  animationIndex,
  emphasized,
  isDragging,
  setHoveredSlug,
  onActiveSlugChange,
  onNodeOpen,
  nodeShape,
  nodeFill,
  nodeIcon,
  colorMode,
  theme,
  glowId,
}) {
  return (
    <g
      className={animated ? 'bloom-node' : undefined}
      data-graph-node-slug={node.slug}
      style={animated
        ? { cursor: 'pointer', animationDelay: `${170 + animationIndex * 7}ms` }
        : { cursor: 'pointer' }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerEnter={() => { if (!isDragging) setHoveredSlug(node.slug); }}
      onPointerLeave={() => { if (!isDragging) setHoveredSlug((slug) => slug === node.slug ? null : slug); }}
      onClick={(event) => {
        event.stopPropagation();
        onActiveSlugChange?.(node.slug);
        onNodeOpen?.(node.slug);
      }}
    >
      <g className="graph-node-screen-scale">
        <BloomNode node={node} nodeShape={nodeShape} nodeFill={nodeFill} nodeIcon={nodeIcon} colorMode={colorMode} emphasized={emphasized} theme={theme} glowId={glowId} />
      </g>
    </g>
  );
});

function BloomNode({ node, nodeShape, nodeFill, nodeIcon, colorMode, emphasized, theme, glowId }) {
  const color = getGraphNodeColor(node, colorMode) || theme.graphNodeStroke;
  const size = node.radius * (emphasized ? 1.95 : 1.62);
  const common = {
    fill: nodeFill === 'solid' ? color : 'none',
    fillOpacity: nodeFill === 'solid' ? '0.78' : '1',
    stroke: nodeFill === 'none' ? 'none' : color,
    strokeWidth: emphasized ? 1.8 : 1,
  };
  let body;
  if (nodeShape === 'diamond') {
    body = <rect x={node.x - size * 0.62} y={node.y - size * 0.62} width={size * 1.24} height={size * 1.24} transform={`rotate(45 ${node.x} ${node.y})`} {...common} />;
  } else if (nodeShape === 'hex') {
    body = <path d={hexPath(node.x, node.y, size)} {...common} />;
  } else if (nodeShape === 'pixel') {
    body = <rect x={node.x - size} y={node.y - size} width={size * 2} height={size * 2} shapeRendering="crispEdges" {...common} />;
  } else {
    body = <circle cx={node.x} cy={node.y} r={size} {...common} />;
  }
  return (
    <>
      <circle cx={node.x} cy={node.y} r={Math.max(15, size * 1.75)} fill="#fff" fillOpacity="0.001" />
      {emphasized && <circle cx={node.x} cy={node.y} r={size * 1.65} fill="none" stroke={color} strokeOpacity="0.35" filter={`url(#${glowId})`} />}
      {nodeFill !== 'none' ? body : null}
      <GraphTypeIcon node={node} color={color} emphasized={emphasized} background={theme.graphBase} nodeFill={nodeFill} iconStyle={nodeIcon} />
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
