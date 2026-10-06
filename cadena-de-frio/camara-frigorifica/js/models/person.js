// OPERARIO DE CÁMARA FRIGORÍFICA: humano articulado (≈1,75 m) con EPP térmico (chaqueta acolchada con bandas
// reflectantes, pantalón térmico, guantes, botas de seguridad, gorro de punto + casco, gafas) y animación procedural
// realista: marcha por fases con apoyo plantado (IK de 2 huesos, sin deslizamiento), paso de giro en el sitio,
// reposo con respiración / vaho / cambio de apoyo / miradas, y acciones mezclables por pesos.
// CONVENCIONES: origen del grupo = suelo entre los pies; el operario MIRA HACIA +X del grupo (derecha = +Z).
// Rumbo "heading" en la escena = atan2(dz, dx) (igual que Path2); group.rotation.y = -heading.
// Internamente el esqueleto se modela mirando a +Z (grupo "body" girado +90°): +X interno = izquierda del operario.
import { THREE, PI, TAU, mergeT, T, canvas, tex, normalFrom, materials, clamp, lerp, smoothstep, wrapAngle, lag, smoothDamp, Path2, approach, hash } from './kit.js';

// ---------------------------------------------------------------- Medidas antropométricas (m)
export const BODY = { hipY: 0.93, hipX: 0.088, thigh: 0.425, shin: 0.415, ankleH: 0.09, heel: 0.06, ball: 0.135, toe: 0.225,
  spineY: 0.07, chestY: 0.15, neckY: 0.31, headY: 0.10, shX: 0.185, shY: 0.27, upper: 0.30, fore: 0.255, height: 1.75 };
const B = BODY, LEG = B.thigh + B.shin;

// ---------------------------------------------------------------- Geometría orgánica
// Loft por secciones superelípticas a lo largo de Y. Anillo: [y, semiancho X, semifondo +Z, semifondo -Z, x0, z0, n]
// (n = 2 elipse, >2 más "cuadrado"). Interpolación Catmull-Rom entre anillos; u = 0 en la espalda, 0,5 delante.
export function loft(rings, o = {}) {
  const R = o.seg ?? 16, sub = o.sub ?? 2, ks = ['y', 'w', 'd', 'b', 'x', 'z', 'n'];
  const K = rings.map((r) => ({ y: r[0], w: r[1], d: r[2] ?? r[1], b: r[3] ?? r[2] ?? r[1], x: r[4] ?? 0, z: r[5] ?? 0, n: r[6] ?? 2 }));
  const cr = (a, b, c, d, t) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t), rows = [];
  for (let i = 0; i < K.length - 1; i++) for (let s = 0; s < sub; s++) {
    const t = s / sub, A = K[Math.max(0, i - 1)], P = K[i], C = K[i + 1], D = K[Math.min(K.length - 1, i + 2)], r = {};
    for (const k of ks) r[k] = cr(A[k], P[k], C[k], D[k], t); rows.push(r);
  }
  rows.push(K[K.length - 1]);
  const [vA, vB] = o.vy ?? [K[0].y, K[K.length - 1].y], pos = [], uv = [], idx = [], W = R + 1;
  rows.forEach((r) => { for (let i = 0; i <= R; i++) {
    const th = -PI / 2 + (i / R) * TAU, c = Math.cos(th), s = Math.sin(th), e = 2 / Math.max(0.6, r.n);
    pos.push(r.x + Math.max(0, r.w) * Math.sign(c) * Math.abs(c) ** e, r.y, r.z + Math.max(0, s >= 0 ? r.d : r.b) * Math.sign(s) * Math.abs(s) ** e);
    uv.push(i / R, (r.y - vA) / (vB - vA));
  } });
  for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < R; i++) { const a = j * W + i, b = a + W; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const cap = (j, flip) => { const r = rows[j], c = pos.length / 3; pos.push(r.x, r.y, r.z); uv.push(0.5, (r.y - vA) / (vB - vA));
    for (let i = 0; i < R; i++) { const a = j * W + i; flip ? idx.push(c, a + 1, a) : idx.push(c, a, a + 1); } };
  const up = rows[rows.length - 1].y > rows[0].y; if (o.cap?.[0]) cap(0, !up); if (o.cap?.[1]) cap(rows.length - 1, up);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const n = g.attributes.normal, jm = rows.length >> 1, iq = jm * W + Math.round(R / 4); // anillo medio, lado +X
  if (n.getX(iq) < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  const N = g.attributes.normal; for (let j = 0; j < rows.length; j++) { const a = j * W, b = a + R, v = new THREE.Vector3(N.getX(a) + N.getX(b), N.getY(a) + N.getY(b), N.getZ(a) + N.getZ(b)).normalize(); N.setXYZ(a, v.x, v.y, v.z); N.setXYZ(b, v.x, v.y, v.z); }
  return g;
}
// Espejo en X (lado derecho a partir del izquierdo) conservando el sentido de las caras.
function mirrorX(g) {
  const m = g.index ? g.toNonIndexed() : g.clone(); m.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  for (const k in m.attributes) { const a = m.attributes[k], n = a.itemSize, A = a.array; for (let t = 0; t < a.count; t += 3) for (let c = 0; c < n; c++) { const i1 = (t + 1) * n + c, i2 = (t + 2) * n + c, x = A[i1]; A[i1] = A[i2]; A[i2] = x; } }
  return m;
}
// Color de vértice uniforme (para fusionar piel, ojos, correas… en una sola malla).
const vc = (g, hex) => { g = g.index ? g.toNonIndexed() : g; const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
const uvConst = (g, u, v) => { g = g.index ? g.toNonIndexed() : g; const a = g.attributes.uv; for (let i = 0; i < a.count; i++) a.setXY(i, u, v); return g; };
const ell = (sx, sy, sz, ws = 12, hs = 8) => { const g = new THREE.SphereGeometry(1, ws, hs); g.scale(sx, sy, sz); return g; };
const caps = (r, l, cs = 2, rs = 7) => new THREE.CapsuleGeometry(r, l, cs, rs);

// ---------------------------------------------------------------- Texturas de prendas (pintadas en el espacio UV del loft)
const _memo = new Map(), memo = (k, f) => (_memo.has(k) ? _memo.get(k) : (_memo.set(k, f()), _memo.get(k)));
const css = (c) => '#' + new THREE.Color(c).getHexString();
// spec: base, vy [yA,yB] (altura de la textura), quilt (paso del acolchado), ops [{band|rect|vline}], rough
function garment(spec) {
  const S = 512, [yA, yB] = spec.vy, Y = (y) => (1 - (y - yA) / (yB - yA)) * S;
  const col = canvas(S, S, () => {}), hgt = canvas(S, S, () => {}), rm = canvas(S, S, () => {});
  const gc = col.getContext('2d'), gh = hgt.getContext('2d'), gr = rm.getContext('2d');
  gc.fillStyle = css(spec.base); gc.fillRect(0, 0, S, S); gh.fillStyle = '#808080'; gh.fillRect(0, 0, S, S);
  gr.fillStyle = `rgb(0,${Math.round((spec.rough ?? 0.85) * 255)},0)`; gr.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) { const x = hash(i) * S, y = hash(i + 77) * S, a = 0.03 + hash(i + 5) * 0.05; gc.fillStyle = `rgba(${hash(i + 3) < 0.5 ? '0,0,0' : '255,255,255'},${a})`; gc.fillRect(x, y, 2, 1); } // fibra
  if (spec.quilt) for (let y = yA; y < yB; y += spec.quilt) { // costuras del acolchado (surcos)
    const py = Y(y); gh.fillStyle = '#3a3a3a'; gh.fillRect(0, py - 2, S, 4); gh.fillStyle = '#5c5c5c'; gh.fillRect(0, py - 5, S, 3); gh.fillRect(0, py + 2, S, 3);
    gc.fillStyle = 'rgba(0,0,0,0.18)'; gc.fillRect(0, py - 1.5, S, 3);
  }
  const paint = (o, x0, y0, w, h) => {
    if (o.col) { gc.fillStyle = css(o.col); gc.fillRect(x0, y0, w, h); }
    if (o.r != null) { gr.fillStyle = `rgb(0,${Math.round(o.r * 255)},${Math.round((o.m ?? 0) * 255)})`; gr.fillRect(x0, y0, w, h); }
    if (o.h != null) { gh.fillStyle = `rgb(${o.h},${o.h},${o.h})`; gh.fillRect(x0, y0, w, h); }
    if (o.edge) { gh.strokeStyle = '#2a2a2a'; gh.lineWidth = 3; gh.strokeRect(x0, y0, w, h); gc.strokeStyle = 'rgba(0,0,0,0.35)'; gc.lineWidth = 2; gc.strokeRect(x0 + 1, y0 + 1, w - 2, h - 2); }
    if (o.dots) { gc.fillStyle = 'rgba(255,255,255,0.25)'; for (let x = x0; x < x0 + w; x += 6) for (let y = y0; y < y0 + h; y += 6) gc.fillRect(x, y, 1.5, 1.5); }
  };
  for (const o of spec.ops) {
    if (o.band) paint(o, 0, Y(o.band[1]), S, Y(o.band[0]) - Y(o.band[1]));
    if (o.rect) { const [u0, u1, a, b] = o.rect; paint(o, u0 * S, Y(b), (u1 - u0) * S, Y(a) - Y(b)); }
    if (o.zip) { const [u, a, b] = o.zip, x = u * S; paint({ col: 0x1a1d21, r: 0.4, m: 0.6, h: 200 }, x - 3, Y(b), 6, Y(a) - Y(b)); gc.fillStyle = '#5a6068'; for (let y = Y(b); y < Y(a); y += 4) gc.fillRect(x - 3, y, 6, 1.5); gh.fillStyle = '#4a4a4a'; gh.fillRect(x - 12, Y(b), 2, Y(a) - Y(b)); gh.fillRect(x + 10, Y(b), 2, Y(a) - Y(b)); }
    if (o.text) { const [u, y, t, sz] = o.text; gc.save(); gc.translate(u * S, Y(y)); gc.scale(-1, 1); gc.fillStyle = o.col ? css(o.col) : '#222'; gc.font = `bold ${sz}px sans-serif`; gc.textAlign = 'center'; gc.fillText(t, 0, 0); gc.restore(); } // u crece hacia la derecha del operario: texto en espejo
  }
  return { map: tex(col), normalMap: normalFrom(hgt, 3), rm: tex(rm, [1, 1], false) };
}
const REFL = { col: 0xcfd6dc, r: 0.28, m: 0.6, h: 150, dots: true };
const JACKETS = { blue: 0x1d4c8f, orange: 0xd9611c, grey: 0x575e66 };
const HELMETS = { white: 0xeef1f3, yellow: 0xf0b80f, blue: 0x1f5fb8 };
const clothMat = (g, extra = {}) => new THREE.MeshStandardMaterial({ map: g.map, normalMap: g.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: g.rm, metalnessMap: g.rm, roughness: 1, metalness: 1, ...extra });

function wardrobe(o) {
  const jc = JACKETS[o.jacket] ?? o.jacket ?? JACKETS.blue, hc = HELMETS[o.helmet] ?? o.helmet ?? HELMETS.yellow;
  return memo(`w${jc}|${hc}|${o.skin}|${o.trousers}`, () => {
    const M = materials(), tr = o.trousers ?? 0x252c38;
    const torso = memo('jt' + jc, () => clothMat(garment({ base: jc, vy: [0.78, 1.56], quilt: 0.075, ops: [
      { band: [0.78, 0.835], col: new THREE.Color(jc).multiplyScalar(0.55), h: 110, r: 0.95 },          // dobladillo elástico
      { band: [1.015, 1.065], ...REFL }, { band: [1.265, 1.315], ...REFL },                             // bandas reflectantes
      { rect: [0.37, 0.445, 1.13, 1.235], col: new THREE.Color(jc).multiplyScalar(0.85), h: 150, edge: true },   // bolsillo pecho
      { rect: [0.365, 0.45, 1.205, 1.24], col: new THREE.Color(jc).multiplyScalar(0.7), h: 170, edge: true },     // solapa
      { rect: [0.535, 0.63, 1.335, 1.37], col: 0xf2f2f2, r: 0.7, h: 140 }, { text: [0.5825, 1.344, 'FRÍO −25 °C', 9], col: 0x203040 },
      { rect: [0.48, 0.52, 0.78, 1.56], col: new THREE.Color(jc).multiplyScalar(0.92), h: 160 }, { zip: [0.5, 0.80, 1.56] },  // tapeta + cremallera
      { band: [1.5, 1.56], col: new THREE.Color(jc).multiplyScalar(0.8), h: 140 },
    ] })));
    const sleeve = memo('js' + jc, () => clothMat(garment({ base: jc, vy: [-0.7, 0.05], quilt: 0.08, ops: [
      { band: [-0.255, -0.205], ...REFL }, { band: [-0.47, -0.43], ...REFL }, { band: [-0.6, -0.545], col: 0x1c1f24, r: 0.95, h: 100 },
    ] })));
    const legs = memo('tr' + tr, () => clothMat(garment({ base: tr, vy: [-0.15, 0.85], quilt: 0, rough: 0.9, ops: [
      { rect: [0.17, 0.33, 0.12, 0.29], col: new THREE.Color(tr).multiplyScalar(0.8), h: 150, edge: true }, { rect: [0.165, 0.335, 0.11, 0.15], col: new THREE.Color(tr).multiplyScalar(0.65), h: 175, edge: true },
      { rect: [0.38, 0.62, 0.37, 0.47], col: 0x15191f, r: 0.75, h: 175, edge: true },                  // rodillera
      { band: [0.505, 0.545], ...REFL }, { band: [0.585, 0.625], ...REFL }, { band: [0.78, 0.85], col: new THREE.Color(tr).multiplyScalar(0.7), h: 110 },
      { rect: [0.245, 0.255, -0.15, 0.85], col: new THREE.Color(tr).multiplyScalar(0.7), h: 90 }, { rect: [0.745, 0.755, -0.15, 0.85], col: new THREE.Color(tr).multiplyScalar(0.7), h: 90 },
    ] })));
    const vest = memo('vest', () => clothMat(garment({ base: 0xd6ef2c, vy: [0.78, 1.56], ops: [
      { band: [1.03, 1.08], ...REFL }, { band: [1.25, 1.30], ...REFL }, { rect: [0.485, 0.515, 0.78, 1.56], col: 0x9aae1e, h: 110 }, { band: [0.95, 0.975], col: 0x9aae1e, h: 110 },
    ] }), { emissive: 0x2a3300, emissiveIntensity: 0.3 }));
    const boot = memo('boot', () => { const g = garment({ base: 0x1d1a18, vy: [0, 1], rough: 0.55, ops: [
      { band: [0, 0.07], col: 0x121314, r: 0.95, h: 90 }, { band: [0.95, 1], col: 0x3a3632, r: 1, h: 175, dots: true }, { band: [0.6, 0.62], col: 0x0e0e0e, h: 100 },
      { rect: [0.47, 0.53, 0.66, 0.86], col: 0x2b2724, h: 170, edge: true } ] });
      return new THREE.MeshStandardMaterial({ map: g.map, normalMap: g.normalMap, roughnessMap: g.rm, roughness: 1, metalness: 0 }); });
    const knit = memo('knit', () => { const k = canvas(128, 32, (g, w, h) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 4) { g.fillStyle = '#d0d0d0'; g.fillRect(x, 0, 2, h); } });
      const n = normalFrom(k, 4, [6, 4]); return new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 1, normalMap: n }); });
    const glove = memo('glove', () => { const k = canvas(64, 64, (g, w, h) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); for (let i = 0; i < 300; i++) { g.fillStyle = hash(i) < 0.5 ? '#606060' : '#a0a0a0'; g.fillRect(hash(i + 1) * w, hash(i + 2) * h, 2, 2); } });
      return new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.9, normalMap: normalFrom(k, 2, [3, 3]) }); });
    return {
      torso, sleeve, legs, vest, boot, knit, glove,
      skin: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.62, metalness: 0 }),
      helmet: new THREE.MeshPhysicalMaterial({ color: hc, roughness: 0.32, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.25, side: THREE.DoubleSide }),
      lens: new THREE.MeshPhysicalMaterial({ color: 0xcfe3ef, roughness: 0.05, transparent: true, opacity: 0.28, depthWrite: false }),
      skinHex: o.skin ?? 0xc89270, M,
    };
  });
}

