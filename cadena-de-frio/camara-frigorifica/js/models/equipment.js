// EQUIPOS DE LA CÁMARA: evaporador de techo (unit cooler), unidad condensadora exterior y puerta corrediza frigorífica
// con cortina de tiras de PVC. Geometría procedural de detalle (chapa plegada, venturis, álabes en hoz torcidos, rejillas
// de alambre, serpentín aleteado con curvas en U, valvulería) y animación física dependiente de dt:
//  · FanRotor: inercia de arranque/parada, bamboleo a baja velocidad y disco de desenfoque de movimiento.
//  · Evaporador: escarcha creciente, desescarche con resistencias incandescentes y goteo a la bandeja, LED de estado.
//  · Condensadora: ventilador con inercia, vibración y golpe de par del compresor, reverberación de aire caliente.
//  · Puerta: perfil de motor (rampa de aceleración, crucero, frenado), cierre suave con compresión del burlete y rebote,
//    rampa de despegue del marco, ruedas/poleas/correa sincronizadas, baliza giratoria; tiras con péndulo amortiguado.
// Convenciones (metros, Y arriba):
//  · Evaporador: origen = centro superior del equipo en el plano del techo (cuelga hacia −Y); largo según Z;
//    sopla hacia −X (ventiladores en la cara −X, serpentín de aspiración en +X); conexiones frigoríficas en el extremo −Z.
//  · Condensadora: origen = centro de la huella en el suelo; ventilador de descarga vertical; conexiones en la cara −X;
//    tablero eléctrico en la cara +Z.
//  · Puerta: origen = centro del vano a nivel de suelo; x=0 cara exterior del muro (exterior = −X, muro hacia +X con
//    espesor wallT); la hoja se desliza hacia +Z; la cortina cuelga dentro (x = wallT + 0.05).
import { THREE, PI, TAU, rbox, extrude, extrudeHoles, roundRectPts, lathe, tube, mergeT, T, canvas, tex, normalFrom, noiseCanvas, hash, materials, clamp, smoothstep, lag, spring, approach } from './kit.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

const V3 = THREE.Vector3, UP = new V3(0, 1, 0);
// ---------------------------------------------------------------- Utilidades de geometría
const crease = (g, a = 0.3) => toCreasedNormals(g, a);
const ext = (pts, len, bev = 0, seg = 2) => crease(extrude(pts, len, bev, seg));
const extH = (pts, holes, len, bev = 0) => crease(extrudeHoles(pts, holes, len, bev));
const arc = (cx, cy, r, a0, a1, n = 6) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
const circ = (cx, cy, r, n = 40) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * TAU), cy + r * Math.sin((i / n) * TAU)]);
const rr = (w, h, r, cx = 0, cy = 0, seg = 4) => roundRectPts(w, h, r, seg).map(([x, y]) => [x + cx, y + cy]);
// Chapa plegada: polilínea abierta → contorno cerrado de espesor t (desplazado a la derecha del recorrido, con inglete).
function sheet(pts, t) {
  const n = pts.length, sn = [];
  for (let i = 0; i < n - 1; i++) { const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1], l = Math.hypot(dx, dy) || 1; sn.push([dy / l, -dx / l]); }
  const off = pts.map((p, i) => { const a = sn[Math.max(0, i - 1)], b = sn[Math.min(n - 2, i)]; let nx = a[0] + b[0], ny = a[1] + b[1]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l; const k = t / Math.max(0.35, nx * b[0] + ny * b[1]); return [p[0] + nx * k, p[1] + ny * k]; });
  return [...pts, ...off.reverse()];
}
// Cilindro unitario (alto 1 en Y) orientado entre dos puntos: matriz para instancias.
const rodMat = (a, b) => { const A = new V3(...a), B = new V3(...b), d = B.clone().sub(A), l = d.length(); return new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), new V3(1, l, 1)); };
const _cyl = new Map(), ucyl = (seg) => { if (!_cyl.has(seg)) _cyl.set(seg, new THREE.CylinderGeometry(1, 1, 1, seg, 1)); return _cyl.get(seg); };
// Cubo de geometrías por material: se fusionan al final (una malla por material).
function bucket() {
  const m = new Map();
  const o = {
    add(mat, g, M = null) { if (!m.has(mat)) m.set(mat, []); m.get(mat).push([g, M]); return o; },
    box(mat, w, h, d, M, r = 0) { return o.add(mat, r > 0 ? rbox(w, h, d, r, 2) : new THREE.BoxGeometry(w, h, d), M); },
    cyl(mat, r, h, M, seg = 16, rTop = r) { return o.add(mat, new THREE.CylinderGeometry(rTop, r, h, seg), M); },
    rod(mat, a, b, r, seg = 8, pre = null) { const M = rodMat(a, b).multiply(new THREE.Matrix4().makeScale(r, 1, r)); return o.add(mat, ucyl(seg), pre ? pre.clone().multiply(M) : M); },
    flush(parent, cast = true) { const out = []; for (const [mat, l] of m) { const me = new THREE.Mesh(mergeT(l), mat); me.castShadow = cast; me.receiveShadow = true; parent.add(me); out.push(me); } m.clear(); return out; },
  };
  return o;
}
// Bloque aleteado: UV en metros a lo largo del eje de los tubos (las aletas son planos perpendiculares a ese eje).
function finBox(w, h, d, axis = 'z', pitch = 0.05) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(), p = g.attributes.position, nr = g.attributes.normal, uv = g.attributes.uv, ai = { x: 0, y: 1, z: 2 }[axis];
  for (let i = 0; i < p.count; i++) {
    const c = [p.getX(i), p.getY(i), p.getZ(i)], n = [Math.abs(nr.getX(i)), Math.abs(nr.getY(i)), Math.abs(nr.getZ(i))], ni = n.indexOf(Math.max(...n));
    const oth = [0, 1, 2].find((k) => k !== ni && k !== ai) ?? 1; uv.setXY(i, c[ai] / pitch, c[oth] / pitch);
  }
  return g;
}
const uvScale = (g, su, sv) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); return g; };

// Álabe en hoz con perfil curvado y torsión (eje del ventilador = +Y, radial = +X, giro positivo avanza hacia −Z).
// r0/r1 radios raíz/punta, c cuerda máx., p0/p1 calado raíz/punta [rad], sweep = flecha de la hoz.
function bladeGeo(r0, r1, c, p0, p1, sweep = 0.45, th = 0.004, nu = 14, nv = 6) {
  const pos = [], idx = [], row = nv + 1;
  const P = (u, v, side) => {
    const r = r0 + (r1 - r0) * u, tip = u > 0.78 ? Math.sqrt(Math.max(0.05, 1 - ((u - 0.78) / 0.22) ** 2)) : 1;
    const ch = c * (0.55 + 0.75 * u - 0.45 * u * u) * tip, sc = sweep * c * u * u, s = (v * ch) / 2;
    const y = -0.07 * ch * (1 - v * v) + side * 0.5 * th * (1 - 0.5 * u) * Math.sqrt(Math.max(0, 1 - v * v)), p = p0 + (p1 - p0) * u;
    return [r, y * Math.cos(p) + s * Math.sin(p), -y * Math.sin(p) + s * Math.cos(p) + sc];
  };
  for (const side of [1, -1]) for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) pos.push(...P(i / nu, -1 + (2 * j) / nv, side));
  const B = (nu + 1) * row, id = (s, i, j) => s * B + i * row + j;
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const [a, b, cc, d] = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
    idx.push(id(0, ...a), id(0, ...d), id(0, ...b), id(0, ...b), id(0, ...d), id(0, ...cc));
    idx.push(id(1, ...a), id(1, ...b), id(1, ...d), id(1, ...b), id(1, ...cc), id(1, ...d));
  }
  for (let j = 0; j < nv; j++) {
    idx.push(id(0, 0, j), id(1, 0, j), id(0, 0, j + 1), id(0, 0, j + 1), id(1, 0, j), id(1, 0, j + 1));
    idx.push(id(0, nu, j), id(0, nu, j + 1), id(1, nu, j), id(0, nu, j + 1), id(1, nu, j + 1), id(1, nu, j));
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
// Buje con cono (spinner) por revolución; nariz hacia +Y.
const hubGeo = (R) => lathe([[0.001, 1.15], [0.35, 1.08], [0.65, 0.9], [0.88, 0.6], [0.98, 0.25], [1, 0], [1, -0.45], [0.92, -0.55], [0.4, -0.55], [0.001, -0.55]].map(([r, y]) => [r * R, y * R]), 28);

// ---------------------------------------------------------------- Texturas procedurales (perezosas)
let _TX = null;
function TX() {
  if (_TX) return _TX;
  const fins = canvas(128, 8, (g) => { for (let i = 0; i < 8; i++) { const x = i * 16, gr = g.createLinearGradient(x, 0, x + 16, 0); gr.addColorStop(0, '#eef2f6'); gr.addColorStop(0.14, '#c2cad2'); gr.addColorStop(0.24, '#737b84'); gr.addColorStop(0.8, '#4e555d'); gr.addColorStop(1, '#9aa2aa'); g.fillStyle = gr; g.fillRect(x, 0, 16, 8); } });
  const wire = canvas(64, 64, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(0, 0, w, 4); g.fillRect(0, 0, 4, h); });
  const thread = canvas(8, 32, (g, w, h) => { for (let y = 0; y < h; y++) { const v = 128 + 120 * Math.sin((y / h) * TAU * 4); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, y, w, 1); } });
  const belt = canvas(64, 16, (g, w, h) => { g.fillStyle = '#1b1d20'; g.fillRect(0, 0, w, h); g.fillStyle = '#2c3035'; for (let i = 0; i < 4; i++) g.fillRect(i * 16 + 2, 0, 8, h); g.fillStyle = '#44494f'; g.fillRect(0, 7, w, 2); });
  const blur = canvas(256, 256, (g, w, h) => {
    const img = g.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (x - w / 2) / (w / 2), dy = (y - h / 2) / (h / 2), r = Math.hypot(dx, dy), a = Math.atan2(dy, dx), i = (y * w + x) * 4;
      const band = smoothstep((r - 0.22) / 0.12) * (1 - smoothstep((r - 0.9) / 0.1)), ph = (((a / TAU) * 5) % 1 + 1) % 1, streak = 0.55 + 0.45 * Math.pow(1 - ph, 2);
      const v = 150 + 70 * r; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255 * band * streak * (0.75 + 0.25 * r);
    }
    g.putImageData(img, 0, 0);
  });
  const frost = noiseCanvas(128, 128, 12, 7, 4), frostC = canvas(128, 128, (g) => { const d0 = frost.getContext('2d').getImageData(0, 0, 128, 128), d = d0.data; for (let i = 0; i < d.length; i += 4) { const v = 215 + d[i] * 0.16 + (hash(i) > 0.97 ? 25 : 0); d[i] = v - 6; d[i + 1] = v - 2; d[i + 2] = Math.min(255, v + 6); } g.putImageData(d0, 0, 0); });
  const ribs = canvas(64, 8, (g, w, h) => { for (let x = 0; x < w; x++) { const v = 128 + 110 * Math.sin((x / w) * TAU * 8); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, h); } });
  const hazard = canvas(128, 128, (g, w, h) => { g.fillStyle = '#f2c200'; g.fillRect(0, 0, w, h); g.fillStyle = '#16181b'; for (let i = -2; i < 4; i++) { g.beginPath(); g.moveTo(i * 64, h); g.lineTo(i * 64 + 32, h); g.lineTo(i * 64 + 32 + h, 0); g.lineTo(i * 64 + h, 0); g.fill(); } });
  const glow = canvas(64, 64, (g, w, h) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const shimmer = canvas(64, 128, (g, w, h) => {
    const img = g.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const u = x / w, v = y / h, i = (y * w + x) * 4, edge = Math.pow(Math.sin(PI * u), 1.5) * Math.sin(PI * v); const s = 0.5 + 0.5 * Math.sin(u * 40 + Math.sin(v * 9 + u * 5) * 4); d[i] = 255; d[i + 1] = 246; d[i + 2] = 232; d[i + 3] = 255 * edge * s; }
    g.putImageData(img, 0, 0);
  });
  _TX = {
    finMap: tex(fins), finN: normalFrom(fins, 3.5), wire: tex(wire, [1, 1], false), threadN: normalFrom(thread, 4), belt, blur: tex(blur, [1, 1]),
    frost: tex(frostC, [6, 2]), frostA: tex(frost, [6, 2], false), frostN: normalFrom(frost, 2, [6, 2]), ribsN: normalFrom(ribs, 2.5), hazard: tex(hazard, [1, 1]), glow: tex(glow, [1, 1]), shimmer,
  };
  _TX.blur.wrapS = _TX.blur.wrapT = THREE.ClampToEdgeWrapping;
  return _TX;
}
// Placa/etiqueta con texto (canvas).
function plate(lines, { w = 256, h = 128, bg = '#c8ced4', fg = '#1a1f24', border = '#7d868f', title = null, tbg = '#1f5fa8' } = {}) {
  const c = canvas(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = border; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
    let y = 8; if (title) { g.fillStyle = tbg; g.fillRect(6, 6, w - 12, 26); g.fillStyle = '#fff'; g.font = 'bold 17px sans-serif'; g.fillText(title, 12, 25); y = 38; }
    g.fillStyle = fg; g.font = '13px monospace'; lines.forEach((l, i) => g.fillText(l, 12, y + 14 + i * 16));
    g.fillStyle = '#9aa3ac'; for (const [x, yy] of [[10, 10], [w - 10, 10], [10, h - 10], [w - 10, h - 10]]) { g.beginPath(); g.arc(x, yy, 3, 0, TAU); g.fill(); }
  });
  return new THREE.MeshStandardMaterial({ map: tex(c), roughness: 0.4, metalness: 0.3 });
}

