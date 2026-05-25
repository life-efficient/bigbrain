import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Network } from 'vis-network/standalone';

import { TYPE_COLORS } from './colors.js';

export const VisNetworkVisualizer = forwardRef(function VisNetworkVisualizer({ graph }, ref) {
  const shellRef = useRef(null);
  const canvasRef = useRef(null);
  const networkRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 520 });

  useImperativeHandle(ref, () => ({
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
    if (!shellRef.current) return undefined;
    const update = () => {
      const rect = shellRef.current.getBoundingClientRect();
      setDimensions({
        width: Math.max(320, Math.round(rect.width)),
        height: Math.max(320, Math.round(rect.height)),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(shellRef.current);
    return () => observer.disconnect();
  }, []);

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
            face: 'ui-sans-serif',
            color: '#314158',
            size: 12,
            strokeWidth: 0,
          },
          borderWidth: 1.5,
          borderWidthSelected: 2,
          shadow: {
            enabled: true,
            color: 'rgba(180, 198, 255, 0.35)',
            size: 20,
            x: 0,
            y: 0,
          },
        },
        edges: {
          color: {
            color: 'rgba(148,163,184,0.32)',
            highlight: 'rgba(148,163,184,0.54)',
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
            border: '#ffffff',
            highlight: {
              background: color,
              border: '#ffffff',
            },
            hover: {
              background: color,
              border: '#ffffff',
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

    networkRef.current = network;
    return () => {
      network.destroy();
      networkRef.current = null;
    };
  }, [graph]);

  useEffect(() => {
    networkRef.current?.redraw();
    networkRef.current?.fit({ animation: false });
  }, [dimensions]);

  return (
    <div ref={shellRef} className="graph-canvas-shell force-shell">
      <div
        ref={canvasRef}
        style={{ width: `${dimensions.width}px`, height: `${dimensions.height}px` }}
      />
    </div>
  );
});
