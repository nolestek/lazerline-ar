// Synthetic swing shared by detector and analysis tests.
const ease = (u) => (1 - Math.cos(Math.PI * u)) / 2;

export const ANGLE = (s) => Math.atan2(s.dir.x, -s.dir.y);

export function makeSwing({ hz = 72, still = 0.6, settle = 0.5 } = {}) {
  const total = still + 0.9 + 0.45 + settle;
  const angle = (t) => {
    if (t < still) return 0;
    if (t < still + 0.9) return 2.5 * ease((t - still) / 0.9);
    if (t < still + 1.35) return 2.5 - 4.5 * ease((t - still - 0.9) / 0.45);
    return -2.0;
  };
  const out = [];
  for (let i = 0; i / hz <= total; i++) {
    const t = i / hz;
    const a = angle(t);
    out.push({
      t, pos: { x: 0, y: 1, z: 0 }, dir: { x: Math.sin(a), y: -Math.cos(a), z: 0 },
      unsure: false, head: { x: 0, z: 0 }, butt: null, state: 'on',
    });
  }
  return out;
}
