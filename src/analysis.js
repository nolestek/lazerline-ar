// Swing scoring and phase detection. Pure, no three.js.
import { isOnLine, lineOffset, angleBetween } from './geometry.js';

export function classify(head, butt, unsure, line) {
  // Dots past the painted ends can't be judged, so they aren't scored.
  const dots = [head, butt].filter((d) => d && Math.abs(lineOffset(d, line).along) <= line.length / 2);
  if (unsure || !dots.length) return 'skip';
  return dots.every((d) => isOnLine(d, line)) ? 'on' : 'off';
}

export function findPhases(samples) {
  // dt <= 0 (duplicate timestamps) counts as no motion.
  const speed = samples.map((s, i) => {
    const dt = i ? s.t - samples[i - 1].t : 0;
    return dt > 0 ? angleBetween(s.dir, samples[i - 1].dir) / dt : 0;
  });
  let impact = 0;
  speed.forEach((v, i) => { if (v > speed[impact]) impact = i; });
  let top = impact, best = -1;
  for (let i = 0; i < impact; i++) {
    const a = angleBetween(samples[i].dir, samples[0].dir);
    if (a > best) { best = a; top = i; }
  }
  let takeawayEnd = samples.findIndex((s, i) => i <= top && s.dir.y >= -0.2);
  if (takeawayEnd < 0) takeawayEnd = top;
  return { takeawayEnd, top, impact };
}

export function phaseOf(i, samples, phases) {
  if (Math.abs(samples[i].t - samples[phases.top].t) <= 0.1) return 'top';
  if (i < phases.takeawayEnd) return 'takeaway';
  if (i < phases.top) return 'backswing';
  return i <= phases.impact ? 'downswing' : 'follow';
}

const LABEL = {
  takeaway: 'the takeaway', backswing: 'the backswing', top: 'the top of the backswing',
  downswing: 'the downswing', follow: 'the follow-through',
};

export function summarize(samples) {
  const on = samples.filter((s) => s.state === 'on').length;
  const off = samples.filter((s) => s.state === 'off').length;
  const counted = on + off;
  let pct = counted ? Math.round((100 * on) / counted) : null;
  if (off > 0) pct = Math.min(pct, 99);

  const phases = samples.length ? findPhases(samples) : null;
  const phaseAt = (pred) => {
    const i = samples.findIndex(pred);
    return i < 0 ? null : phaseOf(i, samples, phases);
  };
  const firstOff = phaseAt((s) => s.state === 'off');
  const unsureCount = samples.filter((s) => s.unsure).length;
  const lostAt = unsureCount * 4 >= samples.length && unsureCount ? phaseAt((s) => s.unsure) : null;

  let message;
  if (!counted) message = 'Not enough tracking to score — try a slower swing or face the line more.';
  else if (!off) message = 'Great job!';
  else message = `${pct}% on plane — came off at ${LABEL[firstOff]}`;
  if (lostAt && counted) {
    message += `\nTracking lost at ${LABEL[lostAt]} — try a slower swing or face the line more.`;
  }
  return { pct, firstOff, lostAt, message };
}
