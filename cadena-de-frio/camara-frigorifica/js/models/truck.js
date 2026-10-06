// CAMIÓN FRIGORÍFICO RÍGIDO DE 2 EJES (≈12 t, caja isotérmica de 7,45 m) — modelo detallado + rig animado + conductor autónomo.
// Convenciones (unidades m, s, rad; Y arriba):
//   · Origen del grupo = suelo (y=0) bajo el CENTRO DEL EJE TRASERO; +X hacia delante (cabina), +Z = lado derecho (acompañante).
//   · Rumbo (heading) = atan2(dz, dx) en el plano XZ del mundo; group.rotation.y = −heading (misma convención que Path2 del kit).
//   · Cara trasera de la caja/puertas cerradas en x = TRUCK.XR (−3,15 m); topes de goma (punto más trasero) en TRUCK.REAR_MOST.
//   · Piso de carga a y = TRUCK.FLOOR (1,23 m). Dirección a la izquierda (conductor en −Z).
// API: createTruck(opts) → { group, rig, driver }, clases TruckRig / TruckDriver, demo(scene).
import { THREE, PI, TAU, rbox, roundRectPts, lathe, tire, T, canvas, tex, normalFrom, materials, clamp, lerp, smoothstep, smootherstep, wrapAngle, lag, spring, approach, Path2, hash, mergeGeometries } from './kit.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------- Cotas principales
const WB = 5.0, R = 0.5, TF = 1.02, TRO = 1.07, TRI = 0.76, XR = -3.15, XF = 4.30, W = 2.55, HW = W / 2, H = 3.78, YB = 1.08, FL = 1.23, CE = 3.66, CH = 1.15;
const PIN_X = XR - 0.04, PIN_Z = HW + 0.012, DY0 = 1.235, DY1 = 3.655, DT = 0.08, OPEN = (268 * PI) / 180, RODS = [0.3, 0.9];
const PB = new THREE.Vector3(2.4, 0.95, 0), PC = new THREE.Vector3(6.1, 0.95, 0), FAN = new THREE.Vector3(XF + 0.395, 3.4, -0.42);
export const TRUCK = { WB, R, XR, XF, W, H, FLOOR: FL, CEIL: CE, REAR_MOST: XR - 0.08, FRONT: 6.56, CAB_W: 2 * CH, BOX_LEN: XF - XR, TRACK_F: 2 * TF, PRE_STOP: 1.6 };

// ---------------------------------------------------------------- Utilidades de geometría
const V2 = (x, y) => new THREE.Vector2(x, y);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r1, r2, h, s = 16, open = false) => new THREE.CylinderGeometry(r1, r2, h, s, 1, open);
// Redondea esquinas de un polígono: pts = [[x, y, r], ...] (r = radio del acuerdo en ese vértice).
function fillet(pts, n = 5) {
  const out = [], N = pts.length;
  for (let i = 0; i < N; i++) {
    const [x, y, r = 0] = pts[i];
    if (!r) { out.push([x, y]); continue; }
    const a = pts[(i - 1 + N) % N], b = pts[(i + 1) % N], l1 = Math.hypot(a[0] - x, a[1] - y), l2 = Math.hypot(b[0] - x, b[1] - y), rr = Math.min(r, l1 * 0.45, l2 * 0.45);
    const p1 = [x + ((a[0] - x) / l1) * rr, y + ((a[1] - y) / l1) * rr], p2 = [x + ((b[0] - x) / l2) * rr, y + ((b[1] - y) / l2) * rr];
    for (let k = 0; k <= n; k++) { const t = k / n, q = 1 - t; out.push([q * q * p1[0] + 2 * q * t * x + t * t * p2[0], q * q * p1[1] + 2 * q * t * y + t * t * p2[1]]); }
  }
  return out;
}
const arc = (cx, cy, r, a0, a1, n = 8) => Array.from({ length: n + 1 }, (_, i) => { const a = lerp(a0, a1, i / n); return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
// Extrusión del perfil XY a lo largo de Z (centrada) con bisel redondeado que NO engorda el contorno.
function slab(pts, depth, bev = 0, o = {}) {
  const sh = new THREE.Shape(pts.map(([x, y]) => V2(x, y)));
  (o.holes || []).forEach((h) => sh.holes.push(new THREE.Path(h.map(([x, y]) => V2(x, y)))));
  const b = Math.min(bev, depth / 2 - 1e-4);
  const g = new THREE.ExtrudeGeometry(sh, { depth: depth - 2 * Math.max(0, b), steps: o.steps || 1, curveSegments: o.cs || 10, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: o.bs || 3 });
  g.translate(0, 0, -(depth - 2 * Math.max(0, b)) / 2); return g;
}
const alongX = (pts, len, bev, o) => slab(pts, len, bev, o).rotateY(-PI / 2); // perfil (z, y) extruido según X
const alongY = (pts, len, bev, o) => slab(pts, len, bev, o).rotateX(PI / 2);  // perfil (x, z) extruido según Y
const mirrorZ = (pts) => pts.map(([z, y]) => [-z, y]).reverse();
// Tubo por polilínea (aristas vivas) o curva suave.
function polyTube(pts, r, rs = 6, smooth = false) {
  const P = pts.map((p) => new THREE.Vector3(...p));
  if (smooth) return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(P, false, 'centripetal'), pts.length * 10, r, rs, false);
  const cp = new THREE.CurvePath(); for (let i = 1; i < P.length; i++) cp.add(new THREE.LineCurve3(P[i - 1], P[i]));
  return new THREE.TubeGeometry(cp, (P.length - 1) * 2, r, rs, false);
}
// Panel rectangular redondeado y subdividido (vidrios curvos): f(a, b) → [x, y, z]; a ∈ [−hw, hw], b ∈ [0, h].
function panel(hw, h, r, f, nu = 26, nv = 4) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= nu; i++) {
    const a = -Math.cos((i / nu) * PI) * hw, dz = Math.max(0, Math.abs(a) - (hw - r)), off = r - Math.sqrt(Math.max(0, r * r - dz * dz));
    for (let j = 0; j <= nv; j++) { pos.push(...f(a, lerp(off, h - off, j / nv))); uv.push(i / nu, j / nv); }
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const k = i * (nv + 1) + j; idx.push(k, k + 1, k + nv + 1, k + 1, k + nv + 2, k + nv + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
// Ballesta parabólica: n hojas apiladas entre x0..x1 (ojos a yE, centro a yM) en z.
function leaf(x0, x1, yE, yM, z, n = 3, t = 0.018) {
  const xc = (x0 + x1) / 2, hl = (x1 - x0) / 2, out = [];
  for (let k = 0; k < n; k++) {
    const sh = 1 - k * 0.2, top = [], bot = [];
    for (let i = 0; i <= 14; i++) { const x = xc + (i / 7 - 1) * hl * sh, q = ((x - xc) / hl) ** 2, y = yM - k * (t + 0.001) + (yE - yM) * q; top.push([x, y]); bot.push([x, y - t]); }
    out.push([slab([...top, ...bot.reverse()], 0.075), T(0, 0, z)]);
  }
  return out;
}
// Agrupa geometrías por material y las fusiona: 1 malla por material y grupo.
class Bin {
  constructor() { this.m = new Map(); }
  p(mat, geo, mtx) { let l = this.m.get(mat); if (!l) this.m.set(mat, (l = [])); l.push([geo, mtx]); return this; }
  build(parent, bend = null, crease = 0.6) {
    const out = [];
    for (const [mat, l] of this.m) {
      let g = mergeGeometries(l.map(([g0, m]) => {
        const c = g0.index ? g0.toNonIndexed() : g0.clone();
        for (const k of Object.keys(c.attributes)) if (!['position', 'normal', 'uv'].includes(k)) c.deleteAttribute(k);
        if (!c.attributes.uv) c.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(c.attributes.position.count * 2), 2));
        if (!c.attributes.normal) c.computeVertexNormals();
        c.morphAttributes = {}; c.clearGroups(); if (m) c.applyMatrix4(m); return c;
      }));
      if (bend) { bend(g); g = toCreasedNormals(g, crease); }
      const mesh = new THREE.Mesh(g, mat); mesh.castShadow = !mat.transparent; mesh.receiveShadow = true; parent.add(mesh); out.push(mesh);
    }
    this.m.clear(); return out;
  }
}
// Abombado en planta del frontal de la cabina (parabrisas, rejilla y faros siguen la misma curva).
const BULGE = 0.075;
function bendCab(g) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setX(i, x + BULGE * Math.max(0, 1 - (z / CH) ** 2) * smoothstep((x - 5.7) / 0.6)); }
  p.needsUpdate = true;
}

