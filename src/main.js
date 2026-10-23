import * as THREE from 'three';
import { floorHit, nearLine, LINE_LENGTH } from './geometry.js';
import { classify, summarize } from './analysis.js';
import { createSwingDetector } from './swing.js';
import { loadSettings, saveSettings, WIDTH_MIN, WIDTH_MAX, WIDTH_STEP } from './settings.js';
import { createView, COLORS, stateColor } from './view.js';

let store;
try { store = localStorage; } catch { /* blocked: defaults, nothing persists */ }
const memory = { getItem: () => null, setItem() {} };
const storage = store || memory;

// ---- Start page ----
const $ = (id) => document.getElementById(id);
const form = $('start');
const enterBtn = $('enter');
const settings = loadSettings(storage);

form.elements.mode.value = settings.mode;
// Prefill the select only if the saved length is one of the presets.
$('clubLength').value = String(settings.clubLength);
$('gripLength').value = settings.gripLength;

function syncForm() {
  const mode = form.elements.mode.value;
  $('gripRow').style.display = mode === 'adapter' ? '' : 'none';
  settings.mode = mode;
  settings.clubLength = Number($('clubLength').value) || settings.clubLength;
  const grip = Number($('gripLength').value);
  if (Number.isFinite(grip) && grip >= 0 && grip <= 0.8) settings.gripLength = grip;
  saveSettings(storage, settings);
}
form.addEventListener('change', syncForm);
syncForm();

(async () => {
  const msg = $('msg');
  let ok = false;
  try { ok = !!navigator.xr && await navigator.xr.isSessionSupported('immersive-ar'); } catch { /* treated as unsupported */ }
  if (ok) enterBtn.disabled = false;
  else msg.textContent = 'Open this page in the Meta Quest Browser on a Quest 3.';
})();

enterBtn.addEventListener('click', startSession);

// ---- AR session ----
const CALIBRATE_PROMPT = 'Point the club straight down at the floor and pull the trigger.';
const STICK_COLOR = '#e5e7eb';
const B_BUTTON = 5;
const A_BUTTON = 4;
const STICK_CLICK = 3;               // thumbstick press: replay the last swing
const PLACE_PROMPT = 'Aim at the floor and pull the trigger to place the line.';
const ROTATE_PROMPT = 'Thumbstick left/right to rotate. Trigger to lock.';
const READY_PROMPT = 'Address the ball to start.';
const ROTATE_RATE = Math.PI / 3;    // 60 deg/s
const REPLAY_SPEED = 0.25;

let renderer, scene, camera, view;
let session = null;
let clubSrc = null;                 // input source that fired the first select
let clubHand = null;                // its handedness, to rebind after the source is replaced
let appState = 'calibrate';         // 'calibrate' | 'place' | 'ready'
const axisLocal = new THREE.Vector3(0, -1, 0);
let unsure = false;                 // latest pose.emulatedPosition, for Tasks 6/7
let prevB = false;
let prevA = false;
let prevClick = false;
let line = null;                    // {cx, cz, angle, length, width}
let lineLocked = false;             // true once the trigger locked the line
let placing = 'aim';                // 'aim' | 'rotate' (within state 'place')
let headHit = null;
let buttHit = null;
let lastT = 0;
let prevFlick = 0;
let widthMsgUntil = 0;
let liveSwing = [];                 // in-progress samples, shown as the live trail
let lastSwing = null;               // last completed swing, for replay
let replay = null;                  // {samples, start (ms), i} while the ghost plays
let resultText = null;
let detState = 'idle';
let prevSample = null;
const detector = createSwingDetector({
  addressNear: (h) => nearLine(h, line),
});

function resetSwing() {
  replay = null; lastSwing = null; liveSwing = []; resultText = null; detState = 'idle'; prevSample = null;
  detector.reset();
  view?.clearTrail();
  hideGhost();
}

function hideGhost() {
  view.setStick(null, null, null, true);
  view.setLaser('head', null, null, true);
  view.setLaser('butt', null, null, true);
}

function startReplay(time) {
  if (!lastSwing) return;
  replay = { samples: lastSwing, start: time, i: 0 };
  view.setTrail(lastSwing);
  resultText = summarize(lastSwing).message;
  liveSwing = []; detState = 'idle'; prevSample = null; // detector is not fed during replay
}

