// ALMACENAMIENTO Y ENVOLVENTE (alto detalle, apto para InstancedMesh): rack selectivo (puntal perforado con perfil
// real, larguero escalonado con conectores y pasadores, arriostres en C con pernos, placa base, protector, deck de malla),
// tarima de madera, cartón corrugado impreso (tintable por instancia), film estirable, esquineros y hoja superior,
// y piezas de cámara: panel sándwich micro-nervado, zócalo sanitario, tapas cam-lock, colgadores, piso epoxi, sumidero.
// Unidades: metros. Eje Y arriba. Todas las geometrías se cachean (llamar varias veces devuelve la misma instancia).
import { THREE, mergeGeometries, PI, TAU, canvas, tex, normalFrom, noiseCanvas, hash, T, materials } from './kit.js';
import { SLOT } from '../config.js';

const V3 = THREE.Vector3, V2 = THREE.Vector2;
const _C = new Map(), cached = (k, f) => { if (!_C.has(k)) _C.set(k, f()); return _C.get(k); };
const _a = new V3(), _b = new V3(), _c = new V3();

// ---------------------------------------------------------------- Constructor de triángulos (no indexado)
class GB {
  constructor() { this.P = []; this.N = []; this.U = []; this.C = []; this.rgb = [1, 1, 1]; }
  v(p, n, uv) { this.P.push(p.x, p.y, p.z); this.N.push(n.x, n.y, n.z); this.U.push(uv[0], uv[1]); this.C.push(...this.rgb); }
  // Polígono convexo (3–4 vértices) orientado según la normal de cara fn; ns = normales por vértice opcionales.
  poly(pts, fn, uvs, ns) {
    const idx = pts.map((_, i) => i);
    if (_c.crossVectors(_a.subVectors(pts[1], pts[0]), _b.subVectors(pts[2], pts[0])).dot(fn) < 0) idx.reverse();
    for (let k = 1; k < idx.length - 1; k++) for (const i of [idx[0], idx[k], idx[k + 1]]) this.v(pts[i], ns ? ns[i] : fn, uvs[i]);
    return this;
  }
  geo() {
    const g = new THREE.BufferGeometry(), F = (a, n) => new THREE.Float32BufferAttribute(a, n);
    g.setAttribute('position', F(this.P, 3)); g.setAttribute('normal', F(this.N, 3)); g.setAttribute('uv', F(this.U, 2)); g.setAttribute('color', F(this.C, 3));
    return g;
  }
}
// Fusión robusta: [geo, matriz?, rgb?] → atributos position/normal/uv/color (color por pieza si se indica).
function mg(list) {
  return mergeGeometries(list.map(([g, m, rgb]) => {
    const c = g.index ? g.toNonIndexed() : g.clone(); if (m) c.applyMatrix4(m);
    for (const k of Object.keys(c.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) c.deleteAttribute(k);
    const n = c.attributes.position.count;
    if (!c.attributes.uv) c.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    if (!c.attributes.color || rgb) { const a = new Float32Array(n * 3), q = rgb || [1, 1, 1]; for (let i = 0; i < n; i++) a.set(q, i * 3); c.setAttribute('color', new THREE.Float32BufferAttribute(a, 3)); }
    return c;
  }), false);
}
export const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

// UV por proyección según el eje dominante de la normal.
const dom = (n) => { const a = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)]; return a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2; };
const boxUV = (p, n) => { const k = dom(n), q = [p.x, p.y, p.z]; return k === 0 ? [q[2], q[1]] : k === 1 ? [q[0], q[2]] : [q[0], q[1]]; };

// Caja con aristas achaflanadas (26 caras, 44 triángulos). c = chaflán; o = centro; uvf(p_local, n) → [u, v].
function cbox(G, w, h, d, c, uvf = boxUV, o = [0, 0, 0]) {
  const H = [w / 2, h / 2, d / 2], O = new V3(...o);
  const pt = (s, ax) => new V3(...[0, 1, 2].map((k) => s[k] * (k === ax ? H[k] : H[k] - c))).add(O);
  const face = (pts, n) => G.poly(pts, n, pts.map((p) => uvf(p.clone().sub(O), n)));
  for (let ax = 0; ax < 3; ax++) for (const s of [-1, 1]) {
    const a = (ax + 1) % 3, b = (ax + 2) % 3, pts = [];
    for (const [sa, sb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const sv = [0, 0, 0]; sv[ax] = s; sv[a] = sa; sv[b] = sb; pts.push(pt(sv, ax)); }
    const n = new V3(); n.setComponent(ax, s); face(pts, n);
  }
  if (c <= 0) return G;
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
    const k = 3 - a - b, pts = [];
    for (const [ax, sk] of [[a, -1], [a, 1], [b, 1], [b, -1]]) { const sv = [0, 0, 0]; sv[a] = sa; sv[b] = sb; sv[k] = sk; pts.push(pt(sv, ax)); }
    const n = new V3(); n.setComponent(a, sa); n.setComponent(b, sb); face(pts, n.normalize());
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) { const sv = [sx, sy, sz]; face([pt(sv, 0), pt(sv, 1), pt(sv, 2)], new V3(sx, sy, sz).normalize()); }
  return G;
}
// Prisma de perfil cerrado (XY) extruido en Z, centrado. Normales suaves si el ángulo entre tramos es pequeño.
function prism(G, pts, len, { smooth = 0.7, caps = true, su = 1, sv = 1 } = {}) {
  if (THREE.ShapeUtils.area(pts.map(([x, y]) => new V2(x, y))) < 0) pts = pts.slice().reverse();
  const n = pts.length, SN = [], S = [0], z0 = -len / 2, z1 = len / 2;
  for (let i = 0; i < n; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % n], l = Math.hypot(x1 - x0, y1 - y0); SN.push(new V3((y1 - y0) / l, -(x1 - x0) / l, 0)); S.push(S[i] + l); }
  const vn = (i, s) => { const a = SN[(i - 1 + n) % n], b = SN[i % n]; return a.dot(b) > smooth ? a.clone().add(b).normalize() : SN[s]; };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, A = pts[i], B = pts[j], na = vn(i, i), nb = vn(j, i);
    G.poly([new V3(A[0], A[1], z0), new V3(B[0], B[1], z0), new V3(B[0], B[1], z1), new V3(A[0], A[1], z1)], SN[i],
      [[S[i] * su, 0], [S[i + 1] * su, 0], [S[i + 1] * su, len * sv], [S[i] * su, len * sv]], [na, nb, nb, na]);
  }
  if (caps) {
    const tr = THREE.ShapeUtils.triangulateShape(pts.map(([x, y]) => new V2(x, y)), []);
    for (const z of [z0, z1]) for (const t of tr) G.poly(t.map((i) => new V3(pts[i][0], pts[i][1], z)), new V3(0, 0, Math.sign(z)), t.map((i) => [pts[i][0] * su, pts[i][1] * su]));
  }
  return G;
}
// Chapa conformada de espesor t: línea media abierta (XY) extruida en Z. u = f(arco), v = (z + len/2)·sv.
function thinWall(G, pts, t, len, { uf = (s, S) => s / S, sv = 1, v0 = 0, caps = true } = {}) {
  const n = pts.length, P = pts.map(([x, y]) => new V2(x, y)), L = [], S = [0], z0 = -len / 2, z1 = len / 2;
  for (let i = 0; i < n - 1; i++) { const d = P[i + 1].clone().sub(P[i]), l = d.length(); L.push(new V2(-d.y / l, d.x / l)); S.push(S[i] + l); }
  const M = P.map((_, i) => { const a = L[Math.max(0, i - 1)], b = L[Math.min(n - 2, i)], m = a.clone().add(b).normalize(); return { m, k: 1 / Math.max(0.5, m.dot(b)) }; });
  const A = P.map((p, i) => p.clone().addScaledVector(M[i].m, (M[i].k * t) / 2)), B = P.map((p, i) => p.clone().addScaledVector(M[i].m, (-M[i].k * t) / 2));
  const v3 = (p, z) => new V3(p.x, p.y, z), n3 = (v, s = 1) => new V3(v.x * s, v.y * s, 0), Sn = S[n - 1], V = (z) => v0 + (z - z0) * sv;
  for (let i = 0; i < n - 1; i++) {
    const u0 = uf(S[i], Sn), u1 = uf(S[i + 1], Sn), uv = [[u0, V(z0)], [u1, V(z0)], [u1, V(z1)], [u0, V(z1)]];
    const fl = S[i + 1] - S[i] > 0.006, na = fl ? L[i] : M[i].m, nb = fl ? L[i] : M[i + 1].m;
    for (const [Q, s] of [[A, 1], [B, -1]]) G.poly([v3(Q[i], z0), v3(Q[i + 1], z0), v3(Q[i + 1], z1), v3(Q[i], z1)], n3(L[i], s), uv, [n3(na, s), n3(nb, s), n3(nb, s), n3(na, s)]);
    if (caps) for (const z of [z0, z1]) G.poly([v3(A[i], z), v3(A[i + 1], z), v3(B[i + 1], z), v3(B[i], z)], new V3(0, 0, Math.sign(z)), [[u0, 0], [u1, 0], [u1, 0.01], [u0, 0.01]]);
  }
  for (const [i, j] of [[0, 1], [n - 1, n - 2]]) {
    const d = P[i].clone().sub(P[j]).normalize(), u = uf(S[i], Sn);
    G.poly([v3(A[i], z0), v3(B[i], z0), v3(B[i], z1), v3(A[i], z1)], new V3(d.x, d.y, 0), [[u, V(z0)], [u, V(z0)], [u, V(z1)], [u, V(z1)]]);
  }
  return G;
}
// Tornillería: cabeza/tuerca hexagonal con arandela, eje = Y, apoyada en y = 0.
const hexBolt = (r = 0.0095, h = 0.007, washer = true) => cached(`hb${r}|${h}|${washer}`, () => {
  const L = [[new THREE.CylinderGeometry(r, r, h, 6), T(0, (washer ? 0.002 : 0) + h / 2, 0)]];
  if (washer) L.push([new THREE.CylinderGeometry(r * 1.35, r * 1.35, 0.002, 10, 1, true), T(0, 0.001, 0)], [new THREE.CircleGeometry(r * 1.35, 10), T(0, 0.002, 0, -PI / 2)]);
  L.push([new THREE.CylinderGeometry(r * 0.55, r * 0.55, h * 0.9, 6, 1, true), T(0, (washer ? 0.002 : 0) + h * 1.4, 0)], [new THREE.CircleGeometry(r * 0.55, 6), T(0, (washer ? 0.002 : 0) + h * 1.85, 0, -PI / 2)]);
  return mg(L);
});

