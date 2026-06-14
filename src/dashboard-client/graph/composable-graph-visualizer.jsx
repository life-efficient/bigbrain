import React, { forwardRef, useId, useMemo, useState } from 'react';

import {
  buildCurvedEdgePath,
  buildJarvisLayout,
  buildNeuralMeshLayout,
  buildSignalBloomLayout,
  pickLabelNodes,
} from './shared.js';
import {
  GraphBackdropDefs,
  GraphFixedLabels,
  GraphTypeDefs,
  useGraphTheme,
  useGraphViewport,
} from './visualizer-core.jsx';

const LAYOUT_BUILDERS = {
  orbital: buildJarvisLayout,
  lanes: buildNeuralMeshLayout,
  clusters: buildSignalBloomLayout,
};

export const ComposableGraphVisualizer = forwardRef(function ComposableGraphVisualizer({
  graph,
  onNodeOpen,
  nodeStyle = 'orb',
  arcStyle = 'straight',
  layoutStyle = 'orbital',
  labelStyle = 'selected',
}, ref) {
  const theme = useGraphTheme();
  const defsId = useId().replace(/:/g, '-');
  const [hoveredSlug, setHoveredSlug] = useState(null);
  const [activeSlug, setActiveSlug] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const buildLayout = LAYOUT_BUILDERS[layoutStyle] || buildJarvisLayout;
  const laidOut = useMemo(() => buildLayout(graph), [buildLayout, graph]);
  const { viewport, bind } = useGraphViewport(ref, laidOut, {
    onDragStateChange(dragging) {
      setIsDragging(dragging);
      if (dragging) {
        setHoveredSlug(null);
      }
    },
  });
  const labelCount = layoutStyle === 'clusters' ? 6 : layoutStyle === 'lanes' ? 5 : 4;
  const labeled = useMemo(() => {
    const next = new Set();
    if (labelStyle === 'off') {
      // Keep manual hover/selection labels visible even when the base mode is off.
    } else if (labelStyle === 'all') {
      laidOut.nodes.forEach((node) => next.add(node.slug));
    } else {
      pickLabelNodes(laidOut.nodes, labelCount).forEach((slug) => next.add(slug));
    }
    if (activeSlug) next.add(activeSlug);
    if (hoveredSlug) next.add(hoveredSlug);
    return next;
  }, [activeSlug, hoveredSlug, labelCount, labelStyle, laidOut]);

  return (
    <div className="graph-canvas-shell">
      <svg
        className="graph-svg futuristic-graph composable-graph"
        viewBox={`0 0 ${laidOut.width} ${laidOut.height}`}
        preserveAspectRatio="xMidYMid meet"
        {...bind}
      >
        <defs>
          <GraphBackdropDefs idPrefix={defsId} theme={theme} />
          <GraphTypeDefs idPrefix={defsId} />
        </defs>

        <rect width={laidOut.width} height={laidOut.height} fill={theme.graphBase} />
        <rect width={laidOut.width} height={laidOut.height} fill={`url(#${defsId}-surface-gradient)`} opacity="0.3" />
        <rect width={laidOut.width} height={laidOut.height} fill={`url(#${defsId}-scanline-pattern)`} opacity="0.18" />

        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
          <LayoutBackdrop layoutStyle={layoutStyle} laidOut={laidOut} theme={theme} />
          <ArcLayer arcStyle={arcStyle} laidOut={laidOut} theme={theme} />
          <NodeLayer
            nodeStyle={nodeStyle}
            laidOut={laidOut}
            theme={theme}
            onNodeOpen={onNodeOpen}
            activeSlug={activeSlug}
            hoveredSlug={hoveredSlug}
            isDragging={isDragging}
            onActiveSlugChange={setActiveSlug}
            onHoveredSlugChange={setHoveredSlug}
          />
        </g>

        <GraphFixedLabels nodes={laidOut.nodes} viewport={viewport} labeled={labeled} theme={theme} />
      </svg>
    </div>
  );
});

