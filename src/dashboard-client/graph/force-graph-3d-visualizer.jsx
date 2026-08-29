import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';

import { getGraphNodeColor } from './colors.js';
import { arcAnimationProgress, blendArcColors, cancelArcAnimation, startArcAnimation } from './arc-animation.js';
import { graphTypeIconSvg } from './graph-type-icon-data.js';
import { getGraphNodeSizeScale } from './node-sizes.js';
import { useGraphTheme } from './visualizer-core.jsx';

const DEFAULT_NODE_COLOR = '#E4E4E7';
const DEFAULT_LINK_COLOR = '#657083';
const FORCE_GRAPH_PIXEL_RATIO = 1.5;
const AUTO_ROTATION_RADIANS_PER_SECOND = 0.035;
const FIT_TO_CANVAS_DURATION = 700;
const FIT_TO_CANVAS_PADDING = 42;
const FORCE_GRAPH_ICON_TEXTURE_CACHE = new Map();

export const ForceGraph3DVisualizer = forwardRef(function ForceGraph3DVisualizer({
  graph,
  onNodeOpen,
  nodeShape = 'orb',
  nodeFill = 'outline',
  nodeIcon = 'none',
  nodeSize = 'medium',
  arcStyle = 'curve',
  arcAnimation = 'instant',
  labelStyle = 'selected',
  colorMode = 'updated',
  typeColors,
  autoRotate = false,
  activeSlug = null,
  onActiveSlugChange,
}, ref) {
  const theme = useGraphTheme();
  const containerRef = useRef(null);
  const graphRef = useRef(null);
  const rotationFrameRef = useRef(0);
  const rotationLastTimeRef = useRef(0);
  const userInteractingRef = useRef(false);
  const settingsRef = useRef({ nodeShape, nodeFill, nodeIcon, nodeSize, arcStyle, arcAnimation, labelStyle, colorMode, typeColors, theme });
  const activeSlugRef = useRef(activeSlug);
  const hoveredSlugRef = useRef(null);
  const labelSlugs = useMemo(() => getForceGraphLabelSlugs(graph?.nodes, labelStyle), [graph?.nodes, labelStyle]);

  settingsRef.current = { nodeShape, nodeFill, nodeIcon, nodeSize, arcStyle, arcAnimation, labelStyle, colorMode, typeColors, theme, labelSlugs, activeSlug };
  activeSlugRef.current = activeSlug;

  useImperativeHandle(ref, () => ({
    zoomIn() {
      zoomCamera(graphRef.current, 1 / 1.24);
    },
    zoomOut() {
      zoomCamera(graphRef.current, 1.24);
    },
    resetView() {
      graphRef.current?.zoomToFit(FIT_TO_CANVAS_DURATION, FIT_TO_CANVAS_PADDING);
    },
  }), []);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    const forceGraph = new ForceGraph3D(containerRef.current, {
      controlType: 'orbit',
      rendererConfig: {
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      },
    });
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
    forceGraph.renderer()?.setPixelRatio?.(Math.min(FORCE_GRAPH_PIXEL_RATIO, window.devicePixelRatio || 1));

    forceGraph
      .backgroundColor(settingsRef.current.theme.graphBase)
      .showNavInfo(false)
      .enableNavigationControls(true)
      // Orbit controls own the primary gesture so clicks remain reliable on
      // dense graphs and do not compete with the graph's drag controller.
      .enableNodeDrag(false)
      .nodeId('id')
      .nodeVal((node) => Math.max(1, Math.sqrt(Number(node.degree) || 1)))
      .nodeThreeObject((node) => createForceGraphNodeObject(node, settingsRef.current))
      .nodeThreeObjectExtend(false)
      .nodeLabel((node) => buildNodeTooltip(node))
      .linkSource('source')
      .linkTarget('target')
      .linkCurvature(() => getForceGraphLinkCurvature(settingsRef.current.arcStyle))
      .linkColor((link) => getForceGraphLinkColor(link, getForceGraphHighlightLinks(forceGraph), forceGraph))
      .linkOpacity((link) => getForceGraphLinkOpacity(link, getForceGraphHighlightLinks(forceGraph), forceGraph))
      // Keep the dense background as GPU lines. Use thicker cylinders only for
      // the focused neighborhood, where the extra geometry is visible.
      .linkWidth((link) => getForceGraphLinkWidth(link, getForceGraphHighlightLinks(forceGraph), forceGraph))
      .linkResolution(3)
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
        updateForceGraphHighlight(forceGraph, getForceGraphData(forceGraph), activeSlugRef.current || hoveredSlugRef.current, settingsRef.current.arcAnimation);
      });

    syncForceGraphData(forceGraph, graph, settingsRef.current, activeSlugRef.current);

    const controls = forceGraph.controls?.();
    const handleControlStart = () => {
      userInteractingRef.current = true;
    };
    const handleControlEnd = () => {
      userInteractingRef.current = false;
    };
    controls?.addEventListener?.('start', handleControlStart);
    controls?.addEventListener?.('end', handleControlEnd);

    return () => {
      controls?.removeEventListener?.('start', handleControlStart);
      controls?.removeEventListener?.('end', handleControlEnd);
      userInteractingRef.current = false;
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resize);
      forceGraph._destructor?.();
      graphRef.current = null;
    };
  }, [onActiveSlugChange, onNodeOpen]);

  useEffect(() => {
    if (!autoRotate) {
      rotationLastTimeRef.current = 0;
      return undefined;
    }

    const rotate = (time) => {
      const scene = graphRef.current?.scene?.();
      const previousTime = rotationLastTimeRef.current || time;
      const delta = Math.min(Math.max(0, time - previousTime), 100);
      if (scene && !userInteractingRef.current) {
        scene.rotation.z += (delta / 1000) * AUTO_ROTATION_RADIANS_PER_SECOND;
      }
      rotationLastTimeRef.current = time;
      rotationFrameRef.current = window.requestAnimationFrame(rotate);
    };

    rotationFrameRef.current = window.requestAnimationFrame(rotate);
    return () => {
      window.cancelAnimationFrame(rotationFrameRef.current);
      rotationFrameRef.current = 0;
      rotationLastTimeRef.current = 0;
    };
  }, [autoRotate]);

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
      .nodeThreeObject((node) => createForceGraphNodeObject(node, settingsRef.current))
      .nodeLabel((node) => buildNodeTooltip(node))
      .linkCurvature(() => getForceGraphLinkCurvature(settingsRef.current.arcStyle))
      .linkColor((link) => getForceGraphLinkColor(link, getForceGraphHighlightLinks(forceGraph), forceGraph))
      .linkOpacity((link) => getForceGraphLinkOpacity(link, getForceGraphHighlightLinks(forceGraph), forceGraph))
      .linkWidth((link) => getForceGraphLinkWidth(link, getForceGraphHighlightLinks(forceGraph), forceGraph))
      .linkResolution(3)
      .linkDirectionalParticles((link) => shouldShowParticles(link, getForceGraphData(forceGraph).nodes.length, getForceGraphHighlightLinks(forceGraph), forceGraph))
      .linkDirectionalParticleSpeed((link) => getForceGraphParticleSpeed(link, forceGraph))
      .linkDirectionalParticleColor((link) => getForceGraphLinkColor(link, getForceGraphHighlightLinks(forceGraph), forceGraph));
    updateForceGraphHighlight(forceGraph, getForceGraphData(forceGraph), activeSlugRef.current || hoveredSlugRef.current, arcAnimation);
  }, [arcAnimation, arcStyle, colorMode, labelStyle, nodeFill, nodeIcon, nodeShape, nodeSize, theme, typeColors]);

  useEffect(() => {
    const forceGraph = graphRef.current;
    if (!forceGraph) return;
    updateForceGraphHighlight(forceGraph, getForceGraphData(forceGraph), activeSlug || hoveredSlugRef.current, settingsRef.current.arcAnimation);
  }, [activeSlug]);

  return (
    <div className="graph-canvas-shell force3d-shell">
      <div ref={containerRef} className="force3d-surface" aria-label="3D force-directed brain graph" />
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

  const data = { nodes, links };
  forceGraph.__bigBrainFitPending = true;
  graphDataRefFor(forceGraph, data);
  forceGraph.graphData(data);
  forceGraph.nodeThreeObject((node) => createForceGraphNodeObject(node, settings));
  updateForceGraphHighlight(forceGraph, data, focusSlug, settings.arcAnimation);
}

