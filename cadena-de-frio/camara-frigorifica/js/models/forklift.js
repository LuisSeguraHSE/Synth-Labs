// MONTACARGAS ELÉCTRICO CONTRAPESADO (clase 1,6 t, versión cámara frigorífica) con operador sentado.
// Geometría procedural detallada (chasis y contrapeso extruidos con bisel, techo protector de tubo, mástil dúplex
// con perfiles C, cilindros, cadenas instanciadas sobre poleas, tablero portahorquillas, horquillas forjadas) y
// animación físicamente plausible (cinemática de bicicleta con dirección trasera, perfiles de velocidad con
// aceleración y sobreaceleración limitadas, resorte-amortiguador del chasis, elevación con rampa).
//
// CONVENCIONES
//  · Origen del grupo = suelo, centro del eje DELANTERO (motriz). +X local = hacia las horquillas (adelante),
//    +Y arriba, +Z = lado derecho del operador. Unidades: m, s, rad.
//  · Rumbo (heading) = atan2(dz, dx) en la escena (igual que Path2 y scene3d): group.rotation.y = −heading.
//  · Altura de horquilla h = cara SUPERIOR de la pala (= base del pallet), con el mástil a 0°.
//  · FORK.palletOffset = distancia en +X del origen al centro del pallet (1,2 m a lo largo de la horquilla);
//    rig.loadAnchor (Object3D en el portahorquillas) da la pose exacta de la base del pallet con inclinación y cabeceo.
import { THREE, PI, TAU, rbox, extrude, roundRectPts, lathe, tire, rim, mergeT, T, canvas, tex, normalFrom, hash, materials,
  clamp, lerp, smootherstep, wrapAngle, lag, spring, approach, Path2 } from './kit.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------- Dimensiones (m)
const WB = 1.40, RF = 0.235, WF = 0.20, TF = 0.44, RR = 0.19, WR = 0.13, KP = 0.29, KO = 0.065;
const MX = 0.30, MY = 0.24;                // pivote de inclinación del mástil (pie del mástil sobre el eje delantero)
const HMIN = 0.05, HMAX = 3.5, FREE = 0.20; // elevación mín/máx y elevación libre (el mástil interior sube a mitad de velocidad después)
const HEEL = 0.575, FLEN = 1.15, FZ = 0.30, PAL = 1.2;
const MAXS = 75 * PI / 180, SW_RATIO = 12; // ángulo máx. de las ruedas traseras y relación volante/rueda
const TILT_MIN = -6 * PI / 180, TILT_MAX = 3 * PI / 180;
export const FORK = { heel: HEEL, length: FLEN, tipOffset: HEEL + FLEN, palletOffset: HEEL + PAL / 2, spread: 2 * FZ, wheelbase: WB, minLift: HMIN, maxLift: HMAX, parkLift: 0.075, frontWheelR: RF, rearWheelR: RR };