// ---------------------------------------------------------------- Cabeza esculpida (dirección unitaria → punto de la superficie)
const gss = (x, y, cx, cy, sx, sy) => Math.exp(-(((x - cx) / sx) ** 2) - (((y - cy) / sy) ** 2));
function sculpt(x, y, z) {
  let X = x * 0.073, Y = y * 0.112, Z = z * (z > 0 ? 0.093 : 0.104);
  const low = smoothstep((-y - 0.15) / 0.8); X *= 1 - 0.22 * low; if (z < 0) Z *= 1 - 0.5 * low; // mandíbula y nuca
  if (z > 0.2) {
    const k = smoothstep((z - 0.2) / 0.4);
    Z += k * (0.02 * gss(x, y, 0, -0.16, 0.15, 0.17) + 0.013 * gss(x, y, 0, -0.33, 0.2, 0.08) + 0.004 * gss(x, y, 0, -0.38, 0.32, 0.05));  // nariz (puente, punta, aletas)
    Z += k * (0.008 * gss(x, y, 0, 0.2, 0.62, 0.08) - 0.011 * (gss(x, y, 0.42, 0.03, 0.17, 0.11) + gss(x, y, -0.42, 0.03, 0.17, 0.11))); // arco superciliar / cuencas
    Z += k * (0.006 * (gss(x, y, 0.56, -0.18, 0.18, 0.13) + gss(x, y, -0.56, -0.18, 0.18, 0.13)) + 0.005 * gss(x, y, 0, -0.55, 0.26, 0.08) - 0.003 * gss(x, y, 0, -0.64, 0.3, 0.035) + 0.013 * gss(x, y, 0, -0.86, 0.3, 0.12));
    Y -= 0.008 * gss(x, y, 0, -0.86, 0.36, 0.15);
  }
  return new THREE.Vector3(X, Y, Z);
}
const HC = new THREE.Vector3(0, 0.078, 0.012); // centro de la cabeza respecto al pivote (atlas)
const onHead = (x, y, z, inset = 0) => { const d = new THREE.Vector3(x, y, z).normalize(), p = sculpt(d.x, d.y, d.z); return p.add(HC).addScaledVector(d, -inset); };

