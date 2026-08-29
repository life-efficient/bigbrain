import React, { forwardRef, memo, useId, useMemo, useState } from 'react';

import { getGraphNodeColor } from './colors.js';
import { GraphTypeIcon } from './graph-type-icon.jsx';
import {
  getGraphNodeScreenScale,
  getGraphNodeSizeScale,
  getGraphNodeTransformScale,
} from './node-sizes.js';
import {
  buildCurvedEdgePath,
  buildJarvisLayout,
  buildNeuralMeshLayout,
  buildNetworkConstellationLayout,
  buildSignalBloomLayout,
  buildSpaciousConstellationLayout,
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
  spacious: buildSpaciousConstellationLayout,
  network: buildNetworkConstellationLayout,
};

export const ComposableGraphVisualizer = forwardRef(function ComposableGraphVisualizer({
  graph,
  onNodeOpen,
  nodeShape = 'orb',
  nodeFill = 'outline',
  nodeIcon = 'none',
  nodeSize = 'medium',
  arcStyle = 'straight',
  arcAnimation = 'instant',
  layoutStyle = 'orbital',
  labelStyle = 'selected',
  colorMode = 'updated',
  typeColors,
  labelFontSize,
  minScale,
  maxScale,
  activeSlug = null,
  onActiveSlugChange,
}, ref) {
  const theme = useGraphTheme();
  const nodeSizeScale = getGraphNodeSizeScale(nodeSize);
  const defsId = useId().replace(/:/g, '-');
  const [hoveredSlug, setHoveredSlug] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const buildLayout = LAYOUT_BUILDERS[layoutStyle] || buildJarvisLayout;
  const laidOut = useMemo(() => buildLayout(graph), [buildLayout, graph]);
  const viewportBounds = { minScale: minScale ?? 0.42, maxScale: maxScale ?? 3.4 };
  const { viewport, bind } = useGraphViewport(ref, laidOut, {
    minScale,
    maxScale,
    onDragStateChange(dragging) {
      setIsDragging(dragging);
      if (dragging) {
        setHoveredSlug(null);
      }
    },
  });
  const nodeScreenScale = getGraphNodeScreenScale(nodeSizeScale, viewport.scale, viewportBounds);
  const nodeTransformScale = getGraphNodeTransformScale(nodeSizeScale, viewport.scale, viewportBounds);
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

        <g
          transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}
          style={{ '--graph-node-scale': nodeTransformScale }}
        >
          <LayoutBackdrop layoutStyle={layoutStyle} laidOut={laidOut} theme={theme} />
          <ArcLayer
            arcStyle={arcStyle}
            arcAnimation={arcAnimation}
            focusedSlug={activeSlug || hoveredSlug}
            laidOut={laidOut}
            theme={theme}
          />
          <NodeLayer
            nodeShape={nodeShape}
            nodeFill={nodeFill}
            nodeIcon={nodeIcon}
            colorMode={colorMode}
            typeColors={typeColors}
            laidOut={laidOut}
            theme={theme}
            onNodeOpen={onNodeOpen}
            activeSlug={activeSlug}
            hoveredSlug={hoveredSlug}
            isDragging={isDragging}
            onActiveSlugChange={onActiveSlugChange}
            onHoveredSlugChange={setHoveredSlug}
          />
        </g>

        <GraphFixedLabels
          nodes={laidOut.nodes}
          viewport={viewport}
          labeled={labeled}
          theme={theme}
          fontSize={labelFontSize}
          nodeScreenScale={nodeScreenScale}
        />
      </svg>
    </div>
  );
});