const hexHead = (r = 0.0085, h = 0.0065) => cached(`hh${r}|${h}`, () => mg([[new THREE.CylinderGeometry(r, r, h, 6, 1, true), T(0, h / 2, 0)], [new THREE.CircleGeometry(r, 6), T(0, h, 0, -PI / 2)]]));

// ================================================================ RACK SELECTIVO
// Perfil del puntal (mm, planta XZ): frente con dos nervios de rigidez hacia el pasillo (z = −30), costados x = ±40,
// labios de retorno hacia el interior del bastidor (z = +30, lado abierto donde entran los arriostres).
const UP = [[-28, 22], [-28, 28], [-30, 30], [-38, 30], [-40, 28], [-40, -28], [-38, -30], [-18, -30], [-15, -26.5], [-13, -26.5], [-10, -30],
  [10, -30], [13, -26.5], [15, -26.5], [18, -30], [38, -30], [40, -28], [40, 28], [38, 30], [30, 30], [28, 28], [28, 22]].map(([x, z]) => [x / 1000, z / 1000]);
const UP_T = 0.002, UP_TILE = 0.1; // espesor de chapa; periodo vertical de la textura de perforado (2 ranuras de 50 mm)
const arcOf = (P, q) => { let best = 1e9, s = 0, acc = 0; for (let i = 0; i < P.length - 1; i++) { const [x0, z0] = P[i], [x1, z1] = P[i + 1], dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz), t = Math.max(0, Math.min(1, ((q[0] - x0) * dx + (q[1] - z0) * dz) / (l * l))), e = Math.hypot(x0 + dx * t - q[0], z0 + dz * t - q[1]); if (e < best) { best = e; s = acc + t * l; } acc += l; } return [s, acc]; };

// Puntal de altura h. Origen: base (y = 0), centro del perfil; frente (ranuras) hacia −Z, lado abierto hacia +Z.
// Para el puntal trasero de un bastidor, rotar π en Y. UV: u = arco/perímetro, v = y / 0.1 m (tile del perforado).
export const uprightGeo = (h) => cached(`up${h}`, () => {
  const g = thinWall(new GB(), UP.map(([x, z]) => [x, -z]), UP_T, h, { sv: 1 / UP_TILE }).geo();
  g.applyMatrix4(T(0, h / 2, 0, -PI / 2)); return g;
});
// Placa base 140×6×110 con dos anclajes químicos (arandela + tuerca + espárrago). Origen en el piso, centro del puntal.
export const basePlateGeo = () => cached('bp', () => {
  const G = new GB(); cbox(G, 0.14, 0.006, 0.11, 0.0015, boxUV, [0, 0.003, 0.004]);
  G.rgb = [0.8, 0.8, 0.8]; cbox(G, 0.004, 0.035, 0.05, 0.001, boxUV, [-0.042, 0.0235, 0.004]); cbox(G, 0.004, 0.035, 0.05, 0.001, boxUV, [0.042, 0.0235, 0.004]); // cartelas
  return mg([[G.geo()], [hexBolt(0.0085, 0.008), T(-0.056, 0.006, 0.004)], [hexBolt(0.0085, 0.008), T(0.056, 0.006, 0.004)]]);
});
// Protector de puntal en «U» (chapa 4 mm, 400 mm) que envuelve el frente, con pie anclado. Origen en el piso.
export const protectorGeo = (h = 0.4) => cached(`pr${h}`, () => {
  const P = [[-0.047, -0.018], [-0.047, 0.031], [-0.042, 0.036], [0.042, 0.036], [0.047, 0.031], [0.047, -0.018]]; // (x, −z)
  const w = thinWall(new GB(), P, 0.004, h, { uf: (s, S) => (s / S) * 0.9, sv: 0.94 / h, v0: 0.045 }).geo(); w.applyMatrix4(T(0, h / 2 + 0.006, 0, -PI / 2));
  const G = new GB(), yel = () => YEL_UV; cbox(G, 0.13, 0.006, 0.075, 0.0015, yel, [0, 0.003, -0.07]);
  return mg([[w], [G.geo()], [hexBolt(0.008, 0.007), T(-0.04, 0.006, -0.085)], [hexBolt(0.008, 0.007), T(0.04, 0.006, -0.085)]]);
});
// Arriostre en C 30×40×1,5 de longitud len (eje Z, centrado; extremos = ejes de los puntales) con pernos M10 pasantes
// por los costados del puntal (cabeza en −X, tuerca en +X). Diagonales: rotar en X con atan2(−dy, dz) como hoy.
export const braceGeo = (len) => cached(`br${len}`, () => {
  const L = len + 0.03, P = [[0.013, 0.02], [0.015, 0.018], [0.015, -0.018], [0.013, -0.02], [-0.015, -0.02]]; // web en x = +0.015, alas hacia −X
  const c = thinWall(new GB(), [[-0.015, 0.014], [-0.015, 0.02], ...P.slice(0, 4), [-0.015, -0.02], [-0.015, -0.014]], 0.0016, L, { uf: (s) => s, sv: 1 }).geo();
  const parts = [[c]];
  for (const s of [-1, 1]) { const z = s * (len / 2 - 0.006); parts.push([hexHead(0.0085, 0.0065), T(-0.041, 0, z, 0, 0, PI / 2)], [hexHead(0.0085, 0.008), T(0.041, 0, z, 0, 0, -PI / 2)]); }
  return mg(parts);
});
// Larguero escalonado 110×50 (caja con escalón 16×15 para el deck) con conectores soldados (placa 4 mm, 4 uñas)
// y pasador de seguridad. len = distancia entre ejes de puntales (pitch). Origen: centro del vano, y = eje del larguero,
// z = eje de los puntales; el larguero queda delante de la cara frontal (−Z) con el escalón hacia +Z (interior).
// Para el larguero trasero, rotar π en Y. UV: u = arco del perfil, v = x.
export const beamGeo = (len) => cached(`bm${len}`, () => {
  const Z = [[-0.084, -0.053], [-0.082, -0.055], [-0.036, -0.055], [-0.034, -0.053], [-0.034, 0.039], [-0.035, 0.040], [-0.049, 0.040], [-0.050, 0.041], [-0.050, 0.054], [-0.051, 0.055], [-0.082, 0.055], [-0.084, 0.053]];
  const bl = len - 0.024, body = prism(new GB(), Z.map(([z, y]) => [-z, y]), bl, { smooth: 0.9 }).geo(); body.applyMatrix4(T(0, 0, 0, 0, PI / 2));
  const G = new GB(), parts = [[body]];
  for (const s of [-1, 1]) {
    const xc = s * (len / 2 - 0.026);
    G.rgb = [1, 1, 1]; cbox(G, 0.038, 0.165, 0.004, 0.0012, boxUV, [xc, -0.0325, -0.032]);              // placa del conector
    G.rgb = [0.75, 0.72, 0.7]; cbox(G, 0.006, 0.105, 0.052, 0, boxUV, [s * (len / 2 - 0.013), 0, -0.059]); // cordón de soldadura/tapa
    parts.push([new THREE.CylinderGeometry(0.0035, 0.0035, 0.026, 6), T(xc + s * 0.006, -0.085, -0.04, PI / 2), [0.85, 0.85, 0.3]]); // pasador
    parts.push([new THREE.TorusGeometry(0.008, 0.0016, 3, 6, PI * 1.3), T(xc + s * 0.006, -0.093, -0.053, 0, 0, PI * 0.15), [0.85, 0.85, 0.3]]);
  }
  parts.push([G.geo()]); return mg(parts);
});
// Deck de malla electrosoldada w×d (mesh: superficie con alas de caída; supports: 3 canales Ω). Origen: centro,
// y = 0 en el escalón del larguero (colocar en yLarguero + 0.040). La malla queda a ras del larguero (+0.015).
export const deckGeo = (w, d) => cached(`dk${w}|${d}`, () => {
  const G = new GB(), y = 0.015, a = (x, yy, z) => new V3(x, yy, z), up = new V3(0, 1, 0), hw = w / 2, hd = d / 2 - 0.01;
  const uv = (x, z) => [x / 0.05, z / 0.1];
  G.poly([a(-hw, y, -hd), a(hw, y, -hd), a(hw, y, hd), a(-hw, y, hd)], up, [uv(-hw, -hd), uv(hw, -hd), uv(hw, hd), uv(-hw, hd)]);
  for (const s of [-1, 1]) G.poly([a(-hw, y, s * hd), a(hw, y, s * hd), a(hw, 0, s * (hd + 0.006)), a(-hw, 0, s * (hd + 0.006))], new V3(0, 0.3, s).normalize(), [uv(-hw, 0), uv(hw, 0), uv(hw, 0.15), uv(-hw, 0.15)]);
  const S = new GB(); for (const x of [-hw + 0.06, 0, hw - 0.06]) thinWall(S, [[-0.02, 0], [-0.012, 0.0145], [0.012, 0.0145], [0.02, 0]].map(([px, py]) => [px + x, py]), 0.0015, d - 0.02, { uf: (s) => s });
  return { mesh: G.geo(), supports: S.geo() };
});
// Protector de cabecera de bastidor (fin de pasillo): baranda en «U» de tubo 100×50 a dos alturas, postes y placas
// ancladas. depth = profundidad del bastidor (ejes). Origen: eje del bastidor en el piso; la U se abre hacia +X (al rack).
export const frameGuardGeo = (depth) => cached(`fg${depth}`, () => {
  const G = new GB(), xf = -0.2, zs = depth / 2 + 0.11, stripe = (ax) => (p, n) => { const q = [p.x, p.y, p.z], o = ax === 1 ? 0 : 1; return [(q[ax] + q[o]) / 0.2, (q[ax] - q[o]) * 0.02 + 0.5]; };
  for (const y of [0.2, 0.42]) {
    cbox(G, 0.06, 0.1, 2 * zs + 0.06, 0.006, stripe(2), [xf, y, 0]);
    for (const s of [-1, 1]) cbox(G, 0.32, 0.1, 0.06, 0.006, stripe(0), [xf + 0.19, y, s * zs]);
  }
  for (const [x, z] of [[xf, -zs], [xf, zs], [xf + 0.32, -zs], [xf + 0.32, zs]]) { cbox(G, 0.08, 0.47, 0.08, 0.006, stripe(1), [x, 0.245, z]); cbox(G, 0.16, 0.01, 0.16, 0.002, () => YEL_UV, [x, 0.005, z]); }
  return G.geo();
});
// Separador de fila (unión de bastidores espalda con espalda): canal + 2 pletinas. len a lo largo de Z, centrado.
export const rowSpacerGeo = (len = 0.2) => cached(`rs${len}`, () => {
  const G = new GB(); cbox(G, 0.04, 0.04, len - 0.01, 0.003, boxUV); for (const s of [-1, 1]) cbox(G, 0.06, 0.07, 0.005, 0.0015, boxUV, [0, 0, s * (len / 2 - 0.0025)]);
  return G.geo();
});
// Placa de carga máxima 300×210 con remaches. Origen en el centro, cara hacia +Z.
export const loadSignGeo = () => cached('ls', () => {
  const G = new GB(); cbox(G, 0.3, 0.21, 0.003, 0.001, (p, n) => (n.z > 0.9 ? [p.x / 0.3 + 0.5, p.y / 0.21 + 0.5] : [0.01, 0.01]));
  const parts = [[G.geo()]]; for (const x of [-0.13, 0.13]) for (const y of [-0.085, 0.085]) parts.push([new THREE.SphereGeometry(0.005, 6, 3, 0, TAU, 0, PI / 2), T(x, y, 0.0015, PI / 2), [0.6, 0.6, 0.6]]);
  return mg(parts);
});