// ---------------------------------------------------------------- Construcción de piezas
function buildGeos(o) {
  return memo(`geo${!!o.glasses}|${o.skin}`, () => {
    const G = {}, skin = o.skin ?? 0xc89270, dark = 0x15171a;
    const torsoR = [[0.80, 0.172, 0.118, 0.124, 0, 0, 2.4], [0.84, 0.19, 0.13, 0.132, 0, 0, 2.5], [0.93, 0.186, 0.13, 0.13, 0.0, 0, 2.5], [1.00, 0.176, 0.127, 0.122, 0, 0.004, 2.4],
      [1.10, 0.177, 0.131, 0.119, 0, 0.008, 2.5], [1.20, 0.187, 0.140, 0.122, 0, 0.01, 2.6], [1.30, 0.199, 0.143, 0.128, 0, 0.006, 2.7], [1.37, 0.212, 0.132, 0.128, 0, 0, 2.9],
      [1.425, 0.214, 0.106, 0.118, 0, -0.006, 3.0], [1.46, 0.185, 0.088, 0.104, 0, -0.01, 2.6], [1.49, 0.12, 0.074, 0.085, 0, -0.01, 2.2], [1.515, 0.075, 0.064, 0.072, 0, -0.008, 2], [1.53, 0.066, 0.06, 0.068, 0, -0.008, 2]];
    const sl = (y0, y1) => torsoR.filter((r) => r[0] >= y0 && r[0] <= y1);
    // abdomen (grupo spine, pivote y = 1.00) y tórax (grupo chest, pivote y = 1.15)
    G.abdomen = loft(sl(0.79, 1.21), { seg: 22, sub: 2, vy: [0.78, 1.56], cap: [true, false] }); G.abdomen.translate(0, -1.0, 0);
    const chest = loft(sl(1.09, 1.54), { seg: 22, sub: 2, vy: [0.78, 1.56], cap: [false, true] });
    const collar = new THREE.TorusGeometry(0.074, 0.03, 8, 22); collar.rotateX(PI / 2); collar.scale(1, 1, 1.15); collar.rotateX(0.28);
    const hood = ell(0.1, 0.055, 0.05, 14, 8);
    G.chest = mergeT([[chest, T(0, -1.15, 0)], [uvConst(collar, 0.25, 0.97), T(0, 1.515 - 1.15, -0.004)], [uvConst(hood, 0.25, 0.97), T(0, 1.478 - 1.15, -0.098, 0.5)]]);
    G.vest = loft([[0.99, 0.19, 0.143, 0.138], [1.10, 0.195, 0.149, 0.136], [1.20, 0.204, 0.158, 0.139], [1.30, 0.214, 0.16, 0.145], [1.36, 0.203, 0.15, 0.145], [1.41, 0.168, 0.124, 0.135], [1.46, 0.142, 0.1, 0.119], [1.495, 0.106, 0.083, 0.093]].map((r) => [...r, 0, 0, 2.6]), { seg: 20, sub: 2, vy: [0.78, 1.56] }); G.vest.translate(0, -1.15, 0); // chaleco con sisas (deja ver los hombros)
    // pelvis (pantalón)
    G.pelvis = loft([[0.70, 0.05, 0.045, 0.05], [0.74, 0.12, 0.09, 0.1], [0.80, 0.155, 0.1, 0.113], [0.88, 0.16, 0.103, 0.115], [0.97, 0.155, 0.098, 0.108], [1.03, 0.13, 0.085, 0.095]].map((r) => [r[0] - B.hipY, ...r.slice(1)]),
      { seg: 22, sub: 2, cap: [true, true] }); G.pelvis = uvConst(G.pelvis, 0.1, 0.03);
    // pierna izquierda (+X): muslo, pierna, bota; v de textura = distancia desde la cadera
    const thigh = loft([[0.07, 0.06, 0.06, 0.07, 0.0], [0.02, 0.083, 0.088, 0.094, 0.0], [-0.1, 0.081, 0.085, 0.089, 0.003], [-0.22, 0.073, 0.077, 0.076, 0.002], [-0.33, 0.063, 0.067, 0.062], [-0.40, 0.059, 0.066, 0.056], [-0.445, 0.053, 0.054, 0.05], [-0.47, 0.03, 0.03, 0.03]],
      { seg: 16, sub: 2, vy: [0.15, -0.85], cap: [false, true] });
    const shin = loft([[0.05, 0.042, 0.04, 0.04], [0.02, 0.058, 0.062, 0.054], [-0.06, 0.059, 0.056, 0.07], [-0.14, 0.057, 0.051, 0.071], [-0.25, 0.052, 0.05, 0.055], [-0.33, 0.057, 0.059, 0.058], [-0.385, 0.063, 0.066, 0.064], [-0.392, 0.05, 0.05, 0.05]],
      { seg: 16, sub: 2, vy: [0.15 + B.thigh, -0.85 + B.thigh], cap: [true, true] });
    // bota: empeine/puntera (loft a lo largo del pie) + caña + suela (con uv en la franja de goma de la textura)
    const footR = [[-0.078, 0.028, 0.032, 0.03, 0, 0.045], [-0.06, 0.045, 0.052, 0.07, 0, 0.032], [-0.01, 0.05, 0.065, 0.08, 0, 0.02], [0.05, 0.05, 0.05, 0.05, 0, 0.04], [0.11, 0.053, 0.034, 0.032, 0, 0.052], [0.17, 0.05, 0.03, 0.026, 0, 0.056], [0.205, 0.04, 0.024, 0.02, 0, 0.058], [0.228, 0.022, 0.014, 0.012, 0, 0.06]];
    const foot = loft(footR.map((r) => [...r, 2.8]), { seg: 14, sub: 2, vy: [-0.2, 0.75], cap: [true, true] }); foot.applyMatrix4(T(0, 0, 0, PI / 2));
    const shaft = loft([[-0.05, 0.05, 0.058, 0.056, 0, 0.004], [0.03, 0.048, 0.05, 0.052], [0.1, 0.046, 0.047, 0.049], [0.125, 0.048, 0.05, 0.05], [0.135, 0.044, 0.045, 0.045]], { seg: 14, sub: 1, vy: [-0.5, 0.15], cap: [false, true] });
    const fp = []; for (let i = 0; i < 20; i++) { const a = (i / 20) * TAU, c = Math.cos(a), s = Math.sin(a), f = c > 0 ? 0.08 + c * 0.155 : 0.08 + c * 0.16, w = (c > 0 ? 0.058 - 0.012 * c ** 4 : 0.05 - 0.004 * c * c) * s; fp.push(new THREE.Vector2(w, f)); }
    const sole = new THREE.ExtrudeGeometry(new THREE.Shape(fp), { depth: 0.024, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1, curveSegments: 1 });
    sole.applyMatrix4(T(0, -B.ankleH + 0.028, 0, PI / 2)); // plano XY → XZ (y de la forma = adelante)
    G.boot = mergeT([[foot, null], [shaft, null], [uvConst(sole, 0.5, 0.03), null]]);
    G.thigh = thigh; G.shin = shin;
    // brazo izquierdo: hombro (deltoides), antebrazo con puño, guante con dedos y pulgar
    G.upper = loft([[0.068, 0.012, 0.012, 0.012], [0.058, 0.042, 0.044, 0.044], [0.03, 0.064, 0.064, 0.064], [-0.01, 0.07, 0.066, 0.068], [-0.08, 0.064, 0.062, 0.062], [-0.18, 0.058, 0.056, 0.057], [-0.27, 0.053, 0.05, 0.05], [-0.315, 0.043, 0.042, 0.042], [-0.335, 0.02, 0.02, 0.02]], { seg: 16, sub: 2, vy: [-0.7, 0.05], cap: [true, true] });
    G.fore = loft([[0.045, 0.03, 0.03, 0.03], [0.02, 0.05, 0.05, 0.05], [-0.04, 0.053, 0.052, 0.054], [-0.11, 0.05, 0.048, 0.05], [-0.2, 0.044, 0.043, 0.043], [-0.225, 0.046, 0.046, 0.046], [-0.26, 0.042, 0.042, 0.042], [-0.27, 0.03, 0.03, 0.03]].map((r) => [...r]),
      { seg: 16, sub: 2, vy: [-0.7 + B.upper, 0.05 + B.upper], cap: [true, true] });
    const hand = (curl, curl2) => {
      const L = [[loft([[0.02, 0.025, 0.035, 0.035], [-0.01, 0.027, 0.04, 0.04], [-0.045, 0.024, 0.046, 0.046, -0.002], [-0.08, 0.02, 0.047, 0.047, -0.003], [-0.1, 0.016, 0.043, 0.043, -0.003], [-0.108, 0.01, 0.032, 0.032, -0.003]], { seg: 12, sub: 2, cap: [false, true] }), null]];
      [[0.032, 0.04, 0.032], [0.011, 0.045, 0.035], [-0.011, 0.043, 0.033], [-0.031, 0.036, 0.028]].forEach(([z, lp, ld], i) => {
        const c1 = curl * (1 + i * 0.08), base = T(-0.003, -0.095, z, 0, 0, -c1), m2 = base.clone().multiply(T(0, -lp, 0, 0, 0, -curl2));
        if (curl > 0.6) L.push([caps(0.0105, lp, 1, 5), base.clone().multiply(T(0, -lp / 2))], [caps(0.0098, ld, 1, 5), m2.multiply(T(0, -ld / 2))]); // puño cerrado: 2 falanges
        else L.push([caps(0.0102, lp + ld - 0.006, 1, 5), base.clone().multiply(T(0, 0, 0, 0, 0, -curl2 * 0.5)).multiply(T(0, -(lp + ld) / 2))]);
      });
      const tb = T(-0.012, -0.022, 0.036, -0.75, 0, -0.45), t2 = tb.clone().multiply(T(0, -0.042, 0, 0, 0, -0.35 * (curl > 0.6 ? 1.8 : 1)));
      L.push([caps(0.0125, 0.04, 1, 5), tb.clone().multiply(T(0, -0.02))], [caps(0.011, 0.03, 1, 5), t2.multiply(T(0, -0.015))]);
      const cuff = new THREE.CylinderGeometry(0.038, 0.034, 0.05, 12, 1, true); L.push([cuff, T(0, 0.012, 0, 0, 0, 0, 1, 1, 1.15)]);
      return mergeT(L);
    };
    G.handOpen = hand(0.38, 0.42); G.handGrip = hand(1.2, 1.25);
    // cabeza (piel + rasgos con color de vértice: ojos, cejas, boca, barboquejo, montura de gafas)
    const hg = new THREE.SphereGeometry(1, 26, 19), p = hg.attributes.position;
    for (let i = 0; i < p.count; i++) { const s = sculpt(p.getX(i), p.getY(i), p.getZ(i)).add(HC); p.setXYZ(i, s.x, s.y, s.z); }
    hg.computeVertexNormals();
    const H = [[vc(hg, skin), null]];
    for (const sx of [1, -1]) {
      const e = onHead(sx * 0.43, 0.02, 0.9, 0.0035), b = onHead(sx * 0.42, 0.27, 0.87, -0.002);
      H.push([vc(ell(0.0125, 0.0082, 0.008, 8, 6), 0xd8d2c8), T(e.x, e.y, e.z)], [vc(ell(0.0062, 0.0062, 0.004, 8, 4), 0x16110d), T(e.x, e.y, e.z + 0.0056)]);
      H.push([vc(caps(0.004, 0.02, 1, 4), 0x2b1e14), T(b.x, b.y, b.z, 0, sx * 0.25, PI / 2 - sx * 0.12, 1, 1, 0.6)]);
      H.push([vc(ell(0.011, 0.028, 0.019, 8, 6), skin), T(sx * 0.073, HC.y - 0.006, HC.z - 0.008, 0, sx * 0.3)]); // orejas
      H.push([vc(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[0.1, 0.03, -0.012], [0.088, -0.03, -0.004], [0.066, -0.088, 0.018], [0.03, -0.115, 0.045], [0.0, -0.12, 0.052]].map(([x, y, z]) => new THREE.Vector3(sx * x, y + HC.y, z + HC.z))), 10, 0.0035, 4), dark), null]); // barboquejo
    }
    const m = onHead(0, -0.56, 0.83, 0.002); H.push([vc(ell(0.019, 0.0042, 0.005, 10, 4), 0x9a5b4e), T(m.x, m.y, m.z)]);
    if (o.glasses) {
      H.push([vc(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([-1.0, -0.6, -0.25, 0, 0.25, 0.6, 1.0].map((a) => new THREE.Vector3(Math.sin(a) * 0.104 * 0.86, HC.y + 0.024, HC.z + Math.cos(a) * 0.104))), 14, 0.003, 3), dark), null]);
      for (const sx of [1, -1]) H.push([vc(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[0.074, 0.024, 0.06], [0.078, 0.02, 0.0], [0.076, 0.0, -0.03]].map(([x, y, z]) => new THREE.Vector3(sx * x, y + HC.y, z + HC.z))), 6, 0.0028, 3), dark), null]);
      G.lens = new THREE.LatheGeometry([new THREE.Vector2(0.104, -0.016), new THREE.Vector2(0.105, 0.004), new THREE.Vector2(0.104, 0.024)], 18, -1.0, 2.0); G.lens.applyMatrix4(T(HC.x, HC.y, HC.z, 0, 0, 0, 0.86, 1, 1));
    }
    G.head = mergeT(H);
    G.neck = vc(loft([[-0.04, 0.05, 0.05, 0.05], [0.03, 0.05, 0.048, 0.052, 0, 0.005], [0.09, 0.046, 0.044, 0.05, 0, 0.018], [0.13, 0.045, 0.04, 0.05, 0, 0.026]], { seg: 16, sub: 2 }), skin);
    // gorro de punto (con vuelta) y casco con visera, ala y nervios
    const bn = new THREE.SphereGeometry(1, 22, 8, 0, TAU, 0, PI * 0.53); bn.scale(0.083, 0.119, 0.106);
    const cuff = new THREE.SphereGeometry(1, 22, 2, 0, TAU, PI * 0.42, PI * 0.12); cuff.scale(0.089, 0.124, 0.112);
    G.beanie = mergeT([[bn, T(HC.x, HC.y + 0.004, HC.z - 0.004, -0.3)], [cuff, T(HC.x, HC.y + 0.004, HC.z - 0.004, -0.3)]]);
    const sh = new THREE.SphereGeometry(1, 24, 7, 0, TAU, 0, PI / 2); sh.scale(0.104, 0.112, 0.128);
    // ala: faldón de revolución (anillo fino) deformado hacia delante para formar la visera
    const brim = new THREE.LatheGeometry([[0.97, 0.004], [1.07, 0.0], [1.1, -0.004], [1.1, -0.01], [1.06, -0.008], [0.97, -0.006]].map(([r, y]) => new THREE.Vector2(r, y)), 28);
    { const q = brim.attributes.position; for (let i = 0; i < q.count; i++) { const x = q.getX(i), z = q.getZ(i), r = Math.hypot(x, z), c = z / r, pk = Math.max(0, c) ** 3, ext = r > 1.0 ? (r - 1.0) / 0.1 : 0;
      q.setXYZ(i, x * 0.104, q.getY(i) - ext * pk * 0.012, z * 0.128 + ext * pk * 0.05); } brim.computeVertexNormals(); }
    const rib = (x, ry) => [caps(0.01, 0.16, 1, 6), T(x, 0.1 - Math.abs(x) * 0.45, -0.005, PI / 2 + 0.1, ry, 0, 1, 0.5, 1)];
    const hm = T(HC.x, HC.y + 0.03, HC.z - 0.006, -0.12);
    G.helmet = mergeT([[sh, hm], [brim, hm], ...[rib(0, 0)].map(([g, m2]) => [g, hm.clone().multiply(m2)])]);
    return G;
  });
}
// Accesorios en la mano (sistema de la mano izquierda; s = signo del lado, la palma mira a -s·X)
function propGeos() {
  return memo('props', () => {
    const P = {};
    P.scanner = [mergeT([[new THREE.BoxGeometry(0.03, 0.03, 0.105), T(0, -0.075, -0.012, 0.15)], [new THREE.BoxGeometry(0.05, 0.17, 0.055), T(0, -0.1, 0.07)], [new THREE.BoxGeometry(0.056, 0.035, 0.066), T(0, -0.18, 0.075)]]),
      mergeT([[new THREE.BoxGeometry(0.052, 0.006, 0.05), T(0, -0.198, 0.075)], [new THREE.BoxGeometry(0.014, 0.022, 0.012), T(0, -0.06, 0.035)]])];
    P.clipboard = [mergeT([[new THREE.BoxGeometry(0.006, 0.31, 0.23), T(-0.012, -0.215, 0.0)]]), mergeT([[new THREE.BoxGeometry(0.002, 0.27, 0.21), T(-0.0165, -0.225, 0.0)], [new THREE.BoxGeometry(0.014, 0.035, 0.08), T(-0.015, -0.075, 0.0)]])];
    P.tablet = [new THREE.BoxGeometry(0.012, 0.25, 0.18).translate(-0.032, -0.14, 0.02), new THREE.BoxGeometry(0.002, 0.22, 0.155).translate(-0.039, -0.14, 0.02)];
    const wd = T(-0.02, -0.08, 0.0, 2.2); P.wand = [new THREE.CylinderGeometry(0.017, 0.015, 0.36, 12).applyMatrix4(wd.clone().multiply(T(0, 0.23, 0))), new THREE.CylinderGeometry(0.019, 0.019, 0.11, 12).applyMatrix4(wd)]; // bastón luminoso: sale por el lado del pulgar, inclinado hacia la punta de los dedos
    const crate = []; const W = 0.42, Hh = 0.27, D = 0.32;
    crate.push([new THREE.BoxGeometry(W, 0.015, D), T(0, -Hh / 2 + 0.008, 0)]);
    for (const s of [-1, 1]) { crate.push([new THREE.BoxGeometry(0.012, Hh, D), T(s * W / 2, 0, 0)], [new THREE.BoxGeometry(W, Hh, 0.012), T(0, 0, s * D / 2)]); }
    P.crate = [mergeT(crate), mergeT([[new THREE.BoxGeometry(W * 0.94, Hh * 0.75, D * 0.94), T(0, -0.02, 0)]])];
    return P;
  });
}