// ---------------------------------------------------------------- Utilidades de geometría
const V3 = (x, y, z) => new THREE.Vector3(x, y, z), Y = V3(0, 1, 0);
const crease = (g, a = 0.6) => toCreasedNormals(g, a);
const ex = (pts, len, bev = 0, seg = 2, a = 0.6) => crease(extrude(pts, len, bev, seg), a);
const arc = (cx, cy, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
// Redondea esquinas de un polígono (r por vértice o común) con Bézier cuadrática
function fillet(pts, rs, n = 5) {
  const out = [], N = pts.length;
  for (let i = 0; i < N; i++) {
    const r = Array.isArray(rs) ? rs[i] : rs, p = pts[i];
    if (!r) { out.push(p); continue; }
    const a = pts[(i + N - 1) % N], b = pts[(i + 1) % N], d1 = [a[0] - p[0], a[1] - p[1]], d2 = [b[0] - p[0], b[1] - p[1]], l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
    const t = Math.min(r, l1 * 0.48, l2 * 0.48), p1 = [p[0] + (d1[0] / l1) * t, p[1] + (d1[1] / l1) * t], p2 = [p[0] + (d2[0] / l2) * t, p[1] + (d2[1] / l2) * t];
    for (let k = 0; k <= n; k++) { const u = k / n, w0 = (1 - u) ** 2, w1 = 2 * u * (1 - u), w2 = u * u; out.push([w0 * p1[0] + w1 * p[0] + w2 * p2[0], w0 * p1[1] + w1 * p[1] + w2 * p2[1]]); }
  }
  return out;
}
// Prisma vertical: perfil en planta (x, z) extruido a lo largo de Y entre y0 e y1
function prismY(pts, y0, y1, bev = 0) { const g = extrude(pts.map(([x, z]) => [x, -z]), y1 - y0, bev, 1); g.rotateX(-PI / 2); g.translate(0, (y0 + y1) / 2, 0); return crease(g, 0.5); }
// Perfil C (x = fondo, z = ancho; alma en +z, abierto hacia −z); s = −1 lo refleja
const cProf = (d, w, tw, tf, s = 1) => [[-d / 2, -w / 2], [-d / 2, w / 2], [d / 2, w / 2], [d / 2, -w / 2], [d / 2 - tf, -w / 2], [d / 2 - tf, w / 2 - tw], [-d / 2 + tf, w / 2 - tw], [-d / 2 + tf, -w / 2]].map(([x, z]) => [x, z * s]);
// Barrido de un perfil rectangular redondeado por una polilínea plana con codos (1 anillo por tramo recto, arcSeg por codo)
function sweep(pts, r, w, h, nrm, arcSeg = 6) {
  const P = pts.map((p) => V3(...p)), N = V3(...nrm).normalize(), C = [P[0]];
  for (let i = 1; i < P.length - 1; i++) {
    const a = P[i - 1], b = P[i], c = P[i + 1], p1 = b.clone().addScaledVector(b.clone().sub(a).normalize(), -r), p2 = b.clone().addScaledVector(c.clone().sub(b).normalize(), r);
    for (let k = 0; k <= arcSeg; k++) { const u = k / arcSeg; C.push(p1.clone().multiplyScalar((1 - u) ** 2).addScaledVector(b, 2 * u * (1 - u)).addScaledVector(p2, u * u)); }
  }
  C.push(P[P.length - 1]);
  const prof = roundRectPts(w, h, Math.min(w, h) * 0.25, 2), np = prof.length, pos = [], idx = [], n = C.length;
  const ring = (i) => { const t = (i === 0 ? C[1].clone().sub(C[0]) : i === n - 1 ? C[i].clone().sub(C[i - 1]) : C[i + 1].clone().sub(C[i - 1])).normalize(), nn = t.clone().cross(N).normalize(); for (const [x, y] of prof) pos.push(C[i].x + nn.x * x + N.x * y, C[i].y + nn.y * x + N.y * y, C[i].z + nn.z * x + N.z * y); };
  for (let i = 0; i < n; i++) ring(i);
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < np; j++) { const a = i * np + j, b = i * np + ((j + 1) % np); idx.push(a, a + np, b, b, a + np, b + np); }
  for (const [i, sg] of [[0, 1], [n - 1, -1]]) { const o = pos.length / 3; ring(i); pos.push(C[i].x, C[i].y, C[i].z); for (let j = 0; j < np; j++) { const a = o + j, b = o + ((j + 1) % np); sg > 0 ? idx.push(o + np, a, b) : idx.push(o + np, b, a); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
const cyl = (r, len, seg = 12, open = false) => new THREE.CylinderGeometry(r, r, len, seg, 1, open);
// Matriz que orienta el eje Y de una pieza del punto a al punto b (centro en el medio)
const seg2 = (a, b) => { const A = V3(...a), B = V3(...b), d = B.clone().sub(A), q = new THREE.Quaternion().setFromUnitVectors(Y, d.clone().normalize()); return new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), q, V3(1, 1, 1)); };
const lenAB = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
const rod = (a, b, r, s = 10) => [cyl(r, lenAB(a, b), s), seg2(a, b)];
// Colorea una geometría (atributo color) para materiales con vertexColors
function col(g, hex) { g = g.index ? g.toNonIndexed() : g.clone(); const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }

// Cubo de fusión por material
class Bk {
  constructor() { this.m = new Map(); }
  put(mat, g, m) { let l = this.m.get(mat); if (!l) this.m.set(mat, (l = [])); l.push([g, m || null]); return this; }
  flush(parent, shadow = true) { const out = []; for (const [mat, l] of this.m) { const me = new THREE.Mesh(mergeT(l), mat); me.castShadow = shadow; me.receiveShadow = true; parent.add(me); out.push(me); } this.m.clear(); return out; }
}

// ---------------------------------------------------------------- Materiales y texturas propios
let _FM = null;
function fkMaterials() {
  if (_FM) return _FM;
  const M = materials(), std = (o) => new THREE.MeshStandardMaterial(o);
  // Atlas de calcomanías 1024×512: marca, modelo, franjas de peligro, rótulo de frío, pictograma, placa de carga
  const atlas = canvas(1024, 512, (g) => {
    g.clearRect(0, 0, 1024, 512);
    const txt = (s, x, y, px, c = '#fff', w = '800', al = 'left') => { g.font = `${w} ${px}px system-ui, Arial`; g.fillStyle = c; g.textAlign = al; g.textBaseline = 'middle'; g.fillText(s, x, y); };
    // A (0,0,512,128) marca con flecha
    g.fillStyle = '#16181b'; g.beginPath(); g.moveTo(8, 30); g.lineTo(70, 30); g.lineTo(98, 64); g.lineTo(70, 98); g.lineTo(8, 98); g.lineTo(36, 64); g.fill();
    txt('SYNTHLIFT', 104, 66, 60, '#16181b', '900');
    // B (512,0,256,128) modelo
    txt('E16 C', 520, 46, 54, '#16181b', '900'); txt('COLD STORE · 1600 kg', 522, 100, 22, '#16181b', '700');
    // C (0,128,512,128) franjas de peligro
    g.save(); g.beginPath(); g.rect(0, 128, 512, 128); g.clip(); g.fillStyle = '#f2b90f'; g.fillRect(0, 128, 512, 128); g.fillStyle = '#121416';
    for (let x = -160; x < 560; x += 64) { g.beginPath(); g.moveTo(x, 256); g.lineTo(x + 32, 256); g.lineTo(x + 160, 128); g.lineTo(x + 128, 128); g.fill(); } g.restore();
    // D (512,128,256,128) rótulo de frío
    g.fillStyle = '#1d5fb0'; g.beginPath(); g.roundRect(516, 132, 248, 120, 14); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 5; for (let k = 0; k < 3; k++) { const a = (k * PI) / 3; g.beginPath(); g.moveTo(574 - 34 * Math.cos(a), 192 - 34 * Math.sin(a)); g.lineTo(574 + 34 * Math.cos(a), 192 + 34 * Math.sin(a)); g.stroke(); }
    txt('−30 °C', 618, 172, 40, '#fff', '900'); txt('FRIGO', 620, 218, 30, '#cfe3ff', '800');
    // E (768,0,256,256) pictograma: prohibido llevar pasajeros
    g.fillStyle = '#fff'; g.beginPath(); g.arc(896, 128, 120, 0, TAU); g.fill(); g.strokeStyle = '#c62828'; g.lineWidth = 22; g.beginPath(); g.arc(896, 128, 104, 0, TAU); g.stroke();
    g.fillStyle = '#16181b'; g.beginPath(); g.arc(880, 82, 16, 0, TAU); g.fill(); g.fillRect(866, 100, 28, 60); g.fillRect(866, 156, 12, 40); g.fillRect(884, 156, 12, 40);
    g.beginPath(); g.moveTo(856, 104); g.lineTo(824, 140); g.lineTo(832, 146); g.lineTo(866, 116); g.fill();
    g.strokeStyle = '#c62828'; g.lineWidth = 20; g.beginPath(); g.moveTo(822, 54); g.lineTo(970, 202); g.stroke();
    // F (0,256,384,192) placa de capacidad
    g.fillStyle = '#e9edf1'; g.fillRect(4, 260, 376, 184); g.strokeStyle = '#16181b'; g.lineWidth = 4; g.strokeRect(6, 262, 372, 180);
    txt('CAPACIDAD NOMINAL', 192, 286, 22, '#16181b', '800', 'center');
    [['c = 500 mm', '1600 kg'], ['h = 3300 mm', '1450 kg'], ['Batería', '48 V · 625 Ah'], ['Peso', '3020 kg']].forEach(([a, b], i) => { txt(a, 20, 326 + i * 30, 20, '#333', '600'); txt(b, 360, 326 + i * 30, 20, '#16181b', '800', 'right'); });
    // G (384,256,256,64) aviso de aplastamiento
    g.fillStyle = '#f2b90f'; g.fillRect(388, 260, 248, 56); g.fillStyle = '#16181b'; g.beginPath(); g.moveTo(412, 304); g.lineTo(436, 266); g.lineTo(460, 304); g.fill();
    txt('!', 436, 292, 26, '#f2b90f', '900', 'center'); txt('NO PASAR BAJO', 470, 288, 20, '#16181b', '900');
  });
  const atlasT = tex(atlas); atlasT.wrapS = atlasT.wrapT = THREE.ClampToEdgeWrapping;
  // Placa antideslizante (lagrimado) y alfombra de goma estriada
  const tear = canvas(128, 128, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.save(); g.translate(x * 32 + (y % 2) * 16 + 16, y * 32 + 16); g.rotate((x + y) % 2 ? 0.8 : -0.8); const gr = g.createRadialGradient(0, 0, 0, 0, 0, 12); gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.scale(1, 0.32); g.beginPath(); g.arc(0, 0, 12, 0, TAU); g.fill(); g.restore(); } });
  const ribs = canvas(64, 64, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 8) { const gr = g.createLinearGradient(x, 0, x + 6, 0); gr.addColorStop(0, '#000'); gr.addColorStop(0.5, '#fff'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(x, 0, 6, h); } });
  const glow = (c0) => tex(canvas(128, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, c0); gr.addColorStop(0.35, c0.replace('1)', '0.55)')); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }));
  const beam = tex(canvas(16, 128, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(120,170,255,0.9)'); gr.addColorStop(1, 'rgba(60,110,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }));
  _FM = {
    body: M.paintYellow, dark: std({ color: 0x1e2227, roughness: 0.55, metalness: 0.35, roughnessMap: M.roughT }), grey: M.paintGrey, steel: M.steel, chrome: M.chrome, rubber: M.rubber, plastic: M.plastic,
    rimP: std({ color: 0xd9dde2, roughness: 0.4, metalness: 0.35 }),
    forged: std({ color: 0x2c3034, roughness: 0.48, metalness: 0.7, normalMap: M.brushedN, normalScale: new THREE.Vector2(0.4, 0.4) }),
    chain: std({ color: 0x5d636b, roughness: 0.38, metalness: 0.9 }),
    vinyl: std({ color: 0x17191c, roughness: 0.62, metalness: 0.05 }),
    mat: std({ color: 0x202326, roughness: 0.9, metalness: 0, normalMap: normalFrom(ribs, 3, [10, 1]) }),
    plate: std({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.85, normalMap: normalFrom(tear, 4, [4, 1]) }),
    decal: new THREE.MeshStandardMaterial({ map: atlasT, transparent: true, alphaTest: 0.04, roughness: 0.45, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    mirror: std({ color: 0x9fb2c4, roughness: 0.04, metalness: 1 }),
    ledW: new THREE.MeshStandardMaterial({ color: 0xf4f8ff, emissive: 0xeaf3ff, emissiveIntensity: 0, roughness: 0.15 }),
    ledR: new THREE.MeshStandardMaterial({ color: 0x9b1414, emissive: 0xff1a12, emissiveIntensity: 0.15, roughness: 0.2 }),
    ledRev: new THREE.MeshStandardMaterial({ color: 0xdfe4ea, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.2 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xffa21a, emissive: 0xff8a00, emissiveIntensity: 0.2, roughness: 0.15, transparent: true, opacity: 0.82 }),
    bulb: new THREE.MeshBasicMaterial({ color: 0xffd27a, toneMapped: false }),
    blue: new THREE.MeshBasicMaterial({ color: 0x3d86ff, toneMapped: false }),
    spot: new THREE.MeshBasicMaterial({ map: glow('rgba(70,140,255,1)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.95 }),
    beam: new THREE.MeshBasicMaterial({ map: beam, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.09, side: THREE.DoubleSide }),
    pool: new THREE.MeshBasicMaterial({ map: glow('rgba(255,244,220,1)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.22 }),
    op: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 }),
    wood: std({ color: 0xb98f5e, roughness: 0.85, metalness: 0 }),
    cargo: std({ color: 0xc9a675, roughness: 0.8, metalness: 0 }),
    wrap: new THREE.MeshPhysicalMaterial({ color: 0xdfe8ef, roughness: 0.18, metalness: 0, transparent: true, opacity: 0.35, clearcoat: 1, depthWrite: false }),
  };
  return _FM;
}
// Plano de calcomanía con UV del atlas (rect en píxeles)
function decal(rect, w, h) { const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv, [x, y, W, H] = rect; for (let i = 0; i < uv.count; i++) uv.setXY(i, (x + uv.getX(i) * W) / 1024, 1 - (y + (1 - uv.getY(i)) * H) / 512); return g; }
const DK = { brand: [0, 0, 512, 128], model: [512, 0, 256, 128], hazard: [0, 128, 512, 128], cold: [512, 128, 256, 128], noride: [768, 0, 256, 256], cap: [0, 256, 384, 192], crush: [384, 256, 256, 64] };

// ---------------------------------------------------------------- Rig (geometría + articulaciones)
export class ForkliftRig {
  constructor(opt = {}) {
    const F0 = fkMaterials(), F = { ...F0 }; for (const k of ['ledW', 'ledRev', 'amber', 'spot']) F[k] = F0[k].clone(); // materiales conmutables propios de cada máquina
    this.F = F; this.group = new THREE.Group(); this.group.name = 'montacargas';
    this.heading = 0; this.steer = 0; this.lift = HMIN; this.tilt = 0; this.load = false; this.lights = true; this.beaconOn = true;
    this.spin = [0, 0, 0, 0]; this.dyn = { p: 0, pv: 0, r: 0, rv: 0, f: 0, fv: 0, b: 0, bv: 0 };
    this.look = { yaw: 0, pitch: 0, twist: 0 }; this.levers = [0, 0, 0]; this.beaconA = 0; this.t = 0; this.rev = false;
    const root = this.group;
    // Cuerpo suspendido (cabeceo/balanceo sobre los neumáticos): pivote cerca del centro de masas
    const PV = [-0.55, 0.32, 0];
    this.body = new THREE.Group(); this.body.position.set(...PV); root.add(this.body);
    const B = (this.bodyIn = new THREE.Group()); B.position.set(-PV[0], -PV[1], 0); this.body.add(B);
    this.kb = new Bk(); this._chassis(B); this._guard(B); this._cab(B); this._operator(B); this.kb.flush(B);
    this._mast(B); this._wheels(root); this._floorFx(root);
    this.loadAnchor = new THREE.Object3D(); this.loadAnchor.position.set(HEEL - MX + PAL / 2, 0, 0); this.carriage.add(this.loadAnchor);
    this.dummy = this._dummyLoad(); this.loadAnchor.add(this.dummy); this.dummy.visible = false; this.showDummy = !!opt.dummyLoad;
    root.traverse((o) => { if (o.isMesh && ![F.spot, F.beam, F.pool, F.bulb, F.blue].includes(o.material)) { o.castShadow = o.receiveShadow = true; } });
    this.setLift(HMIN); this.setTilt(0); this.setSteer(0); this.setLights(true); this.update(0);
  }

  // ---- Chasis, contrapeso, capó de batería, salpicadero
  _chassis(B) {
    const F = this.F, k = this.kb;
    // Bastidor inferior con paso de rueda delantera (perfil lateral extruido a lo ancho)
    const ra = 0.29, a0 = Math.atan2(Math.sqrt(ra * ra - 0.17 * 0.17), 0.17);
    const frame = fillet([[0.17, 0.62], [0.17, RF + Math.sqrt(ra * ra - 0.17 * 0.17)], ...arc(0, RF, ra, a0, PI, 14).slice(1), [-ra, 0.10], [-1.12, 0.10], [-1.12, 0.62]],
      [0.03, 0, ...Array(14).fill(0), 0.03, 0.04, 0], 3);
    k.put(F.body, ex(frame, 1.0, 0.02, 2));
    // Contrapeso con paso de rueda trasera y trasera redondeada
    const cw = fillet([[-1.12, 1.04], [-1.70, 1.08], [-2.0, 0.84], [-2.0, 0.36], [-1.93, 0.17], [-1.66, 0.17], ...arc(-WB, RR, 0.255, PI, 0, 16), [-1.12, 0.17]],
      [0.03, 0.22, 0.10, 0.08, 0.05, 0, ...Array(17).fill(0), 0], 6);
    k.put(F.body, ex(cw, 0.98, 0.03, 3));
    // Zócalo negro inferior del contrapeso (protección)
    k.put(F.dark, ex(fillet([[-1.70, 0.17], [-1.93, 0.17], [-2.0, 0.36], [-2.0, 0.40], [-1.70, 0.40]], [0, 0.05, 0.05, 0, 0], 3), 1.0, 0.03, 2), T(0.0, 0, 0));
    // Capó de batería
    const hood = fillet([[-0.42, 0.62], [-0.42, 1.0], [-1.13, 1.0], [-1.13, 0.62]], [0, 0.05, 0, 0], 4);
    k.put(F.body, ex(hood, 0.96, 0.015, 2));
    // Rejillas (louvres) en los laterales del capó y en el contrapeso
    for (const s of [-1, 1]) for (let i = 0; i < 6; i++) {
      k.put(F.dark, rbox(0.30, 0.016, 0.012, 0.005, 1), T(-0.80, 0.70 + i * 0.042, s * 0.493));
      k.put(F.dark, rbox(0.022, 0.016, 0.30, 0.005, 1), T(-1.30 - i * 0.05, 1.105, 0.0));
    }
    // Salpicadero / torreta de dirección
    const cowl = fillet([[0.18, 0.60], [0.19, 0.93], [0.11, 1.07], [-0.01, 1.10], [-0.08, 1.03], [-0.06, 0.60]], [0, 0.06, 0.05, 0.05, 0.04, 0], 4);
    k.put(F.body, ex(cowl, 0.84, 0.02, 2));
    // Alfombra de goma del piso y escalón antideslizante (lado izquierdo, −Z)
    k.put(F.mat, rbox(0.38, 0.014, 0.86, 0.004, 1), T(-0.24, 0.634, 0));
    k.put(F.plate, rbox(0.34, 0.012, 0.15, 0.004, 1), T(-0.62, 0.36, -0.53)).put(F.dark, rbox(0.34, 0.24, 0.012, 0.006, 1), T(-0.62, 0.25, -0.595))
      .put(F.dark, rbox(0.012, 0.24, 0.10, 0.004, 1), T(-0.79, 0.25, -0.55)).put(F.dark, rbox(0.012, 0.24, 0.10, 0.004, 1), T(-0.45, 0.25, -0.55));
    k.put(F.plate, rbox(0.30, 0.008, 0.10, 0.003, 1), T(-0.24, 0.628, -0.52));
    // Guardabarros de goma: forro de los pasos de rueda y aletas
    const liner = (cx, cy, r0, r1, b0, b1, w) => { const p = [...arc(cx, cy, r1, b0, b1, 16), ...arc(cx, cy, r0, b1, b0, 16)]; return ex(p, w, 0, 1); };
    k.put(F.plastic, liner(0, RF, 0.272, 0.29, 0.6, PI - 0.02, 1.0));
    k.put(F.plastic, liner(-WB, RR, 0.235, 0.255, 0.05, PI - 0.05, 0.96));
    for (const s of [-1, 1]) k.put(F.plastic, liner(0, RF, 0.29, 0.31, 0.55, PI - 0.25, 0.23), T(0, 0, s * 0.43));
    // Eje motriz delantero (cárter, motores) y soportes del mástil
    k.put(F.dark, cyl(0.085, 0.70, 16), T(0, RF, 0, PI / 2)).put(F.grey, cyl(0.12, 0.16, 18), T(0, RF, 0, PI / 2));
    for (const s of [-1, 1]) { k.put(F.dark, cyl(0.10, 0.06, 18), T(0, RF, s * 0.31, PI / 2)); k.put(F.dark, rbox(0.34, 0.10, 0.05, 0.015, 2), T(0.15, MY, s * 0.27)); }
    k.put(F.steel, cyl(0.03, 0.62, 10), T(MX, MY, 0, PI / 2));
    // Eje de dirección trasero (viga + cilindro de dirección)
    k.put(F.dark, ex(fillet([[-0.08, -0.05], [0.08, -0.05], [0.06, 0.06], [-0.06, 0.06]], 0.015, 2), 0.50, 0.01), T(-WB, RR + 0.02, 0));
    k.put(F.grey, cyl(0.038, 0.34, 14), T(-WB + 0.10, RR + 0.02, 0, PI / 2)).put(F.dark, rbox(0.06, 0.12, 0.06, 0.01, 1), T(-WB, RR + 0.12, 0));
    // Luces traseras combinadas (freno/posición, intermitente, marcha atrás), enganche y placa trasera de peligro
    for (const s of [-1, 1]) {
      k.put(F.dark, rbox(0.03, 0.16, 0.10, 0.012, 2), T(-2.035, 0.86, s * 0.40));
      k.put(F.ledR, rbox(0.012, 0.06, 0.08, 0.004, 1), T(-2.052, 0.895, s * 0.40)).put(F.amber, rbox(0.012, 0.035, 0.08, 0.004, 1), T(-2.052, 0.835, s * 0.40));
      k.put(F.ledRev, rbox(0.012, 0.03, 0.08, 0.004, 1), T(-2.052, 0.80, s * 0.40));
    }
    k.put(F.dark, rbox(0.04, 0.10, 0.16, 0.015, 2), T(-2.03, 0.50, 0)).put(F.steel, cyl(0.022, 0.16, 12), T(-2.07, 0.53, 0));
    k.put(F.decal, decal(DK.hazard, 0.58, 0.145), T(-2.0315, 0.66, 0, 0, -PI / 2));
    // Calcomanías laterales
    for (const s of [-1, 1]) {
      const ry = s > 0 ? 0 : PI;
      k.put(F.decal, decal(DK.brand, 0.42, 0.105), T(-1.55, 0.76, s * 0.5215, 0, ry));
      k.put(F.decal, decal(DK.model, 0.2, 0.1), T(-0.72, 0.93, s * 0.4965, 0, ry));
      k.put(F.decal, decal(DK.cold, 0.16, 0.08), T(-0.35, 0.50, s * 0.5215, 0, ry));
    }
    k.put(F.decal, decal(DK.cap, 0.15, 0.075), T(-0.093, 0.80, 0.27, 0, -PI / 2, 0)); // placa de capacidad (frente al operador)
    k.put(F.decal, decal(DK.noride, 0.09, 0.09), T(0.212, 0.80, 0.2, 0, PI / 2));
  }

  // ---- Techo protector (FOPS), luces, baliza, espejo
  _guard(B) {
    const F = this.F, k = this.kb, y = 2.13;
    for (const s of [-1, 1]) k.put(F.dark, sweep([[0.13, 0.58, s * 0.48], [-0.02, y, s * 0.48], [-1.12, y, s * 0.48], [-1.12, 1.02, s * 0.48]], 0.14, 0.065, 0.06, [0, 0, 1], 7));
    for (const x of [-0.02, -0.57, -1.12]) k.put(F.dark, rbox(0.06, 0.055, 0.98, 0.01, 2), T(x, y, 0));
    for (let i = 0; i < 6; i++) k.put(F.dark, rbox(1.12, 0.012, 0.05, 0.004, 1), T(-0.57, y + 0.034, -0.375 + i * 0.15));
    // Placas de fijación de los postes
    for (const s of [-1, 1]) { k.put(F.dark, rbox(0.12, 0.012, 0.10, 0.004, 1), T(0.14, 0.625, s * 0.48)); k.put(F.dark, rbox(0.12, 0.012, 0.10, 0.004, 1), T(-1.12, 1.07, s * 0.48)); }
    // Asidero de entrada (poste delantero izq.) y asidero trasero con bocina
    k.put(F.plastic, cyl(0.017, 0.40, 10), T(0.06, 1.30, -0.405, 0, 0, 0.1)).put(F.dark, ...rod([0.085, 1.10, -0.47], [0.08, 1.11, -0.405], 0.01, 6)).put(F.dark, ...rod([0.045, 1.50, -0.47], [0.04, 1.49, -0.405], 0.01, 6));
    k.put(F.plastic, cyl(0.018, 0.34, 10), T(-1.08, 1.45, -0.44)).put(F.dark, ...rod([-1.12, 1.30, -0.47], [-1.08, 1.30, -0.44], 0.01, 6)).put(F.dark, ...rod([-1.12, 1.60, -0.47], [-1.08, 1.60, -0.44], 0.01, 6));
    k.put(F.decal, decal(DK.noride, 0.07, 0.07), T(-1.077, 1.80, -0.48, 0, PI / 2));
    // Faros LED de trabajo delanteros y trasero
    for (const s of [-1, 1]) {
      k.put(F.dark, rbox(0.07, 0.10, 0.12, 0.018, 2), T(0.03, y + 0.02, s * 0.56)).put(F.dark, rbox(0.04, 0.02, 0.06, 0.005, 1), T(0.0, y, s * 0.51));
      k.put(F.dark, rbox(0.012, 0.11, 0.13, 0.004, 1), T(0.068, y + 0.02, s * 0.56));
    }
    k.put(F.dark, rbox(0.06, 0.08, 0.14, 0.015, 2), T(-1.17, y - 0.07, 0.30));
    // Emisor del punto azul (bajo el travesaño trasero)
    k.put(F.dark, cyl(0.035, 0.07, 14), T(-1.17, y - 0.07, 0, 0, 0, -0.9));
    // Base de la baliza
    k.put(F.dark, lathe([[0.001, 0], [0.065, 0], [0.068, 0.012], [0.06, 0.03], [0.001, 0.03]], 20), T(-1.0, y + 0.04, -0.33));
    // Espejo retrovisor (poste delantero izquierdo)
    k.put(F.dark, ...rod([0.0, 1.88, -0.51], [0.04, 1.96, -0.66], 0.011, 8)).put(F.dark, rbox(0.04, 0.13, 0.20, 0.02, 2), T(0.05, 1.97, -0.70, 0, -0.25));
    // Lentes (material conmutado) y baliza giratoria
    const L = k;
    for (const s of [-1, 1]) L.put(F.ledW, rbox(0.004, 0.08, 0.10, 0.002, 1), T(0.0755, y + 0.02, s * 0.56));
    L.put(F.ledW, rbox(0.004, 0.06, 0.12, 0.002, 1), T(-1.202, y - 0.07, 0.30));
    L.put(F.blue, cyl(0.026, 0.004, 14), T(-1.193, y - 0.086, 0, 0, 0, -0.9));
    L.put(F.mirror, new THREE.PlaneGeometry(0.17, 0.11), T(0.028, 1.97, -0.70, 0, -PI / 2 - 0.25));
    const bc = new THREE.Group(); bc.position.set(-1.0, y + 0.07, -0.33); B.add(bc);
    this.beaconLens = new THREE.Mesh(lathe([[0.056, 0], [0.056, 0.07], [0.05, 0.10], [0.03, 0.118], [0.001, 0.122]], 24), F.amber); bc.add(this.beaconLens);
    this.beaconRotor = new THREE.Group(); bc.add(this.beaconRotor);
    const rr = new Bk(); rr.put(F.chrome, new THREE.CylinderGeometry(0.04, 0.04, 0.06, 12, 1, true, 0, PI), T(0, 0.04, 0)).put(F.bulb, new THREE.SphereGeometry(0.014, 10, 8), T(0.012, 0.04, 0));
    rr.flush(this.beaconRotor, false);
  }

  // ---- Puesto de conducción: asiento, columna, volante, pantalla, palancas, pedales
  _cab(B) {
    const F = this.F, k = this.kb;
    k.put(F.dark, rbox(0.40, 0.07, 0.44, 0.02, 2), T(-0.72, 1.04, 0)).put(F.dark, cyl(0.05, 0.06, 12, true), T(-0.72, 1.03, 0)); // suspensión del asiento
    k.put(F.vinyl, rbox(0.47, 0.10, 0.50, 0.045, 2), T(-0.71, 1.12, 0));
    k.put(F.vinyl, rbox(0.09, 0.56, 0.48, 0.04, 2), T(-0.975, 1.46, 0, 0, 0, 0.12));
    k.put(F.vinyl, rbox(0.06, 0.16, 0.30, 0.03, 2), T(-1.025, 1.82, 0, 0, 0, 0.12));
    for (const s of [-1, 1]) k.put(F.vinyl, rbox(0.36, 0.08, 0.06, 0.03, 2), T(-0.73, 1.19, s * 0.25)); // laterales del cojín
    k.put(F.plastic, rbox(0.20, 0.03, 0.04, 0.01, 1), T(-0.90, 1.22, -0.27, 0, 0, 0.2)); // hebilla
    // Reposabrazos derecho con mini-palancas hidráulicas
    k.put(F.dark, ...rod([-0.80, 1.15, 0.27], [-0.75, 1.33, 0.30], 0.015, 8)).put(F.vinyl, rbox(0.30, 0.05, 0.09, 0.022, 2), T(-0.66, 1.355, 0.30));
    k.put(F.plastic, rbox(0.12, 0.05, 0.13, 0.018, 2), T(-0.47, 1.37, 0.30));
    // Columna de dirección inclinada 35° y carcasa
    const st = this.swTilt = new THREE.Group(); st.position.set(-0.10, 1.40, 0); st.rotation.z = 0.61; B.add(st);
    k.put(F.plastic, lathe([[0.001, -0.36], [0.07, -0.36], [0.06, -0.12], [0.045, -0.05], [0.04, -0.03], [0.001, -0.03]], 16), T(-0.10, 1.40, 0, 0, 0, 0.61));
    // Pantalla del salpicadero (canvas dinámico)
    k.put(F.plastic, rbox(0.06, 0.12, 0.20, 0.02, 2), T(0.02, 1.13, 0.22, 0, 0, -0.35));
    k.put(F.plastic, rbox(0.06, 0.05, 0.16, 0.02, 2), T(0.03, 1.115, -0.22, 0, 0, -0.35)); // botonera izquierda
    for (let i = 0; i < 3; i++) k.put([F.ledR, F.amber, F.blue][i], cyl(0.011, 0.012, 10), T(-0.002, 1.127, -0.27 + i * 0.05, 0, 0, PI / 2 - 0.35));
    // Pedales (acelerador y freno)
    k.put(F.plastic, rbox(0.14, 0.012, 0.08, 0.005, 1), T(-0.06, 0.70, 0.13, 0, 0, 0.55)).put(F.plastic, rbox(0.10, 0.012, 0.08, 0.005, 1), T(-0.05, 0.69, -0.02, 0, 0, 0.55));
    k.put(F.dark, rbox(0.08, 0.03, 0.03, 0.01, 1), T(-0.04, 0.66, 0.13)).put(F.dark, rbox(0.08, 0.03, 0.03, 0.01, 1), T(-0.04, 0.66, -0.02));
    // Pantalla
    const dc = (this.dispC = canvas(256, 128, () => {})), dt = (this.dispT = tex(dc)); dt.wrapS = dt.wrapT = THREE.ClampToEdgeWrapping;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.08), new THREE.MeshStandardMaterial({ map: dt, emissiveMap: dt, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.25 }));
    scr.position.set(-0.011, 1.142, 0.22); scr.rotation.set(0, -PI / 2, 0); scr.rotateX(-0.35); B.add(scr); this._drawDisplay(0, HMIN, 0);
    // Volante: aro (toro), 3 radios, cubo y pomo giratorio
    const sp = (this.swSpin = new THREE.Group()); st.add(sp);
    const w = new Bk(), R = 0.17;
    w.put(F.plastic, new THREE.TorusGeometry(R, 0.017, 8, 36), T(0, 0, 0, PI / 2));
    for (let i = 0; i < 3; i++) { const a = PI / 2 + (i * TAU) / 3; w.put(F.plastic, ...rod([Math.cos(a) * 0.035, -0.025, Math.sin(a) * 0.035], [Math.cos(a) * (R - 0.01), 0, Math.sin(a) * (R - 0.01)], 0.011, 8)); }
    w.put(F.plastic, lathe([[0.001, -0.05], [0.05, -0.05], [0.055, -0.02], [0.04, 0.0], [0.001, 0.005]], 18));
    const ka = -0.8 * PI; this.knobLocal = V3(Math.cos(ka) * R, 0.06, Math.sin(ka) * R);
    w.put(F.steel, cyl(0.007, 0.04, 8), T(this.knobLocal.x, 0.02, this.knobLocal.z)).put(F.plastic, lathe([[0.001, 0], [0.018, 0], [0.02, 0.03], [0.016, 0.05], [0.001, 0.055]], 14), T(this.knobLocal.x, 0.02, this.knobLocal.z));
    w.flush(sp);
    // Mini-palancas: elevación, inclinación, auxiliar
    this.leverG = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group(); g.position.set(-0.47, 1.395, 0.26 + i * 0.04); B.add(g); this.leverG.push(g);
      const lv = new Bk(); lv.put(F.plastic, cyl(0.004, 0.05, 6), T(0, 0.025, 0)).put(F.plastic, rbox(0.018, 0.026, 0.016, 0.006, 2), T(0, 0.055, 0)); lv.flush(g, false);
    }
  }
  _drawDisplay(v, h, tilt) {
    const g = this.dispC.getContext('2d'), w = 256, hh = 128;
    g.fillStyle = '#0a1420'; g.fillRect(0, 0, w, hh); g.fillStyle = '#12304f'; g.fillRect(0, 0, w, 22);
    g.font = '700 15px system-ui,Arial'; g.fillStyle = '#9fd0ff'; g.textBaseline = 'middle'; g.fillText('E16C  ·  -28 °C', 8, 11);
    g.fillStyle = '#2ee66b'; g.fillRect(186, 6, 52, 11); g.strokeStyle = '#9fd0ff'; g.strokeRect(184, 4, 58, 15); g.fillRect(242, 8, 3, 7);
    g.font = '900 44px system-ui,Arial'; g.fillStyle = '#fff'; g.fillText(Math.abs(v * 3.6).toFixed(1), 10, 62); g.font = '600 14px system-ui,Arial'; g.fillStyle = '#9fd0ff'; g.fillText('km/h', 12, 96);
    g.fillText(v < -0.03 ? 'R' : v > 0.03 ? 'F' : 'N', 100, 96);
    g.fillStyle = '#9fd0ff'; g.fillText('ALTURA', 150, 40); g.font = '800 26px system-ui,Arial'; g.fillStyle = '#ffd34d'; g.fillText(`${h.toFixed(2)} m`, 150, 66);
    g.font = '600 13px system-ui,Arial'; g.fillStyle = '#9fd0ff'; g.fillText(`inc ${(tilt * 180 / PI).toFixed(1)}°`, 150, 96); g.fillText('2417 h', 150, 114);
    this.dispT.needsUpdate = true;
  }

  // ---- Operador (proporciones antropométricas, ropa térmica, chaleco reflectante, casco sobre gorro)
  _operator(B) {
    const F = this.F, C = { jacket: 0x2f3d55, vis: 0xd8f23c, band: 0xe8eef2, pants: 0x1f2630, boot: 0x15171a, skin: 0xc9926a, beanie: 0x1d4f91, helmet: 0xf0f2f4, glove: 0x30343a, cuff: 0xe06a1b };
    const s = this.kb;
    s.put(F.op, col(rbox(0.30, 0.18, 0.38, 0.07, 2), C.pants), T(-0.71, 1.25, 0));
    for (const z of [-0.105, 0.105]) {
      const hip = [-0.70, 1.24, z], knee = [-0.30, 1.20, z * 1.15], ank = [-0.25, 0.74, z * 1.2];
      s.put(F.op, col(new THREE.CapsuleGeometry(0.078, lenAB(hip, knee), 4, 12), C.pants), seg2(hip, knee));
      s.put(F.op, col(new THREE.CapsuleGeometry(0.062, lenAB(knee, ank), 4, 12), C.pants), seg2(knee, ank));
      s.put(F.op, col(rbox(0.28, 0.10, 0.11, 0.04, 2), C.boot), T(-0.20, 0.69, z * 1.2)).put(F.op, col(rbox(0.29, 0.02, 0.12, 0.008, 1), 0x0b0c0d), T(-0.20, 0.645, z * 1.2));
      s.put(F.op, col(cyl(0.068, 0.10, 12), C.boot), T(-0.25, 0.76, z * 1.2));
    }
    // Torso (lathe elíptico) con chaleco y bandas reflectantes; pivote en la cadera
    const to = (this.torso = new THREE.Group()); to.position.set(-0.71, 1.27, 0); to.rotation.order = 'YZX'; B.add(to);
    const tk = new Bk(), sc = T(0, 0, 0, 0, 0, 0, 0.66, 1, 1);
    const prof = [[0.001, 0], [0.165, 0], [0.18, 0.08], [0.19, 0.22], [0.2, 0.34], [0.19, 0.42], [0.13, 0.48], [0.06, 0.50], [0.001, 0.505]];
    tk.put(F.op, col(lathe(prof, 24), C.jacket), sc);
    tk.put(F.op, col(lathe([[0.170, 0.02], [0.186, 0.06], [0.196, 0.22], [0.205, 0.36], [0.17, 0.44], [0.001, 0.44]], 24), C.vis), T(0, 0, 0, 0, 0, 0, 0.68, 1, 1.02));
    for (const y of [0.12, 0.30]) tk.put(F.op, col(cyl(1, 0.035, 24, true), C.band), T(0, y, 0, 0, 0, 0, 0.66 * (y > 0.2 ? 0.209 : 0.199), 1, y > 0.2 ? 0.209 : 0.199));
    tk.put(F.op, col(lathe([[0.07, 0.45], [0.085, 0.50], [0.07, 0.56], [0.055, 0.57]], 16), C.jacket)); // cuello alto
    for (const z of [-0.19, 0.19]) tk.put(F.op, col(new THREE.SphereGeometry(0.075, 12, 8), C.jacket), T(-0.005, 0.43, z));
    tk.flush(to, true);
    // Cabeza: cara, nariz, gorro de lana bajo el casco, casco con visera
    const hd = (this.head = new THREE.Group()); hd.position.set(0.0, 0.57, 0); hd.rotation.order = 'YZX'; to.add(hd);
    const hk = new Bk();
    hk.put(F.op, col(new THREE.SphereGeometry(0.095, 18, 14), C.skin), T(0.01, 0.10, 0, 0, 0, 0, 0.92, 1.12, 0.86));
    hk.put(F.op, col(new THREE.SphereGeometry(0.018, 8, 6), C.skin), T(0.095, 0.095, 0, 0, 0, 0, 1.2, 1, 0.8));
    for (const z of [-0.03, 0.03]) hk.put(F.op, col(new THREE.SphereGeometry(0.009, 6, 5), 0x111111), T(0.083, 0.125, z));
    hk.put(F.op, col(cyl(0.06, 0.06, 12), C.skin), T(0, 0.0, 0));
    hk.put(F.op, col(new THREE.SphereGeometry(0.1, 18, 10, 0, TAU, 0, PI * 0.56), C.beanie), T(0.0, 0.115, 0, 0, 0, 0, 0.98, 1.0, 0.92));
    hk.put(F.op, col(lathe([[0.105, 0.11], [0.116, 0.14], [0.118, 0.18], [0.10, 0.235], [0.06, 0.262], [0.001, 0.268]], 22), C.helmet), T(0.005, 0.0, 0, 0, 0, 0, 1.06, 1, 0.98));
    hk.put(F.op, col(lathe([[0.112, 0.0], [0.15, -0.012], [0.152, -0.002], [0.116, 0.012]], 22, 0), C.helmet), T(0.03, 0.135, 0, 0, 0, -0.12, 1, 1, 0.9));
    hk.put(F.op, col(rbox(0.012, 0.03, 0.15, 0.006, 1), 0x2a2f36), T(0.10, 0.205, 0)); // linterna/clip
    hk.flush(hd, true);
    // Brazos (instancias de cápsula) y guantes (cinemática inversa de 2 huesos en update)
    const cap = col(new THREE.CapsuleGeometry(0.05, 0.2, 4, 10), 0xffffff), glv = col(rbox(0.11, 0.05, 0.09, 0.022, 2), 0xffffff);
    this.arms = new THREE.InstancedMesh(cap, F.op, 4); this.gloves = new THREE.InstancedMesh(glv, F.op, 2);
    for (let i = 0; i < 4; i++) this.arms.setColorAt(i, new THREE.Color(i % 2 ? C.jacket : C.vis));
    for (let i = 0; i < 2; i++) this.gloves.setColorAt(i, new THREE.Color(C.glove));
    for (const m of [this.arms, this.gloves]) { m.frustumCulled = false; m.castShadow = true; B.add(m); }
  }

  // ---- Mástil dúplex, cilindros, cadenas, portahorquillas, horquillas
  _mast(B) {
    const F = this.F, mg = (this.mast = new THREE.Group()); mg.position.set(MX, MY, 0); B.add(mg);
    const o = new Bk(), lx = 0.08;
    // Canales exteriores (C 115×75) y travesaños
    for (const s of [-1, 1]) o.put(F.dark, prismY(cProf(0.115, 0.075, 0.016, 0.018, s), 0.08 - MY, 2.20 - MY, 0.002), T(lx, 0, s * 0.36));
    o.put(F.dark, rbox(0.026, 0.08, 0.65, 0.008, 2), T(0.027, 1.86, 0)).put(F.dark, rbox(0.026, 0.07, 0.65, 0.008, 2), T(0.027, 0.47, 0));
    o.put(F.dark, rbox(0.12, 0.10, 0.70, 0.015, 2), T(0.0, 0.0, 0));
    for (const s of [-1, 1]) {
      o.put(F.dark, rbox(0.10, 0.10, 0.03, 0.01, 2), T(-0.03, 0.70, s * 0.415)); // oreja del cilindro de inclinación
      o.put(F.grey, cyl(0.045, 1.92, 16), T(-0.035, -0.13 + 0.96, s * 0.30)).put(F.dark, cyl(0.052, 0.05, 16), T(-0.035, -0.12, s * 0.30)).put(F.dark, cyl(0.05, 0.04, 16), T(-0.035, 1.80, s * 0.30));
      o.put(F.dark, rbox(0.05, 0.05, 0.06, 0.008, 1), T(0.0, 1.0, s * 0.33));
      o.put(F.dark, rbox(0.03, 0.05, 0.04, 0.006, 1), T(0.045, 0.51, s * 0.20)); // anclaje de cadena
    }
    o.put(F.grey, ...rod([-0.06, 1.75, -0.30], [-0.07, 0.30, 0.0], 0.008, 6)).put(F.grey, ...rod([-0.07, 0.30, 0.0], [-0.30, 0.0, 0.0], 0.008, 6)); // manguera hidráulica
    o.put(F.decal, decal(DK.crush, 0.22, 0.05), T(lx + 0.0585, 1.1, 0.36, 0, PI / 2));
    o.flush(mg);
    // Mástil interior (sube d = (h − elevación libre)/2): canales C, cabezal, poleas, vástagos cromados
    const ig = (this.inner = new THREE.Group()); mg.add(ig);
    const n = new Bk();
    for (const s of [-1, 1]) {
      n.put(F.dark, prismY(cProf(0.075, 0.08, 0.014, 0.014, s), 0.10 - MY, 2.27 - MY, 0.002), T(lx, 0, s * 0.31));
      n.put(F.chrome, cyl(0.028, 1.85, 16), T(-0.035, 1.98 - 0.925, s * 0.30));
      n.put(F.steel, cyl(0.055, 0.026, 20), T(0.10, 1.92, s * 0.20, PI / 2)).put(F.dark, rbox(0.13, 0.08, 0.008, 0.003, 1), T(0.10, 1.95, s * 0.222)).put(F.dark, rbox(0.13, 0.08, 0.008, 0.003, 1), T(0.10, 1.95, s * 0.178));
      n.put(F.dark, rbox(0.10, 0.03, 0.03, 0.006, 1), T(0.08, 0.0, s * 0.30)); // patín inferior
    }
    n.put(F.dark, ex(fillet([[-0.09, 0], [0.15, 0], [0.15, 0.05], [-0.09, 0.05]], 0.012, 2), 0.74, 0.004), T(0, 1.98, 0));
    n.flush(ig);
    // Portahorquillas (clase ISO II): barras, placas de rodillos, rejilla de respaldo de tubo, horquillas forjadas
    const cg = (this.carriage = new THREE.Group()); mg.add(cg);
    const c = new Bk(), x0 = 0.17, x1 = 0.232, xm = (x0 + x1) / 2;
    c.put(F.dark, ex(fillet([[x0, 0.36], [x1, 0.36], [x1, 0.50], [x0, 0.50]], [0, 0.008, 0.008, 0], 2), 1.0, 0.004), T(0, 0, 0));
    c.put(F.dark, ex(fillet([[x0, -0.03], [x1, -0.03], [x1, 0.09], [x0, 0.09]], 0.008, 2), 1.0, 0.004));
    for (let i = 0; i < 9; i++) c.put(F.dark, rbox(0.012, 0.012, 0.02, 0.003, 1), T(x1 + 0.004, 0.51, -0.48 + i * 0.12)); // muescas de posicionamiento
    for (const s of [-1, 1]) {
      c.put(F.dark, rbox(0.03, 0.56, 0.10, 0.01, 2), T(x0 + 0.015, 0.23, s * 0.20));
      c.put(F.dark, rbox(0.11, 0.48, 0.02, 0.006, 2), T(0.115, 0.23, s * 0.255));
      for (const y of [0.06, 0.40]) c.put(F.steel, cyl(0.028, 0.03, 16), T(lx, y, s * 0.29, PI / 2)).put(F.dark, cyl(0.012, 0.06, 8), T(lx, y, s * 0.265, PI / 2));
      c.put(F.dark, rbox(0.04, 0.05, 0.04, 0.008, 1), T(0.155, 0.47, s * 0.20)); // anclaje de cadena
    }
    // Rejilla de respaldo de carga (tubo)
    const bt = 1.22, bw = 0.47;
    c.put(F.dark, sweep([[xm, 0.49, -bw], [xm, bt, -bw], [xm, bt, bw], [xm, 0.49, bw]], 0.06, 0.04, 0.04, [1, 0, 0], 5));
    c.put(F.dark, rbox(0.03, 0.03, 2 * bw, 0.008, 1), T(xm, 0.86, 0));
    for (let i = 1; i < 8; i++) c.put(F.dark, rbox(0.022, bt - 0.50, 0.012, 0.004, 1), T(xm, (bt + 0.50) / 2, -bw + (i * 2 * bw) / 8));
    // Horquillas: perfil en L con talón redondeado y punta afilada en alzado y planta
    const fp = fillet([[0.275, 0.535], [0.155, 0.535], [0.155, 0.46], [0.17, 0.46], [0.17, 0.50], [0.232, 0.50], [0.232, -0.045], [1.20, -0.045], [0.275 + FLEN, -0.012], [0.275 + FLEN, 0.0], [0.275, 0.0]],
      [0.008, 0.008, 0.004, 0, 0, 0, 0.07, 0.06, 0.01, 0.006, 0.035], 4);
    const fg = extrude(fp, 0.10, 0.006, 2), pa = fg.attributes.position;
    for (let i = 0; i < pa.count; i++) { const x = pa.getX(i); if (x > 1.1) pa.setZ(i, pa.getZ(i) * lerp(1, 0.62, smootherstep((x - 1.1) / (0.275 + FLEN - 1.1)))); }
    const fork = crease(fg, 0.55);
    for (const z of [-FZ, FZ]) c.put(F.forged, fork, T(0, 0, z)).put(F.dark, rbox(0.03, 0.04, 0.025, 0.006, 1), T(0.25, 0.52, z + 0.04));
    c.flush(cg);
    // Cadenas de hoja: eslabones instanciados que pasan sobre las poleas
    this.pitch = 0.03; const L0 = (1.92 - 0.51) + PI * 0.055 + (1.92 - (HMIN - MY + 0.47)), N = (this.nLink = Math.round(L0 / this.pitch));
    const lk = new THREE.BoxGeometry(this.pitch * 1.25, 0.022, 0.026);
    this.chains = new THREE.InstancedMesh(lk, F.chain, 2 * N); this.chains.frustumCulled = false; this.chains.castShadow = true; mg.add(this.chains);
    // Cilindros de inclinación (cuerpo en el chasis, vástago hacia el mástil): un grupo contiene ambos lados
    this.tiltCyl = new THREE.Group(); this.tiltCyl.position.set(0.02, 0.74, 0); B.add(this.tiltCyl);
    const tb = new Bk(), tr = new Bk();
    for (const s of [-1, 1]) { tb.put(F.grey, cyl(0.04, 0.24, 14), T(0.12, 0, s * 0.415, 0, 0, PI / 2)).put(F.grey, cyl(0.046, 0.03, 14), T(0.235, 0, s * 0.415, 0, 0, PI / 2)).put(F.grey, cyl(0.035, 0.06, 12), T(0, 0, s * 0.415, PI / 2)); }
    for (const s of [-1, 1]) { tr.put(F.chrome, cyl(0.02, 0.26, 12), T(0.13, 0, s * 0.415, 0, 0, PI / 2)).put(F.chrome, cyl(0.03, 0.05, 12), T(0.26, 0, s * 0.415, PI / 2)); }
    tb.flush(this.tiltCyl); this.tiltRod = new THREE.Group(); this.tiltCyl.add(this.tiltRod); tr.flush(this.tiltRod);
  }

  // ---- Ruedas: motrices delanteras (neumático superelástico + llanta) y directrices traseras en mangueta
  _wheels(root) {
    const F = this.F;
    const mk = (r, w, rr, bolts, side) => {
      const g = new THREE.Group(), sp = new THREE.Group(); g.add(sp);
      const t = tire(r, w, rr, 30).clone(), m = rim(rr, w * 0.92, bolts).clone(); for (const x of [t, m]) x.rotateY(side * PI / 2);
      const a = new THREE.Mesh(t, F.rubber), b = new THREE.Mesh(m, F.rimP); sp.add(a, b); return { g, sp };
    };
    this.wheels = [];
    for (const s of [-1, 1]) { const w = mk(RF, WF, 0.15, 8, s); w.g.position.set(0, RF, s * TF); root.add(w.g); this.wheels.push(w); }
    this.knuckles = [];
    for (const s of [-1, 1]) {
      const kn = new THREE.Group(); kn.position.set(-WB, RR, s * KP); root.add(kn); this.knuckles.push(kn);
      const w = mk(RR, WR, 0.115, 5, s); w.g.position.set(0, 0, s * KO); kn.add(w.g); this.wheels.push(w);
      const k = new Bk(); k.put(F.dark, cyl(0.032, 0.16, 12), T(0, 0.04, 0)).put(F.dark, rbox(0.06, 0.03, 0.08, 0.008, 1), T(0, 0.11, s * 0.02)).put(F.dark, rbox(0.12, 0.025, 0.03, 0.008, 1), T(0.06, 0.06, -s * 0.0));
      k.flush(kn);
    }
    // Barras de acoplamiento (2 instancias) y vástago del cilindro de dirección
    this.tie = new THREE.InstancedMesh(cyl(0.012, 1, 8), F.steel, 2); this.tie.frustumCulled = false; root.add(this.tie);
    this.steerRod = new THREE.Mesh(cyl(0.018, 0.5, 10), F.chrome); this.steerRod.rotation.x = PI / 2; this.steerRod.position.set(-WB + 0.10, RR + 0.02 + 0, 0); root.add(this.steerRod);
  }

  // ---- Efectos en el suelo: punto azul de seguridad (haz + mancha) y charco de luz de los faros
  _floorFx(root) {
    const F = this.F;
    const p0 = V3(-1.18, 2.03, 0), p1 = V3(-3.35, 0.012, 0), d = p1.clone().sub(p0), L = d.length();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, L, 20, 1, true), F.beam);
    cone.position.copy(p0).addScaledVector(d, 0.5); cone.quaternion.setFromUnitVectors(Y, d.clone().negate().normalize()); this.bodyIn.add(cone); // vértice en el emisor
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.55), F.spot); sp.rotation.x = -PI / 2; sp.position.set(-3.35, 0.012, 0); root.add(sp);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.6), F.pool); pool.rotation.x = -PI / 2; pool.position.set(2.6, 0.011, 0); root.add(pool);
    this.fx = { cone, sp, pool }; for (const m of [cone, sp, pool]) { m.castShadow = false; m.receiveShadow = false; m.renderOrder = 2; }
  }

  // ---- Pallet de muestra (solo demo): tarima de 1,2 × 1,0 m + carga envuelta
  _dummyLoad() {
    const F = this.F, g = new THREE.Group(), k = new Bk();
    for (const z of [-0.44, 0, 0.44]) k.put(F.wood, rbox(1.2, 0.022, 0.12, 0.004, 1), T(0, 0.133, z));
    for (const x of [-0.55, 0, 0.55]) for (const z of [-0.44, 0, 0.44]) k.put(F.wood, rbox(0.10, 0.078, 0.12, 0.006, 1), T(x, 0.083, z));
    for (const x of [-0.55, 0, 0.55]) k.put(F.wood, rbox(0.10, 0.022, 1.0, 0.004, 1), T(x, 0.033, 0));
    for (let i = 0; i < 7; i++) k.put(F.wood, rbox(0.10, 0.022, 1.0, 0.004, 1), T(-0.55 + i * 0.1833, 0.155, 0));
    for (let ix = 0; ix < 3; ix++) for (let iy = 0; iy < 4; iy++) for (let iz = 0; iz < 3; iz++) k.put(F.cargo, new THREE.BoxGeometry(0.39, 0.34, 0.32), T(-0.4 + ix * 0.4, 0.34 + iy * 0.35, -0.33 + iz * 0.33));
    k.put(F.wrap, rbox(1.22, 1.32, 1.0, 0.03, 2), T(0, 0.83, 0));
    k.flush(g); return g;
  }

  // ---------------------------------------------------------------- API de articulaciones
  setPose(x, z, heading) { this.group.position.set(x, 0, z); this.group.rotation.y = -heading; this.heading = heading; }
  // angle = ángulo de dirección equivalente (bicicleta, + gira hacia +Z local); Ackermann por rueda alrededor del pivote
  setSteer(angle) {
    const a = (this.steer = clamp(angle, -MAXS, MAXS)), t = Math.tan(a);
    // Ackermann: centro de giro sobre la línea del eje delantero; la rueda interior gira más
    this.wAng = [-1, 1].map((s) => -Math.atan2(WB * t, WB - s * KP * t));
    this.knuckles.forEach((k, i) => (k.rotation.y = -this.wAng[i]));
    this.swSpin.rotation.y = -a * SW_RATIO;
    // vástago del cilindro de dirección y barras de acoplamiento
    const sh = clamp(a / MAXS, -1, 1) * 0.06; this.steerRod.position.z = sh;
    const m = new THREE.Matrix4();
    this.knuckles.forEach((k, i) => {
      const s = i ? 1 : -1, wa = -this.wAng[i], arm = V3(0.12, 0.06 - RR + RR, 0).applyAxisAngle(Y, wa).add(k.position);
      const end = V3(-WB + 0.10, RR + 0.02, sh + s * 0.25), d = arm.clone().sub(end), L = d.length();
      m.compose(end.clone().addScaledVector(d, 0.5), new THREE.Quaternion().setFromUnitVectors(Y, d.normalize()), V3(1, L, 1)); this.tie.setMatrixAt(i, m);
    });
    this.tie.instanceMatrix.needsUpdate = true;
  }
  // ds = avance del eje delantero (m, + adelante); las traseras recorren ds / cos(ángulo de rueda)
  roll(ds) {
    this.spin[0] += ds / RF; this.spin[1] += ds / RF;
    for (let i = 0; i < 2; i++) this.spin[2 + i] += ds / Math.max(0.15, Math.cos(this.wAng[i])) / RR;
    this.wheels.forEach((w, i) => (w.sp.rotation.z = -this.spin[i]));
  }
  setLift(h) { this.lift = clamp(h, HMIN, HMAX); this._liftPose(); }
  _liftPose() {
    const h = this.lift, d = Math.max(0, h - FREE) / 2;
    this.inner.position.y = d; this.carriage.position.y = h - MY + this.dyn.b;
    // cadenas: anclaje fijo (mástil exterior) → polea (interior) → portahorquillas
    const r = 0.055, cx = 0.10, cy = 1.92 + d, Ay = 0.51, Dy = this.carriage.position.y + 0.47, L1 = cy - Ay, La = PI * r, L2 = cy - Dy, L = L1 + La + L2, N = this.nLink, m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = V3(0, 0, 0), sc = V3(1, 1, 1), Z = V3(0, 0, 1);
    for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) {
      const s = ((i + 0.5) * L) / N; let ang;
      if (s < L1) { p.set(cx - r, Ay + s, 0); ang = PI / 2; } else if (s < L1 + La) { const th = PI - (s - L1) / r; p.set(cx + r * Math.cos(th), cy + r * Math.sin(th), 0); ang = th - PI / 2; } else { p.set(cx + r, cy - (s - L1 - La), 0); ang = -PI / 2; }
      p.z = (c ? 1 : -1) * 0.20; q.setFromAxisAngle(Z, ang); sc.z = i % 2 ? 1 : 0.7; sc.y = i % 2 ? 1 : 0.86; m.compose(p, q, sc); this.chains.setMatrixAt(c * N + i, m);
    }
    this.chains.instanceMatrix.needsUpdate = true;
  }
  // rad: + hacia adelante (máx +3°), − hacia atrás (mín −6°); gira alrededor del pie del mástil sobre el eje delantero
  setTilt(rad) { this.tilt = clamp(rad, TILT_MIN, TILT_MAX); this._tiltPose(); }
  _tiltPose() {
    const a = -(this.tilt + this.dyn.f); this.mast.rotation.z = a;
    const lx = -0.03, ly = 0.70, px = MX + lx * Math.cos(a) - ly * Math.sin(a), py = MY + lx * Math.sin(a) + ly * Math.cos(a);
    const P0 = this.tiltCyl.position, dx = px - P0.x, dy = py - P0.y; this.tiltCyl.rotation.z = Math.atan2(dy, dx); this.tiltRod.position.x = Math.hypot(dx, dy) - 0.27;
  }
  setLoad(b) { this.load = !!b; this.dummy.visible = this.load && this.showDummy; }
  setLights(on) { this.lights = !!on; this.F.ledW.emissiveIntensity = on ? 2.2 : 0; this.fx.cone.visible = this.fx.sp.visible = this.fx.pool.visible = this.lights; }
  setBeacon(on) { this.beaconOn = !!on; }
  setReverse(on) { this.rev = !!on; this.F.ledRev.emissiveIntensity = on ? 2.0 : 0; }
  // Mirada del operador: yaw (+ hacia la derecha/+Z), pitch (+ arriba), giro del torso
  setLook(yaw, pitch = 0, twist = 0) { Object.assign(this.look, { yaw, pitch, twist }); }
  setLevers(lift = 0, tilt = 0, aux = 0) { this.levers = [lift, tilt, aux]; }

  // Dinámica secundaria + baliza + operador. dyn = { ax: acel. longitudinal (m/s²), ay: acel. lateral, la: acel. de elevación, v }
  update(dt, dyn = {}) {
    const D = this.dyn, ax = clamp(dyn.ax || 0, -3, 3), ay = clamp(dyn.ay || 0, -2.5, 2.5), hl = this.lift; this.t += dt;
    if (dt > 0) {
      // chasis sobre neumáticos: cabeceo (morro baja al frenar) y balanceo hacia fuera en curva
      const pT = 0.010 * ax - (this.load ? 0.004 + 0.0015 * hl : 0), rT = -0.012 * ay;
      [D.p, D.pv] = spring(D.p, D.pv, pT, 70, 9, dt); [D.r, D.rv] = spring(D.r, D.rv, rT, 60, 8, dt);
      // flexión del mástil (crece con la altura y la carga) y rebote hidráulico del portahorquillas
      [D.f, D.fv] = spring(D.f, D.fv, -0.0025 * ax * (0.4 + hl / 2) * (this.load ? 1.6 : 1), 45, 3.2, dt);
      [D.b, D.bv] = spring(D.b, D.bv, -(dyn.la || 0) * 0.008 * (this.load ? 1.5 : 1), 160, 7, dt);
      D.p = clamp(D.p, -0.05, 0.05); D.r = clamp(D.r, -0.05, 0.05); D.f = clamp(D.f, -0.03, 0.03); D.b = clamp(D.b, -0.03, 0.03); this.body.rotation.set(D.r, 0, D.p); this._tiltPose(); this._liftPose();
      // baliza: reflector giratorio a ~1,5 vueltas/s; el destello sigue al reflector
      if (this.beaconOn) this.beaconA += dt * TAU * 1.5;
      this.beaconRotor.rotation.y = this.beaconA; this.beaconRotor.visible = this.beaconOn;
      this.F.amber.emissiveIntensity = this.beaconOn ? 0.5 + 2.6 * Math.max(0, Math.cos(this.beaconA)) ** 6 : 0.05;
      this.fx.sp.material.opacity = 0.75 + 0.2 * Math.sin(this.t * 9);
      this._dispAcc = (this._dispAcc || 0) + dt; if (this._dispAcc > 0.25) { this._dispAcc = 0; this._drawDisplay(dyn.v || 0, hl, this.tilt); }
    }
    this.leverG.forEach((g, i) => (g.rotation.z = -0.45 * clamp(this.levers[i], -1, 1)));
    // Operador: torso y cabeza
    const L = this.look; this.torso.rotation.set(0, -L.twist, 0.10); this.head.rotation.set(0, -(L.yaw - L.twist), L.pitch);
    this._ik();
  }
  _ik() {
    const B = this.bodyIn, m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = V3(1, 1, 1);
    this.torso.updateMatrix(); this.swTilt.updateMatrix(); this.swSpin.updateMatrix(); this.leverG[0].updateMatrix();
    const knob = this.knobLocal.clone().applyMatrix4(this.swSpin.matrix).applyMatrix4(this.swTilt.matrix);
    const lev = V3(-0.035, 0.03, 0.02).applyMatrix4(this.leverG[0].matrix);
    const tgt = [knob, lev], poles = [V3(-0.2, -1, -0.7), V3(-0.4, -1, 0.6)];
    for (let i = 0; i < 2; i++) {
      const S = V3(0, 0.44, i ? 0.20 : -0.20).applyMatrix4(this.torso.matrix), P = tgt[i].clone().add(S.clone().sub(tgt[i]).normalize().multiplyScalar(0.05));
      const a = 0.30, b = 0.28, d = P.clone().sub(S), Lr = clamp(d.length(), 0.08, a + b - 0.002); d.normalize();
      const ca = (a * a + Lr * Lr - b * b) / (2 * a * Lr), hh = a * Math.sqrt(Math.max(0, 1 - ca * ca)), pl = poles[i].clone().normalize(), n = pl.sub(d.clone().multiplyScalar(pl.dot(d))).normalize();
      const E = S.clone().addScaledVector(d, a * ca).addScaledVector(n, hh), W = S.clone().addScaledVector(d, Lr);
      const put = (k, A, Bp, r) => { const v = Bp.clone().sub(A), l = v.length(); q.setFromUnitVectors(Y, v.normalize()); m.compose(A.clone().add(Bp).multiplyScalar(0.5), q, sc.set(r / 0.05, (l + r) / 0.3, r / 0.05)); this.arms.setMatrixAt(k, m); };
      put(i * 2, S, E, 0.058); put(i * 2 + 1, E, W, 0.048);
      const fd = W.clone().sub(E).normalize(), gq = new THREE.Quaternion().setFromUnitVectors(V3(1, 0, 0), fd);
      m.compose(W.clone().addScaledVector(fd, 0.045), gq, sc.set(1, 1, 1)); this.gloves.setMatrixAt(i, m);
    }
    this.arms.instanceMatrix.needsUpdate = this.gloves.instanceMatrix.needsUpdate = true;
    void B;
  }
}

