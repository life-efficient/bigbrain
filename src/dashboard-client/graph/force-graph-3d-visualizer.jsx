import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';

import { getGraphNodeColor } from './colors.js';
import { arcAnimationProgress, blendArcColors, cancelArcAnimation, startArcAnimation } from './arc-animation.js';
import { graphTypeIconSvg } from './graph-type-icon-data.js';
import {
  cancelGraphTransitionLoop,
  graphTransitionActive,
  graphTransitionProgress,
  prepareGraphTransitionData,
  startGraphTransitionLoop,
} from './graph-transition.js';
import { prepareForceGraphData } from './force-graph-data.js';
import { buildInitialGraphRevealStages, INITIAL_GRAPH_REVEAL_STEP_MS } from './live-graph.js';
import { getGraphNodeSizeScale } from './node-sizes.js';
import { useGraphTheme } from './visualizer-core.jsx';

const DEFAULT_NODE_COLOR = '#E4E4E7';
const DEFAULT_LINK_COLOR = '#657083';
const FORCE_GRAPH_PIXEL_RATIO = 1.5;
const AUTO_ROTATION_RADIANS_PER_SECOND = 0.035;
const FIT_TO_CANVAS_DURATION = 700;
const FIT_TO_CANVAS_PADDING = 42;
const SYSTEM_ACTIVITY_PREFOCUS_DURATION = 1200;
const SYSTEM_FOCUS_HOLD_DURATION = 5000;
const GRAPH_UPDATE_COOLDOWN_TICKS = 120;
const GRAPH_UPDATE_COOLDOWN_TIME = 1400;
const FORCE_GRAPH_ICON_TEXTURE_CACHE = new Map();
let FORCE_GRAPH_GLOW_TEXTURE = null;

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
  timelineDay = null,
  motionEvent = null,
  activeSlug = null,
  onActiveSlugChange,
  onBackgroundClick,
}, ref) {
  const theme = useGraphTheme();
  const containerRef = useRef(null);
  const focusLabelRef = useRef(null);
  const focusLabelNodeRef = useRef(null);
  const focusLabelFrameRef = useRef(0);
  const graphRef = useRef(null);
  const rotationFrameRef = useRef(0);
  const rotationLastTimeRef = useRef(0);
  const focusReturnTimerRef = useRef(0);
  const rotationPauseUntilRef = useRef(0);
  const userInteractingRef = useRef(false);
  const onNodeOpenRef = useRef(onNodeOpen);
  const onActiveSlugChangeRef = useRef(onActiveSlugChange);
  const onBackgroundClickRef = useRef(onBackgroundClick);
  const renderedArcStyleRef = useRef(arcStyle);
  const settingsRef = useRef({ nodeShape, nodeFill, nodeIcon, nodeSize, arcStyle, arcAnimation, labelStyle, colorMode, typeColors, theme });
  const activeSlugRef = useRef(activeSlug);
  const hoveredSlugRef = useRef(null);
  const timelineDayRef = useRef(timelineDay);
  const labelSlugs = useMemo(() => getForceGraphLabelSlugs(graph?.nodes, labelStyle), [graph?.nodes, labelStyle]);

  settingsRef.current = { nodeShape, nodeFill, nodeIcon, nodeSize, arcStyle, arcAnimation, labelStyle, colorMode, typeColors, theme, labelSlugs, activeSlug };
  onNodeOpenRef.current = onNodeOpen;
  onActiveSlugChangeRef.current = onActiveSlugChange;
  onBackgroundClickRef.current = onBackgroundClick;
  activeSlugRef.current = activeSlug;
  timelineDayRef.current = timelineDay;

  const hideFocusLabel = () => {
    focusLabelNodeRef.current = null;
    window.cancelAnimationFrame(focusLabelFrameRef.current);
    focusLabelFrameRef.current = 0;
    if (focusLabelRef.current) focusLabelRef.current.hidden = true;
  };

  const updateFocusLabelPosition = () => {
    const forceGraph = graphRef.current;
    const element = focusLabelRef.current;
    const slug = focusLabelNodeRef.current;
    if (!forceGraph || !element || !slug) return;
    const node = getForceGraphData(forceGraph).nodes?.find((item) => item.id === slug || item.slug === slug);
    if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y) || !Number.isFinite(node.z)) {
      element.hidden = true;
      return;
    }
    const point = forceGraph.graph2ScreenCoords?.(node.x, node.y, node.z);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      element.hidden = true;
      return;
    }
    element.style.left = `${point.x + 12}px`;
    element.style.top = `${point.y}px`;
    element.hidden = false;
    focusLabelFrameRef.current = window.requestAnimationFrame(updateFocusLabelPosition);
  };

  const showFocusLabel = (forceGraph, node) => {
    const element = focusLabelRef.current;
    if (!element || !node?.slug) return;
    window.cancelAnimationFrame(focusLabelFrameRef.current);
    focusLabelNodeRef.current = node.slug;
    element.textContent = node.title || node.slug;
    element.hidden = false;
    updateFocusLabelPosition();
  };

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
    focusNode(slug) {
      const forceGraph = graphRef.current;
      const node = getForceGraphData(forceGraph).nodes?.find((item) => item.id === slug || item.slug === slug);
      focusForceGraphNodeBySlug(graphRef.current, slug);
      if (node) showFocusLabel(forceGraph, node);
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
      const sizeChanged = forceGraph.width() !== width || forceGraph.height() !== height;
      if (sizeChanged) {
        forceGraph.width(width).height(height);
        if (forceGraph.__bigBrainHasData) scheduleForceGraphFit(forceGraph);
      }
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
      .nodeVisibility((node) => isForceGraphNodeVisibleAtTimeline(node, timelineDayRef.current) || graphTransitionActive(node))
      .nodeLabel((node) => buildNodeTooltip(node))
      .linkSource('source')
      .linkTarget('target')
      .linkVisibility((link) => isForceGraphLinkVisibleAtTimeline(link, timelineDayRef.current) || graphTransitionActive(link))
      .linkCurvature(() => getForceGraphLinkCurvature(settingsRef.current.arcStyle))
      .linkColor((link) => getForceGraphLinkColor(link, getForceGraphHighlightLinks(forceGraph), forceGraph))
      .linkOpacity(1)
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
        scheduleForceGraphFit(forceGraph);
      })
      .onNodeClick((node) => {
        if (Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.z)) {
          rotationPauseUntilRef.current = Number.POSITIVE_INFINITY;
          focusForceGraphNode(forceGraph, node);
          showFocusLabel(forceGraph, node);
        }
        onActiveSlugChangeRef.current?.(node.slug);
        onNodeOpenRef.current?.(node.slug);
      })
      .onBackgroundClick(() => {
        hideFocusLabel();
        onBackgroundClickRef.current?.();
      })
      .onNodeHover((node) => {
        hoveredSlugRef.current = node?.id || null;
        updateForceGraphHighlight(forceGraph, getForceGraphData(forceGraph), hoveredSlugRef.current || activeSlugRef.current, settingsRef.current.arcAnimation, false);
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
      hideFocusLabel();
      cancelInitialGraphReveal(forceGraph);
      cancelGraphTransitionLoop(forceGraph);
      cancelScheduledForceGraphFit(forceGraph);
      forceGraph.__bigBrainDisposed = true;
      forceGraph._destructor?.();
      graphRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!autoRotate) {
      rotationLastTimeRef.current = 0;
      return undefined;
    }

    const rotate = (time) => {
      const scene = graphRef.current?.scene?.();
      const previousTime = rotationLastTimeRef.current || time;
      const delta = Math.min(Math.max(0, time - previousTime), 100);
      if (scene && !userInteractingRef.current && !hoveredSlugRef.current && time >= rotationPauseUntilRef.current) {
        scene.rotation.z += (delta / 1000) * AUTO_ROTATION_RADIANS_PER_SECOND;
      }
      rotationLastTimeRef.current = time;
      rotationFrameRef.current = window.requestAnimationFrame(rotate);
    };

    rotationFrameRef.current = window.requestAnimationFrame(rotate);
    return () => {
      window.cancelAnimationFrame(rotationFrameRef.current);
      window.clearTimeout(focusReturnTimerRef.current);
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
      .nodeVisibility((node) => isForceGraphNodeVisibleAtTimeline(node, timelineDay) || graphTransitionActive(node))
      .linkVisibility((link) => isForceGraphLinkVisibleAtTimeline(link, timelineDay) || graphTransitionActive(link));
  }, [timelineDay]);

  useEffect(() => {
    const forceGraph = graphRef.current;
    if (!forceGraph) return;
    const arcStyleChanged = renderedArcStyleRef.current !== arcStyle;
    renderedArcStyleRef.current = arcStyle;
    forceGraph
      .backgroundColor(theme.graphBase)
      .linkCurvature(() => getForceGraphLinkCurvature(settingsRef.current.arcStyle));
    updateForceGraphNodeObjects(forceGraph, settingsRef.current);
    if (arcStyleChanged) refreshForceGraphLinkCurves(forceGraph, arcStyle);
    if (forceGraph.__bigBrainArcAnimation?.mode !== arcAnimation) {
      updateForceGraphHighlight(forceGraph, getForceGraphData(forceGraph), hoveredSlugRef.current || activeSlugRef.current, arcAnimation, !hoveredSlugRef.current);
    }
  }, [arcAnimation, arcStyle, colorMode, labelStyle, nodeFill, nodeIcon, nodeShape, nodeSize, theme, typeColors]);

  useEffect(() => {
    const forceGraph = graphRef.current;
    if (!forceGraph) return;
    if (!activeSlug) {
      rotationPauseUntilRef.current = 0;
      hideFocusLabel();
    }
    updateForceGraphHighlight(forceGraph, getForceGraphData(forceGraph), hoveredSlugRef.current || activeSlug, settingsRef.current.arcAnimation, !hoveredSlugRef.current);
  }, [activeSlug]);

  useEffect(() => {
    const forceGraph = graphRef.current;
    if (!forceGraph || !activeSlug) return undefined;
    let frame = 0;
    let attempts = 0;
    const focus = () => {
      const node = getForceGraphData(forceGraph).nodes?.find((item) => item.id === activeSlug || item.slug === activeSlug);
      if (node && Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.z)) {
        focusForceGraphNode(forceGraph, node);
        showFocusLabel(forceGraph, node);
        return;
      }
      if (attempts++ < 8) frame = window.requestAnimationFrame(focus);
    };
    frame = window.requestAnimationFrame(focus);
    return () => window.cancelAnimationFrame(frame);
  }, [activeSlug]);

  useEffect(() => {
    const forceGraph = graphRef.current;
    if (!forceGraph || !motionEvent?.changes?.length) return undefined;
    const target = [...motionEvent.changes].reverse().find((change) => change.kind !== 'removed' && change.slug);
    if (!target) return undefined;
    let frame = 0;
    let attempts = 0;
    let focusTimer = 0;
    const focus = () => {
      const data = getForceGraphData(forceGraph);
      const node = data.nodes?.find((item) => item.id === target.slug || item.slug === target.slug);
      if (node && Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.z)) {
        rotationPauseUntilRef.current = performance.now() + SYSTEM_ACTIVITY_PREFOCUS_DURATION + SYSTEM_FOCUS_HOLD_DURATION + FIT_TO_CANVAS_DURATION;
        updateForceGraphActivity(forceGraph, data, [target.slug], settingsRef.current.arcAnimation);
        focusTimer = window.setTimeout(() => {
          const latestData = getForceGraphData(forceGraph);
          const latestNode = latestData.nodes?.find((item) => item.id === target.slug || item.slug === target.slug);
          if (!latestNode || !Number.isFinite(latestNode.x) || !Number.isFinite(latestNode.y) || !Number.isFinite(latestNode.z)) return;
          updateForceGraphHighlight(forceGraph, latestData, target.slug, settingsRef.current.arcAnimation);
          focusForceGraphNode(forceGraph, latestNode);
          showFocusLabel(forceGraph, latestNode);
          rotationPauseUntilRef.current = performance.now() + SYSTEM_FOCUS_HOLD_DURATION + FIT_TO_CANVAS_DURATION;
          window.clearTimeout(focusReturnTimerRef.current);
          focusReturnTimerRef.current = window.setTimeout(() => {
            focusReturnTimerRef.current = 0;
            updateForceGraphHighlight(forceGraph, getForceGraphData(forceGraph), null, 'instant');
            hideFocusLabel();
            forceGraph.zoomToFit(FIT_TO_CANVAS_DURATION, FIT_TO_CANVAS_PADDING);
          }, SYSTEM_FOCUS_HOLD_DURATION);
        }, SYSTEM_ACTIVITY_PREFOCUS_DURATION);
        return;
      }
      if (attempts++ < 6) frame = window.requestAnimationFrame(focus);
    };
    frame = window.requestAnimationFrame(focus);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(focusTimer);
      window.clearTimeout(focusReturnTimerRef.current);
    };
  }, [motionEvent]);

  return (
    <div className="graph-canvas-shell force3d-shell">
      <div ref={containerRef} className="force3d-surface" aria-label="3D force-directed brain graph" />
      <div
        ref={focusLabelRef}
        className="force3d-focus-label"
        hidden
        aria-hidden="true"
        style={{
          position: 'absolute',
          zIndex: 3,
          pointerEvents: 'none',
          transform: 'translateY(-50%)',
          padding: '5px 8px',
          border: '1px solid rgba(228, 228, 231, 0.32)',
          borderRadius: '6px',
          background: 'rgba(12, 12, 16, 0.88)',
          boxShadow: '0 0 18px rgba(255, 255, 255, 0.18)',
          color: '#F4F4F5',
          font: '600 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace',
          whiteSpace: 'nowrap',
          maxWidth: 'min(320px, calc(100% - 24px))',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      />
    </div>
  );
});

