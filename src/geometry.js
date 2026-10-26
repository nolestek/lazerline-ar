// Pure geometry helpers. No three.js imports, so Node can test them.

const MAX_HORIZONTAL_DIST = 4;
export const LINE_LENGTH = 5;

/**
 * Where a ray hits the floor (plane y = 0), or null.
 * dir need not be unit. Rays pointing up or within ~1 degree of horizontal miss.
 */
export function floorHit(origin, dir, maxDist = MAX_HORIZONTAL_DIST) {
  if (origin.y <= 0) return null;
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (dir.y > -0.02 * len) return null;
  const t = -origin.y / dir.y;
  const horizontal = t * Math.hypot(dir.x, dir.z);
  if (horizontal > maxDist) return null;
  return { x: origin.x + t * dir.x, z: origin.z + t * dir.z };
}

/** Signed offset of p from the line center: along its direction and across it (meters). */
export function lineOffset(p, line) {
  const dx = p.x - line.cx;
  const dz = p.z - line.cz;
  const c = Math.cos(line.angle);
  const s = Math.sin(line.angle);
  return { along: dx * c + dz * s, across: -dx * s + dz * c };
}

export function isOnLine(p, line) {
  const { along, across } = lineOffset(p, line);
  return Math.abs(across) <= line.width / 2 && Math.abs(along) <= line.length / 2;
}

/** Angle in radians between two 3D vectors. */
export function angleBetween(a, b) {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  const cos = dot / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z));
  return Math.acos(Math.min(1, Math.max(-1, cos)));
}

/** Address zone: a head dot within 0.5 m of the line and inside its length. */
export function nearLine(h, line) {
  if (!h) return false;
  const { along, across } = lineOffset(h, line);
  return Math.abs(across) < 0.5 && Math.abs(along) < line.length / 2;
}
