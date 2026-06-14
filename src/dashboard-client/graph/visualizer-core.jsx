import React, {
  createContext,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import { clamp } from './shared.js';
import { getGraphThemeTokens } from './theme.js';

const GraphThemeContext = createContext(getGraphThemeTokens('light'));

export function GraphThemeProvider({ resolvedTheme, children }) {
  return (
    <GraphThemeContext.Provider value={getGraphThemeTokens(resolvedTheme)}>
      {children}
    </GraphThemeContext.Provider>
  );
}

export function useGraphTheme() {
  return useContext(GraphThemeContext);
}

export function useGraphViewport(ref, laidOut, options = {}) {
  const {
    minScale = 0.42,
    maxScale = 3.4,
    buttonZoomFactor = 1.18,
    wheelZoomFactor = 1.12,
  } = options;
  const [viewport, setViewport] = useState({ scale: 1, x: 0, y: 0 });
  const dragRef = useRef({
    dragging: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });
  const layoutSignature = `${laidOut.nodes.map((node) => `${node.slug}:${Math.round(node.x)}:${Math.round(node.y)}`).join('|')}::${laidOut.edges.length}::${laidOut.width}x${laidOut.height}`;

  useEffect(() => {
    setViewport({ scale: 1, x: 0, y: 0 });
  }, [layoutSignature]);

  function zoomAround(anchorX, anchorY, factor) {
    setViewport((current) => {
      const nextScale = clamp(current.scale * factor, minScale, maxScale);
      const appliedFactor = nextScale / current.scale;
      if (appliedFactor === 1) return current;
      return {
        scale: nextScale,
        x: anchorX - (anchorX - current.x) * appliedFactor,
        y: anchorY - (anchorY - current.y) * appliedFactor,
      };
    });
  }

  function zoomCentered(factor) {
    zoomAround(laidOut.width / 2, laidOut.height / 2, factor);
  }

  useImperativeHandle(ref, () => ({
    zoomIn() {
      zoomCentered(buttonZoomFactor);
    },
    zoomOut() {
      zoomCentered(1 / buttonZoomFactor);
    },
    resetView() {
      setViewport({ scale: 1, x: 0, y: 0 });
    },
  }), [buttonZoomFactor, laidOut.height, laidOut.width]);

  function onWheel(event) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const cursorX = ((event.clientX - rect.left) / rect.width) * laidOut.width;
    const cursorY = ((event.clientY - rect.top) / rect.height) * laidOut.height;
    const factor = event.deltaY < 0 ? wheelZoomFactor : 1 / wheelZoomFactor;
    zoomAround(cursorX, cursorY, factor);
  }

  function onPointerDown(event) {
    const next = dragRef.current;
    next.dragging = true;
    next.startX = event.clientX;
    next.startY = event.clientY;
    next.originX = viewport.x;
    next.originY = viewport.y;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    const drag = dragRef.current;
    if (!drag.dragging) return;
    setViewport((current) => ({
      ...current,
      x: drag.originX + ((event.clientX - drag.startX) / event.currentTarget.clientWidth) * laidOut.width,
      y: drag.originY + ((event.clientY - drag.startY) / event.currentTarget.clientHeight) * laidOut.height,
    }));
  }

  function stopDragging(event) {
    const drag = dragRef.current;
    drag.dragging = false;
    if (event?.pointerId !== undefined && event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return {
    viewport,
    bind: {
      onWheel,
      onPointerDown,
      onPointerMove,
      onPointerUp: stopDragging,
      onPointerLeave: stopDragging,
      onPointerCancel: stopDragging,
    },
  };
}

export function GraphTypeDefs({ idPrefix }) {
  return (
    <>
      {['people', 'companies', 'projects', 'meetings', 'deals', 'personal-protocol', 'concepts', 'writing', 'inbox', 'unknown'].map((type) => (
        <React.Fragment key={type}>
          <radialGradient id={`${idPrefix}-node-gradient-${type}`} cx="38%" cy="35%" r="72%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.96" />
            <stop offset="45%" stopColor="#d4d4d8" stopOpacity="0.84" />
            <stop offset="100%" stopColor="#71717a" stopOpacity="0.36" />
          </radialGradient>
          <filter id={`${idPrefix}-node-glow-${type}`} x="-200%" y="-200%" width="400%" height="400%">
            <feGaussianBlur stdDeviation="4" result="blur" />
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
    </>
  );
}

export function GraphBackdropDefs({ idPrefix, theme }) {
  return (
    <>
      <linearGradient id={`${idPrefix}-surface-gradient`} x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor={theme.graphInset} />
        <stop offset="55%" stopColor={theme.graphBase} />
        <stop offset="100%" stopColor={theme.panelBg} />
      </linearGradient>
      <pattern id={`${idPrefix}-grid-pattern`} width="36" height="36" patternUnits="userSpaceOnUse">
        <path d="M 36 0 L 0 0 0 36" fill="none" stroke={theme.graphGrid} strokeWidth="1" />
      </pattern>
      <pattern id={`${idPrefix}-scanline-pattern`} width="8" height="8" patternUnits="userSpaceOnUse">
        <rect width="8" height="4" fill="transparent" />
        <rect width="8" height="1" y="4" fill={theme.graphGrid} opacity="0.28" />
      </pattern>
      <filter id={`${idPrefix}-soft-shadow`} x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="12" stdDeviation="18" floodColor={theme.graphShadow} floodOpacity="0.7" />
      </filter>
    </>
  );
}

export function GraphNodeLabel({ node, theme, visible }) {
  if (!visible) return null;
  return (
    <text
      x={node.x + node.radius + 7}
      y={node.y + 3}
      fontSize="10.5"
      fill={theme.graphMutedLabel}
      letterSpacing="0.02em"
    >
      {node.title.slice(0, 30)}
    </text>
  );
}

export function GraphFixedLabels({ nodes, viewport, labeled, theme }) {
  return (
    <g className="graph-fixed-labels" pointerEvents="none">
      {nodes.map((node) => {
        if (!labeled.has(node.slug)) return null;
        const x = viewport.x + node.x * viewport.scale + node.radius * viewport.scale + 10;
        const y = viewport.y + node.y * viewport.scale + 3;
        return (
          <text
            key={node.slug}
            x={x}
            y={y}
            fontSize="11"
            fill={theme.graphMutedLabel}
            letterSpacing="0.02em"
          >
            {node.title.slice(0, 28)}
          </text>
        );
      })}
    </g>
  );
}
