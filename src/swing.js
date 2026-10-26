// Automatic swing detection from controller direction samples. Pure, no three.js.
import { angleBetween } from './geometry.js';

const DEFAULTS = {
  still: 0.5, start: 1.0, addressHold: 0.5, endHold: 0.5,
  minSwing: 0.4, maxSwing: 10, addressNear: null,
  startAngle: 0.15, // rad turned from address also starts a swing, so slow-motion swings never need the speed gate
  stallHold: 3,     // s still without passing impact: a lift or abandoned swing, give up
};
const MAX_NULLS = 10;
const AWAY = 1.0; // rad from address the club must reach...
const BACK = 0.5; // ...then come back within, before stillness can end the swing (passed impact)

export function createSwingDetector(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  let state, prev, holdStart, swing, endStart, nulls, away, passed, addrDir;

  function reset() {
    state = 'idle'; prev = null; holdStart = null; swing = null; endStart = null; nulls = 0; away = passed = false;
  }
  reset();

  function update(s) {
    if (!s) {
      if (state === 'swinging') {
        if (++nulls >= MAX_NULLS) reset();
      } else {
        const keep = state; // a lost pose drops address back to idle
        reset();
        return { state: keep === 'address' ? 'idle' : state };
      }
      return { state };
    }
    nulls = 0;
    const dt = prev ? s.t - prev.t : 0;
    // dt <= 0 (duplicate timestamps) means no motion info for this frame.
    const speed = dt > 0 ? angleBetween(s.dir, prev.dir) / dt : null;
    const before = prev;
    if (speed !== null || !prev) prev = s;

    if (state === 'swinging') {
      swing.push(s);
      if (s.t - swing[0].t > o.maxSwing) { reset(); return { state }; }
      const fromAddress = angleBetween(s.dir, swing[0].dir);
      if (fromAddress >= AWAY) away = true;
      else if (away && fromAddress <= BACK) passed = true;
      if (speed !== null) {
        if (speed < o.still) {
          endStart ??= before.t;
          const stillFor = s.t - endStart;
          // A pause at the top is not the end: only stillness after impact is.
          if (passed && stillFor >= o.endHold && s.t - swing[0].t >= o.minSwing) {
            const done = swing;
            reset(); prev = s;
            return { state: 'idle', swing: done };
          }
          // A waggle that settles back at address: drop it and stay at address for the real swing.
          if (!away && fromAddress < o.startAngle && stillFor >= o.endHold) {
            const dir = swing[0].dir;
            reset(); prev = s; state = 'address'; addrDir = dir;
            return { state };
          }
          if (!passed && stillFor >= o.stallHold) { reset(); prev = s; return { state }; }
        } else endStart = null;
      }
      return { state };
    }

    if (state === 'address') {
      // Losing the pose (not stillness: a slow takeaway keeps address) cancels it.
      if (s.dir.y >= -0.5 || (o.addressNear && !o.addressNear(s.head))) {
        state = 'idle'; holdStart = null;
        return { state };
      }
      if ((speed !== null && speed > o.start) || angleBetween(s.dir, addrDir) > o.startAngle) {
        state = 'swinging'; swing = [before, s]; endStart = null;
      }
      return { state };
    }

    // idle
    if (speed === null) return { state };
    const isStill = speed < o.still && s.dir.y < -0.5 && (!o.addressNear || o.addressNear(s.head));
    if (!isStill) holdStart = null;
    else {
      holdStart ??= before.t;
      if (s.t - holdStart >= o.addressHold) { state = 'address'; addrDir = s.dir; }
    }
    return { state };
  }

  return { update, reset };
}
