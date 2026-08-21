import React, { forwardRef, useEffect, useEffectEvent, useImperativeHandle, useRef, useState } from 'react';
import { DataSet, Network } from 'vis-network/standalone';

import {
  buildVisNetworkEdges,
  buildVisNetworkFocusUpdates,
  buildVisNetworkNodes,
  findNearestVisNetworkNode,
  getVisNetworkLabelSlugs,
  seedVisNetworkNodePosition,
} from './vis-network-data.js';
import { PRESET_GRAPH_LABEL_FONT_SIZE, useGraphTheme } from './visualizer-core.jsx';

export const VisNetworkVisualizer = forwardRef(function VisNetworkVisualizer({
  graph,
  onNodeOpen,
  activeSlug,
  onActiveSlugChange,
  colorMode = 'updated',
  labelStyle = 'selected',
  nodeStyle = 'orb',
  motionEvent = null,
}, ref) {
  const theme = useGraphTheme();
  const canvasRef = useRef(null);
  const networkRef = useRef(null);
  const nodeDataRef = useRef(null);
  const edgeDataRef = useRef(null);
  const nodeTitlesRef = useRef(new Map());
  const nodeTypesRef = useRef(new Map());
  const baseLabelSlugsRef = useRef(new Set());
  const previousActiveSlugRef = useRef(null);
  const hoveredSlugRef = useRef(null);
  const applyFocusRef = useRef(() => {});
  const scheduleLabelsRef = useRef(() => {});
  const overlaySignatureRef = useRef('');
  const graphRef = useRef(graph);
  const visualSettingsRef = useRef({ colorMode, labelStyle, nodeStyle });
  const activeSlugRef = useRef(activeSlug);
  const [overlayLabels, setOverlayLabels] = useState([]);
  const [booted, setBooted] = useState(false);
  const [livePulses, setLivePulses] = useState([]);
  graphRef.current = graph;
  activeSlugRef.current = activeSlug;
  visualSettingsRef.current = { colorMode, labelStyle, nodeStyle };
  const handleNodeOpen = useEffectEvent((nodeId) => {
    onNodeOpen?.(nodeId);
  });
  const handleActiveChange = useEffectEvent((nodeId) => {
    onActiveSlugChange?.(nodeId);
  });

  useImperativeHandle(ref, () => ({
    zoomIn() {
      const network = networkRef.current;
      if (!network) return;
      network.moveTo({
        scale: Math.min(3.2, network.getScale() * 1.18),
        animation: {
          duration: 220,
          easingFunction: 'easeInOutQuad',
        },
      });
    },
    zoomOut() {
      const network = networkRef.current;
      if (!network) return;
      network.moveTo({
        scale: Math.max(0.42, network.getScale() / 1.18),
        animation: {
          duration: 220,
          easingFunction: 'easeInOutQuad',
        },
      });
    },
    resetView() {
      networkRef.current?.fit({
        animation: {
          duration: 250,
          easingFunction: 'easeInOutQuad',
        },
      });
    },
  }), []);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const initialGraph = graphRef.current;
    setBooted(false);

    const nodes = new DataSet(buildVisNetworkNodes(initialGraph.nodes, {
      colorMode: visualSettingsRef.current.colorMode,
      nodeStyle: visualSettingsRef.current.nodeStyle,
      theme,
    }));
    const edges = new DataSet(buildVisNetworkEdges(initialGraph.edges, theme));
    nodeDataRef.current = nodes;
    edgeDataRef.current = edges;
    nodeTitlesRef.current = new Map(initialGraph.nodes.map((node) => [node.slug, node.title]));
    nodeTypesRef.current = new Map(initialGraph.nodes.map((node) => [node.slug, node.type]));
    baseLabelSlugsRef.current = getVisNetworkLabelSlugs(initialGraph.nodes, visualSettingsRef.current.labelStyle);

    const network = new Network(
      canvasRef.current,
      {
        nodes,
        edges,
      },
      {
        autoResize: true,
        interaction: {
          hover: true,
          navigationButtons: false,
          selectConnectedEdges: false,
          hoverConnectedEdges: false,
        },
        nodes: {
          shape: 'dot',
          scaling: { min: 10, max: 26 },
          font: {
            face: '"SF Mono", "IBM Plex Mono", ui-monospace, monospace',
            color: theme.graphLabel,
            size: PRESET_GRAPH_LABEL_FONT_SIZE,
            strokeWidth: 0,
          },
          borderWidth: 1.5,
          borderWidthSelected: 2,
          shadow: {
            enabled: true,
            color: theme.graphHalo,
            size: 20,
            x: 0,
            y: 0,
          },
        },
        edges: {
          color: {
            color: theme.graphEdge,
            highlight: theme.graphEdgeStrong,
          },
          smooth: {
            enabled: true,
            type: 'dynamic',
          },
          width: 1.1,
        },
        physics: {
          enabled: true,
          stabilization: {
            enabled: true,
            iterations: 180,
            updateInterval: 25,
          },
          barnesHut: {
            gravitationalConstant: -4200,
            springLength: 125,
            springConstant: 0.035,
            damping: 0.18,
            centralGravity: 0.16,
          },
        },
        layout: {
          improvedLayout: true,
        },
      },
    );

    let labelFrame = 0;
    let pointerFrame = 0;
    let pendingPointer = null;
    let bootRevealTimer = 0;
    const applyFocus = (focusSlug) => {
      const validFocusSlug = nodeTitlesRef.current.has(focusSlug) ? focusSlug : null;
      const currentGraph = graphRef.current;
      const updates = buildVisNetworkFocusUpdates(currentGraph.nodes, currentGraph.edges, validFocusSlug, theme);
      nodes.update(updates.nodes);
      edges.update(updates.edges);
      if (validFocusSlug) network.selectNodes([validFocusSlug], false);
      else network.unselectAll();
    };
    applyFocusRef.current = applyFocus;

    const syncOverlayLabels = () => {
      labelFrame = 0;
      const visible = new Set(baseLabelSlugsRef.current);
      if (activeSlugRef.current) visible.add(activeSlugRef.current);
      if (hoveredSlugRef.current) visible.add(hoveredSlugRef.current);
      const positions = network.getPositions([...visible]);
      const width = canvasRef.current?.clientWidth || 0;
      const next = [...visible].flatMap((slug) => {
        const position = positions[slug];
        if (!position) return [];
        const dom = network.canvasToDOM(position);
        return [{
          slug,
          title: nodeTitlesRef.current.get(slug) || slug,
          type: nodeTypesRef.current.get(slug) || 'page',
          x: Math.round(dom.x * 2) / 2,
          y: Math.round(dom.y * 2) / 2,
          flip: dom.x > width - 250,
          emphasized: slug === activeSlugRef.current || slug === hoveredSlugRef.current,
        }];
      });
      const signature = JSON.stringify(next);
      if (signature === overlaySignatureRef.current) return;
      overlaySignatureRef.current = signature;
      setOverlayLabels(next);
    };
    const scheduleLabels = () => {
      if (labelFrame) return;
      labelFrame = requestAnimationFrame(syncOverlayLabels);
    };
    scheduleLabelsRef.current = scheduleLabels;

    const findNearestNode = (domPoint) => {
      const canvasPositions = network.getPositions();
      const domPositions = Object.fromEntries(Object.entries(canvasPositions).map(([slug, position]) => [
        slug,
        network.canvasToDOM(position),
      ]));
      return findNearestVisNetworkNode(domPoint, domPositions);
    };

    network.once('stabilizationIterationsDone', () => {
      network.setOptions({ physics: false });
      let revealed = false;
      const revealBoot = () => {
        if (revealed) return;
        revealed = true;
        window.clearTimeout(bootRevealTimer);
        setBooted(true);
        scheduleLabels();
      };
      network.once('animationFinished', revealBoot);
      network.fit({
        animation: {
          duration: 250,
          easingFunction: 'easeInOutQuad',
        },
      });
      bootRevealTimer = window.setTimeout(revealBoot, 320);
      scheduleLabels();
    });

    network.on('click', (event) => {
      const nodeId = event.nodes?.[0] || findNearestNode(event.pointer?.DOM);
      if (!nodeId) return;
      handleActiveChange(nodeId);
      handleNodeOpen(nodeId);
    });
    network.on('afterDrawing', scheduleLabels);

    const canvas = canvasRef.current;
    const handlePointerMove = (event) => {
      const bounds = canvas.getBoundingClientRect();
      pendingPointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      if (pointerFrame) return;
      pointerFrame = requestAnimationFrame(() => {
        pointerFrame = 0;
        const nearest = findNearestNode(pendingPointer);
        if (nearest === hoveredSlugRef.current) return;
        hoveredSlugRef.current = nearest;
        applyFocus(activeSlugRef.current || nearest);
        scheduleLabels();
      });
    };
    const handlePointerLeave = () => {
      pendingPointer = null;
      if (pointerFrame) cancelAnimationFrame(pointerFrame);
      pointerFrame = 0;
      if (!hoveredSlugRef.current) return;
      hoveredSlugRef.current = null;
      applyFocus(activeSlugRef.current);
      scheduleLabels();
    };
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerleave', handlePointerLeave);

    networkRef.current = network;
    const currentActiveSlug = activeSlugRef.current;
    if (currentActiveSlug && nodeTitlesRef.current.has(currentActiveSlug)) {
      applyFocus(currentActiveSlug);
    }
    previousActiveSlugRef.current = currentActiveSlug || null;
    scheduleLabels();
    return () => {
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerleave', handlePointerLeave);
      if (labelFrame) cancelAnimationFrame(labelFrame);
      if (pointerFrame) cancelAnimationFrame(pointerFrame);
      window.clearTimeout(bootRevealTimer);
      network.destroy();
      networkRef.current = null;
      nodeDataRef.current = null;
      edgeDataRef.current = null;
      applyFocusRef.current = () => {};
      scheduleLabelsRef.current = () => {};
      overlaySignatureRef.current = '';
      setOverlayLabels([]);
      setLivePulses([]);
    };
  }, [theme.graphEdge, theme.graphEdgeStrong, theme.graphHalo, theme.graphLabel, theme.graphNodeStroke]);

  useEffect(() => {
    const nodeData = nodeDataRef.current;
    const edgeData = edgeDataRef.current;
    const network = networkRef.current;
    if (!nodeData || !edgeData || !network) return;
    nodeTitlesRef.current = new Map(graph.nodes.map((node) => [node.slug, node.title]));
    nodeTypesRef.current = new Map(graph.nodes.map((node) => [node.slug, node.type]));
    baseLabelSlugsRef.current = getVisNetworkLabelSlugs(graph.nodes, labelStyle);

    const existingNodeIds = new Set(nodeData.getIds());
    const incomingNodeIds = new Set(graph.nodes.map((node) => node.slug));
    const removedNodeIds = [...existingNodeIds].filter((slug) => !incomingNodeIds.has(slug));
    if (removedNodeIds.length) nodeData.remove(removedNodeIds);

    const styledNodes = buildVisNetworkNodes(graph.nodes, { colorMode, nodeStyle, theme });
    const existingPositions = network.getPositions([...existingNodeIds]);
    const viewPosition = network.getViewPosition();
    const existingUpdates = [];
    const additions = [];
    for (const node of styledNodes) {
      if (existingNodeIds.has(node.id)) {
        existingUpdates.push(node);
      } else {
        const position = seedVisNetworkNodePosition(node.id, graph.edges, existingPositions, viewPosition);
        additions.push({ ...node, ...position, physics: false });
        existingPositions[node.id] = position;
      }
    }
    if (existingUpdates.length) nodeData.update(existingUpdates);
    if (additions.length) nodeData.add(additions);

    const nextEdges = buildVisNetworkEdges(graph.edges, theme);
    const incomingEdgeIds = new Set(nextEdges.map((edge) => edge.id));
    const removedEdgeIds = edgeData.getIds().filter((id) => !incomingEdgeIds.has(id));
    if (removedEdgeIds.length) edgeData.remove(removedEdgeIds);
    if (nextEdges.length) edgeData.update(nextEdges);

    applyFocusRef.current(activeSlugRef.current || hoveredSlugRef.current);
    scheduleLabelsRef.current();
  }, [colorMode, graph, labelStyle, nodeStyle, theme.graphEdge, theme.graphEdgeStrong, theme.graphNodeStroke]);

  useEffect(() => {
    const network = networkRef.current;
    if (!network || !motionEvent?.changes?.length) return undefined;
    const visibleChanges = motionEvent.changes.filter((change) => nodeTitlesRef.current.has(change.slug));
    if (!visibleChanges.length) return undefined;
    const positions = network.getPositions(visibleChanges.map((change) => change.slug));
    setLivePulses(visibleChanges.flatMap((change) => {
      const position = positions[change.slug];
      if (!position) return [];
      const dom = network.canvasToDOM(position);
      return [{
        ...change,
        x: dom.x,
        y: dom.y,
        title: nodeTitlesRef.current.get(change.slug) || change.slug,
      }];
    }));
    const timer = window.setTimeout(() => setLivePulses([]), 1700);
    return () => window.clearTimeout(timer);
  }, [motionEvent]);

  useEffect(() => {
    const network = networkRef.current;
    if (!network) return;
    applyFocusRef.current(activeSlug || hoveredSlugRef.current);
    previousActiveSlugRef.current = activeSlug || null;
    scheduleLabelsRef.current();
  }, [activeSlug]);

  return (
    <div className={`graph-canvas-shell force-shell ${booted ? 'vis-network-booted' : 'vis-network-booting'}`}>
      <div
        ref={canvasRef}
        className="vis-network-surface"
        style={{ width: '100%', height: '100%' }}
      />
      <div className="vis-network-boot-overlay" aria-hidden="true">
        <span className="vis-network-scan-beam" />
        <span className="vis-network-boot-reticle" />
        <span className="vis-network-boot-copy">NEURAL MAP ONLINE</span>
      </div>
      <div className="vis-network-label-layer" aria-hidden="true">
        {overlayLabels.map((label) => (
          <div
            key={label.slug}
            className={`vis-network-label ${label.flip ? 'flip' : ''} ${label.emphasized ? 'emphasized' : ''}`}
            style={{ left: label.x, top: label.y }}
          >
            <span className="vis-network-label-rule" />
            <span className="vis-network-label-copy">
              <strong>{label.title}</strong>
              {label.emphasized ? <small>{label.type}</small> : null}
            </span>
          </div>
        ))}
      </div>
      <div className="vis-network-live-layer" aria-hidden="true">
        {livePulses.map((pulse) => (
          <div
            key={`${motionEvent?.id || 'live'}:${pulse.slug}`}
            className={`vis-network-live-pulse ${pulse.kind === 'created' ? 'created' : 'updated'}`}
            style={{ left: pulse.x, top: pulse.y }}
          >
            <span className="vis-network-live-ring outer" />
            <span className="vis-network-live-ring inner" />
            <span className="vis-network-live-crosshair" />
            <span className="vis-network-live-copy">
              <small>{pulse.kind === 'created' ? 'MCP CREATE' : 'MCP UPDATE'}</small>
              <strong>{pulse.title}</strong>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});
