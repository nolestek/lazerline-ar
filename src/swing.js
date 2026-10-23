// Automatic swing detection from controller direction samples. Pure, no three.js.
import { angleBetween } from './geometry.js';

const DEFAULTS = {
  still: 0.5, start: 1.5, addressHold: 0.5, endHold: 0.3,
  minSwing: 0.4, maxSwing: 5, addressNear: null,
};
const MAX_NULLS = 10;

export function createSwingDetector(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  let state, prev, holdStart, swing, endStart, nulls;

  function reset() {
    state = 'idle'; prev = null; holdStart = null; swing = null; endStart = null; nulls = 0;
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
      if (speed !== null) {
        if (speed < o.still) {
          endStart ??= before.t;
          if (s.t - endStart >= o.endHold && s.t - swing[0].t >= o.minSwing) {
            const done = swing;
            reset(); prev = s;
            return { state: 'idle', swing: done };
          }
        } else endStart = null;
      }
      return { state };
    }

    if (state === 'address') {
      if (speed !== null && speed > o.start) {
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
      if (s.t - holdStart >= o.addressHold) state = 'address';
    }
    return { state };
  }

  return { update, reset };
}