// ---------------------------------------------------------------- Texturas (rotulación genérica, sin marcas reales)
const _tx = new Map();
const ctex = (key, w, h, draw, srgb = true) => { if (!_tx.has(key)) _tx.set(key, tex(canvas(w, h, draw), [1, 1], srgb)); return _tx.get(key); };
function flake(g, x, y, r, col, lw) {
  g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round';
  for (let k = 0; k < 6; k++) {
    const a = (k * PI) / 3, c = Math.cos(a), s = Math.sin(a); g.beginPath(); g.moveTo(x, y); g.lineTo(x + c * r, y + s * r); g.stroke();
    for (const f of [0.45, 0.72]) { const bx = x + c * r * f, by = y + s * r * f, l = r * 0.26 * (1.1 - f * 0.5); for (const d of [-1, 1]) { const b = a + d * 0.75; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(b) * l, by + Math.sin(b) * l); g.stroke(); } }
  }
}
function andes(g, x0, x1, base, hMax, seed, back, front) {
  for (const [col, sc, sd] of [[back, 1, seed], [front, 0.68, seed + 50]]) {
    let x = x0 - 40, i = 0;
    while (x < x1) {
      const hw = 90 + hash(sd + i) * 150, ht = hMax * sc * (0.55 + 0.45 * hash(sd + i * 3)), cx = x + hw * 0.8;
      g.fillStyle = col; g.beginPath(); g.moveTo(cx - hw, base); g.lineTo(cx, base - ht); g.lineTo(cx + hw, base); g.closePath(); g.fill();
      g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(cx - hw * 0.3, base - ht * 0.7); g.lineTo(cx, base - ht); g.lineTo(cx + hw * 0.3, base - ht * 0.7);
      g.lineTo(cx + hw * 0.14, base - ht * 0.64); g.lineTo(cx + hw * 0.02, base - ht * 0.73); g.lineTo(cx - hw * 0.12, base - ht * 0.63); g.closePath(); g.fill();
      x += hw * (1.1 + hash(sd + i * 7) * 0.5); i++;
    }
  }
}
function tape(g, x0, y0, x1, y1, w, c1, c2, seg) { // banda retrorreflectante segmentada
  const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.floor(L / seg));
  for (let i = 0; i < n; i++) { const t0 = i / n, t1 = (i + 0.78) / n; g.strokeStyle = i % 2 ? c2 : c1; g.lineWidth = w; g.lineCap = 'butt'; g.beginPath(); g.moveTo(lerp(x0, x1, t0), lerp(y0, y1, t0)); g.lineTo(lerp(x0, x1, t1), lerp(y0, y1, t1)); g.stroke(); }
}
const sideTex = (name) => ctex('side' + name, 2048, 704, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#fbfcfd'); gr.addColorStop(1, '#eef2f5'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  andes(g, 0, w * 0.5, h * 0.9, h * 0.5, 7, '#7fb6e0', '#1f5f9c');
  const sw = g.createLinearGradient(0, 0, w, 0); sw.addColorStop(0, '#123a66'); sw.addColorStop(0.6, '#1f6fb2'); sw.addColorStop(1, '#2aa7df'); g.fillStyle = sw;
  g.beginPath(); g.moveTo(0, h * 0.9); g.bezierCurveTo(w * 0.35, h * 0.92, w * 0.6, h * 0.8, w, h * 0.62); g.lineTo(w, h * 0.74); g.bezierCurveTo(w * 0.62, h * 0.9, w * 0.4, h * 0.97, 0, h * 0.97); g.closePath(); g.fill();
  flake(g, w * 0.3, h * 0.33, h * 0.17, '#2aa7df', 15);
  g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = '#123a66'; g.font = 'italic 900 176px Arial, "DejaVu Sans", sans-serif'; g.fillText(name, w * 0.39, h * 0.4);
  g.fillStyle = '#1f6fb2'; g.font = 'bold 50px Arial, "DejaVu Sans", sans-serif'; g.fillText('CADENA DE FRÍO · DISTRIBUCIÓN REFRIGERADA', w * 0.395, h * 0.53);
  g.fillStyle = '#2aa7df'; g.beginPath(); g.roundRect?.(w * 0.395, h * 0.585, 470, 64, 32); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 40px Arial, sans-serif'; g.fillText('−25 °C  ···  +12 °C', w * 0.395 + 38, h * 0.585 + 46);
  g.fillStyle = '#33475b'; g.font = '600 30px Arial, sans-serif'; g.fillText('Temperatura controlada · registro continuo', w * 0.64, h * 0.67);
  g.fillStyle = '#fff'; g.fillRect(w * 0.94, h * 0.06, 90, 60); g.strokeStyle = '#1f2a36'; g.lineWidth = 4; g.strokeRect(w * 0.94, h * 0.06, 90, 60); g.fillStyle = '#1f2a36'; g.font = 'bold 22px Arial'; g.fillText('ATP', w * 0.94 + 24, h * 0.06 + 27); g.fillText('FRC', w * 0.94 + 22, h * 0.06 + 52);
  tape(g, 6, h - 10, w - 6, h - 10, 14, '#f2c200', '#f2c200', 120); tape(g, 8, 6, 8, 160, 14, '#f2c200', '#f2c200', 70); tape(g, 6, 8, 170, 8, 14, '#f2c200', '#f2c200', 70); tape(g, w - 8, 6, w - 8, 160, 14, '#f2c200', '#f2c200', 70); tape(g, w - 170, 8, w - 6, 8, 14, '#f2c200', '#f2c200', 70);
});
const rearTex = (name) => ctex('rear' + name, 1024, 1024, (g, w, h) => {
  g.fillStyle = '#f6f8f9'; g.fillRect(0, 0, w, h);
  andes(g, 0, w, h * 0.86, h * 0.2, 21, '#9cc7e8', '#2a6aa8');
  g.fillStyle = '#123a66'; g.fillRect(0, h * 0.86, w, h * 0.04); g.fillStyle = '#2aa7df'; g.fillRect(0, h * 0.9, w, h * 0.012);
  flake(g, w * 0.5, h * 0.2, 90, '#2aa7df', 12);
  g.textAlign = 'center'; g.fillStyle = '#123a66'; g.font = 'italic 900 96px Arial, "DejaVu Sans", sans-serif'; g.fillText(name, w * 0.5, h * 0.42);
  g.fillStyle = '#1f6fb2'; g.font = 'bold 34px Arial, sans-serif'; g.fillText('TRANSPORTE REFRIGERADO', w * 0.5, h * 0.48);
  g.fillStyle = '#33475b'; g.font = '600 26px Arial, sans-serif'; g.fillText('Puertas 270° · no estacionar detrás', w * 0.5, h * 0.535);
  tape(g, 10, 10, w - 10, 10, 18, '#d01818', '#f4f4f4', 90); tape(g, 10, 10, 10, h - 10, 18, '#d01818', '#f4f4f4', 90); tape(g, w - 10, 10, w - 10, h - 10, 18, '#d01818', '#f4f4f4', 90); tape(g, 10, h - 12, w - 10, h - 12, 18, '#d01818', '#f4f4f4', 90);
});
const plateTex = (txt) => ctex('plate' + txt, 512, 256, (g, w, h) => {
  g.fillStyle = '#f7f7f2'; g.fillRect(0, 0, w, h); g.fillStyle = '#1d4f91'; g.fillRect(0, 0, w, 52); g.fillStyle = '#fff'; g.font = 'bold 34px Arial, sans-serif'; g.textAlign = 'center'; g.fillText('CARGA · FRÍO', w / 2, 38);
  g.strokeStyle = '#111'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10); g.fillStyle = '#111'; g.font = 'bold 128px "DejaVu Sans Mono", monospace'; g.fillText(txt, w / 2, 200);
});
const dispTex = () => ctex('disp', 256, 96, (g, w, h) => {
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.fillStyle = '#3dff7a'; g.font = 'bold 54px "DejaVu Sans Mono", monospace'; g.textAlign = 'left'; g.fillText('-18.0', 12, 62); g.font = 'bold 26px Arial'; g.fillText('°C', 186, 40);
  g.fillStyle = '#ffb000'; g.fillRect(14, 74, 18, 12); g.fillStyle = '#3dff7a'; g.fillRect(40, 74, 18, 12); g.fillRect(66, 74, 18, 12);
});
const unitTex = () => ctex('unit', 512, 128, (g, w, h) => { g.fillStyle = '#eef1f3'; g.fillRect(0, 0, w, h); g.fillStyle = '#123a66'; g.font = 'italic 900 58px Arial, sans-serif'; g.textAlign = 'left'; g.fillText('ANDES·COOL', 16, 70); g.fillStyle = '#2aa7df'; g.font = 'bold 30px Arial'; g.fillText('FA-700  MT', 20, 112); });

// ---------------------------------------------------------------- Materiales (instancia propia: las luces cambian por camión)
function makeMats(o) {
  const K = materials(), std = (p) => new THREE.MeshStandardMaterial(p), phy = (p) => new THREE.MeshPhysicalMaterial(p);
  const lamp = (c, e) => std({ color: c, emissive: e, emissiveIntensity: 0, roughness: 0.22, metalness: 0.05 });
  const fins = canvas(64, 64, (g, w, h) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 2, h); g.fillStyle = '#222'; for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 2); });
  const tread = canvas(64, 64, (g, w, h) => { g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) { const o = (y / 16) % 2 ? 8 : 0; g.save(); g.translate(x + o + 4, y + 4); g.rotate((y / 16) % 2 ? 0.8 : -0.8); g.fillRect(-5, -1.5, 10, 3); g.restore(); } });
  const m = {
    cab: phy({ color: o.cabColor ?? 0x1d4f91, roughness: 0.3, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.06, roughnessMap: K.roughT }),
    trim: std({ color: 0x16181b, roughness: 0.5, metalness: 0.08 }),
    liner: std({ color: 0x131518, roughness: 0.9, side: THREE.DoubleSide }), chassis: std({ color: 0x1b1e21, roughness: 0.5, metalness: 0.45 }),
    glass: phy({ color: 0x0b121a, roughness: 0.03, metalness: 0.25, clearcoat: 1, envMapIntensity: 1.6 }),
    lensGlass: phy({ color: 0xe8f0f8, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false }),
    mirror: std({ color: 0xe6edf3, roughness: 0.02, metalness: 1 }),
    grp: phy({ color: 0xf2f4f5, roughness: 0.3, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.25 }),
    side: phy({ map: sideTex(o.company), roughness: 0.32, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.25 }),
    rear: phy({ map: rearTex(o.company), roughness: 0.32, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.25 }),
    inner: std({ color: 0xe6ebee, roughness: 0.55 }),
    alu: K.alu, steel: K.steel, chrome: K.chrome, galv: K.galv, tire: K.rubber, red: K.paintRed, refl: K.reflective,
    tread: std({ color: 0xbfc6cd, roughness: 0.35, metalness: 0.85, normalMap: normalFrom(tread, 4, [10, 1]) }),
    gasket: std({ color: 0x0e0f10, roughness: 0.88 }),
    rim: std({ color: 0xd2d7dc, roughness: 0.32, metalness: 0.7, side: THREE.DoubleSide }),
    coil: std({ color: 0x4a525a, roughness: 0.55, metalness: 0.7, normalMap: normalFrom(fins, 3, [40, 10]) }),
    fan: std({ color: 0x1a1c1f, roughness: 0.5, side: THREE.DoubleSide }),
    display: std({ color: 0x050805, emissive: 0xffffff, emissiveMap: dispTex(), emissiveIntensity: 1.2, roughness: 0.2 }),
    unit: std({ map: unitTex(), roughness: 0.4 }), plate: std({ map: plateTex(o.plate), roughness: 0.35, metalness: 0.25 }),
    head: lamp(0xeef2fa, 0xfff3dc), tail: lamp(0x8f0d0d, 0xff1608), brake: lamp(0x9c1010, 0xff2010), rev: lamp(0xe8eaec, 0xffffff),
    indL: lamp(0xd08a1c, 0xff8a00), indR: lamp(0xd08a1c, 0xff8a00), marker: lamp(0xd08a1c, 0xff8a00), markerW: lamp(0xf2f2f2, 0xffffff), interior: lamp(0xe8eef6, 0xeef4ff),
  };
  // alias: materiales casi iguales se comparten para reducir mallas/draw calls
  return Object.assign(m, { black: m.trim, hub: m.chassis, reefer: m.grp, fabric: m.inner, blue: m.cab, galv: m.steel, fog: m.red });
}

// ---------------------------------------------------------------- Ruedas (eje = Z, cara exterior hacia +Z)
function wheelParts() {
  const t = tire(R, 0.28, 0.29, 30).clone().rotateY(PI / 2);
  const rimP = [[0.302, 0.096], [0.296, 0.101], [0.284, 0.094], [0.284, 0.05], [0.262, 0.036], [0.255, -0.02], [0.284, -0.05], [0.284, -0.094], [0.296, -0.101], [0.302, -0.096],
    [0.29, -0.09], [0.272, -0.05], [0.243, -0.02], [0.25, 0.034], [0.272, 0.05], [0.274, 0.085], [0.255, 0.09], [0.205, 0.1], [0.17, 0.114], [0.135, 0.118], [0.118, 0.112], [0.118, 0.1]];
  const rimG = lathe(rimP, 40).rotateX(PI / 2);
  const hub = [[lathe([[0.001, 0.19], [0.045, 0.188], [0.07, 0.172], [0.085, 0.15], [0.1, 0.13], [0.12, 0.122], [0.12, 0.1]], 28).rotateX(PI / 2), null]];
  for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; hub.push([cyl(0.017, 0.017, 0.03, 6), T(Math.cos(a) * 0.1675, Math.sin(a) * 0.1675, 0.13, PI / 2)]); }
  for (let i = 0; i < 6; i++) { const a = ((i + 0.5) / 6) * TAU; hub.push([cyl(0.034, 0.034, 0.006, 14), T(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.108, PI / 2)]); } // agujeros de ventilación (oscuros)
  return { tire: t, rim: rimG, hub };
}

