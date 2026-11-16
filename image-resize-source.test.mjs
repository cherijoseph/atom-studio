import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createImageResize, imageResizePlane } from './image-resize-source.js';

const image = extra => ({ width: 4, height: 2, x: 1, y: 2, z: 3, rotation: [0, 0, 0], ...extra });
const near = (actual, expected, epsilon = 1e-9) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} differs from ${expected}`);
const nearVector = (actual, expected) => ['x', 'y', 'z'].forEach(axis => near(actual[axis], expected[axis]));
const rotation = value => new THREE.Quaternion().setFromEuler(new THREE.Euler(...value.rotation.map(THREE.MathUtils.degToRad), 'XYZ'));
const world = (value, x, y) => new THREE.Vector3(x, y, 0).applyQuaternion(rotation(value)).add(new THREE.Vector3(value.x, value.y, value.z));
const opposite = (value, handle) => world(value, -handle.x * value.width / 2, -handle.y * value.height / 2);
const changed = (initial, transform) => ({ ...initial, ...transform });

test('corner resize uses an immutable initial pose and keeps the opposite world corner fixed for every rotation', () => {
  for (const angles of [[0, 0, 0], [90, 0, 0], [0, 90, 0], [35, -67, 123]]) {
    for (const handle of [{ x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }]) {
      const initial = image({ rotation: angles }), before = structuredClone(initial);
      const start = world(initial, handle.x * 2, handle.y), session = createImageResize(initial, handle, start);
      const transform = session.resize(world(initial, handle.x * 4, handle.y * 2));
      near(transform.width, 6); near(transform.height, 3);
      nearVector(opposite(changed(initial, transform), handle), opposite(initial, handle));
      assert.deepEqual(initial, before);
      // Repeated samples use the original pose, with no cumulative rounding.
      assert.deepEqual(session.resize(world(initial, handle.x * 4, handle.y * 2)), transform);
    }
  }
});

test('edge handles preserve the opposite midpoint and keep the unused dimension centered', () => {
  const initial = image({ rotation: [30, 40, 70] });
  for (const handle of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
    const start = world(initial, handle.x * 2, handle.y), session = createImageResize(initial, handle, start);
    const transform = session.resize(world(initial, handle.x * 3 + (handle.x ? 0 : 17), handle.y * 2 + (handle.y ? 0 : 19)));
    near(transform.width, handle.x ? 5 : 4); near(transform.height, handle.y ? 3 : 2);
    nearVector(opposite(changed(initial, transform), handle), opposite(initial, handle));
  }
});

test('a grab offset from the visual handle causes no jump and ignores plane-normal movement', () => {
  const initial = image({ rotation: [-34, 81, 17] }), start = world(initial, 2.17, 1.11);
  const session = createImageResize(initial, { x: 1, y: 1 }, start);
  assert.deepEqual(session.resize(start), { width: 4, height: 2, x: 1, y: 2, z: 3 });
  start.set(900, 900, 900); // The session owns a copy of the pointer.
  initial.width = 99; initial.x = 40; initial.rotation[0] = 100;
  const before = image({ rotation: [-34, 81, 17] });
  const pointer = world(before, 2.17, 1.11).add(new THREE.Vector3(0, 0, 3).applyQuaternion(rotation(before)));
  const transform = session.resize(pointer);
  near(transform.width, 4); near(transform.height, 2); nearVector(transform, before);
});

test('aspect lock projects corner movement onto the original aspect diagonal and toggles without accumulated drift', () => {
  const initial = image(), handle = { x: 1, y: 1 }, session = createImageResize(initial, handle, world(initial, 2, 1));
  const pointer = world(initial, 4, 1), locked = session.resize(pointer, { lockAspect: true });
  // Desired size (6,2) projects onto (4,2) at scale 1.4.
  near(locked.width, 5.6); near(locked.height, 2.8);
  nearVector(opposite(changed(initial, locked), handle), opposite(initial, handle));
  const unlocked = session.resize(pointer, { lockAspect: false });
  near(unlocked.width, 6); near(unlocked.height, 2);
  assert.deepEqual(session.resize(pointer, { lockAspect: true }), locked);
});

test('locked edges take scale from their active dimension while the other dimension stays centered', () => {
  const initial = image({ rotation: [21, 49, -67] });
  for (const handle of [{ x: -1, y: 0 }, { x: 0, y: 1 }]) {
    const session = createImageResize(initial, handle, world(initial, handle.x * 2, handle.y));
    const transform = session.resize(world(initial, handle.x * 6, handle.y * 3), { lockAspect: true });
    near(transform.width, 8); near(transform.height, 4);
    nearVector(opposite(changed(initial, transform), handle), opposite(initial, handle));
  }
});

test('crossing an opposite edge never flips and all resize paths stay within dimension limits', () => {
  const initial = image(), handle = { x: 1, y: 1 }, session = createImageResize(initial, handle, world(initial, 2, 1));
  for (const lockAspect of [false, true]) {
    const tiny = session.resize(world(initial, -20, -20), { lockAspect });
    near(tiny.height, .1); near(tiny.width, lockAspect ? .2 : .1);
    const huge = session.resize(world(initial, 1000, 1000), { lockAspect });
    near(huge.width, 100); near(huge.height, lockAspect ? 50 : 100);
    nearVector(opposite(changed(initial, tiny), handle), opposite(initial, handle));
    nearVector(opposite(changed(initial, huge), handle), opposite(initial, handle));
  }
  const slender = image({ width: .1, height: 100 });
  const locked = createImageResize(slender, handle, world(slender, .05, 50));
  near(locked.resize(world(slender, -90, -90), { lockAspect: true }).height, 100);
});

test('workspace bounds clamp a rotated resize as one segment, preserving anchor and locked aspect', () => {
  for (const axis of ['x', 'y', 'z']) {
    const angles = axis === 'x' ? [0, 0, 0] : axis === 'y' ? [0, 0, 90] : [0, -90, 0];
    const initial = image({ x: 0, y: 0, z: 0, [axis]: 99, rotation: angles }), handle = { x: 1, y: 1 };
    const session = createImageResize(initial, handle, world(initial, 2, 1));
    const transform = session.resize(world(initial, 80, 40), { lockAspect: true });
    near(transform[axis], 100); near(transform.width, 6); near(transform.height, 3);
    nearVector(opposite(changed(initial, transform), handle), opposite(initial, handle));
    assert.ok(['x', 'y', 'z'].every(key => transform[key] >= -100 && transform[key] <= 100));
  }
  const initial = image({ x: -99 }), handle = { x: -1, y: 0 };
  const transform = createImageResize(initial, handle, world(initial, -2, 0)).resize(world(initial, -50, 0));
  near(transform.x, -100); near(transform.width, 6);
  nearVector(opposite(changed(initial, transform), handle), opposite(initial, handle));
});

test('an outward resize at an existing position boundary stays finite and unchanged', () => {
  const initial = image({ x: 100 }), handle = { x: 1, y: 1 };
  const transform = createImageResize(initial, handle, world(initial, 2, 1)).resize(world(initial, 4, 3));
  assert.deepEqual(transform, { width: 4, height: 2, x: 100, y: 2, z: 3 });
});

test('quarter-turn residuals at a position boundary do not block tangential edge resizing', () => {
  for (const x of [-100, 100]) {
    const initial = image({ x, rotation: [0, 0, 90] }), handle = { x: 1, y: 0 };
    const transform = createImageResize(initial, handle, world(initial, 2, 0)).resize(world(initial, 4, 0));
    near(transform.width, 6); near(transform.height, 2);
    near(transform.x, x); near(transform.y, 3); near(transform.z, 3);
    nearVector(opposite(changed(initial, transform), handle), opposite(initial, handle));
  }
});

test('perspective and orthographic camera rays hit the same rotated resize plane', () => {
  const initial = image({ rotation: [20, 33, -15] }), handle = { x: 1, y: 1 };
  const target = world(initial, 4, 2), session = createImageResize(initial, handle, world(initial, 2, 1));
  const cameras = [new THREE.PerspectiveCamera(45, 1.5, .1, 1000), new THREE.OrthographicCamera(-12, 12, 8, -8, .1, 1000)];
  for (const camera of cameras) {
    camera.position.set(15, 17, 29); camera.lookAt(initial.x, initial.y, initial.z); camera.updateMatrixWorld();
    const projected = target.clone().project(camera), raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera);
    const hit = raycaster.ray.intersectPlane(session.plane, new THREE.Vector3());
    nearVector(hit, target);
    const transform = session.resize(hit);
    near(transform.width, 6); near(transform.height, 3);
  }
});

test('invalid transforms, handles and pointer values reject without producing NaNs', () => {
  const initial = image(), start = new THREE.Vector3(3, 3, 3), handle = { x: 1, y: 1 };
  for (const value of [null, {}, image({ width: 0 }), image({ height: 101 }), image({ x: 101 }), image({ rotation: [0, NaN, 0] }), image({ rotation: [0, 0] })]) {
    assert.equal(createImageResize(value, handle, start), null);
    assert.equal(imageResizePlane(value), null);
  }
  for (const value of [null, {}, { x: 0, y: 0 }, { x: 2, y: 1 }, { x: NaN, y: 1 }]) assert.equal(createImageResize(initial, value, start), null);
  for (const point of [null, {}, { x: Infinity, y: 0, z: 0 }, { x: NaN, y: 0, z: 0 }]) {
    assert.equal(createImageResize(initial, handle, point), null);
    assert.equal(createImageResize(initial, handle, start).resize(point), null);
  }
  const plane = imageResizePlane(initial);
  near(plane.distanceToPoint(new THREE.Vector3(1, 2, 3)), 0);
  nearVector(plane.normal, new THREE.Vector3(0, 0, 1));
  // A finite extreme pointer must not turn a projection's opposing products
  // into Infinity - Infinity and leak NaNs into the scene.
  const extremeImage = image({ width: 100, height: 100 });
  const extreme = createImageResize(extremeImage, handle, start).resize(new THREE.Vector3(1e308, -1e308, 3), { lockAspect: true });
  assert.ok(extreme === null || Object.values(extreme).every(Number.isFinite));
});
