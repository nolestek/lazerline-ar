# LazerLine AR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single static web page that runs a WebXR passthrough AR swing-plane drill on Meta Quest 3: lasers out of both ends of a calibrated virtual shaft, a placeable floor line, live on/off feedback, and a post-swing result plus ghost replay.

**Architecture:** Pure logic (floor-hit geometry, settings, swing detection, swing analysis) lives in small dependency-free ES modules tested with `node --test`. A thin XR layer (`main.js` for session/input/state, `view.js` for three.js objects) reads controller poses straight from `XRFrame.getPose()` so it can see `emulatedPosition`, and feeds plain `{x,y,z}` data into the pure modules. No build step; three.js loads from a CDN via an import map.

**Tech Stack:** HTML + vanilla JS (ES modules), three.js 0.170.0 from `cdn.jsdelivr.net`, WebXR `immersive-ar` + `local-floor`, Node 24 built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-23-lazerline-ar-design.md`

## Global Constraints

- WebXR `immersive-ar` session with required feature `local-floor`; floor is the plane y = 0 (meters).
- Must be served from a secure context (HTTPS or `localhost`).
- Static site, no backend, no build step, no npm runtime dependencies.
- Pure modules (`src/geometry.js`, `src/settings.js`, `src/swing.js`, `src/analysis.js`) must not import three.js; they take and return plain `{x,y,z}` / `{x,z}` objects so Node can test them.
- No button presses are required during a swing; swing start/end are detected automatically.
- Only the last swing is kept. Settings (mode, clubLength, gripLength, lineWidth) persist in `localStorage` under key `lazerline.settings`; every access wrapped in try/catch.
- Colors: line idle `#ffd400`, on `#22c55e`, off `#ef4444`, unsure `#9ca3af`; lasers and dots `#ff2a2a`.
- Defaults: mode `adapter`, clubLength `0.95` m, gripLength `0.4` m, lineWidth `0.15` m (min `0.02`, max `0.30`, step `0.01`), line length `3` m, dot cap `4` m horizontal from the controller, replay speed `0.25`.

## Review Focus