// ---------------------------------------------------------------- Construcción del modelo
function build(o) {
  const M = makeMats(o), root = new THREE.Group(); root.name = 'truck';
  const unsprung = new THREE.Group(), body = new THREE.Group(), bodyIn = new THREE.Group(), cab = new THREE.Group(), cabIn = new THREE.Group();
  root.add(unsprung, body); body.position.copy(PB); body.add(bodyIn); bodyIn.position.copy(PB).negate();
  bodyIn.add(cab); cab.position.copy(PC); cab.add(cabIn); cabIn.position.copy(PC).negate();
  const B = new Bin(), C = new Bin(), U = new Bin();

  // ===== CABINA (volcable) =====
  const ar = []; for (let i = 0; i <= 12; i++) { const a = lerp(104.4, 30, i / 12) * (PI / 180); ar.push([5.0 + 0.64 * Math.cos(a), 0.5 + 0.64 * Math.sin(a)]); }
  const prof = fillet([[4.4, 1.12, 0.05], ...ar, [6.34, 0.82, 0.06], [6.42, 1.0, 0.1], [6.43, 1.62, 0.06], [6.39, 1.8, 0.05], [6.23, 2.7, 0.14], [6.05, 2.9, 0.14], [5.85, 2.95, 0.12], [4.5, 2.96, 0.1], [4.4, 2.86, 0.06]], 5);
  C.p(M.cab, slab(prof, 2 * CH, 0.11, { steps: 16, bs: 5, cs: 6 }));
  // parabrisas curvo (sigue el abombado del frontal) + marco negro serigrafiado
  const ws = (off) => (a, b) => { const L = Math.hypot(0.16, 0.9), f = b / L; return [6.39 - 0.16 * f + 0.985 * off, 1.8 + 0.9 * f + 0.175 * off, a]; };
  { const L = Math.hypot(0.16, 0.9); C.p(M.black, panel(1.07, L - 0.04, 0.1, (a, b) => ws(0.004)(a, b + 0.02))); C.p(M.glass, panel(1.0, L - 0.16, 0.07, (a, b) => ws(0.008)(a, b + 0.08))); }
  // limpiaparabrisas aparcados
  for (const [a0, a1] of [[-0.98, -0.12], [0.02, 0.86]]) { const p0 = ws(0.03)(a0, 0.1), p1 = ws(0.03)(a1, 0.13); C.p(M.black, polyTube([p0, p1], 0.008, 5)); C.p(M.black, box(0.012, 0.016, Math.abs(a1 - a0) * 0.9), T((p0[0] + p1[0]) / 2 + 0.012, (p0[1] + p1[1]) / 2 + 0.01, (a0 + a1) / 2)); C.p(M.trim, cyl(0.025, 0.025, 0.04, 10), T(p0[0] - 0.01, p0[1] - 0.04, a0, 0, 0, PI / 2)); }
  // ventanillas laterales, juntas de puerta, manillas, asideros
  const winO = fillet([[4.74, 1.82, 0.07], [6.24, 1.82, 0.05], [6.09, 2.72, 0.08], [4.74, 2.72, 0.07]], 4), winI = fillet([[4.78, 1.86, 0.05], [6.18, 1.86, 0.04], [6.04, 2.68, 0.06], [4.78, 2.68, 0.05]], 4);
  for (const s of [-1, 1]) {
    C.p(M.black, slab(winO, 0.008), T(0, 0, s * (CH + 0.002))); C.p(M.glass, slab(winI, 0.01), T(0, 0, s * (CH + 0.005)));
    const z = s * (CH + 0.004);
    C.p(M.black, polyTube([[4.62, 1.17, z], [4.62, 2.84, z], [6.06, 2.84, z], [6.27, 1.84, z], [6.31, 1.17, z], [4.62, 1.17, z]], 0.006, 4));
    C.p(M.black, polyTube([[6.31, 1.17, z], [6.33, 0.84, z]], 0.006, 4));
    C.p(M.black, rbox(0.22, 0.05, 0.03, 0.012), T(4.86, 1.66, s * (CH + 0.006))); C.p(M.chrome, cyl(0.012, 0.012, 0.012, 10), T(4.74, 1.66, s * (CH + 0.018), PI / 2));
    C.p(M.black, polyTube([[4.48, 1.3, s * CH], [4.48, 1.32, s * (CH + 0.05)], [4.48, 2.5, s * (CH + 0.05)], [4.48, 2.52, s * CH]], 0.016, 6, true));
    // estribos delante de la rueda (bandeja de aluminio estriado + soporte negro)
    C.p(M.tread, rbox(0.46, 0.03, 0.22, 0.01), T(5.94, 0.56, s * 1.03)); C.p(M.tread, rbox(0.44, 0.03, 0.16, 0.01), T(5.94, 0.98, s * (CH + 0.04)));
    for (const x of [5.72, 6.16]) C.p(M.trim, box(0.03, 0.32, 0.22), T(x, 0.69, s * 1.03));
    C.p(M.trim, box(0.46, 0.04, 0.2), T(5.94, 0.85, s * 1.05));
    C.p(s < 0 ? M.indL : M.indR, rbox(0.1, 0.035, 0.02, 0.008), T(5.62, 1.02, s * (CH + 0.008))); // repetidor lateral
    // pasos de rueda (guardabarros interior)
    C.p(M.liner, cyl(0.6, 0.6, 0.3, 22, true).rotateX(PI / 2), T(5.0, 0.5, s * 1.0));
    // retrovisores: brazo tubular + espejo principal + gran angular
    const zm = s * 1.42;
    C.p(M.black, polyTube([[6.1, 2.56, s * CH], [6.3, 2.64, s * 1.38], [6.31, 2.56, zm], [6.31, 1.86, zm], [6.2, 1.82, s * CH]], 0.016, 6, true));
    C.p(M.black, rbox(0.1, 0.42, 0.25, 0.035), T(6.33, 2.33, zm + s * 0.05, 0, s * 0.1)); C.p(M.mirror, box(0.004, 0.37, 0.21), T(6.279, 2.33, zm + s * 0.05, 0, s * 0.1));
    C.p(M.black, rbox(0.1, 0.2, 0.23, 0.035), T(6.33, 2.01, zm + s * 0.05, 0, s * 0.1)); C.p(M.mirror, box(0.004, 0.16, 0.19), T(6.279, 2.01, zm + s * 0.05, 0, s * 0.1));
    // faros (carcasa, reflectores, proyectores, luz diurna) + intermitente esquinero
    const zl = s * 0.8;
    C.p(M.black, rbox(0.11, 0.21, 0.44, 0.035), T(6.39, 0.965, zl));
    C.p(M.chrome, box(0.005, 0.17, 0.4), T(6.424, 0.965, zl));
    for (const dz of [-0.1, 0.08]) { C.p(M.chrome, lathe([[0.001, -0.03], [0.04, -0.025], [0.065, 0.0], [0.07, 0.012]], 18).rotateZ(-PI / 2), T(6.43, 0.95, zl + s * dz)); C.p(M.head, cyl(0.026, 0.026, 0.02, 14).rotateZ(PI / 2), T(6.43, 0.95, zl + s * dz)); }
    C.p(M.head, rbox(0.012, 0.022, 0.36, 0.006), T(6.448, 1.045, zl));
    C.p(M.lensGlass, rbox(0.02, 0.19, 0.42, 0.01), T(6.452, 0.965, zl));
    C.p(s < 0 ? M.indL : M.indR, rbox(0.07, 0.12, 0.09, 0.025), T(6.37, 0.965, s * 1.09));
    C.p(M.marker, rbox(0.06, 0.03, 0.08, 0.01), T(6.0, 2.96, s * 0.95)); // luces de gálibo en techo
  }
  // rejilla con lamas, marco cromado, emblema genérico
  C.p(M.chrome, alongX(roundRectPts(1.56, 0.52, 0.07, 4), 0.045, 0, { holes: [roundRectPts(1.46, 0.42, 0.05, 4).reverse()] }), T(6.452, 1.37, 0));
  C.p(M.black, box(0.012, 0.44, 1.48), T(6.436, 1.37, 0));
  for (let i = 0; i < 5; i++) { C.p(M.trim, rbox(0.03, 0.045, 1.44, 0.01), T(6.457, 1.21 + i * 0.08, 0, 0, 0, -0.15)); C.p(M.chrome, box(0.01, 0.008, 1.44), T(6.473, 1.235 + i * 0.08, 0)); }
  C.p(M.chrome, lathe([[0.001, 0.02], [0.05, 0.015], [0.065, 0], [0.065, -0.01]], 24).rotateZ(-PI / 2), T(6.462, 1.715, 0));
  C.p(M.trim, alongX(fillet([[-1.0, 1.0, 0.03], [1.0, 1.0, 0.03], [1.0, 1.06, 0.03], [-1.0, 1.06, 0.03]], 3), 0.03, 0), T(6.43, 0, 0));
  // visera parasol, deflector de techo, antena
  C.p(M.trim, slab(fillet([[6.04, 2.93, 0.02], [6.47, 2.86, 0.02], [6.48, 2.83, 0.01], [6.08, 2.88, 0.02]], 3), 2.04, 0.01, { steps: 10 }));
  C.p(M.cab, slab(fillet([[5.75, 2.94, 0.04], [4.98, 3.13, 0.08], [4.86, 3.13, 0.04], [4.86, 2.94, 0]], 4), 1.94, 0.05, { steps: 4 }));
  C.p(M.black, cyl(0.006, 0.01, 0.6, 6), T(4.62, 3.25, -0.95));
  // espejo frontal de rampa (lado acompañante)
  C.p(M.black, polyTube([[6.0, 2.95, 0.88], [6.3, 3.02, 0.95], [6.5, 3.0, 0.98]], 0.012, 6, true)); C.p(M.black, rbox(0.24, 0.06, 0.28, 0.025), T(6.54, 2.96, 0.98, 0, 0, -0.5));
  // trasera de cabina: soportes de suspensión y bisagras delanteras
  for (const s of [-1, 1]) { C.p(M.chassis, box(0.1, 0.05, 0.16), T(4.48, 1.11, s * 0.42)); C.p(M.chassis, box(0.12, 0.08, 0.14), T(6.08, 0.86, s * 0.42)); }

  // ===== BASTIDOR (suspendido) =====
  const railR = [[0.435, 0.73], [0.435, 0.98], [0.365, 0.98], [0.365, 0.971], [0.426, 0.971], [0.426, 0.739], [0.365, 0.739], [0.365, 0.73]];
  B.p(M.chassis, alongX(railR, 9.15), T(1.575)); B.p(M.chassis, alongX(mirrorZ(railR), 9.15), T(1.575));
  for (const x of [-2.96, -1.4, 0.9, 2.6, 4.2, 5.9]) B.p(M.chassis, box(0.09, 0.2, 0.73), T(x, 0.855, 0));
  for (const s of [-1, 1]) B.p(M.chassis, box(7.3, 0.1, 0.09), T(0.55, 1.03, s * 0.4)); // largueros del subchasis
  for (let x = -2.9; x < 4.2; x += 0.55) if (Math.abs(x) > 0.72) B.p(M.chassis, box(0.06, 0.07, 2.42), T(x, 1.04, 0)); // travesaños del piso
  // motor, caja de cambios, depósitos, baterías, escape
  B.p(M.hub, rbox(1.2, 0.55, 0.66, 0.06), T(5.45, 0.86, 0)); B.p(M.hub, rbox(0.9, 0.14, 0.5, 0.04), T(5.4, 0.52, 0));
  B.p(M.hub, lathe([[0.001, 0], [0.21, 0], [0.2, 0.3], [0.14, 0.7], [0.07, 0.8], [0.001, 0.8]], 18).rotateZ(PI / 2), T(4.82, 0.8, 0));
  const tank = lathe([[0.001, -0.65], [0.2, -0.65], [0.26, -0.62], [0.28, -0.56], [0.28, 0.56], [0.26, 0.62], [0.2, 0.65], [0.001, 0.65]], 30).rotateZ(-PI / 2);
  B.p(M.alu, tank, T(3.05, 0.62, -0.77));
  for (const x of [2.68, 3.42]) { B.p(M.galv, lathe([[0.283, -0.02], [0.292, -0.02], [0.292, 0.02], [0.283, 0.02]], 30).rotateZ(-PI / 2), T(x, 0.62, -0.77)); B.p(M.chassis, box(0.05, 0.3, 0.08), T(x, 0.85, -0.47)); }
  B.p(M.alu, cyl(0.045, 0.045, 0.1, 16), T(3.5, 0.92, -0.77)); B.p(M.steel, cyl(0.055, 0.055, 0.03, 16), T(3.5, 0.98, -0.77));
  B.p(M.grp, rbox(0.36, 0.42, 0.32, 0.05), T(2.12, 0.68, -0.8)); B.p(M.blue, cyl(0.045, 0.045, 0.04, 14), T(2.12, 0.91, -0.8));
  B.p(M.black, rbox(0.72, 0.44, 0.52, 0.03), T(3.05, 0.7, 0.75)); for (let i = 0; i < 6; i++) B.p(M.trim, box(0.03, 0.02, 0.5), T(2.78 + i * 0.11, 0.93, 0.75));
  for (const z of [0.6, 0.9]) B.p(M.chassis, lathe([[0.001, -0.42], [0.08, -0.42], [0.115, -0.38], [0.12, -0.3], [0.12, 0.3], [0.115, 0.38], [0.08, 0.42], [0.001, 0.42]], 20).rotateZ(-PI / 2), T(1.7, 0.86, z));
  B.p(M.galv, rbox(0.66, 0.38, 0.44, 0.1), T(4.0, 0.6, 0.78));
  B.p(M.galv, polyTube([[4.85, 0.7, 0.25], [4.6, 0.62, 0.55], [4.34, 0.6, 0.72]], 0.05, 10, true)); B.p(M.galv, polyTube([[3.68, 0.55, 0.88], [3.45, 0.45, 1.0], [3.38, 0.3, 1.04]], 0.045, 10, true));
  // ballestas, soportes y amortiguadores
  for (const s of [-1, 1]) {
    leaf(4.28, 5.72, 0.74, 0.6, s * 0.4, 3).forEach(([g, m]) => B.p(M.chassis, g, m)); leaf(-0.78, 0.78, 0.74, 0.66, s * 0.4, 4).forEach(([g, m]) => B.p(M.chassis, g, m));
    for (const x of [4.28, 5.72, -0.78, 0.78]) { B.p(M.chassis, box(0.08, 0.1, 0.08), T(x, 0.73, s * 0.4)); B.p(M.steel, cyl(0.022, 0.022, 0.09, 10).rotateX(PI / 2), T(x, 0.74, s * 0.4)); }
    B.p(M.hub, polyTube([[4.65, 0.92, s * 0.47], [4.85, 0.5, s * 0.55]], 0.03, 8)); B.p(M.hub, polyTube([[-0.3, 0.92, s * 0.47], [-0.15, 0.5, s * 0.55]], 0.032, 8));
    // guardabarros traseros, faldillas, faldilla delantera
    const fen = [...arc(0, 0, 0.58, PI * 0.1, PI * 0.9, 16), ...arc(0, 0, 0.565, PI * 0.9, PI * 0.1, 16)];
    B.p(M.trim, slab(fen, 0.68), T(0, 0.5, s * 0.915)); B.p(M.gasket, rbox(0.015, 0.46, 0.64, 0.005), T(-0.565, 0.43, s * 0.915)); B.p(M.trim, box(0.04, 0.4, 0.04), T(0, 0.9, s * 0.62));
    B.p(M.gasket, rbox(0.015, 0.7, 0.3, 0.005), T(4.42, 0.72, s * 1.0));
    // protecciones laterales antiempotramiento
    for (const y of [0.48, 0.8]) B.p(M.alu, rbox(3.62, 0.1, 0.03, 0.012), T(2.49, y, s * 1.215));
    for (const x of [0.95, 2.5, 4.05]) { B.p(M.chassis, box(0.05, 0.5, 0.03), T(x, 0.64, s * 1.19)); B.p(M.chassis, box(0.05, 0.05, 0.76), T(x, 0.9, s * 0.81)); }
    // apoyos del bastidor (bisagra de cabina)
    B.p(M.chassis, box(0.12, 0.12, 0.1), T(6.08, 0.78, s * 0.42));
  }
  // parachoques delantero (planta curva) con antinieblas, faldón y matrícula
  { const pts = []; for (let i = 0; i <= 20; i++) { const z = lerp(-1.08, 1.08, i / 20); pts.push([6.48 + BULGE * Math.max(0, 1 - (z / CH) ** 2), z]); }
    const bp = fillet([[6.1, 1.17, 0], [6.36, 1.17, 0.1], ...pts.reverse().map(([x, z], i) => [x, z, 0]), [6.36, -1.17, 0.1], [6.1, -1.17, 0]], 5);
    B.p(M.cab, alongY(bp.map(([x, z]) => [x, z]), 0.26, 0.03), T(0, 0.66, 0)); B.p(M.trim, alongY(bp.map(([x, z]) => [x - 0.03, z * 0.99]), 0.13, 0.02), T(0, 0.465, 0));
    for (const s of [-1, 1]) { B.p(M.lensGlass, cyl(0.055, 0.055, 0.02, 18).rotateZ(PI / 2), T(6.57, 0.66, s * 0.78)); B.p(M.steel, lathe([[0.001, -0.02], [0.05, -0.012], [0.06, 0.01]], 16).rotateZ(-PI / 2), T(6.55, 0.66, s * 0.78)); }
    B.p(M.plate, new THREE.PlaneGeometry(0.44, 0.22).rotateY(PI / 2), T(6.585, 0.66, 0)); B.p(M.black, box(0.01, 0.24, 0.46), T(6.578, 0.66, 0)); }

  // ===== EJES (no suspendidos) =====
  U.p(M.chassis, box(0.1, 0.1, 1.8), T(WB, 0.47, 0)); for (const s of [-1, 1]) { U.p(M.chassis, cyl(0.05, 0.05, 0.22, 12), T(WB, 0.5, s * 0.9)); U.p(M.hub, cyl(0.16, 0.16, 0.08, 22).rotateX(PI / 2), T(WB, R, s * 0.87)); }
  U.p(M.chassis, polyTube([[WB - 0.22, 0.46, -0.84], [WB - 0.22, 0.46, 0.84]], 0.02, 8)); U.p(M.chassis, polyTube([[5.9, 0.82, -0.5], [5.4, 0.62, -0.62], [WB + 0.1, 0.56, -0.86]], 0.022, 8, true));
  U.p(M.chassis, new THREE.SphereGeometry(0.23, 18, 12).scale(0.9, 0.9, 1.05), T(0, R, 0)); U.p(M.chassis, lathe([[0.17, 0], [0.13, 0.14], [0.07, 0.24], [0.001, 0.25]], 16).rotateZ(-PI / 2), T(0.12, R, 0));
  U.p(M.chassis, cyl(0.07, 0.07, 1.3, 14).rotateX(PI / 2), T(0, R, 0)); for (const s of [-1, 1]) U.p(M.hub, cyl(0.2, 0.2, 0.1, 24).rotateX(PI / 2), T(0, R, s * 0.66));

  // ===== CAJA ISOTÉRMICA =====
  const L0 = XR + 0.12, LEN = XF - L0, CX = (L0 + XF) / 2, LI = XF - 0.09 - L0, CXI = (L0 + XF - 0.09) / 2;
  for (const s of [-1, 1]) {
    B.p(M.inner, box(LEN, H - YB - 0.12, 0.08), T(CX, (H - 0.12 + YB) / 2, s * (HW - 0.045)));
    B.p(M.side, new THREE.PlaneGeometry(LEN - 0.02, H - 0.07 - 1.2).rotateY(s > 0 ? 0 : PI), T(CX, (H - 0.07 + 1.2) / 2, s * (HW - 0.003)));
    const top = [[HW - 0.1, H + 0.003], ...arc(HW - 0.07, H - 0.07, 0.073, PI / 2, 0, 8), [HW + 0.003, H - 0.1], [HW - 0.01, H - 0.1], [HW - 0.01, H - 0.01], [HW - 0.1, H - 0.01]];
    B.p(M.alu, alongX(s > 0 ? top : mirrorZ(top), LEN - 0.07), T(CX - 0.035, 0, 0));
    const rail = [[HW - 0.02, 1.05], [HW + 0.018, 1.05], [HW + 0.026, 1.065], [HW + 0.026, 1.205], [HW + 0.008, 1.222], [HW - 0.02, 1.222]];
    B.p(M.alu, alongX(s > 0 ? rail : mirrorZ(rail), LEN), T(CX, 0, 0)); B.p(M.gasket, alongX(s > 0 ? [[HW + 0.026, 1.12], [HW + 0.04, 1.125], [HW + 0.04, 1.155], [HW + 0.026, 1.16]] : mirrorZ([[HW + 0.026, 1.12], [HW + 0.04, 1.125], [HW + 0.04, 1.155], [HW + 0.026, 1.16]]), LEN), T(CX, 0, 0));
    const vc = [[XF - 0.1, s * (HW + 0.003)], ...arc(XF - 0.07, s * (HW - 0.07), 0.073, s * PI / 2, 0, 8), [XF + 0.003, s * (HW - 0.1)], [XF - 0.01, s * (HW - 0.1)], [XF - 0.01, s * (HW - 0.01)], [XF - 0.1, s * (HW - 0.01)]];
    B.p(M.alu, alongY(s > 0 ? vc : vc.slice().reverse(), H - YB - 0.07), T(0, (H - 0.07 + YB) / 2, 0));
    B.p(M.alu, new THREE.SphereGeometry(0.073, 10, 6, s > 0 ? PI / 2 : PI, PI / 2, 0, PI / 2), T(XF - 0.07, H - 0.07, s * (HW - 0.07)));
    for (const x of [-2.6, -0.9, 0.8, 2.5, 3.95]) B.p(M.marker, rbox(0.09, 0.035, 0.02, 0.008), T(x, 1.14, s * (HW + 0.034)));
    B.p(M.markerW, rbox(0.02, 0.05, 0.12, 0.01), T(XF + 0.008, 3.71, s * 1.1));
    // topes de retención de puertas abiertas
    B.p(M.black, rbox(0.1, 0.12, 0.06, 0.02), T(XR + 1.2, 1.62, s * (HW + 0.03))); B.p(M.steel, box(0.03, 0.06, 0.07), T(XR + 1.26, 1.62, s * (HW + 0.06)));
  }
  B.p(M.grp, box(LEN, 0.12, W - 0.01), T(CX, H - 0.06, 0)); B.p(M.grp, box(0.09, H - YB - 0.12, W - 0.17), T(XF - 0.045, (H - 0.12 + YB) / 2, 0));
  { const ft = [[XF - 0.1, H + 0.003], ...arc(XF - 0.07, H - 0.07, 0.073, PI / 2, 0, 8), [XF + 0.003, H - 0.1], [XF - 0.01, H - 0.1], [XF - 0.01, H - 0.01], [XF - 0.1, H - 0.01]];
    B.p(M.alu, slab(ft, W - 0.14), null); B.p(M.alu, box(0.05, 0.16, W - 0.14), T(XF - 0.005, YB + 0.08, 0)); }
  B.p(M.inner, box(LEN, FL - 0.04 - YB, W - 0.17), T(CX, (FL - 0.04 + YB) / 2, 0));
  // interior: piso en T de aluminio, zócalos, rieles de amarre, iluminación, evaporador y manga de aire
  B.p(M.galv, box(LI, 0.02, W - 0.17), T(CXI, FL - 0.03, 0));
  for (let i = 0; i < 23; i++) B.p(M.alu, box(LI, 0.02, 0.045), T(CXI, FL - 0.01, lerp(-(HW - 0.12), HW - 0.12, i / 22)));
  for (const s of [-1, 1]) { B.p(M.tread, box(LI, 0.3, 0.006), T(CXI, FL + 0.15, s * (HW - 0.088))); for (const y of [2.05, 2.85]) B.p(M.alu, box(LI, 0.05, 0.02), T(CXI, y, s * (HW - 0.095))); B.p(M.interior, box(LI * 0.86, 0.012, 0.06), T(CXI, CE - 0.007, s * 0.55)); }
  B.p(M.reefer, rbox(0.34, 0.34, 1.6, 0.03), T(XF - 0.26, CE - 0.18, 0)); for (const z of [-0.5, 0, 0.5]) B.p(M.fan, cyl(0.12, 0.12, 0.01, 20).rotateZ(PI / 2), T(XF - 0.432, CE - 0.18, z));
  B.p(M.fabric, cyl(0.16, 0.16, 5.6, 18, true).rotateZ(PI / 2), T(XF - 0.43 - 2.8, CE - 0.18, 0)); B.p(M.fabric, new THREE.CircleGeometry(0.16, 18).rotateY(-PI / 2), T(XF - 0.43 - 5.6, CE - 0.18, 0));
  // pórtico trasero de acero inoxidable, umbral, topes de muelle
  for (const s of [-1, 1]) {
    B.p(M.steel, box(0.12, H - YB, 0.07), T(XR + 0.06, (H + YB) / 2, s * (HW - 0.035)));
    for (const y of [1.45, 2.1, 2.8, 3.45]) B.p(M.steel, box(0.1, 0.09, 0.016), T(XR + 0.0, y, s * (HW + 0.006)));
    for (const rz of RODS) { const z = s * (PIN_Z - rz); B.p(M.steel, box(0.04, 0.05, 0.06), T(XR - 0.02, 3.705, z)); B.p(M.steel, box(0.04, 0.05, 0.06), T(XR - 0.02, 1.19, z)); }
    B.p(M.gasket, rbox(0.12, 0.22, 0.3, 0.02), T(XR - 0.02, 0.95, s * 0.82)); B.p(M.chassis, box(0.12, 0.2, 0.34), T(XR + 0.1, 0.95, s * 0.82));
    B.p(M.tail, rbox(0.02, 0.05, 0.12, 0.01), T(XR - 0.008, 3.72, s * 1.1));
  }
  B.p(M.steel, box(0.12, H - DY1, W), T(XR + 0.06, (H + DY1) / 2, 0)); B.p(M.steel, box(0.16, FL - YB + 0.06, W), T(XR + 0.08, (FL + YB - 0.06) / 2, 0));
  B.p(M.tread, box(0.15, 0.006, W - 0.14), T(XR + 0.08, FL + 0.003, 0)); B.p(M.chassis, box(0.1, 0.12, W - 0.1), T(XR + 0.1, 0.98, 0));
  // barra de luces trasera, pilotos, matrícula y paragolpes antiempotramiento (bandas rojo/blanco)
  B.p(M.chassis, box(0.06, 0.08, 2.36), T(XR + 0.08, 0.8, 0)); for (const s of [-1, 1]) B.p(M.chassis, box(0.06, 0.22, 0.06), T(XR + 0.13, 0.88, s * 0.4));
  for (const s of [-1, 1]) {
    B.p(M.black, rbox(0.07, 0.16, 0.58, 0.02), T(XR + 0.025, 0.8, s * 0.93));
    B.p(s < 0 ? M.indL : M.indR, rbox(0.014, 0.12, 0.12, 0.004), T(XR - 0.012, 0.8, s * 1.14));
    B.p(M.brake, rbox(0.014, 0.12, 0.16, 0.004), T(XR - 0.012, 0.8, s * 0.99));
    B.p(M.rev, rbox(0.014, 0.12, 0.09, 0.004), T(XR - 0.012, 0.8, s * 0.86));
    B.p(M.fog, rbox(0.014, 0.12, 0.1, 0.004), T(XR - 0.012, 0.8, s * 0.75));
    B.p(M.refl, rbox(0.01, 0.05, 0.07, 0.004), T(XR - 0.008, 0.66, s * 1.12));
  }
  B.p(M.plate, new THREE.PlaneGeometry(0.4, 0.2).rotateY(-PI / 2), T(XR - 0.01, 0.8, 0)); B.p(M.black, box(0.01, 0.22, 0.42), T(XR - 0.004, 0.8, 0)); B.p(M.markerW, box(0.02, 0.015, 0.06), T(XR - 0.015, 0.915, 0));
  // (la barra antiempotramiento va integrada en la plataforma elevadora)

  // ===== EQUIPO DE FRÍO (frontal de la caja) =====
  const UY = 3.4;
  B.p(M.reefer, rbox(0.3, 0.68, 1.76, 0.05), T(XF + 0.15, UY, 0));
  B.p(M.reefer, alongX(roundRectPts(1.76, 0.68, 0.06, 4), 0.12, 0, { holes: [roundRectPts(1.72, 0.64, 0.045, 4).reverse()] }), T(XF + 0.36, UY, 0));
  const fanHole = arc(-0.42, 0, 0.24, 0, TAU, 40).slice(0, 40).reverse(), louv = fillet([[0.05, -0.22, 0.03], [0.78, -0.22, 0.03], [0.78, 0.22, 0.03], [0.05, 0.22, 0.03]], 3).reverse();
  B.p(M.reefer, alongX(roundRectPts(1.76, 0.68, 0.06, 4), 0.04, 0.012, { holes: [fanHole, louv] }), T(XF + 0.44, UY, 0));
  B.p(M.liner, cyl(0.245, 0.245, 0.16, 36, true).rotateZ(PI / 2), T(XF + 0.37, UY, -0.42)); B.p(M.coil, box(0.01, 0.62, 1.68), T(XF + 0.305, UY, 0));
  for (const r of [0.07, 0.13, 0.19, 0.245]) B.p(M.trim, new THREE.TorusGeometry(r, 0.005, 4, 40).rotateY(PI / 2), T(XF + 0.468, UY, -0.42));
  for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; B.p(M.trim, box(0.008, 0.25, 0.008), T(XF + 0.468, UY + Math.sin(a) * 0.125, -0.42 + Math.cos(a) * 0.125, a - PI / 2, 0, 0)); }
  for (let i = 0; i < 6; i++) B.p(M.trim, box(0.03, 0.022, 0.72), T(XF + 0.44, UY - 0.19 + i * 0.076, 0.415, 0, 0, -0.5));
  B.p(M.black, rbox(0.02, 0.1, 0.25, 0.01), T(XF + 0.46, UY - 0.26, -0.02)); B.p(M.display, new THREE.PlaneGeometry(0.21, 0.075).rotateY(PI / 2), T(XF + 0.471, UY - 0.26, -0.02));
  B.p(M.unit, new THREE.PlaneGeometry(0.42, 0.105).rotateY(PI / 2), T(XF + 0.462, UY + 0.255, 0.42));
  for (const s of [-1, 1]) B.p(M.chassis, box(0.05, 0.6, 0.06), T(XF + 0.02, UY, s * 0.7));
  // ventilador del condensador (gira con inercia)
  const fan = new THREE.Group(); fan.position.copy(FAN); bodyIn.add(fan);
  { const F = new Bin(); F.p(M.fan, lathe([[0.001, 0.05], [0.05, 0.045], [0.06, 0.0], [0.06, -0.03], [0.001, -0.03]], 18).rotateZ(-PI / 2));
    const bl = slab(fillet([[0.05, -0.035, 0.01], [0.225, -0.06, 0.03], [0.23, 0.05, 0.03], [0.05, 0.03, 0.01]], 3), 0.006);
    for (let k = 0; k < 5; k++) F.p(M.fan, bl, new THREE.Matrix4().makeRotationX((k / 5) * TAU).multiply(T(0, 0, 0, 0, PI / 2 - 0.45, 0)).multiply(T(0, 0, 0, 0, 0, PI / 2)));
    F.build(fan); }
  // cardán (gira con la transmisión)
  const prop = new THREE.Group(), pa = new THREE.Vector3(4.42, 0.8, 0), pbv = new THREE.Vector3(0.36, 0.52, 0), pd = pbv.clone().sub(pa);
  prop.position.copy(pa); prop.rotation.z = Math.atan2(pd.y, pd.x); bodyIn.add(prop); const propSpin = new THREE.Group(); prop.add(propSpin);
  { const F = new Bin(), Lp = pd.length(); F.p(M.chassis, cyl(0.045, 0.045, Lp - 0.2, 12).rotateZ(PI / 2), T(Lp / 2)); for (const x of [0.06, Lp - 0.06, Lp * 0.5]) F.p(M.steel, box(0.09, 0.1, 0.06), T(x)); F.build(propSpin); }

  // ===== PUERTAS TRASERAS (bisagra exterior, apertura a 270°) =====
  const doors = [], rods = [];
  for (const s of [1, -1]) {
    const dg = new THREE.Group(); dg.position.set(PIN_X, 0, s * PIN_Z); bodyIn.add(dg); const D = new Bin();
    const z0 = 0.082, z1 = PIN_Z - 0.003, dw = z1 - z0, zc = -s * (z0 + z1) / 2, yc = (DY0 + DY1) / 2, dh = DY1 - DY0;
    D.p(M.inner, box(DT, dh, dw), T(0.04 + DT / 2, yc, zc));
    const pl = new THREE.PlaneGeometry(dw, dh).rotateY(-PI / 2), uv = pl.attributes.uv, zW = (u) => s * PIN_Z + (s > 0 ? -z1 + u * dw : z0 + u * dw);
    for (let i = 0; i < uv.count; i++) uv.setX(i, (zW(uv.getX(i)) + (HW - 0.07)) / (2 * (HW - 0.07)));
    D.p(M.rear, pl, T(0.039, yc, zc));
    for (const [w, h, x, y, z] of [[0.015, 0.03, 0, DY1 - 0.02, 0], [0.015, 0.03, 0, DY0 + 0.02, 0]]) D.p(M.gasket, box(w, h, dw - 0.02), T(0.04 + DT + 0.007, y, zc));
    for (const zz of [z0 + 0.015, z1 - 0.015]) D.p(M.gasket, box(0.015, dh - 0.02, 0.03), T(0.04 + DT + 0.007, yc, -s * zz));
    D.p(M.gasket, box(0.02, dh, 0.02), T(0.06, yc, -s * (z1 + 0.004)));
    D.p(M.steel, box(0.004, 0.3, dw - 0.06), T(0.04 + DT + 0.003, DY0 + 0.17, zc));
    for (const y of [1.45, 2.1, 2.8, 3.45]) { D.p(M.steel, box(0.012, 0.06, 0.32), T(0.033, y, -s * 0.16)); D.p(M.steel, cyl(0.02, 0.02, 0.1, 12), T(0, y, 0)); for (const dz of [0.06, 0.14, 0.24]) D.p(M.steel, cyl(0.008, 0.008, 0.008, 6).rotateZ(PI / 2), T(0.026, y, -s * dz)); }
    for (const rz of RODS) for (const y of [1.42, 2.55, 3.45]) D.p(M.steel, box(0.03, 0.045, 0.05), T(0.025, y, -s * rz));
    for (const rz of RODS) D.p(M.steel, box(0.035, 0.06, 0.04), T(0.02, 1.75, -s * (rz + 0.36))); // retén de la palanca
    D.p(M.gasket, rbox(0.03, 0.06, 0.06, 0.01), T(0.03, 1.62, -s * 1.15));
    D.build(dg);
    const dr = { g: dg, s, rods: [] };
    for (const rz of RODS) {
      const rg = new THREE.Group(); rg.position.set(0.015, 0, -s * rz); dg.add(rg); const Rb = new Bin();
      Rb.p(M.steel, cyl(0.013, 0.013, 3.72 - 1.17, 10), T(0, (3.72 + 1.17) / 2, 0));
      for (const y of [1.19, 3.705]) Rb.p(M.steel, box(0.02, 0.035, 0.075), T(0, y, -s * 0.03));
      Rb.p(M.steel, cyl(0.022, 0.022, 0.07, 12), T(0, 1.75, 0)); Rb.p(M.steel, box(0.028, 0.03, 0.36), T(-0.01, 1.75, -s * 0.19)); Rb.p(M.steel, cyl(0.018, 0.018, 0.12, 10).rotateX(PI / 2), T(-0.012, 1.75, -s * 0.33));
      Rb.build(rg); dr.rods.push(rg); rods.push(rg);
    }
    doors.push(dr);
  }

  // ===== RUEDAS =====
  const wp = wheelParts(), wheels = [];
  const mkWheel = (x, z, front, dual) => {
    const sg = new THREE.Group(); sg.position.set(x, R, z); unsprung.add(sg); const sp = new THREE.Group(); sg.add(sp); const Wb = new Bin(), s = Math.sign(z);
    const put = (dz, flip) => { const m = T(0, 0, dz, 0, flip ? PI : 0, 0); Wb.p(M.tire, wp.tire, m); Wb.p(M.rim, wp.rim, m); wp.hub.forEach(([g, mm]) => Wb.p(M.hub, g, mm ? m.clone().multiply(mm) : m)); };
    if (dual) { put(s * 0.155, s < 0); put(-s * 0.155, s > 0); } else put(0, s < 0);
    Wb.build(sp); wheels.push({ steer: sg, spin: sp, z, front });
  };
  mkWheel(WB, TF, true); mkWheel(WB, -TF, true); mkWheel(0, (TRO + TRI) / 2, false, true); mkWheel(0, -(TRO + TRI) / 2, false, true);


  // ===== PLATAFORMA ELEVADORA TRASERA RETRÁCTIL (bajo chasis, 1,5 t) =====
  // Carro deslizante sobre dos rieles bajo la caja; brazos de elevación en paralelogramo con cilindros; plataforma de
  // 1,8 × 2,3 m de chapa estriada con un tramo plegable (se pliega encima para guardarla); banderines y balizas LED.
  const tl = buildTailLift(M, bodyIn);
  C.build(cabIn, bendCab); B.build(bodyIn); U.build(unsprung);
  root.traverse((m) => { if (m.isMesh && m.material.transparent) m.castShadow = false; });
  return { root, body, cab, unsprung, doors, rods, wheels, fan, propSpin, M, tl };
}