// ---------------------------------------------------------------- IK de dos huesos
const _v = Array.from({ length: 8 }, () => new THREE.Vector3()), _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
// h: articulación raíz, t: objetivo, pole: hacia dónde apunta la articulación media (rodilla/codo). Escribe en q la
// orientación del segmento 1 (reposo = -Y; flexión del 2.º segmento hacia -Z si leg, +Z si brazo). Devuelve el ángulo de flexión.
function solve2(h, t, l1, l2, pole, leg, q) {
  const tn = _v[0].subVectors(t, h); const d = clamp(tn.length(), Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.9995); tn.normalize();
  const n = _v[1].copy(pole).addScaledVector(tn, -pole.dot(tn)); if (n.lengthSq() < 1e-8) n.set(0, 0, 1).addScaledVector(tn, -tn.z); n.normalize();
  const ca = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1), sa = Math.sqrt(1 - ca * ca);
  const u = _v[2].copy(tn).multiplyScalar(ca).addScaledVector(n, sa), w = _v[3].copy(tn).multiplyScalar(sa).addScaledVector(n, -ca);
  const Y = _v[4].copy(u).negate(), Z = _v[5].copy(w); if (leg) Z.negate(); const X = _v[6].crossVectors(Y, Z);
  q.setFromRotationMatrix(_m4.makeBasis(X, Y, Z));
  return PI - Math.acos(clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1));
}
// Euler del hombro (flexión, abducción, rotación interna) → cuaternión, con signo de lado (izq = +1)
const armQ = (s, flex, abd, rot, q) => q.setFromEuler(_e.set(-flex, -s * rot, s * abd, 'XZY'));
const frac = (x) => x - Math.floor(x);

