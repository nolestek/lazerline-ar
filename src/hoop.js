// Swing-plane hoop math. No three.js imports, so Node can test it.

const UP = { x: 0, y: 1, z: 0 };
const ADDRESS_ZONE = 0.5; // m around the address clubhead: a slow takeaway must turn ~9° before leaving it

const add = (a, b, k = 1) => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a) => { const l = Math.hypot(a.x, a.y, a.z); return { x: a.x / l, y: a.y / l, z: a.z / l }; };

/**
 * Hoop from the address pose: its plane holds the whole address shaft and the target line,
 * and its lowest point is the address clubhead. `fallbackRight` (e.g. the camera's right)
 * gives the target line when the shaft is too vertical to have one.
 */
export function buildHoop(head, axis, radius, fallbackRight) {
  const axisH = { x: axis.x, y: 0, z: axis.z };
  const t = Math.hypot(axisH.x, axisH.z) < 1e-3
    ? norm({ x: fallbackRight.x, y: 0, z: fallbackRight.z })
    : norm(cross(UP, axisH));
  const n = norm(cross(axis, t));
  const up = norm(add(UP, n, -dot(n, UP)));
  return { head, n, t, up, center: add(head, up, radius), radius };
}

export const planeDistance = (p, hoop) => Math.abs(dot(hoop.n, add(p, hoop.head, -1)));

export function classifyHoop(tip, unsure, hoop, tolerance) {
  if (unsure || !tip) return 'skip';
  return planeDistance(tip, hoop) <= tolerance / 2 ? 'on' : 'off';
}

export const nearHoop = (h, hoop) =>
  !!h && Math.hypot(h.x - hoop.head.x, h.z - hoop.head.z) < ADDRESS_ZONE;