// ---------------------------------------------------------------- Plataforma elevadora (geometría + cinemática)
// Coordenadas del camión: la plataforma sale hacia −X (detrás de la caja). P = pivote de los brazos (en el carro),
// H = bisagra de la plataforma (borde del lado del camión, a nivel de la cara superior). TL.top(lift) da la altura.
export const TL = { LA: 0.75, PY: 0.56, PXD: XR + 0.32, PXS: XR + 1.9, DEPTH: 1.8, FOLD: 0.9, WID: 2.3, T: 0.06 };
function buildTailLift(M, parent) {
  const g = new THREE.Group(); g.name = 'plataforma'; parent.add(g);
  const F = new Bin();
  for (const s of [-1, 1]) { F.p(M.chassis, box(1.8, 0.09, 0.07), T(XR + 1.1, 0.68, s * 0.55)); for (const x of [XR + 0.3, XR + 1.95]) F.p(M.chassis, box(0.08, 0.32, 0.06), T(x, 0.86, s * 0.55)); }
  F.p(M.black, rbox(0.16, 0.22, 0.09, 0.015), T(XR + 0.42, 1.0, HW + 0.05)); // botonera de mando lateral
  F.p(M.red, cyl(0.02, 0.02, 0.02, 12).rotateX(PI / 2), T(XR + 0.38, 1.05, HW + 0.1)); F.p(M.markerW, cyl(0.016, 0.016, 0.02, 12).rotateX(PI / 2), T(XR + 0.46, 1.05, HW + 0.1));
  F.p(M.black, polyTube([[XR + 0.42, 0.89, HW + 0.05], [XR + 0.5, 0.75, HW - 0.1], [XR + 0.6, 0.7, 0.6]], 0.008, 5));
  F.build(g);
  const slide = new THREE.Group(); slide.position.set(TL.PXS, TL.PY, 0); g.add(slide);
  const S = new Bin();
  S.p(M.chassis, cyl(0.05, 0.05, 1.2, 14).rotateX(PI / 2), null);                                          // tubo de pivote
  for (const s of [-1, 1]) { S.p(M.chassis, box(0.5, 0.06, 0.05), T(0.15, 0.08, s * 0.55)); S.p(M.steel, box(0.1, 0.1, 0.08), T(0.36, 0.1, s * 0.55)); }
  S.p(M.chassis, box(0.12, 0.3, 1.2), T(0.25, -0.02, 0));                                                   // grupo hidráulico
  S.build(slide);
  const arms = [], cyls = [];
  for (const s of [-1, 1]) {
    const a = new THREE.Group(); a.position.set(0, 0, s * 0.5); slide.add(a); const A = new Bin();
    A.p(M.chassis, box(TL.LA, 0.08, 0.06), T(-TL.LA / 2, 0, 0)); A.p(M.steel, cyl(0.035, 0.035, 0.09, 12).rotateX(PI / 2), T(-TL.LA, 0, 0)); A.build(a); arms.push(a);
    const barrel = new THREE.Mesh(cyl(0.035, 0.035, 0.36, 12), M.chassis), rod = new THREE.Mesh(cyl(0.018, 0.018, 1, 10), M.chrome);
    barrel.castShadow = rod.castShadow = true; slide.add(barrel, rod); cyls.push({ s, barrel, rod });
  }
  const plat = new THREE.Group(); g.add(plat);
  const P = new Bin(), hw = TL.WID / 2, Lin = TL.DEPTH - TL.FOLD;
  P.p(M.tread, box(Lin, TL.T, TL.WID), T(-Lin / 2, -TL.T / 2, 0));
  P.p(M.red, box(0.04, 0.012, TL.WID), T(-0.02, 0.003, 0));
  P.build(plat);
  const flap = new THREE.Group(); flap.position.set(-Lin, 0, 0); plat.add(flap);
  const Fp = new Bin();
  Fp.p(M.tread, box(TL.FOLD, TL.T, TL.WID), T(-TL.FOLD / 2, -TL.T / 2, 0));
  for (const s of [-1, 1]) { Fp.p(M.red, box(TL.FOLD, 0.008, 0.06), T(-TL.FOLD / 2, 0.002, s * (hw - 0.03))); Fp.p(M.refl, box(0.03, TL.T + 0.01, 0.3), T(-TL.FOLD + 0.015, -TL.T / 2, s * (hw - 0.2))); }
  Fp.p(M.red, box(0.03, 0.012, TL.WID), T(-TL.FOLD + 0.03, 0.003, 0));
  Fp.p(M.chassis, box(0.03, 0.035, TL.WID - 0.3), T(-TL.FOLD + 0.015, 0.0175, 0));                       // tope antirrodadura (rollstop)
  Fp.build(flap);
  const flags = []; for (const s of [-1, 1]) { // banderines de señalización en las esquinas exteriores + LED ámbar
    const f = new THREE.Group(); f.position.set(-TL.FOLD + 0.06, 0, s * (hw - 0.06)); flap.add(f); const B2 = new Bin();
    B2.p(M.chassis, cyl(0.012, 0.012, 0.5, 8), T(0, 0.25, 0)); B2.p(M.red, box(0.004, 0.22, 0.3), T(0, 0.38, -s * 0.15)); B2.p(M.refl, box(0.005, 0.07, 0.3), T(0, 0.38, -s * 0.15)); B2.p(M.indR, rbox(0.03, 0.03, 0.06, 0.008), T(0, 0.52, 0)); B2.build(f); flags.push(f);
  }
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return { g, slide, arms, cyls, plat, flap, flags, deploy: 0, lift: 0 };
}
// Ángulo de brazo para una altura de plataforma (cara superior) y = PY + LA·sin φ
const tlPhi = (y) => Math.asin(clamp((y - TL.PY) / TL.LA, -0.99, 0.99));
function poseTailLift(t, deploy, lift) {
  const d = clamp(deploy, 0, 1), sl = smootherstep(d / 0.4), uf = smootherstep((d - 0.4) / 0.3), lw = smootherstep((d - 0.7) / 0.3);
  const phiS = tlPhi(TL.PY), phiL = tlPhi(lerp(TL.T, FL, clamp(lift, 0, 1))), phi = lerp(phiS, phiL, lw);
  t.slide.position.x = lerp(TL.PXS, TL.PXD, sl); t.slide.visible = true;
  for (const a of t.arms) a.rotation.z = -phi; // el brazo apunta hacia −X; φ > 0 sube la bisagra
  const hx = t.slide.position.x - TL.LA * Math.cos(phi), hy = TL.PY + TL.LA * Math.sin(phi);
  t.plat.position.set(hx, hy, 0); t.flap.rotation.z = -PI * (1 - uf) * 0.995; // se despliega pasando por arriba
  for (const f of t.flags) f.visible = uf > 0.9;
  for (const c of t.cyls) { // cilindro: del carro (0.3, −0.12) a la mitad del brazo
    const A = new THREE.Vector3(0.3, -0.13, c.s * 0.38), Bp = new THREE.Vector3(-TL.LA * 0.55 * Math.cos(phi), TL.LA * 0.55 * Math.sin(phi), c.s * 0.38), d2 = Bp.clone().sub(A), L = d2.length(), u = d2.clone().normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), u);
    c.barrel.quaternion.copy(q); c.barrel.position.copy(A).addScaledVector(u, 0.18);
    const rl = Math.max(0.05, L - 0.3); c.rod.quaternion.copy(q); c.rod.scale.y = rl; c.rod.position.copy(Bp).addScaledVector(u, -rl / 2);
  }
  t.deploy = d; t.lift = lift; t.top = hy; t.hx = hx;
}