function syncForceGraphData(forceGraph, graph, settings, focusSlug = null, options = {}) {
  const fromInitialReveal = options.fromInitialReveal === true;
  if (!fromInitialReveal) cancelInitialGraphReveal(forceGraph);
  if (!forceGraph.__bigBrainHasData && !fromInitialReveal && !focusSlug) {
    const stages = buildInitialGraphRevealStages(graph);
    if (stages.length > 1) {
      startInitialGraphReveal(forceGraph, stages, settings, focusSlug);
      return;
    }
  }

  const previousData = getForceGraphData(forceGraph);
  const previousNodes = new Map((previousData.nodes || []).map((node) => [node.id, node]));
  const previousLinks = new Map((previousData.links || []).map((link) => [link.id, link]));
  const nodes = (Array.isArray(graph?.nodes) ? graph.nodes : []).map((node) => {
    const next = previousNodes.get(node.slug) || {};
    Object.assign(next, node, {
      id: node.slug,
      slug: node.slug,
      color: normalizeHex(getGraphNodeColor(node, settings.colorMode, settings.typeColors), DEFAULT_NODE_COLOR),
    });
    return next;
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = (Array.isArray(graph?.edges) ? graph.edges : [])
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge }) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map(({ edge, index }) => {
      const id = edge.id || `${edge.source}:${edge.target}:${index}`;
      const previous = previousLinks.get(id);
      const previousSource = previous?.source;
      const previousTarget = previous?.target;
      const next = previousLinks.get(id) || {};
      Object.assign(next, edge, { id });
      next.source = previousSource && typeof previousSource === 'object' ? previousSource : edge.source;
      next.target = previousTarget && typeof previousTarget === 'object' ? previousTarget : edge.target;
      return next;
    });

  const targetData = { nodes, links };
  const transitioned = prepareGraphTransitionData(previousData, targetData);
  const data = transitioned.displayData;
  const forceData = prepareForceGraphData(data);
  const previousNodeIds = new Set(previousData.nodes?.map((node) => node.id) || []);
  const previousLinkIds = new Set(previousData.links?.map((link) => link.id) || []);
  const targetNodeIds = new Set(nodes.map((node) => node.id));
  const targetLinkIds = new Set(links.map((link) => link.id));
  const previousTargetNodeIds = forceGraph.__bigBrainTargetNodeIds;
  const previousTargetLinkIds = forceGraph.__bigBrainTargetLinkIds;
  const wasInitialized = Boolean(forceGraph.__bigBrainInitialized);
  const hadGraphData = Boolean(forceGraph.__bigBrainHasData);
  const membershipChanged = !forceGraph.__bigBrainInitialized
    || data.nodes.length !== previousNodeIds.size
    || data.links.length !== previousLinkIds.size
    || data.nodes.some((node) => !previousNodeIds.has(node.id))
    || data.links.some((link) => !previousLinkIds.has(link.id));
  const targetChanged = !sameIdSet(previousTargetNodeIds, targetNodeIds)
    || !sameIdSet(previousTargetLinkIds, targetLinkIds);
  const layoutChanged = nodes.some((node) => previousNodes.get(node.id)?.degree !== node.degree);
  if (membershipChanged || targetChanged || layoutChanged) {
    if (wasInitialized) {
      forceGraph.warmupTicks(0).cooldownTicks(GRAPH_UPDATE_COOLDOWN_TICKS).cooldownTime(GRAPH_UPDATE_COOLDOWN_TIME);
    }
    forceGraph.__bigBrainFitPending = options.fitAfterUpdate
      ?? (!wasInitialized || (!hadGraphData && nodes.length > 0));
    forceGraph.graphData(forceData);
  } else {
    updateForceGraphNodeObjects(forceGraph, settings);
  }
  if (nodes.length > 0) forceGraph.__bigBrainHasData = true;
  forceGraph.__bigBrainTargetNodeIds = targetNodeIds;
  forceGraph.__bigBrainTargetLinkIds = targetLinkIds;
  if (transitioned.transitionItems.length) {
    const transitionTarget = targetData;
    forceGraph.__bigBrainTransitionTarget = transitionTarget;
    startGraphTransitionLoop(forceGraph, {
      items: transitioned.transitionItems,
      onFrame: () => {
        updateForceGraphTransitionNodes(data.nodes);
      },
      onComplete: () => {
        if (forceGraph.__bigBrainTransitionTarget !== transitionTarget) return;
        forceGraph.__bigBrainTransitionTarget = null;
        const forceTargetData = prepareForceGraphData(targetData);
        forceGraph.graphData(forceTargetData);
        graphDataRefFor(forceGraph, forceTargetData);
      },
    });
  }
  forceGraph.__bigBrainInitialized = true;
  graphDataRefFor(forceGraph, getForceGraphData(forceGraph));
  updateForceGraphHighlight(forceGraph, getForceGraphData(forceGraph), focusSlug, settings.arcAnimation);
}

