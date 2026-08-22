export const GRAPH_NODE_SIZES = [
  { id: 'small', label: 'Small', scale: 1 },
  { id: 'medium', label: 'Medium', scale: 2 },
  { id: 'large', label: 'Large', scale: 3 },
];

const NODE_SIZE_SCALE_BY_ID = new Map(
  GRAPH_NODE_SIZES.map((size) => [size.id, size.scale]),
);

export function getGraphNodeSizeScale(nodeSize = 'medium') {
  return NODE_SIZE_SCALE_BY_ID.get(nodeSize) || NODE_SIZE_SCALE_BY_ID.get('medium');
}

export function getGraphNodeZoomMultiplier(viewportScale, {
  minScale = 0.42,
  maxScale = 3.4,
} = {}) {
  const scale = clamp(Number(viewportScale) || 1, minScale, maxScale);
  if (scale < 1 && minScale < 1) {
    const progress = Math.log(scale / minScale) / Math.log(1 / minScale);
    return 0.5 + 0.5 * smoothstep(progress);
  }
  if (scale > 1 && maxScale > 1) {
    const progress = Math.log(scale) / Math.log(maxScale);
    return 1 + 0.5 * smoothstep(progress);
  }
  return 1;
}

export function getGraphNodeScreenScale(nodeSizeScale, viewportScale, bounds) {
  return nodeSizeScale * getGraphNodeZoomMultiplier(viewportScale, bounds);
}

export function getGraphNodeTransformScale(nodeSizeScale, viewportScale, bounds) {
  return getGraphNodeScreenScale(nodeSizeScale, viewportScale, bounds) / viewportScale;
}

function smoothstep(value) {
  const progress = clamp(value, 0, 1);
  return progress * progress * (3 - 2 * progress);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