// ---------------------------------------------------------------- Rig animado (suspensión, ruedas, puertas, luces, equipo de frío)
export class TruckRig {
  constructor(p) {
    Object.assign(this, p); this.group = p.root;
    this.x = 0; this.z = 0; this.heading = 0; this._ds = 0; this._dh = 0; this._init = false; this._steer = null;
    this.v = 0; this.a = 0; this.yaw = 0; this.steer = 0; this.time = 0; this.odo = 0;
    this.pitch = 0; this.pv = 0; this.roll = 0; this.rv = 0; this.heave = 0; this.hv = 0; this.cp = 0; this.cpv = 0; this.cr = 0; this.crv = 0;
    this.doorT = 0; this.fanW = 0; this.engine = true; this.reefer = true; this.lightsOn = true;
    this.gear = 'D'; this.indicate = 0; this.hazard = false; this.holdBrake = false; this.brake = false; this.reversing = false; this.beeper = false; this.beep = false;
    this.override = {}; // p.ej. { brake: true } fuerza una luz
    poseTailLift(this.tl, 0, 0);
  }
  // Pose del centro del eje trasero en el suelo. steer (opcional) = ángulo de bicicleta de la dirección; snap = teletransporte.
  setPose(x, z, heading, steer, snap = false) {
    if (!this._init || snap) { this._init = true; this._ds = this._dh = 0; } else {
      const dx = x - this.x, dz = z - this.z; this._ds += dx * Math.cos(heading) + dz * Math.sin(heading); this._dh += wrapAngle(heading - this.heading);
    }
    this.x = x; this.z = z; this.heading = heading; this._steer = steer ?? null;
    this.group.position.set(x, 0, z); this.group.rotation.y = -heading;
  }
  setDoors(t) { this.doorT = clamp(t, 0, 1); }
  // Plataforma elevadora: deploy 0 (guardada bajo el chasis) … 1 (desplegada); lift 0 (suelo) … 1 (nivel del piso de carga).
  // this.platform = Object3D en la bisagra (cara superior, borde del camión); su −X local apunta hacia fuera del camión.
  setTailLift(deploy, lift) { this.tlMoving = Math.abs(deploy - this.tl.deploy) + Math.abs(lift - this.tl.lift) > 1e-5; poseTailLift(this.tl, deploy, lift); }
  get platform() { return this.tl.plat; }
  get doorsOpen() { return this.doorT >= 0.999; }
  update(dt) {
    if (!(dt > 0)) return; this.time += dt;
    const ds = this._ds, dh = this._dh; this._ds = this._dh = 0;
    const v = ds / dt; this.a = lag(this.a, clamp((v - this.v) / dt, -6, 6), 0.12, dt); this.v = v; this.yaw = dh / dt; this.odo += Math.abs(ds);
    // dirección con geometría de Ackermann (la rueda interior gira más)
    let st = this._steer; if (st == null) st = Math.abs(v) > 0.05 ? Math.atan((WB * this.yaw) / v) : this.steer;
    this.steer = clamp(st, -0.7, 0.7);
    const Rt = Math.abs(this.steer) > 1e-4 ? WB / Math.tan(this.steer) : Infinity;
    for (const w of this.wheels) {
      let ang = 0; if (w.front && isFinite(Rt)) ang = Math.atan(WB / (Rt - w.z));
      if (w.front) w.steer.rotation.y = -ang;
      w.spin.rotation.z -= (ds - dh * w.z) / Math.cos(ang) / R;
    }
    this.propSpin.rotation.x += (ds / R) * 4.1;
    // suspensión: resorte-amortiguador excitado por aceleraciones e irregularidades del firme
    const aLat = v * this.yaw, mv = Math.min(1, Math.abs(v)), o = this.odo;
    const bump = mv * (Math.sin(o * 2.3) * 0.6 + Math.sin(o * 5.7 + 1.3) * 0.4), bump2 = mv * Math.sin(o * 3.1 + 0.7);
    [this.pitch, this.pv] = spring(this.pitch, this.pv, clamp(this.a * 0.0075, -0.03, 0.03) + bump * 0.0012, 55, 3.2, dt);
    [this.roll, this.rv] = spring(this.roll, this.rv, clamp(-aLat * 0.016, -0.05, 0.05) + bump2 * 0.0012, 45, 2.6, dt);
    [this.heave, this.hv] = spring(this.heave, this.hv, bump * 0.004, 120, 7, dt);
    [this.cp, this.cpv] = spring(this.cp, this.cpv, clamp(this.a * 0.011, -0.04, 0.04) + bump2 * 0.002, 30, 1.9, dt);
    [this.cr, this.crv] = spring(this.cr, this.crv, clamp(-aLat * 0.022, -0.06, 0.06), 26, 1.7, dt);
    const idle = this.engine ? Math.sin(this.time * 71) * 0.00035 : 0;
    this.body.rotation.set(this.roll, 0, this.pitch); this.body.position.y = PB.y + this.heave;
    this.cab.rotation.set(this.cr + idle, 0, this.cp + idle * 0.5);
    // puertas: primero giran las barras de cierre, luego cada hoja (derecha primero), al final se recogen las palancas
    const t = this.doorT, rod = smootherstep(t / 0.12) * (1 - smootherstep((t - 0.9) / 0.1));
    const aR = smootherstep((t - 0.1) / 0.5), aL = smootherstep((t - 0.38) / 0.5);
    for (const d of this.doors) { d.g.rotation.y = d.s * OPEN * (d.s > 0 ? aR : aL); for (const r of d.rods) r.rotation.y = d.s * rod * 1.75; }
    // ventilador del condensador con inercia (arranque ~1,5 s, parada por inercia ~4 s)
    const wT = this.reefer && this.engine ? 42 : 0; this.fanW = lag(this.fanW, wT, wT > this.fanW ? 1.2 : 3.5, dt); this.fan.rotation.x += this.fanW * dt;
    // luces
    const ov = this.override, blink = (this.time * 1.5) % 1 < 0.55;
    this.reversing = this.gear === 'R'; this.beeper = this.engine && this.reversing; this.beep = this.beeper && (this.time * 1.2) % 1 < 0.5;
    this.brake = ov.brake ?? (this.engine && ((this.v * this.a < -0.04 && Math.abs(this.v) > 0.02) || (this.holdBrake && Math.abs(this.v) < 0.05)));
    const L = this.M, on = this.lightsOn && this.engine, set = (m, x) => { m.emissiveIntensity = lag(m.emissiveIntensity, x, 0.03, dt); };
    set(L.head, on ? 2.2 : 0); set(L.tail, on ? 0.9 : 0); set(L.marker, on ? 0.9 : 0); set(L.markerW, on ? 1.2 : 0);
    set(L.brake, this.brake ? 3.2 : on ? 0.55 : 0); set(L.rev, (ov.reverse ?? this.reversing) && this.engine ? 2.6 : 0);
    const li = ov.left ?? ((this.hazard || this.indicate < 0) && blink), ri = ov.right ?? ((this.hazard || this.indicate > 0) && blink);
    L.indL.emissiveIntensity = li ? 2.6 : 0; L.indR.emissiveIntensity = ri ? 2.6 : 0;
    set(L.interior, t > 0.08 ? 1.8 : 0); L.display.emissiveIntensity = this.reefer ? 1.2 : 0.05;
    if (this.tl.deploy > 0.05 && !(ri || li)) L.indR.emissiveIntensity = Math.max(L.indR.emissiveIntensity, blink && this.tlMoving ? 2.2 : 0);
  }
}

