// KIT DE MODELADO Y ANIMACIÓN: geometría con bisel/redondeo, mapas normales procedurales, materiales PBR
// compartidos y utilidades de movimiento realista (resortes amortiguados, límites de aceleración, trayectorias suaves).
// Todo es procedural (sin assets externos). Unidades: metros, segundos, radianes. Eje Y hacia arriba.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export { THREE, mergeGeometries };
export const PI = Math.PI, TAU = Math.PI * 2;
const SRGB = THREE.SRGBColorSpace;

// ---------------------------------------------------------------- Geometría
const _cache = new Map();
const cached = (key, make) => { if (!_cache.has(key)) _cache.set(key, make()); return _cache.get(key); };

// Caja con aristas redondeadas (r = radio, seg = segmentos del redondeo). Centrada en el origen.
export const rbox = (w, h, d, r = 0.01, seg = 2) => cached(`rb${w}|${h}|${d}|${r}|${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)));

// Extrusión de un perfil 2D (pts en el plano XY) a lo largo de Z, con bisel opcional; centrada en Z.
export function extrude(pts, len, bevel = 0, curveSeg = 2) {
  const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: curveSeg, curveSegments: 6 });
  g.translate(0, 0, -len / 2); g.computeVertexNormals(); return g;
}
// Perfil con agujeros (holes = lista de polígonos).
export function extrudeHoles(pts, holes, len, bevel = 0) {
  const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  holes.forEach((h) => sh.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y)))));
  const g = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2 });
  g.translate(0, 0, -len / 2); return g;
}
// Rectángulo redondeado como lista de puntos (para extrusiones).
export function roundRectPts(w, h, r, seg = 4) {
  const pts = [], cs = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, PI / 2], [-w / 2 + r, -h / 2 + r, PI], [w / 2 - r, -h / 2 + r, 1.5 * PI]];
  for (const [cx, cy, a0] of cs) for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * (PI / 2); pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return pts;
}
// Sólido de revolución alrededor de Y: pts = [[radio, y], ...].
export const lathe = (pts, seg = 32) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
// Tubo por puntos 3D con radio r (codos suaves con CatmullRom de tensión baja).
export function tube(pts, r, radial = 10, tension = 0.0) {
  const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', tension);
  return new THREE.TubeGeometry(c, Math.max(8, pts.length * 12), r, radial, false);
}
// Neumático con banda de rodadura en relieve (eje = X). r = radio exterior, w = ancho, rim = radio del aro.
export function tire(r, w, rim = r * 0.62, treads = 28) {
  return cached(`tire${r}|${w}|${rim}|${treads}`, () => {
    const p = [];
    const sw = w / 2, k = 0.18 * w;
    p.push([rim, -sw * 0.9], [r - k, -sw], [r - k * 0.35, -sw * 0.92], [r, -sw * 0.6], [r, sw * 0.6], [r - k * 0.35, sw * 0.92], [r - k, sw], [rim, sw * 0.9]);
    const g = lathe(p, 48); g.rotateZ(PI / 2);
    const lugs = [], lg = new THREE.BoxGeometry(w * 0.34, r * 0.05, r * 0.11);
    for (let i = 0; i < treads; i++) for (const s of [-1, 1]) {
      const a = (i / treads) * TAU + (s > 0 ? PI / treads : 0), m = new THREE.Matrix4().makeRotationX(a).multiply(new THREE.Matrix4().makeTranslation(s * w * 0.2, r + r * 0.015, 0).multiply(new THREE.Matrix4().makeRotationZ(s * 0.35)));
      const c = lg.clone(); c.applyMatrix4(m); lugs.push(c);
    }
    return mergeGeometries([g.toNonIndexed(), ...lugs.map((x) => x.toNonIndexed())]);
  });
}
// Llanta (aro) con disco, buje y pernos (eje = X).
export function rim(r, w, bolts = 6) {
  return cached(`rim${r}|${w}|${bolts}`, () => {
    const g = lathe([[0.001, -w * 0.42], [r * 0.3, -w * 0.42], [r * 0.32, -w * 0.3], [r * 0.85, -w * 0.32], [r, -w * 0.45], [r, w * 0.45], [r * 0.9, w * 0.4], [r * 0.88, -w * 0.18], [r * 0.35, -w * 0.2], [r * 0.25, -w * 0.48], [0.001, -w * 0.48]], 32);
    g.rotateZ(PI / 2);
    const parts = [g.toNonIndexed()], b = new THREE.CylinderGeometry(r * 0.05, r * 0.05, w * 0.12, 8); b.rotateZ(PI / 2);
    for (let i = 0; i < bolts; i++) { const a = (i / bolts) * TAU, c = b.clone(); c.translate(-w * 0.5, Math.cos(a) * r * 0.22, Math.sin(a) * r * 0.22); parts.push(c.toNonIndexed()); }
    return mergeGeometries(parts);
  });
}
// Fusiona [geometría, matriz] en una sola geometría (menos draw calls).
export function mergeT(list) {
  return mergeGeometries(list.map(([g, m]) => { const c = (g.index ? g.toNonIndexed() : g.clone()); if (m) c.applyMatrix4(m); ['uv1', 'uv2'].forEach((a) => c.deleteAttribute?.(a)); return c; }), false);
}
export const T = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

// ---------------------------------------------------------------- Texturas procedurales
export function canvas(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; }
export function tex(c, repeat = [1, 1], srgb = true) {
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); t.anisotropy = 8;
  if (srgb) t.colorSpace = SRGB; return t;
}
// Mapa normal a partir de un mapa de alturas en escala de grises (canvas). strength ≈ 1–6.
export function normalFrom(hc, strength = 2, repeat = [1, 1]) {
  const w = hc.width, h = hc.height, src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas'); out.width = w; out.height = h; const og = out.getContext('2d'), img = og.createImageData(w, h), d = img.data;
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength, l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    d[i] = ((-dx / l) * 0.5 + 0.5) * 255; d[i + 1] = ((dy / l) * 0.5 + 0.5) * 255; d[i + 2] = ((1 / l) * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  og.putImageData(img, 0, 0); return tex(out, repeat, false);
}
// Ruido de valor determinista (para manchas, cepillado, desgaste).
export const hash = (n) => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };
export function noiseCanvas(w, h, scale = 8, seed = 1, octaves = 3) {
  return canvas(w, h, (g) => {
    const img = g.createImageData(w, h), d = img.data;
    const v = (x, y, s) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, r = (a, b) => hash(((a % s) + s) % s * 157 + (((b % s) + s) % s) * 311 + seed * 13);
      const u = fx * fx * (3 - 2 * fx), q = fy * fy * (3 - 2 * fy); return (r(xi, yi) * (1 - u) + r(xi + 1, yi) * u) * (1 - q) + (r(xi, yi + 1) * (1 - u) + r(xi + 1, yi + 1) * u) * q; };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let a = 0, amp = 1, tot = 0, s = scale;
      for (let o = 0; o < octaves; o++) { a += v((x / w) * s, (y / h) * s, s) * amp; tot += amp; amp *= 0.5; s *= 2; }
      const c = (a / tot) * 255, i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = c; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
}

// ---------------------------------------------------------------- Materiales PBR compartidos
let _M = null;
export function materials() {
  if (_M) return _M;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const brushed = canvas(256, 256, (g, w, h) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${hash(i) < 0.5 ? 255 : 0},${hash(i) < 0.5 ? 255 : 0},${hash(i) < 0.5 ? 255 : 0},${0.05 + hash(i + 9) * 0.08})`; g.fillRect(0, hash(i + 3) * h, w, 1); } });
  const rough = noiseCanvas(128, 128, 6, 3, 4);
  const roughT = tex(rough, [2, 2], false), brushedN = normalFrom(brushed, 1.2, [1, 1]);
  const tread = canvas(64, 64, (g, w, h) => { g.fillStyle = '#777'; g.fillRect(0, 0, w, h); g.fillStyle = '#222'; for (let i = 0; i < 8; i++) g.fillRect(0, i * 8 + 2, w, 3); });
  _M = {
    paintYellow: std({ color: 0xe8a910, roughness: 0.42, metalness: 0.15, roughnessMap: roughT }),
    paintBlue: std({ color: 0x1f5fa8, roughness: 0.45, metalness: 0.2, roughnessMap: roughT }),
    paintRed: std({ color: 0xb3261e, roughness: 0.45, metalness: 0.15 }),
    paintWhite: std({ color: 0xe9edf1, roughness: 0.35, metalness: 0.1, roughnessMap: roughT }),
    paintGrey: std({ color: 0x4a525c, roughness: 0.55, metalness: 0.25, roughnessMap: roughT }),
    paintDark: std({ color: 0x23282e, roughness: 0.6, metalness: 0.2 }),
    paintOrange: std({ color: 0xe06a1b, roughness: 0.5, metalness: 0.2 }),
    steel: std({ color: 0xa8b2bd, roughness: 0.32, metalness: 0.85, normalMap: brushedN, normalScale: new THREE.Vector2(0.25, 0.25) }),
    galv: std({ color: 0xb7c0c9, roughness: 0.45, metalness: 0.8, roughnessMap: roughT }),
    chrome: std({ color: 0xe8edf2, roughness: 0.08, metalness: 1 }),
    alu: std({ color: 0xc9d0d8, roughness: 0.3, metalness: 0.9, normalMap: brushedN, normalScale: new THREE.Vector2(0.3, 0.3) }),
    rubber: std({ color: 0x17191c, roughness: 0.92, metalness: 0, normalMap: normalFrom(tread, 3, [6, 1]) }),
    plastic: std({ color: 0x2a2f36, roughness: 0.55, metalness: 0 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xbfd4e6, roughness: 0.05, metalness: 0, transmission: 0.0, transparent: true, opacity: 0.32, envMapIntensity: 1.5 }),
    lensAmber: new THREE.MeshStandardMaterial({ color: 0xffa31a, emissive: 0xff8c00, emissiveIntensity: 0.4, roughness: 0.2 }),
    lensRed: new THREE.MeshStandardMaterial({ color: 0xc62828, emissive: 0x8a0000, emissiveIntensity: 0.3, roughness: 0.2 }),
    lensWhite: new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xfff2c8, emissiveIntensity: 0.6, roughness: 0.15 }),
    copper: std({ color: 0xb87333, roughness: 0.3, metalness: 0.9 }),
    skin: std({ color: 0xc8956a, roughness: 0.7, metalness: 0 }),
    fabricDark: std({ color: 0x27323f, roughness: 0.95, metalness: 0 }),
    hiVis: std({ color: 0xd4f03a, roughness: 0.8, metalness: 0, emissive: 0x2a3300, emissiveIntensity: 0.25 }),
    reflective: std({ color: 0xe6edf3, roughness: 0.2, metalness: 0.6 }),
    roughT, brushedN,
  };
  return _M;
}
export const shadowAll = (o, cast = true, recv = true) => { o.traverse((m) => { if (m.isMesh) { m.castShadow = cast; m.receiveShadow = recv; } }); return o; };
export const add = (parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };

// ---------------------------------------------------------------- Movimiento realista
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const smootherstep = (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
export const wrapAngle = (a) => { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; };
// Filtro de primer orden (inercia): v → objetivo con constante de tiempo tau [s].
export const lag = (v, target, tau, dt) => v + (target - v) * (1 - Math.exp(-dt / Math.max(1e-4, tau)));
// Resorte críticamente amortiguado (SmoothDamp). Devuelve [valor, velocidad]. smoothTime ≈ tiempo de llegada.
export function smoothDamp(cur, target, vel, smoothTime, dt, maxSpeed = Infinity) {
  const st = Math.max(1e-4, smoothTime), om = 2 / st, x = om * dt, exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  let ch = cur - target; const maxC = maxSpeed * st; ch = clamp(ch, -maxC, maxC);
  const tgt = cur - ch, tmp = (vel + om * ch) * dt; let nv = (vel - om * tmp) * exp, out = tgt + (ch + tmp) * exp;
  if ((target - cur > 0) === (out > target)) { out = target; nv = (out - target) / Math.max(dt, 1e-6); }
  return [out, nv];
}
// Resorte-amortiguador genérico (masa unitaria): k rigidez, c amortiguamiento. Devuelve [x, v].
export const spring = (x, v, target, k, c, dt) => { const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n; for (let i = 0; i < n; i++) { v += (-k * (x - target) - c * v) * h; x += v * h; } return [x, v]; };
// Perfil de velocidad con aceleración/frenado limitados hacia una distancia restante (trapezoidal).
export function approach(v, remaining, vmax, acc, dec, dt) {
  const vStop = Math.sqrt(Math.max(0, 2 * dec * Math.max(0, remaining)));
  const target = Math.min(vmax, vStop);
  return v < target ? Math.min(target, v + acc * dt) : Math.max(target, v - dec * dt);
}
// Trayectoria suave por puntos 2D (x,z) con esquinas redondeadas de radio r; muestreo por longitud de arco.
export class Path2 {
  constructor(pts, r = 1.2) {
    const P = pts.map(([x, z]) => new THREE.Vector2(x, z)), cp = new THREE.CurvePath();
    let prev = P[0].clone();
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i], c = P[i + 1];
      if (!c) { if (prev.distanceTo(b) > 1e-4) cp.add(new THREE.LineCurve(prev.clone(), b.clone())); break; }
      const d1 = b.clone().sub(a), d2 = c.clone().sub(b), l1 = d1.length(), l2 = d2.length();
      const rr = Math.min(r, l1 * 0.45, l2 * 0.45), p1 = b.clone().sub(d1.normalize().multiplyScalar(rr)), p2 = b.clone().add(d2.normalize().multiplyScalar(rr));
      if (prev.distanceTo(p1) > 1e-4) cp.add(new THREE.LineCurve(prev.clone(), p1));
      if (rr > 1e-3) cp.add(new THREE.QuadraticBezierCurve(p1, b.clone(), p2));
      prev = p2;
    }
    this.curve = cp; this.length = cp.curves.length ? cp.getLength() : 0;
  }
  at(s) { // posición y rumbo a la distancia s
    if (!this.length) return { x: 0, z: 0, heading: 0, curv: 0 };
    const u = clamp(s / this.length, 0, 1), p = this.curve.getPointAt(u), t = this.curve.getTangentAt(u);
    const u2 = clamp(u + 0.02, 0, 1), t2 = this.curve.getTangentAt(u2), ds = Math.max(1e-3, (u2 - u) * this.length);
    return { x: p.x, z: p.y, heading: Math.atan2(t.y, t.x), curv: wrapAngle(Math.atan2(t2.y, t2.x) - Math.atan2(t.y, t.x)) / ds };
  }
}

// Demo del kit (banco de pruebas): neumático, llanta, caja redondeada y una trayectoria recorrida con perfil trapezoidal.
export function demo(scene) {
  const M = materials(), g = new THREE.Group(); scene.add(g);
  add(g, tire(0.35, 0.22), M.rubber, -1, 0.35, 0); add(g, rim(0.22, 0.2), M.paintGrey, -1, 0.35, 0);
  add(g, rbox(0.8, 0.5, 0.6, 0.06, 3), M.paintYellow, 0.5, 0.25, 0);
  const path = new Path2([[-3, -2], [2, -2], [2, 2], [-2, 2]], 1.0), dot = add(g, rbox(0.4, 0.2, 0.25, 0.04), M.paintBlue, 0, 0.1, 0);
  let s = 0, v = 0;
  return (dt) => { v = approach(v, path.length - s, 1.6, 0.8, 1.0, dt); s += v * dt; if (s >= path.length - 1e-3) { s = 0; v = 0; } const p = path.at(s); dot.position.set(p.x, 0.1, p.z); dot.rotation.y = -p.heading; };
}