function startInitialGraphReveal(forceGraph, stages, settings, focusSlug) {
  cancelInitialGraphReveal(forceGraph);
  const reveal = { stages, nextIndex: 1, timer: 0 };
  forceGraph.__bigBrainInitialReveal = reveal;
  syncForceGraphData(forceGraph, stages[0], settings, focusSlug, {
    fromInitialReveal: true,
    fitAfterUpdate: false,
  });

  const advance = () => {
    if (forceGraph.__bigBrainInitialReveal !== reveal) return;
    const stage = stages[reveal.nextIndex];
    if (!stage) {
      forceGraph.__bigBrainInitialReveal = null;
      return;
    }
    const isFinalStage = reveal.nextIndex === stages.length - 1;
    reveal.nextIndex += 1;
    syncForceGraphData(forceGraph, stage, settings, focusSlug, {
      fromInitialReveal: true,
      fitAfterUpdate: isFinalStage,
    });
    if (!isFinalStage) reveal.timer = window.setTimeout(advance, INITIAL_GRAPH_REVEAL_STEP_MS);
    else forceGraph.__bigBrainInitialReveal = null;
  };

  reveal.timer = window.setTimeout(advance, INITIAL_GRAPH_REVEAL_STEP_MS);
}

function cancelInitialGraphReveal(forceGraph) {
  const reveal = forceGraph?.__bigBrainInitialReveal;
  if (!reveal) return;
  window.clearTimeout(reveal.timer);
  forceGraph.__bigBrainInitialReveal = null;
}

