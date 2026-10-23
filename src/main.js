import * as THREE from 'three';
import { floorHit } from './geometry.js';
import { classify } from './analysis.js';
import { loadSettings, saveSettings, WIDTH_MIN, WIDTH_MAX, WIDTH_STEP } from './settings.js';
import { createView } from './view.js';

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
const PLACE_PROMPT = 'Aim at the floor and pull the trigger to place the line.';
const ROTATE_PROMPT = 'Thumbstick left/right to rotate. Trigger to lock.';
const LINE_LENGTH = 3;
const ROTATE_RATE = Math.PI / 3;    // 60 deg/s
export const COLORS = { on: '#22c55e', off: '#ef4444', skip: '#ffd400', unsure: '#9ca3af' };

let renderer, scene, camera, view;
let session = null;
let clubSrc = null;                 // input source that fired the first select
let appState = 'calibrate';         // 'calibrate' | 'place' | 'ready'
const axisLocal = new THREE.Vector3(0, -1, 0);
let unsure = false;                 // latest pose.emulatedPosition, for Tasks 6/7
let prevB = false;
let prevA = false;
let line = null;                    // {cx, cz, angle, length, width}
let placing = 'aim';                // 'aim' | 'rotate' (within state 'place')
let headHit = null;
let buttHit = null;
let lastT = 0;
let prevFlick = 0;
let widthMsgUntil = 0;

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
  await renderer.xr.setSession(session);
  appState = 'calibrate';
  clubSrc = null;
  prevB = false;
  prevA = false;
  line = null;
  session.addEventListener('select', onSelect);
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

function onSelect(e) {
  if (appState === 'place') {
    if (e.inputSource !== clubSrc || !line) return;
    if (placing === 'aim') placing = 'rotate'; else appState = 'ready';
    return;
  }
  if (appState !== 'calibrate') return;
  if (!clubSrc) clubSrc = e.inputSource;
  if (e.inputSource !== clubSrc) return;
  const pose = e.frame.getPose(clubSrc.gripSpace, renderer.xr.getReferenceSpace());
  if (!pose) return;
  const q = pose.transform.orientation;
  const poseQuat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  axisLocal.set(0, -1, 0).applyQuaternion(poseQuat.clone().invert());
  appState = 'place';
  placing = 'aim';
  line = null;
}

function frame() {
  const xrFrame = renderer.xr.getFrame();
  const ref = renderer.xr.getReferenceSpace();

  // Button B (any controller) re-runs calibration, edge-triggered.
  let b = false;
  for (const s of session.inputSources) b = b || !!s.gamepad?.buttons[B_BUTTON]?.pressed;
  if (b && !prevB) { appState = 'calibrate'; clubSrc = null; }
  prevB = b;
  // Button A re-places the line without recalibrating.
  let a = false;
  for (const s of session.inputSources) a = a || !!s.gamepad?.buttons[A_BUTTON]?.pressed;
  if (a && !prevA && (appState === 'ready' || appState === 'place')) { appState = 'place'; placing = 'aim'; }
  prevA = a;

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
    case 'ready': { // Task 7 adds swing detection here
      if (pose) updateClub(pose); else hideClub();
      const y = axes[3] ?? 0;
      const flick = Math.abs(y) > 0.7 ? Math.sign(y) : 0;
      if (flick && flick !== prevFlick) {
        const w = Math.round((settings.lineWidth - flick * WIDTH_STEP) * 100) / 100; // up (negative y) = wider
        settings.lineWidth = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, w));
        saveSettings(storage, settings);
        widthMsgUntil = now + 1500;
      }
      prevFlick = flick;
      line.width = settings.lineWidth;
      view.setText(now < widthMsgUntil ? `Line width: ${Math.round(settings.lineWidth * 100)} cm` : null, camera);
      view.setLine(line, unsure ? COLORS.unsure : COLORS[classify(headHit, buttHit, unsure, line)]);
      break;
    }
  }
  renderer.render(scene, camera);
}

function hideClub() {
  headHit = buttHit = null;
  view.setStick(null);
  view.setLaser('head', null, null);
  view.setLaser('butt', null, null);
}

function updateClub(pose) {
  const p = pose.transform.position;
  const q = pose.transform.orientation;
  const pos = new THREE.Vector3(p.x, p.y, p.z);
  const axis = axisLocal.clone().applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w)); // toward clubhead
  const { mode, clubLength, gripLength, lineWidth } = settings;
  const adapter = mode === 'adapter';
  const butt = adapter ? pos.clone().addScaledVector(axis, -gripLength) : pos;
  const head = pos.clone().addScaledVector(axis, adapter ? clubLength - gripLength : clubLength);
  view.setStick(butt, head, STICK_COLOR);
  // Hits are cast from pos, not the tips: a tip may sit below the floor at address.
  const radius = (lineWidth ?? 0.15) / 2;
  headHit = floorHit(pos, axis);
  buttHit = floorHit(pos, axis.clone().negate());
  view.setLaser('head', head, headHit, false, radius);
  view.setLaser('butt', butt, buttHit, false, radius);
}