// Advance the ghost to the sample at 0.25x elapsed time; false once it has finished.
function stepReplay(time) {
  const { samples, start } = replay;
  const target = samples[0].t + ((time - start) / 1000) * REPLAY_SPEED;
  if (target > samples[samples.length - 1].t) return false;
  while (replay.i + 1 < samples.length && samples[replay.i + 1].t <= target) replay.i++;
  const s = samples[replay.i];
  const { butt, head } = clubEnds(s.pos, s.dir);
  const radius = line.width / 2;
  const color = stateColor(s.state);
  view.setStick(butt, head, color, true);
  view.setLaser('head', head, s.head, true, radius, color);
  view.setLaser('butt', butt, s.butt, true, radius, color);
  return true;
}

async function startSession() {
  enterBtn.disabled = true;
  try {
    session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['local-floor'] });
  } catch (err) {
    $('msg').textContent = 'Could not start AR: ' + err.message;
    enterBtn.disabled = false;
    return;
  }
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.xr.enabled = true;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera();
    view = createView(scene);
  }
  renderer.xr.setReferenceSpaceType('local-floor');
  try {
    await renderer.xr.setSession(session);
  } catch (err) {
    session.end().catch(() => {});
    session = null;
    $('msg').textContent = 'Could not start AR: ' + err.message;
    enterBtn.disabled = false;
    return;
  }
  appState = 'calibrate';
  clubSrc = clubHand = null;
  prevB = false;
  prevA = false;
  prevClick = false;
  line = null;
  lineLocked = false;
  session.addEventListener('select', onSelect);
  session.addEventListener('inputsourceschange', onSourcesChange);
  resetSwing();
  session.addEventListener('end', onEnd);
  form.style.display = 'none';
  renderer.setAnimationLoop(frame);
}

function onEnd() {
  renderer.setAnimationLoop(null);
  session = null;
  form.style.display = '';
  enterBtn.disabled = false;
}

// A sleeping/re-paired controller comes back as a new input source: rebind it, keeping calibration.
function onSourcesChange(e) {
  if (clubSrc && e.removed.includes(clubSrc)) clubSrc = null;
  if (!clubSrc && clubHand) {
    clubSrc = e.added.find((s) => s.handedness === clubHand && s.gripSpace && !s.hand) ?? null;
  }
}

function onSelect(e) {
  if (appState === 'place') {
    if (e.inputSource !== clubSrc || !line) return;
    if (placing === 'aim') placing = 'rotate'; else { appState = 'ready'; lineLocked = true; }
    return;
  }
  if (appState !== 'calibrate') return;
  if (!e.inputSource.gripSpace || e.inputSource.hand) return;
  if (!clubSrc) { clubSrc = e.inputSource; clubHand = clubSrc.handedness; }
  if (e.inputSource !== clubSrc) return;
  const pose = e.frame.getPose(clubSrc.gripSpace, renderer.xr.getReferenceSpace());
  if (!pose) return;
  const q = pose.transform.orientation;
  const poseQuat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  axisLocal.set(0, -1, 0).applyQuaternion(poseQuat.clone().invert());
  // Recalibrating keeps a placed line; A re-places it.
  appState = lineLocked ? 'ready' : 'place';
  placing = 'aim';
}

// three only requests the next XR frame after this returns, so an exception must not escape.
function frame(time) {
  try {
    tick(time);
  } catch (err) {
    console.error(err);
    view?.setText('Error: ' + err.message, camera);
  }
  renderer.render(scene, camera);
}