// ---------------------------------------------------------------- Conductor autónomo (máquina de estados, modelo cinemático de bicicleta)
// Estados: 'away' → 'arrive' → 'reverse' (para a PRE_STOP m del muelle) → 'opening' (baja el conductor y abre puertas)
//          → 'final' (retrocede los últimos metros hasta los topes) → 'docked'  ·  al salir: 'pullout' → 'closing' → 'leave' → 'away'.
const MAXST = 0.62, STR = 0.45; // ángulo máx. de dirección [rad] y velocidad de giro del volante en ruedas [rad/s]
const CFG = { arrive: { vmax: 3.5, acc: 1.2, dec: 0.9 }, reverse: { vmax: 0.8, acc: 0.35, dec: 0.3 }, final: { vmax: 0.3, acc: 0.15, dec: 0.2 }, pullout: { vmax: 0.45, acc: 0.25, dec: 0.3 }, leave: { vmax: 3.5, acc: 1.0, dec: 1.0 } };
export class TruckDriver {
  // dock = { x, z, heading }: punto donde debe quedar la cara trasera (TRUCK.XR) y rumbo del camión ya atracado (mirando hacia fuera).
  constructor(rig, dock = {}, o = {}) {
    this.rig = rig; this.dock = { x: dock.x ?? 0, z: dock.z ?? 0, heading: dock.heading ?? 0 };
    this.o = { road: 14, from: 34, to: 46, side: 1, preStop: TRUCK.PRE_STOP, ...o };
    this.state = 'away'; this.docked = false; this.progress = 0; this.timer = 0; this.doorT = 0;
    this.u = 0; this.w = 0; this.th = 0; this.v = 0; this.steer = 0; this.s = 0; this.path = null; this.sStop = 0; this.dir = 1; this.cfg = CFG.arrive; this.hold = 0;
    rig.group.visible = false;
  }
  get uDock() { return -XR; }
  _go(st) { this.state = st; this.timer = 0; }
  _setPath(pts, r, sStopFromEnd, dir, cfg) { this.path = new Path2(pts, r); this.s = 0; this.sStop = this.path.length - sStopFromEnd; this.dir = dir; this.cfg = cfg; }
  _reversePath(uStop) { // camino de marcha atrás calculado desde la pose actual hasta el eje del muelle
    const b = this.th + PI, bu = Math.cos(b), bw = Math.sin(b), P = [this.u, this.w];
    const t = Math.abs(bw) > 0.15 ? -this.w / bw : -1;
    const pts = t > 3 ? [P, [this.u + bu * t, 0], [-8, 0]] : [P, [-8, 0]];
    this._setPath(pts, 6, uStop + 8, -1, CFG.reverse);
  }
  _track() { // proyección de la pose sobre el camino (búsqueda gruesa + refinado a 5 mm)
    const P = this.path, d2 = (s) => { const p = P.curve.getPointAt(clamp(s / P.length, 0, 1)); return (p.x - this.u) ** 2 + (p.y - this.w) ** 2; };
    let best = this.s, bd = Infinity; for (let s = this.s - 0.2; s <= this.s + 1.2; s += 0.05) { const d = d2(s); if (d < bd) { bd = d; best = s; } }
    for (let s = best - 0.05; s <= best + 0.05; s += 0.005) { const d = d2(s); if (d < bd) { bd = d; best = s; } }
    this.s = clamp(best, 0, P.length);
  }
  _curv(range) { let k = 0; for (let i = 0; i <= 5; i++) { const c = this.path.at(Math.min(this.path.length, this.s + (i / 5) * range)).curv; if (Math.abs(c) > Math.abs(k)) k = c; } return k; }
  _drive(h, stop = true) {
    this._track(); const P = this.path, dir = this.dir, cfg = this.cfg;
    const Ld = dir > 0 ? clamp(3 + 0.9 * this.v, 3, 7) : 3.2, tp = P.curve.getPointAt(clamp((this.s + Ld) / P.length, 0, 1));
    const al = wrapAngle(Math.atan2(tp.y - this.w, tp.x - this.u) - (dir > 0 ? this.th : this.th + PI));
    const cmd = clamp(Math.atan((2 * WB * Math.sin(al)) / Ld) * dir, -MAXST, MAXST);
    this.steer += clamp(cmd - this.steer, -STR * h, STR * h);
    const k = Math.abs(this._curv(10)), vc = k > 1e-3 ? Math.sqrt(0.8 / k) : 99, rem = stop ? this.sStop - this.s : 1e6;
    this.v = approach(this.v, rem, Math.min(cfg.vmax, vc), cfg.acc, cfg.dec, h);
    const sv = this.v * dir; this.u += sv * Math.cos(this.th) * h; this.w += sv * Math.sin(this.th) * h; this.th += ((sv * Math.tan(this.steer)) / WB) * h;
    if (rem < 0.03 && this.v < 0.01) { this.v = 0; return true; } return false;
  }
  _steerOnly(h) { // gira el volante parado (antes de arrancar) hacia el ángulo que pedirá el seguimiento
    const P = this.path, tp = P.curve.getPointAt(clamp((this.s + 3.2) / P.length, 0, 1)), al = wrapAngle(Math.atan2(tp.y - this.w, tp.x - this.u) - (this.dir > 0 ? this.th : this.th + PI));
    const cmd = clamp(Math.atan((2 * WB * Math.sin(al)) / 3.2) * this.dir, -MAXST, MAXST); this.steer += clamp(cmd - this.steer, -0.35 * h, 0.35 * h);
  }
  _step(h, want) {
    const o = this.o, sd = o.side, R = this.rig; this.timer += h;
    R.hazard = false; R.indicate = 0; R.holdBrake = false;
    switch (this.state) {
      case 'away':
        this.docked = false; this.progress = 0;
        if (want) { // aparece lejos, en la calle de acceso, y avanza
          const A = [o.road, -o.from * sd], B = [o.road, -2 * sd], D = [o.road + 14, 12 * sd];
          this._setPath([A, B, D], 6, Math.hypot(6, 6), 1, CFG.arrive); this.u = A[0]; this.w = A[1]; this.th = (sd * PI) / 2; this.v = 0; this.steer = 0; this.doorT = 0;
          R.setPose(...this._world(), 0, true); R.group.visible = true; R.engine = true; R.gear = 'D'; this._go('arrive');
        }
        break;
      case 'arrive': {
        R.gear = 'D'; const k = this._curv(22); if (Math.abs(k) > 0.02) R.indicate = Math.sign(k);
        if (this._drive(h)) { this._reversePath(this.uDock + o.preStop); this._go('reverse'); }
        this.progress = 0.45 * clamp(this.s / this.sStop, 0, 1); break;
      }
      case 'reverse':
        R.gear = 'R'; R.hazard = true;
        if (this.timer < 1.8) { R.holdBrake = true; this._steerOnly(h); } else if (this._drive(h)) this._go('opening');
        this.progress = 0.45 + 0.3 * clamp(this.s / this.sStop, 0, 1); break;
      case 'opening': // asienta la suspensión, baja el conductor, abre las puertas (~4 s)
        R.gear = 'N'; R.holdBrake = true; R.hazard = true;
        if (!want) { this._go('closing'); this.timer = 2.5; break; }
        if (this.timer > 4.0) this.doorT = Math.min(1, this.doorT + h / 4);
        if (this.doorT >= 1 && this.timer > 9.5) { this.sStop = this.path.length - (this.uDock + 8); this.cfg = CFG.final; this.dir = -1; this._go('final'); }
        this.progress = 0.75 + 0.15 * this.doorT; break;
      case 'final':
        R.gear = 'R'; R.hazard = true;
        if (this.timer < 1.2) R.holdBrake = true; else if (this._drive(h)) { this._go('docked'); R.pv += 0.012; R.cpv += 0.02; } // leve rebote al apoyar en los topes
        this.progress = 0.9 + 0.1 * clamp(1 - (this.u - this.uDock) / o.preStop, 0, 1); break;
      case 'docked':
        R.gear = 'N'; R.holdBrake = true; this.progress = 1; this.docked = this.timer > 1.2;
        if (!want) { this.docked = false; this._setPath([[this.u, this.w], [this.u + 12 * Math.cos(this.th), this.w + 12 * Math.sin(this.th)]], 1, 12 - o.preStop, 1, CFG.pullout); this._go('pullout'); }
        break;
      case 'pullout':
        R.gear = 'D'; R.hazard = true;
        if (want) { this._reversePath(this.uDock); this.cfg = CFG.final; this._go('final'); break; }
        if (this.timer < 1.5) R.holdBrake = true; else if (this._drive(h)) this._go('closing');
        this.progress = 0.9; break;
      case 'closing':
        R.gear = 'N'; R.holdBrake = true; R.hazard = true;
        if (want) { this._reversePath(this.uDock + o.preStop); this.sStop = 0; this._go('opening'); this.timer = 4.0; break; }
        if (this.timer > 2.5) this.doorT = Math.max(0, this.doorT - h / 4);
        if (this.doorT <= 0 && this.timer > 10) { this._setPath([[this.u, this.w], [o.road + 6, this.w], [o.road + 6, o.to * sd]], 8, 0, 1, CFG.leave); this._go('leave'); }
        this.progress = 0.75 + 0.15 * this.doorT; break;
      case 'leave': {
        R.gear = 'D'; if (this.timer < 1.5) { R.holdBrake = true; R.indicate = sd; break; }
        const k = this._curv(15); if (Math.abs(k) > 0.02 && this.s < 30) R.indicate = Math.sign(k);
        this._drive(h, false); this.progress = 0.75 * (1 - clamp(this.s / this.path.length, 0, 1));
        if (this.s > this.path.length - 3) { R.group.visible = false; R.engine = false; this._go('away'); }
        break;
      }
    }
  }
  // Salto directo al estado atracado (simulación acelerada): puertas abiertas, motor en ralentí, freno puesto.
  snapDocked() {
    const R = this.rig; this.u = this.uDock; this.w = 0; this.th = 0; this.v = 0; this.steer = 0; this.doorT = 1; this.state = 'docked'; this.timer = 5; this.docked = true; this.progress = 1;
    this.path = new Path2([[this.u + 8, 0], [this.u, 0]], 1); this.s = this.path.length; R.group.visible = true; R.engine = true; R.gear = 'N'; R.setPose(...this._world(), 0, true);
  }
  snapAway() { const R = this.rig; this.state = 'away'; this.docked = false; this.progress = 0; this.doorT = 0; this.v = 0; R.group.visible = false; R.engine = false; }
  _world() { const H = this.dock.heading, c = Math.cos(H), s = Math.sin(H); return [this.dock.x + this.u * c - this.w * s, this.dock.z + this.u * s + this.w * c, H + this.th]; }
  update(dt, { wantDocked = false } = {}) {
    if (!(dt > 0)) return; let left = Math.min(dt, 0.25);
    while (left > 1e-6) { const h = Math.min(left, 1 / 30); this._step(h, wantDocked); left -= h; }
    if (this.state !== 'away') { const [x, z, hd] = this._world(); this.rig.setPose(x, z, hd, this.steer); }
    this.rig.setDoors(this.doorT); this.rig.update(dt);
  }
}

