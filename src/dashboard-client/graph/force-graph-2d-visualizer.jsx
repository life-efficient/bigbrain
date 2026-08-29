import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import ForceGraph2D from 'force-graph';

import { getGraphNodeColor } from './colors.js';
import { arcAnimationProgress, blendArcColors, cancelArcAnimation, startArcAnimation } from './arc-animation.js';
import { graphTypeIconSvg } from './graph-type-icon-data.js';
import { getGraphNodeSizeScale } from './node-sizes.js';
import { PRESET_GRAPH_LABEL_FONT_SIZE, useGraphTheme } from './visualizer-core.jsx';

const DEFAULT_NODE_COLOR = '#E4E4E7';
const DEFAULT_LINK_COLOR = '#657083';
const FIT_TO_CANVAS_DURATION = 700;
const FIT_TO_CANVAS_PADDING = 42;
const FORCE_GRAPH_ICON_CACHE = new Map();

export const ForceGraph2DVisualizer = forwardRef(function ForceGraph2DVisualizer({
  graph,
  onNodeOpen,
  nodeShape = 'orb',
  nodeFill = 'outline',
  nodeIcon = 'none',
  nodeSize = 'medium',
  arcStyle = 'curve',
  labelStyle = 'selected',
  colorMode = 'updated',
  typeColors,
  activeSlug = null,
  onActiveSlugChange,
}, ref) {
  const theme = useGraphTheme();
  const containerRef = useRef(null);
  const graphRef = useRef(null);
  const settingsRef = useRef({
    nodeShape,
    nodeFill,
    nodeIcon,
    nodeSize,
    arcStyle,
    labelStyle,
    colorMode,
    arcAnimation,
    typeColors,
    theme,
  });
  const activeSlugRef = useRef(activeSlug);
  const hoveredSlugRef = useRef(null);
  const labelSlugs = useMemo(() => getForceGraphLabelSlugs(graph?.nodes, labelStyle), [graph?.nodes, labelStyle]);

  settingsRef.current = {
    nodeShape,
    nodeFill,
    nodeIcon,
    nodeSize,
    arcStyle,
    labelStyle,
    colorMode,
    arcAnimation,
    typeColors,
    theme,
    labelSlugs,
  };
  activeSlugRef.current = activeSlug;

  useImperativeHandle(ref, () => ({
    zoomIn() {
      zoomCamera(graphRef.current, 1.18);
    },
    zoomOut() {
      zoomCamera(graphRef.current, 1 / 1.18);
    },
    resetView() {
      graphRef.current?.zoomToFit(FIT_TO_CANVAS_DURATION, FIT_TO_CANVAS_PADDING);
    },
  }), []);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    const forceGraph = new ForceGraph2D(containerRef.current);
    graphRef.current = forceGraph;

    const resize = () => {
      const width = Math.max(1, Math.floor(containerRef.current?.clientWidth || 1));
      const height = Math.max(1, Math.floor(containerRef.current?.clientHeight || 1));
      if (forceGraph.width() !== width) forceGraph.width(width);
      if (forceGraph.height() !== height) forceGraph.height(height);
    };
    resize();
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(resize)
      : null;
    resizeObserver?.observe(containerRef.current);
    window.addEventListener('resize', resize);

    forceGraph
      .backgroundColor(settingsRef.current.theme.graphBase)
      .nodeId('id')
      .nodeVal((node) => Math.max(1, Math.sqrt(Number(node.degree) || 1)))
      .nodeCanvasObjectMode('replace')
      .nodeCanvasObject((node, context, globalScale) => {
        drawForceGraphNode(node, context, globalScale, settingsRef.current, forceGraph);
      })
      .nodeLabel((node) => buildNodeTooltip(node))
      .linkSource('source')
      .linkTarget('target')
      .linkColor((link) => getForceGraphLinkColor(link, getForceGraphHighlightLinks(forceGraph), forceGraph))
      .linkWidth((link) => getForceGraphLinkWidth(link, getForceGraphHighlightLinks(forceGraph), forceGraph))
      .linkCurvature((link) => getForceGraphLinkCurvature(settingsRef.current.arcStyle, link))
      .linkDirectionalParticles((link) => shouldShowParticles(link, getForceGraphData(forceGraph).nodes.length, getForceGraphHighlightLinks(forceGraph), forceGraph))
      .linkDirectionalParticleSpeed((link) => getForceGraphParticleSpeed(link, forceGraph))
      .linkDirectionalParticleWidth((link) => getForceGraphHighlightLinks(forceGraph).has(link) ? 1.8 : 0.7)
      .linkDirectionalParticleColor((link) => getForceGraphLinkColor(link, getForceGraphHighlightLinks(forceGraph), forceGraph))
      .d3AlphaDecay(0.06)
      .d3VelocityDecay(0.42)
      .warmupTicks(80)
      .cooldownTicks(100)
      .cooldownTime(1800)
      .onEngineStop(() => {
        if (!forceGraph.__bigBrainFitPending) return;
        forceGraph.__bigBrainFitPending = false;
        forceGraph.zoomToFit(FIT_TO_CANVAS_DURATION, FIT_TO_CANVAS_PADDING);
      })
      .onNodeClick((node) => {
        onActiveSlugChange?.(node.slug);
        onNodeOpen?.(node.slug);
      })
      .onNodeHover((node) => {
        hoveredSlugRef.current = node?.id || null;
        updateForceGraphHighlight(forceGraph, activeSlugRef.current || hoveredSlugRef.current, settingsRef.current.arcAnimation);
      });

    syncForceGraphData(forceGraph, graph, settingsRef.current, activeSlugRef.current);

    return () => {
      FORCE_GRAPH_ICON_CACHE.forEach((entry) => entry.graphs.delete(forceGraph));
      cancelArcAnimation(forceGraph);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resize);
      forceGraph._destructor?.();
      graphRef.current = null;
    };
  }, [onActiveSlugChange, onNodeOpen]);

  useEffect(() => {
    const forceGraph = graphRef.current;
    if (!forceGraph) return;
    syncForceGraphData(forceGraph, graph, settingsRef.current, activeSlugRef.current);
  }, [graph]);

  useEffect(() => {
    const forceGraph = graphRef.current;
    if (!forceGraph) return;
    forceGraph
      .backgroundColor(theme.graphBase)
      .nodeCanvasObject((node, context, globalScale) => {
        drawForceGraphNode(node, context, globalScale, settingsRef.current, forceGraph);
      })
      .linkColor((link) => getForceGraphLinkColor(link, getForceGraphHighlightLinks(forceGraph), forceGraph))
      .linkWidth((link) => getForceGraphLinkWidth(link, getForceGraphHighlightLinks(forceGraph), forceGraph))
      .linkCurvature((link) => getForceGraphLinkCurvature(settingsRef.current.arcStyle, link))
      .linkDirectionalParticles((link) => shouldShowParticles(link, getForceGraphData(forceGraph).nodes.length, getForceGraphHighlightLinks(forceGraph), forceGraph))
      .linkDirectionalParticleSpeed((link) => getForceGraphParticleSpeed(link, forceGraph))
      .linkDirectionalParticleColor((link) => getForceGraphLinkColor(link, getForceGraphHighlightLinks(forceGraph), forceGraph));
    updateForceGraphHighlight(forceGraph, activeSlugRef.current || hoveredSlugRef.current, settingsRef.current.arcAnimation);
  }, [arcAnimation, arcStyle, colorMode, labelStyle, nodeFill, nodeIcon, nodeShape, nodeSize, theme, typeColors]);

  useEffect(() => {
    const forceGraph = graphRef.current;
    if (!forceGraph) return;
    updateForceGraphHighlight(forceGraph, activeSlug || hoveredSlugRef.current, settingsRef.current.arcAnimation);
  }, [activeSlug]);

  return (
    <div className="graph-canvas-shell force2d-shell">
      <div ref={containerRef} className="force2d-surface" aria-label="2D force-directed brain graph" />
    </div>
  );
});

