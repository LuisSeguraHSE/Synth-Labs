// MOTOR VISUAL 3D (Three.js): sala de paneles, puerta corrediza con cortina y baliza, evaporador,
// unidad condensadora, racks selectivos, pallets con tarima y cartones, montacargas, luminarias,
// mapa térmico, flujo de aire, intercambio por la puerta y sensores. La escena solo LEE el estado
// del simulador: nunca es la fuente de verdad. Geometría repetida con InstancedMesh (pocas draw calls).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { heatRGB } from './heat.js';
import { SLOT } from './config.js';

const N_FLOW = 600, N_DOOR = 140;
const CART = { nx: 2, nz: 3, ny: 6, sx: 0.47, sy: 0.232, sz: 0.38, pitchY: 0.243 };
const CPP = CART.nx * CART.nz * CART.ny; // cartones por pallet
const PAL_H = 0.125;                     // altura de la tarima
const SRGB = THREE.SRGBColorSpace;

// Piezas de la tarima (x = 1,0 m, z = 1,2 m): [x, y, z, sx, sy, sz]
const PARTS = [];
for (const z of [-0.55, 0, 0.55]) PARTS.push([0, 0.011, z, 1.0, 0.022, 0.1]);
for (const x of [-0.45, 0, 0.45]) for (const z of [-0.55, 0, 0.55]) PARTS.push([x, 0.061, z, 0.1, 0.078, 0.1]);
for (const x of [-0.44, -0.22, 0, 0.22, 0.44]) PARTS.push([x, 0.111, 0, 0.1, 0.022, 1.2]);
// Cartones: d = 0 expuesto (color = superficie) … 1 interior (color = núcleo)
const CARTONS = [];
for (let l = 0; l < CART.ny; l++) for (let ix = 0; ix < CART.nx; ix++) for (let iz = 0; iz < CART.nz; iz++) {
  CARTONS.push({ x: (ix - 0.5) * 0.49, y: PAL_H + 0.004 + (l + 0.5) * CART.pitchY, z: (iz - 1) * 0.4, d: 0.5 * (iz === 1) + 0.5 * (l > 0 && l < CART.ny - 1) });
}
const hash = (n) => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };

function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = SRGB; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); t.anisotropy = 8;
  return t;
}
const TEX = {
  concrete: (rx, ry) => canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#3a434d'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { const r = 40 + Math.random() * 120, x = Math.random() * w, y = Math.random() * h, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},0.05)`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
    for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '230,236,242' : '10,14,18'},${Math.random() * 0.12})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
    g.strokeStyle = 'rgba(10,14,18,.35)'; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2); // juntas de losa
  }, [rx, ry]),
  perforated: (ry) => canvasTex(32, 128, (g, w, h) => {
    g.fillStyle = '#6f87a2'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1b2430';
    for (let y = 6; y < h; y += 32) for (const x of [7, 19]) { g.beginPath(); g.roundRect(x, y, 6, 16, 3); g.fill(); }
  }, [1, ry]),
  hazard: (rx) => canvasTex(128, 32, (g, w, h) => {
    g.fillStyle = '#f2b90f'; g.fillRect(0, 0, w, h); g.fillStyle = '#16181b';
    for (let x = -h; x < w + h; x += 32) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 16, h); g.lineTo(x + 16 + h, 0); g.lineTo(x + h, 0); g.fill(); }
  }, [rx, 1]),
  carton: () => canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, h);
    const e = g.createLinearGradient(0, 0, w, 0); e.addColorStop(0, 'rgba(0,0,0,.18)'); e.addColorStop(0.08, 'rgba(0,0,0,0)'); e.addColorStop(0.92, 'rgba(0,0,0,0)'); e.addColorStop(1, 'rgba(0,0,0,.18)'); g.fillStyle = e; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(56, 0, 16, h);                         // cinta
    g.fillStyle = '#ffffff'; g.fillRect(80, 76, 38, 30); g.fillStyle = '#333'; for (let i = 0; i < 5; i++) g.fillRect(84, 80 + i * 5, 30 - i * 4, 2); // etiqueta
    for (let i = 0; i < 9; i++) g.fillRect(84 + i * 3, 100, 1.5, 4);
  }),
  fins: () => canvasTex(256, 64, (g, w, h) => {
    for (let x = 0; x < w; x += 2) { g.fillStyle = x % 4 ? '#8f9baa' : '#c5ced8'; g.fillRect(x, 0, 2, h); }
    g.fillStyle = 'rgba(40,50,60,.55)'; for (let y = 8; y < h; y += 16) g.fillRect(0, y, w, 3);
  }, [4, 1]),
};