// ---------------------------------------------------------------- Operario
// opts: jacket 'blue'|'orange'|'grey'|hex, helmet 'white'|'yellow'|'blue'|hex, hiVis bool, item null|'clipboard'|'scanner'|'tablet',
//       glasses bool, skin hex, vapour bool (vaho), seat {h, z, feetZ, wheel:[y, z, r, tilt]} (posición sentado), seed.
export function createWorker(opts = {}) {
  const o = { jacket: 'blue', helmet: 'yellow', hiVis: false, item: null, glasses: true, vapour: true, seed: 1, ...opts };
  const W = wardrobe(o), G = buildGeos(o), PG = propGeos(), M = W.M;
  const mk = (geo, mat, parent, cast = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m; };
  const grp = (parent, x = 0, y = 0, z = 0, name) => { const g = new THREE.Group(); g.position.set(x, y, z); if (name) g.name = name; parent.add(g); return g; };
  const group = new THREE.Group(); group.name = 'worker';
  const body = grp(group); body.rotation.y = PI / 2; // esqueleto modelado mirando a +Z
  const hips = grp(body, 0, B.hipY, 0, 'hips'), spine = grp(hips, 0, B.spineY, 0, 'spine'), chest = grp(spine, 0, B.chestY, 0, 'chest');
  const neck = grp(chest, 0, B.neckY, -0.015, 'neck'), head = grp(neck, 0, B.headY, 0.02, 'head');
  mk(G.pelvis, W.legs, hips); mk(G.abdomen, W.torso, spine); const torsoMeshes = [mk(G.chest, W.torso, chest)]; if (o.hiVis) torsoMeshes.push(mk(G.vest, W.vest, chest));
  mk(G.neck, W.skin, neck); mk(G.head, W.skin, head); mk(G.beanie, W.knit, head); mk(G.helmet, W.helmet, head); if (G.lens) mk(G.lens, W.lens, head, false);
  const arms = [1, -1].map((s) => {
    const sh = grp(chest, s * B.shX, B.shY, -0.005), el = grp(sh, 0, -B.upper, 0), wr = grp(el, 0, -B.fore, 0);
    const L = s > 0 ? (g) => g : (g) => memo(g.uuid + 'm', () => mirrorX(g));
    mk(L(G.upper), W.sleeve, sh); mk(L(G.fore), W.sleeve, el);
    const grip = (s < 0 && o.item === 'scanner') || (s > 0 && (o.item === 'clipboard' || o.item === 'tablet'));
    const hand = mk(L(grip ? G.handGrip : G.handOpen), W.glove, wr); hand.userData.grip = grip;
    return { s, sh, el, wr, hand, q: new THREE.Quaternion(), wrE: new THREE.Euler() };
  });
  const legs = [1, -1].map((s) => {
    const hip = grp(hips, s * B.hipX, 0, 0), knee = grp(hip, 0, -B.thigh, 0), ankle = grp(knee, 0, -B.shin, 0);
    const L = s > 0 ? (g) => g : (g) => memo(g.uuid + 'm', () => mirrorX(g));
    mk(L(G.thigh), W.legs, hip); mk(L(G.shin), W.legs, knee); mk(L(G.boot), W.boot, ankle);
    return { s, hip, knee, ankle };
  });
  // accesorios
  const prop = (pair, mats, parent, s) => { const g = grp(parent); pair.forEach((geo, i) => mk(s < 0 ? memo(geo.uuid + 'm', () => mirrorX(geo)) : geo, mats[i], g)); return g; };
  const props = {};
  const [aL, aR] = arms;
  props.scanner = prop(PG.scanner, [M.paintYellow, M.plastic], aR.wr, -1);
  props.clipboard = prop(PG.clipboard, [new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.7 }), new THREE.MeshStandardMaterial({ color: 0xf4f4ee, roughness: 0.9 })], aL.wr, 1);
  props.tablet = prop(PG.tablet, [M.plastic, new THREE.MeshStandardMaterial({ color: 0x0c2233, emissive: 0x1d6aa0, emissiveIntensity: 0.6, roughness: 0.2 })], aL.wr, 1);
  props.wandL = prop(PG.wand, [M.lensAmber, M.plastic], aL.wr, 1); props.wandR = prop(PG.wand, [M.lensAmber, M.plastic], aR.wr, -1);
  props.crate = prop(PG.crate, [M.paintBlue, new THREE.MeshStandardMaterial({ color: 0x9db06a, roughness: 0.8 })], chest, 1); props.crate.position.set(0, -0.04, 0.36);
  for (const k in props) props[k].visible = false;
  // vaho (sprites en el espacio del padre del grupo)
  const puffTex = memo('puff', () => tex(canvas(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 2, 32, 32, 31); r.addColorStop(0, 'rgba(255,255,255,0.9)'); r.addColorStop(0.5, 'rgba(240,246,255,0.35)'); r.addColorStop(1, 'rgba(240,246,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); })));
  const vapour = new THREE.Group(); vapour.name = 'vaho';
  const puffs = Array.from({ length: 6 }, () => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0 })); sp.visible = false; vapour.add(sp); return { sp, life: 0, v: new THREE.Vector3() }; });

  const rig = { body, hips, spine, chest, neck, head, arms, legs, props, steer: 0, seat: { h: 0.53, z: -0.36, feetZ: 0.08, wheel: [0.9, 0.04, 0.17, 0.62], ...(o.seat || {}) } };

  // ---------------------------------------------------------------- Estado de animación
  const rnd = ((s) => () => (s = (s * 16807) % 2147483647) / 2147483647)(Math.floor(o.seed * 9301 + 49297) % 2147483647 || 7);
  const S = { yaw: null, v: 0, vEst: 0, last: null, phase: 0, walking: false, walkW: 0, t: rnd() * 10, breath: rnd(), ws: 0, wsT: 0, wsTimer: 2 + rnd() * 4,
    look: [0, 0], lookV: [0, 0], lookT: [0, 0], lookTimer: 1 + rnd() * 3, rub: 0, rubTimer: 8 + rnd() * 8, rubOn: 0, stepCool: 0, puffT: 0 };
  const A = { carry: [0, 0], inspect: [0, 0], scan: [0, 0], seated: [0, 0], signal: [0, 0], push: [0, 0] }; // [actual, objetivo]
  const feet = [1, -1].map((s) => ({ s, cur: new THREE.Vector3(), x: 0, z: 0, yaw: 0, pitch: 0, sw: false, mode: null, u: 0, dur: 0.4, from: new THREE.Vector3(), fromYaw: 0, fromPitch: 0, ph: 0, init: false, lift: 0.05 }));
  const fwd = (h) => [Math.cos(h), Math.sin(h)], right = (h) => [-Math.sin(h), Math.cos(h)];
  const neutral = (f, h, k = 1) => { const [rx, rz] = right(h), lat = (0.11 - 0.035 * k) * -f.s; return [group.position.x + rx * lat, group.position.z + rz * lat]; };
  // posición 3D (espacio del padre) del tobillo de un pie apoyado según su inclinación (pivota en talón o metatarso)
  const ankleOf = (x, z, yaw, p, out) => {
    const [fx, fz] = fwd(yaw); let a, up;
    if (p >= 0) { const c = Math.cos(p), s = Math.sin(p); a = B.ball - B.ball * c + B.ankleH * s; up = B.ball * s + B.ankleH * c; }
    else { const c = Math.cos(p), s = Math.sin(p); a = B.heel * c + B.ankleH * s - B.heel; up = -B.heel * s + B.ankleH * c; }
    return out.set(x + fx * a, group.position.y + up, z + fz * a);
  };
  const stepYaw = (h) => h + clamp(wrapAngle((S.yawT ?? h) - h), -0.55, 0.55); // rumbo objetivo de un paso (giro en el sitio por etapas)
  const stancePitch = (s, k) => (s < 0.14 ? -0.28 * k * (1 - smoothstep(s / 0.14)) : s < 0.5 ? 0 : (0.25 + 0.75 * k) * smoothstep((s - 0.5) / 0.5) ** 1.6);

  function setAction(name, weight = 1, exclusive = true) {
    if (exclusive) for (const k in A) A[k][1] = 0;
    if (A[name]) A[name][1] = clamp(weight, 0, 1);
  }

  // ---------------------------------------------------------------- Locomoción (pies plantados en el mundo)
  function locomotion(dt, h, ds) {
    const v = S.vEst, k = clamp(v / 1.3, 0, 1), L = clamp(0.42 + 0.62 * v, 0.42, 1.55), beta = lerp(0.7, 0.6, clamp(v / 1.5, 0, 1));
    const lead = beta * L / 2 - 0.085, seated = A.seated[0];
    if (!S.walking && v > 0.07 && seated < 0.5) { // arranque: levanta primero el pie más retrasado
      S.walking = true; const [fx, fz] = fwd(h), rel = feet.map((f) => (f.x - group.position.x) * fx + (f.z - group.position.z) * fz), i = rel[0] < rel[1] - 0.01 ? 0 : 1;
      S.phase = beta - i * 0.5 + 1e-3; feet.forEach((f, j) => (f.ph = frac(S.phase + j * 0.5) - 1e-3));
    } else if (S.walking && (v < 0.04 || seated > 0.5)) S.walking = false;
    if (S.walking) S.phase += ds / L;
    feet.forEach((f, j) => {
      const ph = frac(S.phase + j * 0.5);
      if (S.walking) {
        if (!f.sw && ph >= beta && (f.ph < beta || ph - beta < 0.15)) { f.sw = true; f.mode = 'gait'; ankleOf(f.x, f.z, f.yaw, f.pitch, f.from); f.fromYaw = f.yaw; f.fromPitch = f.pitch; f.lift = 0.035 + 0.05 * k; }
        if (f.sw && f.mode === 'gait') {
          if (ph < beta) { f.sw = false; f.pitch = -0.28 * k; } else f.u = (ph - beta) / (1 - beta);
        }
        if (!f.sw) f.pitch = stancePitch(ph / beta, k);
        f.ph = ph;
      } else if (f.sw && f.mode === 'gait') { // se detuvo a mitad de paso: termina el paso hacia la posición neutra
        const cur = _v[7]; footPose(f, h, k, beta, L, lead, cur); f.from.copy(cur); f.fromYaw = f.yaw; f.fromPitch = f.pitch; f.mode = 'step'; f.dur = 0.18 + 0.2 * (1 - f.u); f.lift = 0.02 * (1 - f.u); f.u = 0;
      }
      if (f.sw && f.mode === 'step') { f.u += dt / f.dur; if (f.u >= 1) { f.sw = false; f.u = 1; const [nx, nz] = neutral(f, stepYaw(h), 0); f.x = nx; f.z = nz; f.yaw = (stepYaw(h)) - f.s * 0.1; f.pitch = 0; S.stepCool = 0.06; } }
      if (!f.sw && !S.walking) f.pitch = lag(f.pitch, 0, 0.08, dt);
      if (f.sw) footPose(f, h, k, beta, L, lead, f.cur);
    });
    // pasos correctivos en reposo (y paso de giro en el sitio cuando el tronco rota)
    S.stepCool -= dt;
    if (!S.walking && seated < 0.5 && S.stepCool <= 0 && !feet.some((f) => f.sw)) {
      const hT = stepYaw(h); let best = null, be = 0;
      feet.forEach((f) => { const [nx, nz] = neutral(f, hT, 0), e = Math.hypot(f.x - nx, f.z - nz) + 0.22 * Math.abs(wrapAngle(f.yaw + f.s * 0.1 - hT)); if (e > be) { be = e; best = f; } });
      if (best && be > 0.09) { const f = best; ankleOf(f.x, f.z, f.yaw, f.pitch, f.from); f.fromYaw = f.yaw; f.fromPitch = f.pitch; f.sw = true; f.mode = 'step'; f.u = 0; f.dur = 0.34; f.lift = 0.045; f.cur.copy(f.from); }
    }
  }
  // posición del tobillo y orientación del pie en vuelo (espacio del padre). Actualiza f.x/f.z/f.yaw/f.pitch de destino.
  function footPose(f, h, k, beta, L, lead, out) {
    const [fx, fz] = fwd(h), [rx, rz] = right(h), u = clamp(f.u, 0, 1);
    let tx, tz, ty = h - f.s * 0.1, tp;
    if (f.mode === 'gait') { const ahead = lead + (1 - u) * (1 - beta) * L, lat = (0.11 - 0.035 * k) * -f.s; tx = group.position.x + fx * ahead + rx * lat; tz = group.position.z + fz * ahead + rz * lat; tp = -0.28 * k; }
    else { const hT = stepYaw(h); [tx, tz] = neutral(f, hT, 0); ty = hT - f.s * 0.1; tp = 0; }
    const land = ankleOf(tx, tz, ty, tp, _v[6]), e = f.mode === 'gait' ? 0.5 - 0.5 * Math.cos(PI * u ** 0.9) : smoothstep(u);
    out.lerpVectors(f.from, land, e); out.y += f.lift * (f.mode === 'gait' ? Math.sin(PI * u ** 0.62) : Math.sin(PI * u));
    f.x = tx; f.z = tz; f.yaw = f.fromYaw + wrapAngle(ty - f.fromYaw) * e;
    f.pitch = f.mode === 'gait' ? (u < 0.45 ? lerp(f.fromPitch, 0.05, smoothstep(u / 0.45)) : lerp(0.05, tp, smoothstep((u - 0.45) / 0.55))) : lerp(f.fromPitch, 0, smoothstep(u)) - 0.12 * Math.sin(PI * u);
    if (u >= 1) out.copy(land);
    else { // la puntera y el talón nunca atraviesan el suelo durante el vuelo
      const c = Math.cos(f.pitch), sn = Math.sin(f.pitch), lo = Math.min(-B.ankleH * c - B.ball * sn, -B.ankleH * c + B.heel * sn) + out.y - group.position.y;
      if (lo < 0.002) out.y += 0.002 - lo;
    }
    return out;
  }

  // ---------------------------------------------------------------- Poses de acción (objetivos de muñeca en el sistema del tórax o del cuerpo)
  // devuelve { ch: canales de tronco/cabeza, L/R: { t:[x,y,z], sp:'chest'|'body', pole:[x,y,z], wr:[x,y,z] } | { e:[flex,abd,rot,codo], wr } }
  const ACT = {
    carry: (t) => ({ ch: { spX: -0.05, chX: -0.03, nkX: 0.12, hdX: 0.05 }, L: { t: [0.205, -0.07, 0.34], pole: [0.6, -1, -0.5], wr: [0.0, 0, -0.15] }, R: { t: [-0.205, -0.07, 0.34], pole: [-0.6, -1, -0.5], wr: [0, 0, 0.15] } }),
    push: (t) => ({ ch: { spX: 0.16, chX: 0.05, nkX: -0.1 }, L: { t: [0.13, -0.06, 0.3], pole: [0.9, -1, -0.7], wr: [-0.1, 0, -0.6] }, R: { t: [-0.13, -0.06, 0.3], pole: [-0.9, -1, -0.7], wr: [-0.1, 0, 0.6] } }),
    inspect: (t) => ({ ch: { spX: -0.04, chX: -0.06, nkX: -0.3, hdX: -0.12, nkY: -0.12 }, R: { t: [-0.16 + 0.015 * Math.sin(t * 2.1), 1.52 + 0.02 * Math.max(0, Math.sin(t * 3.3)) ** 4, 0.5 - 0.02 * Math.max(0, Math.sin(t * 3.3)) ** 6], sp: 'body', pole: [-1, -0.8, -0.3], wr: [-0.4, 0, 0.2] } }),
    scan: (t) => ({ ch: { spX: 0.06, chY: -0.1 + 0.08 * Math.sin(t * 0.7), nkX: 0.22, nkY: 0.0 }, R: { t: [-0.16 + 0.06 * Math.sin(t * 0.7), 0.12, 0.47], pole: [-1, -1.2, -0.4], wr: [0.05, 0.0, -0.1] } }),
    signal: (t) => { const a = 0.15 + 0.6 * Math.sin(t * TAU * 0.85); const el = (s) => [s * 0.47, 0.27, 0.06]; const wrist = (s) => { const e = el(s); return [e[0] - s * 0.04, e[1] + 0.25 * Math.cos(a), e[2] + 0.25 * Math.sin(a)]; };
      return { ch: { spX: -0.03, nkX: -0.05, hdX: 0 }, L: { t: wrist(1), pole: [1, -0.6, -0.3], wr: [0.3 * Math.sin(t * TAU * 0.85), 0, 0] }, R: { t: wrist(-1), pole: [-1, -0.6, -0.3], wr: [0.3 * Math.sin(t * TAU * 0.85), 0, 0] } }; },
    seated: (t) => { const [wy, wz, r, tilt] = rig.seat.wheel, st = rig.steer, hand = (s) => { const a = PI / 2 - s * 1.05 + st, x = Math.cos(a) * r, y = Math.sin(a) * r; return [x, wy + y * Math.sin(tilt) + 0.02, wz + y * Math.cos(tilt) - 0.03]; };
      return { ch: { spX: 0.08, chX: 0.06, nkX: -0.02 }, L: { t: hand(1), sp: 'body', pole: [0.7, -1, -0.2], wr: [-0.3, 0, -0.35] }, R: { t: hand(-1), sp: 'body', pole: [-0.7, -1, -0.2], wr: [-0.3, 0, 0.35] } }; },
    rub: (t) => { const r = 0.028 * Math.sin(t * TAU * 2.2); return { ch: { nkX: 0.25, chX: 0.05, spX: 0.03 }, L: { t: [0.05, -0.02, 0.27 + r], pole: [1, -0.6, -0.6], wr: [0.0, 0.0, -0.9] }, R: { t: [-0.05, -0.02, 0.27 - r], pole: [-1, -0.6, -0.6], wr: [0, 0.0, 0.9] } }; },
  };
  const ITEM = { // brazo que sostiene el objeto durante la marcha / reposo (euler: flexión, abducción, rot. interna, codo)
    clipboard: { s: 1, e: [0.08, 0.2, -0.1, 0.32], wr: [0.05, 0, 0.12] }, tablet: { s: 1, e: [0.3, 0.1, 0.5, 1.45], wr: [0.6, -1.4, 0.0] }, scanner: { s: -1, e: [0.05, 0.1, 0.1, 0.35], wr: [0.25, 0, 0] },
  };

  const pelvisPos = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), qHips = new THREE.Quaternion(), ank = new THREE.Vector3(), hipJ = new THREE.Vector3(), pole = new THREE.Vector3();
  const mInner = new THREE.Matrix4(), mInv = new THREE.Matrix4(), mChest = new THREE.Matrix4(), mChestInv = new THREE.Matrix4(), tgt = new THREE.Vector3();
  const toInner = (p, out) => out.copy(p).applyMatrix4(mInv);

  // ---------------------------------------------------------------- update
  function update(dt, ctl = {}) {
    dt = Math.min(dt, 0.1); S.t += dt;
    // 1) desplazamiento: autopropulsado (ctl.speed) o cinemático (el llamador mueve el grupo)
    if (S.yaw === null) { S.yaw = -group.rotation.y; S.last = group.position.clone(); feet.forEach((f) => { const [nx, nz] = neutral(f, S.yaw, 0); f.x = nx; f.z = nz; f.yaw = S.yaw - f.s * 0.1; }); }
    let ds;
    if (ctl.speed !== undefined) {
      const hT = ctl.heading ?? S.yaw, err = wrapAngle(hT - S.yaw), turnInPlace = Math.abs(err) > 0.7;
      S.yawT = hT; const rate = turnInPlace ? 1.6 : 2.4; S.yaw = wrapAngle(S.yaw + clamp(err, -rate * dt, rate * dt));
      const vT = turnInPlace ? 0 : ctl.speed * clamp(1.2 - Math.abs(err), 0.3, 1);
      S.v = vT > S.v ? Math.min(vT, S.v + 1.1 * dt) : Math.max(vT, S.v - 1.6 * dt);
      const [fx, fz] = fwd(S.yaw); group.position.x += fx * S.v * dt; group.position.z += fz * S.v * dt; group.rotation.y = -S.yaw;
    } else { S.yaw = -group.rotation.y; S.yawT = ctl.headingTarget ?? S.yaw; }
    ds = Math.hypot(group.position.x - S.last.x, group.position.z - S.last.z); S.last.copy(group.position);
    if (ds > 0.8) { ds = 0; feet.forEach((f) => { const [nx, nz] = neutral(f, -group.rotation.y, 0); f.x = nx; f.z = nz; f.yaw = -group.rotation.y - f.s * 0.1; f.sw = false; f.pitch = 0; }); S.walking = false; } // teletransporte: recoloca los pies
    S.vEst = ctl.speed !== undefined ? S.v : lag(S.vEst, ds / Math.max(dt, 1e-4), 0.12, dt);
    const h = S.yaw, v = S.vEst, k = clamp(v / 1.3, 0, 1);
    for (const n in A) A[n][0] = lag(A[n][0], A[n][1], 0.16, dt);
    const wSeat = smoothstep(A.seated[0]);
    S.walkW = lag(S.walkW, S.walking ? clamp(v / 0.5, 0, 1) : 0, 0.1, dt);
    locomotion(dt, h, ds);
    const ww = S.walkW * k, ph = S.phase * TAU; // ph: 0 = apoyo de talón derecho... (pie j=0 es el izquierdo)
    // 2) pausas de reposo: cambio de apoyo, miradas, frotarse las manos, respiración
    const idle = (1 - S.walkW) * (1 - wSeat), upperBusy = Math.min(1, A.carry[0] + A.inspect[0] + A.scan[0] + A.signal[0] + A.push[0] + wSeat);
    if ((S.wsTimer -= dt) < 0) { S.wsTimer = 5 + rnd() * 7; S.wsT = [-0.7, 0.7, 0.2, -0.2][Math.floor(rnd() * 4)]; }
    [S.ws, S.wsV] = smoothDamp(S.ws, S.wsT, S.wsV || 0, 1.1, dt);
    if ((S.lookTimer -= dt) < 0) { S.lookTimer = 2.5 + rnd() * 5; const g = rnd() < 0.35 ? 0 : (rnd() - 0.5) * 1.4; S.lookT = [g, (rnd() - 0.6) * 0.25]; }
    for (let i = 0; i < 2; i++) [S.look[i], S.lookV[i]] = smoothDamp(S.look[i], S.lookT[i] * idle, S.lookV[i], 0.22, dt);
    if ((S.rubTimer -= dt) < 0) { S.rubTimer = 12 + rnd() * 10; S.rubOn = 3.2; }
    S.rubOn -= dt; S.rub = lag(S.rub, S.rubOn > 0 && !o.item ? 1 : 0, 0.18, dt);
    const bRate = lerp(0.24, 0.42, ww) + 0.1 * upperBusy; const bPrev = S.breath; S.breath += dt * bRate; const br = Math.sin(S.breath * TAU);
    if (o.vapour && Math.floor(S.breath + 0.5) !== Math.floor(bPrev + 0.5)) S.puffT = 0.45; // inicio de la espiración
    // 3) pelvis (espacio interno del cuerpo)
    const swingStep = feet.find((f) => f.sw && f.mode === 'step'), stepShift = swingStep ? -swingStep.s * Math.sin(PI * clamp(swingStep.u, 0, 1)) * 0.6 : 0;
    const shift = lerp(S.ws * 0.6 + stepShift, 0, S.walkW);
    pelvisPos.set(0.022 * ww * Math.sin(ph - 0.3) + 0.028 * shift * idle + 0.004 * Math.sin(S.t * 0.7) * idle, B.hipY - 0.006 - 0.01 * ww - 0.016 * ww * Math.cos(2 * ph) - 0.006 * Math.abs(shift), 0.003 * Math.sin(S.t * 0.53) * idle);
    const pRot = [0.04 * ww - 0.012 * ww * Math.cos(2 * ph), -0.075 * ww * Math.cos(ph), 0.045 * ww * Math.sin(ph - 0.3) + 0.055 * shift * idle];
    // asiento
    if (wSeat > 0) { pelvisPos.lerp(_v[7].set(0, rig.seat.h, rig.seat.z), wSeat); pRot[0] = lerp(pRot[0], -0.2, wSeat); pRot[1] *= 1 - wSeat; pRot[2] *= 1 - wSeat; }
    // matrices: padre → interno (para pies y objetivos 'body')
    group.updateMatrix(); body.updateMatrix(); mInner.multiplyMatrices(group.matrix, body.matrix); mInv.copy(mInner).invert();
    // tobillos objetivo (interno) y orientación del pie
    const fs = feet.map((f, j) => {
      const p = f.sw ? f.cur : ankleOf(f.x, f.z, f.yaw, f.pitch, _v[7]), a = toInner(p, new THREE.Vector3()), yawRel = -wrapAngle(f.yaw - h);
      let pitch = f.pitch, yaw = yawRel;
      if (wSeat > 0) { const s = f.s; a.lerp(_v[7].set(s * 0.13, B.ankleH + 0.01, rig.seat.feetZ), wSeat); pitch = lerp(pitch, -0.12, wSeat); yaw = lerp(yaw, s * 0.12, wSeat);
        if (wSeat > 0.5) { const w = _v[6].set(s * 0.13, 0, rig.seat.feetZ).applyMatrix4(mInner); f.x = w.x; f.z = w.z; f.yaw = h - s * 0.12; f.sw = false; } }
      return { a, pitch, yaw };
    });
    hips.rotation.set(pRot[0], pRot[1], pRot[2]); hips.position.copy(pelvisPos); qHips.copy(hips.quaternion);
    // altura de la pelvis limitada por el alcance de las piernas (genera el descenso natural en doble apoyo)
    if (wSeat < 1) {
      let yMax = Infinity; legs.forEach((l, j) => { const off = _v[5].set(l.s * B.hipX, 0, 0).applyQuaternion(qHips), A2 = fs[j].a, dx = pelvisPos.x + off.x - A2.x, dz = pelvisPos.z + off.z - A2.z, r2 = (LEG * 0.998) ** 2 - dx * dx - dz * dz;
        yMax = Math.min(yMax, A2.y - off.y + (r2 > 0 ? Math.sqrt(r2) : 0)); });
      hips.position.y = lerp(Math.min(pelvisPos.y, yMax), pelvisPos.y, wSeat);
    }
    // 4) piernas (IK)
    legs.forEach((l, j) => {
      const F = fs[j]; hipJ.set(l.s * B.hipX, 0, 0).applyQuaternion(qHips).add(hips.position);
      pole.set(Math.sin(F.yaw) + l.s * 0.08, 0.15 * wSeat, Math.cos(F.yaw));
      const kb = solve2(hipJ, F.a, B.thigh, B.shin, pole, true, tmpQ);
      l.hip.quaternion.copy(qHips).invert().multiply(tmpQ); l.knee.rotation.set(kb, 0, 0);
      _q.setFromEuler(_e.set(F.pitch, F.yaw, 0, 'YXZ')); _q2.setFromEuler(_e.set(kb, 0, 0)); tmpQ.multiply(_q2).invert(); l.ankle.quaternion.copy(tmpQ.multiply(_q));
    });
    // 5) tronco y cabeza: base (marcha + reposo) y mezcla de acciones
    const C = { spX: 0.025 + 0.05 * ww, spY: -0.4 * pRot[1], spZ: -0.4 * pRot[2], chX: 0.01 * br, chY: -0.9 * pRot[1], chZ: -0.3 * pRot[2] + 0.02 * shift * idle,
      nkX: 0.15 * S.look[1], nkY: 0.4 * 0.9 * pRot[1] + 0.55 * S.look[0], hdX: 0.03 * ww * Math.cos(2 * ph) + 0.12 * S.look[1], hdY: 0.45 * S.look[0], hdZ: -0.3 * (pRot[2] * 1.2) };
    C.nkX += 0.03 - 0.85 * (pRot[0] + C.spX + C.chX); // estabilización de la mirada: compensa la inclinación del tronco
    const acts = []; for (const n in A) if (A[n][0] > 0.002) acts.push([n, smoothstep(A[n][0])]);
    const wRub = S.rub * idle * (1 - upperBusy); if (wRub > 0.002) acts.push(['rub', smoothstep(wRub)]);
    const specs = acts.map(([n, w]) => [ACT[n](S.t), w]);
    for (const [sp, w] of specs) for (const c in sp.ch) C[c] = lerp(C[c], sp.ch[c] + (c === 'nkY' || c === 'hdY' ? C[c] * 0.3 : 0), w);
    spine.rotation.set(C.spX, C.spY, C.spZ); chest.rotation.set(C.chX, C.chY, C.chZ); neck.rotation.set(C.nkX, C.nkY, 0, 'YXZ'); head.rotation.set(C.hdX, C.hdY, C.hdZ, 'YXZ');
    const bs = 1 + 0.014 * br * (1 - 0.5 * ww); torsoMeshes.forEach((m) => m.scale.set(1 + 0.004 * br, 1 + 0.005 * br, bs));
    // 6) brazos: locomoción (euler) → acciones (IK) por slerp
    hips.updateMatrix(); spine.updateMatrix(); chest.updateMatrix(); mChest.multiplyMatrices(hips.matrix, spine.matrix).multiply(chest.matrix); mChestInv.copy(mChest).invert();
    const item = ITEM[o.item];
    arms.forEach((a) => {
      const s = a.s, sw = -s * Math.cos(ph) * 0.34 * ww; // brazo opuesto a la pierna (j=0 izquierda apoya en ph=0)
      let fl = 0.04 + sw + 0.06 * ww, ab = 0.13 + 0.012 * br, rt = 0.12, elb = 0.2 + 0.22 * ww + 0.25 * ww * Math.max(0, sw / 0.34), wr = [0.08, 0, 0];
      if (item && item.s === s) { [fl, ab, rt, elb] = item.e; fl += sw * 0.15; wr = item.wr; }
      armQ(s, fl, ab, rt, a.q); a.wrE.set(...wr);
      a.sh.position.y = B.shY + 0.004 * br + 0.008 * idle;
      for (const [sp, w] of specs) {
        const arm = s > 0 ? sp.L : sp.R; if (!arm) continue;
        tgt.set(...arm.t); if (arm.sp === 'body') tgt.applyMatrix4(mChestInv);
        const eb = solve2(a.sh.position, tgt, B.upper, B.fore, _v[7].set(...arm.pole), false, tmpQ);
        a.q.slerp(tmpQ, w); elb = lerp(elb, eb, w); a.wrE.set(lerp(a.wrE.x, arm.wr[0], w), lerp(a.wrE.y, arm.wr[1], w), lerp(a.wrE.z, arm.wr[2], w));
      }
      a.sh.quaternion.copy(a.q); a.el.rotation.set(-elb, 0, 0); a.wr.rotation.copy(a.wrE);
    });
    // 7) accesorios visibles
    props.scanner.visible = o.item === 'scanner' || A.scan[0] > 0.5; props.clipboard.visible = o.item === 'clipboard'; props.tablet.visible = o.item === 'tablet';
    props.wandL.visible = props.wandR.visible = A.signal[0] > 0.5 && o.wands !== false; props.crate.visible = A.carry[0] > 0.5 && o.crate !== false;
    if (props.scanner.visible && o.item !== 'scanner') aR.hand.geometry = memo(G.handGrip.uuid + 'm', () => mirrorX(G.handGrip)); else if (o.item !== 'scanner') aR.hand.geometry = memo(G.handOpen.uuid + 'm', () => mirrorX(G.handOpen));
    // 8) vaho de la respiración (aire frío)
    if (o.vapour && group.parent) {
      if (vapour.parent !== group.parent) group.parent.add(vapour);
      if (S.puffT > 0) { const before = S.puffT; S.puffT -= dt; const slots = [0.45, 0.33, 0.2]; for (const sl of slots) if (before > sl && S.puffT <= sl) {
        const p = puffs.find((q) => q.life <= 0); if (p) { head.updateWorldMatrix(true, false); const m = head.localToWorld(_v[7].set(0, HC.y - 0.06, HC.z + 0.11)); group.parent.worldToLocal(m); p.sp.position.copy(m);
          const d = head.localToWorld(_v[6].set(0, HC.y - 0.12, HC.z + 1)).sub(head.localToWorld(_v[5].set(0, HC.y - 0.06, HC.z))).normalize(); p.v.copy(d).multiplyScalar(0.22 + 0.06 * rnd()); p.life = 1; p.sp.visible = true; } } }
      for (const p of puffs) if (p.life > 0) { p.life -= dt / 1.7; const age = 1 - p.life; p.sp.position.addScaledVector(p.v, dt); p.v.multiplyScalar(Math.exp(-dt * 1.8)); p.sp.position.y += dt * 0.05;
        const sc = 0.04 + 0.22 * Math.sqrt(age); p.sp.scale.set(sc, sc, sc); p.sp.material.opacity = 0.3 * Math.min(1, age * 6) * Math.max(0, p.life) ** 1.3; if (p.life <= 0) p.sp.visible = false; }
    }
  }
  return { group, rig, setAction, update, state: S, actions: A, feet, opts: o };
}

