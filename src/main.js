import * as THREE from 'three';
import { floorHit } from './geometry.js';
import { loadSettings, saveSettings } from './settings.js';
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

let renderer, scene, camera, view;
let session = null;
let clubSrc = null;                 // input source that fired the first select
let appState = 'calibrate';         // 'calibrate' | 'place' | 'ready'
const axisLocal = new THREE.Vector3(0, -1, 0);
let unsure = false;                 // latest pose.emulatedPosition, for Tasks 6/7
let prevB = false;

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
  if (appState !== 'calibrate') return;
  if (!clubSrc) clubSrc = e.inputSource;
  if (e.inputSource !== clubSrc) return;
  const pose = e.frame.getPose(clubSrc.gripSpace, renderer.xr.getReferenceSpace());
  if (!pose) return;
  const q = pose.transform.orientation;
  const poseQuat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  axisLocal.set(0, -1, 0).applyQuaternion(poseQuat.clone().invert());
  appState = 'place';
}

function frame() {
  const xrFrame = renderer.xr.getFrame();
  const ref = renderer.xr.getReferenceSpace();

  // Button B (any controller) re-runs calibration, edge-triggered.
  let b = false;
  for (const s of session.inputSources) b = b || !!s.gamepad?.buttons[B_BUTTON]?.pressed;
  if (b && !prevB) { appState = 'calibrate'; clubSrc = null; }
  prevB = b;

  const pose = clubSrc && xrFrame ? xrFrame.getPose(clubSrc.gripSpace, ref) : null;
  unsure = pose ? pose.emulatedPosition : false;

  switch (appState) {
    case 'calibrate':
      view.setText(CALIBRATE_PROMPT, camera);
      hideClub();
      break;
    case 'place': // Task 6 adds line placement here
    case 'ready': // Task 7 adds swing detection here
      view.setText(null);
      if (pose) updateClub(pose); else hideClub();
      break;
  }
  renderer.render(scene, camera);
}

function hideClub() {
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
  view.setLaser('head', head, floorHit(pos, axis), false, radius);
  view.setLaser('butt', butt, floorHit(pos, axis.clone().negate()), false, radius);
}
