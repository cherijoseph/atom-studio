import * as THREE from 'three';

const MIN_SIZE = .1;
const MAX_SIZE = 100;
const POSITION_LIMIT = 100;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteVector = value => value && ['x', 'y', 'z'].every(axis => Number.isFinite(value[axis]));

function imagePose(image) {
  if (!image || !['width', 'height'].every(key => Number.isFinite(image[key]) && image[key] >= MIN_SIZE && image[key] <= MAX_SIZE)
    || !finiteVector(image) || ['x', 'y', 'z'].some(axis => Math.abs(image[axis]) > POSITION_LIMIT)
    || !Array.isArray(image.rotation) || image.rotation.length !== 3 || !image.rotation.every(Number.isFinite)) return null;
  const angles = image.rotation.map(THREE.MathUtils.degToRad);
  if (!angles.every(Number.isFinite)) return null;
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...angles, 'XYZ'));
  return { width: image.width, height: image.height, center: new THREE.Vector3(image.x, image.y, image.z), rotation };
}

/** The world-space plane used for both pointer hit testing and resize dragging. */
export function imageResizePlane(image) {
  const pose = imagePose(image);
  if (!pose) return null;
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(pose.rotation);
  return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, pose.center);
}

/**
 * Resize from the initial pointer position so a grab near a handle never jumps.
 * Corner handles keep the opposite corner fixed; edge handles keep the opposite
 * edge midpoint fixed. All inputs and initial transforms remain untouched.
 */
export function createImageResize(image, handle, startPoint) {
  const pose = imagePose(image);
  if (!pose || !finiteVector(startPoint) || !handle || ![-1, 0, 1].includes(handle.x) || ![-1, 0, 1].includes(handle.y) || (!handle.x && !handle.y)) return null;
  const { width, height, center, rotation } = pose;
  const horizontal = handle.x, vertical = handle.y;
  const start = new THREE.Vector3(startPoint.x, startPoint.y, startPoint.z);
  const inverseRotation = rotation.clone().invert();
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center);

  function resize(worldPoint, { lockAspect = false } = {}) {
    if (!finiteVector(worldPoint)) return null;
    const delta = new THREE.Vector3(worldPoint.x, worldPoint.y, worldPoint.z).sub(start).applyQuaternion(inverseRotation);
    if (!finiteVector(delta)) return null;
    const wantedWidth = width + horizontal * delta.x;
    const wantedHeight = height + vertical * delta.y;
    if (!Number.isFinite(wantedWidth) || !Number.isFinite(wantedHeight)) return null;
    let nextWidth = width, nextHeight = height;
    if (lockAspect) {
      const diagonal = Math.hypot(width, height);
      const wantedScale = horizontal && vertical
        ? (wantedWidth * (width / diagonal) + wantedHeight * (height / diagonal)) / diagonal
        : horizontal ? wantedWidth / width : wantedHeight / height;
      const scale = clamp(wantedScale, Math.max(MIN_SIZE / width, MIN_SIZE / height), Math.min(MAX_SIZE / width, MAX_SIZE / height));
      nextWidth = width * scale;
      nextHeight = height * scale;
    } else {
      if (horizontal) nextWidth = clamp(wantedWidth, MIN_SIZE, MAX_SIZE);
      if (vertical) nextHeight = clamp(wantedHeight, MIN_SIZE, MAX_SIZE);
    }

    // A single interpolation factor preserves the fixed anchor and aspect ratio
    // when the rotated plane's center encounters a workspace position boundary.
    const offset = new THREE.Vector3(horizontal * (nextWidth - width) / 2, vertical * (nextHeight - height) / 2, 0).applyQuaternion(rotation);
    let fraction = 1;
    for (const axis of ['x', 'y', 'z']) {
      // A quarter turn can leave a tiny residual on a mathematically stationary
      // axis. It must not freeze a drag when that center already sits at a limit.
      if (Math.abs(offset[axis]) < 1e-10) continue;
      if (offset[axis] > 0) fraction = Math.min(fraction, (POSITION_LIMIT - center[axis]) / offset[axis]);
      else if (offset[axis] < 0) fraction = Math.min(fraction, (-POSITION_LIMIT - center[axis]) / offset[axis]);
    }
    fraction = clamp(fraction, 0, 1);
    const resultCenter = center.clone().addScaledVector(offset, fraction);
    return {
      width: clamp(width + (nextWidth - width) * fraction, MIN_SIZE, MAX_SIZE),
      height: clamp(height + (nextHeight - height) * fraction, MIN_SIZE, MAX_SIZE),
      x: clamp(resultCenter.x, -POSITION_LIMIT, POSITION_LIMIT),
      y: clamp(resultCenter.y, -POSITION_LIMIT, POSITION_LIMIT),
      z: clamp(resultCenter.z, -POSITION_LIMIT, POSITION_LIMIT)
    };
  }

  return { plane, resize };
}
