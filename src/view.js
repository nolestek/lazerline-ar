// three.js objects only; no app logic. main.js drives it through the setters below.
import * as THREE from 'three';

export const COLORS = { on: '#22c55e', off: '#ef4444', skip: '#ffd400', unsure: '#9ca3af' };
// Sample state -> trail color: anything not scored reads as unsure.
export const stateColor = (state) => (state === 'on' || state === 'off' ? COLORS[state] : COLORS.unsure);
const RED = '#ff2a2a';
const TRAIL_Y = 0.002;
const BEAM_RADIUS = 0.004;
const TEXT_DISTANCE = 1.5;
const UP = new THREE.Vector3(0, 1, 0);

export function createView(scene) {
  const cache = {};
  // Lazily create one object per key.
  const get = (key, make) => {
    if (!cache[key]) { cache[key] = make(); cache[key].visible = false; scene.add(cache[key]); }
    return cache[key];
  };
  const material = (color) =>
    new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide });

  // Unit-height cylinder stretched between two points.
  function placeBar(mesh, a, b) {
    const from = new THREE.Vector3(a.x, a.y, a.z);
    const d = new THREE.Vector3(b.x, b.y, b.z).sub(from);
    mesh.position.copy(from).addScaledVector(d, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, d.clone().normalize());
    mesh.scale.set(1, d.length(), 1);
    mesh.visible = true;
  }
  const bar = (radius, color) =>
    new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 8), material(color));

  function setStick(butt, head, color) {
    if (!butt || !head) { if (cache.stick) cache.stick.visible = false; return; }
    const m = get('stick', () => bar(0.012, color));
    m.material.color.set(color);
    placeBar(m, butt, head);
  }

  function setLaser(which, from, hit, radius) {
    const beam = get('beam' + which, () => bar(BEAM_RADIUS, RED));
    const dot = get('dot' + which, () => {
      const d = new THREE.Mesh(new THREE.CircleGeometry(1, 24), material(RED));
      d.rotation.x = -Math.PI / 2;
      return d;
    });
    if (!from || !hit) { beam.visible = dot.visible = false; return; }
    placeBar(beam, from, { x: hit.x, y: 0, z: hit.z });
    dot.position.set(hit.x, 0.002, hit.z);
    dot.scale.setScalar(radius);
    dot.visible = true;
  }

  function setLine(line, color) {
    const m = get('line', () => {
      const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      return new THREE.Mesh(g, material(color));
    });
    if (!line) { m.visible = false; return; }
    m.material.color.set(color);
    m.material.opacity = 0.6;
    m.position.set(line.cx, 0.001, line.cz);
    m.rotation.y = -line.angle; // plane x-axis -> (cos a, sin a) in (x, z)
    m.scale.set(line.length, 1, line.width);
    m.visible = true;
  }

  function setHoop(hoop, color) {
    const m = get('hoop', () => new THREE.Mesh(new THREE.BufferGeometry(), material(color)));
    if (!hoop) { m.visible = false; return; }
    if (m.userData.radius !== hoop.radius) {
      m.geometry.dispose();
      m.geometry = new THREE.TorusGeometry(hoop.radius, 0.01, 8, 128);
      m.userData.radius = hoop.radius;
    }
    m.material.color.set(color);
    m.material.opacity = 0.8;
    // Torus lies in its local XY plane: map X -> target line, Y -> in-plane up, Z -> plane normal.
    const v = (p) => new THREE.Vector3(p.x, p.y, p.z);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(v(hoop.t), v(hoop.up), v(hoop.n)));
    m.position.copy(v(hoop.center));
    m.visible = true;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 384;
  const texture = new THREE.CanvasTexture(canvas);
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 0.45),
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
      // Honor explicit newlines, then wrap each paragraph on words so long prompts fit the panel.
      const lines = [];
      for (const para of text.split('\n')) {
        let cur = '';
        for (const w of para.split(' ')) {
          if (cur && g.measureText(cur + ' ' + w).width > canvas.width - 80) { lines.push(cur); cur = w; }
          else cur = cur ? cur + ' ' + w : w;
        }
        lines.push(cur);
      }
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

  // Rebuilt from the samples each call: swings are a few hundred samples.
  const trail = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true }));
  trail.frustumCulled = false;
  trail.visible = false;
  scene.add(trail);

  function clearTrail() {
    trail.visible = false;
  }

  function setTrail(samples) {
    const pos = [], col = [];
    const c = new THREE.Color();
    for (let i = 1; i < samples.length; i++) {
      const s = samples[i];
      c.set(stateColor(s.state));
      // Hoop drill samples carry the clubhead's 3D path; Line drill draws the floor dots.
      if (s.tip) {
        const a = samples[i - 1].tip;
        if (a) { pos.push(a.x, a.y, a.z, s.tip.x, s.tip.y, s.tip.z); col.push(c.r, c.g, c.b, c.r, c.g, c.b); }
        continue;
      }
      for (const k of ['head', 'butt']) {
        const a = samples[i - 1][k], b = s[k];
        if (!a || !b) continue;
        pos.push(a.x, TRAIL_Y, a.z, b.x, TRAIL_Y, b.z);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }
    trail.geometry.dispose();
    trail.geometry = new THREE.BufferGeometry();
    trail.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    trail.geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    trail.visible = pos.length > 0;
  }

  return { setStick, setLaser, setLine, setHoop, setText, setTrail, clearTrail };
}
