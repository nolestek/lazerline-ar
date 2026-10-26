import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHoop, planeDistance, classifyHoop, nearHoop } from '../src/hoop.js';

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.hypot(a.x, a.y, a.z);
const add = (a, b, k = 1) => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const head = { x: 0, y: 0.02, z: 0 };
const axis = { x: 0, y: -Math.sin(Math.PI / 3), z: -0.5 }; // 60 deg from horizontal, toward -z
const right = { x: 1, y: 0, z: 0 };
const R = 1.75;
const hoop = buildHoop(head, axis, R, right);

test('the address shaft and the target line lie in the hoop plane', () => {
  close(dot(hoop.n, axis), 0);
  close(dot(hoop.n, hoop.t), 0);
  close(len(hoop.n), 1);
});

test('the hoop sits on the address clubhead', () => {
  const low = add(hoop.center, hoop.up, -R);
  close(low.x, head.x); close(low.y, head.y); close(low.z, head.z);
  assert.ok(hoop.center.y > head.y);
});

test('target direction is horizontal and square to the shaft', () => {
  close(hoop.t.y, 0, 1e-12);
  close(hoop.t.x * axis.x + hoop.t.z * axis.z, 0);
});

test('a vertical shaft falls back to the given right vector', () => {
  const h = buildHoop(head, { x: 0, y: -1, z: 0 }, R, { x: 1, y: 0.2, z: 0 });
  close(h.t.x, 1); close(h.t.y, 0); close(h.t.z, 0);
  for (const v of [h.n, h.t, h.up, h.center]) for (const k of ['x', 'y', 'z']) assert.ok(Number.isFinite(v[k]));
});

test('planeDistance measures off-plane distance only', () => {
  close(planeDistance(add(head, hoop.n, 0.04), hoop), 0.04);
  close(planeDistance(add(add(head, hoop.t, 1), hoop.up, 0.5), hoop), 0);
});

test('classifyHoop', () => {
  assert.equal(classifyHoop(add(head, hoop.t, 0.3), false, hoop, 0.1), 'on');
  assert.equal(classifyHoop(add(head, hoop.n, 0.06), false, hoop, 0.1), 'off');
  assert.equal(classifyHoop(add(head, hoop.n, 0.06), true, hoop, 0.1), 'skip');
  assert.equal(classifyHoop(null, false, hoop, 0.1), 'skip');
});

test('nearHoop is a 0.5 m horizontal zone around the address clubhead', () => {
  assert.equal(nearHoop(null, hoop), false);
  assert.equal(nearHoop({ x: 0.45, z: 0 }, hoop), true);
  assert.equal(nearHoop({ x: 0.6, z: 0 }, hoop), false);
});

// A rigid club swung about an axis through the hoop center: tip(θ) = center + R(−up·cosθ + t·sinθ) rotated about `spin`.
function swingTips(spin) {
  const tips = [];
  for (let th = 0; th <= 4; th += 0.02) {
    const v = add({ x: 0, y: 0, z: 0 }, hoop.up, -R); // center -> head
    // Rodrigues rotation of v about unit `spin` by th
    const c = Math.cos(th), s = Math.sin(th), k = spin;
    const kxv = { x: k.y * v.z - k.z * v.y, y: k.z * v.x - k.x * v.z, z: k.x * v.y - k.y * v.x };
    const kv = dot(k, v);
    const r = { x: v.x * c + kxv.x * s + k.x * kv * (1 - c), y: v.y * c + kxv.y * s + k.y * kv * (1 - c), z: v.z * c + kxv.z * s + k.z * kv * (1 - c) };
    tips.push(add(hoop.center, r));
  }
  return tips;
}

test('a swing that stays in the hoop plane is always on', () => {
  assert.ok(swingTips(hoop.n).every((p) => classifyHoop(p, false, hoop, 0.1) === 'on'));
});

test('a swing tilted 10 degrees off the hoop plane goes off', () => {
  const a = (10 * Math.PI) / 180;
  const tilted = add({ x: 0, y: 0, z: 0 }, hoop.n, Math.cos(a));
  const spin = add(tilted, hoop.t, Math.sin(a));
  assert.ok(swingTips(spin).some((p) => classifyHoop(p, false, hoop, 0.1) === 'off'));
});
