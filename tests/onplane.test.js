import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floorHit, nearLine, LINE_LENGTH } from '../src/geometry.js';
import { classify } from '../src/analysis.js';
import { createSwingDetector } from '../src/swing.js';

// A rigid rod swung exactly in a plane containing the line must never score 'off'.
test('perfect in-plane swing has no off samples', () => {
  const line = { cx: 0, cz: 0, angle: 0, length: LINE_LENGTH, width: 0.15 };
  for (const deg of [45, 50, 55, 60, 70]) {
    const phi = (deg * Math.PI) / 180; // plane tilt from the floor, about a club's lie
    const counts = { on: 0, off: 0, skip: 0 };
    for (let i = 0; i <= 600; i++) {
      const u = i / 600;
      // address (0) -> 2.5 rad backswing -> back through address -> -2.0 rad follow-through
      const a = u < 0.4 ? 2.5 * (u / 0.4) : 2.5 - 4.5 * ((u - 0.4) / 0.6);
      // Controller ~1 m high in the plane, drifting +-0.4 m along the line.
      const y = deg < 52 ? 0.8 : 1;
      const pos = { x: -0.4 + 0.8 * u, y, z: (y * Math.cos(phi)) / Math.sin(phi) };
      const dir = { x: -Math.sin(a), y: -Math.cos(a) * Math.sin(phi), z: -Math.cos(a) * Math.cos(phi) };
      const back = { x: -dir.x, y: -dir.y, z: -dir.z };
      counts[classify(floorHit(pos, dir), floorHit(pos, back), false, line)]++;
    }
    assert.equal(counts.off, 0, `plane ${deg} deg: ${JSON.stringify(counts)}`);
    assert.ok(counts.on > 0, `plane ${deg} deg: ${JSON.stringify(counts)}`);
  }
});

// Slow controller-only driver swing (hands ~0.85 m high, ~47 deg plane) through the real pipeline.
test('slow in-plane driver swing is detected once with no off samples', () => {
  const line = { cx: 0, cz: 0, angle: 0, length: LINE_LENGTH, width: 0.15 };
  const phi = (47 * Math.PI) / 180, r = 1.16;
  const pos = { x: 0, y: r * Math.sin(phi), z: r * Math.cos(phi) };
  const ease = (u) => (1 - Math.cos(Math.PI * u)) / 2;
  const [still, back, down, settle, top] = [0.8, 4, 0.45, 0.8, 3.0];
  const ang = (t) => t < still ? 0 : t < still + back ? top * ease((t - still) / back)
    : t < still + back + down ? top - (top + 2) * ease((t - still - back) / down) : -2;
  const det = createSwingDetector({ addressNear: (h) => nearLine(h, line) });
  const counts = { on: 0, off: 0, skip: 0 };
  let swing = null, swings = 0;
  for (let i = 0; i / 72 <= still + back + down + settle; i++) {
    const t = i / 72, a = ang(t);
    const dir = { x: -Math.sin(a), y: -Math.cos(a) * Math.sin(phi), z: -Math.cos(a) * Math.cos(phi) };
    const head = floorHit(pos, dir), butt = floorHit(pos, { x: -dir.x, y: -dir.y, z: -dir.z });
    const state = classify(head, butt, false, line);
    counts[state]++;
    const r2 = det.update({ t, pos, dir, unsure: false, head, butt, state });
    if (r2.swing) { swings++; swing = r2.swing; }
  }
  assert.equal(swings, 1);
  assert.equal(swing.filter((s) => s.state === 'off').length, 0);
  assert.equal(counts.off, 0, JSON.stringify(counts));
});