// ---------------------------------------------------------------- Materiales del módulo
let _E = null;
function EM() {
  if (_E) return _E;
  const M = materials(), X = TX(), std = (o) => new THREE.MeshStandardMaterial(o);
  _E = {
    casing: std({ color: 0xeef1f4, roughness: 0.36, metalness: 0.12, roughnessMap: M.roughT }),
    cabinet: std({ color: 0xd3d7d9, roughness: 0.42, metalness: 0.15, roughnessMap: M.roughT }),
    shroud: std({ color: 0x2a2f35, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide }),
    guard: std({ color: 0x1f2226, roughness: 0.45, metalness: 0.35 }),
    blade: std({ color: 0x9ea8b2, roughness: 0.32, metalness: 0.65 }),
    motor: std({ color: 0x3b424a, roughness: 0.5, metalness: 0.45 }),
    thread: std({ color: 0xb7c0c9, roughness: 0.4, metalness: 0.85, normalMap: X.threadN, normalScale: new THREE.Vector2(1.5, 1.5) }),
    brass: std({ color: 0xc09a45, roughness: 0.32, metalness: 0.9 }),
    armaflex: std({ color: 0x141517, roughness: 0.95, metalness: 0, normalMap: M.rubber.normalMap, normalScale: new THREE.Vector2(0.15, 0.15) }),
    greyPlastic: std({ color: 0x9aa1a8, roughness: 0.55, metalness: 0 }),
    cable: std({ color: 0x15171a, roughness: 0.7, metalness: 0 }),
    comp: std({ color: 0x2f3a46, roughness: 0.5, metalness: 0.35 }),
    tank: std({ color: 0x272b31, roughness: 0.55, metalness: 0.3 }),
    sight: std({ color: 0x3ad06a, emissive: 0x0a4a1a, emissiveIntensity: 0.6, roughness: 0.05, metalness: 0.1 }),
    wire: std({ color: 0x2b2f34, alphaMap: X.wire, transparent: false, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.4 }),
    hazard: std({ map: X.hazard, roughness: 0.55, metalness: 0.2 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xd7e9f4, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.2, depthWrite: false, envMapIntensity: 1.6 }),
    nylon: std({ color: 0xe8e4d8, roughness: 0.45, metalness: 0 }),
    door: std({ color: 0xf2f4f5, roughness: 0.3, metalness: 0.08, roughnessMap: M.roughT }),
    opGrey: std({ color: 0xc5cbcf, roughness: 0.4, metalness: 0.2 }),
    water: std({ color: 0xcfeeff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.75 }),
    lamp: std({ color: 0xff9f1a, emissive: 0xff8a00, emissiveIntensity: 0.15, roughness: 0.15, transparent: true, opacity: 0.82, toneMapped: false }),
    btnGreen: std({ color: 0x1f9d3a, roughness: 0.3, emissive: 0x0a3a12, emissiveIntensity: 0.4 }),
    btnRed: M.paintRed, btnBlack: std({ color: 0x15171a, roughness: 0.35 }),
  };
  return _E;
}
const ledMat = () => new THREE.MeshStandardMaterial({ color: 0x0d1a10, emissive: 0x18ff40, emissiveIntensity: 0, roughness: 0.15, toneMapped: false });
const setPick = (g, pick) => g.traverse((m) => { if (m.isMesh || m.isSprite) m.userData.pick = pick; });
export function triCount(o) { let n = 0; o.traverse((m) => { if (!m.isMesh || !m.geometry?.attributes?.position) return; const g = m.geometry; n += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (m.isInstancedMesh ? m.count : 1); }); return Math.round(n); }