function syncForceGraphData(forceGraph, graph, settings, focusSlug = null) {
  const nodes = (Array.isArray(graph?.nodes) ? graph.nodes : []).map((node) => ({
    ...node,
    id: node.slug,
    slug: node.slug,
    color: normalizeHex(getGraphNodeColor(node, settings.colorMode, settings.typeColors), DEFAULT_NODE_COLOR),
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = (Array.isArray(graph?.edges) ? graph.edges : [])
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge, index) => ({
      ...edge,
      id: `${edge.source}:${edge.target}:${index}`,
      source: edge.source,
      target: edge.target,
    }));

  forceGraph.__bigBrainFitPending = true;
  forceGraph.graphData({ nodes, links });
  updateForceGraphHighlight(forceGraph, focusSlug, settings.arcAnimation);
}

function getForceGraphData(forceGraph) {
  return forceGraph?.graphData?.() || { nodes: [], links: [] };
}

function updateForceGraphHighlight(forceGraph, focusSlug, arcAnimation = 'instant') {
  const data = getForceGraphData(forceGraph);
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const links = Array.isArray(data.links) ? data.links : [];
  const focusNode = nodes.find((node) => node.id === focusSlug || node.slug === focusSlug);
  const highlightedNodes = new Set(focusNode ? [focusNode.id] : []);
  const highlightedLinks = new Set();

  if (focusNode) {
    for (const link of links) {
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      const targetId = typeof link.target === 'object' ? link.target.id : link.target;
      if (sourceId === focusNode.id || targetId === focusNode.id) {
        highlightedLinks.add(link);
        highlightedNodes.add(sourceId);
        highlightedNodes.add(targetId);
      }
    }
  }

  const animatedLinks = arcAnimation === 'none' ? new Set() : highlightedLinks;
  forceGraph.__bigBrainHighlightLinks = animatedLinks;
  if (arcAnimation === 'grow' || arcAnimation === 'shoot') {
    startArcAnimation(forceGraph, arcAnimation, animatedLinks, () => {
      // Canvas force graphs have no separate link materials to mutate. Let
      // the library paint the current frame, without touching the graph data
      // or restarting its simulation.
      if (!forceGraph.isEngineRunning?.()) forceGraph.tickFrame?.();
    });
  } else {
    // Instant and None still need a completed state so their accessors resolve
    // to the intended visual result, but they do not schedule any work.
    startArcAnimation(forceGraph, arcAnimation, animatedLinks);
  }
  for (const node of nodes) node.__bigBrainEmphasized = highlightedNodes.has(node.id);
}

function getForceGraphHighlightLinks(forceGraph) {
  return forceGraph?.__bigBrainHighlightLinks || new Set();
}

function drawForceGraphNode(node, context, globalScale, settings, forceGraph) {
  if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
  const radius = getForceGraphNodeRadius(node, settings.nodeSize);
  const color = normalizeHex(node.color, DEFAULT_NODE_COLOR);
  const emphasized = Boolean(node.__bigBrainEmphasized);
  const drawRadius = radius * (emphasized ? 1.24 : 1);

  context.save();
  traceNodeShape(context, settings.nodeShape, node.x, node.y, drawRadius);
  if (settings.nodeFill === 'solid') {
    context.fillStyle = color;
    context.globalAlpha = 0.86;
    context.fill();
  }
  if (settings.nodeFill === 'outline' || settings.nodeFill === 'solid') {
    context.strokeStyle = color;
    context.lineWidth = Math.max(1, 1.5 / globalScale);
    context.globalAlpha = 0.9;
    context.stroke();
  }

  if (settings.nodeIcon !== 'none') {
    drawForceGraphIcon(node, context, drawRadius, settings, forceGraph);
  }

  const labelVisible = settings.labelStyle === 'all' || settings.labelSlugs?.has(node.slug) || emphasized;
  if (labelVisible) drawForceGraphNodeLabel(node, context, globalScale, drawRadius, settings);
  context.restore();
}

function drawForceGraphIcon(node, context, radius, settings, forceGraph) {
  const icon = getForceGraphIconImage(node.type, settings.nodeIcon, forceGraph);
  if (!icon?.loaded) return;
  const size = radius * 1.38;
  const left = node.x - size / 2;
  const top = node.y - size / 2;
  const iconColor = settings.nodeFill === 'solid' ? settings.theme.graphBase : normalizeHex(node.color, DEFAULT_NODE_COLOR);
  context.save();
  context.globalAlpha = 0.96;
  context.drawImage(icon.image, left, top, size, size);
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = iconColor;
  context.fillRect(left, top, size, size);
  context.restore();
}

function getForceGraphIconImage(type, iconStyle, forceGraph) {
  const key = `${String(type || 'unknown').toLowerCase()}:${iconStyle}`;
  let entry = FORCE_GRAPH_ICON_CACHE.get(key);
  if (!entry) {
    const image = new Image();
    entry = { image, loaded: false, graphs: new Set() };
    image.onload = () => {
      entry.loaded = true;
      entry.graphs.forEach((graph) => graph.refresh?.());
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(graphTypeIconSvg(type, { color: '#FFFFFF', iconStyle }))}`;
    FORCE_GRAPH_ICON_CACHE.set(key, entry);
  }
  entry.graphs.add(forceGraph);
  return entry;
}

function drawForceGraphNodeLabel(node, context, globalScale, radius, settings) {
  const label = String(node.title || node.slug);
  const fontSize = PRESET_GRAPH_LABEL_FONT_SIZE / globalScale;
  const x = node.x + radius * 1.55;
  const y = node.y - radius * 0.55;
  context.font = `600 ${fontSize}px "SF Mono", "IBM Plex Mono", ui-monospace, monospace`;
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  const textWidth = context.measureText(label).width;
  context.fillStyle = settings.theme.graphBase;
  context.globalAlpha = 0.72;
  context.fillRect(x - 4 / globalScale, y - fontSize * 0.72, textWidth + 8 / globalScale, fontSize * 1.44);
  context.fillStyle = settings.theme.graphLabel;
  context.globalAlpha = 0.92;
  context.fillText(label, x, y);
}

function traceNodeShape(context, shape, x, y, radius) {
  context.beginPath();
  if (shape === 'diamond') {
    context.moveTo(x, y - radius * 1.35);
    context.lineTo(x + radius * 1.35, y);
    context.lineTo(x, y + radius * 1.35);
    context.lineTo(x - radius * 1.35, y);
    context.closePath();
    return;
  }
  if (shape === 'hex') {
    for (let index = 0; index < 6; index += 1) {
      const angle = (Math.PI / 3) * index - Math.PI / 6;
      const point = { x: x + Math.cos(angle) * radius * 1.15, y: y + Math.sin(angle) * radius * 1.15 };
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.closePath();
    return;
  }
  if (shape === 'pixel') {
    context.rect(x - radius * 0.95, y - radius * 0.95, radius * 1.9, radius * 1.9);
    return;
  }
  context.arc(x, y, radius, 0, Math.PI * 2);
}

function getForceGraphNodeRadius(node, nodeSize) {
  const sizeScale = getGraphNodeSizeScale(nodeSize);
  return (2.7 + Math.sqrt(Math.max(1, Number(node.degree) || 1)) * 0.52) * (0.72 + sizeScale * 0.22);
}

function getForceGraphLabelSlugs(nodes, labelStyle) {
  if (labelStyle !== 'selected') return new Set();
  const ordered = [...(Array.isArray(nodes) ? nodes : [])]
    .sort((left, right) => (right.degree || 0) - (left.degree || 0) || String(left.slug).localeCompare(String(right.slug)))
    .slice(0, 12);
  return new Set(ordered.map((node) => node.slug));
}

function getForceGraphLinkColor(link, highlightedLinks, forceGraph) {
  if (highlightedLinks.has(link)) {
    const progress = arcAnimationProgress(forceGraph, link);
    if (progress >= 1) return '#DDE7F5';
    return hexToRgba(blendArcColors(DEFAULT_LINK_COLOR, '#DDE7F5', progress), 0.22 + progress * 0.78);
  }
  // Keep relationship lines neutral across the graph. ForceGraph resolves
  // string endpoints into node objects after the initial draw, so deriving
  // this from source.color makes links unexpectedly change color on redraw.
  return hexToRgba(DEFAULT_LINK_COLOR, 0.22);
}

function getForceGraphLinkWidth(link, highlightedLinks, forceGraph) {
  if (!highlightedLinks.has(link)) return 0.7;
  return 0.7 + arcAnimationProgress(forceGraph, link) * 0.8;
}

function getForceGraphLinkCurvature(arcStyle, link) {
  if (arcStyle === 'straight') return 0;
  return link.id ? 0.22 : 0;
}

function shouldShowParticles(link, nodeCount, highlightedLinks, forceGraph) {
  if (highlightedLinks.has(link)) {
    const state = forceGraph?.__bigBrainArcAnimation;
    if (state?.mode === 'grow') return 0;
    return 4;
  }
  return nodeCount <= 900 ? 1 : 0;
}

function getForceGraphParticleSpeed(link, forceGraph) {
  if (forceGraph?.__bigBrainArcAnimation?.mode === 'shoot' && getForceGraphHighlightLinks(forceGraph).has(link)) return 0.012;
  return 0.004;
}

function buildNodeTooltip(node) {
  return `<strong>${escapeHtml(node.title || node.slug)}</strong><br><small>${escapeHtml(node.type || 'page')}</small>`;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeHex(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback;
}

function hexToRgba(hex, alpha) {
  const value = normalizeHex(hex, DEFAULT_LINK_COLOR).slice(1);
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function zoomCamera(forceGraph, factor) {
  if (!forceGraph) return;
  forceGraph.zoom(forceGraph.zoom() * factor);
}