// Materiales del rack. frame = 'blue' | 'galv'. upright usa alphaMap+alphaTest: perforaciones REALES (se ve a través,
// sombras con huecos) a coste cero en triángulos; un normal map no permitiría ver el interior ni el fondo.
let _RM = null;
const YEL_UV = [21 / 256, 0.0195];
export function makeRackMaterials({ frame = 'blue' } = {}) {
  if (_RM && _RM.frame === frame) return _RM;
  const K = materials(), std = (o) => new THREE.MeshStandardMaterial(o);
  const tot = arcOf(UP, [28 / 1000, 22 / 1000])[1], W = 512, Hh = 256, upx = W / tot, vpx = Hh / UP_TILE;
  const perf = canvas(W, Hh, (g) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, Hh); g.fillStyle = '#000';
    for (const xs of [-0.028, 0.028]) {                                   // lágrimas de los conectores (paso 50 mm)
      const u = arcOf(UP, [xs, -0.03])[0] * upx;
      for (let k = 0; k < 2; k++) { const yc = (k + 0.5) * 0.05 * vpx; g.save(); g.translate(u, yc); g.scale(upx / 1000, vpx / 1000);
        g.beginPath(); g.arc(0, -7, 6, PI, 0); g.lineTo(3.5, 9); g.arc(0, 9, 3.5, 0, PI); g.closePath(); g.fill(); g.restore(); }
    }
    for (const xs of [-0.04, 0.04]) for (const zz of [-0.008, 0.012]) {      // agujeros de arriostre en los costados
      const u = arcOf(UP, [xs, zz])[0] * upx; g.save(); g.translate(u, (zz < 0 ? 0.25 : 0.75) * Hh); g.scale(upx / 1000, vpx / 1000); g.beginPath(); g.arc(0, 0, 5.5, 0, TAU); g.fill(); g.restore();
    }
  });
  const alpha = tex(perf, [1, 1], false); alpha.anisotropy = 4;
  const spangle = canvas(256, 256, (g, w, h) => { g.fillStyle = '#9aa3ad'; g.fillRect(0, 0, w, h); for (let i = 0; i < 700; i++) { const x = hash(i) * w, y = hash(i + 7) * h, r = 4 + hash(i + 3) * 14, c = 120 + hash(i + 5) * 90 | 0; g.fillStyle = `rgba(${c},${c + 4},${c + 10},.55)`; g.beginPath(); for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + hash(i + k) * 0.8, rr = r * (0.6 + hash(i * 3 + k) * 0.5); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.fill(); } });
  const hz = canvas(256, 256, (g, w, h) => {
    g.fillStyle = '#f0b70d'; g.fillRect(0, 0, w, h); g.fillStyle = '#17181a';
    for (let x = -2 * w; x < 2 * w; x += 64) { g.beginPath(); g.moveTo(x + 32, h); g.lineTo(x + 64, h); g.lineTo(x + 64 + h, 0); g.lineTo(x + 32 + h, 0); g.fill(); }
    g.fillStyle = '#f0b70d'; g.fillRect(0, h - 8, w, 8);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${hash(i) < 0.5 ? '190,190,185' : '40,36,30'},${0.25 + hash(i + 1) * 0.4})`; g.fillRect(hash(i + 2) * w, hash(i + 3) * h, 1 + hash(i + 4) * 5, 1 + hash(i + 5) * 2); }
  });
  const sign = canvas(512, 360, (g, w, h) => {
    g.fillStyle = '#f2c21b'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(12, 12, w - 24, h - 24); g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(22, 22, w - 44, h - 44);
    g.fillStyle = '#111'; g.textAlign = 'center'; g.font = 'bold 40px sans-serif'; g.fillText('CARGA MÁXIMA', w / 2, 78);
    g.font = 'bold 30px sans-serif'; g.fillText('POR NIVEL (2 largueros)', w / 2, 132); g.font = 'bold 64px sans-serif'; g.fillText('1 000 kg', w / 2, 200);
    g.font = '26px sans-serif'; g.fillText('POR BASTIDOR: 6 000 kg · 3 NIVELES', w / 2, 250); g.fillText('Carga uniformemente repartida', w / 2, 286);
    g.font = '18px sans-serif'; g.fillText('No modificar alturas sin autorización · Inspección anual', w / 2, 322);
  });
  const blue = frame === 'blue', paint = (c, o = {}) => std({ color: c, roughness: 0.42, metalness: 0.35, roughnessMap: K.roughT, ...o });
  const galvT = tex(spangle, [2, 2]);
  _RM = {
    frame,
    upright: blue ? paint(0x1d5a9e, { alphaMap: alpha, alphaTest: 0.5 }) : std({ color: 0xffffff, map: galvT, metalness: 0.75, roughness: 0.38, alphaMap: alpha, alphaTest: 0.5 }),
    brace: blue ? paint(0x1d5a9e, { vertexColors: true }) : std({ color: 0xffffff, map: galvT, metalness: 0.75, roughness: 0.38, vertexColors: true }),
    beam: paint(0xe2611a, { vertexColors: true, metalness: 0.3 }),
    galv: std({ color: 0xffffff, map: galvT, metalness: 0.75, roughness: 0.4, vertexColors: true }),
    hazard: std({ map: tex(hz), roughness: 0.55, metalness: 0.15 }),
    deck: std({ color: 0x9fa9b3, map: null, alphaMap: tex(canvas(64, 128, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(0, 0, 5, h); g.fillRect(0, 0, w, 5); }), [1, 1], false), alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.75, roughness: 0.35 }),
    sign: std({ map: tex(sign, [1, 1]), roughness: 0.4, metalness: 0.2, vertexColors: true }),
  };
  _RM.deck.alphaMap.magFilter = THREE.LinearFilter;
  return _RM;
}

// ================================================================ TARIMA (pallet)
// Tarima de bloques palletW (X) × palletD (Z) × 0,125 m: 3 patines inferiores (Z), 9 tacos, 3 travesaños (X),
// 5 tablas de cubierta (Z) con aristas biseladas, 30 clavos y sello térmico (HT) quemado en los tacos centrales.
// Origen: centro de la base (y = 0). Variación de tono por tabla en vertex colors (material con vertexColors).
export const PAL_H = 0.125;
export const palletGeo = (W = SLOT.palletW, D = SLOT.palletD) => cached(`pal${W}|${D}`, () => {
  const G = new GB(), hw = W / 2, hd = D / 2, xs = [-hw + 0.05, 0, hw - 0.05], zs = [-hd + 0.05, 0, hd - 0.05];
  let seed = 1; const rnd = () => hash(seed++ * 7.31);
  const tone = () => { const t = rnd(), g = rnd() * 0.12; return [1 - g - 0.05 * t, 0.97 - g - 0.08 * t, 0.9 - g * 1.1 - 0.12 * t]; };
  // UV: veta a lo largo del eje largo de la pieza; banda v ∈ [0.3, 1] del atlas (abajo queda el sello).
  const grain = (long) => { const ou = rnd() * 4, ov = 0.06 + rnd() * 0.5; return (p, n) => { const q = [p.x, p.y, p.z], k = dom(n), o = 3 - k - long; return k === long ? [q[(long + 1) % 3] * 3 + ou, 0.3 + ov + q[(long + 2) % 3] * 0.7] : [q[long] + ou, 0.3 + ov + q[o] * 0.7]; }; };
  const piece = (w, h, d, c, o, long, uvf) => { G.rgb = tone(); cbox(G, w, h, d, c, uvf || grain(long), o); };
  const wB = (i) => (i === 1 ? 0.145 : 0.1);
  for (let i = 0; i < 3; i++) piece(wB(i), 0.018, D, 0.003, [xs[i], 0.009, 0], 2);                                // patines
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) {                                                        // tacos
    const stamp = (i === 1) !== (k === 1), g1 = grain(1), uvS = (p, n) => {                                                        // sello en tacos centrales
      const a = Math.abs(n.x) > 0.99 ? (n.x > 0 ? -p.z : p.z) / wB(k) : Math.abs(n.z) > 0.99 ? (n.z > 0 ? p.x : -p.x) / wB(i) : null;
      return a === null || (Math.abs(n.x) > 0.99 && i === 1) || (Math.abs(n.z) > 0.99 && k === 1) ? g1(p, n) : [0.02 + (a + 0.5) * 0.46, 0.02 + (p.y / 0.068 + 0.5) * 0.21];
    };
    piece(wB(i), 0.068, wB(k), 0.004, [xs[i], 0.052, zs[k]], 1, stamp ? uvS : null);
  }
  for (let k = 0; k < 3; k++) piece(W, 0.02, wB(k), 0.003, [0, 0.096, zs[k]], 0);                                   // travesaños
  const tb = [[-hw + 0.0725, 0.145], [-0.21, 0.1], [0, 0.145], [0.21, 0.1], [hw - 0.0725, 0.145]];
  for (const [x, w] of tb) piece(w, 0.019, D, 0.005, [x, 0.1155, 0], 2);                                          // cubierta
  G.rgb = [0.22, 0.21, 0.2]; const up = new V3(0, 1, 0), y = PAL_H + 0.0004, s = 0.0045;                           // clavos
  for (const [x] of tb) for (const z of zs) for (const [dx, dz] of [[-0.022, -0.024], [0.022, 0.024]]) {
    const cx = x + dx, cz = z + dz; G.poly([new V3(cx - s, y, cz - s), new V3(cx + s, y, cz - s), new V3(cx + s, y, cz + s), new V3(cx - s, y, cz + s)], up, [[0.9, 0.9], [0.9, 0.9], [0.9, 0.9], [0.9, 0.9]]);
  }
  return G.geo();
});
let _woodM = null;
export function palletMaterial() {
  if (_woodM) return _woodM;
  const W = 512, Hh = 512;
  const c = canvas(W, Hh, (g) => {
    const img = g.createImageData(W, Hh), d = img.data;
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      const u = x / W, v = y / Hh, warp = 0.18 * Math.sin(TAU * (u * 2 + v * 3)) + 0.07 * Math.sin(TAU * (u * 5 - v * 9)) + 0.03 * Math.sin(TAU * (u * 13 + v * 4));
      const r = v * 70 + warp, f = Math.pow(Math.abs((r - Math.floor(r)) * 2 - 1), 6), r2 = v * 190 + warp * 2, f2 = Math.pow(Math.abs((r2 - Math.floor(r2)) * 2 - 1), 8);
      const fib = hash(y * 131 + ((x >> 4) % (W >> 4)) * 17) * 0.06 + hash(x * 7 + y * 911) * 0.06, band = 0.05 * Math.sin(TAU * (v * 5 + 0.3 * Math.sin(TAU * u)));
      const l = 1 - 0.17 * f - 0.07 * f2 - fib + band, i = (y * W + x) * 4; d[i] = 206 * l; d[i + 1] = 180 * l; d[i + 2] = 142 * l; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    for (let k = 0; k < 5; k++) { const x = hash(k + 40) * W, y = 20 + hash(k + 50) * 320, rx = 4 + hash(k + 60) * 7; for (const ox of [-W, 0, W]) { // nudos (periódicos en u)
      const gr = g.createRadialGradient(x + ox, y, 0, x + ox, y, rx * 2.2); gr.addColorStop(0, 'rgba(70,45,20,.85)'); gr.addColorStop(0.3, 'rgba(110,80,45,.45)'); gr.addColorStop(1, 'rgba(110,70,30,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x + ox, y, rx * 2.2, rx * 0.9, 0, 0, TAU); g.fill(); } }
    // Sello quemado (zona u 0–0.5, v 0–0.25): marca fitosanitaria genérica HT
    g.save(); g.translate(0, 384); g.fillStyle = 'rgba(205,170,120,.35)'; g.fillRect(0, 0, 256, 128);
    g.strokeStyle = 'rgba(45,25,10,.85)'; g.fillStyle = 'rgba(45,25,10,.85)'; g.lineWidth = 5; g.beginPath(); g.roundRect(18, 16, 220, 96, 10); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.moveTo(70, 100); g.lineTo(70, 30); g.stroke(); for (let k = 0; k < 5; k++) for (const s of [-1, 1]) { g.beginPath(); g.ellipse(70 + s * 9, 40 + k * 12, 5, 9, s * 0.5, 0, TAU); g.fill(); }
    g.beginPath(); g.moveTo(96, 16); g.lineTo(96, 112); g.stroke(); g.font = 'bold 26px monospace'; g.textAlign = 'left'; g.fillText('PE-0217', 106, 48); g.fillText('HT  DB', 106, 92);
    g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(0,0,0,${0.3 + hash(i) * 0.5})`; g.fillRect(18 + hash(i + 1) * 220, 16 + hash(i + 2) * 96, 2 + hash(i + 3) * 8, 1 + hash(i + 4) * 3); }
    g.restore();
  });
  _woodM = new THREE.MeshStandardMaterial({ map: tex(c), normalMap: normalFrom(c, 2), normalScale: new V2(0.45, 0.45), roughness: 0.88, metalness: 0, vertexColors: true });
  return _woodM;
}