function graphDataRefFor(forceGraph, data) {
  // The graph instance owns the resolved source/target objects after graphData().
  // This temporary copy is replaced immediately below and keeps callbacks safe
  // while the force engine is wiring its link references.
  forceGraph.__bigBrainData = data;
}

function getForceGraphData(forceGraph) {
  return forceGraph?.graphData?.() || forceGraph?.__bigBrainData || { nodes: [], links: [] };
}

function updateForceGraphHighlight(forceGraph, data, focusSlug, arcAnimation = 'instant') {
  const resolvedData = forceGraph.graphData?.() || data || { nodes: [], links: [] };
  graphDataRefFor(forceGraph, resolvedData);
  const nodes = Array.isArray(resolvedData.nodes) ? resolvedData.nodes : [];
  const links = Array.isArray(resolvedData.links) ? resolvedData.links : [];
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
  for (const node of nodes) syncForceGraphNodeState(node, highlightedNodes);
  forceGraph
    .linkColor((link) => getForceGraphLinkColor(link, animatedLinks, forceGraph))
    .linkOpacity((link) => getForceGraphLinkOpacity(link, animatedLinks, forceGraph))
    .linkWidth((link) => getForceGraphLinkWidth(link, animatedLinks, forceGraph))
    .linkDirectionalParticles((link) => shouldShowParticles(link, nodes.length, animatedLinks, forceGraph))
    .linkDirectionalParticleSpeed((link) => getForceGraphParticleSpeed(link, forceGraph))
    .linkDirectionalParticleColor((link) => getForceGraphLinkColor(link, animatedLinks, forceGraph));
  startArcAnimation(forceGraph, arcAnimation, animatedLinks, () => forceGraph.refresh?.());
}