// ---------------------------------------------------------------- Rotor de ventilador con inercia
// rotor: Object3D que gira sobre su eje Y local. Velocidad angular ω sigue al objetivo con constantes de tiempo distintas al
// arrancar (par motor, tauUp) y al parar (marcha por inercia frenada por el aire, tauDown). A baja velocidad aparece un
// bamboleo (juego de rodamientos/desequilibrio); a alta velocidad el disco de desenfoque sustituye visualmente a los álabes.
export class FanRotor {
  constructor(rotor, o = {}) {
    Object.assign(this, { rotor, blur: o.blur || null, mats: o.mats || [], wMax: o.wMax ?? 30, tauUp: o.tauUp ?? 2.5, tauDown: o.tauDown ?? 6, wob: o.wobble ?? 1, w: 0, a: hash((o.seed ?? 1) * 7.3) * TAU, k: 0.9 + 0.2 * hash((o.seed ?? 1) * 3.1) });
    this.mats.forEach((m) => { m.transparent = true; });
  }
  get frac() { return this.w / this.wMax; }
  update(dt, target) {
    const tg = clamp(target, 0, 1) * this.wMax * this.k;
    this.w = lag(this.w, tg, tg > this.w ? this.tauUp : this.tauDown, dt); if (tg === 0 && this.w < 0.04) this.w = 0;
    this.a = (this.a + this.w * dt) % TAU;
    const s = this.w / this.wMax, low = s > 0 ? Math.pow(1 - s, 3) * Math.min(1, s * 25) : 0, amp = this.wob * (0.014 * low + 0.0012 * s);
    this.rotor.rotation.set(amp * Math.sin(this.a * 1.0), this.a, amp * Math.cos(this.a));
    const b = smoothstep((s - 0.25) / 0.55);
    if (this.blur) { this.blur.visible = b > 0.01; this.blur.material.opacity = 0.6 * b; }
    for (const m of this.mats) m.opacity = 1 - 0.55 * b;
  }
}
// Rotor completo (álabes fusionados + buje + disco de desenfoque). Eje +Y, aire hacia +Y.
function makeRotor(R, nb, hubR, o = {}) {
  const E = EM(), bm = E.blade.clone(), rotor = new THREE.Group();
  const bg = bladeGeo(hubR * 0.85, R, o.chord ?? R * 0.62, o.p0 ?? 0.62, o.p1 ?? 0.3, o.sweep ?? 0.45, o.th ?? 0.005);
  const blades = new THREE.Mesh(mergeT(Array.from({ length: nb }, (_, k) => [bg, T(0, 0, 0, 0, (k * TAU) / nb, 0)])), bm); blades.castShadow = true; rotor.add(blades);
  const hg = hubGeo(hubR); if (o.noseDown) hg.rotateX(PI);
  const hub = new THREE.Mesh(hg, o.hubMat || materials().plastic); hub.castShadow = true; rotor.add(hub);
  const blur = new THREE.Mesh(new THREE.RingGeometry(hubR * 0.9, R * 1.01, 48, 1).rotateX(-PI / 2), new THREE.MeshBasicMaterial({ map: TX().blur, color: 0xb8c0c8, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  blur.position.y = o.blurY ?? R * 0.12; blur.visible = false; rotor.add(blur);
  return { rotor, blur, bm };
}
// Rejilla de alambre abombada: aros concéntricos (al cubo b) + radios (matrices para InstancedMesh). Marco Mf, eje +Y.
function guard(b, list, Mf, R, y0, dome, nR = 7, nRad = 16, wire = 0.0024) {
  const E = EM(), yr = (r) => y0 + dome * (1 - (r / R) ** 2);
  b.add(E.guard, new THREE.TorusGeometry(R, wire * 1.8, 6, 64), Mf.clone().multiply(T(0, y0, 0, PI / 2)));
  for (let i = 0; i < nR; i++) { const r = R * (0.16 + (0.84 * (i + 0.5)) / nR); b.add(E.guard, new THREE.TorusGeometry(r, wire, 4, Math.max(24, Math.round(r * 160))), Mf.clone().multiply(T(0, yr(r), 0, PI / 2))); }
  b.add(E.guard, new THREE.CylinderGeometry(R * 0.15, R * 0.15, 0.004, 24), Mf.clone().multiply(T(0, yr(0) + 0.002, 0)));
  for (let k = 0; k < nRad; k++) {
    const a = (k / nRad) * TAU, c = Math.cos(a), s = Math.sin(a), rs = [R * 0.14, R * 0.55, R];
    for (let j = 0; j < 2; j++) list.push(Mf.clone().multiply(rodMat([rs[j] * c, yr(rs[j]), rs[j] * s], [rs[j + 1] * c, yr(rs[j + 1]), rs[j + 1] * s])).multiply(new THREE.Matrix4().makeScale(wire, 1, wire)));
  }
}
function instances(parent, geo, mat, list, cast = true) { const im = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = cast; im.receiveShadow = true; parent.add(im); return im; }

// ================================================================ EVAPORADOR (unit cooler de techo)
// o: { fans=3, length=3.6, depth=0.72, height=0.62, hang=0.2 (altura de varillas), fanD=0.5, dripFall=0.3, tag='EV-01' }
export function createEvaporator(o = {}) {
  const n = o.fans ?? 3, L = o.length ?? 3.6, D = o.depth ?? 0.72, Hc = o.height ?? 0.62, hang = o.hang ?? 0.2, Rf = (o.fanD ?? 0.5) / 2;
  const M = materials(), E = EM(), g = new THREE.Group(); g.name = 'evaporador';
  const yT = -hang, yB = yT - Hc, yc = (yT + yB) / 2, xF = -D / 2, cd = 0.19, xC0 = D / 2 - cd - 0.005, xC1 = D / 2 - 0.005, zE = L / 2 - 0.1, yP = yB - 0.04;
  const yC0 = yB + 0.035, yC1 = yT - 0.02, ch = yC1 - yC0, yCc = (yC0 + yC1) / 2, s = Rf / 0.25;
  const fz = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * (L / n));
  const fin = new THREE.MeshStandardMaterial({ color: 0xffffff, map: TX().finMap, normalMap: TX().finN, normalScale: new THREE.Vector2(0.8, 0.8), metalness: 0.55, roughness: 0.42 });
  const heater = new THREE.MeshStandardMaterial({ color: 0x5a2a1c, emissive: 0xff4a10, emissiveIntensity: 0, roughness: 0.6, metalness: 0.3 });
  const b = bucket(), wires = [];
  // -- Carcasa: chapa superior plegada (radios + pestaña trasera), tapas laterales con nervio, placa de ventiladores
  b.add(E.casing, ext(sheet([[xF - 0.001, yT - 0.05], ...arc(xF + 0.025, yT - 0.025, 0.025, PI, PI / 2), ...arc(D / 2 - 0.025, yT - 0.025, 0.025, PI / 2, 0), [D / 2, yT - 0.05], [D / 2 - 0.014, yT - 0.05]], 0.0025), L + 0.05));
  const ew = D / 2 - 0.21 - xF, ex = (xF + D / 2 - 0.21) / 2;
  for (const sz of [-1, 1]) {
    b.add(E.casing, ext(rr(ew + 0.01, Hc + 0.03, 0.022), 0.022, 0.004), T(ex, yc - 0.005, sz * (L / 2 + 0.013)));
    b.add(E.casing, ext(rr(ew - 0.09, Hc - 0.12, 0.03), 0.006, 0.003), T(ex, yc - 0.005, sz * (L / 2 + 0.026)));
    b.box(M.galv, cd + 0.02, ch + 0.02, 0.003, T((xC0 + xC1) / 2, yCc, sz * zE));                                 // placa tubular
  }
  b.add(E.casing, extH(rr(L, Hc - 0.004, 0.012), fz.map((z) => circ(z, 0, Rf + 0.025, 48)), 0.012, 0.003), T(xF + 0.006, yc, 0, 0, -PI / 2, 0));
  // -- Canales de cuelgue (U), varillas roscadas M10, tuercas, arandelas y placas de anclaje al techo
  const rodZ = L > 2.4 ? [-L / 2 + 0.3, 0, L / 2 - 0.3] : [-L / 2 + 0.25, L / 2 - 0.25];
  for (const sx of [-0.2, 0.2]) {
    b.add(M.galv, ext(sheet([[0.022, 0.045], [0.022, 0], [-0.022, 0], [-0.022, 0.045]], 0.003), L - 0.08), T(sx, yT, 0));
    for (const z of rodZ) {
      b.rod(E.thread, [sx, yT + 0.002, z], [sx, -0.006, z], 0.0055, 8);
      b.cyl(M.galv, 0.0125, 0.003, T(sx, yT + 0.0045, z), 16).cyl(M.galv, 0.0105, 0.009, T(sx, yT + 0.011, z), 6).cyl(M.galv, 0.0105, 0.009, T(sx, yT + 0.022, z), 6);
      b.box(M.galv, 0.07, 0.005, 0.07, T(sx, -0.0025, z), 0.002).cyl(M.galv, 0.0105, 0.01, T(sx, -0.01, z), 6);
    }
  }
  // -- Ventiladores: venturi profundo (revolución), motor con brazos, rejilla abombada
  const fans = [], mats = [];
  const ventP = [[0.322, -0.17], [0.302, -0.163], [0.284, -0.148], [0.271, -0.122], [0.264, -0.09], [0.262, -0.05], [0.262, -0.014], [0.268, -0.004], [0.288, 0.003], [0.318, 0.006], [0.326, 0.002]].map(([r, y]) => [r * s, y * s]);
  const ventG = lathe(ventP, 56), motG = lathe([[0.001, -0.075], [0.045, -0.075], [0.06, -0.08], [0.066, -0.09], [0.068, -0.1], [0.068, -0.19], [0.062, -0.2], [0.04, -0.208], [0.001, -0.21]].map(([r, y]) => [r * s, y * s]), 28);
  fz.forEach((z, i) => {
    const Mf = T(xF, yc, z, 0, 0, PI / 2);
    b.add(E.shroud, ventG, Mf).add(E.motor, motG, Mf);
    b.add(E.motor, rbox(0.05 * s, 0.035 * s, 0.04 * s, 0.004), Mf.clone().multiply(T(0, -0.15 * s, 0.07 * s)));    // caja de bornes del motor
    for (let k = 0; k < 4; k++) { const a = PI / 4 + (k * PI) / 2, c = Math.cos(a), sn = Math.sin(a); b.rod(M.galv, [0.064 * s * c, -0.15 * s, 0.064 * s * sn], [0.268 * s * c, -0.11 * s, 0.268 * s * sn], 0.005, 6, Mf); }
    guard(b, wires, Mf, 0.318 * s, 0.012, 0.042 * s, 7, 16);
    for (let k = 0; k < 4; k++) { const a = (k * PI) / 2 + PI / 4, c = Math.cos(a), sn = Math.sin(a); b.rod(E.guard, [0.318 * s * c, 0.012, 0.318 * s * sn], [0.345 * s * c, 0.001, 0.345 * s * sn], 0.004, 6, Mf); b.cyl(M.steel, 0.007, 0.004, Mf.clone().multiply(T(0.345 * s * c, 0.002, 0.345 * s * sn)), 8); }
    const fg = new THREE.Group(); fg.position.set(xF, yc, z); fg.rotation.z = PI / 2; g.add(fg);
    const R = makeRotor(0.243 * s, 5, 0.058 * s, { blurY: 0.03 * s }); R.rotor.position.y = -0.04 * s; fg.add(R.rotor);
    fans.push(new FanRotor(R.rotor, { blur: R.blur, mats: [R.bm], wMax: 30, tauUp: 2.5, tauDown: 6, seed: i + 1 })); mats.push(R.bm);
  });
  // -- Serpentín: bloque aleteado, placas soporte intermedias, curvas en U de cobre, resistencias de desescarche
  const coil = new THREE.Mesh(finBox(cd, ch, 2 * zE, 'z'), fin); coil.position.set((xC0 + xC1) / 2, yCc, 0); coil.receiveShadow = true; g.add(coil);
  for (let i = 0; i < n - 1; i++) b.box(M.galv, cd + 0.008, ch + 0.006, 0.003, T((xC0 + xC1) / 2, yCc, (fz[i] + fz[i + 1]) / 2));
  const ny = 8, nx = 4, py = ch / ny, px = cd / nx, ub = new THREE.TorusGeometry(py / 2, 0.0055, 6, 10, PI);
  const rowY = (j, k) => yC0 + (k + 0.5 + (j % 2) * 0.5) * py, colX = (j) => xC0 + (j + 0.5) * px;
  for (const sz of [-1, 1]) for (let j = 0; j < nx; j++) for (let k = sz > 0 ? 0 : 1; k < ny - 1 - (j % 2); k += 2) {
    const m = new THREE.Matrix4().makeBasis(new V3(0, 1, 0), new V3(0, 0, sz), new V3(sz, 0, 0)); m.setPosition(colX(j), rowY(j, k) + py / 2, sz * (zE + 0.0015));
    b.add(M.copper, ub, m);
  }
  for (const sz of [-1, 1]) for (const yy of [yC0 + 0.1, yCc, yC1 - 0.1]) { b.rod(M.steel, [xC0 + cd / 2, yy, sz * (zE - 0.01)], [xC0 + cd / 2, yy, sz * (zE + 0.035)], 0.005, 8); b.cyl(M.plastic, 0.009, 0.018, T(xC0 + cd / 2, yy, sz * (zE + 0.042), PI / 2), 8); }
  // -- Bandeja de desagüe plegada con tapas, resistencia de bandeja y salida de drenaje con resistencia en espiral
  b.add(E.casing, ext(sheet([[D / 2 + 0.02, yB + 0.02], [D / 2 + 0.02, yP + 0.01], [D / 2 + 0.008, yP], [xF + 0.012, yP + 0.006], [xF - 0.004, yP + 0.018], [xF - 0.004, yB + 0.006]], 0.0025), L + 0.05));
  for (const sz of [-1, 1]) b.box(E.casing, D + 0.026, 0.05, 0.003, T(0.008, yP + 0.024, sz * (L / 2 + 0.025)));
  const yh = yP + 0.008, zh = L / 2 - 0.06;
  heaterTube(b, heater, [[0.27, yh, -zh], [0.27, yh, zh - 0.06], [0.25, yh, zh - 0.015], [0.21, yh, zh], [0.02, yh, zh], [-0.02, yh, zh - 0.015], [-0.04, yh, zh - 0.06], [-0.04, yh, -zh]]);
  const dx = 0.12, dzz = -L / 2 + 0.16;
  b.cyl(M.galv, 0.017, 0.085, T(dx, yP - 0.042, dzz), 16).cyl(M.galv, 0.024, 0.02, T(dx, yP - 0.008, dzz), 6).cyl(M.galv, 0.021, 0.012, T(dx, yP - 0.085, dzz), 6);
  b.add(heater, tube(Array.from({ length: 25 }, (_, i) => { const a = i * 0.8; return [dx + 0.0195 * Math.cos(a), yP - 0.015 - i * 0.0026, dzz + 0.0195 * Math.sin(a)]; }), 0.0025, 5, 0.5));
  // -- Conexiones (extremo −Z): colector de aspiración, distribuidor con capilares, válvula de expansión termostática,
  //    bulbo, línea de líquido, línea de aspiración aislada, caja de conexiones con prensaestopas, placa y LED
  const zH = -L / 2 - 0.075, xH = xC1 - 0.03, xD = xC0 + 0.03, yD = yB + 0.17, zD = -L / 2 - 0.1;
  b.rod(M.copper, [xH, yC0 + 0.04, zH], [xH, yT + 0.03, zH], 0.019, 16).add(M.copper, lathe([[0.001, -0.012], [0.012, -0.01], [0.019, 0]], 16), T(xH, yC0 + 0.04, zH));
  for (let k = 1; k < ny - 1; k += 2) { const y = rowY(nx - 1, k); b.add(M.copper, tube([[xH, y, zH], [xH, y, zH + 0.03], [colX(nx - 1), y, -zE - 0.035], [colX(nx - 1), y, -zE]], 0.0065, 6)); }
  b.rod(E.armaflex, [xH, yT - 0.06, zH], [xH, -0.002, zH], 0.034, 20).add(E.armaflex, lathe([[0.019, 0], [0.034, 0.012], [0.034, 0.02]], 20), T(xH, yT - 0.08, zH));
  b.add(E.brass, lathe([[0.001, -0.035], [0.012, -0.035], [0.018, -0.02], [0.016, 0.0], [0.009, 0.02], [0.009, 0.035], [0.001, 0.035]], 20), T(xD, yD, zD));
  for (let k = 0; k < ny; k += 1) {
    const y = rowY(0, k), a = (k / ny) * TAU;
    b.add(M.copper, tube([[xD + 0.008 * Math.cos(a), yD - 0.035, zD + 0.008 * Math.sin(a)], [xD + 0.03 * Math.cos(a), yD - 0.07, zD + 0.02 * Math.sin(a)], [colX(0) + 0.01 * Math.cos(a), y - 0.02, -zE - 0.05], [colX(0), y, -zE - 0.02], [colX(0), y, -zE]], 0.0024, 5, 0.3));
  }
  const yV = yD + 0.12;
  b.rod(M.copper, [xD, yD + 0.035, zD], [xD, yV - 0.03, zD], 0.007, 10).box(E.brass, 0.045, 0.06, 0.045, T(xD, yV, zD), 0.006);
  b.add(E.brass, lathe([[0.001, 0], [0.032, 0], [0.034, 0.006], [0.03, 0.016], [0.018, 0.026], [0.001, 0.029]], 24), T(xD, yV + 0.03, zD));
  b.rod(M.copper, [xD - 0.02, yV, zD], [xD - 0.05, yV, zD], 0.008, 10).add(M.copper, tube([[xD - 0.05, yV, zD], [xD - 0.07, yV + 0.02, zD], [xD - 0.07, yT, zD], [xD - 0.07, -0.002, zD]], 0.008, 10));
  b.cyl(E.brass, 0.013, 0.02, T(xD - 0.035, yV, zD, 0, 0, PI / 2), 6);
  b.add(M.copper, tube([[xD + 0.022, yV, zD], [xD + 0.05, yV + 0.01, zD], [xH - 0.03, yC1 - 0.04, zH - 0.02], [xH - 0.006, yC1 - 0.03, zH - 0.017]], 0.0025, 5));        // igualador externo
  b.rod(M.copper, [xH - 0.027, yCc - 0.03, zH], [xH - 0.027, yCc + 0.06, zH], 0.009, 10);                                          // bulbo
  for (const yy of [yCc - 0.015, yCc + 0.045]) b.add(M.steel, new THREE.TorusGeometry(0.03, 0.0025, 4, 20), T(xH - 0.012, yy, zH, PI / 2));
  b.add(M.copper, tube([[xD, yV + 0.05, zD], [xD + 0.02, yV + 0.11, zD], [xH - 0.06, yCc + 0.12, zH - 0.01], [xH - 0.027, yCc + 0.065, zH]], 0.0018, 4));
  const xj = xF + 0.13, yj = yc + 0.06, zj = -L / 2 - 0.026 - 0.04;
  b.box(E.greyPlastic, 0.17, 0.13, 0.075, T(xj, yj, zj), 0.01).box(E.greyPlastic, 0.176, 0.136, 0.012, T(xj, yj, zj - 0.036), 0.004);
  for (const [a2, c2] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.cyl(M.steel, 0.006, 0.004, T(xj + a2 * 0.072, yj + c2 * 0.052, zj - 0.043, PI / 2), 10);
  b.cyl(M.plastic, 0.016, 0.014, T(xj, yj + 0.072, zj), 6).add(M.plastic, lathe([[0.001, 0.03], [0.008, 0.03], [0.013, 0.022], [0.014, 0]], 16), T(xj, yj + 0.079, zj));
  b.add(E.cable, tube([[xj, yj + 0.1, zj], [xj, yj + 0.16, zj], [xj, yT + 0.02, zj - 0.02], [xj, -0.002, zj - 0.02]], 0.0065, 8));
  b.add(E.cable, tube([[xj + 0.05, yj - 0.065, zj + 0.03], [xj + 0.05, yj - 0.1, zj + 0.03], [xj + 0.05, yj - 0.12, -L / 2 - 0.02], [xj + 0.05, yj - 0.12, -L / 2 + 0.02]], 0.004, 6));
  b.add(plate(['MOD  UC-3x500-ED', 'Q0  12.4 kW  ΔT 8K', 'REF R-448A  PS 28 bar', 'U  400V 3~  1.3 kW', 'DESESC.  ELÉC. 6.9 kW'], { title: `EVAPORADOR ${o.tag ?? 'EV-01'}` }), new THREE.PlaneGeometry(0.2, 0.1), T(xF + 0.15, yB + 0.11, -L / 2 - 0.0275, 0, PI, 0));
  b.flush(g);
  instances(g, ucyl(5), E.guard, wires);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.009, 14, 8, 0, TAU, 0, PI / 2).rotateZ(PI / 2), ledMat()); led.position.set(xF - 0.003, yT - 0.05, -L / 2 + 0.12); g.add(led);
  const bez = new THREE.Mesh(lathe([[0.009, 0], [0.015, 0], [0.016, 0.004], [0.011, 0.006]], 20).rotateZ(PI / 2), M.chrome); bez.position.copy(led.position); g.add(bez);
  // -- Escarcha: capa sobre el serpentín cuyo espesor y opacidad crecen con la escarcha acumulada
  const frostM = new THREE.MeshStandardMaterial({ color: 0xf4f9ff, map: TX().frost, alphaMap: TX().frostA, alphaTest: 0.5, normalMap: TX().frostN, roughness: 0.9, metalness: 0, transparent: true, opacity: 0 });
  const frost = new THREE.Mesh(new THREE.BoxGeometry(cd + 0.004, ch + 0.003, 2 * zE - 0.004), frostM); frost.position.copy(coil.position); frost.visible = false; g.add(frost);
  // -- Gotas de desescarche (instancias)
  const ND = 48, drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), E.water, ND); drops.frustumCulled = false; drops.castShadow = false; g.add(drops);
  const dp = Array.from({ length: ND }, () => ({ on: false, x: 0, y: 0, z: 0, v: 0, y1: 0, hang: 0 }));
  for (let i = 0; i < ND; i++) drops.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
  const dm = new THREE.Matrix4(), dq = new THREE.Quaternion(), dv = new V3(), dsc = new V3();
  setPick(g, { kind: 'evap' });
  let t = 0, heat = 0, wet = 0, fv = 0, acc = 0, ledI = 0;
  function update(dt, st = {}) {
    t += dt; const def = !!st.defrost, fail = !!st.fail, fi = (st.failIdx ?? 1) % n, run = st.run ?? 1, ff = st.fanFrac ?? 1;
    fans.forEach((f, i) => f.update(dt, def || (fail && i === fi) ? 0 : ff));
    // Desescarche: el serpentín se calienta (τ≈4 s), las resistencias brillan y empieza a escurrir agua a la bandeja
    heat = lag(heat, def ? 1 : 0, def ? 4 : 6, dt); wet = lag(wet, def && heat > 0.35 ? 1 : 0, def ? 3 : 5, dt);
    fin.emissive.setRGB(0.16 * heat, 0.04 * heat, 0.008 * heat); fin.emissiveIntensity = 1;
    heater.emissiveIntensity = 1.6 * heat * heat;
    fv = lag(fv, clamp(st.frost ?? 0, 0, 1), 1.2, dt); frost.visible = fv > 0.01;
    frostM.opacity = 0.6 + 0.4 * smoothstep(fv * 1.5); frostM.alphaTest = clamp(0.62 - 0.6 * fv, 0.02, 0.62);
    frost.scale.set(1 + 0.16 * fv, 1 + 0.035 * fv, 1); fin.normalScale.setScalar(0.8 * (1 - fv * 0.8)); // la escarcha crece por manchas
    // Goteo: del borde inferior del serpentín a la bandeja y por la salida de drenaje
    acc += dt * wet * 30;
    while (acc > 1) { acc -= 1; const d = dp.find((q) => !q.on); if (!d) break;
      d.on = true; d.v = 0; d.hang = 0.15 + Math.random() * 0.35;
      if (Math.random() < 0.72) { d.x = xC0 + Math.random() * cd; d.z = (Math.random() * 2 - 1) * (zE - 0.02); d.y = yC0 - 0.004; d.y1 = yP + 0.006; }
      else { d.x = dx; d.z = dzz; d.y = yP - 0.09; d.y1 = yP - 0.09 - (o.dripFall ?? 0.3); }
    }
    for (let i = 0; i < ND; i++) {
      const d = dp[i];
      if (d.on) { if (d.hang > 0) d.hang -= dt; else { d.v -= 9.81 * dt; d.y += d.v * dt; } if (d.y < d.y1) d.on = false; }
      const grow = d.hang > 0 ? 1 - d.hang / 0.5 : 1, st2 = 1 + Math.min(2.5, -d.v * 0.9);
      dm.compose(dv.set(d.x, d.y, d.z), dq, dsc.set(0.0042 * grow, 0.005 * grow * st2, 0.0042 * grow).multiplyScalar(d.on ? 1 : 0)); drops.setMatrixAt(i, dm);
    }
    drops.instanceMatrix.needsUpdate = true;
    // LED: fallo → rojo intermitente; desescarche → ámbar pulsante; marcha → verde; reposo → verde tenue
    const blink = Math.floor(t * 2) % 2 === 0, lm = led.material;
    if (fail) { lm.emissive.set(0xff2020); ledI = blink ? 2.2 : 0.05; }
    else if (def) { lm.emissive.set(0xffa000); ledI = 1.0 + 0.9 * Math.sin(t * 3); }
    else { lm.emissive.set(0x20ff40); ledI = run > 0.01 ? 1.8 : 0.25; }
    lm.emissiveIntensity = ledI;
  }
  return { group: g, update, fans, coil, led, frost, size: { L, D, H: hang + Hc + 0.04 }, ports: { suction: new V3(xH, 0, zH), liquid: new V3(xD - 0.07, 0, zD), drain: new V3(dx, yP - 0.09, dzz), cable: new V3(xj, 0, zj - 0.02) } };
}
// Resistencia de bandeja: tubo blindado (CatmullRom) con un material emisivo propio.
function heaterTube(b, mat, pts) { b.add(mat, tube(pts, 0.004, 6, 0.0)); }