// ================================================================ CARTÓN CORRUGADO
// Caja w×h×d (exacta, centrada en el origen) con aristas achaflanadas (bordes aplastados), cinta de embalaje en relieve
// sobre la costura de solapas que baja 4 cm por las cabeceras. Atlas: costado (±Z) impreso, cabecera (±X) con asa y
// etiqueta, tapa (±Y), canto, cinta. 54 triángulos. Usar con instanceColor (el mapa es casi blanco → tinte legible).
const CA = 1024, R = (x0, y0, x1, y1) => ({ u0: x0 / CA, u1: x1 / CA, v0: 1 - y1 / CA, v1: 1 - y0 / CA });
const RS = { side: R(0, 0, 1024, 500), end: R(0, 512, 600, 878), top: R(600, 512, 1024, 854), edge: R(40, 920, 120, 1000), tape: R(200, 905, 1000, 995) };
const inR = (r, u, v) => [r.u0 + u * (r.u1 - r.u0), r.v0 + v * (r.v1 - r.v0)];
export const CARTON = { w: 0.47, h: 0.24, d: 0.38 };
export const cartonGeo = (w = CARTON.w, h = CARTON.h, d = CARTON.d) => cached(`ct${w}|${h}|${d}`, () => {
  const c = 0.006, G = new GB();
  cbox(G, w, h, d, c, (p, n) => {
    const X = p.x / w + 0.5, Y = p.y / h + 0.5, Z = p.z / d + 0.5;
    if (Math.abs(n.z) > 0.99) return inR(RS.side, n.z > 0 ? X : 1 - X, Y);
    if (Math.abs(n.x) > 0.99) return inR(RS.end, n.x > 0 ? 1 - Z : Z, Y);
    if (Math.abs(n.y) > 0.99) return inR(RS.top, X, n.y > 0 ? 1 - Z : Z);
    return inR(RS.edge, 0.5 + (p.x + p.z) * 0.5, 0.5 + p.y);
  });
  const e = 0.0007, tw = 0.048, tl = 0.04, hw = w / 2, hh = h / 2, s2 = Math.SQRT1_2, Ltot = w - 2 * c + 2 * c * Math.SQRT2 + 2 * tl;
  const q = (x, y, z) => new V3(x, y, z), tu = (s, side) => inR(RS.tape, s / Ltot, side);
  let s0 = tl + c * Math.SQRT2;
  G.poly([q(-hw + c, hh + e, -tw / 2), q(hw - c, hh + e, -tw / 2), q(hw - c, hh + e, tw / 2), q(-hw + c, hh + e, tw / 2)], q(0, 1, 0), [tu(s0, 0), tu(Ltot - s0, 0), tu(Ltot - s0, 1), tu(s0, 1)]);
  for (const sg of [-1, 1]) {
    const a = sg > 0 ? Ltot - s0 : s0, b = sg > 0 ? Ltot - tl : tl, f = sg > 0 ? Ltot : 0;
    G.poly([q(sg * (hw - c), hh + e, -tw / 2), q(sg * (hw + e * s2), hh - c + e * s2, -tw / 2), q(sg * (hw + e * s2), hh - c + e * s2, tw / 2), q(sg * (hw - c), hh + e, tw / 2)], q(sg * s2, s2, 0), [tu(a, 0), tu(b, 0), tu(b, 1), tu(a, 1)]);
    G.poly([q(sg * (hw + e), hh - c, -tw / 2), q(sg * (hw + e), hh - c - tl, -tw / 2), q(sg * (hw + e), hh - c - tl, tw / 2), q(sg * (hw + e), hh - c, tw / 2)], q(sg, 0, 0), [tu(b, 0), tu(f, 0), tu(f, 1), tu(b, 1)]);
  }
  return G.geo();
});
let _cartM = null;
export function cartonMaterial() {
  if (_cartM) return _cartM;
  const px = (r) => [r.u0 * CA, (1 - r.v1) * CA, (r.u1 - r.u0) * CA, (r.v1 - r.v0) * CA];
  const berries = (g, x, y, s) => { for (let i = 0; i < 9; i++) { const bx = x + (hash(i + 1) - 0.5) * s * 2.6, by = y + (hash(i + 2) - 0.5) * s * 1.6, r = s * (0.42 + hash(i + 3) * 0.2);
    const gr = g.createRadialGradient(bx - r * 0.3, by - r * 0.35, r * 0.1, bx, by, r); gr.addColorStop(0, '#6f7fc4'); gr.addColorStop(0.5, '#33407e'); gr.addColorStop(1, '#1d2350'); g.fillStyle = gr; g.beginPath(); g.arc(bx, by, r, 0, TAU); g.fill();
    g.strokeStyle = '#151a38'; g.lineWidth = r * 0.12; g.beginPath(); for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU; g.moveTo(bx - r * 0.1, by - r * 0.55); g.lineTo(bx - r * 0.1 + Math.cos(a) * r * 0.2, by - r * 0.55 + Math.sin(a) * r * 0.2); } g.stroke(); } };
  const leaf = (g, x, y, a, s) => { g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = '#2f7a3a'; g.beginPath(); g.ellipse(0, 0, s, s * 0.42, 0, 0, TAU); g.fill(); g.strokeStyle = '#1f5427'; g.lineWidth = 2; g.beginPath(); g.moveTo(-s, 0); g.lineTo(s, 0); g.stroke(); g.restore(); };
  const barcode = (g, x, y, w, h) => { g.fillStyle = '#111'; let cx = x, i = 0; while (cx < x + w) { const bw = 1 + Math.floor(hash(i * 3.1 + 5) * 3); if (i++ % 2) g.fillRect(cx, y, bw, h); cx += bw + 1; } };
  const draw = (g, hgt) => {
    // base: cartón con cara blanca estucada; canales (flautas) muy tenues
    g.fillStyle = hgt ? '#808080' : '#f1eee6'; g.fillRect(0, 0, CA, CA);
    if (!hgt) { for (let x = 0; x < CA; x += 5) { g.fillStyle = 'rgba(120,100,70,.035)'; g.fillRect(x, 0, 2, CA); } }
    else { for (let x = 0; x < 1024; x += 5) { g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x, 0, 2, 512); } }
    // costado
    let [x, y, w, h] = px(RS.side);
    if (!hgt) {
      g.fillStyle = '#2b2160'; g.fillRect(x, y + h - 78, w, 78); g.fillStyle = '#6b3fa0'; g.fillRect(x, y + h - 86, w, 8);
      berries(g, x + 170, y + 210, 46); leaf(g, x + 90, y + 140, -0.6, 52); leaf(g, x + 250, y + 130, 0.5, 44);
      g.fillStyle = '#2b2160'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.font = 'bold 92px sans-serif'; g.fillText('ARÁNDANOS', x + 330, y + 200);
      g.fillStyle = '#6b3fa0'; g.font = 'bold 52px sans-serif'; g.fillText('BLUEBERRIES · FRESH', x + 334, y + 266);
      g.fillStyle = '#3a3a3a'; g.font = '28px sans-serif'; g.fillText('Categoría I · 12 × 125 g · Peso neto 1,5 kg', x + 336, y + 318);
      g.fillStyle = '#fff'; g.font = 'bold 30px sans-serif'; g.fillText('PRODUCTO DEL PERÚ  ·  CONSERVAR 0–2 °C  ·  90–95 % HR', x + 36, y + h - 28);
      g.fillStyle = '#fff'; g.fillRect(x + 820, y + 290, 170, 100); g.strokeStyle = '#999'; g.strokeRect(x + 820, y + 290, 170, 100); barcode(g, x + 832, y + 300, 146, 52); g.fillStyle = '#222'; g.font = '16px monospace'; g.fillText('7 750123 456789', x + 834, y + 376);
    }
    // cabecera: asa troquelada + etiqueta de trazabilidad + flechas
    [x, y, w, h] = px(RS.end);
    const hx = x + w / 2, hy = y + h * 0.3;
    if (hgt) { g.fillStyle = '#202020'; g.beginPath(); g.roundRect(hx - 80, hy - 24, 160, 48, 24); g.fill(); g.strokeStyle = '#b0b0b0'; g.lineWidth = 6; g.stroke(); }
    else {
      g.fillStyle = '#1a140e'; g.beginPath(); g.roundRect(hx - 80, hy - 24, 160, 48, 24); g.fill(); g.strokeStyle = 'rgba(120,100,70,.6)'; g.lineWidth = 3; g.stroke();
      g.fillStyle = '#fff'; g.fillRect(x + 40, y + 170, 330, 170); g.strokeStyle = '#888'; g.lineWidth = 2; g.strokeRect(x + 40, y + 170, 330, 170);
      g.fillStyle = '#111'; g.textAlign = 'left'; g.font = 'bold 26px sans-serif'; g.fillText('ARÁNDANO · LOTE 2604-A', x + 52, y + 202);
      g.font = '20px monospace'; g.fillText('CAMPO 12  CALIBRE JUMBO', x + 52, y + 232); g.fillText('EMPAQUE 04/10  GGN 40xx', x + 52, y + 258); barcode(g, x + 52, y + 272, 300, 52);
      g.fillStyle = '#2b2160'; for (const ax of [440, 500]) { g.beginPath(); g.moveTo(x + ax, y + 210); g.lineTo(x + ax + 22, y + 250); g.lineTo(x + ax + 8, y + 250); g.lineTo(x + ax + 8, y + 300); g.lineTo(x + ax - 8, y + 300); g.lineTo(x + ax - 8, y + 250); g.lineTo(x + ax - 22, y + 250); g.fill(); }
      g.font = 'bold 22px sans-serif'; g.fillText('0–2 °C', x + 432, y + 336);
    }
    // tapa: plegados de solapas, costura central y logotipo; manchas de manipulación
    [x, y, w, h] = px(RS.top);
    if (hgt) { g.fillStyle = '#3a3a3a'; g.fillRect(x, y + h / 2 - 3, w, 6); g.fillStyle = '#9a9a9a'; g.fillRect(x, y + 6, w, 4); g.fillRect(x, y + h - 10, w, 4); }
    else {
      g.fillStyle = 'rgba(90,70,40,.35)'; g.fillRect(x, y + h / 2 - 2, w, 4); g.fillStyle = 'rgba(90,70,40,.12)'; g.fillRect(x, y + 6, w, 3); g.fillRect(x, y + h - 9, w, 3);
      g.fillStyle = '#2b2160'; g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.fillText('ARÁNDANOS', x + w / 2, y + 80); berries(g, x + w / 2, y + 250, 22);
      for (let i = 0; i < 6; i++) { const gr = g.createRadialGradient(x + hash(i) * w, y + hash(i + 9) * h, 0, x + hash(i) * w, y + hash(i + 9) * h, 50); gr.addColorStop(0, 'rgba(120,100,70,.10)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x, y, w, h); }
    }
    // canto aplastado y cinta (con brillo/arrugas)
    [x, y, w, h] = px(RS.edge); g.fillStyle = hgt ? '#606060' : '#c9b99a'; g.fillRect(x, y, w, h);
    [x, y, w, h] = px(RS.tape);
    if (hgt) { g.fillStyle = '#c8c8c8'; g.fillRect(x, y, w, h); g.fillStyle = '#e0e0e0'; for (let i = 0; i < 30; i++) g.fillRect(x + hash(i) * w, y, 2, h); }
    else { g.fillStyle = '#d9c39a'; g.fillRect(x, y, w, h); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x, y + 3, w, 4); for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(x + hash(i) * w, y, 2, h); } }
    if (!hgt) { const e = g.createLinearGradient(0, 0, 0, 500); e.addColorStop(0, 'rgba(90,70,40,.18)'); e.addColorStop(0.06, 'rgba(0,0,0,0)'); e.addColorStop(0.94, 'rgba(0,0,0,0)'); e.addColorStop(1, 'rgba(90,70,40,.22)'); g.fillStyle = e; g.fillRect(0, 0, 1024, 500); }
  };
  const col = canvas(CA, CA, (g) => draw(g, false)), hm = canvas(CA, CA, (g) => draw(g, true));
  _cartM = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex(col), normalMap: normalFrom(hm, 1.6), normalScale: new V2(0.8, 0.8), roughness: 0.86, metalness: 0 });
  return _cartM;
}