function LayoutBackdrop({ layoutStyle, laidOut, theme }) {
  if (layoutStyle === 'lanes') {
    return (
      <>
        <rect width={laidOut.width} height={laidOut.height} fill={theme.graphBase} opacity="0.18" />
        {laidOut.lanes?.map((x) => (
          <line
            key={x}
            x1={x}
            y1="0"
            x2={x}
            y2={laidOut.height}
            stroke={theme.graphGrid}
            strokeDasharray="8 22"
            strokeOpacity="0.9"
          />
        ))}
        {Array.from({ length: 8 }, (_, index) => {
          const y = 90 + index * 92;
          return (
            <line
              key={y}
              x1="0"
              y1={y}
              x2={laidOut.width}
              y2={y}
              stroke={theme.graphGrid}
              strokeOpacity="0.2"
            />
          );
        })}
      </>
    );
  }

  if (layoutStyle === 'clusters') {
    return (
      <>
        {laidOut.clusters?.map((cluster) => (
          <circle
            key={cluster.type}
            cx={cluster.x}
            cy={cluster.y}
            r={cluster.radius}
            fill="none"
            stroke={theme.graphCluster}
            strokeWidth="1"
            strokeOpacity="0.5"
          />
        ))}
        {laidOut.clusters?.map((cluster) => (
          <circle
            key={`${cluster.type}-halo`}
            cx={cluster.x}
            cy={cluster.y}
            r={cluster.radius * 0.72}
            fill="none"
            stroke={theme.graphGrid}
            strokeOpacity="0.16"
          />
        ))}
      </>
    );
  }

  return (
    <>
      {laidOut.rings?.map((radius) => (
        <circle
          key={radius}
          cx={laidOut.centerX}
          cy={laidOut.centerY}
          r={radius}
          fill="none"
          stroke={theme.graphRing}
          strokeDasharray="10 14"
          strokeOpacity="0.85"
        />
      ))}
      {Array.from({ length: 18 }, (_, index) => {
        const angle = (index / 18) * Math.PI * 2;
        return (
          <line
            key={index}
            x1={laidOut.centerX + Math.cos(angle) * 72}
            y1={laidOut.centerY + Math.sin(angle) * 72}
            x2={laidOut.centerX + Math.cos(angle) * 520}
            y2={laidOut.centerY + Math.sin(angle) * 520}
            stroke={theme.graphGrid}
            strokeOpacity="0.6"
          />
        );
      })}
    </>
  );
}

function ArcLayer({ arcStyle, laidOut, theme }) {
  return (
    <>
      {laidOut.edges.map((edge) => {
        if (arcStyle === 'curve') {
          return (
            <path
              key={edge.key}
              d={buildCurvedEdgePath(edge, 0.12)}
              fill="none"
              stroke={theme.graphEdgeStrong}
              strokeOpacity="0.34"
              strokeWidth="1.05"
            />
          );
        }

        if (arcStyle === 'beam') {
          const d = buildCurvedEdgePath(edge, 0.06);
          return (
            <g key={edge.key}>
              <path
                d={d}
                fill="none"
                stroke={theme.graphEdge}
                strokeOpacity="0.12"
                strokeWidth="4.5"
                strokeLinecap="round"
              />
              <path
                d={d}
                fill="none"
                stroke={theme.graphEdgeStrong}
                strokeOpacity="0.42"
                strokeWidth="1.1"
                strokeLinecap="round"
              />
            </g>
          );
        }

        return (
          <line
            key={edge.key}
            x1={edge.source.x}
            y1={edge.source.y}
            x2={edge.target.x}
            y2={edge.target.y}
            stroke={theme.graphEdgeStrong}
            strokeOpacity="0.38"
            strokeWidth="1"
            strokeLinecap="round"
          />
        );
      })}
    </>
  );
}

