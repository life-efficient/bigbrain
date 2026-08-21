import React, { forwardRef, useEffect, useEffectEvent, useImperativeHandle, useRef } from 'react';
import { DataSet, Network } from 'vis-network/standalone';

import { buildVisNetworkNodes, getVisNetworkLabelSlugs } from './vis-network-data.js';
import { PRESET_GRAPH_LABEL_FONT_SIZE, useGraphTheme } from './visualizer-core.jsx';

export const VisNetworkVisualizer = forwardRef(function VisNetworkVisualizer({
  graph,
  onNodeOpen,
  activeSlug,
  onActiveSlugChange,
  colorMode = 'updated',
  labelStyle = 'selected',
}, ref) {
  const theme = useGraphTheme();
  const canvasRef = useRef(null);
  const networkRef = useRef(null);
  const nodeDataRef = useRef(null);
  const nodeTitlesRef = useRef(new Map());
  const baseLabelSlugsRef = useRef(new Set());
  const previousActiveSlugRef = useRef(null);
  const activeSlugRef = useRef(activeSlug);
  activeSlugRef.current = activeSlug;
  const handleNodeOpen = useEffectEvent((nodeId) => {
    onNodeOpen?.(nodeId);
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

    const nodes = new DataSet(buildVisNetworkNodes(graph.nodes, {
      colorMode,
      labelStyle,
      theme,
    }));
    nodeDataRef.current = nodes;
    nodeTitlesRef.current = new Map(graph.nodes.map((node) => [node.slug, node.title]));
    baseLabelSlugsRef.current = getVisNetworkLabelSlugs(graph.nodes, labelStyle);

    const network = new Network(
      canvasRef.current,
      {
        nodes,
        edges: graph.edges.map((edge) => ({
          from: edge.source,
          to: edge.target,
        })),
      },
      {
        autoResize: true,
        interaction: {
          hover: true,
          tooltipDelay: 120,
          navigationButtons: false,
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

    network.once('stabilizationIterationsDone', () => {
      network.setOptions({ physics: false });
      network.fit({
        animation: {
          duration: 250,
          easingFunction: 'easeInOutQuad',
        },
      });
    });

    network.on('click', (event) => {
      const nodeId = event.nodes?.[0];
      if (!nodeId) return;
      onActiveSlugChange?.(nodeId);
      handleNodeOpen(nodeId);
    });
    network.on('hoverNode', ({ node: nodeId }) => {
      const title = nodeTitlesRef.current.get(nodeId);
      if (title) nodes.update({ id: nodeId, label: title });
    });
    network.on('blurNode', ({ node: nodeId }) => {
      const shouldKeepLabel = nodeId === activeSlugRef.current || baseLabelSlugsRef.current.has(nodeId);
      nodes.update({ id: nodeId, label: shouldKeepLabel ? nodeTitlesRef.current.get(nodeId) : '' });
    });

    networkRef.current = network;
    const currentActiveSlug = activeSlugRef.current;
    if (currentActiveSlug && nodeTitlesRef.current.has(currentActiveSlug)) {
      nodes.update({ id: currentActiveSlug, label: nodeTitlesRef.current.get(currentActiveSlug) });
      network.selectNodes([currentActiveSlug]);
    }
    previousActiveSlugRef.current = currentActiveSlug || null;
    return () => {
      network.destroy();
      networkRef.current = null;
      nodeDataRef.current = null;
    };
  }, [colorMode, graph, handleNodeOpen, labelStyle, onActiveSlugChange, theme.graphEdge, theme.graphEdgeStrong, theme.graphHalo, theme.graphLabel, theme.graphNodeStroke]);

  useEffect(() => {
    const network = networkRef.current;
    if (!network) return;
    const nodeData = nodeDataRef.current;
    const previousActiveSlug = previousActiveSlugRef.current;
    const updates = [];
    if (previousActiveSlug && nodeTitlesRef.current.has(previousActiveSlug)) {
      updates.push({
        id: previousActiveSlug,
        label: baseLabelSlugsRef.current.has(previousActiveSlug)
          ? nodeTitlesRef.current.get(previousActiveSlug)
          : '',
      });
    }
    if (activeSlug) {
      if (nodeTitlesRef.current.has(activeSlug)) {
        updates.push({ id: activeSlug, label: nodeTitlesRef.current.get(activeSlug) });
      }
      network.selectNodes([activeSlug]);
    } else {
      network.unselectAll();
    }
    if (updates.length) nodeData?.update(updates);
    previousActiveSlugRef.current = activeSlug || null;
  }, [activeSlug]);

  return (
    <div className="graph-canvas-shell force-shell">
      <div
        ref={canvasRef}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
});
