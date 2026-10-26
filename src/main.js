import * as THREE from 'three';
import { floorHit, nearLine, LINE_LENGTH } from './geometry.js';
import { classify, summarize } from './analysis.js';
import { createSwingDetector } from './swing.js';
import { buildHoop, classifyHoop, nearHoop } from './hoop.js';
import { loadSettings, saveSettings, WIDTH_MIN, WIDTH_MAX, WIDTH_STEP } from './settings.js';
import { createView, COLORS } from './view.js';

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
form.elements.drill.value = settings.drill;
// Prefill the select only if the saved length is one of the presets.
$('clubLength').value = String(settings.clubLength);
$('gripLength').value = settings.gripLength;

function syncForm() {
  const mode = form.elements.mode.value;
  $('gripRow').style.display = mode === 'adapter' ? '' : 'none';
  settings.mode = mode;
  settings.drill = form.elements.drill.value;
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
const READY_PROMPT = 'Address the ball to start.\nThumbstick up/down: line width.';
const TUNE_PROMPT = 'Thumbstick to tilt the stick onto your grip. Trigger when it lines up.';
const HOOP_AIM_PROMPT = 'Take your address and pull the trigger.';
const HOOP_CONFIRM_PROMPT = 'Pull the trigger to use this hoop. A to redo.';
const HOOP_READY_PROMPT = 'Address the ball to start.\nThumbstick up/down: tolerance.';
const HOLD_SECONDS = 3;
const HOLD_MAX_SPEED = 0.3;         // rad/s
const HOLD_MAX_DRIFT = 0.03;        // m of clubhead drift from where the hold began
const HOOP_ARM = 0.6;               // m added to club length for the hoop's (visual) radius
const BUZZ_GAP = 250;               // ms between haptic pulses
const ROTATE_RATE = Math.PI / 3;    // 60 deg/s
const TUNE_RATE = Math.PI / 18;     // 10 deg/s at full stick

let renderer, scene, camera, view;
let session = null;
let clubSrc = null;                 // input source that fired the first select
let clubHand = null;                // its handedness, to rebind after the source is replaced
let appState = 'calibrate';         // 'calibrate' | 'tune' | 'place' | 'hoopAim' | 'hoopHold' | 'hoopConfirm' | 'ready'
const axisLocal = new THREE.Vector3(0, -1, 0);
let unsure = false;                 // latest pose.emulatedPosition, for Tasks 6/7
let prevB = false;
let prevA = false;
let line = null;                   // {cx, cz, angle, length, width}
let lineLocked = false;             // true once the trigger locked the line
let placing = 'aim';                // 'aim' | 'rotate' (within state 'place')
let headHit = null;
let buttHit = null;
let lastT = 0;
let prevFlick = 0;
let widthMsgUntil = 0;
let liveSwing = [];                 // in-progress samples, shown as the live trail
let resultText = null;
let lineColor = COLORS.skip;        // held through unscored moments so the line doesn't flash yellow mid-swing
let detState = 'idle';
let prevSample = null;
const detector = createSwingDetector({
  addressNear: (h) => nearLine(h, line),
});
let hoop = null;                    // Hoop drill target, fixed in the world once built
let hoopAccepted = false;
let hold = null;                    // {start, tip0, prevAxis} while counting down a still address
let prevOn = true;                  // last scored hoop state, for the on -> off buzz
let lastBuzz = 0;
const hoopDetector = createSwingDetector({
  addressNear: (h) => nearHoop(h, hoop),
});

function resetSwing() {
  liveSwing = []; resultText = null; detState = 'idle'; prevSample = null; lineColor = COLORS.skip;
  detector.reset();
  hoopDetector.reset();
  prevOn = true;
  view?.clearTrail();
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
  line = null;
  lineLocked = false;
  hoop = null;
  hoopAccepted = false;
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
  if (appState === 'tune') {
    if (e.inputSource !== clubSrc) return;
    // Recalibrating keeps a placed line or accepted hoop; A redoes it.
    if (settings.drill === 'hoop') appState = hoopAccepted ? 'ready' : 'hoopAim';
    else appState = lineLocked ? 'ready' : 'place';
    placing = 'aim';
    return;
  }
  if (appState === 'hoopAim' || appState === 'hoopConfirm') {
    if (e.inputSource !== clubSrc) return;
    if (appState === 'hoopAim') { appState = 'hoopHold'; hold = null; } else { hoopAccepted = true; appState = 'ready'; }
    return;
  }
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
  appState = 'tune'; // nobody holds a club perfectly vertical; let them fix the tilt by eye
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
  // Button A re-places the line / redoes the hoop without recalibrating.
  let a = false;
  for (const s of session.inputSources) a = a || !!s.gamepad?.buttons[A_BUTTON]?.pressed;
  if (a && !prevA && idle) {
    if (settings.drill === 'hoop' && ['ready', 'hoopAim', 'hoopHold', 'hoopConfirm'].includes(appState)) {
      hoop = null; hoopAccepted = false; appState = 'hoopAim'; resetSwing();
    } else if (appState === 'ready' || appState === 'place') { appState = 'place'; placing = 'aim'; lineLocked = false; resetSwing(); }
  }
  prevA = a;

  const now = performance.now();
  const dt = lastT ? Math.min((now - lastT) / 1000, 0.1) : 0;
  lastT = now;
  const axes = clubSrc?.gamepad?.axes || [];

  const pose = clubSrc && xrFrame ? xrFrame.getPose(clubSrc.gripSpace, ref) : null;
  unsure = pose ? pose.emulatedPosition : false;
  const hoopDrill = settings.drill === 'hoop';
  // An existing hoop stays visible as a reference outside 'ready' (which colors it).
  view.setHoop(hoopDrill ? hoop : null, COLORS.skip);

  switch (appState) {
    case 'calibrate':
      view.setText(CALIBRATE_PROMPT, camera);
      hideClub();
      view.setLine(null);
      break;
    case 'tune':
      if (pose) {
        // Tilt in the viewer's frame: stick right swings the clubhead end right, up swings it away.
        const q = pose.transform.orientation;
        const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
        const right = new THREE.Vector3(1, 0, 0).transformDirection(camera.matrixWorld).setY(0).normalize();
        const away = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld).setY(0).normalize();
        const x = Math.abs(axes[2] ?? 0) > 0.1 ? axes[2] : 0;
        const y = Math.abs(axes[3] ?? 0) > 0.1 ? axes[3] : 0;
        const axis = axisLocal.clone().applyQuaternion(quat)
          .applyAxisAngle(away, -x * TUNE_RATE * dt)
          .applyAxisAngle(right, -y * TUNE_RATE * dt);
        axisLocal.copy(axis.applyQuaternion(quat.invert())).normalize();
        updateClub(pose, !hoopDrill);
      } else hideClub();
      view.setText(TUNE_PROMPT, camera);
      view.setLine(line, COLORS.skip);
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
    case 'hoopAim':
    case 'hoopConfirm':
      if (pose) updateClub(pose, false); else hideClub();
      view.setText(appState === 'hoopAim' ? HOOP_AIM_PROMPT : HOOP_CONFIRM_PROMPT, camera);
      break;
    case 'hoopHold': {
      if (!pose) { hold = null; hideClub(); view.setText(`Hold still… ${HOLD_SECONDS}`, camera); break; }
      const club = updateClub(pose, false);
      if (!hold) hold = { start: now, tip0: club.head.clone(), prevAxis: club.axis.clone() };
      else {
        const speed = dt > 0 ? club.axis.angleTo(hold.prevAxis) / dt : 0;
        hold.prevAxis = club.axis.clone();
        if (speed >= HOLD_MAX_SPEED || club.head.distanceTo(hold.tip0) > HOLD_MAX_DRIFT) { hold.start = now; hold.tip0 = club.head.clone(); }
      }
      const left = HOLD_SECONDS - (now - hold.start) / 1000;
      if (left <= 0) {
        const right = new THREE.Vector3(1, 0, 0).transformDirection(camera.matrixWorld);
        const { x, y, z } = club.head;
        hoop = buildHoop({ x, y, z }, { x: club.axis.x, y: club.axis.y, z: club.axis.z }, settings.clubLength + HOOP_ARM, { x: right.x, y: right.y, z: right.z });
        appState = 'hoopConfirm';
      }
      view.setText(`Hold still… ${Math.max(1, Math.ceil(left))}`, camera);
      break;
    }
    case 'ready': {
      const club = pose ? updateClub(pose, !hoopDrill) : (hideClub(), null);
      const y = axes[3] ?? 0;
      const flick = Math.abs(y) > 0.7 ? Math.sign(y) : 0;
      if (flick && flick !== prevFlick && detState === 'idle') {
        const w = Math.round((settings.lineWidth - flick * WIDTH_STEP) * 100) / 100; // up (negative y) = wider
        settings.lineWidth = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, w));
        saveSettings(storage, settings);
        widthMsgUntil = now + 1500;
      }
      prevFlick = flick;
      let state;
      if (hoopDrill) {
        state = classifyHoop(club && club.head, unsure, hoop, settings.lineWidth);
        view.setHoop(hoop, unsure ? COLORS.unsure : COLORS[state]);
        if (detState === 'swinging' && prevOn && state === 'off' && now - lastBuzz >= BUZZ_GAP) {
          clubSrc?.gamepad?.hapticActuators?.[0]?.pulse?.(0.6, 80);
          lastBuzz = now;
        }
        if (state !== 'skip') prevOn = state === 'on';
      } else {
        line.width = settings.lineWidth;
        state = classify(headHit, buttHit, unsure, line);
        if (state !== 'skip') lineColor = COLORS[state];
        view.setLine(line, unsure ? COLORS.unsure : lineColor);
      }

      // Plain copies: updateClub's vectors are not reused, but samples must never alias live state.
      const sample = club && {
        t: time / 1000, pos: { x: club.pos.x, y: club.pos.y, z: club.pos.z },
        dir: { x: club.axis.x, y: club.axis.y, z: club.axis.z }, unsure,
        head: headHit && { x: headHit.x, z: headHit.z }, butt: buttHit && { x: buttHit.x, z: buttHit.z }, state,
      };
      // Hoop drill: head is the virtual clubhead's floor position (never null while tracked), tip its 3D path.
      if (sample && hoopDrill) {
        sample.head = { x: club.head.x, z: club.head.z };
        sample.butt = null;
        sample.tip = { x: club.head.x, y: club.head.y, z: club.head.z };
      }
      const r = (hoopDrill ? hoopDetector : detector).update(sample);
      if (r.state === 'address' && detState !== 'address') {
        view.clearTrail(); resultText = null; liveSwing = [];
      }
      if (r.swing) {
        liveSwing = [];
        view.setTrail(r.swing);
        resultText = summarize(r.swing).message;
      } else if (r.state === 'swinging') {
        if (detState !== 'swinging') liveSwing = prevSample ? [prevSample] : [];
        if (sample) liveSwing.push(sample);
        view.setTrail(liveSwing);
      } else if (detState === 'swinging') { // abandoned (timeout or lost tracking)
        liveSwing = []; view.clearTrail();
      }
      detState = r.state;
      prevSample = sample;
      const widthLabel = hoopDrill ? 'Tolerance' : 'Line width';
      view.setText(now < widthMsgUntil ? `${widthLabel}: ${Math.round(settings.lineWidth * 100)} cm` : resultText ?? (hoopDrill ? HOOP_READY_PROMPT : READY_PROMPT), camera);
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

// Stick ends for a controller position and unit axis toward the clubhead.
function clubEnds(p, dir) {
  const pos = new THREE.Vector3(p.x, p.y, p.z);
  const axis = new THREE.Vector3(dir.x, dir.y, dir.z);
  const { mode, clubLength, gripLength } = settings;
  const adapter = mode === 'adapter';
  const butt = adapter ? pos.clone().addScaledVector(axis, -gripLength) : pos;
  const head = pos.clone().addScaledVector(axis, adapter ? clubLength - gripLength : clubLength);
  return { butt, head };
}

function updateClub(pose, lasers = true) {
  const p = pose.transform.position;
  const q = pose.transform.orientation;
  const pos = new THREE.Vector3(p.x, p.y, p.z);
  const axis = axisLocal.clone().applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w)); // toward clubhead
  const { butt, head } = clubEnds(pos, axis);
  view.setStick(butt, head, STICK_COLOR);
  // Hits are cast from pos, not the tips: a tip may sit below the floor at address.
  const radius = settings.lineWidth / 4; // dot half the line's width, so it visibly sits inside the line
  headHit = lasers ? floorHit(pos, axis) : null;
  buttHit = lasers ? floorHit(pos, axis.clone().negate()) : null;
  view.setLaser('head', head, headHit, radius);
  view.setLaser('butt', butt, buttHit, radius);
  return { pos, axis, head };
}