// ---------------------------------------------------------------- Conductor (perfiles de movimiento realistas)
const DEG = PI / 180;
const keyOf = (pts) => pts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(';');
// Curva de Hermite (Bézier cúbica) entre dos poses → Path2 densamente muestreado. dir = +1 adelante, −1 marcha atrás
function hermite(A, Bp, dir) {
  const fa = [Math.cos(A.h) * dir, Math.sin(A.h) * dir], fb = [Math.cos(Bp.h) * dir, Math.sin(Bp.h) * dir], dist = Math.hypot(Bp.x - A.x, Bp.z - A.z), k = clamp(0.45 * dist, 0.5, 5);
  const P = [[A.x, A.z], [A.x + fa[0] * k, A.z + fa[1] * k], [Bp.x - fb[0] * k, Bp.z - fb[1] * k], [Bp.x, Bp.z]], pts = [];
  for (let i = 0; i <= 32; i++) { const u = i / 32, w = [(1 - u) ** 3, 3 * u * (1 - u) ** 2, 3 * u * u * (1 - u), u ** 3]; pts.push([0, 1].map((c) => w.reduce((s, wi, j) => s + wi * P[j][c], 0))); }
  return new Path2(pts, 0.15);
}
// Ruta de maniobra hacia una pose: si el destino queda detrás, primero marcha atrás girando; luego avance suave
export function planRoute(from, to) {
  const f = [Math.cos(from.h), Math.sin(from.h)], dx = to.x - from.x, dz = to.z - from.z, dist = Math.hypot(dx, dz), legs = [];
  let cur = from;
  if (dist > 0.05 && (dx * f[0] + dz * f[1] < 0.3 * dist || dist < 1.2)) {
    const dh = clamp(wrapAngle(Math.atan2(dz, dx) - from.h), -1.3, 1.3), hb = from.h + dh, fb = [Math.cos(hb), Math.sin(hb)];
    const Bp = { x: from.x - 1.1 * f[0] - 0.9 * fb[0], z: from.z - 1.1 * f[1] - 0.9 * fb[1], h: hb };
    legs.push({ path: hermite(from, Bp, -1), rev: true }); cur = Bp;
  }
  if (Math.hypot(to.x - cur.x, to.z - cur.z) > 0.05) legs.push({ path: hermite(cur, to, 1), rev: false });
  return legs;
}

