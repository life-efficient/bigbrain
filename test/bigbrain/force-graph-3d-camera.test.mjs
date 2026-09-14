import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Object3D, PerspectiveCamera, Scene, Vector3 } from 'three';
import {
  getForceGraphNodeFocusCamera,
  getForceGraphNodeWorldPosition,
} from '../../src/dashboard-client/graph/force-graph-3d-camera.js';

function fixture(rotation = 0) {
  const scene = new Scene();
  scene.rotation.z = rotation;
  const graph = new Group();
  scene.add(graph);
  const object = new Object3D();
  object.position.set(300, 80, -40);
  graph.add(object);
  const node = { x: 300, y: 80, z: -40, __threeObj: object };
  const camera = new PerspectiveCamera(60, 1.6, 0.1, 10000);
  camera.position.set(0, 0, 1200);
  return { scene, graph, object, node, camera, forceGraph: { scene: () => scene, camera: () => camera } };
}

test('focus and label coordinates match the rendered node after scene rotation', () => {
  for (const angle of [0, Math.PI / 6, Math.PI / 2, Math.PI, 5.8]) {
    const { object, node, camera, forceGraph } = fixture(angle);
    const rendered = object.getWorldPosition(new Vector3());
    const label = getForceGraphNodeWorldPosition(forceGraph, node);
    const { position, target } = getForceGraphNodeFocusCamera(forceGraph, node);
    assert.ok(target.distanceTo(rendered) < 1e-9);
    assert.ok(label.distanceTo(rendered) < 1e-9);
    assert.ok(Math.abs(position.distanceTo(target) - 150) < 1e-9);
    camera.position.copy(position);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const projected = rendered.clone().project(camera);
    assert.ok(Math.abs(projected.x) < 1e-9);
    assert.ok(Math.abs(projected.y) < 1e-9);
    assert.ok(projected.z > -1 && projected.z < 1);
  }
});

test('focus refreshes ancestor transforms and does not mutate simulation coordinates', () => {
  const { scene, graph, object, node, forceGraph } = fixture();
  scene.updateMatrixWorld();
  scene.rotation.z = Math.PI / 2;
  graph.position.set(15, 25, 35);
  const world = getForceGraphNodeWorldPosition(forceGraph, node);
  assert.ok(world.distanceTo(object.getWorldPosition(new Vector3())) < 1e-9);
  assert.deepEqual([node.x, node.y, node.z], [300, 80, -40]);
  assert.ok(world.distanceTo(new Vector3(-105, 315, -5)) < 1e-9);
});

test('focus handles nodes before renderer attachment and rejects unsettled coordinates', () => {
  const { scene, node, forceGraph } = fixture(Math.PI / 2);
  delete node.__threeObj;
  assert.ok(getForceGraphNodeWorldPosition(forceGraph, node)
    .distanceTo(scene.localToWorld(new Vector3(node.x, node.y, node.z))) < 1e-9);
  assert.equal(getForceGraphNodeFocusCamera(forceGraph, { x: NaN, y: 0, z: 0 }), null);
  assert.equal(getForceGraphNodeWorldPosition(forceGraph, null), null);
});

test('focus uses a finite camera offset when the camera is already at the node', () => {
  const { node, camera, forceGraph } = fixture(Math.PI / 2);
  camera.position.copy(getForceGraphNodeWorldPosition(forceGraph, node));
  const { position, target } = getForceGraphNodeFocusCamera(forceGraph, node);
  assert.equal(position.distanceTo(target), 90);
});
