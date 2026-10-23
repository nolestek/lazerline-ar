import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floorHit, DOT_CAP, LINE_LENGTH } from '../src/geometry.js';
import { classify } from '../src/analysis.js';

// A rigid rod swung exactly in a plane containing the line must never score 'off'.
test('perfect in-plane swing has no off samples', () => {
  const line = { cx: 0, cz: 0, angle: 0, length: LINE_LENGTH, width: 0.15 };
  for (const deg of [55, 60, 70]) {
    const phi = (deg * Math.PI) / 180; // plane tilt from the floor, about a club's lie
    const counts = { on: 0, off: 0, skip: 0 };
    for (let i = 0; i <= 600; i++) {
      const u = i / 600;
      // address (0) -> 2.5 rad backswing -> back through address -> -2.0 rad follow-through
      const a = u < 0.4 ? 2.5 * (u / 0.4) : 2.5 - 4.5 * ((u - 0.4) / 0.6);
      // Controller ~1 m high in the plane, drifting +-0.4 m along the line.
      const pos = { x: -0.4 + 0.8 * u, y: 1, z: Math.cos(phi) / Math.sin(phi) };
      const dir = { x: -Math.sin(a), y: -Math.cos(a) * Math.sin(phi), z: -Math.cos(a) * Math.cos(phi) };
      const back = { x: -dir.x, y: -dir.y, z: -dir.z };
      counts[classify(floorHit(pos, dir, DOT_CAP), floorHit(pos, back, DOT_CAP), false, line)]++;
    }
    assert.equal(counts.off, 0, `plane ${deg} deg: ${JSON.stringify(counts)}`);
    assert.ok(counts.on > 0, `plane ${deg} deg: ${JSON.stringify(counts)}`);
  }
});
