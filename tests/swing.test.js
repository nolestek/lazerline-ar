import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSwingDetector } from '../src/swing.js';
import { makeSwing, ANGLE } from './fixtures.js';

const run = (det, samples) => samples.map((s) => det.update(s));
const at = (t, a) => ({
  t, pos: { x: 0, y: 1, z: 0 }, dir: { x: Math.sin(a), y: -Math.cos(a), z: 0 },
  unsure: false, head: { x: 0, z: 0 }, butt: null, state: 'on',
});
const still = (secs, a, t0 = 0) =>
  Array.from({ length: Math.round(secs * 72) }, (_, i) => at(t0 + i / 72, a));

test('still at address then a swing produces exactly one swing', () => {
  const samples = makeSwing();
  const res = run(createSwingDetector(), samples);
  const swings = res.filter((r) => r.swing);
  assert.equal(swings.length, 1);
  const swing = swings[0].swing;
  assert.ok(swing.length > 50);
  // swing[0] is the last sample before speed crossed `start`: just after motion began at 0.6 s.
  assert.ok(swing[0].t >= 0.6 && swing[0].t < 0.75);
  assert.ok(Math.abs(ANGLE(swing[0])) < 0.1);
  assert.equal(res.at(-1).state, 'idle');
});

test('no address hold means no swing', () => {
  const res = run(createSwingDetector(), [...still(0.2, 0), ...makeSwing({ still: 0 }).slice(0).map((s) => ({ ...s, t: s.t + 0.2 }))]);
  assert.ok(res.every((r) => !r.swing));
});

test('pointing up while still is not address', () => {
  const res = run(createSwingDetector(), still(1, 3.0));
  assert.ok(res.every((r) => r.state !== 'address'));
});

test('swing over maxSwing is abandoned', () => {
  const moving = Array.from({ length: 6 * 72 }, (_, i) => at(0.8 + i / 72, 0.1 + i * 0.05));
  const res = run(createSwingDetector(), [...still(0.8, 0), ...moving]);
  assert.ok(res.every((r) => !r.swing));
  assert.equal(res.at(-1).state, 'idle');
});

test('ten null samples mid-swing abandons', () => {
  const moving = Array.from({ length: 22 }, (_, i) => at(0.8 + i / 72, 0.1 + i * 0.05));
  const det = createSwingDetector();
  const res = run(det, [...still(0.8, 0), ...moving, ...Array(10).fill(null)]);
  assert.ok(res.some((r) => r.state === 'swinging'));
  assert.equal(res.at(-1).state, 'idle');
  assert.ok(res.every((r) => !r.swing));
});

test('addressNear false blocks address', () => {
  const res = run(createSwingDetector({ addressNear: () => false }), still(1, 0));
  assert.ok(res.every((r) => r.state !== 'address'));
});

test('duplicate timestamps are ignored and do not shift detection', () => {
  const plain = makeSwing();
  const dupAt = new Set([20, 70]); // mid-address-hold and mid-swing
  const dup = plain.flatMap((s, i) => (dupAt.has(i) ? [s, { ...s }] : [s]));
  const keep = dup.map((s, i) => i === 0 || dup[i - 1].t !== s.t);
  const states = (samples) => run(createSwingDetector(), samples);
  const a = states(plain);
  const b = states(dup).filter((_, i) => keep[i]);
  assert.deepEqual(b.map((r) => r.state), a.map((r) => r.state));
  assert.equal(b.filter((r) => r.swing).length, 1);
  assert.equal(b.findIndex((r) => r.state === 'address'), a.findIndex((r) => r.state === 'address'));
  assert.equal(b.findIndex((r) => r.state === 'swinging'), a.findIndex((r) => r.state === 'swinging'));
});

const slowTilt = (t0) => Array.from({ length: 73 }, (_, i) => at(t0 + i / 72, i / 72 * 1.2)); // 1 rad/s, ends dir.y -0.36
const flick = (t0, a0) => Array.from({ length: 36 }, (_, i) => at(t0 + i / 72, a0 + i / 72 * 6));

test('address cancelled when the club tilts up slowly, so a later flick is no swing', () => {
  const addr = still(0.8, 0);
  const tilt = slowTilt(0.8);
  const tEnd = tilt.at(-1).t + 1 / 72;
  const fl = flick(tEnd, 1.2);
  const tail = still(0.8, 1.2 + 0.5 * 6, fl.at(-1).t + 1 / 72);
  const res = run(createSwingDetector(), [...addr, ...tilt, ...fl, ...tail]);
  assert.ok(res.some((r) => r.state === 'address'));
  assert.ok(res.every((r) => !r.swing));
});

test('address cancelled when addressNear goes false', () => {
  let near = true;
  const det = createSwingDetector({ addressNear: () => near });
  run(det, still(0.8, 0));
  near = false;
  const fl = flick(0.8, 0);
  const tail = still(0.8, 3, fl.at(-1).t + 1 / 72);
  const res = run(det, [...fl, ...tail]);
  assert.ok(res.every((r) => !r.swing));
});
