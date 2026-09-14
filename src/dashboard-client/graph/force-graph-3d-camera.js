import { Vector3 } from 'three';

export function getForceGraphNodeWorldPosition(forceGraph, node) {
  if (!node || ![node.x, node.y, node.z].every(Number.isFinite)) return null;
  const point = new Vector3(node.x, node.y, node.z);
  // Simulation coordinates belong to the graph's parent space. Auto-rotation
  // transforms that space, while camera targets and screen projection use world coordinates.
  const parent = node.__threeObj?.parent || forceGraph?.scene?.();
  parent?.localToWorld(point);
  return point;
}

export function getForceGraphNodeFocusCamera(forceGraph, node) {
  const target = getForceGraphNodeWorldPosition(forceGraph, node);
  if (!target) return null;
  const current = forceGraph.camera?.()?.position;
  const direction = new Vector3(current?.x || 0, current?.y || 0, current?.z || 0).sub(target);
  const currentDistance = direction.length();
  const distance = Math.min(Math.max(currentDistance || 90, 42), 150);
  if (currentDistance) direction.multiplyScalar(distance / currentDistance);
  else direction.set(0, 0, distance);
  return { position: target.clone().add(direction), target };
}
