import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';

import { TYPE_COLORS } from './colors.js';

export const CustomConstellationVisualizer = forwardRef(function CustomConstellationVisualizer({ graph, onNodeOpen }, ref) {
  const [viewport, setViewport] = useState({ scale: 1, x: 0, y: 0 });
  const dragRef = useRef({
    dragging: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });

  const laidOut = useMemo(() => buildSvgLayout(graph), [graph]);

  useImperativeHandle(ref, () => ({
    zoomIn() {
      zoomViewport(setViewport, 1.18, laidOut);
    },
    zoomOut() {
      zoomViewport(setViewport, 1 / 1.18, laidOut);
    },
    resetView() {
      setViewport({ scale: 1, x: 0, y: 0 });
    },
  }), [laidOut]);

  const onWheel = (event) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    setViewport((current) => {
      const nextScale = clamp(current.scale * factor, 0.45, 3.2);
      const appliedFactor = nextScale / current.scale;
      if (appliedFactor === 1) return current;
      return {
        scale: nextScale,
        x: cursorX - (cursorX - current.x) * appliedFactor,
        y: cursorY - (cursorY - current.y) * appliedFactor,
      };
    });
  };

  const onPointerDown = (event) => {
    const next = dragRef.current;
    next.dragging = true;
    next.startX = event.clientX;
    next.startY = event.clientY;
    next.originX = viewport.x;
    next.originY = viewport.y;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag.dragging) return;
    setViewport((current) => ({
      ...current,
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    }));
  };

  const stopDragging = (event) => {
    const drag = dragRef.current;
    drag.dragging = false;
    if (event?.pointerId !== undefined && event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div className="graph-canvas-shell">
      <svg
        className="graph-svg"
        viewBox={`0 0 ${laidOut.width} ${laidOut.height}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stopDragging}
        onPointerLeave={stopDragging}
        onPointerCancel={stopDragging}
      >
        <defs>
          {Object.entries(TYPE_COLORS).map(([type, color]) => (
            <React.Fragment key={type}>
              <radialGradient id={`node-gradient-${type}`} cx="38%" cy="35%" r="72%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.96" />
                <stop offset="28%" stopColor={color} stopOpacity="0.92" />
                <stop offset="100%" stopColor={color} stopOpacity="0.32" />
              </radialGradient>
              <filter id={`node-glow-${type}`} x="-140%" y="-140%" width="280%" height="280%">
                <feGaussianBlur stdDeviation="7" result="blur" />
                <feColorMatrix
                  in="blur"
                  type="matrix"
                  values="1 0 0 0 0
                          0 1 0 0 0
                          0 0 1 0 0
                          0 0 0 0.95 0"
                />
              </filter>
            </React.Fragment>
          ))}
        </defs>
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
          {laidOut.edges.map((edge) => (
            <line
              key={`${edge.source.slug}:${edge.target.slug}`}
              x1={edge.source.x}
              y1={edge.source.y}
              x2={edge.target.x}
              y2={edge.target.y}
              stroke="rgba(31,26,23,0.11)"
              strokeWidth="1"
            />
          ))}
          {laidOut.nodes.map((node) => {
            const radius = Math.max(5, Math.min(16, 4 + Math.sqrt(node.degree || 1)));
            return (
              <g
                key={node.slug}
                onClick={(event) => {
                  event.stopPropagation();
                  onNodeOpen?.(node.slug);
                }}
                style={{ cursor: 'pointer' }}
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={radius * 1.65}
                  fill={TYPE_COLORS[node.type] || '#d7dff7'}
                  fillOpacity="0.28"
                  filter={`url(#node-glow-${node.type})`}
                />
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={radius}
                  fill={`url(#node-gradient-${node.type})`}
                  stroke="rgba(255,255,255,0.92)"
                  strokeWidth="1"
                  fillOpacity="0.98"
                />
                {radius > 9 ? (
                  <text x={node.x + radius + 6} y={node.y + 4} fontSize="10" fill="#314158">
                    {node.title.slice(0, 28)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
});

function buildSvgLayout(graph) {
  const width = 960;
  const height = 520;
  const nodes = graph.nodes.map((node, index) => ({
    ...node,
    x: width / 2 + Math.cos((index / Math.max(graph.nodes.length, 1)) * Math.PI * 2) * (width * 0.28),
    y: height / 2 + Math.sin((index / Math.max(graph.nodes.length, 1)) * Math.PI * 2) * (height * 0.28),
    vx: 0,
    vy: 0,
  }));
  const nodeMap = new Map(nodes.map((node) => [node.slug, node]));
  const edges = graph.edges
    .map((edge) => ({
      source: nodeMap.get(edge.source),
      target: nodeMap.get(edge.target),
    }))
    .filter((edge) => edge.source && edge.target);

  for (let step = 0; step < 180; step += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist2 = dx * dx + dy * dy + 0.01;
        const force = 2800 / dist2;
        a.vx -= dx * force * 0.0006;
        a.vy -= dy * force * 0.0006;
        b.vx += dx * force * 0.0006;
        b.vy += dy * force * 0.0006;
      }
    }

    for (const edge of edges) {
      const dx = edge.target.x - edge.source.x;
      const dy = edge.target.y - edge.source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const targetDist = 90;
      const force = (dist - targetDist) * 0.0025;
      edge.source.vx += (dx / dist) * force;
      edge.source.vy += (dy / dist) * force;
      edge.target.vx -= (dx / dist) * force;
      edge.target.vy -= (dy / dist) * force;
    }

    for (const node of nodes) {
      node.vx += ((width / 2) - node.x) * 0.0008;
      node.vy += ((height / 2) - node.y) * 0.0008;
      node.x += node.vx;
      node.y += node.vy;
      node.vx *= 0.86;
      node.vy *= 0.86;
      node.x = clamp(node.x, 30, width - 30);
      node.y = clamp(node.y, 30, height - 30);
    }
  }

  return { width, height, nodes, edges };
}

function zoomViewport(setViewport, factor, laidOut) {
  setViewport((current) => {
    const nextScale = clamp(current.scale * factor, 0.45, 3.2);
    const appliedFactor = nextScale / current.scale;
    const centerX = laidOut.width / 2;
    const centerY = laidOut.height / 2;
    return {
      scale: nextScale,
      x: centerX - (centerX - current.x) * appliedFactor,
      y: centerY - (centerY - current.y) * appliedFactor,
    };
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