function NodeLayer({
  nodeStyle,
  laidOut,
  theme,
  onNodeOpen,
  activeSlug,
  hoveredSlug,
  isDragging,
  onActiveSlugChange,
  onHoveredSlugChange,
}) {
  return laidOut.nodes.map((node) => (
    <g
      key={node.slug}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onPointerEnter={() => {
        if (isDragging) return;
        onHoveredSlugChange(node.slug);
      }}
      onPointerLeave={() => {
        if (isDragging) return;
        onHoveredSlugChange((current) => (current === node.slug ? null : current));
      }}
      onClick={(event) => {
        event.stopPropagation();
        onActiveSlugChange(node.slug);
        onNodeOpen?.(node.slug);
      }}
      style={{ cursor: 'pointer' }}
    >
      {renderNodeShape(node, nodeStyle, theme, activeSlug === node.slug || hoveredSlug === node.slug)}
    </g>
  ));
}

function renderNodeShape(node, nodeStyle, theme, emphasized) {
  const hitRadius = Math.max(14, node.radius * 2.9);
  if (nodeStyle === 'diamond') {
    const outer = node.radius * 2.2;
    const inner = Math.max(1.8, node.radius * 0.38);
    return (
      <>
        <circle
          cx={node.x}
          cy={node.y}
          r={hitRadius}
          fill="#ffffff"
          fillOpacity="0.001"
          stroke="none"
        />
        <rect
          x={node.x - outer / 2}
          y={node.y - outer / 2}
          width={outer}
          height={outer}
          fill="none"
          stroke={theme.graphNodeStroke}
          strokeWidth={emphasized ? '1.5' : '1'}
          transform={`rotate(45 ${node.x} ${node.y})`}
        />
        <rect
          x={node.x - outer * 0.34}
          y={node.y - outer * 0.34}
          width={outer * 0.68}
          height={outer * 0.68}
          fill="none"
          stroke={theme.graphGrid}
          strokeWidth="1"
          transform={`rotate(45 ${node.x} ${node.y})`}
          opacity={emphasized ? '0.82' : '0.52'}
        />
        <circle cx={node.x} cy={node.y} r={inner} fill={theme.accentStrong} />
      </>
    );
  }

  if (nodeStyle === 'hex') {
    const side = node.radius * 1.85;
    const d = buildHexPath(node.x, node.y, side);
    return (
      <>
        <circle
          cx={node.x}
          cy={node.y}
          r={hitRadius}
          fill="#ffffff"
          fillOpacity="0.001"
          stroke="none"
        />
        <path d={d} fill="none" stroke={theme.graphNodeStroke} strokeWidth={emphasized ? '1.5' : '1'} />
        <path d={buildHexPath(node.x, node.y, side * 0.72)} fill="none" stroke={theme.graphGrid} strokeWidth="1" opacity={emphasized ? '0.64' : '0.34'} />
        <circle cx={node.x} cy={node.y} r={Math.max(1.8, node.radius * 0.32)} fill={theme.accentStrong} />
      </>
    );
  }

  return (
    <>
      <circle
        cx={node.x}
        cy={node.y}
        r={hitRadius}
        fill="#ffffff"
        fillOpacity="0.001"
        stroke="none"
      />
      <circle
        cx={node.x}
        cy={node.y}
        r={node.radius * 1.55}
        fill="none"
        stroke={theme.graphNodeStroke}
        strokeWidth={emphasized ? '1.5' : '1'}
      />
      <circle
        cx={node.x}
        cy={node.y}
        r={node.radius * 0.96}
        fill="none"
        stroke={theme.graphGrid}
        strokeWidth="1"
        opacity={emphasized ? '0.78' : '0.48'}
      />
      <circle cx={node.x} cy={node.y} r={Math.max(1.8, node.radius * 0.4)} fill={theme.accentStrong} />
    </>
  );
}

function buildHexPath(x, y, side) {
  return `M ${x} ${y - side} L ${x + side * 0.86} ${y - side * 0.5} L ${x + side * 0.86} ${y + side * 0.5} L ${x} ${y + side} L ${x - side * 0.86} ${y + side * 0.5} L ${x - side * 0.86} ${y - side * 0.5} Z`;
}
