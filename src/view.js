// three.js objects only; no app logic. main.js drives it through the setters below.
import * as THREE from 'three';

const RED = '#ff2a2a';
const BEAM_RADIUS = 0.004;
const TEXT_DISTANCE = 1.5;
const UP = new THREE.Vector3(0, 1, 0);

export function createView(scene) {
  const cache = {};
  // Lazily create one object per key so live and ghost copies don't share state.
  const get = (key, make) => {
    if (!cache[key]) { cache[key] = make(); cache[key].visible = false; scene.add(cache[key]); }
    return cache[key];
  };
  const material = (color, ghost) =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: ghost ? 0.35 : 1, side: THREE.DoubleSide });

  // Unit-height cylinder stretched between two points.
  function placeBar(mesh, a, b) {
    const from = new THREE.Vector3(a.x, a.y, a.z);
    const d = new THREE.Vector3(b.x, b.y, b.z).sub(from);
    mesh.position.copy(from).addScaledVector(d, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, d.clone().normalize());
    mesh.scale.set(1, d.length(), 1);
    mesh.visible = true;
  }
  const bar = (radius, color, ghost) =>
    new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 8), material(color, ghost));

  function setStick(butt, head, color, ghost = false) {
    if (!butt || !head) { if (cache['stick' + ghost]) cache['stick' + ghost].visible = false; return; }
    const m = get('stick' + ghost, () => bar(0.012, color, ghost));
    m.material.color.set(color);
    placeBar(m, butt, head);
  }

  function setLaser(which, from, hit, ghost = false, radius = 0.075) {
    const key = which + ghost;
    const beam = get('beam' + key, () => bar(BEAM_RADIUS, RED, ghost));
    const dot = get('dot' + key, () => {
      const d = new THREE.Mesh(new THREE.CircleGeometry(1, 24), material(RED, ghost));
      d.rotation.x = -Math.PI / 2;
      return d;
    });
    if (!from || !hit) { beam.visible = dot.visible = false; return; }
    placeBar(beam, from, { x: hit.x, y: 0, z: hit.z });
    dot.position.set(hit.x, 0.002, hit.z);
    dot.scale.setScalar(radius);
    dot.visible = true;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 256;
  const texture = new THREE.CanvasTexture(canvas);
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 0.3),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false }),
  );
  panel.renderOrder = 10;
  panel.visible = false;
  scene.add(panel);
  let shown = null;

  function setText(text, cameraPose) {
    if (text == null) { panel.visible = false; return; }
    if (text !== shown) {
      shown = text;
      const g = canvas.getContext('2d');
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = 'rgba(0,0,0,0.7)';
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = '#fff';
      g.font = '44px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      // Wrap on words so long prompts fit the panel.
      const lines = [];
      let line = '';
      for (const w of text.split(' ')) {
        if (line && g.measureText(line + ' ' + w).width > canvas.width - 80) { lines.push(line); line = w; }
        else line = line ? line + ' ' + w : w;
      }
      lines.push(line);
      lines.forEach((l, i) => g.fillText(l, canvas.width / 2, canvas.height / 2 + (i - (lines.length - 1) / 2) * 56));
      texture.needsUpdate = true;
    }
    if (cameraPose) {
      const pos = new THREE.Vector3().setFromMatrixPosition(cameraPose.matrixWorld);
      const dir = new THREE.Vector3(0, 0, -1).transformDirection(cameraPose.matrixWorld);
      dir.y = 0;
      if (dir.lengthSq() > 1e-6) dir.normalize();
      panel.position.copy(pos).addScaledVector(dir, TEXT_DISTANCE);
      panel.lookAt(pos);
    }
    panel.visible = true;
  }

  return { setStick, setLaser, setText };
}