function getForceGraphHighlightLinks(forceGraph) {
  return forceGraph?.__bigBrainHighlightLinks || new Set();
}

function syncForceGraphNodeState(node, highlightedNodes) {
  const visual = node.__bigBrainVisual;
  if (!visual) return;
  const emphasized = highlightedNodes.has(node.id);
  visual.group.scale.setScalar(emphasized ? 1.24 : 1);
  if (visual.label) visual.label.visible = visual.labelBaseVisible || emphasized;
  if (visual.glow) visual.glow.visible = emphasized;
}

function createForceGraphNodeObject(node, settings) {
  const group = new THREE.Group();
  const nodeColor = normalizeHex(getGraphNodeColor(node, settings.colorMode, settings.typeColors), DEFAULT_NODE_COLOR);
  const radius = getForceGraphNodeRadius(node, settings.nodeSize);
  const geometry = settings.nodeFill === 'none' ? null : createNodeGeometry(settings.nodeShape, radius);

  if (settings.nodeFill === 'solid') {
    const fillMaterial = new THREE.MeshLambertMaterial({
      color: nodeColor,
      transparent: true,
      opacity: 0.86,
      depthWrite: true,
    });
    const body = new THREE.Mesh(geometry, fillMaterial);
    group.add(body);
  }

  if (settings.nodeFill === 'outline' || settings.nodeFill === 'solid') {
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: nodeColor, transparent: true, opacity: 0.9 }),
    );
    group.add(outline);
  }

  if (settings.nodeIcon !== 'none') {
    const iconColor = settings.nodeFill === 'solid' ? settings.theme.graphBase : nodeColor;
    group.add(createForceGraphIconSprite(node.type, settings.nodeIcon, iconColor, radius));
  }

  const labelBaseVisible = settings.labelStyle === 'all' || settings.labelSlugs?.has(node.slug);
  const label = labelBaseVisible
    ? createForceGraphNodeLabel(node, settings, radius)
    : null;
  group.userData = { nodeSlug: node.slug };
  node.__bigBrainVisual = { group, label, labelBaseVisible, glow: null };
  syncForceGraphNodeState(node, new Set());
  return group;
}

function createForceGraphNodeLabel(node, settings, radius) {
  const labelWidth = Math.min(180, Math.max(34, String(node.title || node.slug).length * 1.55 + 28));
  const label = createForceGraphTextSprite(node.title || node.slug, settings.theme.graphLabel, labelWidth, 8.5, true);
  label.position.set(radius * 1.75, radius * 0.85, 0);
  return label;
}

function createNodeGeometry(shape, radius) {
  if (shape === 'diamond') return new THREE.OctahedronGeometry(radius * 1.35, 0);
  if (shape === 'hex') return new THREE.CylinderGeometry(radius * 1.1, radius * 1.1, radius * 1.7, 6, 1);
  if (shape === 'pixel') return new THREE.BoxGeometry(radius * 1.9, radius * 1.9, radius * 1.9);
  return new THREE.SphereGeometry(radius, 12, 8);
}