export class ForkliftDriver {
  constructor(rig) {
    this.rig = rig; this.pose = null; this.key = ''; this.sim = null; this.track = null; this.legs = []; this.mode = 'idle';
    this.s = 0; this.u = 0; this.a = 0; this.vT = 0; this.sPrev = null; this.vf = 0; this.vfPrev = 0; this.ax = 0; this.ay = 0;
    this.steer = 0; this.lift = HMIN; this.lv = 0; this.tilt = 0; this.load = false; this.dip = 0; this.dipRef = null;
    this.parkT = 0; this.snaps = 0; this.revBlend = 0; this.yaw = 0; this.pitch = 0; this.twist = 0; this.t = 0; this.state = {};
  }
  _place(x, z, h) { this.pose = { x, z, h }; this.rig.setPose(x, z, h); }
  _poseOn(track, s) { const p = track.path.at(s); return { x: p.x, z: p.z, h: p.heading + (track.rev ? PI : 0) }; }
  _curv(track, s) { const L = track.path.length, e = 0.12, a = track.path.at(clamp(s - e, 0, L)).heading, b = track.path.at(clamp(s + e, 0, L)).heading; return (wrapAngle(b - a) / Math.max(1e-3, Math.min(L, s + e) - Math.max(0, s - e))) * (track.rev ? -1 : 1); }
  // Velocidad máxima por curvatura próxima (aceleración lateral ≤ alat) con margen de frenado
  _speedCap(track, s, dir, alat, dec = 1.2) {
    const L = track.path.length; let cap = 9;
    for (let d = 0; d <= 6; d += 0.4) { const x = s + dir * d; if (x < 0 || x > L) break; const k = Math.abs(this._curv(track, x)); cap = Math.min(cap, Math.sqrt(alat / Math.max(k, 1e-3) + 2 * dec * d)); }
    return cap;
  }
  _startLegs(legs, purpose) { this.legs = legs; this.purpose = purpose; this.mode = purpose; this._nextLeg(); }
  _nextLeg() { const l = this.legs.shift(); if (l) { this.track = l; this.s = 0; this.u = 0; this.a = 0; return true; } this.track = null; return false; }
  _legsLeft() { return (this.track ? this.track.path.length - this.s : 0) + this.legs.reduce((s, l) => s + l.path.length, 0); }
  // Avance con aceleración y sobreaceleración limitadas hacia una velocidad deseada
  _drive(vd, dt, acc, dec, J = 3.0) {
    const speedUp = Math.abs(vd) > Math.abs(this.u) && Math.sign(vd || 1) === Math.sign(this.u || vd || 1);
    const lim = speedUp ? acc : dec, aD = clamp((vd - this.u) / 0.3, -lim, lim);
    this.a += clamp(aD - this.a, -J * dt, J * dt); if (Math.abs(vd - this.u) < 0.02 && Math.abs(aD) < 0.05) this.a = aD;
    const u0 = this.u; this.u += this.a * dt;
    if ((u0 - vd) * (this.u - vd) < 0) { this.u = vd; this.a = 0; } // no sobrepasar la consigna
  }