function tick(time) {
  const xrFrame = renderer.xr.getFrame();
  const ref = renderer.xr.getReferenceSpace();

  // Buttons are ignored mid-address/swing so an accidental press can't wreck it; all edge-triggered.
  const idle = detState === 'idle';
  // Button B (any controller) re-runs calibration.
  let b = false;
  for (const s of session.inputSources) b = b || !!s.gamepad?.buttons[B_BUTTON]?.pressed;
  if (b && !prevB && idle) { appState = 'calibrate'; clubSrc = clubHand = null; resetSwing(); }
  prevB = b;
  // Button A re-places the line without recalibrating.
  let a = false;
  for (const s of session.inputSources) a = a || !!s.gamepad?.buttons[A_BUTTON]?.pressed;
  if (a && !prevA && idle && !replay && (appState === 'ready' || appState === 'place')) { appState = 'place'; placing = 'aim'; lineLocked = false; resetSwing(); }
  prevA = a;
  // Thumbstick click on the club replays the last swing (not grip: holding the controller squeezes it).
  const click = !!clubSrc?.gamepad?.buttons[STICK_CLICK]?.pressed;
  if (click && !prevClick && idle && appState === 'ready') startReplay(time);
  prevClick = click;

  const now = performance.now();
  const dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0;
  lastT = now;
  const axes = clubSrc?.gamepad?.axes || [];

  const pose = clubSrc && xrFrame ? xrFrame.getPose(clubSrc.gripSpace, ref) : null;
  unsure = pose ? pose.emulatedPosition : false;

  switch (appState) {
    case 'calibrate':
      view.setText(CALIBRATE_PROMPT, camera);
      hideClub();
      view.setLine(null);
      break;
    case 'place':
      if (pose) updateClub(pose); else hideClub();
      if (placing === 'aim') {
        if (headHit) line = { cx: headHit.x, cz: headHit.z, angle: line?.angle ?? 0, length: LINE_LENGTH, width: settings.lineWidth };
        view.setText(PLACE_PROMPT, camera);
      } else {
        if (Math.abs(axes[2] ?? 0) > 0.1) line.angle += axes[2] * ROTATE_RATE * dt;
        view.setText(ROTATE_PROMPT, camera);
      }
      view.setLine(line, COLORS.skip);
      break;
    case 'ready': {
      const club = pose ? updateClub(pose) : (hideClub(), null);
      const y = axes[3] ?? 0;
      const flick = Math.abs(y) > 0.7 ? Math.sign(y) : 0;
      if (flick && flick !== prevFlick && detState === 'idle' && !replay) {
        const w = Math.round((settings.lineWidth - flick * WIDTH_STEP) * 100) / 100; // up (negative y) = wider
        settings.lineWidth = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, w));
        saveSettings(storage, settings);
        widthMsgUntil = now + 1500;
      }
      prevFlick = flick;
      line.width = settings.lineWidth;
      const state = classify(headHit, buttHit, unsure, line);
      view.setLine(line, unsure ? COLORS.unsure : COLORS[state]);

      if (replay) {
        if (!stepReplay(time)) { replay = null; hideGhost(); detector.reset(); }
      } else {
        // Plain copies: updateClub's vectors are not reused, but samples must never alias live state.
        const sample = club && {
          t: time / 1000, pos: { x: club.pos.x, y: club.pos.y, z: club.pos.z },
          dir: { x: club.axis.x, y: club.axis.y, z: club.axis.z }, unsure,
          head: headHit && { x: headHit.x, z: headHit.z }, butt: buttHit && { x: buttHit.x, z: buttHit.z }, state,
        };
        const r = detector.update(sample);
        if (r.state === 'address' && detState !== 'address') {
          view.clearTrail(); resultText = null; hideGhost(); liveSwing = [];
        }
        if (r.swing) {
          lastSwing = r.swing; liveSwing = [];
          startReplay(time);
        } else if (r.state === 'swinging') {
          if (detState !== 'swinging') liveSwing = prevSample ? [prevSample] : [];
          if (sample) liveSwing.push(sample);
          view.setTrail(liveSwing);
        } else if (detState === 'swinging') { // abandoned (timeout or lost tracking)
          liveSwing = []; view.clearTrail();
        }
        detState = r.state;
        prevSample = sample;
      }
      view.setText(now < widthMsgUntil ? `Line width: ${Math.round(settings.lineWidth * 100)} cm` : resultText ?? READY_PROMPT, camera);
      break;
    }
  }
}

function hideClub() {
  headHit = buttHit = null;
  view.setStick(null);
  view.setLaser('head', null, null);
  view.setLaser('butt', null, null);
}

// Stick ends for a controller position and unit axis toward the clubhead (plain or THREE vectors).
function clubEnds(p, dir) {
  const pos = new THREE.Vector3(p.x, p.y, p.z);
  const axis = new THREE.Vector3(dir.x, dir.y, dir.z);
  const { mode, clubLength, gripLength } = settings;
  const adapter = mode === 'adapter';
  const butt = adapter ? pos.clone().addScaledVector(axis, -gripLength) : pos;
  const head = pos.clone().addScaledVector(axis, adapter ? clubLength - gripLength : clubLength);
  return { butt, head };
}

function updateClub(pose) {
  const p = pose.transform.position;
  const q = pose.transform.orientation;
  const pos = new THREE.Vector3(p.x, p.y, p.z);
  const axis = axisLocal.clone().applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w)); // toward clubhead
  const { butt, head } = clubEnds(pos, axis);
  view.setStick(butt, head, STICK_COLOR);
  // Hits are cast from pos, not the tips: a tip may sit below the floor at address.
  const radius = (settings.lineWidth ?? 0.15) / 2;
  headHit = floorHit(pos, axis);
  buttHit = floorHit(pos, axis.clone().negate());
  view.setLaser('head', head, headHit, false, radius);
  view.setLaser('butt', butt, buttHit, false, radius);
  return { pos, axis };
}
