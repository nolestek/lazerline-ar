import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floorHit, lineOffset, isOnLine, angleBetween } from '../src/geometry.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const line = { cx: 0, cz: 0, angle: 0, length: 3, width: 0.1 };

test('straight down hits directly below', () => {
  const h = floorHit({ x: 1, y: 1, z: 2 }, { x: 0, y: -1, z: 0 });
  close(h.x, 1); close(h.z, 2);
});
test('45 degrees down lands one height away', () => {
  const h = floorHit({ x: 0, y: 1, z: 0 }, { x: 1, y: -1, z: 0 });
  close(h.x, 1); close(h.z, 0);
});
test('pointing up or horizontal: no hit', () => {
  assert.equal(floorHit({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }), null);
  assert.equal(floorHit({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }), null);
});
test('beyond maxDist: no hit', () => {
  assert.equal(floorHit({ x: 0, y: 1, z: 0 }, { x: 10, y: -1, z: 0 }), null);
  assert.ok(floorHit({ x: 0, y: 1, z: 0 }, { x: 3, y: -1, z: 0 }));
});
test('origin at or below floor: no hit', () => {
  assert.equal(floorHit({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }), null);
});
test('lineOffset on a rotated line', () => {
  const o = lineOffset({ x: 0, z: 1 }, { ...line, angle: Math.PI / 2 });
  close(o.along, 1); close(o.across, 0, 1e-9);
});
test('isOnLine respects width and ends', () => {
  assert.equal(isOnLine({ x: 1, z: 0.04 }, line), true);
  assert.equal(isOnLine({ x: 1, z: 0.06 }, line), false);
  assert.equal(isOnLine({ x: 1.6, z: 0 }, line), false);
});
test('angleBetween', () => {
  close(angleBetween({ x: 1, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }), Math.PI / 2);
  close(angleBetween({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }), 0);
});