// ================================================================ UNIDAD CONDENSADORA (exterior, descarga vertical)
// o: { tag='CU-01' }  Huella 1.52 × 0.92 m, altura ≈ 1.35 m con rejilla.
export function createCondensingUnit(o = {}) {
  const M = materials(), E = EM(), g = new THREE.Group(); g.name = 'condensadora';
  const y0 = 0.156, y1 = 1.16, xd = -0.12, xf = 0.31, Rf = 0.3, b = bucket(), wires = [];
  // -- Soportes antivibratorios, largueros en C, bandeja base
  for (const x of [-0.62, 0.62]) for (const z of [-0.3, 0.3]) {
    b.add(M.rubber, lathe([[0.001, 0], [0.045, 0], [0.05, 0.008], [0.041, 0.024], [0.046, 0.04], [0.04, 0.05], [0.001, 0.05]], 20), T(x, 0, z));
    b.box(M.galv, 0.11, 0.006, 0.07, T(x, 0.053, z), 0.002).cyl(M.galv, 0.008, 0.02, T(x, 0.064, z), 6).cyl(M.galv, 0.015, 0.008, T(x, 0.06, z), 6);
  }
  for (const z of [-0.3, 0.3]) b.add(M.galv, ext(sheet([[0.025, 0.07], [0.025, 0], [-0.025, 0], [-0.025, 0.07]], 0.003), 1.5, 0), T(0, 0.056, z, 0, PI / 2, 0));
  b.box(M.galv, 1.52, 0.03, 0.92, T(0, 0.141, 0), 0.008);
  // -- Postes de esquina y divisoria, techo con boca de ventilador, interior oscuro
  for (const x of [-0.735, xd, 0.735]) for (const z of [-0.435, 0.435]) b.box(E.cabinet, 0.05, y1 - y0, 0.05, T(x, (y0 + y1) / 2, z), 0.012);
  b.add(E.cabinet, extH(rr(1.52, 0.92, 0.03), [circ(xf, 0, Rf + 0.04, 56)], 0.016, 0.005), T(0, y1 + 0.013, 0, -PI / 2, 0, 0));
  b.box(M.paintDark, 0.6, 0.6, 0.7, T(0.33, y0 + 0.31, 0)).box(M.galv, 0.003, y1 - y0, 0.84, T(xd + 0.02, (y0 + y1) / 2, 0));
  // -- Batería condensadora en U (aleteada) con malla de protección
  const finM = new THREE.MeshStandardMaterial({ color: 0xffffff, map: TX().finMap, normalMap: TX().finN, normalScale: new THREE.Vector2(0.8, 0.8), metalness: 0.55, roughness: 0.42 });
  const fl = 0.735 - 0.025 - (xd + 0.025), fx = (0.71 + xd + 0.025) / 2, hh = y1 - y0 - 0.03, yy = (y0 + y1) / 2;
  for (const z of [-0.39, 0.39]) b.add(finM, finBox(fl, hh, 0.07, 'x'), T(fx, yy, z));
  b.add(finM, finBox(0.07, hh, 0.71, 'z'), T(0.675, yy, 0));
  for (const z of [-1, 1]) b.add(E.wire, uvScale(new THREE.PlaneGeometry(fl, hh), fl / 0.075, hh / 0.075), T(fx, yy, z * 0.433, 0, z > 0 ? 0 : PI, 0));
  b.add(E.wire, uvScale(new THREE.PlaneGeometry(0.82, hh), 0.82 / 0.075, hh / 0.075), T(0.729, yy, 0, 0, PI / 2, 0));
  for (const z of [-1, 1]) for (const y of [y0 + 0.02, y1 - 0.02]) b.box(E.cabinet, fl, 0.03, 0.02, T(fx, y, z * 0.43), 0.004);
  for (const y of [y0 + 0.02, y1 - 0.02]) b.box(E.cabinet, 0.02, 0.03, 0.82, T(0.725, y, 0), 0.004);
  // Curvas de retorno visibles en el lateral de la divisoria (colectores de entrada/salida)
  for (const z of [-1, 1]) for (let k = 0; k < 10; k++) b.add(M.copper, new THREE.TorusGeometry(0.022, 0.0045, 6, 10, PI), T(xd + 0.03, y0 + 0.08 + k * 0.088, z * 0.39, 0, -PI / 2, PI / 2));
  // -- Ventilador: venturi, motor colgado de la rejilla, rejilla abombada
  const Mc = T(xf, y1 + 0.005, 0);
  b.add(E.shroud, lathe([[0.36, -0.06], [0.33, -0.055], [0.312, -0.04], [0.303, -0.015], [0.3, 0.02], [0.3, 0.07], [0.306, 0.085], [0.33, 0.09], [0.345, 0.086]], 56), Mc);
  b.add(E.motor, lathe([[0.001, 0.05], [0.04, 0.05], [0.07, 0.058], [0.075, 0.07], [0.075, 0.14], [0.065, 0.155], [0.001, 0.158]], 28), Mc);
  for (let k = 0; k < 4; k++) { const a = PI / 4 + (k * PI) / 2, c = Math.cos(a), sn = Math.sin(a); b.rod(M.galv, [0.07 * c, 0.15, 0.07 * sn], [0.33 * c, 0.095, 0.33 * sn], 0.006, 6, Mc); }
  guard(b, wires, Mc, 0.34, 0.092, 0.075, 8, 20, 0.0028);
  const fg = new THREE.Group(); fg.position.set(xf, y1 + 0.005, 0); g.add(fg);
  const R = makeRotor(0.285, 4, 0.065, { chord: 0.2, p0: 0.7, p1: 0.36, noseDown: true, blurY: 0.03 }); R.rotor.position.y = 0.018; fg.add(R.rotor);
  const fan = new FanRotor(R.rotor, { blur: R.blur, mats: [R.bm], wMax: 26, tauUp: 3, tauDown: 9, seed: 9 });
  // -- Compartimento del compresor: paneles con lamas, frente con malla y tablero eléctrico
  const slat = sheet([[0.0, 0.014], [-0.004, 0.014], [-0.026, -0.008], [-0.03, -0.016]], 0.0018);
  for (let k = 0; k < 17; k++) b.add(E.cabinet, ext(slat, 0.8), T(-0.735, 0.53 + k * 0.034, 0));
  for (let k = 0; k < 26; k++) b.add(E.cabinet, ext(slat, xd - 0.025 + 0.71), T((xd - 0.735) / 2, 0.22 + k * 0.034, -0.435, 0, -PI / 2, 0));
  b.box(E.cabinet, 0.012, 0.09, 0.82, T(-0.738, y1 - 0.045, 0)).box(E.cabinet, 0.57, 0.09, 0.012, T((xd - 0.735) / 2, y1 - 0.045, -0.438)).box(E.cabinet, 0.57, 0.05, 0.012, T((xd - 0.735) / 2, y0 + 0.025, -0.438));
  b.box(E.cabinet, 0.012, 0.36, 0.82, T(-0.738, y0 + 0.18, 0)).box(M.paintDark, 0.003, y1 - y0, 0.82, T(-0.7, (y0 + y1) / 2, 0)).box(M.paintDark, 0.56, y1 - y0, 0.003, T(-0.43, (y0 + y1) / 2, -0.405));
  b.box(E.cabinet, 0.58, 0.54, 0.01, T(-0.43, 0.88, 0.44)).add(E.wire, uvScale(new THREE.PlaneGeometry(0.56, 0.44), 0.56 / 0.05, 0.44 / 0.05), T(-0.43, 0.39, 0.443));
  b.box(E.cabinet, 0.58, 0.025, 0.02, T(-0.43, 0.615, 0.44), 0.004).box(E.cabinet, 0.58, 0.025, 0.02, T(-0.43, y0 + 0.012, 0.44), 0.004);
  const ez = 0.445 + 0.07;
  b.box(E.cabinet, 0.46, 0.42, 0.13, T(-0.44, 0.86, ez - 0.005), 0.014).box(E.cabinet, 0.44, 0.4, 0.014, T(-0.44, 0.86, ez + 0.065), 0.008);
  for (const y of [0.74, 0.98]) b.cyl(M.steel, 0.008, 0.06, T(-0.665, y, ez + 0.065), 10);
  b.add(M.chrome, lathe([[0.001, 0], [0.016, 0], [0.016, 0.01], [0.01, 0.016], [0.001, 0.016]], 16), T(-0.24, 0.86, ez + 0.071, PI / 2));
  b.box(M.plastic, 0.006, 0.026, 0.004, T(-0.24, 0.86, ez + 0.089));
  b.add(plate(['400V 3~ 50Hz  I 14 A', 'R-448A  4.2 kg', 'PS  HP 28 / LP 16 bar'], { title: `UNIDAD ${o.tag ?? 'CU-01'}`, h: 96 }), new THREE.PlaneGeometry(0.24, 0.09), T(-0.47, 0.98, ez + 0.073));
  b.add(new THREE.MeshStandardMaterial({ map: tex(canvas(64, 64, (c) => { c.fillStyle = '#f2c200'; c.beginPath(); c.moveTo(32, 4); c.lineTo(61, 58); c.lineTo(3, 58); c.closePath(); c.fill(); c.strokeStyle = '#111'; c.lineWidth = 4; c.stroke(); c.fillStyle = '#111'; c.font = 'bold 30px sans-serif'; c.fillText('⚡', 18, 52); })), transparent: true, alphaTest: 0.1 }), new THREE.PlaneGeometry(0.07, 0.07), T(-0.6, 0.76, ez + 0.073));
  b.box(M.paintYellow, 0.012, 0.12, 0.12, T(-0.11, 0.9, 0.46 + 0.02).multiply(T(0, 0, 0, 0, PI / 2, 0)), 0.003).box(M.paintGrey, 0.1, 0.1, 0.07, T(-0.11, 0.9, 0.48), 0.008);
  b.box(M.paintRed, 0.02, 0.07, 0.03, T(-0.11, 0.9, 0.53), 0.006).cyl(M.paintRed, 0.022, 0.012, T(-0.11, 0.9, 0.52, PI / 2), 16);
  b.add(E.cable, tube([[-0.11, 0.84, 0.48], [-0.11, 0.6, 0.48], [-0.11, 0.3, 0.48], [-0.11, 0.2, 0.47]], 0.008, 8));
  // -- Válvulas de servicio (cara −X), visor de líquido, filtro, recibidor, tuberías
  const vS = [-0.79, 0.42, -0.2], vL = [-0.79, 0.3, -0.32];
  for (const [p, r] of [[vS, 0.016], [vL, 0.01]]) {
    b.box(E.brass, 0.055, 0.06, 0.06, T(p[0] + 0.035, p[1], p[2]), 0.006).cyl(E.brass, 0.014, 0.04, T(p[0] + 0.035, p[1] + 0.045, p[2]), 6).cyl(E.brass, 0.017, 0.02, T(p[0] + 0.035, p[1] - 0.04, p[2]), 6);
    b.cyl(E.brass, r + 0.009, 0.022, T(p[0], p[1], p[2], 0, 0, PI / 2), 6).rod(M.copper, [p[0] - 0.05, p[1], p[2]], [p[0] + 0.01, p[1], p[2]], r, 12);
  }
  const comp = new THREE.Group(), cpx = -0.43, cpz = 0.1; comp.position.set(cpx, y0 + 0.004, cpz); g.add(comp);
  {
    const c = bucket();
    c.box(M.paintDark, 0.27, 0.008, 0.27, T(0, 0.012, 0), 0.003);
    for (const [a2, b2] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { c.add(M.rubber, lathe([[0.001, 0], [0.022, 0], [0.024, 0.006], [0.018, 0.012], [0.022, 0.018], [0.001, 0.018]], 14), T(a2 * 0.11, -0.004, b2 * 0.11)); c.cyl(M.galv, 0.006, 0.03, T(a2 * 0.11, 0.02, b2 * 0.11), 6).cyl(M.galv, 0.011, 0.007, T(a2 * 0.11, 0.032, b2 * 0.11), 6); }
    c.add(E.comp, lathe([[0.001, 0.02], [0.09, 0.02], [0.112, 0.032], [0.121, 0.055], [0.122, 0.08], [0.122, 0.34], [0.119, 0.37], [0.108, 0.405], [0.088, 0.432], [0.06, 0.45], [0.03, 0.458], [0.001, 0.46]], 40));
    c.add(M.plastic, new THREE.TorusGeometry(0.124, 0.006, 6, 40), T(0, 0.075, 0, PI / 2));
    c.box(M.plastic, 0.1, 0.11, 0.05, T(0, 0.27, 0.135), 0.008).box(M.plastic, 0.106, 0.116, 0.008, T(0, 0.27, 0.161), 0.003).cyl(M.plastic, 0.01, 0.025, T(0, 0.2, 0.135), 8);
    c.rod(M.copper, [-0.115, 0.2, 0], [-0.18, 0.2, 0], 0.016, 12).rod(M.copper, [0, 0.45, 0], [0, 0.52, 0], 0.011, 10);
    c.add(plate(['SCROLL  ZB45', '7.5 HP'], { w: 128, h: 64, bg: '#e8e8e2' }), new THREE.PlaneGeometry(0.06, 0.03), T(0.06, 0.18, 0.11, 0, 0.5, 0));
    c.flush(comp);
  }
  const ry = 0.3, rz = -0.25;
  b.add(E.tank, lathe([[0.001, -0.21], [0.035, -0.206], [0.06, -0.19], [0.073, -0.165], [0.075, -0.14], [0.075, 0.14], [0.073, 0.165], [0.06, 0.19], [0.035, 0.206], [0.001, 0.21]], 28), T(-0.43, ry, rz, 0, 0, PI / 2));
  for (const x of [-0.56, -0.3]) { b.add(M.galv, new THREE.TorusGeometry(0.077, 0.004, 4, 28), T(x, ry, rz, 0, PI / 2, 0)); b.box(M.galv, 0.03, ry - 0.07 - y0, 0.1, T(x, (ry - 0.07 + y0) / 2, rz)); }
  b.box(E.brass, 0.04, 0.04, 0.04, T(-0.6, ry + 0.09, rz), 0.004).cyl(E.brass, 0.012, 0.03, T(-0.6, ry + 0.125, rz), 6);
  // Línea de líquido: recibidor → filtro → visor → válvula de servicio
  b.add(M.copper, tube([[-0.6, ry + 0.11, rz], [-0.6, ry + 0.16, rz], [-0.62, 0.48, -0.3], [-0.66, 0.5, -0.32], [-0.7, 0.4, -0.32], [-0.73, 0.3, -0.32], [-0.79, 0.3, -0.32]], 0.008, 8));
  b.cyl(M.steel, 0.028, 0.18, T(-0.63, 0.5, -0.12, PI / 2), 18).add(M.steel, lathe([[0.001, 0.09], [0.012, 0.11], [0.028, 0.09]], 18), T(-0.63, 0.5, -0.12, PI / 2)).add(M.steel, lathe([[0.028, -0.09], [0.012, -0.11], [0.001, -0.09]], 18), T(-0.63, 0.5, -0.12, PI / 2));
  b.cyl(E.brass, 0.02, 0.06, T(-0.68, 0.45, -0.32, 0, 0, PI / 2), 12).add(E.sight, new THREE.CircleGeometry(0.012, 18), T(-0.68, 0.471, -0.32, -PI / 2));
  // Aspiración: válvula → compresor; descarga: compresor → colector de la batería
  b.add(M.copper, tube([[-0.79, 0.42, -0.2], [-0.7, 0.42, -0.2], [-0.66, 0.36, -0.05], [-0.65, 0.36, 0.1], [cpx - 0.18, y0 + 0.204, cpz]], 0.016, 12));
  b.add(M.copper, tube([[cpx, y0 + 0.52, cpz], [cpx, y0 + 0.62, cpz], [cpx + 0.12, 0.86, 0.1], [xd - 0.02, 0.92, 0.2], [xd + 0.03, 0.95, 0.39]], 0.011, 10));
  b.box(M.paintGrey, 0.05, 0.08, 0.04, T(xd - 0.03, 0.9, -0.2), 0.006).box(M.paintGrey, 0.05, 0.08, 0.04, T(xd - 0.03, 0.9, -0.12), 0.006);   // presostatos AP/BP
  b.flush(g);
  instances(g, ucyl(5), E.guard, wires);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.009, 14, 8, 0, TAU, 0, PI / 2).rotateX(PI / 2), ledMat()); led.position.set(-0.6, 1.02, ez + 0.072); g.add(led);
  // -- Reverberación del aire caliente sobre la descarga (sprite muy tenue con desplazamiento animado)
  const shT = tex(TX().shimmer, [1, 1]); shT.wrapS = THREE.ClampToEdgeWrapping;
  const sh = new THREE.Sprite(new THREE.SpriteMaterial({ map: shT, color: 0xfff4e0, transparent: true, opacity: 0, depthWrite: false })); sh.scale.set(0.75, 0.9, 1); sh.position.set(xf, y1 + 0.62, 0); g.add(sh);
  setPick(g, { kind: 'cond' });
  let t = 0, lastRun = false, ca = 0, cv = 0, heat = 0;
  function update(dt, st = {}) {
    t += dt; const run = !!st.run, ld = clamp(st.load ?? 1, 0, 1);
    fan.update(dt, run ? 0.55 + 0.45 * ld : 0);
    // Compresor: golpe de par al arrancar/parar (balanceo sobre los soportes) + vibración de giro a baja amplitud
    if (run !== lastRun) { cv += run ? 0.35 : -0.22; lastRun = run; }
    [ca, cv] = spring(ca, cv, 0, 240, 5, dt);
    const vib = run ? 0.0004 * (0.6 + 0.4 * ld) : 0;
    comp.position.set(cpx + vib * Math.sin(t * 307), y0 + 0.004 + 0.5 * vib * Math.sin(t * 263 + 1), cpz + vib * Math.cos(t * 293)); comp.rotation.set(0.12 * ca * Math.sin(t * 40), ca, 0);
    heat = lag(heat, run ? 0.5 + 0.5 * ld : 0, run ? 6 : 10, dt);
    sh.material.opacity = 0.05 * heat * fan.frac; shT.offset.y = (shT.offset.y - dt * (0.4 + 0.5 * heat)) % 1; shT.offset.x = 0.02 * Math.sin(t * 1.7);
    sh.scale.set(0.75 + 0.05 * Math.sin(t * 2.3), 0.9 + 0.08 * Math.sin(t * 1.3), 1);
    led.material.emissive.set(run ? 0x20ff40 : 0x20ff40); led.material.emissiveIntensity = run ? 1.8 : 0.2;
  }
  return { group: g, update, fan, compressor: comp, led, ports: { suction: new V3(vS[0] - 0.05, vS[1], vS[2]), liquid: new V3(vL[0] - 0.05, vL[1], vL[2]) } };
}

