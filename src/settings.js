// Persisted user settings. No three.js imports, so Node can test it.
// Storage is injected so tests can pass a fake; every access is guarded.

export const DEFAULTS = { mode: 'adapter', clubLength: 0.95, gripLength: 0.4, lineWidth: 0.10 };
export const WIDTH_MIN = 0.02;
export const WIDTH_MAX = 0.30;
export const WIDTH_STEP = 0.01;

const KEY = 'lazerline.settings.v2'; // v2: new 10 cm default must not be masked by the old saved 15 cm

const inRange = (v, lo, hi, fallback) =>
  typeof v === 'number' && v >= lo && v <= hi ? v : fallback;

export function loadSettings(storage) {
  let parsed;
  try {
    parsed = JSON.parse(storage.getItem(KEY));
  } catch {
    parsed = null;
  }
  const o = parsed && typeof parsed === 'object' ? parsed : {};
  const width = typeof o.lineWidth === 'number' && Number.isFinite(o.lineWidth)
    ? Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, o.lineWidth))
    : DEFAULTS.lineWidth;
  return {
    mode: o.mode === 'adapter' || o.mode === 'controller' ? o.mode : DEFAULTS.mode,
    clubLength: inRange(o.clubLength, 0.5, 1.4, DEFAULTS.clubLength),
    gripLength: inRange(o.gripLength, 0, 0.8, DEFAULTS.gripLength),
    lineWidth: width,
  };
}

export function saveSettings(storage, settings) {
  try {
    storage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked or full: settings simply don't persist.
  }
}