function LayoutBackdrop({ layoutStyle, laidOut, theme }) {
  if (layoutStyle === 'network') return null;
  if (layoutStyle === 'spacious') {
    return (
      <>
        {laidOut.clusters?.map((cluster) => (
          <circle key={cluster.key} cx={cluster.x} cy={cluster.y} r={cluster.radius + 18} fill={theme.graphCluster} fillOpacity="0.025" stroke={theme.graphGrid} strokeOpacity="0.18" />
        ))}
      </>
    );
  }

  if (layoutStyle === 'lanes') {
    return (
      <>
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

const ArcLayer = memo(function ArcLayer({ arcStyle, arcAnimation, focusedSlug, laidOut, theme }) {
  return (
    <>
      {laidOut.edges.map((edge, index) => {
        const relationshipClass = index < 180 ? 'graph-relationship-arc' : undefined;
        const focused = Boolean(focusedSlug && (edge.source.slug === focusedSlug || edge.target.slug === focusedSlug));
        const hoverClass = focused && arcAnimation !== 'none' && arcAnimation !== 'instant'
          ? `graph-arc-hover-${arcAnimation}`
          : undefined;
        const className = [relationshipClass, hoverClass].filter(Boolean).join(' ') || undefined;
        if (arcStyle === 'curve') {
          return (
            <path
              key={edge.key}
              className={className}
              d={buildCurvedEdgePath(edge, 0.12)}
              fill="none"
              pathLength="1"
              stroke={theme.graphEdgeStrong}
              strokeOpacity="0.34"
              strokeWidth="1.05"
            />
          );
        }

        return (
          <line
            key={edge.key}
            className={className}
            x1={edge.source.x}
            y1={edge.source.y}
            x2={edge.target.x}
            y2={edge.target.y}
            stroke={theme.graphEdgeStrong}
            strokeOpacity="0.38"
            strokeWidth="1"
            strokeLinecap="round"
            pathLength="1"
          />
        );
      })}
    </>
  );
});

const NodeLayer = memo(function NodeLayer({
  nodeShape,
  nodeFill,
  nodeIcon,
  colorMode,
  typeColors,
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
      className="graph-node-screen-scale"
      data-graph-node-slug={node.slug}
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
        onActiveSlugChange?.(node.slug);
        onNodeOpen?.(node.slug);
      }}
      style={{ cursor: 'pointer' }}
    >
      {renderNodeShape(node, nodeShape, nodeFill, nodeIcon, theme, activeSlug === node.slug || hoveredSlug === node.slug, colorMode, typeColors)}
    </g>
  ));
});

function renderNodeShape(node, nodeShape, nodeFill, nodeIcon, theme, emphasized, colorMode, typeColors) {
  const hitRadius = Math.max(14, node.radius * 2.9);
  const nodeColor = getGraphNodeColor(node, colorMode, typeColors);
  const outerStroke = nodeColor || theme.graphNodeStroke;
  const shapeFill = nodeFill === 'solid' ? (nodeColor || theme.accentStrong) : 'none';
  const shapeFillOpacity = nodeFill === 'solid' ? '0.82' : '1';
  const shapeStroke = nodeFill === 'none' ? 'none' : outerStroke;
  const shapeStrokeWidth = emphasized ? '1.5' : '1';
  const shape = nodeShape === 'diamond'
    ? <rect x={node.x - node.radius * 1.1} y={node.y - node.radius * 1.1} width={node.radius * 2.2} height={node.radius * 2.2} fill={shapeFill} fillOpacity={shapeFillOpacity} stroke={shapeStroke} strokeWidth={shapeStrokeWidth} transform={`rotate(45 ${node.x} ${node.y})`} />
    : nodeShape === 'hex'
      ? <path d={buildHexPath(node.x, node.y, node.radius * 1.85)} fill={shapeFill} fillOpacity={shapeFillOpacity} stroke={shapeStroke} strokeWidth={shapeStrokeWidth} />
      : nodeShape === 'pixel'
        ? <rect x={node.x - node.radius * 1.7} y={node.y - node.radius * 1.7} width={node.radius * 3.4} height={node.radius * 3.4} fill={shapeFill} fillOpacity={shapeFillOpacity} stroke={shapeStroke} strokeWidth={shapeStrokeWidth} shapeRendering="crispEdges" />
        : <circle cx={node.x} cy={node.y} r={node.radius * 1.55} fill={shapeFill} fillOpacity={shapeFillOpacity} stroke={shapeStroke} strokeWidth={shapeStrokeWidth} />;
  return (
    <>
      <circle cx={node.x} cy={node.y} r={hitRadius} fill="#ffffff" fillOpacity="0.001" stroke="none" />
      {nodeFill !== 'none' ? shape : null}
      <GraphTypeIcon node={node} color={outerStroke} emphasized={emphasized} background={theme.graphBase} nodeFill={nodeFill} iconStyle={nodeIcon} />
    </>
  );
}

function buildHexPath(x, y, side) {
  return `M ${x} ${y - side} L ${x + side * 0.86} ${y - side * 0.5} L ${x + side * 0.86} ${y + side * 0.5} L ${x} ${y + side} L ${x - side * 0.86} ${y + side * 0.5} L ${x - side * 0.86} ${y - side * 0.5} Z`;
}