function scheduleForceGraphFit(forceGraph) {
  cancelScheduledForceGraphFit(forceGraph);
  forceGraph.__bigBrainFitFrame = window.requestAnimationFrame(() => {
    forceGraph.__bigBrainFitFrame = 0;
    if (forceGraph.__bigBrainDisposed) return;
    const data = getForceGraphData(forceGraph);
    const width = forceGraph.width?.() || 0;
    const height = forceGraph.height?.() || 0;
    if (width <= 1 || height <= 1 || !data.nodes?.length) {
      forceGraph.__bigBrainFitPending = true;
      return;
    }
    forceGraph.__bigBrainFitPending = false;
    forceGraph.zoomToFit(FIT_TO_CANVAS_DURATION, FIT_TO_CANVAS_PADDING);
  });
}

function cancelScheduledForceGraphFit(forceGraph) {
  if (!forceGraph?.__bigBrainFitFrame) return;
  window.cancelAnimationFrame(forceGraph.__bigBrainFitFrame);
  forceGraph.__bigBrainFitFrame = 0;
}

function sameIdSet(left, right) {
  if (!left || left.size !== right.size) return false;
  for (const id of right) if (!left.has(id)) return false;
  return true;
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

function isForceGraphNodeVisibleAtTimeline(node, timelineDay) {
  if (!timelineDay || !node || typeof node !== 'object') return true;
  const timestamp = Date.parse(node.lineage_at || node.created_at || node.updated_at);
  if (!Number.isFinite(timestamp)) return true;
  return new Date(timestamp).toISOString().slice(0, 10) <= timelineDay;
}

function isForceGraphLinkVisibleAtTimeline(link, timelineDay) {
  if (!timelineDay) return true;
  return isForceGraphNodeVisibleAtTimeline(link?.source, timelineDay)
    && isForceGraphNodeVisibleAtTimeline(link?.target, timelineDay);
}

function updateForceGraphHighlight(forceGraph, data, focusSlug, arcAnimation = 'instant', showFocusLabel = true) {
  const resolvedData = forceGraph.graphData?.() || data || { nodes: [], links: [] };
  graphDataRefFor(forceGraph, resolvedData);
  const nodes = Array.isArray(resolvedData.nodes) ? resolvedData.nodes : [];
  const links = Array.isArray(resolvedData.links) ? resolvedData.links : [];
  const focusNode = nodes.find((node) => node.id === focusSlug || node.slug === focusSlug);
  const highlightedNodes = new Set(showFocusLabel && focusNode ? [focusNode.id] : []);
  const highlightedLinks = new Set();

  if (focusNode) {
    for (const link of links) {
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      const targetId = typeof link.target === 'object' ? link.target.id : link.target;
      if (sourceId === focusNode.id || targetId === focusNode.id) {
        highlightedLinks.add(link);
      }
    }
  }

  const previousLinks = getForceGraphHighlightLinks(forceGraph);
  const animatedLinks = arcAnimation === 'none' ? new Set() : highlightedLinks;
  forceGraph.__bigBrainHighlightLinks = animatedLinks;
  for (const node of nodes) syncForceGraphNodeState(node, highlightedNodes);

  if (arcAnimation === 'grow' || arcAnimation === 'shoot') {
    const affectedLinks = new Set([...previousLinks, ...animatedLinks]);
    startArcAnimation(forceGraph, arcAnimation, animatedLinks, () => {
      updateForceGraphAnimatedLinks(forceGraph, affectedLinks);
    });
  } else {
    // Set the completed state before the library evaluates its accessors. This
    // keeps Instant identical to the original immediate highlight path.
    startArcAnimation(forceGraph, arcAnimation, animatedLinks);
  }
  applyForceGraphArcAccessors(forceGraph);
  if (arcAnimation === 'shoot') {
    animatedLinks.forEach((link) => forceGraph.emitParticle?.(link));
  }
}

function updateForceGraphActivity(forceGraph, data, slugs, arcAnimation = 'instant') {
  const resolvedData = forceGraph.graphData?.() || data || { nodes: [], links: [] };
  const nodes = Array.isArray(resolvedData.nodes) ? resolvedData.nodes : [];
  const links = Array.isArray(resolvedData.links) ? resolvedData.links : [];
  const activitySet = new Set(slugs);
  const focusNode = nodes.find((node) => activitySet.has(node.id) || activitySet.has(node.slug));
  const highlightedLinks = new Set();
  for (const link of links) {
    const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
    const targetId = typeof link.target === 'object' ? link.target.id : link.target;
    if (focusNode && (sourceId === focusNode.id || targetId === focusNode.id)) {
      highlightedLinks.add(link);
    }
  }
  const animatedLinks = arcAnimation === 'none' ? new Set() : highlightedLinks;
  const previousLinks = getForceGraphHighlightLinks(forceGraph);
  forceGraph.__bigBrainHighlightLinks = animatedLinks;
  for (const node of nodes) syncForceGraphNodeState(node, focusNode ? new Set([focusNode.id]) : new Set());
  if (arcAnimation === 'grow' || arcAnimation === 'shoot') {
    const affectedLinks = new Set([...previousLinks, ...animatedLinks]);
    startArcAnimation(forceGraph, arcAnimation, animatedLinks, () => {
      updateForceGraphAnimatedLinks(forceGraph, affectedLinks);
    });
  } else {
    startArcAnimation(forceGraph, arcAnimation, animatedLinks);
  }
  applyForceGraphArcAccessors(forceGraph);
  if (arcAnimation === 'shoot') {
    animatedLinks.forEach((link) => forceGraph.emitParticle?.(link));
  }
}

function applyForceGraphArcAccessors(forceGraph) {
  forceGraph
    .linkColor((link) => getForceGraphLinkColor(link, getForceGraphHighlightLinks(forceGraph), forceGraph))
    .linkOpacity(1)
    .linkWidth((link) => getForceGraphLinkWidth(link, getForceGraphHighlightLinks(forceGraph), forceGraph))
    .linkDirectionalParticles((link) => shouldShowParticles(link, getForceGraphData(forceGraph).nodes.length, getForceGraphHighlightLinks(forceGraph), forceGraph))
    .linkDirectionalParticleSpeed((link) => getForceGraphParticleSpeed(link, forceGraph))
    .linkDirectionalParticleWidth((link) => getForceGraphHighlightLinks(forceGraph).has(link) ? 1.8 : 0.7)
    .linkDirectionalParticleColor((link) => getForceGraphLinkColor(link, getForceGraphHighlightLinks(forceGraph), forceGraph));
}

function getForceGraphHighlightLinks(forceGraph) {
  return forceGraph?.__bigBrainHighlightLinks || new Set();
}

function syncForceGraphNodeState(node, highlightedNodes) {
  const visual = node.__bigBrainVisual;
  if (!visual) return;
  const emphasized = highlightedNodes.has(node.id);
  visual.group.scale.setScalar(graphTransitionProgress(node));
  if (visual.label) visual.label.visible = visual.labelBaseVisible;
  if (visual.glow) visual.glow.visible = emphasized;
}

function updateForceGraphTransitionNodes(nodes) {
  for (const node of nodes) {
    const group = node.__bigBrainVisual?.group;
    if (group) group.scale.setScalar(graphTransitionProgress(node));
  }
}

function updateForceGraphNodeObjects(forceGraph, settings) {
  const data = getForceGraphData(forceGraph);
  for (const node of data.nodes || []) {
    const group = node.__bigBrainVisual?.group;
    if (group) createForceGraphNodeObject(node, settings, group);
  }
}

function createForceGraphNodeObject(node, settings, existingGroup = null) {
  const group = existingGroup || new THREE.Group();
  if (existingGroup) disposeForceGraphNodeChildren(group);
  const nodeColor = normalizeHex(getGraphNodeColor(node, settings.colorMode, settings.typeColors), DEFAULT_NODE_COLOR);
  const radius = getForceGraphNodeRadius(node, settings.nodeSize);
  const geometry = settings.nodeFill === 'none' ? null : createNodeGeometry(settings.nodeShape, radius);
  const glow = createForceGraphNodeGlow(radius);
  group.add(glow);

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
  node.__bigBrainVisual = {
    group,
    label,
    labelBaseVisible,
    glow,
  };
  syncForceGraphNodeState(node, new Set());
  return group;
}

function createForceGraphNodeGlow(radius) {
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getForceGraphGlowTexture(),
      color: '#FFFFFF',
      transparent: true,
      opacity: 0.96,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    }),
  );
  glow.scale.setScalar(radius * 7);
  glow.renderOrder = -1;
  glow.userData.bigBrainGlow = true;
  glow.raycast = () => {};
  glow.visible = false;
  return glow;
}