  // cmd = { path:[[x,z],..] | null, s, lift, load, active, park:[x,z,heading] }
  update(dt, cmd = {}) {
    dt = Math.min(dt, 0.1); this.t += dt;
    const R = this.rig, load = !!cmd.load, vmax = load ? 2.2 : 3.0, park = cmd.park ? { x: cmd.park[0], z: cmd.park[1], h: cmd.park[2] || 0 } : null;
    let liftT = cmd.lift ?? this.lift;
    if (!this.pose) {
      if (cmd.active && cmd.path) { const P = new Path2(cmd.path, 1.2), p = P.at(clamp(cmd.s || 0, 0, P.length)); this._place(p.x, p.z, p.heading); }
      else if (park) this._place(park.x, park.z, park.h); else this._place(0, 0, 0);
      if (!cmd.active) { this.mode = 'parked'; this.parkT = 99; this.lift = FORK.parkLift; }
    }
    if (cmd.active && cmd.path && cmd.path.length > 1) {
      const key = keyOf(cmd.path);
      if (key !== this.key) {
        // Ruta nueva: se engancha en la pose de la consigna actual (cmd.s), lo que permite encadenar tramos de avance y
        // marcha atrás (maniobras en K) sin replanificar; si la máquina está lejos, primero se aproxima.
        this.key = key; this.sim = { path: new Path2(cmd.path, cmd.radius ?? 1.2), rev: false }; this.sPrev = null; this.vT = 0;
        const s0 = clamp(cmd.s || 0, 0, this.sim.path.length), st = this._poseOn(this.sim, s0), far = Math.hypot(st.x - this.pose.x, st.z - this.pose.z) > 0.3 || Math.abs(wrapAngle(st.h - this.pose.h)) > 0.25;
        this.sApproach = s0; if (far) this._startLegs(planRoute(this.pose, st), 'approach'); else { this.mode = 'follow'; this.track = this.sim; this.s = s0; this.u = 0; this.a = 0; }
      }
      const L = this.sim.path.length, sT = clamp(cmd.s || 0, 0, L);
      const raw = this.sPrev === null ? 0 : (sT - this.sPrev) / Math.max(dt, 1e-3); this.sPrev = sT;
      this.vT = Math.abs(raw) > 8 ? this.vT : lag(this.vT, raw, 0.35, dt);
      if (this.mode !== 'follow' && this.mode !== 'approach') { // venía de aparcar o detenido: replanificar hacia la ruta
        const st = this._poseOn(this.sim, sT); this._startLegs(planRoute(this.pose, st), 'approach'); this.sApproach = sT;
      }
      if (this.mode === 'approach') {
        const adv = Math.abs(sT - (this.sApproach || 0)); // la simulación ya avanza: si el retraso supera 6 m, saltar
        if (adv > 0.05 && this._legsLeft() + adv > 6) { this.mode = 'follow'; this.track = this.sim; this.s = sT; this.u = 0; this.a = 0; this.snaps++; this.snapT = 0; }
        else this._runLegs(dt, 1.6, () => { this.mode = 'follow'; this.track = this.sim; this.s = this.sApproach || 0; this.u = 0; this.a = 0; });
      }
      if (this.mode === 'follow') {
        let gap = sT - this.s;
        if (Math.abs(gap) > 6) { this.s = sT - Math.sign(gap) * 0.5; this.u = clamp(this.vT, -vmax, vmax); gap = sT - this.s; this.snaps++; this.snapT = 0; }
        const vTc = clamp(this.vT, -vmax, vmax), g = Math.abs(gap);
        let vd = Math.abs(vTc) < 0.05 && g < 0.04 ? 0 : clamp(vTc + Math.sign(gap) * Math.min(Math.sqrt(2 * 1.2 * g), 1.4 * g), -vmax, vmax);
        const lead = Math.abs(this.u) * 0.3; // margen por el retardo de respuesta (tracción + sobreaceleración)
        vd = clamp(vd, -Math.sqrt(2 * 1.2 * Math.max(0, this.s - lead)), Math.sqrt(2 * 1.2 * Math.max(0, L - this.s - lead))); // detenerse en los extremos
        const vlim = this._speedCap(this.sim, this.s, Math.sign(vd || this.u || 1), load ? 0.7 : 1.0); vd = clamp(vd, -vlim, vlim); // curvas: a_lat limitada
        this._drive(vd, dt, 1.0, 1.5); this.s += this.u * dt;
        if (this.s <= 0 || this.s >= L) { this.s = clamp(this.s, 0, L); this.u = 0; this.a = 0; }
        if (Math.abs(this.u) < 0.01 && Math.abs(vd) < 1e-3) { this.u = 0; this.a = 0; }
      }
      liftT = cmd.lift ?? HMIN; this.parkT = 0;
    } else if (cmd.active) { // activo sin ruta: frenar y esperar
      if (this.track) { this._drive(0, dt, 1.0, 1.5); this.s = clamp(this.s + this.u * dt, 0, this.track.path.length); if (Math.abs(this.u) < 0.02) { this.u = 0; this.a = 0; } }
      this.mode = 'hold'; this.key = ''; this.parkT = 0;
    } else { // inactivo: volver vacío a la posición de aparcamiento
      if (this.mode !== 'park' && this.mode !== 'parked') { this.key = ''; if (park) this._startLegs(planRoute(this.pose, park), 'park'); else this.mode = 'parked'; }
      if (this.mode === 'park') this._runLegs(dt, 2.0, () => { this.mode = 'parked'; });
      if (this.mode === 'parked') { this.u = 0; this.a = 0; this.parkT += dt; }
      liftT = FORK.parkLift;
    }
    // Pose sobre la pista (eje delantero sobre la curva, rumbo = tangente: cinemática de dirección trasera)
    if (this.track && this.mode !== 'parked') { const p = this._poseOn(this.track, this.s); this._place(p.x, p.z, p.h); }
    const vf = this.track ? (this.track.rev ? -this.u : this.u) : 0, kap = this.track ? this._curv(this.track, this.s + vf * 0.15) : 0;
    // Dirección: ángulo de bicicleta atan(WB·κ), limitado en velocidad (dirección hidrostática)
    const stT = this.mode === 'parked' ? 0 : clamp(Math.atan(WB * kap), -MAXS, MAXS); this.steer += clamp(stT - this.steer, -1.6 * dt, 1.6 * dt);
    R.setSteer(this.steer); R.roll(vf * dt);
    this.ax = lag(this.ax, (vf - this.vfPrev) / Math.max(dt, 1e-3), 0.08, dt); this.vfPrev = vf; this.vf = vf; this.ay = lag(this.ay, vf * vf * clamp(kap, -1.5, 1.5), 0.08, dt);
    // Carga y descenso de horquillas al depositar
    if (this.load && !load) { this.dipRef = liftT; this.dip = -0.07; }
    if (!this.load && load) { this.dip = 0; this.dipRef = null; }
    if (this.dipRef !== null && Math.abs(liftT - this.dipRef) > 0.03) { this.dip = 0; this.dipRef = null; }
    this.load = load; R.setLoad(load);
    // Elevación: rampa trapezoidal con suavizado (0,45 m/s cargado, 0,55 vacío, bajada 0,5)
    const lT = clamp(liftT + this.dip, HMIN, HMAX), rem = lT - this.lift, sg = Math.sign(rem) || 1, lv0 = this.lv;
    this.snapT = (this.snapT ?? 99) + dt;
    if (Math.abs(rem) > 1.0 && this.snapT < 1) { this.lift = lT; this.lv = 0; } // simulación acelerada: la elevación salta junto con la posición
    else { let w = this.lv * sg; w = approach(w, Math.abs(rem), sg > 0 ? (load ? 0.45 : 0.55) : 0.5, 0.6, 0.8, dt); this.lv = w * sg; this.lift += this.lv * dt; if (Math.abs(lT - this.lift) < 1e-3 && Math.abs(this.lv) < 0.04) { this.lift = lT; this.lv = 0; } }
    R.setLift(this.lift);
    // Inclinación del mástil: atrás con carga en marcha, a 0° para depositar
    const moving = Math.abs(vf) > 0.1, placing = load && !moving && lT > 0.4 && Math.abs(lT - this.lift) < 0.35;
    const tT = this.mode === 'parked' ? 0 : load ? (placing || this.dip < 0 ? 0 : -4 * DEG) : (moving ? -2 * DEG : 0), tv = clamp((tT - this.tilt) * 3, -4 * DEG, 4 * DEG);
    this.tilt += tv * dt; R.setTilt(this.tilt); R.setLevers(this.lv / 0.45, tv / (4 * DEG), 0);
    // Operador: mira en la dirección de giro; al ir marcha atrás gira el torso y mira hacia atrás; mira las horquillas al elevar alto
    this.revBlend = lag(this.revBlend, vf < -0.05 || (this.track?.rev && this.mode !== 'parked' && Math.abs(vf) > 0.01) ? 1 : 0, 0.35, dt);
    const idle = 0.12 * Math.sin(this.t * 0.37) * Math.sin(this.t * 0.11 + 1);
    this.yaw = lag(this.yaw, lerp(this.steer * 0.6 + idle, 1.45, this.revBlend), 0.3, dt); this.twist = lag(this.twist, 0.42 * this.revBlend, 0.45, dt);
    this.pitch = lag(this.pitch, !moving && this.lift > 1.2 ? clamp((this.lift - 1.2) * 0.3, 0, 0.5) : 0, 0.5, dt);
    R.setLook(this.yaw, this.pitch, this.twist); R.setReverse(vf < -0.03);
    // Baliza y luces: se apagan 2 s después de aparcar
    const on = !(this.mode === 'parked' && this.parkT > 2); R.setBeacon(on); if (R.lights !== on) R.setLights(on);
    R.update(dt, { ax: this.ax, ay: this.ay, la: (this.lv - lv0) / Math.max(dt, 1e-3), v: vf });
    this.state = { mode: this.mode, s: +this.s.toFixed(3), sTarget: cmd.s, v: +vf.toFixed(3), a: +this.a.toFixed(3), steer: +this.steer.toFixed(3), lift: +this.lift.toFixed(3), liftTarget: lT, tilt: +(this.tilt / DEG).toFixed(2), legs: this.legs.length + (this.track && this.mode !== 'follow' ? 1 : 0), snaps: this.snaps, reversing: vf < -0.03, x: this.pose.x, z: this.pose.z, heading: this.pose.h };
  }
  _runLegs(dt, vmax, done) {
    const tr = this.track; if (!tr) { done(); return; }
    const L = tr.path.length, rem = L - this.s, vl = Math.min(tr.rev ? 1.3 : vmax, this._speedCap(tr, this.s, 1, 0.9));
    this._drive(Math.min(vl, Math.sqrt(2 * 1.1 * Math.max(0, rem - this.u * 0.3))), dt, 0.9, 1.4); this.u = Math.max(0, this.u); this.s += this.u * dt;
    if (this.s >= L - 0.004 || (rem < 0.03 && this.u < 0.03)) { this.s = L; this.u = 0; this.a = 0; const p = this._poseOn(tr, L); this._place(p.x, p.z, p.h); if (!this._nextLeg()) { this.track = tr; done(); } }
  }
}

