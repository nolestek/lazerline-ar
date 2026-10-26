import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, saveSettings, DEFAULTS } from '../src/settings.js';

const mem = (init = {}) => ({ d: { ...init }, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; } });

test('empty storage gives defaults', () => assert.deepEqual(loadSettings(mem()), DEFAULTS));
test('undefined storage gives defaults', () => assert.deepEqual(loadSettings(undefined), DEFAULTS));
test('throwing storage gives defaults', () => {
  assert.deepEqual(loadSettings({ getItem() { throw new Error('blocked'); } }), DEFAULTS);
  assert.doesNotThrow(() => saveSettings({ setItem() { throw new Error('blocked'); } }, DEFAULTS));
});
test('junk JSON gives defaults', () => assert.deepEqual(loadSettings(mem({ 'lazerline.settings.v2': '{oops' })), DEFAULTS));
test('bad fields fall back individually', () => {
  const s = loadSettings(mem({ 'lazerline.settings.v2': JSON.stringify({ mode: 'laser', clubLength: 1.1, lineWidth: 5 }) }));
  assert.deepEqual(s, { ...DEFAULTS, clubLength: 1.1, lineWidth: 0.30 });
});
test('round trip', () => {
  const st = mem();
  const s = { mode: 'controller', clubLength: 1.15, gripLength: 0.3, lineWidth: 0.05, drill: 'hoop' };
  saveSettings(st, s);
  assert.deepEqual(loadSettings(st), s);
});
test('drill defaults to line and rejects unknown values', () => {
  assert.equal(DEFAULTS.drill, 'line');
  assert.equal(loadSettings(mem({ 'lazerline.settings.v2': JSON.stringify({ drill: 'circle' }) })).drill, 'line');
});
