import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, findPhases, phaseOf, summarize } from '../src/analysis.js';
import { makeSwing, ANGLE } from './fixtures.js';

const line = { cx: 0, cz: 0, angle: 0, length: 3, width: 0.15 };
const ON = { x: 0, z: 0 }, OFF = { x: 0, z: 1 };

test('classify', () => {
  assert.equal(classify(ON, null, false, line), 'on');
  assert.equal(classify(ON, ON, false, line), 'on');
  assert.equal(classify(OFF, null, false, line), 'off');
  assert.equal(classify(ON, OFF, false, line), 'off');
  assert.equal(classify(ON, ON, true, line), 'skip');
  assert.equal(classify(null, null, false, line), 'skip');
});

test('findPhases ordering and angles', () => {
  const s = makeSwing();
  const p = findPhases(s);
  assert.ok(0 < p.takeawayEnd && p.takeawayEnd <= p.top && p.top < p.impact && p.impact < s.length - 1);
  assert.ok(Math.abs(ANGLE(s[p.top]) - 2.5) < 0.05);
  assert.ok(Math.abs(ANGLE(s[p.impact]) - 0.25) < 0.5);
});

test('findPhases tolerates duplicate timestamps', () => {
  const s = makeSwing();
  s.splice(10, 0, { ...s[10] });
  assert.ok(findPhases(s).impact > 0);
});

test('all on is a great job', () => {
  const r = summarize(makeSwing());
  assert.equal(r.pct, 100);
  assert.equal(r.message, 'Great job!');
});

test('off only near the top', () => {
  const s = makeSwing();
  const p = findPhases(s);
  s.forEach((x, i) => { if (phaseOf(i, s, p) === 'top') x.state = 'off'; });
  const r = summarize(s);
  assert.ok(r.pct > 0 && r.pct < 100);
  assert.match(r.message, /came off at the top of the backswing/);
});

test('a single off sample never rounds to 100', () => {
  const s = makeSwing({ hz: 300 });
  s[Math.floor(s.length / 2)].state = 'off';
  const r = summarize(s);
  assert.equal(r.pct, 99);
  assert.notEqual(r.message, 'Great job!');
});

test('all skip is not scorable', () => {
  const s = makeSwing();
  s.forEach((x) => { x.state = 'skip'; });
  const r = summarize(s);
  assert.equal(r.pct, null);
  assert.match(r.message, /^Not enough tracking to score/);
});

test('tracking lost in the backswing', () => {
  const s = makeSwing();
  const t0 = s.find((x) => ANGLE(x) >= 1.5).t;
  s.forEach((x) => {
    if (x.t >= t0 && x.t < t0 + 0.65) { x.unsure = true; x.state = 'skip'; }
  });
  const r = summarize(s);
  assert.ok(r.message.startsWith('Great job!'));
  assert.ok(r.message.includes('Tracking lost at the backswing'));
});

test('empty array', () => {
  assert.equal(summarize([]).pct, null);
});
