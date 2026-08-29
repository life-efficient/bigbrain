import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';

import { getGraphNodeColor } from './colors.js';
import { getGraphNodeSizeScale } from './node-sizes.js';
import { useGraphTheme } from './visualizer-core.jsx';

const TYPE_GLYPHS = {
  people: 'P',
  organizations: 'O',
  companies: 'C',
  deals: '$',
  projects: '◆',
  ideas: '✦',
  meetings: '◷',
  tasks: '✓',
  concepts: '◌',
  writing: 'W',
  protocol: '↗',
  archive: 'A',
  'personal-protocol': '↗',
  sources: 'S',
  ops: '⚙',
  inbox: 'I',
};

const DEFAULT_NODE_COLOR = '#E4E4E7';
const DEFAULT_LINK_COLOR = '#657083';

export const ForceGraph3DVisualizer = forwardRef(function ForceGraph3DVisualizer({
  graph,
  onNodeOpen,
  nodeShape = 'orb',
  nodeFill = 'outline',
  nodeIcon = 'none',
  nodeSize = 'medium',
  labelStyle = 'selected',
  colorMode = 'updated',
  typeColors,
  activeSlug = null,
  onActiveSlugChange,
}, ref) {
  const theme = useGraphTheme();
  const containerRef = useRef(null);
  const graphRef = useRef(null);
  const settingsRef = useRef({ nodeShape, nodeFill, nodeIcon, nodeSize, labelStyle, colorMode, typeColors, theme });
  const activeSlugRef = useRef(activeSlug);
  const hoveredSlugRef = useRef(null);
  const labelSlugs = useMemo(() => getForceGraphLabelSlugs(graph?.nodes, labelStyle), [graph?.nodes, labelStyle]);

  settingsRef.current = { nodeShape, nodeFill, nodeIcon, nodeSize, labelStyle, colorMode, typeColors, theme, labelSlugs, activeSlug };
  activeSlugRef.current = activeSlug;

  useImperativeHandle(ref, () => ({
    zoomIn() {
      zoomCamera(graphRef.current, 1 / 1.24);
    },
    zoomOut() {
      zoomCamera(graphRef.current, 1.24);
    },
    resetView() {
      graphRef.current?.zoomToFit(500, 42);
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
      .linkColor((link) => getForceGraphLinkColor(link, getForceGraphHighlightLinks(forceGraph)))
      .linkOpacity((link) => getForceGraphHighlightLinks(forceGraph).has(link) ? 0.72 : 0.2)
      .linkWidth((link) => getForceGraphHighlightLinks(forceGraph).has(link) ? 1.5 : 0.45)
      .linkDirectionalParticles((link) => shouldShowParticles(link, getForceGraphData(forceGraph).nodes.length, getForceGraphHighlightLinks(forceGraph)))
      .linkDirectionalParticleSpeed(0.004)
      .linkDirectionalParticleWidth((link) => getForceGraphHighlightLinks(forceGraph).has(link) ? 1.8 : 0.7)
      .linkDirectionalParticleColor((link) => getForceGraphLinkColor(link, getForceGraphHighlightLinks(forceGraph)))
      .d3VelocityDecay(0.34)
      .warmupTicks(80)
      .cooldownTime(2600)
      .onNodeClick((node) => {
        onActiveSlugChange?.(node.slug);
        onNodeOpen?.(node.slug);
      })
      .onNodeHover((node) => {
        hoveredSlugRef.current = node?.id || null;
        updateForceGraphHighlight(forceGraph, getForceGraphData(forceGraph), activeSlugRef.current || hoveredSlugRef.current);
      });

    syncForceGraphData(forceGraph, graph, settingsRef.current, activeSlugRef.current);
    window.requestAnimationFrame(() => forceGraph.zoomToFit(700, 42));

    return () => {
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
      .nodeThreeObject((node) => createForceGraphNodeObject(node, settingsRef.current))
      .nodeLabel((node) => buildNodeTooltip(node))
      .linkColor((link) => getForceGraphLinkColor(link, getForceGraphHighlightLinks(forceGraph)))
      .linkOpacity((link) => getForceGraphHighlightLinks(forceGraph).has(link) ? 0.72 : 0.2)
      .linkWidth((link) => getForceGraphHighlightLinks(forceGraph).has(link) ? 1.5 : 0.45)
      .linkDirectionalParticles((link) => shouldShowParticles(link, getForceGraphData(forceGraph).nodes.length, getForceGraphHighlightLinks(forceGraph)))
      .linkDirectionalParticleColor((link) => getForceGraphLinkColor(link, getForceGraphHighlightLinks(forceGraph)));
    updateForceGraphHighlight(forceGraph, getForceGraphData(forceGraph), activeSlugRef.current || hoveredSlugRef.current);
  }, [colorMode, labelStyle, nodeFill, nodeIcon, nodeShape, nodeSize, theme, typeColors]);

  useEffect(() => {
    const forceGraph = graphRef.current;
    if (!forceGraph) return;
    updateForceGraphHighlight(forceGraph, getForceGraphData(forceGraph), activeSlug || hoveredSlugRef.current);
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
  graphDataRefFor(forceGraph, data);
  forceGraph.graphData(data);
  forceGraph.nodeThreeObject((node) => createForceGraphNodeObject(node, settings));
  updateForceGraphHighlight(forceGraph, data, focusSlug);
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

function updateForceGraphHighlight(forceGraph, data, focusSlug) {
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

  forceGraph.__bigBrainHighlightLinks = highlightedLinks;
  for (const node of nodes) syncForceGraphNodeState(node, highlightedNodes);
  forceGraph
    .linkColor((link) => getForceGraphLinkColor(link, highlightedLinks))
    .linkOpacity((link) => highlightedLinks.has(link) ? 0.72 : 0.2)
    .linkWidth((link) => highlightedLinks.has(link) ? 1.5 : 0.45)
    .linkDirectionalParticles((link) => shouldShowParticles(link, nodes.length, highlightedLinks))
    .linkDirectionalParticleColor((link) => getForceGraphLinkColor(link, highlightedLinks))
    .refresh();
}

function getForceGraphHighlightLinks(forceGraph) {
  return forceGraph?.__bigBrainHighlightLinks || new Set();
}

function syncForceGraphNodeState(node, highlightedNodes) {
  const visual = node.__bigBrainVisual;
  if (!visual) return;
  const emphasized = highlightedNodes.has(node.id);
  visual.group.scale.setScalar(emphasized ? 1.24 : 1);
  visual.label.visible = visual.labelBaseVisible || emphasized;
  if (visual.glow) visual.glow.visible = emphasized;
}

function createForceGraphNodeObject(node, settings) {
  const group = new THREE.Group();
  const nodeColor = normalizeHex(getGraphNodeColor(node, settings.colorMode, settings.typeColors), DEFAULT_NODE_COLOR);
  const radius = getForceGraphNodeRadius(node, settings.nodeSize);
  const geometry = createNodeGeometry(settings.nodeShape, radius);
  const materials = [];

  if (settings.nodeFill !== 'none') {
    const fillMaterial = new THREE.MeshLambertMaterial({
      color: nodeColor,
      transparent: true,
      opacity: settings.nodeFill === 'solid' ? 0.86 : 0.02,
      depthWrite: settings.nodeFill === 'solid',
    });
    materials.push(fillMaterial);
    const body = new THREE.Mesh(geometry, fillMaterial);
    group.add(body);
    if (settings.nodeFill === 'outline') body.visible = false;
  }

  if (settings.nodeFill !== 'none') {
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: nodeColor, transparent: true, opacity: 0.9 }),
    );
    group.add(outline);
    materials.push(outline.material);
  }

  if (settings.nodeIcon !== 'none') {
    const iconColor = settings.nodeFill === 'solid' ? settings.theme.graphBase : nodeColor;
    group.add(createForceGraphTextSprite(TYPE_GLYPHS[node.type] || '•', iconColor, radius * 1.1, radius * 1.1));
  }

  const labelBaseVisible = settings.labelStyle === 'all' || settings.labelSlugs?.has(node.slug);
  const labelWidth = Math.min(180, Math.max(34, String(node.title || node.slug).length * 1.55 + 28));
  const label = createForceGraphTextSprite(node.title || node.slug, settings.theme.graphLabel, labelWidth, 8.5, true);
  label.position.set(radius * 1.75, radius * 0.85, 0);
  label.visible = labelBaseVisible;
  group.add(label);

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.75, 10, 8),
    new THREE.MeshBasicMaterial({ color: nodeColor, transparent: true, opacity: 0.11, depthWrite: false }),
  );
  glow.visible = false;
  group.add(glow);
  group.userData = { nodeSlug: node.slug };
  node.__bigBrainVisual = { group, label, labelBaseVisible, glow, materials };
  syncForceGraphNodeState(node, new Set());
  return group;
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
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false }));
  sprite.renderOrder = label ? 20 : 10;
  sprite.scale.set(width, height, 1);
  sprite.center.set(label ? 0 : 0.5, 0.5);
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

function getForceGraphLinkColor(link, highlightedLinks) {
  if (highlightedLinks.has(link)) return '#DDE7F5';
  const source = typeof link.source === 'object' ? link.source : null;
  return normalizeHex(source?.color, DEFAULT_LINK_COLOR);
}

function shouldShowParticles(link, nodeCount, highlightedLinks) {
  if (highlightedLinks.has(link)) return 4;
  return nodeCount <= 900 ? 1 : 0;
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