function getForceGraphGlowTexture() {
  if (FORCE_GRAPH_GLOW_TEXTURE) return FORCE_GRAPH_GLOW_TEXTURE;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
  gradient.addColorStop(0.18, 'rgba(255, 255, 255, 0.55)');
  gradient.addColorStop(0.42, 'rgba(255, 255, 255, 0.34)');
  gradient.addColorStop(0.68, 'rgba(255, 255, 255, 0.16)');
  gradient.addColorStop(0.86, 'rgba(255, 255, 255, 0.05)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  FORCE_GRAPH_GLOW_TEXTURE = new THREE.CanvasTexture(canvas);
  FORCE_GRAPH_GLOW_TEXTURE.needsUpdate = true;
  return FORCE_GRAPH_GLOW_TEXTURE;
}

function disposeForceGraphNodeChildren(group) {
  for (const child of [...group.children]) {
    disposeForceGraphObject(child);
    group.remove(child);
  }
}

function disposeForceGraphObject(object) {
  object.children?.forEach(disposeForceGraphObject);
  object.geometry?.dispose?.();
  if (object.material) {
    if (object.userData?.bigBrainOwnedTexture) object.material.map?.dispose?.();
    object.material.dispose?.();
  }
}

function createForceGraphNodeLabel(node, settings, radius) {
  const labelWidth = Math.min(180, Math.max(34, String(node.title || node.slug).length * 4.8 + 6));
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
  const context = canvas.getContext('2d');
  const value = String(text).slice(0, label ? 36 : 2);
  const fontSize = label ? 16 : 25;
  context.font = `${label ? '600' : '800'} ${fontSize}px "SF Mono", "IBM Plex Mono", monospace`;
  const measuredWidth = label ? context.measureText(value).width + 8 : width * scale;
  canvas.width = Math.max(64, Math.ceil(measuredWidth));
  canvas.height = Math.max(32, Math.ceil(height * scale));
  context.clearRect(0, 0, canvas.width, canvas.height);
  // Assigning canvas dimensions resets the 2D context state, including the
  // font used for measurement. Restore it before drawing the glyphs.
  context.font = `${label ? '600' : '800'} ${fontSize}px "SF Mono", "IBM Plex Mono", monospace`;
  context.fillStyle = color;
  context.textAlign = label ? 'left' : 'center';
  context.textBaseline = 'middle';
  context.fillText(value, label ? 2 : canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Keep glyphs in a camera-facing billboard layer. This prevents the node
  // icon and label texture from inheriting the graph's 3D perspective.
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false }));
  sprite.material.rotation = 0;
  // Keep the label attached to the same camera-scaled billboard path as the
  // node icon. The measured texture below preserves its natural aspect ratio.
  sprite.material.sizeAttenuation = true;
  sprite.renderOrder = label ? 20 : 10;
  sprite.scale.set(label ? canvas.width / scale : width, height, 1);
  sprite.center.set(label ? 0 : 0.5, 0.5);
  if (label) sprite.userData.bigBrainOwnedTexture = true;
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