export function createScene(container, handlers) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1016);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 3; controls.maxDistance = 70;
  scene.add(new THREE.HemisphereLight(0xdde8ff, 0x1a2230, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-10, 22, 14); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const labels = document.createElement('div'); labels.className = 'labels3d'; container.appendChild(labels);
  const S = { layers: { heat: true, flow: false, sensors: false, pallets: true }, view: '3d', level: 1, sel: null, tween: null, fanAngle: 0, condAngle: 0, t: 0, quality: 'high' };
  let W3 = null;
  const tmpM = new THREE.Matrix4(), tmpC = new THREE.Color(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), IDQ = new THREE.Quaternion(), UNIT = new THREE.BoxGeometry(1, 1, 1);

  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1, ...extra });
  const M = {
    steel: std(0x9aa7b8, { metalness: 0.55, roughness: 0.35 }), galv: std(0x9aa6b3, { metalness: 0.7, roughness: 0.35 }),
    beam: std(0x2f5277, { metalness: 0.45, roughness: 0.45 }), dark: std(0x1f262e, { roughness: 0.8 }), rubber: std(0x121417, { roughness: 0.95 }),
    white: std(0xdfe6ee, { metalness: 0.25, roughness: 0.4 }), wood: std(0xa57a4c, { roughness: 0.9 }), copper: std(0xb87333, { metalness: 0.85, roughness: 0.3 }),
    fork: std(0xd1a21c, { metalness: 0.3, roughness: 0.5 }), glass: new THREE.MeshStandardMaterial({ color: 0x9fb3c8, transparent: true, opacity: 0.35, roughness: 0.1 }),
  };
  const mesh = (geo, mat, pos, parent, pick, shadow = true) => {
    const m = new THREE.Mesh(geo, mat); if (pos) m.position.set(pos[0], pos[1], pos[2]);
    m.castShadow = shadow; m.receiveShadow = shadow; if (pick) m.userData.pick = pick; parent.add(m); return m;
  };
  const box = (sx, sy, sz, mat, pos, parent, pick, shadow) => mesh(new THREE.BoxGeometry(sx, sy, sz), mat, pos, parent, pick, shadow);
  function inst(mat, items, parent, shadow = true) {
    const im = new THREE.InstancedMesh(UNIT, mat, Math.max(1, items.length));
    items.forEach((it, i) => { tmpM.compose(tmpV.set(it[0], it[1], it[2]), it.q || IDQ, tmpS.set(it[3], it[4], it[5])); im.setMatrixAt(i, tmpM); });
    im.count = items.length; im.castShadow = shadow; im.receiveShadow = shadow; parent.add(im); return im;
  }
  const lineSet = (segs, color, opacity, parent) => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity })); parent.add(l); return l;
  };

  function disposeGroup(g) {
    const shared = Object.values(M);
    g.traverse((o) => {
      if (o.geometry && o.geometry !== UNIT) o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m && !shared.includes(m)) { m.map?.dispose(); m.dispose(); } });
    });
  }

  // ======================= Construcción =======================
  function build(R, p, sensors) {
    if (W3) { scene.remove(W3.group); disposeGroup(W3.group); labels.innerHTML = ''; }
    const group = new THREE.Group(); scene.add(group);
    const L = p.L, W = p.W, H = p.H, X = (x) => x - L / 2, Z = (y) => y - W / 2;
    const o = { group, R, p, X, Z, walls: { front: [], back: [], left: [], right: [], ceiling: [] }, pickStatic: [] };
    const dw = p.doorW, dh = Math.min(p.doorH, H - 0.4);
    const ext = Math.max(L, W) * 0.75;
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, far: 80 }); sun.shadow.camera.updateProjectionMatrix();

    // ---- Suelos y señalización
    const ground = mesh(new THREE.PlaneGeometry(L + 16, W + 12), std(0x151b22, { roughness: 1 }), null, group, null);
    ground.rotation.x = -Math.PI / 2; ground.position.set(-3, -0.01, 0);
    const floor = mesh(new THREE.PlaneGeometry(L, W), std(0xffffff, { map: TEX.concrete(L / 4, W / 4), roughness: 0.85 }), null, group, null);
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.002;
    const mark = (w, d, x, z, mat) => { const m = mesh(new THREE.PlaneGeometry(w, d), mat, null, group, null, false); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.006, z); m.receiveShadow = true; return m; };
    const paint = std(0xe8edf2, { roughness: 0.6 });
    for (let j = 0; j < R.ny - 1; j++) { // bordes de pasillo
      const za = (j + 1) * R.dy;
      for (const s of [-1, 1]) mark(L - SLOT.lane - 0.4, 0.08, X((SLOT.lane + L) / 2 - 0.2), Z(za + s * (R.dy / 2 - SLOT.rackDepth / 2 - 0.12)), paint);
    }
    mark(0.08, W - 0.4, X(SLOT.lane - 0.15), 0, paint);
    mark(dw, 0.3, X(0.18), 0, std(0xffffff, { map: TEX.hazard(dw / 0.5), roughness: 0.7 })).rotation.z = Math.PI / 2;
    mesh(new THREE.BoxGeometry(2, 0.05, dw), std(0x7d8793, { metalness: 0.6, roughness: 0.45 }), [X(-1.05), 0.02, 0], group, null);

    // ---- Envolvente: paneles translúcidos, juntas, zócalo sanitario, aristas, luminarias
    const wm = () => new THREE.MeshStandardMaterial({ color: 0xb8c7d6, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false, roughness: 0.3 });
    const plane = (w, h, pos, rotY, rotX, list) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wm()); m.position.copy(pos); m.rotation.set(rotX || 0, rotY || 0, 0); group.add(m); list.push(m); return m; };
    plane(W, H, new THREE.Vector3(X(L), H / 2, 0), Math.PI / 2, 0, o.walls.back);
    plane(L, H, new THREE.Vector3(0, H / 2, Z(0)), 0, 0, o.walls.left);
    plane(L, H, new THREE.Vector3(0, H / 2, Z(W)), 0, 0, o.walls.right);
    plane(L, W, new THREE.Vector3(0, H, 0), 0, Math.PI / 2, o.walls.ceiling);
    const side = (W - dw) / 2;
    plane(side, H, new THREE.Vector3(X(0), H / 2, -dw / 2 - side / 2), Math.PI / 2, 0, o.walls.front);
    plane(side, H, new THREE.Vector3(X(0), H / 2, dw / 2 + side / 2), Math.PI / 2, 0, o.walls.front);
    plane(dw, H - dh, new THREE.Vector3(X(0), dh + (H - dh) / 2, 0), Math.PI / 2, 0, o.walls.front);
    const P = 1.2, segL = [], segR = [], segB = [], segF = [], segC = [];
    for (let x = P; x < L; x += P) { segL.push(X(x), 0, Z(0), X(x), H, Z(0)); segR.push(X(x), 0, Z(W), X(x), H, Z(W)); segC.push(X(x), H, Z(0), X(x), H, Z(W)); }
    for (let y = P; y < W; y += P) { segB.push(X(L), 0, Z(y), X(L), H, Z(y)); segF.push(X(0), Math.abs(Z(y)) < dw / 2 + 0.1 ? dh : 0, Z(y), X(0), H, Z(y)); }
    o.walls.left.push(lineSet(segL, 0xaabbd0, 0.22, group)); o.walls.right.push(lineSet(segR, 0xaabbd0, 0.22, group));
    o.walls.back.push(lineSet(segB, 0xaabbd0, 0.22, group)); o.walls.front.push(lineSet(segF, 0xaabbd0, 0.22, group)); o.walls.ceiling.push(lineSet(segC, 0xaabbd0, 0.18, group));
    const curb = std(0xc4ced8, { roughness: 0.6 });
    o.walls.left.push(box(L, 0.15, 0.1, curb, [0, 0.075, Z(0) + 0.05], group));
    o.walls.right.push(box(L, 0.15, 0.1, curb, [0, 0.075, Z(W) - 0.05], group));
    o.walls.back.push(box(0.1, 0.15, W, curb, [X(L) - 0.05, 0.075, 0], group));
    for (const s of [-1, 1]) o.walls.front.push(box(0.1, 0.15, side, curb, [X(0) + 0.05, 0.075, s * (dw / 2 + side / 2)], group));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(L, H, W)), new THREE.LineBasicMaterial({ color: 0x6d8199 }));
    edges.position.y = H / 2; group.add(edges); o.edges = edges;
    const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf4ff, emissiveIntensity: 1.6 });
    for (const zz of [-W / 4, W / 4]) for (const xx of [-L / 3, 0, L / 5]) o.walls.ceiling.push(box(1.2, 0.05, 0.22, lamp, [xx, H - 0.06, zz], group, null, false));

    // ---- Puerta corrediza: marco, riel, hoja, cortina de tiras, baliza y bolardos
    const door = new THREE.Group(); group.add(door);
    const pd = { kind: 'door', id: 0 };
    for (const s of [-1, 1]) box(0.14, dh + 0.15, 0.12, M.steel, [X(0) - 0.08, (dh + 0.15) / 2, s * (dw / 2 + 0.06)], door, pd);
    box(0.14, 0.15, dw + 0.24, M.steel, [X(0) - 0.08, dh + 0.075, 0], door, pd);
    box(0.1, 0.12, 2 * dw + 0.5, M.galv, [X(0) - 0.2, dh + 0.3, dw / 2], door, pd);
    const leaf = new THREE.Group(); door.add(leaf); o.leaf = leaf;
    box(0.1, dh, dw, M.white, [X(0) - 0.24, dh / 2, 0], leaf, pd);
    box(0.02, 0.35, dw - 0.1, M.steel, [X(0) - 0.3, 0.2, 0], leaf, pd);
    box(0.12, dh + 0.04, 0.03, M.rubber, [X(0) - 0.24, dh / 2, -dw / 2 - 0.01], leaf, pd);
    box(0.02, 0.35, 0.35, M.glass, [X(0) - 0.3, dh * 0.72, 0], leaf, pd);
    mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 12), M.steel, [X(0) - 0.33, dh * 0.5, -dw / 2 + 0.18], leaf, pd);
    o.beacon = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.14, 16), new THREE.MeshStandardMaterial({ color: 0x5a4a1a, emissive: 0x000000, toneMapped: false }), [X(0) - 0.2, dh + 0.5, -dw / 2 - 0.25], door, pd, false);
    o.strips = [];
    const nStrips = 12, stripGeo = new THREE.PlaneGeometry(dw / nStrips + 0.03, dh - 0.05); stripGeo.translate(0, -(dh - 0.05) / 2, 0);
    const stripMat = new THREE.MeshStandardMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, roughness: 0.15 });
    for (let i = 0; i < nStrips; i++) { const st = new THREE.Mesh(stripGeo, stripMat); st.rotation.y = Math.PI / 2; st.position.set(X(0) + 0.06, dh, -dw / 2 + (i + 0.5) * (dw / nStrips)); group.add(st); o.strips.push(st); }
    const bol = std(0xffffff, { map: TEX.hazard(3), roughness: 0.6 });
    for (const s of [-1, 1]) mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.1, 16), bol, [X(-0.35), 0.55, s * (dw / 2 + 0.35)], group, null);
    o.dw = dw;

    // ---- Evaporador EV-01
    const ew = Math.min(W * 0.62, 6), evap = new THREE.Group(); evap.position.set(X(L - 0.45), H - 0.8, 0); group.add(evap);
    const pe = { kind: 'evap', id: 0 };
    o.evapBody = box(0.75, 0.85, ew, std(0xcfd6de, { metalness: 0.35, roughness: 0.45 }), [0, 0, 0], evap, pe);
    box(0.02, 0.78, ew - 0.06, std(0x8f9aa6, { metalness: 0.4 }), [-0.385, 0, 0], evap, pe);
    const coil = mesh(new THREE.PlaneGeometry(0.7, ew - 0.08), std(0xffffff, { map: TEX.fins(), metalness: 0.5, roughness: 0.4 }), [0, -0.426, 0], evap, pe, false);
    coil.rotation.x = Math.PI / 2; coil.rotation.z = Math.PI / 2; o.coil = coil;
    box(0.82, 0.04, ew + 0.1, std(0xaeb8c2, { metalness: 0.7, roughness: 0.3 }), [0.02, -0.47, 0], evap, pe);
    for (const zz of [-ew / 2 + 0.2, ew / 2 - 0.2]) for (const xx of [-0.25, 0.25]) mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 6), M.galv, [xx, 0.62, zz], evap, pe);
    o.blades = [];
    const bladeMat = std(0xc9d3df, { metalness: 0.5, roughness: 0.35 });
    for (let i = 0; i < 3; i++) {
      const zc = (i - 1) * (ew / 3);
      mesh(new THREE.TorusGeometry(0.31, 0.035, 10, 32), M.dark, [-0.4, 0, zc], evap, pe).rotation.y = Math.PI / 2;
      mesh(new THREE.TorusGeometry(0.19, 0.008, 6, 28), M.galv, [-0.43, 0, zc], evap, pe, false).rotation.y = Math.PI / 2;
      for (let s = 0; s < 4; s++) box(0.008, 0.6, 0.012, M.galv, [-0.43, 0, zc], evap, pe, false).rotation.x = (s * Math.PI) / 4;
      mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 16), M.dark, [-0.4, 0, zc], evap, pe).rotation.z = Math.PI / 2;
      const bl = new THREE.Group(); bl.position.set(-0.4, 0, zc); evap.add(bl);
      for (let b = 0; b < 5; b++) {
        const arm = new THREE.Group(); arm.rotation.x = (b * 2 * Math.PI) / 5; bl.add(arm);
        box(0.015, 0.2, 0.1, bladeMat, [0, 0.15, 0], arm, pe, false).rotation.y = 0.45;
      }
      o.blades.push(bl);
    }
    o.evapLed = mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: 0x0ca30c, toneMapped: false }), [-0.39, 0.33, ew / 2 - 0.12], evap, pe, false);
    // Drenaje y líneas frigoríficas (evaporador → muro → unidad condensadora)
    const pvc = std(0xe9eef3, { roughness: 0.5 }), insul = std(0x15181c, { roughness: 0.9 }), pcu = { kind: 'cond', id: 0 };
    mesh(new THREE.CylinderGeometry(0.025, 0.025, H - 1.3, 10), pvc, [X(L) - 0.1, (H - 1.3) / 2 + 0.1, ew / 2 - 0.25], group, pe);
    const pipeH = H - 0.45;
    for (const [r, mat, zz] of [[0.045, insul, -ew / 2 + 0.3], [0.016, M.copper, -ew / 2 + 0.45]]) {
      mesh(new THREE.CylinderGeometry(r, r, 1.6, 12), mat, [X(L) + 0.35, pipeH, zz], group, pcu).rotation.z = Math.PI / 2;
      mesh(new THREE.CylinderGeometry(r, r, pipeH - 1.1, 12), mat, [X(L) + 1.15, 1.1 + (pipeH - 1.1) / 2, zz], group, pcu);
    }

    // ---- Unidad condensadora CU-01 (exterior, junto al muro del fondo)
    const cond = new THREE.Group(); cond.position.set(X(L) + 1.35, 0, -ew / 2 + 0.4); group.add(cond); o.cond = cond;
    box(1.7, 0.1, 1.3, std(0x6b737c, { roughness: 1 }), [0, 0.05, 0], cond, pcu);
    box(1.4, 1.0, 1.0, std(0xc9d1d9, { metalness: 0.3, roughness: 0.45 }), [0, 0.6, 0], cond, pcu);
    mesh(new THREE.PlaneGeometry(1.3, 0.8), std(0xffffff, { map: TEX.fins(), metalness: 0.5 }), [0, 0.6, 0.505], cond, pcu, false);
    mesh(new THREE.TorusGeometry(0.36, 0.03, 8, 32), M.dark, [0, 1.12, 0], cond, pcu).rotation.x = Math.PI / 2;
    const cfan = new THREE.Group(); cfan.position.set(0, 1.12, 0); cond.add(cfan); o.condFan = cfan;
    for (let b = 0; b < 4; b++) { const arm = new THREE.Group(); arm.rotation.y = (b * Math.PI) / 2; cfan.add(arm); box(0.3, 0.012, 0.1, M.dark, [0.17, 0, 0], arm, pcu, false).rotation.x = 0.35; }
    o.condLed = mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: 0x3a4a5e, toneMapped: false }), [0.72, 0.95, 0.3], cond, pcu, false);

    // ---- Racks selectivos por columna (bastidores perforados, arriostres, largueros, protecciones)
    const qs = [...new Set(R.slots.map((s) => s.x))].sort((a, b) => a - b), pitch = qs.length > 1 ? qs[1] - qs[0] : SLOT.pitch;
    const x0 = qs[0] - pitch / 2, nB = qs.length, hU = R.dz + 0.15 + SLOT.palletH + 0.35, depth = SLOT.rackDepth;
    const yBeam1 = R.dz + 0.15 - 0.058, yBeam2 = R.dz + 0.15 + SLOT.palletH + 0.2;
    const upMat = std(0xffffff, { map: TEX.perforated(hU / 0.5), metalness: 0.5, roughness: 0.4 }), hazMat = std(0xffffff, { map: TEX.hazard(3), roughness: 0.6 });
    const AX = new THREE.Vector3(1, 0, 0);
    o.racks = [];
    for (let j = 0; j < R.ny; j++) {
      const yc = (j + 0.5) * R.dy, zF = yc - depth / 2, zB = yc + depth / 2, ups = [], galv = [], beams = [];
      for (let f = 0; f <= nB; f++) {
        const x = X(x0 + f * pitch);
        for (const z of [zF, zB]) { ups.push([x, hU / 2, Z(z), 0.09, hU, 0.075]); galv.push([x, 0.006, Z(z), 0.18, 0.012, 0.15]); }
        for (const y of [0.3, hU - 0.25]) galv.push([x, y, Z(yc), 0.035, 0.035, depth]);
        const n = 5, y0 = 0.3, y1 = hU - 0.25;
        for (let s = 0; s < n; s++) {
          const ya = y0 + ((y1 - y0) * s) / n, yb = y0 + ((y1 - y0) * (s + 1)) / n, dz = (s % 2 ? -1 : 1) * depth;
          const q = new THREE.Quaternion().setFromAxisAngle(AX, Math.atan2(-(yb - ya), dz));
          galv.push(Object.assign([x, (ya + yb) / 2, Z(yc), 0.03, 0.03, Math.hypot(depth, yb - ya)], { q }));
        }
      }
      for (let b = 0; b < nB; b++) {
        const xc = X(x0 + (b + 0.5) * pitch);
        for (const z of [zF, zB]) for (const y of [yBeam1, yBeam2]) beams.push([xc, y, Z(z), pitch - 0.1, 0.11, 0.05]);
        for (const dx of [-0.3, 0, 0.3]) galv.push([xc + dx, yBeam1 + 0.07, Z(yc), 0.04, 0.03, depth]);
      }
      o.racks.push([inst(upMat, ups, group), inst(M.galv, galv, group), inst(M.beam, beams, group), inst(hazMat, [[X(x0 - 0.14), 0.2, Z(yc), 0.1, 0.4, depth + 0.12]], group)]);
    }

    // ---- Pallets: tarimas, cartones (color por temperatura) y film estirable
    const nMax = R.slots.length + 4;
    o.palParts = new THREE.InstancedMesh(UNIT, M.wood, nMax * PARTS.length);
    o.cartons = new THREE.InstancedMesh(new THREE.BoxGeometry(CART.sx, CART.sy, CART.sz), std(0xffffff, { roughness: 0.85, map: TEX.carton() }), nMax * CPP);
    o.cartons.setColorAt(0, tmpC.set(0xffffff));
    const wg = new THREE.BoxGeometry(1.01, CART.ny * CART.pitchY + 0.03, 1.23); wg.translate(0, PAL_H + (CART.ny * CART.pitchY) / 2, 0);
    o.wraps = new THREE.InstancedMesh(wg, new THREE.MeshStandardMaterial({ color: 0xe6f0fa, transparent: true, opacity: 0.12, roughness: 0.15, depthWrite: false }), nMax);
    for (const im of [o.palParts, o.cartons, o.wraps]) { im.count = 0; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.frustumCulled = false; group.add(im); }
    o.palParts.castShadow = o.palParts.receiveShadow = true; o.cartons.castShadow = o.cartons.receiveShadow = true;
    o.palIds = [];

    // ---- Montacargas
    const fk = new THREE.Group(); group.add(fk); o.fork = fk; fk.visible = false;
    box(1.4, 0.45, 1.0, M.fork, [0, 0.45, 0], fk);
    box(0.45, 0.7, 1.0, M.dark, [-0.6, 0.6, 0], fk);
    mesh(new THREE.PlaneGeometry(1.0, 0.3), hazMat, [-0.83, 0.5, 0], fk, null, false).rotation.y = -Math.PI / 2;
    box(0.4, 0.1, 0.45, M.dark, [-0.2, 0.95, 0], fk); box(0.08, 0.45, 0.45, M.dark, [-0.42, 1.2, 0], fk);
    for (const x of [-0.5, 0.45]) for (const z of [-0.42, 0.42]) box(0.05, 1.4, 0.05, M.dark, [x, 1.4, z], fk);
    for (const z of [-0.3, 0, 0.3]) box(1.0, 0.04, 0.08, M.dark, [0, 2.1, z], fk);
    mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8), M.dark, [0.25, 1.05, 0], fk).rotation.z = 0.5;
    const swh = mesh(new THREE.TorusGeometry(0.14, 0.02, 8, 20), M.dark, [0.13, 1.28, 0], fk); swh.rotation.set(0.5, Math.PI / 2, 0);
    o.wheels = [];
    for (const [x, r] of [[0.5, 0.25], [-0.5, 0.21]]) for (const z of [-0.45, 0.45]) { const w = mesh(new THREE.CylinderGeometry(r, r, 0.2, 18), M.rubber, [x, r, z], fk); w.rotation.x = Math.PI / 2; o.wheels.push(w); }
    for (const z of [-0.32, 0.32]) box(0.08, 2.5, 0.08, M.dark, [0.78, 1.25, z], fk);
    box(0.08, 0.08, 0.72, M.dark, [0.78, 2.45, 0], fk);
    const carriage = new THREE.Group(); fk.add(carriage); o.carriage = carriage;
    box(0.05, 0.55, 0.9, M.dark, [0.86, 0.3, 0], carriage);
    for (const z of [-0.26, 0.26]) box(1.1, 0.04, 0.12, M.galv, [1.4, 0.03, z], carriage);
    o.fkBeacon = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 12), new THREE.MeshBasicMaterial({ color: 0xfab219, toneMapped: false }), [-0.3, 2.17, 0], fk, null, false);
    o.fkLast = null;

    // ---- Detalle de operación: camión refrigerado, HMI con valores reales, señalética, bandejas, conductor
    const truck = new THREE.Group(); truck.position.set(X(-9.2), 0, 0); group.add(truck); o.truck = truck; truck.visible = false;
    box(7, 2.6, 2.5, M.white, [0, 1.3 + 0.95, 0], truck);                                         // caja isotérmica
    for (let i = 1; i < 7; i++) box(0.03, 2.5, 2.52, M.galv, [-3.5 + i, 2.25, 0], truck, null, false);
    box(1.8, 2.3, 2.4, std(0x1f6f8b, { metalness: 0.4, roughness: 0.4 }), [-4.5, 1.55, 0], truck); // cabina
    box(0.05, 0.8, 2.0, M.glass, [-5.42, 2.1, 0], truck, null, false);
    box(0.5, 0.9, 1.4, std(0x5b6b80, { metalness: 0.5 }), [-3.8, 3.1, 0], truck);                  // equipo de frío
    box(8.5, 0.25, 1.2, M.dark, [-0.8, 0.8, 0], truck);
    for (const x of [-4.4, 1.5, 2.6]) for (const z of [-1.05, 1.05]) { const w = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 20), M.rubber, [x, 0.5, z], truck); w.rotation.x = Math.PI / 2; }
    for (const s of [-1, 1]) { const d = box(0.05, 2.4, 1.2, M.white, [3.55, 2.2, s * 1.85], truck); d.rotation.y = s * 0.2; } // puertas abiertas
    // HMI de la cámara (canvas actualizado con datos del simulador) junto a la puerta, por fuera
    const hc = document.createElement('canvas'); hc.width = 256; hc.height = 160; o.hmiCtx = hc.getContext('2d');
    o.hmiTex = new THREE.CanvasTexture(hc); o.hmiTex.colorSpace = SRGB;
    const hmi = new THREE.Group(); hmi.position.set(X(0) - 0.12, 1.55, -dw / 2 - 1.0); hmi.rotation.y = -Math.PI / 2; group.add(hmi);
    box(0.62, 0.46, 0.08, M.dark, [0, 0, 0], hmi, { kind: 'door', id: 0 });
    const scr = mesh(new THREE.PlaneGeometry(0.52, 0.33), new THREE.MeshBasicMaterial({ map: o.hmiTex, toneMapped: false }), [0, 0.02, 0.045], hmi, null, false); scr.rotation.y = 0;
    o.hmiLast = -1;
    // Botonera de puerta y señal de salida (interior)
    const bot = box(0.12, 0.2, 0.06, std(0xd9dee4), [X(0) + 0.08, 1.3, dw / 2 + 0.4], group); bot.rotation.y = Math.PI / 2;
    mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 12), new THREE.MeshBasicMaterial({ color: 0x0ca30c, toneMapped: false }), [X(0) + 0.12, 1.35, dw / 2 + 0.4], group, null, false).rotation.z = Math.PI / 2;
    mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 12), new THREE.MeshBasicMaterial({ color: 0xd03b3b, toneMapped: false }), [X(0) + 0.12, 1.25, dw / 2 + 0.4], group, null, false).rotation.z = Math.PI / 2;
    const exitTex = canvasTex(128, 48, (g, w, h) => { g.fillStyle = '#0a7a2a'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.fillText('SALIDA', w / 2, 34); });
    const exit = mesh(new THREE.PlaneGeometry(0.6, 0.22), new THREE.MeshBasicMaterial({ map: exitTex, toneMapped: false }), [X(0) + 0.06, Math.min(H - 0.3, dh + 0.45), 0], group, null, false); exit.rotation.y = Math.PI / 2;
    o.walls.ceiling.push(exit);
    // Bandeja portacables en el techo y rejillas de desagüe
    const tray = std(0x9aa6b3, { metalness: 0.7, roughness: 0.35 });
    o.walls.ceiling.push(box(L - 1.6, 0.06, 0.3, tray, [0.2, H - 0.25, -W / 2 + 0.6], group, null, false));
    for (let x = -L / 2 + 1.2; x < L / 2 - 0.6; x += 1.5) o.walls.ceiling.push(box(0.02, 0.25, 0.02, M.galv, [x, H - 0.12, -W / 2 + 0.6], group, null, false));
    for (const zz of [-W / 4, W / 4]) mesh(new THREE.PlaneGeometry(0.5, 0.3), std(0x2a3038, { metalness: 0.6 }), [X(L - 1.3), 0.008, zz], group, null, false).rotation.x = -Math.PI / 2;
    // Mallas (wire deck) bajo el nivel alto de cada rack
    const meshTex = canvasTex(64, 64, (g, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = '#c3ccd6'; g.lineWidth = 2; for (let i = 0; i <= w; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); } }, [6, 3]);
    const deckMat = new THREE.MeshStandardMaterial({ map: meshTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.4 });
    for (let j = 0; j < R.ny; j++) { const d = mesh(new THREE.PlaneGeometry(nB * pitch - 0.1, depth), deckMat, [X(x0 + (nB * pitch) / 2), yBeam1 + 0.06, Z((j + 0.5) * R.dy)], group, null, false); d.rotation.x = -Math.PI / 2; o.racks[j].push(d); }
    // Conductor del montacargas
    const drv = new THREE.Group(); drv.position.set(-0.2, 1.0, 0); fk.add(drv);
    mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.5, 12), std(0x2f6fb0), [0, 0.3, 0], drv, null);
    mesh(new THREE.SphereGeometry(0.11, 14, 10), std(0xd9a878), [0, 0.66, 0], drv, null);
    mesh(new THREE.SphereGeometry(0.125, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(0xf2f4f7), [0, 0.7, 0], drv, null);

    // ---- Mapa térmico (caja por zona con arista)
    o.heat = [];
    const hg = new THREE.BoxGeometry(R.dx * 0.94, R.dz * 0.94, R.dy * 0.94), he = new THREE.EdgesGeometry(hg);
    for (let z = 0; z < R.n; z++) {
      const zn = R.zones[z], m = new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.2, depthWrite: false, color: 0x0ca30c, toneMapped: false }));
      m.position.set(X(zn.x), zn.h, Z(zn.y)); m.userData.pick = { kind: 'zone', id: z }; m.renderOrder = 2;
      const e = new THREE.LineSegments(he, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35, toneMapped: false })); m.add(e); m.userData.edge = e;
      group.add(m); o.heat.push(m);
    }

    // ---- Partículas de flujo y de puerta
    const pts = (n, size) => {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const pp = new THREE.Points(g, new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false })); pp.frustumCulled = false; group.add(pp); return pp;
    };
    o.flow = pts(N_FLOW, 0.09);
    const LA = L - 1.6, LB = H - 1;
    o.loop = { LA, LB, loopLen: 2 * (LA + LB) };
    o.flowP = Array.from({ length: N_FLOW }, (_, i) => ({ j: i % R.ny, s: Math.random() * o.loop.loopLen, lat: Math.random() * 2 - 1, v: Math.random() }));
    o.doorPts = pts(N_DOOR * 2, 0.16);
    o.doorP = Array.from({ length: N_DOOR * 2 }, (_, i) => ({ inflow: i < N_DOOR, life: 0, x: 0, y: 0, h: 0 }));

    // ---- Sensores (cápsula + LED de estado)
    o.sensors = sensors.map((s) => {
      const zn = R.zones[s.zone];
      let x = s.i === 0 ? 0.5 : zn.x, y = zn.y + R.dy * 0.42, h = s.k ? H - 0.9 : 1.4;
      if (s.kind === 'supply') { x = L - 1.0; y = W / 2; h = H - 0.75; }
      if (s.kind === 'return') { x = L - 0.8; y = W / 2; h = 0.6; }
      const pk = { kind: 'sensor', id: s.id }, g = new THREE.Group(); g.position.set(X(x), h, Z(y)); group.add(g);
      box(0.1, 0.16, 0.06, M.white, [0, -0.13, 0], g, pk);
      const led = mesh(new THREE.SphereGeometry(0.075, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), [0, 0, 0], g, pk, false);
      const el = document.createElement('div'); el.className = 'lbl'; labels.appendChild(el);
      return { id: s.id, g, mesh: led, el };
    });

    const selBox = new THREE.Box3Helper(new THREE.Box3(), 0xe6edf3); selBox.visible = false; group.add(selBox); o.selBox = selBox;
    group.traverse((m) => { const k = m.userData.pick?.kind; if (m.isMesh && (k === 'door' || k === 'evap' || k === 'cond')) o.pickStatic.push(m); });
    W3 = o;
    setQuality(S.quality);
    applyVisibility();
    setView(S.view, true);
  }

  // ======================= Vistas, capas y calidad =======================
  function camTarget(view) {
    const { L, W, H } = W3.p;
    if (view === 'planta') return { pos: new THREE.Vector3(0, Math.max(L, W) * 1.9, 0.01), tgt: new THREE.Vector3(0, 0, 0) };
    if (view === 'seccion') return { pos: new THREE.Vector3(0, H * 0.55, W / 2 + L * 1.05), tgt: new THREE.Vector3(0, H * 0.45, 0) };
    return { pos: new THREE.Vector3(-L * 0.95, H * 2.1, W * 1.55), tgt: new THREE.Vector3(L * 0.05, H * 0.3, 0) };
  }
  function setView(v, instant = false) {
    S.view = v;
    if (!W3) return;
    const c = camTarget(v);
    if (instant) { camera.position.copy(c.pos); controls.target.copy(c.tgt); S.tween = null; }
    else S.tween = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: c.pos, t1: c.tgt };
    controls.enableRotate = v === '3d';
    applyVisibility();
  }
  function applyVisibility() {
    if (!W3) return;
    const v = S.view, R = W3.R, jd = R.jd, lay = S.layers;
    W3.walls.ceiling.forEach((m) => (m.visible = v === '3d'));
    W3.walls.right.forEach((m) => (m.visible = v !== 'seccion'));
    W3.edges.visible = v !== 'seccion';
    W3.racks.forEach((set, j) => set.forEach((im) => (im.visible = !(v === 'seccion' && j > jd))));
    W3.heat.forEach((m, z) => {
      const zn = R.zones[z];
      m.visible = lay.heat && !(v === 'seccion' && zn.j !== jd) && !(v === 'planta' && zn.k !== S.level);
      m.material.opacity = v === 'seccion' ? 0.45 : v === 'planta' ? 0.4 : 0.14;
      m.userData.edge.material.opacity = v === '3d' ? 0.22 : 0.4;
    });
    W3.flow.visible = lay.flow;
    W3.sensors.forEach((s) => { s.g.visible = lay.sensors; s.el.style.display = lay.sensors ? '' : 'none'; });
  }
  function setLayers(l) { Object.assign(S.layers, l); applyVisibility(); }
  function setLevel(k) { S.level = k; applyVisibility(); }
  function setQuality(q) {
    S.quality = q;
    const hi = q === 'high';
    renderer.shadowMap.enabled = hi; sun.castShadow = hi;
    renderer.setPixelRatio(hi ? Math.min(2, window.devicePixelRatio || 1) : 1);
    scene.environmentIntensity = hi ? 0.55 : 0.3;
    scene.traverse((m) => { if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => (x.needsUpdate = true)); });
    if (W3) W3.wraps.visible = hi;
    resize();
  }

  // ======================= Interacción =======================
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  let mouseIn = false, mx = 0, my = 0, lastPick = 0, hover = null, downAt = null;
  const el = renderer.domElement;
  el.addEventListener('pointermove', (e) => { const r = el.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; mouse.set((mx / r.width) * 2 - 1, -(my / r.height) * 2 + 1); mouseIn = true; });
  el.addEventListener('pointerleave', () => { mouseIn = false; hover = null; handlers.hover?.(null); });
  el.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  el.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    const hit = pick(); S.sel = hit; handlers.select?.(hit);
  });
  function pick() {
    if (!W3) return null;
    ray.setFromCamera(mouse, camera);
    const groups = [
      W3.sensors.filter((s) => s.g.visible).flatMap((s) => s.g.children),
      S.layers.pallets ? [W3.cartons] : [],
      W3.pickStatic,
      W3.heat.filter((m) => m.visible),
    ];
    for (const g of groups) {
      if (!g.length) continue;
      const hit = ray.intersectObjects(g, false)[0];
      if (!hit) continue;
      if (hit.object === W3.cartons) { const id = W3.palIds[Math.floor(hit.instanceId / CPP)]; if (id !== undefined) return { kind: 'pallet', id }; continue; }
      return hit.object.userData.pick || null;
    }
    return null;
  }

  // ======================= Actualización por cuadro =======================
  function palletPos(pal, R, p) {
    const s = pal.slot;
    if (pal.state === 'stored' || pal.progress === undefined) return { x: s.x, y: s.y, h: s.h, dir: 0 };
    const jd = R.jd, aisle = s.j < jd ? (s.j + 1) * R.dy : s.j * R.dy;
    const inside = [[0.2, p.W / 2, 0.15], [0.8, aisle, 0.15], [s.x, aisle, 0.15], [s.x, s.y, s.h]];
    const f = pal.progress;
    if (f < 0.3) return { x: -4 + (f / 0.3) * 4.2, y: p.W / 2, h: 0.15, dir: 0 };
    const g = (f - 0.3) / 0.7, seg = [];
    let tot = 0;
    for (let i = 1; i < inside.length; i++) { const d = Math.hypot(inside[i][0] - inside[i - 1][0], inside[i][1] - inside[i - 1][1]) + Math.abs(inside[i][2] - inside[i - 1][2]); seg.push(d); tot += d; }
    let d = g * tot;
    for (let i = 1; i < inside.length; i++) {
      if (d <= seg[i - 1] || i === inside.length - 1) {
        const t = Math.min(1, d / (seg[i - 1] || 1)), a = inside[i - 1], b = inside[i], dx = b[0] - a[0], dy = b[1] - a[1];
        return { x: a[0] + dx * t, y: a[1] + dy * t, h: a[2] + (b[2] - a[2]) * t, dir: Math.abs(dx) + Math.abs(dy) > 1e-3 ? Math.atan2(dy, dx) : null };
      }
      d -= seg[i - 1];
    }
    return { x: s.x, y: s.y, h: s.h, dir: 0 };
  }
  const setSRGB = (c, rgb) => c.setRGB(rgb[0], rgb[1], rgb[2], SRGB);

  function update(st, p, dtR, playing, speed) {
    if (!W3) return;
    S.t += dtR;
    const R = W3.R, { X, Z } = W3, off = p.alarmOffset, sp = p.sp, simK = playing ? Math.min(4, Math.sqrt(speed)) : 0, blink = Math.floor(S.t * 2) % 2 === 0;
    // Puerta, cortina y baliza
    W3.leaf.position.z = st.door.frac * W3.dw * 0.98;
    W3.beacon.material.emissive.set(st.door.cmd && blink ? 0xfab219 : 0x000000); W3.beacon.material.color.set(st.door.cmd ? 0xfab219 : 0x5a4a1a);
    W3.strips.forEach((s, i) => { s.visible = !!p.curtain; s.rotation.z = st.door.frac > 0.05 ? 0.06 * Math.sin(S.t * 3 + i * 0.7) * st.door.frac : 0; });
    // Evaporador: ventiladores, escarcha y LED de estado
    S.fanAngle += dtR * st.air.fanFrac * 18 * (playing ? 1 : 0);
    W3.blades.forEach((b, i) => { b.rotation.x = p.evapFail && i === 1 ? 0.3 : S.fanAngle + i; });
    const fr = Math.min(1, st.evap.frost / 150);
    W3.coil.material.color.setRGB(0.75 + 0.25 * fr, 0.78 + 0.22 * fr, 0.82 + 0.18 * fr);
    W3.evapBody.material.emissive.setRGB(0.02 * st.ctrl.u, 0.08 * st.ctrl.u, 0.18 * st.ctrl.u);
    W3.evapLed.material.color.set(p.evapFail ? (blink ? 0xd03b3b : 0x3a1515) : st.evap.defrostLeft > 0 ? 0xfab219 : st.ctrl.on ? 0x0ca30c : 0x3a4a5e);
    // Unidad condensadora: su ventilador gira con el compresor
    S.condAngle += dtR * (st.ctrl.on ? 14 : 0) * (playing ? 1 : 0);
    W3.condFan.rotation.y = S.condAngle;
    W3.condLed.material.color.set(p.refrigOn && st.ctrl.on ? 0x0ca30c : 0x3a4a5e);
    // Mapa térmico
    for (let z = 0; z < R.n; z++) { const c = heatRGB(st.T[z], sp, off); setSRGB(W3.heat[z].material.color, c); setSRGB(W3.heat[z].userData.edge.material.color, c); }
    // Pallets: tarima + 36 cartones (exteriores = superficie, interiores = núcleo) + film
    const parts = W3.palParts, cart = W3.cartons, wraps = W3.wraps;
    let n = 0; W3.palIds.length = 0;
    const hideCol = S.view === 'seccion' ? R.jd : 99;
    if (S.layers.pallets) for (const q of st.pallets) {
      if (q.slot.j > hideCol && q.state === 'stored') continue;
      if (S.view === 'planta' && q.state === 'stored' && q.slot.k !== S.level) continue;
      const ps = palletPos(q, R, p), bx = X(ps.x), by = ps.h, bz = Z(ps.y);
      for (let k = 0; k < PARTS.length; k++) { const a = PARTS[k]; tmpM.makeScale(a[3], a[4], a[5]); tmpM.setPosition(bx + a[0], by + a[1], bz + a[2]); parts.setMatrixAt(n * PARTS.length + k, tmpM); }
      for (let k = 0; k < CPP; k++) {
        const c = CARTONS[k], i = n * CPP + k;
        tmpM.makeTranslation(bx + c.x, by + c.y, bz + c.z); cart.setMatrixAt(i, tmpM);
        const rgb = heatRGB(q.Ts + (q.Tc - q.Ts) * c.d, sp, off), j = 0.88 + 0.14 * hash(q.id * 97 + k);
        cart.setColorAt(i, tmpC.setRGB(rgb[0] * j, rgb[1] * j, rgb[2] * j, SRGB));
      }
      tmpM.makeTranslation(bx, by, bz); wraps.setMatrixAt(n, tmpM);
      W3.palIds[n] = q.id; n++;
    }
    parts.count = n * PARTS.length; cart.count = n * CPP; wraps.count = n;
    parts.instanceMatrix.needsUpdate = true; cart.instanceMatrix.needsUpdate = true; wraps.instanceMatrix.needsUpdate = true;
    if (cart.instanceColor) cart.instanceColor.needsUpdate = true;
    // Montacargas: horquillas bajo el pallet en tránsito; ruedas giran según el avance
    if (st.forklift && st.forklift.pal) {
      const ps = palletPos(st.forklift.pal, R, p), fk = W3.fork;
      if (ps.dir !== null) W3.fkDir = ps.dir;
      const dir = W3.fkDir ?? 0;
      fk.visible = true;
      fk.position.set(X(ps.x) - Math.cos(dir) * 1.4, 0, Z(ps.y) - Math.sin(dir) * 1.4);
      fk.rotation.y = -dir;
      W3.carriage.position.y = ps.h - 0.02;
      if (W3.fkLast) { const d = Math.hypot(ps.x - W3.fkLast[0], ps.y - W3.fkLast[1]); W3.wheels.forEach((w) => (w.rotation.y += d / 0.23)); }
      W3.fkLast = [ps.x, ps.y];
      W3.fkBeacon.material.color.set(blink ? 0xfab219 : 0x4a3a0a);
    } else { W3.fork.visible = false; W3.fkLast = null; }
    W3.truck.visible = !!st.ingress;
    if (Math.floor(st.t / 5) !== W3.hmiLast) { // HMI: se redibuja cada 5 s simulados
      W3.hmiLast = Math.floor(st.t / 5);
      const g = W3.hmiCtx, al = st.alarms.active.length, T = st.kpi.Tavg;
      g.fillStyle = '#071018'; g.fillRect(0, 0, 256, 160);
      g.fillStyle = al ? '#d03b3b' : '#0ca30c'; g.fillRect(0, 0, 256, 22);
      g.fillStyle = '#fff'; g.font = 'bold 14px sans-serif'; g.fillText(al ? '⚠ ' + st.alarms.active[0].title : 'CÁMARA 01 · NORMAL', 8, 16);
      g.fillStyle = '#9fe3ff'; g.font = 'bold 48px monospace'; g.fillText(T.toFixed(1) + '°', 10, 80);
      g.font = '14px sans-serif'; g.fillStyle = '#c3c2b7'; g.fillText(`SP ${p.sp} °C   HR ${st.kpi.rh.toFixed(0)} %`, 10, 104);
      g.fillText(`Compresor ${st.ctrl.on ? Math.round(st.ctrl.u * 100) + ' %' : 'OFF'}`, 10, 124);
      g.fillText(`Puerta ${st.door.cmd ? 'ABIERTA' : 'cerrada'}`, 10, 144);
      g.strokeStyle = '#3987e5'; g.beginPath(); const h = st.hist.slice(-40); h.forEach((r, i) => { const x = 150 + i * 2.5, y = 110 - (r.Ta - p.sp) * 8; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
      W3.hmiTex.needsUpdate = true;
    }
    // Flujo de aire y puerta
    if (S.layers.flow) updateFlow(st, p, dtR * simK);
    updateDoorFlow(st, p, dtR * Math.max(simK, playing ? 1 : 0));
    // Sensores
    const rect = el.getBoundingClientRect();
    for (const s of W3.sensors) {
      const sd = st.sensors.find((x) => x.id === s.id);
      setSRGB(s.mesh.material.color, heatRGB(sd.T, sp, off));
      if (!S.layers.sensors) continue;
      tmpV.copy(s.g.position).project(camera);
      s.el.style.display = tmpV.z < 1 ? '' : 'none';
      s.el.style.transform = `translate(${((tmpV.x + 1) / 2) * rect.width + 10}px, ${((1 - tmpV.y) / 2) * rect.height - 10}px)`;
      s.el.textContent = `${sd.id} ${sd.T.toFixed(1)}°`;
      s.el.classList.toggle('on', S.sel?.kind === 'sensor' && S.sel.id === s.id);
    }
    updateSelection(st, p);
    if (mouseIn && performance.now() - lastPick > 60) {
      lastPick = performance.now();
      const h = pick();
      if (h?.kind !== hover?.kind || h?.id !== hover?.id) hover = h;
      handlers.hover?.(hover, mx, my);
    }
    if (S.tween) {
      const tw = S.tween; tw.t = Math.min(1, tw.t + dtR / 0.7); const e = 1 - Math.pow(1 - tw.t, 3);
      camera.position.lerpVectors(tw.p0, tw.p1, e); controls.target.lerpVectors(tw.t0, tw.t1, e);
      if (tw.t >= 1) S.tween = null;
    }
    controls.update();
    renderer.render(scene, camera);
  }

  function updateFlow(st, p, dts) {
    const o = W3, R = o.R, { LA, LB, loopLen } = o.loop, pos = o.flow.geometry.attributes.position.array, col = o.flow.geometry.attributes.color.array;
    const L = p.L, H = p.H, x0 = 0.6, x1 = L - 1.0;
    for (let i = 0; i < N_FLOW; i++) {
      const q = o.flowP[i], vcol = (st.air.col[q.j] / 1.25 / (R.dy * R.dz)) * 3;
      q.s = (q.s + vcol * dts) % loopLen;
      let x, h, s = q.s, zoneT;
      if (s < LA) { x = x1 - s; h = H - 0.5 + q.v * 0.35; }
      else if ((s -= LA) < LB) { x = x0; h = H - 0.5 - s; }
      else if ((s -= LB) < LA) { x = x0 + s; h = 0.3 + q.v * 1.0; }
      else { s -= LA; x = x1 + 0.2; h = 0.5 + s; }
      const y = (q.j + 0.5) * R.dy + q.lat * R.dy * 0.3;
      pos[i * 3] = o.X(x); pos[i * 3 + 1] = h; pos[i * 3 + 2] = o.Z(y);
      if (q.s < 1.2) zoneT = st.evapOut.Tsup;
      else { const zi = Math.min(R.nx - 1, Math.max(0, Math.floor(x / R.dx))); zoneT = st.T[R.zid(zi, q.j, h > H / 2 ? 1 : 0)]; }
      setSRGB(tmpC, heatRGB(zoneT, p.sp, p.alarmOffset));
      col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b;
    }
    o.flow.geometry.attributes.position.needsUpdate = true; o.flow.geometry.attributes.color.needsUpdate = true;
    o.flow.material.opacity = st.air.fanFrac > 0 ? 0.9 : 0.25;
  }

  function updateDoorFlow(st, p, dts) {
    const o = W3, pos = o.doorPts.geometry.attributes.position.array, col = o.doorPts.geometry.attributes.color.array;
    const f = st.door.frac, dw = o.dw * f * 0.95, dh = Math.min(p.doorH, p.H - 0.4), rate = (st.door.mInf / 0.9) * 60;
    const warm = setSRGB(new THREE.Color(), heatRGB(p.tExt, p.sp, p.alarmOffset)), cold = setSRGB(new THREE.Color(), heatRGB(st.T[o.R.doorZone], p.sp, p.alarmOffset));
    let spawn = rate * dts;
    for (let i = 0; i < o.doorP.length; i++) {
      const q = o.doorP[i];
      if (q.life <= 0 && spawn > 0 && f > 0.05 && Math.random() < spawn / 20) {
        spawn -= 1; q.life = 5; q.y = (Math.random() - 0.5) * dw;
        if (q.inflow) { q.x = -0.8 - Math.random() * 0.6; q.h = dh * (0.55 + Math.random() * 0.4); }
        else { q.x = 0.3 + Math.random() * 0.6; q.h = 0.1 + Math.random() * dh * 0.4; }
      }
      if (q.life > 0) {
        q.life -= dts; q.x += (q.inflow ? 1.1 : -1.1) * dts; if (q.inflow) q.h -= 0.12 * dts;
        pos[i * 3] = o.X(q.x); pos[i * 3 + 1] = q.h; pos[i * 3 + 2] = q.y;
        const c = q.inflow ? warm : cold; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      } else pos[i * 3 + 1] = -50;
    }
    o.doorPts.geometry.attributes.position.needsUpdate = true; o.doorPts.geometry.attributes.color.needsUpdate = true;
  }

  function updateSelection(st, p) {
    const b = W3.selBox, sel = S.sel;
    if (!sel) { b.visible = false; return; }
    const bx = b.box;
    if (sel.kind === 'pallet') {
      const q = st.pallets.find((x) => x.id === sel.id);
      if (!q) { b.visible = false; return; }
      const ps = palletPos(q, W3.R, p), x = W3.X(ps.x), z = W3.Z(ps.y);
      bx.min.set(x - 0.56, ps.h, z - 0.66); bx.max.set(x + 0.56, ps.h + PAL_H + CART.ny * CART.pitchY + 0.08, z + 0.66);
    } else if (sel.kind === 'sensor') { const s = W3.sensors.find((x) => x.id === sel.id); bx.setFromCenterAndSize(s.g.position, tmpV.set(0.5, 0.6, 0.5)); }
    else if (sel.kind === 'evap') bx.setFromObject(W3.evapBody);
    else if (sel.kind === 'door') bx.setFromObject(W3.leaf);
    else if (sel.kind === 'cond') bx.setFromObject(W3.cond);
    else if (sel.kind === 'zone') bx.setFromObject(W3.heat[sel.id]);
    b.visible = true;
  }

  function select(sel) { S.sel = sel; }
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
    camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);

  return { build, update, setView, setLayers, setLevel, setQuality, select, get view() { return S.view; }, get layers() { return S.layers; } };
}