- **Shaft near horizontal / parallel to the line:** the dot would shoot across the room. Expect no dot (not an "off" sample) beyond 4 m. Pinned in Task 1 (`floorHit` cap and near-horizontal tests).
- **Virtual clubhead below the floor at address** (club length set too long): the ray from the clubhead tip would start under the floor and miss. Expect the dot to still appear, because hits are always cast from the controller position. Pinned in Task 1 (`floorHit` origin test) and Task 5 (cast from `pos`, not from the tip).
- **A swing with nothing countable** (all unsure or all no-dot): expect no `NaN%` and never "Great job!". Pinned in Task 4 (`summarize` empty/all-unsure tests).
- **localStorage blocked or holding junk** (private mode, an older version's data): expect defaults, no crash. Pinned in Task 2.
- **Tracking lost entirely mid-swing** (controller out of range, no pose for several frames): expect the detector to abandon the swing and go back to idle rather than hang in `swinging`. Pinned in Task 3 (timeout and `null` sample tests).

---

## File Structure

| File | Responsibility |
|---|---|
| `index.html` | Start page: mode, club length, grip length, Enter AR button, unsupported-browser message; import map for three |
| `src/geometry.js` | Ray/floor hit, point-vs-line offsets, on-line test, angle between vectors |
| `src/settings.js` | Defaults, load/validate/save settings |
| `src/swing.js` | Swing detector state machine (idle → address → swinging → done) |
| `src/analysis.js` | Per-sample classification, phase finding, swing summary + message |
| `src/view.js` | three.js objects: floor line, stick, beams, dots, trails, ghost, text panel |
| `src/main.js` | XR session, input handling, app state (calibrate → place → ready), wiring |
| `tests/*.test.js` | Node tests for the four pure modules |
| `tests/fixtures.js` | Synthetic swing generator shared by swing and analysis tests |
| `package.json` | `{"type":"module","scripts":{"test":"node --test"}}` only |

---

### Task 1: Project scaffold + geometry

**Files:**
- Create: `package.json`, `src/geometry.js`, `tests/geometry.test.js`

**Interfaces:**
- Produces:
  - `floorHit(origin: {x,y,z}, dir: {x,y,z}, maxDist = 4): {x, z} | null` — `dir` need not be unit. Returns null if `origin.y <= 0`, or `dir.y > -0.02 * |dir|` (pointing up or within ~1° of horizontal), or the hit's horizontal distance from `origin` exceeds `maxDist`.
  - `lineOffset(p: {x,z}, line: Line): {along: number, across: number}` — signed, in meters, relative to the line center along/perpendicular to its direction.
  - `isOnLine(p: {x,z}, line: Line): boolean` — `|across| <= width/2 && |along| <= length/2`.
  - `angleBetween(a: {x,y,z}, b: {x,y,z}): number` — radians, clamp the cosine to [-1, 1].
  - `type Line = {cx: number, cz: number, angle: number, length: number, width: number}` — direction is `(cos angle, sin angle)` in (x, z).

- [ ] **Step 1: Init repo and package.json**

```bash
cd /Users/nolesteketee/Dev/lazerlineAR && git init
```
Create `package.json` as in the File Structure table.

- [ ] **Step 2: Write failing tests in `tests/geometry.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floorHit, lineOffset, isOnLine, angleBetween } from '../src/geometry.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const line = { cx: 0, cz: 0, angle: 0, length: 3, width: 0.1 };

test('straight down hits directly below', () => {
  const h = floorHit({ x: 1, y: 1, z: 2 }, { x: 0, y: -1, z: 0 });
  close(h.x, 1); close(h.z, 2);
});
test('45 degrees down lands one height away', () => {
  const h = floorHit({ x: 0, y: 1, z: 0 }, { x: 1, y: -1, z: 0 });
  close(h.x, 1); close(h.z, 0);
});
test('pointing up or horizontal: no hit', () => {
  assert.equal(floorHit({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }), null);
  assert.equal(floorHit({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }), null);
});
test('beyond maxDist: no hit', () => {
  assert.equal(floorHit({ x: 0, y: 1, z: 0 }, { x: 10, y: -1, z: 0 }), null);
  assert.ok(floorHit({ x: 0, y: 1, z: 0 }, { x: 3, y: -1, z: 0 }));
});
test('origin at or below floor: no hit', () => {
  assert.equal(floorHit({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }), null);
});
test('lineOffset on a rotated line', () => {
  const o = lineOffset({ x: 0, z: 1 }, { ...line, angle: Math.PI / 2 });
  close(o.along, 1); close(o.across, 0, 1e-9);
});
test('isOnLine respects width and ends', () => {
  assert.equal(isOnLine({ x: 1, z: 0.04 }, line), true);
  assert.equal(isOnLine({ x: 1, z: 0.06 }, line), false);
  assert.equal(isOnLine({ x: 1.6, z: 0 }, line), false);
});
test('angleBetween', () => {
  close(angleBetween({ x: 1, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }), Math.PI / 2);
  close(angleBetween({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }), 0);
});
```

- [ ] **Step 3: Run `npm test` — expect FAIL (module not found)**

- [ ] **Step 4: Implement the four functions in `src/geometry.js`**

- [ ] **Step 5: Run `npm test` — expect all geometry tests PASS**

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: geometry for floor hits and line checks"`

---

### Task 2: Settings

**Files:**
- Create: `src/settings.js`, `tests/settings.test.js`

**Interfaces:**
- Produces:
  - `DEFAULTS = {mode: 'adapter', clubLength: 0.95, gripLength: 0.4, lineWidth: 0.15}`
  - `WIDTH_MIN = 0.02`, `WIDTH_MAX = 0.30`, `WIDTH_STEP = 0.01`
  - `loadSettings(storage: Storage | undefined): Settings` — parse `storage.getItem('lazerline.settings')`; any throw, bad JSON, wrong type, or out-of-range field falls back to that field's default. `mode` must be `'adapter' | 'controller'`; `clubLength` in [0.5, 1.4]; `gripLength` in [0, 0.8]; `lineWidth` clamped to [WIDTH_MIN, WIDTH_MAX].
  - `saveSettings(storage, settings): void` — swallows errors.

- [ ] **Step 1: Write failing tests in `tests/settings.test.js`**

```js
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
test('junk JSON gives defaults', () => assert.deepEqual(loadSettings(mem({ 'lazerline.settings': '{oops' })), DEFAULTS));
test('bad fields fall back individually', () => {
  const s = loadSettings(mem({ 'lazerline.settings': JSON.stringify({ mode: 'laser', clubLength: 1.1, lineWidth: 5 }) }));
  assert.deepEqual(s, { ...DEFAULTS, clubLength: 1.1, lineWidth: 0.30 });
});
test('round trip', () => {
  const st = mem();
  const s = { mode: 'controller', clubLength: 1.15, gripLength: 0.3, lineWidth: 0.05 };
  saveSettings(st, s);
  assert.deepEqual(loadSettings(st), s);
});
```

- [ ] **Step 2: Run `npm test` — expect settings tests FAIL**
- [ ] **Step 3: Implement `src/settings.js`**
- [ ] **Step 4: Run `npm test` — expect PASS**
- [ ] **Step 5: Commit** — `git commit -am "feat: persisted settings with validation"` (add new files first)

---

### Task 3: Swing detector

**Files:**
- Create: `src/swing.js`, `tests/swing.test.js`, `tests/fixtures.js`

**Interfaces:**
- Consumes: `angleBetween` from Task 1.
- Produces:
  - `type Sample = {t: number /* seconds */, pos: {x,y,z}, dir: {x,y,z} /* unit, toward clubhead */, unsure: boolean, head: {x,z}|null, butt: {x,z}|null, state: 'on'|'off'|'skip'}` — the detector only reads `t`, `dir`, and (for address) `head`; other fields ride along for analysis/replay.
  - `createSwingDetector(opts?): {update(sample: Sample | null): {state: 'idle'|'address'|'swinging', swing?: Sample[]}, reset(): void}`
  - Default `opts`: `{still: 0.5 /* rad/s */, start: 1.5 /* rad/s */, addressHold: 0.5 /* s */, endHold: 0.3 /* s */, minSwing: 0.4 /* s */, maxSwing: 5 /* s */, addressNear: null /* (head:{x,z}) => boolean, null = always true */}`.

Behavior (angular speed = `angleBetween(dir, prev.dir) / (t - prev.t)`):
- `idle` → `address` once the club has been still (< `still`) with `dir.y < -0.5` and `addressNear(head)` true for `addressHold` seconds.
- `address` → `swinging` on the first sample with speed > `start`; recording begins with the last address sample (so `swing[0]` is the address pose).
- `swinging` → when speed stays < `still` for `endHold` seconds and the swing has lasted ≥ `minSwing`, return `{state: 'idle', swing}` once, then continue in `idle`.
- `swinging` longer than `maxSwing`, or 10 consecutive `null` samples (no pose), → abandon: `idle`, no `swing`.
- A `null` sample in `idle`/`address` resets the hold timer.

- [ ] **Step 1: Create the shared fixture `tests/fixtures.js`**

`makeSwing({hz = 72, still = 0.6, settle = 0.5} = {}): Sample[]` — `dir = {x: Math.sin(a), y: -Math.cos(a), z: 0}`, `pos = {x:0, y:1, z:0}`, `head = {x:0, z:0}`, `butt = null`, `unsure = false`, `state = 'on'`. Angle `a(t)` profile (`ease(u) = (1 − cos πu)/2`):
1. `still` s at a = 0 (address)
2. backswing 0.9 s: `a = 2.5·ease(u)`
3. downswing + through 0.45 s: `a = 2.5 − 4.5·ease(u)` (ends at −2.0; fastest point ≈ a = 0.25, i.e. impact)
4. `settle` s at a = −2.0 (holding the finish)

Also export `ANGLE(sample) = Math.atan2(sample.dir.x, -sample.dir.y)` for assertions.

- [ ] **Step 2: Write failing tests in `tests/swing.test.js`**

Tests (use `makeSwing` or hand-built samples at 72 Hz):
- `still at address then a swing produces exactly one swing`: feed `makeSwing()`. Assert exactly one `update` result has `swing`, `swing.length` > 50, `swing[0].t` ≈ the last address sample's t.
- `no address hold means no swing`: start moving at t = 0.2 s; assert no result ever has `swing`.
- `pointing up while still is not address`: 1 s still at a = 3.0; assert state never `'address'`.
- `swing over maxSwing is abandoned`: address, then keep moving at > start for 6 s; assert no `swing` and state `'idle'` after.
- `ten null samples mid-swing abandons`: address, move 0.3 s, then 10 `null`s; assert state `'idle'` and no `swing` ever returned.
- `addressNear false blocks address`: `createSwingDetector({addressNear: () => false})`, 1 s still at a = 0; state never `'address'`.

- [ ] **Step 3: Run `npm test` — expect swing tests FAIL**
- [ ] **Step 4: Implement `createSwingDetector` in `src/swing.js`**
- [ ] **Step 5: Run `npm test` — expect PASS**
- [ ] **Step 6: Commit** — `"feat: automatic swing detection"`

---

### Task 4: Swing analysis

**Files:**
- Create: `src/analysis.js`, `tests/analysis.test.js`

**Interfaces:**
- Consumes: `isOnLine`, `angleBetween` (Task 1); `Sample` (Task 3).
- Produces:
  - `classify(head: {x,z}|null, butt: {x,z}|null, unsure: boolean, line: Line): 'on'|'off'|'skip'` — `skip` if `unsure` or both dots null; `off` if any present dot is off the line; else `on`.
  - `findPhases(samples: Sample[]): {takeawayEnd: number, top: number, impact: number}` (indices):
    - speed per sample as in Task 3. `impact` = index of max speed (the downswing is the fastest part of any real swing).
    - `top` = index in `[0, impact)` maximizing `angleBetween(dir, samples[0].dir)` — farthest from address before the fastest point. (Not "slowest point": speed is also ~0 at the start of the takeaway.) Fallback `impact`.
    - `takeawayEnd` = first index in `[0, top]` with `dir.y >= -0.2` (fallback `top`).
  - `phaseOf(i: number, samples: Sample[], phases): 'takeaway'|'backswing'|'top'|'downswing'|'follow'` — `top` if `|samples[i].t - samples[phases.top].t| <= 0.1`; else by index: `< takeawayEnd` takeaway, `< top` backswing, `<= impact` downswing, else follow.
  - `summarize(samples: Sample[]): {pct: number|null, firstOff: Phase|null, lostAt: Phase|null, message: string}`.

Summary rules and exact copy:
- `counted = on + off`. `pct = counted ? Math.round(100 * on / counted) : null`; if `off > 0` cap `pct` at 99.
- `firstOff` = phase of the first `off` sample; `lostAt` = phase of the first `unsure` sample, only if unsure samples are ≥ 25% of all samples.
- Labels: takeaway → "the takeaway", backswing → "the backswing", top → "the top of the backswing", downswing → "the downswing", follow → "the follow-through".
- `counted === 0` → `"Not enough tracking to score — try a slower swing or face the line more."`
- `off === 0` → `"Great job!"`
- else → `` `${pct}% on plane — came off at ${label(firstOff)}` ``
- If `lostAt` and `counted > 0`, append `` `\nTracking lost at ${label(lostAt)} — try a slower swing or face the line more.` ``

- [ ] **Step 1: Write failing tests in `tests/analysis.test.js`**

Use `makeSwing()` from `tests/fixtures.js` (Task 3), overriding each sample's `state` / `unsure` per test. Tests:
- `classify`: on/off/skip cases, including one dot on and the other off → `'off'`, unsure with dots on → `'skip'`.
- `findPhases ordering`: `0 < takeawayEnd <= top < impact < samples.length - 1`; `ANGLE(samples[top])` ≈ 2.5 (within 0.05); `ANGLE(samples[impact])` within 0.5 of 0.25.
- `all on → "Great job!"` with `pct === 100`.
- `off only near the top → "…came off at the top of the backswing"`, `pct` between 1 and 99.
- `995 on + 5 off → pct 99, not 100`.
- `all skip → pct null, the not-enough-tracking message, never "Great job!"`.
- `40% unsure in backswing + rest on → message starts "Great job!" and contains "Tracking lost at the backswing"`.
- `empty array → pct null`, no throw.

- [ ] **Step 2: Run `npm test` — expect analysis tests FAIL**
- [ ] **Step 3: Implement `src/analysis.js`**
- [ ] **Step 4: Run `npm test` — expect PASS**
- [ ] **Step 5: Commit** — `"feat: swing classification, phases and summary"`

---

### Task 5: Start page, AR session, calibration, stick and lasers

**Files:**
- Create: `index.html`, `src/main.js`, `src/view.js`

**Interfaces:**
- Consumes: `floorHit` (Task 1), `loadSettings`/`saveSettings` (Task 2).
- Produces (`src/view.js`):
  - `createView(scene: THREE.Scene): View` with:
    - `setStick(butt: {x,y,z}, head: {x,y,z}, color: string, ghost = false): void`
    - `setLaser(which: 'head'|'butt', from: {x,y,z}|null, hit: {x,z}|null, ghost = false): void` — beam from `from` to `(hit.x, 0, hit.z)` plus a dot disc; hidden when `hit` is null.
    - `setText(text: string | null, cameraPose?: THREE.Object3D): void` — canvas-texture panel placed 1.5 m in front of the camera at eye height, facing it, when shown.
    - Later tasks add: `setLine`, `setTrail`, `clearTrail`.

Steps:

- [ ] **Step 1: `index.html`**
  - Import map: `"three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js"`.
  - Form: mode radios (`Club adapter` / `Controller only`), club length select (Wedge 0.90, 7-iron 0.95, Driver 1.15), grip length number input (m, shown only for adapter), `Enter AR` button. Prefill from `loadSettings(localStorage)`; save on change.
  - If `!navigator.xr` or `isSessionSupported('immersive-ar')` is false: disable the button and show "Open this page in the Meta Quest Browser on a Quest 3."
- [ ] **Step 2: Session start in `src/main.js`**
  - `navigator.xr.requestSession('immersive-ar', {requiredFeatures: ['local-floor']})`, then `renderer.xr.setReferenceSpaceType('local-floor')`, `renderer.xr.setSession(session)`, renderer with `alpha: true` and clear alpha 0 so passthrough shows.
  - On `session.end`, return to the start page.
- [ ] **Step 3: Pose reading**
  - Each frame: `frame = renderer.xr.getFrame()`, `ref = renderer.xr.getReferenceSpace()`. For the club input source, `pose = frame.getPose(src.gripSpace, ref)`. `unsure = pose.emulatedPosition`. If no pose, treat the frame as a `null` sample.
  - The club input source is whichever source fires the first `select` (trigger) event; until then, show the calibrate prompt.
- [ ] **Step 4: Calibration (app state `calibrate`)**
  - Prompt (exact): `"Point the club straight down at the floor and pull the trigger."`
  - On `select`: `axisLocal = new THREE.Vector3(0, -1, 0).applyQuaternion(poseQuat.clone().invert())`. Each frame after: `axis = axisLocal.clone().applyQuaternion(poseQuat)` (toward clubhead).
  - Stick ends: adapter → `butt = pos − axis·gripLength`, `head = pos + axis·(clubLength − gripLength)`; controller → `butt = pos`, `head = pos + axis·clubLength`.
  - Lasers: `headHit = floorHit(pos, axis)`, `buttHit = floorHit(pos, −axis)` — always cast from `pos`, never from the stick tips. Draw beams from `head` / `butt` to the hits.
  - Button B (gamepad `buttons[5]`, edge-triggered) re-runs calibration from any state.
- [ ] **Step 5: Manual check on device**
  - Dev serving: `python3 -m http.server 8080` in the project root, then with the Quest in developer mode and USB connected: `adb reverse tcp:8080 tcp:8080`, open `http://localhost:8080` in Quest Browser. (`adb` is not installed on this Mac: `brew install --cask android-platform-tools`. Fallback: push to GitHub Pages and open the HTTPS URL.)
  - Expected: passthrough visible; after calibrating, the stick follows the club; a red dot sits under the clubhead end when pointing down; tilting the grip end down shows the second dot; near-horizontal shows no dot.
- [ ] **Step 6: Commit** — `"feat: AR session, calibration, stick and lasers"`

---

### Task 6: Line placement, width and live color

**Files:**
- Modify: `src/main.js`, `src/view.js`

**Interfaces:**
- Consumes: `isOnLine`, `lineOffset` (Task 1); `classify` (Task 4); `WIDTH_*`, `saveSettings` (Task 2).
- Produces: `view.setLine(line: Line, color: string): void` — flat strip at y = 0.001 sized `length × width`, rotated by `-line.angle` around Y so it matches `(cos angle, sin angle)` in (x, z).

Steps:

- [ ] **Step 1: State `place` (entered after calibration, and on button A = `buttons[4]`)**
  - Prompt: `"Aim at the floor and pull the trigger to place the line."` The line's center follows `headHit` until the first trigger; then prompt `"Thumbstick left/right to rotate. Trigger to lock."`. Thumbstick x (`axes[2]`) rotates at 60°/s. Second trigger → state `ready`, prompt hidden.
- [ ] **Step 2: Width in `ready`**
  - Thumbstick y (`axes[3]`) flick past ±0.7 (edge-triggered) changes width by `WIDTH_STEP` (up = wider), clamped; save settings; show `"Line width: N cm"` for 1.5 s.
- [ ] **Step 3: Live color**
  - Each frame in `ready`: `classify(headHit, buttHit, unsure, line)` → `on` green, `off` red, `skip` yellow (idle).
- [ ] **Step 4: Manual check on device** — line drops where aimed, rotates, locks; width readout changes and the strip visibly narrows; moving the dot off the strip turns it red; the setting survives a page reload.
- [ ] **Step 5: Commit** — `"feat: line placement, width and live on-plane color"`

---

### Task 7: Swing recording, trails, result and ghost replay

**Files:**
- Modify: `src/main.js`, `src/view.js`

**Interfaces:**
- Consumes: `createSwingDetector` (Task 3), `summarize`, `classify` (Task 4), `view.*` (Tasks 5–6).
- Produces:
  - `view.setTrail(samples: Sample[]): void` — floor polyline segments for `head` and `butt` paths (y = 0.002); each segment colored by its sample's `state`: on green, off red, skip grey.
  - `view.clearTrail(): void`

Steps:

- [ ] **Step 1: Feed the detector in `ready`**
  - Create with `addressNear: h => h && Math.abs(lineOffset(h, line).across) < 0.5 && Math.abs(lineOffset(h, line).along) < line.length / 2`.
  - Each frame build a `Sample` (`t = frame time / 1000`, `pos`, `dir = axis`, `unsure`, `head`, `butt`, `state = classify(...)`) or `null` without a pose; pass to `update`.
  - Live trail: while `state === 'swinging'`, keep the in-progress samples and call `setTrail` each frame.
  - On transition into `address` (and not replaying): `clearTrail()`, hide result text, hide ghost.
- [ ] **Step 2: On `swing` returned**
  - `setTrail(swing)`, `setText(summarize(swing).message)`, start the ghost replay.
- [ ] **Step 3: Ghost replay**
  - Play the recorded samples at `0.25` speed by elapsed time: for the sample at that time, draw the ghost stick (from `pos` + `dir` with the same stick-end formula as Task 5) and ghost lasers/dots via the `ghost = true` variants. Ghost color = the sample's state color.
  - While replaying, do not feed the detector (so standing still to watch can't trigger address and clear it). When the replay ends, resume feeding.
  - Squeeze (`squeezestart` event on the club source) replays the last swing again.
- [ ] **Step 4: Manual check on device**
  - A slow practice swing kept on the line → green trails, "Great job!", ghost plays back slowly.
  - A swing steered off at the top → red trail segment there and "…came off at the top of the backswing".
  - Returning to address after the replay clears everything.
  - A full-speed swing: note how much shows grey (unsure). Record the observation in the commit message or a note; thresholds in `createSwingDetector` may need tuning here.
- [ ] **Step 5: Commit** — `"feat: swing trails, result and ghost replay"`

---

## Execution Notes

- Tasks 1–4 are pure and fully testable on the Mac (`npm test`). Tasks 5–7 need the headset; their checks are manual.
- If swing detection misfires on real swings, tune the `createSwingDetector` defaults first and keep the Task 3 tests passing.