function refreshForceGraphLinkCurves(forceGraph, arcStyle) {
  const links = getForceGraphData(forceGraph).links || [];
  for (const link of links) {
    const source = typeof link.source === 'object' ? link.source : null;
    const target = typeof link.target === 'object' ? link.target : null;
    if (!source || !target || !Number.isFinite(source.x) || !Number.isFinite(target.x)) continue;

    const curve = createForceGraphLinkCurve(source, target, getForceGraphLinkCurvature(arcStyle));
    link.__curve = curve;
    const line = link.__lineObj?.children?.length ? link.__lineObj.children[0] : link.__lineObj;
    if (line?.type !== 'Line' || !line.geometry) continue;

    const points = curve
      ? curve.getPoints(30)
      : [toForceGraphPoint(source), toForceGraphPoint(target)];
    const position = line.geometry.getAttribute('position');
    if (!position || position.array.length !== points.length * 3) {
      line.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points.length * 3), 3));
    }
    line.geometry.setFromPoints(points);
    line.geometry.computeBoundingSphere();
  }
}

function createForceGraphLinkCurve(source, target, curvature) {
  if (!curvature) return null;
  const start = toForceGraphPoint(source);
  const end = toForceGraphPoint(target);
  const line = new THREE.Vector3().subVectors(end, start);
  const axis = source.x !== target.x || source.y !== target.y
    ? new THREE.Vector3(0, 0, 1)
    : new THREE.Vector3(0, 1, 0);
  const control = line.clone()
    .multiplyScalar(curvature)
    .cross(axis)
    .add(start.clone().add(end).multiplyScalar(0.5));
  return new THREE.QuadraticBezierCurve3(start, control, end);
}