// ---------------------------------------------------------------- Agente: sigue una ruta con paradas y acciones
// waypoints: [[x, z, {dwell, action, face}] | {x, z, dwell, action, face}]; las paradas son los puntos con dwell > 0.
// Opciones: speed (m/s), loop, radius (redondeo de esquinas), walkAction (p. ej. 'carry' o 'push' durante la marcha).
export class WorkerAgent {
  constructor(worker, waypoints, { speed = 1.35, loop = true, radius = 0.7, walkAction = null } = {}) {
    this.w = worker; this.speed = speed; this.loop = loop; this.radius = radius; this.walkAction = walkAction;
    this.pts = waypoints.map((p) => (Array.isArray(p) ? { x: p[0], z: p[1], ...(p[2] || {}) } : { ...p }));
    const n = this.pts.length; this.pts.forEach((p, i) => { // esquinas cerradas (>100°): parada breve y giro en el sitio
      if (p.dwell > 0 || (!loop && (i === 0 || i === n - 1))) return; const a = this.pts[(i - 1 + n) % n], c = this.pts[(i + 1) % n];
      if (Math.abs(wrapAngle(Math.atan2(c.z - p.z, c.x - p.x) - Math.atan2(p.z - a.z, p.x - a.x))) > 1.75) p.dwell = 0.15; });
    const stops = this.pts.map((p, i) => (p.dwell > 0 || i === 0 ? i : -1)).filter((i) => i >= 0); if (!loop && stops[stops.length - 1] !== this.pts.length - 1) stops.push(this.pts.length - 1);
    this.legs = stops.map((a, k) => { const b = stops[k + 1] ?? (loop ? stops[0] + this.pts.length : null); if (b === null) return null; const pp = []; for (let i = a; i <= b; i++) { const q = this.pts[i % this.pts.length]; pp.push([q.x, q.z]); } return { path: new Path2(pp, radius), end: this.pts[b % this.pts.length] }; }).filter(Boolean);
    this.leg = 0; this.s = 0; this.v = 0; this.state = 'turn'; this.timer = 0;
    const g = worker.group, p0 = this.legs[0]?.path.at(0); if (p0) { g.position.set(p0.x, g.position.y, p0.z); g.rotation.y = -p0.heading; }
    worker.setAction(walkAction || 'stand');
  }
  update(dt) {
    const L = this.legs[this.leg]; if (!L) { this.w.update(dt); return; }
    const g = this.w.group, yaw = -g.rotation.y; let hT = yaw;
    if (this.state === 'turn') { // girar en el sitio hacia el rumbo de salida
      hT = L.path.at(0.05).heading; const e = wrapAngle(hT - yaw); g.rotation.y = -(yaw + clamp(e, -1.5 * dt, 1.5 * dt)); if (Math.abs(e) < 0.12) { this.state = 'walk'; this.w.setAction(this.walkAction || 'stand'); }
    } else if (this.state === 'walk') {
      let vmax = this.speed; for (const d of [0, 0.3, 0.7, 1.2, 1.8]) { if (this.s + d > L.path.length) break; const c = Math.abs(L.path.at(this.s + d).curv); vmax = Math.min(vmax, Math.sqrt(0.6 / Math.max(1e-3, c) + 1.6 * d)); } // límite por curvatura con anticipación
      this.v = approach(this.v, L.path.length - this.s, vmax, 0.9, 0.8, dt); this.s = Math.min(L.path.length, this.s + this.v * dt);
      const p = L.path.at(this.s); g.position.x = p.x; g.position.z = p.z; hT = p.heading; const e = wrapAngle(hT - yaw); g.rotation.y = -(yaw + clamp(e, -2.6 * dt, 2.6 * dt));
      if (this.s >= L.path.length - 1e-3) { this.state = 'dwell'; this.timer = L.end.dwell || 0.5; this.v = 0; this.acted = false; }
    } else if (this.state === 'dwell') {
      let ok = true; if (L.end.face !== undefined) { hT = L.end.face; const e = wrapAngle(hT - yaw); g.rotation.y = -(yaw + clamp(e, -1.4 * dt, 1.4 * dt)); ok = Math.abs(e) < 0.2; }
      if (ok && !this.acted) { this.acted = true; if (L.end.action) this.w.setAction(L.end.action); } // la acción empieza tras encararse
      if (ok && (this.timer -= dt) <= 0) { this.leg = (this.leg + 1) % this.legs.length; if (!this.loop && this.leg === 0) { this.legs = []; } this.s = 0; this.state = 'turn'; this.w.setAction(this.walkAction || 'stand'); }
    }
    this.w.update(dt, { headingTarget: hT });
  }
}

