import React, { forwardRef, useEffect, useEffectEvent, useImperativeHandle, useRef } from 'react';
import { Network } from 'vis-network/standalone';

import { TYPE_COLORS, getGraphNodeColor } from './colors.js';
import { useGraphTheme } from './visualizer-core.jsx';

export const VisNetworkVisualizer = forwardRef(function VisNetworkVisualizer({ graph, onNodeOpen, activeSlug, onActiveSlugChange, colorMode = 'updated' }, ref) {
  const theme = useGraphTheme();
  const canvasRef = useRef(null);
  const networkRef = useRef(null);
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

    const network = new Network(
      canvasRef.current,
      {
        nodes: graph.nodes.map((node) => ({
          id: node.slug,
          label: node.title,
          title: `${node.title} (${node.type})`,
          group: node.type,
          value: Math.max(8, node.degree || 1),
          color: resolveNodeNetworkColor(node, colorMode, theme),
        })),
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
            size: 12,
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
        groups: Object.fromEntries(Object.entries(TYPE_COLORS).map(([type, color]) => [type, {
          color: {
            background: color,
            border: theme.graphNodeStroke,
            highlight: {
              background: color,
              border: theme.graphNodeStroke,
            },
            hover: {
              background: color,
              border: theme.graphNodeStroke,
            },
          },
        }])),
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

    networkRef.current = network;
    return () => {
      network.destroy();
      networkRef.current = null;
    };
  }, [colorMode, graph, handleNodeOpen, onActiveSlugChange, theme.graphEdge, theme.graphEdgeStrong, theme.graphHalo, theme.graphLabel, theme.graphNodeStroke]);

  useEffect(() => {
    const network = networkRef.current;
    if (!network) return;
    if (activeSlug) {
      network.selectNodes([activeSlug]);
    } else {
      network.unselectAll();
    }
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

function resolveNodeNetworkColor(node, colorMode, theme) {
  const color = getGraphNodeColor(node, colorMode);
  return {
    background: color,
    border: theme.graphNodeStroke,
    highlight: {
      background: color,
      border: theme.graphNodeStroke,
    },
    hover: {
      background: color,
      border: theme.graphNodeStroke,
    },
  };
}