function toForceGraphPoint(node) {
  return new THREE.Vector3(node.x, node.y || 0, node.z || 0);
}

function getForceGraphLinkColor(link, highlightedLinks, forceGraph) {
  const transition = graphTransitionProgress(link);
  if (highlightedLinks.has(link)) {
    const progress = arcAnimationProgress(forceGraph, link);
    return hexToRgba(
      progress >= 1 ? '#DDE7F5' : blendArcColors(DEFAULT_LINK_COLOR, '#DDE7F5', progress),
      (0.2 + progress * 0.52) * transition,
    );
  }
  // Keep relationship lines neutral across the graph. ForceGraph resolves
  // string endpoints into node objects after the initial draw, so deriving
  // this from source.color makes links unexpectedly change color on redraw.
  return hexToRgba(DEFAULT_LINK_COLOR, 0.2 * transition);
}

function getForceGraphLinkWidth(link, highlightedLinks, forceGraph) {
  const transition = graphTransitionProgress(link);
  if (!highlightedLinks.has(link)) return 0;
  if (forceGraph?.__bigBrainArcAnimation?.mode === 'instant') return 0;
  return (arcAnimationProgress(forceGraph, link) >= 0.18 ? 1.5 : 0) * transition;
}

function updateForceGraphAnimatedLinks(forceGraph, links) {
  for (const link of links) {
    const progress = arcAnimationProgress(forceGraph, link);
    const color = blendArcColors(DEFAULT_LINK_COLOR, '#DDE7F5', progress);
    const opacity = 0.2 + progress * 0.52;
    const lineObject = link.__lineObj?.children?.length ? link.__lineObj.children[0] : link.__lineObj;
    updateForceGraphMaterial(lineObject, color, opacity);
    link.__singleHopPhotonsObj?.children?.forEach((particle) => updateForceGraphMaterial(particle, color, opacity));
  }
}