// ---------------------------------------------------------------- Demo (banco de pruebas: preview.html?m=person)
// Parámetros de depuración en la URL: pre=<s> (pre-simula), only=<i> (un solo operario), freeze=1, act=<acción> (fuerza la acción del 0).
export function demo(scene) {
  const q = new URLSearchParams(location.search), M = materials(), root = new THREE.Group(); scene.add(root);
  const ws = [], ags = [];
  // 1) supervisor con portapapeles: ruta con giros y paradas (inspección de panel, escaneo)
  const w1 = createWorker({ jacket: 'blue', helmet: 'white', item: 'clipboard', seed: 1 }); root.add(w1.group);
  ags.push(new WorkerAgent(w1, [[-3, -2.5, { dwell: 1.5 }], [2.5, -2.5], [2.5, 0.5, { dwell: 4, action: 'inspect', face: 0 }], [-1, 1.8], [-3.2, 0.2, { dwell: 3.5, action: 'scan', face: PI }]], { speed: 1.35 }));
  // 2) señalista (maniobra de camión) con chaleco de alta visibilidad
  const w2 = createWorker({ jacket: 'orange', helmet: 'yellow', hiVis: true, glasses: false, seed: 2 }); w2.group.position.set(3.6, 0, 2.8); w2.group.rotation.y = -PI * 0.75; w2.setAction('signal'); root.add(w2.group);
  // 3) carretillero sentado (asiento + volante de referencia)
  const w3 = createWorker({ jacket: 'grey', helmet: 'blue', seed: 3 }); w3.group.position.set(0, 0, 3.4); w3.group.rotation.y = -PI / 2 - 0.4; w3.setAction('seated'); root.add(w3.group);
  const seat = new THREE.Group(); w3.group.add(seat); const sz = w3.rig.seat;
  const add = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = m.receiveShadow = true; seat.add(m); return m; };
  // (coordenadas del grupo: +X adelante) asiento, respaldo y volante
  add(new THREE.BoxGeometry(0.42, 0.08, 0.46), M.plastic, sz.z + 0.02, sz.h - 0.13, 0); add(new THREE.BoxGeometry(0.08, 0.5, 0.44), M.plastic, sz.z - 0.2, sz.h + 0.12, 0); add(new THREE.BoxGeometry(0.3, sz.h - 0.17, 0.3), M.paintGrey, sz.z, (sz.h - 0.17) / 2, 0);
  const tl = sz.wheel[3], wh = new THREE.Mesh(new THREE.TorusGeometry(sz.wheel[2], 0.014, 8, 32), M.plastic); wh.position.set(sz.wheel[1], sz.wheel[0], 0); wh.rotation.set(-PI / 2, 0, tl, 'ZYX'); seat.add(wh);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.42, 10), M.paintGrey); col.position.set(sz.wheel[1] + 0.21 * Math.sin(tl), sz.wheel[0] - 0.21 * Math.cos(tl), 0); col.rotation.z = tl; seat.add(col);
  add(new THREE.BoxGeometry(0.3, 0.6, 0.6), M.paintYellow, sz.wheel[1] + 0.36, 0.3, 0);
  // 4) operario cargando una caja, ida y vuelta
  const w4 = createWorker({ jacket: 'blue', helmet: 'yellow', hiVis: true, seed: 4 }); root.add(w4.group);
  ags.push(new WorkerAgent(w4, [[-4.5, 4.5, { dwell: 2 }], [-0.5, 5.5, { dwell: 2 }]], { speed: 1.1, walkAction: 'carry' }));
  ws.push(w1, w2, w3, w4);
  const only = q.get('only'); if (only !== null) ws.forEach((w, i) => (w.group.visible = i === +only));
  if (q.get('act')) ws[+(only ?? 0)].setAction(q.get('act'));
  if (q.get('walk')) { const w = ws[+(only ?? 0)]; ags.length = 0; ags.push({ update: (dt) => w.update(dt, { speed: +q.get('walk'), heading: 0 }) }); w.group.position.set(-2, 0, 0); }
  let tris = 0; w1.group.traverse((m) => { if (m.isMesh && m.visible) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; });
  let meshes = 0; w1.group.traverse((m) => m.isMesh && meshes++); window.__person = { tris, meshes, ws };
  const step = (dt) => { for (const a of ags) a.update(dt); w2.update(dt); w3.rig.steer = 0.35 * Math.sin(performance.now() / 1300); w3.update(dt); };
  const pre = +(q.get('pre') || 0); for (let t = 0; t < pre; t += 1 / 60) step(1 / 60);
  const fol = q.get('follow'), frz = q.get('freeze'); if (frz) step(1e-4);
  return (dt) => { if (!frz) step(dt); const pv = window.__preview; if (fol && pv) { const w = ws[+(only ?? 0)].group, o = pv.cam.position.clone().sub(pv.ctl.target); pv.ctl.target.set(w.position.x, +fol, w.position.z); pv.cam.position.copy(pv.ctl.target).add(o); } };
}