// ================================================================ PUERTA CORREDIZA FRIGORÍFICA + CORTINA DE TIRAS
// o: { w=2.5, h=3, wallT=0.15, strips (nº de tiras, auto) }
export function createSlidingDoor(o = {}) {
  const w = o.w ?? 2.5, h = o.h ?? 3, wallT = o.wallT ?? 0.15, M = materials(), E = EM(), g = new THREE.Group(); g.name = 'puerta';
  const LW = w + 0.2, LH = h + 0.1, LT = 0.12, gap = 0.012, xL0 = -(gap + LT / 2), y0 = 0.012, travel = LW - 0.08;
  const yTr = y0 + LH + 0.1, zA = -LW / 2 - 0.14, zB = LW / 2 + travel + 0.14, zh = -LW / 2 + 0.16, wy = 1.62;
  // -- Marco exterior de acero inoxidable, junta calefactada, revestimiento del vano y protecciones
  const b = bucket();
  for (const sz of [-1, 1]) b.box(M.steel, 0.012, h + 0.12, 0.12, T(-0.006, (h + 0.12) / 2, sz * (w / 2 + 0.06)), 0.004);
  b.box(M.steel, 0.012, 0.12, w + 0.24, T(-0.006, h + 0.06, 0), 0.004);
  const gk = new THREE.MeshStandardMaterial({ color: 0x23201f, emissive: 0x3a0e00, emissiveIntensity: 0.25, roughness: 0.8 });
  for (const sz of [-1, 1]) b.box(gk, 0.004, h + 0.02, 0.02, T(-0.013, (h + 0.02) / 2, sz * (LW / 2 - 0.02)));
  b.box(gk, 0.004, 0.02, LW - 0.04, T(-0.013, h + 0.07, 0));
  for (const sz of [-1, 1]) { b.box(M.steel, wallT, h, 0.002, T(wallT / 2, h / 2, sz * (w / 2 - 0.001))); b.box(E.hazard, wallT - 0.01, 1.0, 0.004, T(wallT / 2, 0.52, sz * (w / 2 - 0.003))); }
  b.box(M.steel, wallT, 0.002, w, T(wallT / 2, h - 0.001, 0)).box(M.steel, wallT + 0.04, 0.006, w, T(wallT / 2, 0.003, 0));
  // Guía de rodillos al suelo y defensa amarilla frente a la hoja abierta
  const zg = w / 2 + 0.2;
  b.box(M.steel, 0.22, 0.008, 0.1, T(xL0 - 0.01, 0.004, zg), 0.002);
  for (const sx of [-1, 1]) b.cyl(M.steel, 0.006, 0.05, T(xL0 + sx * (LT / 2 + 0.026), 0.03, zg), 8);
  for (const z of [w / 2 + 0.4, w / 2 + LW - 0.15]) { b.cyl(M.paintYellow, 0.05, 0.8, T(-0.45, 0.4, z), 20).box(M.paintYellow, 0.18, 0.01, 0.18, T(-0.45, 0.005, z), 0.003).add(M.paintYellow, lathe([[0.05, 0], [0.05, 0.01], [0.03, 0.04], [0.001, 0.045]], 20), T(-0.45, 0.8, z)); }
  b.rod(M.paintYellow, [-0.45, 0.45, w / 2 + 0.4], [-0.45, 0.45, w / 2 + LW - 0.15], 0.035, 16);
  // -- Riel superior (perfil C de aluminio), escuadras al muro, topes de goma
  b.add(M.alu, ext(sheet([[-0.018, 0], [-0.04, 0], [-0.04, 0.09], [0.04, 0.09], [0.04, 0], [0.018, 0]], 0.004), zB - zA), T(xL0, yTr, (zA + zB) / 2));
  for (let z = zA + 0.15; z < zB; z += 0.85) { b.box(M.steel, -xL0 - 0.04 + 0.004, 0.05, 0.05, T((xL0 + 0.04) / 2, yTr + 0.06, z)); b.box(M.steel, 0.006, 0.14, 0.08, T(-0.003, yTr + 0.06, z)); }
  for (const z of [zA + 0.02, zB - 0.02]) b.box(M.rubber, 0.05, 0.06, 0.04, T(xL0, yTr + 0.045, z), 0.008);
  // -- Operador: caja del motorreductor, poleas, correa dentada (dos ramales), cuadro de pulsadores dentro y fuera
  const zOp = zA + 0.36, xBelt = xL0 - 0.06, rP = 0.022, yBm = yTr + 0.045;
  b.box(E.opGrey, 0.2, 0.25, 0.64, T(-0.1, yTr + 0.23, zOp), 0.025).box(M.paintDark, 0.004, 0.012, 0.6, T(-0.201, yTr + 0.16, zOp));
  for (let k = 0; k < 7; k++) b.box(M.paintDark, 0.004, 0.06, 0.012, T(-0.201, yTr + 0.27, zOp + 0.12 + k * 0.022));
  b.add(plate(['24 V DC  ·  0.6 m/s', 'IP65  ·  CE'], { title: 'OPERADOR PC-01', w: 256, h: 96 }), new THREE.PlaneGeometry(0.16, 0.06), T(-0.2015, yTr + 0.27, zOp - 0.14, 0, -PI / 2, 0));
  for (const z of [zA + 0.08, zB - 0.08]) b.box(M.steel, 0.012, 0.07, 0.07, T(xBelt - 0.02, yBm, z), 0.004);
  const bp = (x, y, z, sx) => { // botonera: caja, pulsador verde, negro y seta de emergencia
    b.box(M.paintGrey, 0.07, 0.3, 0.12, T(x, y, z), 0.012);
    b.cyl(E.btnGreen, 0.018, 0.02, T(x + sx * 0.04, y + 0.08, z, 0, 0, PI / 2), 18).cyl(E.btnBlack, 0.018, 0.02, T(x + sx * 0.04, y + 0.01, z, 0, 0, PI / 2), 18);
    b.cyl(M.paintYellow, 0.032, 0.006, T(x + sx * 0.037, y - 0.08, z, 0, 0, PI / 2), 24).add(E.btnRed, lathe([[0.001, 0], [0.012, 0], [0.012, 0.025], [0.026, 0.03], [0.028, 0.038], [0.02, 0.046], [0.001, 0.048]], 20), T(x + sx * 0.035, y - 0.08, z, 0, 0, -sx * PI / 2));
  };
  bp(-0.035, 1.35, -w / 2 - 0.45, -1); bp(wallT + 0.035, 1.35, -w / 2 - 0.25, 1);
  b.add(E.cable, tube([[-0.035, 1.5, -w / 2 - 0.45], [-0.035, h + 0.2, -w / 2 - 0.45], [-0.03, yTr + 0.15, zOp - 0.33], [-0.03, yTr + 0.15, zOp - 0.3]], 0.006, 6));
  b.flush(g);
  // Correa: dos ramales con textura desplazable; poleas de arrastre y reenvío
  const beltT = [0, 1].map(() => { const t2 = tex(TX().belt, [(zB - zA - 0.16) / 0.06, 1]); return t2; });
  const belts = [yBm + rP, yBm - rP].map((y, i) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.022, zB - zA - 0.16), new THREE.MeshStandardMaterial({ map: beltT[i], roughness: 0.8 })); m.position.set(xBelt, y, (zA + zB) / 2); g.add(m); return m; });
  const pulG = lathe([[0.001, -0.013], [rP + 0.004, -0.013], [rP + 0.004, -0.011], [rP, -0.01], [rP, 0.01], [rP + 0.004, 0.011], [rP + 0.004, 0.013], [0.001, 0.013]], 24).rotateZ(PI / 2);
  const pulleys = [zA + 0.08, zB - 0.08].map((z) => { const m = new THREE.Mesh(pulG, M.alu); m.position.set(xBelt, yBm, z); m.castShadow = true; g.add(m); return m; });
  // -- Hoja: panel aislante de 120 mm con canto redondeado, visor de doble vidrio, embellecedores, tiradores, burletes
  const leaf = new THREE.Group(); leaf.position.x = xL0; g.add(leaf);
  const lb = bucket(), L2 = LH / 2 + y0;
  lb.add(E.door, extH(rr(LW, LH, 0.035, 0, 0, 4), [rr(0.5, 0.5, 0.05, 0, wy - L2, 3)], LT - 0.024, 0.012), T(0, L2, 0, 0, -PI / 2, 0));
  lb.add(M.steel, extH(rr(LW + 0.002, LH + 0.002, 0.036), [rr(LW - 0.05, LH - 0.05, 0.02)], 0.0025), T(-LT / 2 - 0.0013, L2, 0, 0, -PI / 2, 0));
  lb.box(M.steel, 0.002, 0.46, LW - 0.06, T(-LT / 2 - 0.0012, y0 + 0.27, 0)).box(M.steel, 0.002, 0.46, LW - 0.12, T(LT / 2 + 0.013, y0 + 0.27, 0));
  for (const sx of [-1, 1]) lb.add(M.steel, extH(rr(0.62, 0.62, 0.075), [rr(0.5, 0.5, 0.05)], 0.006, 0.0015), T(sx * (LT / 2 + 0.002), wy, 0, 0, -PI / 2, 0));
  for (const sx of [-1, 1]) lb.box(E.glass, 0.006, 0.5, 0.5, T(sx * 0.028, wy, 0));
  lb.box(M.paintDark, 0.05, 0.012, 0.5, T(0, wy - 0.245, 0)).box(M.paintDark, 0.05, 0.012, 0.5, T(0, wy + 0.245, 0));
  lb.add(M.rubber, extH(rr(LW - 0.01, LH - 0.01, 0.03), [rr(LW - 0.07, LH - 0.07, 0.012)], 0.011, 0.003), T(LT / 2 + 0.006, L2, 0, 0, -PI / 2, 0));
  lb.box(M.rubber, 0.07, 0.012, LW - 0.1, T(0, 0.006, 0));
  // Tirador exterior vertical con distanciadores y bombín
  const hx = -LT / 2 - 0.065;
  lb.rod(M.steel, [hx, 0.78, zh], [hx, 1.62, zh], 0.016, 20);
  for (const y of [0.78, 1.62]) { lb.add(M.steel, new THREE.SphereGeometry(0.016, 16, 8), T(hx, y, zh)); }
  for (const y of [0.86, 1.54]) { lb.rod(M.steel, [-LT / 2, y, zh], [hx, y, zh], 0.011, 14); lb.cyl(M.steel, 0.024, 0.006, T(-LT / 2 - 0.003, y, zh, 0, 0, PI / 2), 20); }
  lb.add(M.chrome, lathe([[0.001, 0], [0.016, 0], [0.016, 0.006], [0.012, 0.012], [0.001, 0.012]], 18).rotateZ(PI / 2), T(-LT / 2 - 0.001, 1.08, zh + 0.11));
  // Tirador empotrado interior + desbloqueo de seguridad rojo con placa
  lb.box(M.steel, 0.004, 0.32, 0.12, T(LT / 2 + 0.002, 1.2, zh + 0.02), 0.003).box(M.paintDark, 0.003, 0.26, 0.07, T(LT / 2 + 0.0035, 1.2, zh + 0.02)).box(M.steel, 0.012, 0.26, 0.012, T(LT / 2 + 0.008, 1.2, zh + 0.05), 0.003);
  lb.box(M.paintYellow, 0.004, 0.16, 0.16, T(LT / 2 + 0.002, 0.95, zh + 0.26), 0.003);
  lb.add(E.btnRed, lathe([[0.001, 0], [0.014, 0], [0.014, 0.045], [0.034, 0.05], [0.04, 0.062], [0.032, 0.075], [0.001, 0.078]], 24).rotateZ(-PI / 2), T(LT / 2 + 0.004, 0.95, zh + 0.26));
  lb.add(plate(['TIRE PARA ABRIR', 'PULL TO OPEN'], { w: 256, h: 64, bg: '#f2c200', border: '#111', title: null }), new THREE.PlaneGeometry(0.16, 0.04), T(LT / 2 + 0.0045, 1.07, zh + 0.26, 0, PI / 2, 0));
  lb.add(plate(['CÁMARA 01  ·  −20 °C', 'CIERRE AUTOMÁTICO'], { title: 'PRECAUCIÓN', tbg: '#1f5fa8', h: 96 }), new THREE.PlaneGeometry(0.32, 0.12), T(-LT / 2 - 0.0028, 2.1, 0.0, 0, -PI / 2, 0));
  // Defensa de canto, colgadores de los carros, brida de la correa
  lb.box(M.rubber, 0.08, 0.6, 0.025, T(0, 0.45, -LW / 2 - 0.01), 0.01);
  const zTr = [-LW / 2 + 0.35, LW / 2 - 0.35];
  for (const z of zTr) { lb.box(M.steel, 0.08, 0.06, 0.12, T(0, y0 + LH + 0.03, z), 0.004); lb.rod(M.steel, [0, y0 + LH + 0.05, z], [0, yTr + 0.035, z], 0.008, 10); }
  lb.box(M.steel, 0.06, 0.012, 0.05, T(-0.03, y0 + LH + 0.006, -LW / 2 + 0.25)).box(M.steel, 0.008, yBm - rP - y0 - LH + 0.01, 0.05, T(xBelt - xL0 + 0.004, (yBm - rP + y0 + LH) / 2, -LW / 2 + 0.25));
  lb.flush(leaf);
  // -- Carros de rodadura (dos ruedas de nylon por labio del riel)
  const trol = new THREE.Group(); g.add(trol);
  const tb = bucket(), wheels = [], wG = lathe([[0.008, -0.01], [0.026, -0.01], [0.03, -0.006], [0.03, 0.006], [0.026, 0.01], [0.008, 0.01]], 24).rotateZ(PI / 2), rW = 0.03;
  for (const z of zTr) {
    tb.box(M.galv, 0.012, 0.05, 0.14, T(xL0, yTr + 0.045, z), 0.003);
    for (const dz of [-0.045, 0.045]) { tb.rod(M.steel, [xL0 - 0.03, yTr + 0.034, z + dz], [xL0 + 0.03, yTr + 0.034, z + dz], 0.005, 8); for (const sx of [-1, 1]) { const m = new THREE.Mesh(wG, E.nylon); m.position.set(xL0 + sx * 0.023, yTr + 0.034, z + dz); m.castShadow = true; trol.add(m); wheels.push(m); } }
  }
  tb.flush(trol);
  const roll = [-1, 1].map((sx) => { const m = new THREE.Mesh(lathe([[0.001, 0], [0.014, 0], [0.016, 0.004], [0.016, 0.03], [0.014, 0.034], [0.001, 0.034]], 16), E.nylon); m.position.set(xL0 + sx * (LT / 2 + 0.026), 0.012, zg); g.add(m); return m; });
  // -- Baliza giratoria sobre el operador: base, cúpula ámbar, reflector giratorio, lámpara y halo
  const bx = -0.1, by = yTr + 0.355, bz = zA + 0.2;
  const bb = bucket(); bb.add(M.plastic, lathe([[0.001, 0], [0.06, 0], [0.062, 0.01], [0.056, 0.03], [0.001, 0.03]], 28), T(bx, by, bz)); bb.flush(g);
  const lens = new THREE.Mesh(lathe([[0.054, 0.03], [0.054, 0.1], [0.05, 0.13], [0.038, 0.152], [0.018, 0.162], [0.001, 0.165]], 28), E.lamp.clone()); lens.position.set(bx, by, bz); g.add(lens);
  const refl = new THREE.Group(); refl.position.set(bx, by + 0.085, bz); g.add(refl);
  const rm = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.07, 18, 1, true, 0, PI), new THREE.MeshStandardMaterial({ color: 0xe8edf2, metalness: 1, roughness: 0.1, side: THREE.DoubleSide })); refl.add(rm);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: 0x664410, toneMapped: false })); bulb.position.set(0, 0, 0.012); refl.add(bulb);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX().glow, color: 0xffa020, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); halo.scale.set(0.6, 0.6, 1); halo.position.set(bx, by + 0.09, bz); g.add(halo);
  // -- Cortina de tiras de PVC (InstancedMesh). Cada tira: péndulo amortiguado propio + flexión (sombreador)
  const nS = o.strips ?? Math.max(8, Math.round((w + 0.1) / 0.1)), sw = 0.2, sl = h - 0.012, pitch = (w + 0.1 - sw) / (nS - 1), xc = wallT + 0.05;
  const sg = new THREE.PlaneGeometry(sw, sl, 1, 14); sg.translate(0, -sl / 2, 0); sg.rotateY(PI / 2);
  const aBend = new THREE.InstancedBufferAttribute(new Float32Array(nS), 1); sg.setAttribute('aBend', aBend);
  const sm = new THREE.MeshStandardMaterial({ color: 0xcfe9f7, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false, roughness: 0.12, metalness: 0.0, normalMap: TX().ribsN, normalScale: new THREE.Vector2(0.9, 0.9), envMapIntensity: 1.4 });
  sm.onBeforeCompile = (s2) => { s2.vertexShader = s2.vertexShader.replace('#include <common>', '#include <common>\nattribute float aBend;').replace('#include <begin_vertex>', `#include <begin_vertex>\nfloat yn = clamp(-position.y / ${sl.toFixed(3)}, 0.0, 1.0);\ntransformed.x += aBend * yn * yn;`); };
  const strips = new THREE.InstancedMesh(sg, sm, nS); strips.frustumCulled = false; strips.castShadow = false; strips.renderOrder = 2; g.add(strips);
  const clips = new THREE.InstancedMesh(new THREE.BoxGeometry(0.016, 0.045, sw - 0.012), M.steel, nS); clips.frustumCulled = false; g.add(clips);
  const cb = bucket(); cb.box(M.steel, 0.012, 0.05, w + 0.3, T(xc, h + 0.03, 0)); for (const z of [-w / 2 - 0.1, 0, w / 2 + 0.1]) cb.box(M.steel, xc - wallT, 0.04, 0.04, T((xc + wallT) / 2, h + 0.03, z)); const curtainRail = cb.flush(g);
  const SP = Array.from({ length: nS }, (_, i) => ({ z: -(w + 0.1) / 2 + sw / 2 + i * pitch, x: xc + (i % 2 ? 0.0045 : -0.0045), k: 4.6 * (0.8 + 0.4 * hash(i + 1.7)), c: 0.55 + 0.35 * hash(i + 3.3), ph: hash(i + 9.1) * TAU, a: 0, va: 0, s: 0, vs: 0, bnd: 0, vb: 0 }));
  const sM = new THREE.Matrix4(), sQ = new THREE.Quaternion(), sE = new THREE.Euler(0, 0, 0, 'ZXY'), sV = new V3(), s1 = new V3(1, 1, 1);
  setPick(g, { kind: 'door' });
  // -- Estado de animación
  let t = 0, x = 0, vel = 0, q = 0, qv = 0, bw = 0, ba = 0, fl = 0;
  function update(dt, st = {}) {
    t += dt; const frac = clamp(st.frac ?? 0, 0, 1), cmd = !!st.cmd;
    // Perfil de motor: aceleración y frenado limitados hacia la posición del simulador (que se mueve linealmente);
    // los últimos 5 cm del cierre se hacen a velocidad de aproximación lenta (cierre suave) y el burlete amortigua el impacto.
    const n2 = Math.max(1, Math.ceil(dt / 0.01)), h2 = dt / n2;
    for (let i = 0; i < n2; i++) {
      const rem = frac - x, dir = Math.sign(rem) || 1, dist = Math.abs(rem);
      let sp = vel * dir; const creep = dir < 0 && x < 0.05 / travel + 0.02 && frac < 0.001;
      sp = approach(sp, dist, creep ? 0.05 : 0.25, 0.32, 0.42, h2);
      if (frac >= 0.999 && dir > 0 && dist > 1e-4 && dist < 0.02) sp = Math.max(sp, 0.03);
      if (creep) sp = Math.max(Math.min(sp, 0.035), 0.02);
      vel = sp * dir; x += vel * h2;
      if (x <= 0 && vel < 0) { qv += vel * 1.6; x = 0; vel = 0; } else if (x >= 1 && vel > 0) { qv += vel * 0.8; x = 1; vel = 0; }
      if (dist < 1e-4 && Math.abs(vel) < 0.02 && frac > 0.001 && frac < 0.999) { x = frac; vel = 0; }
      [q, qv] = spring(q, qv, 0, 420, 9, h2);
    }
    const xv = x + q, zz = xv * travel, pull = smoothstep((xv * travel) / 0.12);
    leaf.position.set(xL0 - 0.018 * pull, 0.007 * pull, zz); trol.position.z = zz;
    for (const m of wheels) m.rotation.x = -zz / rW;
    for (const m of pulleys) m.rotation.x = -zz / rP;
    for (const r of roll) r.rotation.y = zz / 0.016;
    beltT[1].offset.x = -zz / 0.06; beltT[0].offset.x = zz / 0.06;
    // Baliza: gira y destella mientras hay orden de apertura o la hoja no está cerrada
    const active = cmd || x > 0.002 || Math.abs(vel) > 1e-3;
    bw = lag(bw, active ? 2.2 * TAU : 0, active ? 0.35 : 0.8, dt); ba += bw * dt; refl.rotation.y = ba;
    fl = lag(fl, active ? 1 : 0, 0.15, dt);
    const beam = Math.pow(Math.max(0, Math.cos(ba)), 6), on = fl * (0.35 + 0.65 * beam);
    lens.material.emissiveIntensity = 0.15 + 2.4 * on; halo.material.opacity = 0.75 * on; bulb.material.color.setRGB(0.4 + 0.6 * fl, 0.27 + 0.45 * fl, 0.06 + 0.2 * fl);
    // Cortina: el aire frío sale por abajo al abrir (empuja la parte baja hacia −X) con ráfagas; el montacargas aparta las
    // tiras (dirección de avance) y las separa lateralmente; cada tira responde con su propia rigidez y amortiguamiento.
    const on2 = st.curtain !== false; strips.visible = clips.visible = on2; curtainRail.forEach((m) => { m.visible = on2; });
    if (!on2) return;
    const air = smoothstep(xv * 1.4), near = clamp(st.forkliftNear ?? 0, 0, 1), fz = st.forkliftZ ?? 0, fd = Math.sign(st.forkliftDir ?? 1) || 1;
    for (let i = 0; i < nS; i++) {
      const p = SP[i], gust = 0.6 + 0.4 * Math.sin(t * 1.3 + p.ph) * Math.sin(t * 0.47 + 2.1 * p.ph);
      let ta = -0.11 * air * gust, ts = 0.025 * air * Math.sin(t * 0.9 + p.ph), tb2 = -0.05 * air * gust;
      const dz = Math.abs(p.z - fz);
      if (near > 0 && dz < 0.8) { const f = Math.pow(1 - dz / 0.8, 0.7); ta += fd * 1.05 * near * f; ts += -Math.sign(p.z - fz || 1) * 0.18 * near * f; tb2 += fd * 0.2 * near * f; }
      [p.a, p.va] = spring(p.a, p.va, ta, p.k, p.c, dt); [p.s, p.vs] = spring(p.s, p.vs, ts, p.k * 1.3, p.c * 1.2, dt); [p.bnd, p.vb] = spring(p.bnd, p.vb, tb2, 30, 4, dt);
      const tw = 0.3 * Math.sin(t * 1.7 + p.ph) * Math.min(1, Math.abs(p.a) * 2.5);
      sQ.setFromEuler(sE.set(p.s, tw, p.a)); sM.compose(sV.set(p.x, h + 0.005, p.z), sQ, s1); strips.setMatrixAt(i, sM); clips.setMatrixAt(i, sM); aBend.array[i] = p.bnd;
    }
    strips.instanceMatrix.needsUpdate = clips.instanceMatrix.needsUpdate = true; aBend.needsUpdate = true;
  }
  update(0, {});
  return { group: g, update, leaf, strips, travel, size: { LW, LH, LT } };
}

