import React, { forwardRef, useId, useMemo, useState } from 'react';

import { getGraphNodeColor } from './colors.js';
import { normalizeGraph, pickLabelNodes } from './shared.js';
import { GraphBackdropDefs, useGraphTheme, useGraphViewport } from './visualizer-core.jsx';

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** A radar-command rendering with a deterministic, collision-free phyllotaxis layout. */
export const JarvisHudVisualizer = forwardRef(function JarvisHudVisualizer({
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
  const laidOut = useMemo(() => buildOrbitalLayout(graph), [graph]);
  const { viewport, bind } = useGraphViewport(ref, laidOut, {
    minScale: 0.3,
    maxScale: 4.5,
    onDragStateChange(dragging) {
      setIsDragging(dragging);
      if (dragging) setHoveredSlug(null);
    },
  });
  const labels = useMemo(() => {
    const next = labelStyle === 'all'
      ? new Set(laidOut.nodes.map((node) => node.slug))
      : labelStyle === 'selected'
        ? pickLabelNodes(laidOut.nodes, 10)
        : new Set();
    if (activeSlug) next.add(activeSlug);
    if (hoveredSlug) next.add(hoveredSlug);
    return next;
  }, [activeSlug, hoveredSlug, labelStyle, laidOut]);

  return (
    <div className="graph-canvas-shell">
      <svg
        className="graph-svg futuristic-graph jarvis-graph"
        viewBox={`0 0 ${laidOut.width} ${laidOut.height}`}
        preserveAspectRatio="xMidYMid meet"
        aria-label="Jarvis orbital knowledge graph"
        {...bind}
      >
        <defs>
          <GraphBackdropDefs idPrefix={defsId} theme={theme} />
          <radialGradient id={`${defsId}-radar`}>
            <stop offset="0" stopColor="#22d3ee" stopOpacity="0.12" />
            <stop offset="0.52" stopColor="#0891b2" stopOpacity="0.035" />
            <stop offset="1" stopColor="#020617" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${defsId}-sweep`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#67e8f9" stopOpacity="0" />
            <stop offset="1" stopColor="#67e8f9" stopOpacity="0.18" />
          </linearGradient>
          <filter id={`${defsId}-cyan-glow`} x="-180%" y="-180%" width="460%" height="460%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <rect width={laidOut.width} height={laidOut.height} fill="#03070d" />
        <rect width={laidOut.width} height={laidOut.height} fill={`url(#${defsId}-grid-pattern)`} opacity="0.38" />
        <rect width={laidOut.width} height={laidOut.height} fill={`url(#${defsId}-scanline-pattern)`} opacity="0.24" />

        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
          <RadarField layout={laidOut} defsId={defsId} />

          <g className="jarvis-links">
            {laidOut.edges.map((edge, index) => {
              const path = buildInwardArc(edge, laidOut);
              const selected = activeSlug && (edge.source.slug === activeSlug || edge.target.slug === activeSlug);
              return (
                <g key={edge.key} opacity={selected ? 1 : 0.62}>
                  <path d={path} fill="none" stroke="#0e7490" strokeOpacity={selected ? 0.34 : 0.12} strokeWidth={selected ? 5 : 2.5} />
                  <path d={path} fill="none" stroke={selected ? '#a5f3fc' : '#22d3ee'} strokeOpacity={selected ? 0.9 : 0.34} strokeWidth={selected ? 1.5 : 0.75} strokeDasharray="5 7">
                    <animate attributeName="stroke-dashoffset" from="72" to="0" dur={`${1.6 + (index % 8) * 0.18}s`} repeatCount="indefinite" />
                    <animate attributeName="opacity" from="0" to="1" dur="0.8s" begin={`${Math.min(index, 80) * 0.008}s`} fill="freeze" />
                  </path>
                </g>
              );
            })}
          </g>

          {laidOut.nodes.map((node, index) => {
            const emphasized = node.slug === activeSlug || node.slug === hoveredSlug;
            const color = getGraphNodeColor(node, colorMode) || '#d4d4d8';
            return (
              <g
                key={node.slug}
                onPointerDown={(event) => event.stopPropagation()}
                onPointerEnter={() => { if (!isDragging) setHoveredSlug(node.slug); }}
                onPointerLeave={() => { if (!isDragging) setHoveredSlug((current) => current === node.slug ? null : current); }}
                onClick={(event) => {
                  event.stopPropagation();
                  onActiveSlugChange?.(node.slug);
                  onNodeOpen?.(node.slug);
                }}
                style={{ cursor: 'pointer' }}
              >
                <animateTransform
                  attributeName="transform"
                  type="translate"
                  from={`${laidOut.centerX} ${laidOut.centerY}`}
                  to={`${node.x} ${node.y}`}
                  dur={`${0.62 + Math.min(index, 100) * 0.007}s`}
                  begin={`${Math.min(index, 140) * 0.004}s`}
                  calcMode="spline"
                  keySplines="0.16 1 0.3 1"
                  fill="freeze"
                />
                <g opacity="0">
                  <animate attributeName="opacity" from="0" to="1" dur="0.28s" begin={`${0.12 + Math.min(index, 140) * 0.004}s`} fill="freeze" />
                  <circle r={Math.max(16, node.radius * 2.2)} fill="#fff" fillOpacity="0.001" />
                  {emphasized ? (
                    <circle r={node.radius * 2.5} fill="none" stroke={color} strokeOpacity="0.62" strokeWidth="1" strokeDasharray="4 4" filter={`url(#${defsId}-cyan-glow)`}>
                      <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="5s" repeatCount="indefinite" />
                    </circle>
                  ) : null}
                  <JarvisNodeShape node={node} styleName={nodeStyle} color={color} emphasized={emphasized} />
                </g>
              </g>
            );
          })}
        </g>

        <HudLabels nodes={laidOut.nodes} labels={labels} viewport={viewport} activeSlug={activeSlug} hoveredSlug={hoveredSlug} />
        <HudChrome layout={laidOut} />
      </svg>
    </div>
  );
});

function RadarField({ layout, defsId }) {
  const maxRadius = Math.min(layout.width, layout.height) * 0.46;
  return (
    <g pointerEvents="none">
      <circle cx={layout.centerX} cy={layout.centerY} r={maxRadius} fill={`url(#${defsId}-radar)`} opacity="0">
        <animate attributeName="opacity" from="0" to="1" dur="0.8s" fill="freeze" />
      </circle>
      {Array.from({ length: 8 }, (_, index) => (index + 1) * maxRadius / 8).map((radius) => (
        <circle key={radius} cx={layout.centerX} cy={layout.centerY} r={radius} fill="none" stroke="#22d3ee" strokeOpacity="0.11" strokeWidth="1" strokeDasharray={radius % 2 ? '3 9' : '14 10'} />
      ))}
      {Array.from({ length: 24 }, (_, index) => {
        const angle = index * TAU / 24;
        return <line key={index} x1={layout.centerX + Math.cos(angle) * 38} y1={layout.centerY + Math.sin(angle) * 38} x2={layout.centerX + Math.cos(angle) * maxRadius} y2={layout.centerY + Math.sin(angle) * maxRadius} stroke="#22d3ee" strokeOpacity="0.055" />;
      })}
      <path d={`M ${layout.centerX} ${layout.centerY} L ${layout.centerX} ${layout.centerY - maxRadius} A ${maxRadius} ${maxRadius} 0 0 1 ${layout.centerX + maxRadius * 0.45} ${layout.centerY - maxRadius * 0.89} Z`} fill={`url(#${defsId}-sweep)`} opacity="0.62">
        <animateTransform attributeName="transform" type="rotate" from={`0 ${layout.centerX} ${layout.centerY}`} to={`360 ${layout.centerX} ${layout.centerY}`} dur="12s" repeatCount="indefinite" />
      </path>
      <circle cx={layout.centerX} cy={layout.centerY} r="30" fill="none" stroke="#67e8f9" strokeOpacity="0.62" strokeDasharray="7 5">
        <animateTransform attributeName="transform" type="rotate" from={`0 ${layout.centerX} ${layout.centerY}`} to={`360 ${layout.centerX} ${layout.centerY}`} dur="8s" repeatCount="indefinite" />
      </circle>
      <circle cx={layout.centerX} cy={layout.centerY} r="4" fill="#a5f3fc" />
    </g>
  );
}

function JarvisNodeShape({ node, styleName, color, emphasized }) {
  const radius = node.radius * (emphasized ? 1.18 : 1);
  const common = { fill: '#020617', stroke: color, strokeWidth: emphasized ? 1.8 : 1.1 };
  let shape;
  if (styleName === 'diamond') {
    const side = radius * 1.55;
    shape = <path d={`M 0 ${-side} L ${side} 0 L 0 ${side} L ${-side} 0 Z`} {...common} />;
  } else if (styleName === 'hex') {
    const side = radius * 1.45;
    shape = <path d={hexPath(side)} {...common} />;
  } else {
    shape = <circle r={radius * 1.42} {...common} />;
  }
  return (
    <>
      <circle r={radius * 2} fill={color} fillOpacity={emphasized ? 0.16 : 0.07} />
      {shape}
      <circle r={Math.max(1.8, radius * 0.34)} fill={color} />
      <line x1={-radius * 0.7} y1="0" x2={radius * 0.7} y2="0" stroke={color} strokeOpacity="0.42" />
    </>
  );
}

function HudLabels({ nodes, labels, viewport, activeSlug, hoveredSlug }) {
  return (
    <g pointerEvents="none">
      {nodes.filter((node) => labels.has(node.slug)).map((node) => {
        const x = viewport.x + node.x * viewport.scale + node.radius * viewport.scale + 9;
        const y = viewport.y + node.y * viewport.scale;
        const active = node.slug === activeSlug || node.slug === hoveredSlug;
        return (
          <g key={node.slug} transform={`translate(${x} ${y})`}>
            <path d="M 0 0 L 8 0 L 12 -4" fill="none" stroke="#67e8f9" strokeOpacity={active ? 0.9 : 0.4} />
            <text x="15" y="-2" fill={active ? '#cffafe' : '#a5f3fc'} fillOpacity={active ? 1 : 0.76} fontSize={active ? 11 : 9.5} letterSpacing="0.07em">{truncate(node.title, 30)}</text>
          </g>
        );
      })}
    </g>
  );
}

function HudChrome({ layout }) {
  return (
    <g pointerEvents="none" fill="#67e8f9" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">
      <path d="M 28 60 L 28 28 L 60 28 M 1220 28 L 1252 28 L 1252 60" fill="none" stroke="#22d3ee" strokeOpacity="0.55" transform={`scale(${layout.width / 1280} ${layout.height / 920})`} />
      <text x="34" y="50" fontSize="10" fillOpacity="0.62" letterSpacing="0.18em">ORBITAL KNOWLEDGE ARRAY</text>
      <text x={layout.width - 34} y="50" fontSize="9" fillOpacity="0.46" textAnchor="end">{String(layout.nodes.length).padStart(4, '0')} ENTITIES · {String(layout.edges.length).padStart(4, '0')} LINKS</text>
    </g>
  );
}

function buildOrbitalLayout(graph) {
  const count = Array.isArray(graph?.nodes) ? graph.nodes.length : 0;
  // The golden-angle spiral's closest neighbors sit roughly one spacing unit
  // apart. Keep that unit wider than two maximum node glyphs, then grow the
  // canvas with the population so dense brains never get crushed to fit.
  const spacing = 36;
  const extent = Math.max(1280, Math.ceil(Math.sqrt(Math.max(count, 1)) * spacing * 2 + 180));
  const width = Math.max(1440, extent);
  const height = Math.max(1040, extent);
  const layout = normalizeGraph(graph, { width, height });
  const sorted = [...layout.nodes].sort((a, b) => (b.degree || 0) - (a.degree || 0) || a.slug.localeCompare(b.slug));
  sorted.forEach((node, index) => {
    if (index === 0) {
      node.x = layout.centerX;
      node.y = layout.centerY;
      return;
    }
    const radius = spacing * Math.sqrt(index);
    const angle = index * GOLDEN_ANGLE - Math.PI / 2;
    node.x = layout.centerX + Math.cos(angle) * radius;
    node.y = layout.centerY + Math.sin(angle) * radius;
  });
  return layout;
}

function buildInwardArc(edge, layout) {
  const midX = (edge.source.x + edge.target.x) / 2;
  const midY = (edge.source.y + edge.target.y) / 2;
  const distance = Math.hypot(edge.target.x - edge.source.x, edge.target.y - edge.source.y);
  const pull = Math.min(0.36, 28 / Math.max(distance, 1));
  const controlX = midX + (layout.centerX - midX) * pull;
  const controlY = midY + (layout.centerY - midY) * pull;
  return `M ${edge.source.x} ${edge.source.y} Q ${controlX} ${controlY} ${edge.target.x} ${edge.target.y}`;
}

function hexPath(side) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = -Math.PI / 2 + index * TAU / 6;
    return `${index ? 'L' : 'M'} ${Math.cos(angle) * side} ${Math.sin(angle) * side}`;
  }).join(' ') + ' Z';
}

function truncate(value, max) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