// ================================================================ FILM, ESQUINEROS, HOJA SUPERIOR
// Film estirable alrededor de una carga w×d×h que empieza en y0 (sobre la tarima). Anillos de 16 puntos con esquinas
// redondeadas por los esquineros, abombado leve entre esquinas y pliegue superior hacia dentro. 192 triángulos.
// Origen: centro de la base de la TARIMA (como hoy: matriz = traslación del pallet). UV: u = perímetro [m], v = altura/0.5.
export const filmGeo = (w = 0.96, d = 1.18, h = 1.46, y0 = PAL_H) => cached(`fm${w}|${d}|${h}|${y0}`, () => {
  const e = 0.012, hw = w / 2 + e, hd = d / 2 + e, r = 0.02, ring = (inset, bul) => { // 16 puntos CCW (x, z)
    const a = hw - inset, b = hd - inset, C = [[1, 1], [-1, 1], [-1, -1], [1, -1]], P = [];
    for (let k = 0; k < 4; k++) {
      const [sx, sz] = C[k], th = (k * PI) / 2;
      for (const f of [0.25, 0.75]) { const t = th + f * (PI / 2); P.push([sx * (a - r) + r * Math.cos(t), sz * (b - r) + r * Math.sin(t)]); }
      const nt = th + PI / 2, [nx, nz] = [Math.round(Math.cos(nt)), Math.round(Math.sin(nt))], [ex, ez] = C[(k + 1) % 4], p0 = [sx * (a - r) + r * Math.cos(nt), sz * (b - r) + r * Math.sin(nt)], p1 = [ex * (a - r) + r * Math.cos(nt), ez * (b - r) + r * Math.sin(nt)];
      for (const t of [1 / 3, 2 / 3]) P.push([p0[0] + (p1[0] - p0[0]) * t + nx * bul, p0[1] + (p1[1] - p0[1]) * t + nz * bul]);
    }
    return P;
  };
  const rings = [[y0 - 0.032, -e + 0.016, 0], [y0 + 0.02, 0, 0.002], [y0 + h * 0.33, 0, 0.007], [y0 + h * 0.66, 0, 0.006], [y0 + h - 0.03, 0, 0.002], [y0 + h + 0.004, 0.004, 0], [y0 + h + 0.012, 0.075, 0]].map(([y, i, b]) => [y, ring(i, b)]);
  const G = new GB(), n = 16;
  for (let j = 0; j < rings.length - 1; j++) {
    const [ya, A] = rings[j], [yb, B] = rings[j + 1]; let s = 0;
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n, l = Math.hypot(A[i2][0] - A[i][0], A[i2][1] - A[i][1]), a0 = new V3(A[i][0], ya, A[i][1]), a1 = new V3(A[i2][0], ya, A[i2][1]), b1 = new V3(B[i2][0], yb, B[i2][1]), b0 = new V3(B[i][0], yb, B[i][1]);
      const mid = a0.clone().add(a1).multiplyScalar(0.5), fn = new V3(mid.x, 0, mid.z).normalize(), nv = (p) => new V3(p.x / hw, 0.15 * (j === rings.length - 2 ? 3 : 0), p.z / hd).normalize();
      G.poly([a0, a1, b1, b0], fn, [[s, (ya - y0) / 0.5], [s + l, (ya - y0) / 0.5], [s + l, (yb - y0) / 0.5], [s, (yb - y0) / 0.5]], [nv(a0), nv(a1), nv(b1), nv(b0)]); s += l;
    }
  }
  return G.geo();
});
// Esquinero de cartón (L 50×50×4) de altura h: arista interior en el origen, alas hacia +X y +Z, base en y = 0.
export const cornerGeo = (h) => cached(`cn${h}`, () => { const g = thinWall(new GB(), [[0.05, 0], [0.002, 0], [0, 0.002], [0, 0.05]].map(([x, z]) => [x - 0.002, -(z - 0.002)]), 0.004, h, { uf: (s) => s * 4, sv: 2 }).geo(); g.applyMatrix4(T(0, h / 2, 0, -PI / 2)); return g; });
// Conjunto «vestido» del pallet: 4 esquineros + hoja superior con bordes caídos (reemplaza la geometría de o.corners).
export const palletDressGeo = (w = 0.96, d = 1.18, h = 1.46, y0 = PAL_H) => cached(`pd${w}|${d}|${h}|${y0}`, () => {
  const L = [], ch = h - 0.04, hw = w / 2 + 0.002, hd = d / 2 + 0.002;
  for (const [sx, sz, ry] of [[-1, -1, 0], [1, -1, -PI / 2], [1, 1, PI], [-1, 1, PI / 2]]) L.push([cornerGeo(ch), T(sx * hw, y0 + 0.02, sz * hd, 0, ry)]);
  const G = new GB(), yt = y0 + h + 0.003, q = (x, y, z) => new V3(x, y, z), up = q(0, 1, 0), o = 0.01, dr = 0.025;
  G.poly([q(-hw, yt, -hd), q(hw, yt, -hd), q(hw, yt, hd), q(-hw, yt, hd)], up, [[0, 0], [w, 0], [w, d], [0, d]]);
  for (const [a, b, n] of [[[-hw, -hd], [hw, -hd], [0, -1]], [[hw, -hd], [hw, hd], [1, 0]], [[hw, hd], [-hw, hd], [0, 1]], [[-hw, hd], [-hw, -hd], [-1, 0]]])
    G.poly([q(a[0], yt, a[1]), q(b[0], yt, b[1]), q(b[0] + n[0] * o, yt - dr, b[1] + n[1] * o), q(a[0] + n[0] * o, yt - dr, a[1] + n[1] * o)], q(n[0], 0.6, n[1]).normalize(), [[0, 0], [1, 0], [1, 0.03], [0, 0.03]]);
  L.push([G.geo()]); return mg(L);
});
let _filmM = null, _kraftM = null;
export function filmMaterial() {
  if (_filmM) return _filmM;
  const c = canvas(256, 256, (g, w, h) => {
    g.fillStyle = 'rgb(58,58,58)'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 64) { g.fillStyle = 'rgba(150,150,150,.55)'; g.fillRect(0, y, w, 30); g.fillStyle = 'rgba(220,220,220,.5)'; g.fillRect(0, y + 29, w, 2); } // solapes de la espiral (0,25 m)
    for (let i = 0; i < 70; i++) { const y = hash(i) * h * 1.6, a = 0.15 + hash(i + 3) * 0.35; g.strokeStyle = `rgba(${hash(i + 1) < 0.6 ? '230,230,230' : '20,20,20'},${a})`; g.lineWidth = 1 + hash(i + 2) * 3; g.beginPath(); g.moveTo(-10, y); g.bezierCurveTo(w * 0.3, y - 20, w * 0.6, y - 50, w + 10, y - 90); g.stroke(); }
  });
  _filmM = new THREE.MeshStandardMaterial({ color: 0xeef6ff, alphaMap: tex(c, [1, 1], false), transparent: true, opacity: 1, roughness: 0.07, metalness: 0.05, envMapIntensity: 2.2, depthWrite: false });
  return _filmM;
}
export function kraftMaterial() {
  if (_kraftM) return _kraftM;
  const c = canvas(256, 256, (g, w, h) => { g.fillStyle = '#b48c58'; g.fillRect(0, 0, w, h); for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${hash(i) < 0.5 ? '230,200,150' : '80,55,25'},${0.1 + hash(i + 1) * 0.2})`; g.fillRect(hash(i + 2) * w, hash(i + 3) * h, 1 + hash(i + 4) * 6, 1); } g.fillStyle = 'rgba(60,40,20,.5)'; g.font = 'bold 20px sans-serif'; g.fillText('EDGE PROTECTOR 50×50', 10, 120); });
  _kraftM = new THREE.MeshStandardMaterial({ map: tex(c), normalMap: normalFrom(c, 1.2), normalScale: new V2(0.4, 0.4), roughness: 0.93, side: THREE.DoubleSide });
  return _kraftM;
}

// ================================================================ ENVOLVENTE DE CÁMARA
// Panel sándwich (cara interior): micro-nervado vertical cada ~6 cm y junta machihembrada cada pw (normal map + línea
// de sombra en el color). Un tile = un panel completo de ancho pw. Usar con wallGeo(), cuya UV ya va en «paneles».
const _pm = new Map();
export function panelMaterial({ color = 0xf1f4f6, ribs = 20, seam = true, roughness = 0.38 } = {}) {
  const k = `${color}|${ribs}|${seam}|${roughness}`; if (_pm.has(k)) return _pm.get(k);
  const W = 1024, Hh = 8, rib = (x) => { const p = (x / W) * ribs, f = p - Math.floor(p); return f < 0.12 ? 1 - Math.abs(f - 0.06) / 0.06 * 0.3 : 0.7; };
  const hc = canvas(W, Hh, (g) => { for (let x = 0; x < W; x++) { let v = rib(x) * 140 + 60; if (seam && (x < 6 || x > W - 7)) v = 10 + Math.min(x, W - 1 - x) * 18; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, Hh); } });
  const cc = canvas(W, Hh, (g) => { g.fillStyle = '#fff'; g.fillRect(0, 0, W, Hh); if (seam) { g.fillStyle = '#7d8893'; g.fillRect(0, 0, 3, Hh); g.fillRect(W - 3, 0, 3, Hh); g.fillStyle = 'rgba(80,90,100,.25)'; g.fillRect(3, 0, 6, Hh); } });
  const rough = tex(noiseCanvas(128, 128, 4, 11, 3), [1, 1], false);
  const m = new THREE.MeshStandardMaterial({ color, map: tex(cc), normalMap: normalFrom(hc, 3), normalScale: new V2(0.9, 0.9), roughness, roughnessMap: rough, metalness: 0.12 });
  _pm.set(k, m); return m;
}
// Paño de panel L×H en el plano XY mirando a +Z, base en y = 0, centrado en X; UV en unidades de panel (pw) → repeat 1.
export const wallGeo = (L, H, pw = 1.2) => cached(`wl${L}|${H}|${pw}`, () => { const g = new THREE.PlaneGeometry(L, H, 1, 1); g.translate(0, H / 2, 0); const u = g.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * L / pw, u.getY(i) * H / pw); return g; });
// Techo L×W (plano XZ mirando hacia −Y, origen en el centro); juntas cada pw a lo largo de X.
export const ceilingGeo = (L, W, pw = 1.2) => cached(`cl${L}|${W}|${pw}`, () => { const g = wallGeo(L, W, pw).clone(); g.translate(0, -W / 2, 0); g.rotateX(PI / 2); return g; });
// Zócalo sanitario (bordillo 150 mm con media caña R50 al piso y canto superior biselado). Eje X, centrado;
// cara posterior en z = 0 (contra el panel), avanza hacia +Z; base en y = 0. UV: u = arco del perfil, v = x.
export const coveGeo = (len) => cached(`cv${len}`, () => {
  const P = [[0, 0], [0.15, 0]]; for (let k = 1; k < 6; k++) { const a = -PI / 2 - (k / 6) * (PI / 2); P.push([0.15 + 0.05 * Math.cos(a), 0.05 + 0.05 * Math.sin(a)]); }
  P.push([0.1, 0.05], [0.1, 0.132], [0.096, 0.142], [0.084, 0.15], [0, 0.15]);
  const g = prism(new GB(), P.map(([z, y]) => [-z, y]), len, { smooth: 0.85 }).geo(); g.applyMatrix4(T(0, 0, 0, 0, PI / 2)); return g;
});
// Tapa de cerradura excéntrica (cam-lock) Ø54 en PVC con domo y tapón central. Eje +Y, base en y = 0 (sobre el panel).
export const camLockGeo = () => cached('cam', () => lathe2([[0.027, 0], [0.027, 0.0012], [0.024, 0.0042], [0.016, 0.0055], [0.0072, 0.0052], [0.0006, 0.0046]], 10));
const lathe2 = (pts, seg) => { const g = new THREE.LatheGeometry(pts.map(([r, y]) => new V2(r, y)), seg); return mg([[g]]); };
// Colgador de techo: arandela tipo hongo Ø80 bajo el panel + varilla roscada M10 de longitud len hacia +Y. Origen en la cara inferior del techo.
export const hangerGeo = (len = 0.35) => cached(`hg${len}`, () => mg([
  [new THREE.LatheGeometry([[0.001, -0.012], [0.012, -0.012], [0.014, -0.009], [0.04, -0.004], [0.04, 0]].map(([r, y]) => new V2(r, y)), 14)],
  [hexBolt(0.009, 0.008, false), T(0, -0.02, 0)], [new THREE.CylinderGeometry(0.005, 0.005, len, 6, 1, true), T(0, len / 2, 0)],
]));
// Sumidero sifónico de acero inoxidable s×s con marco y rejilla ranurada. Origen en la superficie del piso.
export const drainGeo = (s = 0.3) => cached(`dr${s}`, () => {
  const G = new GB(), f = 0.022, hy = 0.004;
  G.rgb = [0.08, 0.09, 0.1]; G.poly([new V3(-s / 2, 0.0012, -s / 2), new V3(s / 2, 0.0012, -s / 2), new V3(s / 2, 0.0012, s / 2), new V3(-s / 2, 0.0012, s / 2)], new V3(0, 1, 0), [[0, 0], [1, 0], [1, 1], [0, 1]]);
  G.rgb = [1, 1, 1];
  for (const sg of [-1, 1]) { cbox(G, s, hy, f, 0.0015, boxUV, [0, hy / 2, sg * (s / 2 - f / 2)]); cbox(G, f, hy, s - 2 * f, 0.0015, boxUV, [sg * (s / 2 - f / 2), hy / 2, 0]); }
  const nb = 11, inner = s - 2 * f; for (let i = 0; i < nb; i++) cbox(G, inner, 0.0035, 0.008, 0, boxUV, [0, 0.00175, -inner / 2 + (i + 0.5) * (inner / nb)]);
  cbox(G, 0.012, 0.0036, inner, 0, boxUV, [0, 0.0018, 0]);
  return G.geo();
});
// Banda antideslizante / línea pintada: plano len×w sobre el piso (y = 0.0015), a lo largo de X. UV u = x [m].
export const stripGeo = (len, w) => cached(`st${len}|${w}`, () => { const g = new THREE.PlaneGeometry(len, w); g.rotateX(-PI / 2); g.translate(0, 0.0015, 0); const u = g.attributes.uv; for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * len, u.getY(i)); return g; });

let _SH = null;
// Materiales de la envolvente: steel (inox con vertexColors), pvc, antiSlip (grano + bordes amarillos), paintYellow
// (línea gastada, alpha), paintWhite.
export function shellMaterials() {
  if (_SH) return _SH;
  const K = materials();
  const grit = canvas(256, 64, (g, w, h) => { g.fillStyle = '#2b2e32'; g.fillRect(0, 0, w, h); for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${hash(i) < 0.5 ? '200,205,210' : '0,0,0'},${0.3 + hash(i + 1) * 0.5})`; g.fillRect(hash(i + 2) * w, hash(i + 3) * h, 1 + hash(i + 4), 1 + hash(i + 5)); } g.fillStyle = '#e8b20f'; g.fillRect(0, 0, w, 5); g.fillRect(0, h - 5, w, 5); });
  const worn = canvas(256, 32, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 420; i++) { g.fillStyle = `rgba(0,0,0,${0.4 + hash(i) * 0.6})`; const x = hash(i + 1) * w, y = hash(i + 2) < 0.5 ? hash(i + 3) * 4 : h - hash(i + 3) * 4; g.fillRect(x, y - 1, 1 + hash(i + 4) * 4, 1 + hash(i + 5) * 3); } for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(0,0,0,${0.2 + hash(i + 9) * 0.5})`; g.beginPath(); g.ellipse(hash(i + 7) * w, hash(i + 8) * h, 2 + hash(i) * 6, 1 + hash(i) * 3, 0, 0, TAU); g.fill(); } });
  const wornT = tex(worn, [1, 1], false); wornT.repeat.set(0.5, 1);
  _SH = {
    steel: new THREE.MeshStandardMaterial({ color: 0xd2d8de, metalness: 0.85, roughness: 0.3, normalMap: K.brushedN, normalScale: new V2(0.25, 0.25), vertexColors: true }),
    pvc: new THREE.MeshStandardMaterial({ color: 0xeef1f4, roughness: 0.45, metalness: 0.02 }),
    camLock: new THREE.MeshStandardMaterial({ color: 0xd3dae0, roughness: 0.35, metalness: 0.02 }),
    antiSlip: new THREE.MeshStandardMaterial({ map: tex(grit, [4, 1]), normalMap: normalFrom(grit, 3, [4, 1]), roughness: 0.95 }),
    paintYellow: new THREE.MeshStandardMaterial({ color: 0xf0b90e, alphaMap: wornT, transparent: true, depthWrite: false, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 }),
    paintWhite: new THREE.MeshStandardMaterial({ color: 0xe8ecef, alphaMap: wornT, transparent: true, depthWrite: false, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 }),
  };
  return _SH;
}
// Piso de cámara: epoxi autonivelante con árido de cuarzo (antideslizante), juntas de losa cada 4 m, huellas de
// rodadura y desgaste (rugosidad más baja en zonas pulidas). Tile = 4 m; repeat = [L/4, W/4] para un plano L×W.
const _fm = new Map();
export function floorMaterial(L = 8, W = 8, { base = '#7c868f' } = {}) {
  const k = `${L}|${W}|${base}`; if (_fm.has(k)) return _fm.get(k);
  const S = 1024, dots = (g, alpha, light) => { for (let i = 0; i < 60000; i++) { const x = hash(i * 1.3) * S, y = hash(i * 2.7 + 1) * S, s = 1; g.fillStyle = light ? `rgba(${hash(i) < 0.5 ? '235,238,240' : '35,40,45'},${alpha * hash(i + 3)})` : `rgba(255,255,255,${0.15 + 0.3 * hash(i + 3)})`; g.fillRect(x, y, s, s); } };
  const tracks = (g, col, wdt) => { g.strokeStyle = col; for (let i = 0; i < 7; i++) { g.lineWidth = wdt * (0.6 + hash(i) * 0.8); g.beginPath(); const y = hash(i + 20) * S; g.moveTo(-20, y); g.bezierCurveTo(S * 0.3, y + (hash(i + 21) - 0.5) * 300, S * 0.7, y + (hash(i + 22) - 0.5) * 300, S + 20, y); g.stroke(); } };
  const col = canvas(S, S, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 30; i++) { const x = hash(i + 100) * S, y = hash(i + 200) * S, r = 80 + hash(i + 300) * 220, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${hash(i) < 0.5 ? '255,255,255' : '0,0,0'},.045)`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, S, S); }
    dots(g, 0.35, true); tracks(g, 'rgba(20,22,25,.10)', 26);
    g.fillStyle = 'rgba(25,28,32,.75)'; g.fillRect(0, 0, S, 3); g.fillRect(0, 0, 3, S);
  });
  const hm = canvas(S, S, (g) => { g.fillStyle = '#707070'; g.fillRect(0, 0, S, S); dots(g, 1, false); g.fillStyle = '#101010'; g.fillRect(0, 0, S, 3); g.fillRect(0, 0, 3, S); });
  const rg = canvas(S, S, (g) => { g.fillStyle = '#a6a6a6'; g.fillRect(0, 0, S, S); tracks(g, 'rgba(40,40,40,.35)', 40); });
  const rep = [L / 4, W / 4], m = new THREE.MeshStandardMaterial({ map: tex(col, rep), normalMap: normalFrom(hm, 1.5, rep), normalScale: new V2(0.3, 0.3), roughnessMap: tex(rg, rep, false), roughness: 0.75, metalness: 0.05 });
  _fm.set(k, m); return m;
}