// ================================================================ DEMO (banco de pruebas: ?m=equipment[&only=evap|cond|door][&t0=s])
export function demo(scene) {
  const q = new URLSearchParams(location.search), only = q.get('only'), t0 = +(q.get('t0') || 0), M = materials();
  const g = new THREE.Group(); scene.add(g);
  const ev = createEvaporator(), cu = createCondensingUnit(), dr = createSlidingDoor();
  const ctxM = new THREE.MeshStandardMaterial({ color: 0xdfe4e8, roughness: 0.7 });
  if (!only || only === 'evap') { g.add(ev.group); ev.group.position.set(only ? 0 : 0.5, 3.2, only ? 0 : -3); const c = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 4.6), ctxM); c.position.set(ev.group.position.x, 3.25, ev.group.position.z); c.receiveShadow = true; g.add(c); }
  if (!only || only === 'cond') { g.add(cu.group); cu.group.position.set(only ? 0 : 3.6, 0, only ? 0 : 1.5); }
  if (!only || only === 'door') {
    g.add(dr.group); dr.group.position.set(only ? 0 : -3, 0, only ? 0 : 0.5);
    const wg = new THREE.Group(); wg.position.copy(dr.group.position); g.add(wg);
    for (const [z0, z1] of [[-3.2, -1.25], [1.25, 6.0]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.15, 4, z1 - z0), ctxM); m.position.set(0.075, 2, (z0 + z1) / 2); m.receiveShadow = m.castShadow = true; wg.add(m); }
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1, 2.5), ctxM); top.position.set(0.075, 3.5, 0); wg.add(top);
  }
  console.log('TRIS', JSON.stringify({ evap: triCount(ev.group), cond: triCount(cu.group), door: triCount(dr.group) }));
  window.__equip = { ev, cu, dr };
  let T0 = 0, frost = 0.2, frac = 0;
  const step = (dt) => {
    T0 += dt; const c = T0 % 40;
    const def = c >= 20 && c < 30, fanOn = c < 12 || c >= 30;
    frost = def ? Math.max(0, frost - dt / 6) : Math.min(1, frost + dt / 25);
    ev.update(dt, { fanFrac: fanOn ? 1 : 0, fail: c >= 30, defrost: def, frost, run: fanOn ? 1 : 0 });
    cu.update(dt, { run: fanOn, load: 0.5 + 0.5 * Math.sin(T0 * 0.3) });
    const d = T0 % 20, cmd = d > 2 && d < 11; frac = clamp(frac + ((cmd ? 1 : -1) * dt) / 4, 0, 1);
    dr.update(dt, { frac, cmd, curtain: true, forkliftNear: Math.exp(-(((d - 7) / 0.9) ** 2)), forkliftZ: 0.2, forkliftDir: 1 });
  };
  for (let k = 0; k < t0 * 30; k++) step(1 / 30);
  return (dt) => step(dt);
}