// ---------------------------------------------------------------- Fábrica
export function createForklift(opt = {}) { const rig = new ForkliftRig(opt), driver = new ForkliftDriver(rig); return { group: rig.group, rig, driver }; }

// ---------------------------------------------------------------- Demo: ruta en L, elevación a 3,2 m, depósito en estantería, regreso
export function demo(scene) {
  const q = new URLSearchParams(location.search), F = fkMaterials(), M = materials();
  const { group, rig, driver } = createForklift({ dummyLoad: true }); scene.add(group);
  if (q.get('fk') === 'static') { // pose fija para inspección
    rig.setPose(0, 0, +(q.get('hd') || 0)); rig.setLift(+(q.get('lift') || 0.3)); rig.setTilt((+(q.get('tilt') || 0) * PI) / 180); rig.setSteer(+(q.get('steer') || 0)); rig.setLoad(q.get('load') === '1');
    let tri = 0, nm = 0; group.traverse((o) => { if (!o.isMesh || !o.visible) return; nm++; const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3; tri += n * (o.isInstancedMesh ? o.count : 1); });
    window.__fk = { rig, group }; const hud = document.getElementById('hud'); if (hud) hud.textContent = `montacargas: ${Math.round(tri)} triángulos · ${nm} mallas`;
    return (dt) => { rig.setLook(+(q.get('look') || 0), 0, +(q.get('tw') || 0)); rig.update(dt, {}); };
  }
  const P = [[-7, -2.5], [1.5, -2.5], [1.5, 2.6]], park = [-6, 1.2, PI], beamY = 3.2;
  // Estantería de destino y marcas de suelo
  const k = new Bk();
  for (const x of [0.83, 2.17]) for (const z of [3.2, 4.35]) k.put(M.paintBlue, rbox(0.09, 4.2, 0.07, 0.008, 1), T(x, 2.1, z));
  for (const z of [3.25, 4.30]) for (const y of [1.6, beamY]) k.put(M.paintOrange, rbox(1.42, 0.1, 0.05, 0.006, 1), T(1.5, y - 0.05, z));
  for (let i = 0; i < P.length - 1; i++) { const [a, b] = [P[i], P[i + 1]], l = Math.hypot(b[0] - a[0], b[1] - a[1]); for (const o of [-0.75, 0.75]) { const nx = -(b[1] - a[1]) / l, nz = (b[0] - a[0]) / l; k.put(M.paintYellow, rbox(l, 0.004, 0.06, 0.001, 1), T((a[0] + b[0]) / 2 + nx * o, 0.003, (a[1] + b[1]) / 2 + nz * o, 0, -Math.atan2(b[1] - a[1], b[0] - a[0]))); } }
  k.flush(scene);
  const placed = rig._dummyLoad(); placed.visible = false; scene.add(placed);
  // Simulación falsa: progreso a lo largo de la ruta con pausas, ráfaga rápida, elevación y retorno
  const L = new Path2(P, 1.2).length; let ph = 0, t = 0, s = 0, lift = 0.15, load = true, active = false;
  const skip = +(q.get('skip') || 0), fast = q.get('jump') === '1';
  const step = (dt) => {
    t += dt; const st = driver.state;
    switch (ph) {
      case 0: active = false; load = true; lift = 0.15; s = 0; placed.visible = false; if (t > 2) { ph = 1; t = 0; active = true; } break;
      case 1: if (st.mode === 'follow') { ph = 2; t = 0; } break;                                         // aproximación al inicio de ruta
      case 2: if (t > 1) { ph = 3; t = 0; } break;
      case 3: s = Math.min(L, s + dt * (fast ? 30 : t > 4 && t < 6 ? 3.0 : t > 8 && t < 9.5 ? 0 : 1.7)); if (s >= L) { ph = 4; t = 0; } break; // ráfaga y pausa
      case 4: if (t > 1.2 && Math.abs(st.v) < 0.01) { lift = beamY + 0.06; ph = 5; t = 0; } break;
      case 5: if (Math.abs(st.lift - lift) < 0.005 && t > 1) { ph = 6; t = 0; } break;
      case 6: if (t > 0.8) { load = false; ph = 7; t = 0; rig.loadAnchor.updateWorldMatrix(true, false); rig.loadAnchor.getWorldPosition(placed.position); placed.position.y = beamY; placed.rotation.set(0, group.rotation.y, 0); placed.visible = true; } break; // depositar (bajan 7 cm)
      case 7: if (t > 1.5) { s = L - 1.6; ph = 8; t = 0; } break;                                                   // marcha atrás para sacar las horquillas
      case 8: if (t > 1 && Math.abs(st.v) < 0.01 && Math.abs(st.s - s) < 0.05) { lift = 0.15; ph = 9; t = 0; } break;
      case 9: if (Math.abs(st.lift - lift) < 0.01 && t > 1) { active = false; ph = 10; t = 0; } break;
      case 10: if (st.mode === 'parked' && t > 3) { ph = 0; t = 0; } break;
    }
    driver.update(dt, { path: active ? P : null, s, lift, load: ph < 7 ? load : false, active, park });
  };
  for (let i = 0; i < skip * 30; i++) step(1 / 30);
  window.__fk = { rig, driver };
  return (dt) => step(dt);
}