// ---------------------------------------------------------------- Fábrica
// opts: { company='FRÍO ANDINO', plate='FA-2731', cabColor, dock:{x,z,heading}, driver:{road, from, to, side, preStop} }
export function createTruck(opts = {}) {
  const o = { company: 'FRÍO ANDINO', plate: 'FA-2731', ...opts };
  const parts = build(o), rig = new TruckRig(parts), group = parts.root;
  const driver = new TruckDriver(rig, o.dock || {}, o.driver || {});
  return { group, rig, driver, dims: TRUCK };
}

// ---------------------------------------------------------------- Demo (banco de pruebas): ciclo completo con un muelle de referencia
// URL: ?t0=segundos (adelanta el reloj) · ?door=0..1 (camión estático en el origen con puertas en esa posición) · ?steer=rad
export function demo(scene) {
  const q = new URLSearchParams(location.search), K = materials();
  const dock = { x: -0.2, z: 0, heading: PI }; // cara trasera a 0,20 m del muro → topes de goma en contacto
  const T0 = createTruck({ dock }); scene.add(T0.group); window.__truck = T0;
  const wall = new THREE.Group(); scene.add(wall); const wm = new THREE.MeshStandardMaterial({ color: 0xb8c0c8, roughness: 0.8 });
  for (const [w, h, d, x, y, z] of [[0.3, 4.5, 4.75, 0.15, 2.25, -3.625], [0.3, 4.5, 4.75, 0.15, 2.25, 3.625], [0.3, 1.5, 2.5, 0.15, 3.75, 0]]) { const m = new THREE.Mesh(box(w, h, d), wm); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; wall.add(m); }
  for (const z of [-0.82, 0.82]) { const m = new THREE.Mesh(rbox(0.12, 0.25, 0.3, 0.03), K.rubber); m.position.set(-0.06, 0.95, z); wall.add(m); }
  for (const z of [-1.6, 1.6]) { const m = new THREE.Mesh(box(12, 0.01, 0.12), K.paintYellow); m.position.set(-6, 0.006, z); wall.add(m); }
  if (q.has('tl')) { // camión estático con la plataforma: ?tl=deploy,lift
    const { rig } = T0, [dp, lf] = q.get('tl').split(',').map(Number); wall.visible = false; rig.group.visible = true; rig.setPose(0, 0, 0, 0, true); rig.setDoors(1); rig.setTailLift(dp, lf || 0);
    return (dt) => { rig.update(dt); };
  }
  if (q.has('door')) {
    const { rig } = T0; wall.visible = false; rig.group.visible = true; rig.setPose(0, 0, 0, +(q.get('steer') || 0), true); rig.setDoors(+q.get('door')); rig.gear = 'D';
    return (dt) => { rig.setPose(0, 0, 0, +(q.get('steer') || 0)); rig.update(dt); };
  }
  let want = true, tState = 0;
  const step = (dt) => {
    const d = T0.driver, prev = d.state; tState += dt;
    if (want && d.docked && tState > 8) want = false; else if (!want && d.state === 'away' && tState > 2) want = true;
    d.update(dt, { wantDocked: want }); if (d.state !== prev) tState = 0;
  };
  window.__truckStep = step;
  const t0 = +(q.get('t0') || 0); for (let t = 0; t < t0; t += 0.05) step(0.05);
  return (dt) => step(dt);
}