function createForceGraphTextSprite(text, color, width, height, label = false) {
  const canvas = document.createElement('canvas');
  const scale = label ? 2 : 4;
  canvas.width = Math.max(64, Math.ceil(width * scale));
  canvas.height = Math.max(32, Math.ceil(height * scale));
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = color;
  context.font = `${label ? 16 : 25}px "SF Mono", "IBM Plex Mono", monospace`;
  context.fontWeight = label ? '600' : '800';
  context.textAlign = label ? 'left' : 'center';
  context.textBaseline = 'middle';
  context.fillText(String(text).slice(0, label ? 36 : 2), label ? 2 : canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Keep glyphs in a camera-facing billboard layer. This prevents the node
  // icon and label texture from inheriting the graph's 3D perspective.
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false }));
  sprite.material.rotation = 0;
  sprite.material.sizeAttenuation = true;
  sprite.renderOrder = label ? 20 : 10;
  sprite.scale.set(width, height, 1);
  sprite.center.set(label ? 0 : 0.5, 0.5);
  return sprite;
}

function createForceGraphIconSprite(type, iconStyle, color, radius) {
  const key = `${String(type || 'unknown').toLowerCase()}:${iconStyle}`;
  let texture = FORCE_GRAPH_ICON_TEXTURE_CACHE.get(key);
  if (!texture) {
    texture = new THREE.TextureLoader().load(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(graphTypeIconSvg(type, { color: '#FFFFFF', iconStyle }))}`);
    texture.colorSpace = THREE.SRGBColorSpace;
    FORCE_GRAPH_ICON_TEXTURE_CACHE.set(key, texture);
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    color,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  }));
  sprite.renderOrder = 10;
  sprite.scale.setScalar(radius * 1.38);
  sprite.center.set(0.5, 0.5);
  return sprite;
}

function getForceGraphNodeRadius(node, nodeSize) {
  const sizeScale = getGraphNodeSizeScale(nodeSize);
  return (1.9 + Math.sqrt(Math.max(1, Number(node.degree) || 1)) * 0.42) * (0.72 + sizeScale * 0.22);
}

function getForceGraphLabelSlugs(nodes, labelStyle) {
  if (labelStyle !== 'selected') return new Set();
  const ordered = [...(Array.isArray(nodes) ? nodes : [])]
    .sort((left, right) => (right.degree || 0) - (left.degree || 0) || String(left.slug).localeCompare(String(right.slug)))
    .slice(0, 12);
  return new Set(ordered.map((node) => node.slug));
}

function getForceGraphLinkCurvature(arcStyle) {
  return arcStyle === 'straight' ? 0 : 0.22;
}

function getForceGraphLinkColor(link, highlightedLinks, forceGraph) {
  if (highlightedLinks.has(link)) {
    const progress = arcAnimationProgress(forceGraph, link);
    return progress >= 1 ? '#DDE7F5' : blendArcColors(DEFAULT_LINK_COLOR, '#DDE7F5', progress);
  }
  // Keep relationship lines neutral across the graph. ForceGraph resolves
  // string endpoints into node objects after the initial draw, so deriving
  // this from source.color makes links unexpectedly change color on redraw.
  return DEFAULT_LINK_COLOR;
}

function getForceGraphLinkOpacity(link, highlightedLinks, forceGraph) {
  if (!highlightedLinks.has(link)) return 0.2;
  return 0.2 + arcAnimationProgress(forceGraph, link) * 0.52;
}

function getForceGraphLinkWidth(link, highlightedLinks, forceGraph) {
  if (!highlightedLinks.has(link)) return 0;
  return arcAnimationProgress(forceGraph, link) >= 0.18 ? 1.5 : 0;
}

function shouldShowParticles(link, nodeCount, highlightedLinks, forceGraph) {
  if (highlightedLinks.has(link)) {
    if (forceGraph?.__bigBrainArcAnimation?.mode === 'grow') return 0;
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

function zoomCamera(forceGraph, factor) {
  const camera = forceGraph?.camera?.();
  if (!camera?.position) return;
  camera.position.multiplyScalar(factor);
  forceGraph.controls?.().update?.();
}