function updateForceGraphMaterial(lineObject, color, opacity) {
  let material = lineObject?.material;
  if (!material) return;
  // three-forcegraph caches materials by color. Clone before changing one
  // focused link, otherwise every neutral link sharing that cache entry
  // changes at the same time.
  if (material.__bigBrainArcMaterialOwner !== lineObject) {
    material = material.clone();
    material.__bigBrainArcMaterialOwner = lineObject;
    lineObject.material = material;
  }
  material.color?.set?.(color);
  material.opacity = opacity;
  material.transparent = true;
  material.needsUpdate = true;
}

function shouldShowParticles(link, nodeCount, highlightedLinks, forceGraph) {
  if (highlightedLinks.has(link)) {
    return forceGraph?.__bigBrainArcAnimation?.mode === 'shoot' ? 4 : 0;
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
  const camera = forceGraph?.camera?.();
  if (!camera?.position) return;
  camera.position.multiplyScalar(factor);
  forceGraph.controls?.().update?.();
}

function focusForceGraphNode(forceGraph, node) {
  const target = { x: node.x, y: node.y, z: node.z };
  const camera = forceGraph.camera?.();
  const current = camera?.position;
  const dx = (current?.x || 0) - target.x;
  const dy = (current?.y || 0) - target.y;
  const dz = (current?.z || 0) - target.z;
  const currentDistance = Math.hypot(dx, dy, dz);
  const distance = Math.min(Math.max(currentDistance || 90, 42), 150);
  const directionLength = currentDistance || 1;
  const position = currentDistance
    ? { x: target.x + (dx / directionLength) * distance, y: target.y + (dy / directionLength) * distance, z: target.z + (dz / directionLength) * distance }
    : { x: target.x, y: target.y, z: target.z + distance };
  forceGraph.cameraPosition(position, target, 850);
}

function focusForceGraphNodeBySlug(forceGraph, slug) {
  const node = getForceGraphData(forceGraph).nodes?.find((item) => item.id === slug || item.slug === slug);
  if (!forceGraph || !node || !Number.isFinite(node.x) || !Number.isFinite(node.y) || !Number.isFinite(node.z)) return;
  forceGraph.zoomToFit(0, FIT_TO_CANVAS_PADDING);
  focusForceGraphNode(forceGraph, node);
}