// ================================================================ DEMO (banco de pruebas)
// Rack de 2 vanos × 3 niveles (piso + 2 largueros) con 6 pallets instanciados (tarima, 36 cartones tintados por
// temperatura, film, vestido), esquina de paneles con zócalo, cam-locks, colgadores, piso epoxi, sumidero y señalización.
export function demo(scene) {
  scene.traverse((o) => { if (o.isMesh && o.geometry?.parameters?.width === 60) o.visible = false; });
  const RM = makeRackMaterials(), SH = shellMaterials(), g = new THREE.Group(); scene.add(g);
  const M = (geo, mat, m, sh = true) => { const x = new THREE.Mesh(geo, mat); if (m) x.applyMatrix4(m); x.castShadow = x.receiveShadow = sh; g.add(x); return x; };
  const pitch = SLOT.pitch, depth = SLOT.palletD - 0.2, hU = 5.0, lv = [0, 1.78, 3.56], nB = 2, x0 = -pitch;
  // bastidores
  for (let f = 0; f <= nB; f++) {
    const x = x0 + f * pitch;
    for (const s of [-1, 1]) {
      const z = (s * depth) / 2, ry = s < 0 ? 0 : PI;
      M(uprightGeo(hU), RM.upright, T(x, 0.006, z, 0, ry)); M(basePlateGeo(), RM.galv, T(x, 0, z, 0, ry)); if (s < 0) M(protectorGeo(), RM.hazard, T(x, 0, z, 0, ry));
    }
    const y0 = 0.25, y1 = hU - 0.2, nd = 6;
    for (const y of [y0, y1]) M(braceGeo(depth), RM.brace, T(x, y, 0));
    for (let k = 0; k < nd; k++) { const ya = y0 + ((y1 - y0) * k) / nd, yb = y0 + ((y1 - y0) * (k + 1)) / nd, dz = (k % 2 ? -1 : 1) * depth; M(braceGeo(Math.hypot(depth, yb - ya)), RM.brace, T(x, (ya + yb) / 2, 0, Math.atan2(-(yb - ya), dz))); }
  }
  M(frameGuardGeo(depth), RM.hazard, T(x0, 0, 0)); M(loadSignGeo(), RM.sign, T(x0 - 0.05, 1.45, 0, 0, -PI / 2), false);
  // largueros y decks
  const dk = deckGeo(pitch - 0.1, depth + 0.1);
  for (let b = 0; b < nB; b++) { const xc = x0 + (b + 0.5) * pitch; for (const y of lv.slice(1)) { const yb = y - 0.055; for (const s of [-1, 1]) M(beamGeo(pitch), RM.beam, T(xc, yb, (s * depth) / 2, 0, s < 0 ? 0 : PI)); M(dk.mesh, RM.deck, T(xc, yb + 0.04, 0), false); M(dk.supports, RM.galv, T(xc, yb + 0.04, 0)); } }
  // pallets instanciados (como en scene3d): tarima, cartones (instanceColor), film y vestido
  const C = CARTON, cl = []; for (let l = 0; l < 6; l++) for (let ix = 0; ix < 2; ix++) for (let iz = 0; iz < 3; iz++) cl.push([(ix - 0.5) * 0.49, PAL_H + 0.004 + (l + 0.5) * 0.243, (iz - 1) * 0.4]);
  const stackH = 6 * 0.243, nP = nB * lv.length;
  const pal = new THREE.InstancedMesh(palletGeo(), palletMaterial(), nP), car = new THREE.InstancedMesh(cartonGeo(), cartonMaterial(), nP * cl.length);
  const film = new THREE.InstancedMesh(filmGeo(0.96, 1.18, stackH), filmMaterial(), nP), dress = new THREE.InstancedMesh(palletDressGeo(0.96, 1.18, stackH), kraftMaterial(), nP);
  const m4 = new THREE.Matrix4(), col = new THREE.Color(), heat = [[0.23, 0.45, 0.9], [0.1, 0.65, 0.75], [0.15, 0.7, 0.3], [0.9, 0.75, 0.15], [0.9, 0.45, 0.15], [0.85, 0.2, 0.2]];
  let n = 0;
  for (let b = 0; b < nB; b++) for (let k = 0; k < lv.length; k++, n++) {
    const bx = x0 + (b + 0.5) * pitch, by = lv[k] + (k ? 0.0005 : 0);
    m4.makeTranslation(bx, by, 0); pal.setMatrixAt(n, m4); film.setMatrixAt(n, m4); dress.setMatrixAt(n, m4);
    cl.forEach((c, i) => { m4.makeTranslation(bx + c[0], by + c[1], c[2]); car.setMatrixAt(n * cl.length + i, m4); const h = heat[(n + (i % 3 === 1 ? 1 : 0)) % heat.length], j = 0.9 + 0.12 * hash(n * 97 + i); car.setColorAt(n * cl.length + i, col.setRGB(0.55 + 0.45 * h[0] * j, 0.55 + 0.45 * h[1] * j, 0.55 + 0.45 * h[2] * j, THREE.SRGBColorSpace)); });
  }
  for (const im of [pal, car, dress]) { im.castShadow = im.receiveShadow = true; g.add(im); } g.add(film);
  // pallet suelto en el pasillo (para ver la tarima de cerca)
  const p2 = new THREE.Mesh(palletGeo(), palletMaterial()); p2.position.set(0.2, 0, -1.9); p2.rotation.y = 0.35; p2.castShadow = p2.receiveShadow = true; g.add(p2);
  const c2 = new THREE.Mesh(cartonGeo(), cartonMaterial()); c2.position.set(0.15, PAL_H + 0.12, -1.85); c2.rotation.y = 0.35; c2.castShadow = true; g.add(c2);
  // envolvente: pared trasera (z = 1.1) y lateral (x = 1.9), piso, zócalo, cam-locks, colgadores
  const zW = 1.1, xW = 1.9, Hw = 5.6, LW = 6, pm = panelMaterial();
  M(wallGeo(LW, Hw), pm, T(xW - LW / 2, 0, zW, 0, PI)); M(wallGeo(LW, Hw), pm, T(xW, 0, zW - LW / 2, 0, -PI / 2));
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), floorMaterial(8, 8)); fl.rotation.x = -PI / 2; fl.position.set(xW - 4, 0, zW - 4); fl.receiveShadow = true; g.add(fl);
  M(coveGeo(LW), SH.pvc, T(xW - LW / 2, 0, zW, 0, PI)); M(coveGeo(LW), SH.pvc, T(xW, 0, zW - LW / 2, 0, -PI / 2));
  for (let y = 0.9; y < Hw - 0.3; y += 1.2) for (let s = 1.2; s < LW; s += 1.2) { M(camLockGeo(), SH.camLock, T(xW - s, y, zW, -PI / 2), false); M(camLockGeo(), SH.camLock, T(xW, y, zW - s, 0, 0, PI / 2), false); }
  M(drainGeo(), SH.steel, T(0.9, 0, -2.6)); M(stripGeo(3.2, 0.1), SH.paintYellow, T(-0.05, 0, -0.78), false); M(stripGeo(2.5, 0.3), SH.antiSlip, T(-0.3, 0, -3.2, 0, 0.0), false);
  const cnt = { upright: tris(uprightGeo(hU)), beam: tris(beamGeo(pitch)), brace: tris(braceGeo(depth)), basePlate: tris(basePlateGeo()), protector: tris(protectorGeo()), pallet: tris(palletGeo()), carton: tris(cartonGeo()), film: tris(filmGeo(0.96, 1.18, stackH)), dress: tris(palletDressGeo(0.96, 1.18, stackH)), deck: tris(dk.mesh) + tris(dk.supports), guard: tris(frameGuardGeo(depth)), cove: tris(coveGeo(LW)), camLock: tris(camLockGeo()), drain: tris(drainGeo()), hanger: tris(hangerGeo()), sign: tris(loadSignGeo()) };
  console.log('TRIS ' + JSON.stringify(cnt)); window.__tris = cnt;
  return () => {};
}
