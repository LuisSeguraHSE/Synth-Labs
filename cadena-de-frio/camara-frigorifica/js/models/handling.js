// MANUTENCIÓN DE PALLETS: transelevador (AS/RS) de pasillo estrecho con horquillas telescópicas, transpaleta manual y
// estación de entrega P&D. Los pasillos de la cámara miden ~1,5 m entre caras de pallet y la franja de maniobra junto a
// la puerta ~1,3 m: ningún montacargas rígido puede girar ahí. Por eso el montacargas deja cada pallet en la estación P&D
// (frente a la puerta) y un transelevador por pasillo lo toma lateralmente y lo ubica en el rack (como en una cámara
// automatizada real). Convenciones: metros, Y arriba.
//  · Transelevador: origen = suelo bajo el CENTRO DE LA CARGA; recorre su pasillo según X; el mástil queda en +X de la
//    carga; las horquillas telescópicas salen hacia ±Z (setFork(e) con e = desplazamiento del centro de la carga).
//    rig.loadAnchor: base del pallet (cara superior de horquilla − PICK.under) → matrixWorld para dibujar la carga.
//  · Transpaleta: origen = suelo bajo el centro del pallet cargado; horquillas hacia +X, timón en −X.
//  · Estación P&D: origen = suelo bajo el centro del pallet; soporte a h = top (0,15 m, como la simulación).
import * as S from './storage.js';
import { THREE, PI, TAU, rbox, extrude, roundRectPts, lathe, mergeT, T, canvas, tex, materials, clamp, lag, spring, approach, hash } from './kit.js';

// Las horquillas entran en las aberturas de la tarima: la cara superior de la horquilla queda 0,095 m sobre la base del pallet.
export const PICK = { under: 0.095 };
const V3 = THREE.Vector3;
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r, h, s = 12, r2 = r) => new THREE.CylinderGeometry(r, r2, h, s);
// Acumulador por material → una malla por material (pocas draw calls)
class Bk {
  constructor() { this.m = new Map(); }
  put(mat, geo, m) { if (!this.m.has(mat)) this.m.set(mat, []); this.m.get(mat).push([geo, m || null]); return this; }
  flush(parent, cast = true) { const out = []; for (const [mat, l] of this.m) { const me = new THREE.Mesh(mergeT(l), mat); me.castShadow = cast; me.receiveShadow = true; parent.add(me); out.push(me); } this.m.clear(); return out; }
}
// Perfil I (viga) a lo largo de X: ancho de ala b, alto h, espesores tf/tw
function ibeam(len, b, h, tf, tw) {
  const p = [[-b / 2, -h / 2], [b / 2, -h / 2], [b / 2, -h / 2 + tf], [tw / 2, -h / 2 + tf], [tw / 2, h / 2 - tf], [b / 2, h / 2 - tf], [b / 2, h / 2], [-b / 2, h / 2], [-b / 2, h / 2 - tf], [-tw / 2, h / 2 - tf], [-tw / 2, -h / 2 + tf], [-b / 2, -h / 2 + tf]];
  const g = extrude(p.map(([z, y]) => [z, y]), len, 0); g.rotateY(PI / 2); return g; // perfil (z,y) extruido según X
}

let _HM = null;
function hmats() {
  if (_HM) return _HM;
  const K = materials(), std = (o) => new THREE.MeshStandardMaterial(o);
  const warn = tex(canvas(256, 64, (g, w, h) => { g.fillStyle = '#f0b70d'; g.fillRect(0, 0, w, h); g.fillStyle = '#17181a'; for (let x = -h; x < w + h; x += 48) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 24, h); g.lineTo(x + 24 + h, 0); g.lineTo(x + h, 0); g.fill(); } }));
  const panel = tex(canvas(256, 256, (g, w, h) => {
    g.fillStyle = '#d9dee3'; g.fillRect(0, 0, w, h); g.strokeStyle = '#8b939c'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = '#0d1a26'; g.fillRect(40, 30, 176, 86); g.fillStyle = '#3cd070'; g.font = 'bold 22px monospace'; g.fillText('SRM-0' + 1, 54, 62); g.fillStyle = '#9fe3ff'; g.font = '16px monospace'; g.fillText('AUTO  X 0.00', 54, 90);
    for (const [x, c] of [[70, '#0ca30c'], [128, '#f2b90f'], [186, '#c62828']]) { g.fillStyle = '#222'; g.beginPath(); g.arc(x, 160, 18, 0, TAU); g.fill(); g.fillStyle = c; g.beginPath(); g.arc(x, 160, 12, 0, TAU); g.fill(); }
    g.fillStyle = '#f2b90f'; g.beginPath(); g.moveTo(128, 196); g.lineTo(150, 236); g.lineTo(106, 236); g.closePath(); g.fill(); g.fillStyle = '#111'; g.font = 'bold 26px sans-serif'; g.fillText('!', 122, 232);
  }));
  _HM = {
    frame: std({ color: 0x2b5f9e, roughness: 0.45, metalness: 0.35, roughnessMap: K.roughT }),          // azul RAL 5010
    orange: std({ color: 0xe2611a, roughness: 0.45, metalness: 0.3, roughnessMap: K.roughT }),
    dark: K.paintDark, galv: K.galv, steel: K.steel, rubber: K.rubber, yellow: K.paintYellow, grey: K.paintGrey, chrome: K.chrome, plastic: K.plastic, red: K.paintRed,
    warn: std({ map: warn, roughness: 0.5, metalness: 0.1 }), panel: std({ map: panel, roughness: 0.4, metalness: 0.1 }),
    beacon: new THREE.MeshStandardMaterial({ color: 0xffa31a, emissive: 0xff8c00, emissiveIntensity: 0.2, roughness: 0.2, transparent: true, opacity: 0.9 }),
    led: new THREE.MeshStandardMaterial({ color: 0x103018, emissive: 0x20ff40, emissiveIntensity: 1.2 }),
    rail: std({ color: 0x8a939c, roughness: 0.35, metalness: 0.85 }),
  };
  return _HM;
}

// ================================================================ TRANSELEVADOR (stacker crane) de un mástil
// o: { H = altura libre de la cámara (techo), mastX = 0.78 (mástil respecto del centro de carga), stroke = 1.9 (alcance
// telescópico máx.), tag }. Devuelve { group, rig, rails(len, x0) → Group estático (riel de piso, riel guía superior, topes) }.
export function createStackerCrane(o = {}) {
  const H = o.H ?? 6, MX = o.mastX ?? 0.84, M = hmats(), g = new THREE.Group(); g.name = 'transelevador';
  const yT = H - 0.16;                         // eje del riel guía superior
  const sway = new THREE.Group(); g.add(sway); // el mástil cabecea levemente con las aceleraciones (resorte)
  const b = new Bk();
  // Carro inferior: viga cajón con testeros, ruedas sobre el riel, motorreductor y armario eléctrico
  b.put(M.frame, rbox(1.0, 0.3, 0.34, 0.02, 2), T(MX + 0.13, 0.27, 0));
  for (const x of [MX - 0.32, MX + 0.58]) { b.put(M.frame, rbox(0.2, 0.36, 0.4, 0.02, 2), T(x, 0.24, 0)); b.put(M.yellow, rbox(0.06, 0.1, 0.12, 0.02, 1), T(x + (x < MX ? -0.13 : 0.13), 0.16, 0)); } // testeros con topes de goma pintados
  b.put(M.dark, rbox(0.3, 0.24, 0.2, 0.02, 2), T(MX + 0.42, 0.53, -0.08)).put(M.grey, cyl(0.08, 0.22, 18).rotateX(PI / 2), T(MX + 0.42, 0.52, 0.12)); // motorreductor de traslación
  b.put(M.grey, rbox(0.34, 1.0, 0.3, 0.015, 2), T(MX + 0.33, 1.0, 0.0)).put(M.panel, new THREE.PlaneGeometry(0.26, 0.26).rotateY(PI / 2), T(MX + 0.501, 1.2, 0));
  b.put(M.dark, box(0.04, 0.5, 0.012), T(MX + 0.502, 0.85, 0.11)); // manilla del armario
  // Mástil (cajón 300×220) con escalera de mantenimiento y línea de vida
  const mh = yT - 0.5 - 0.3;
  b.put(M.frame, rbox(0.3, mh, 0.22, 0.012, 2), T(MX, 0.42 + mh / 2, 0));
  for (const s of [-1, 1]) b.put(M.galv, box(0.05, mh, 0.03), T(MX - 0.175, 0.42 + mh / 2, s * 0.08)); // perfiles guía del carro de elevación
  const rungs = []; for (let y = 0.7; y < yT - 0.6; y += 0.28) rungs.push([cyl(0.012, 0.36, 8).rotateX(PI / 2), T(MX + 0.27, y, 0)]);
  for (const s of [-1, 1]) b.put(M.galv, box(0.03, mh - 0.3, 0.03), T(MX + 0.27, 0.42 + (mh - 0.3) / 2 + 0.15, s * 0.18));
  rungs.forEach(([gg, m]) => b.put(M.galv, gg, m));
  for (let y = 2.2; y < yT - 0.6; y += 0.7) for (const s of [-1, 1]) b.put(M.galv, box(0.32, 0.025, 0.025), T(MX + 0.4, y, s * 0.2)); // aros de la jaula de escalera
  // Cabezal superior con rodillos guía que abrazan el riel
  b.put(M.frame, rbox(0.62, 0.16, 0.26, 0.015, 2), T(MX, yT - 0.24, 0));
  for (const x of [MX - 0.24, MX + 0.24]) for (const s of [-1, 1]) b.put(M.dark, cyl(0.04, 0.05, 14), T(x, yT - 0.08, s * 0.07));
  b.put(M.grey, rbox(0.2, 0.12, 0.14, 0.01, 1), T(MX, yT - 0.38, 0)); // polea de reenvío del cable de elevación
  b.flush(sway);
  // Baliza giratoria (ámbar) sobre el armario
  const bea = new THREE.Mesh(cyl(0.045, 0.09, 16), M.beacon.clone()); bea.position.set(MX + 0.33, 1.55, 0); sway.add(bea);
  // Ruedas de traslación (giran con el avance)
  const wheels = []; for (const x of [MX - 0.32, MX + 0.58]) { const w = new THREE.Mesh(cyl(0.125, 0.07, 20).rotateX(PI / 2), M.dark); w.position.set(x, 0.13, 0); g.add(w); wheels.push(w); }
  // Carro de elevación: guías sobre el mástil + bastidor de la plataforma (cantiléver hacia −X) + horquillas telescópicas
  const lift = new THREE.Group(); sway.add(lift);
  const c = new Bk(), fy = 0; // y = 0 del grupo «lift» = cara superior de la horquilla retraída
  c.put(M.frame, rbox(0.16, 0.9, 0.3, 0.012, 2), T(MX - 0.24, 0.32, 0));                              // patines sobre el mástil
  for (const s of [-1, 1]) c.put(M.frame, rbox(1.36, 0.12, 0.08, 0.01, 2), T(-0.01, fy - 0.12, s * 0.38)); // largueros del bastidor
  for (const x of [-0.62, 0.0, 0.6]) c.put(M.frame, rbox(0.08, 0.1, 0.84, 0.01, 2), T(x, fy - 0.13, 0));
  for (const s of [-1, 1]) for (const x of [-0.62, 0.6]) c.put(M.yellow, rbox(0.05, 0.5, 0.05, 0.008, 1), T(x, fy + 0.18, s * 0.38)); // topes extremos de la plataforma
  for (const x of [-0.62, 0.6]) c.put(M.yellow, rbox(0.04, 0.04, 0.8, 0.008, 1), T(x, fy + 0.42, 0));
  c.put(M.warn, box(0.004, 0.12, 0.8), T(-0.66, fy - 0.12, 0));
  for (const x of [-0.25, 0.25]) c.put(M.galv, box(0.13, 0.05, 1.1), T(x, fy - 0.05, 0));                // horquilla base (fija)
  c.put(M.dark, rbox(0.12, 0.14, 0.12, 0.01, 1), T(0.36, fy - 0.12, 0.3)).put(M.grey, cyl(0.05, 0.14, 14).rotateZ(PI / 2), T(0.36, fy - 0.12, 0.08)); // accionamiento de horquillas
  c.put(M.dark, box(0.1, 0.12, 0.1), T(0.0, fy - 0.07, -0.47)).put(M.led, box(0.01, 0.02, 0.02), T(-0.051, fy - 0.05, -0.47)); // fotocélulas de detección de carga
  c.put(M.dark, box(0.1, 0.12, 0.1), T(0.0, fy - 0.07, 0.47)).put(M.led, box(0.01, 0.02, 0.02), T(-0.051, fy - 0.05, 0.47));
  c.flush(lift);
  const mid = new THREE.Group(), top = new THREE.Group(); lift.add(mid); mid.add(top);
  const fm = new Bk(); for (const x of [-0.25, 0.25]) fm.put(M.steel, box(0.11, 0.035, 1.1), T(x, fy - 0.0125, 0)); fm.flush(mid);
  const ft = new Bk(); for (const x of [-0.25, 0.25]) { ft.put(M.galv, box(0.12, 0.03, 1.1), T(x, fy + 0.02 - 0.015, 0)); ft.put(M.rubber, box(0.1, 0.006, 0.9), T(x, fy + 0.033, 0)); } ft.flush(top);
  const loadAnchor = new THREE.Object3D(); loadAnchor.position.set(0, fy + 0.035 - PICK.under, 0); top.add(loadAnchor);
  // Cables de elevación (de la polea superior al carro): se estiran con la altura
  const cabM = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.5, metalness: 0.8 }), cables = [];
  for (const s of [-1, 1]) { const k = new THREE.Mesh(cyl(0.006, 1, 6), cabM); k.position.set(MX - 0.12, 0, s * 0.05); sway.add(k); cables.push(k); }
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  bea.castShadow = false;

  // Estructura fija del pasillo (riel de piso, riel guía superior con colgadores al techo, topes finales)
  function rails(len, x0) {
    const r = new THREE.Group(), k = new Bk(), xc = x0 + len / 2;
    k.put(M.rail, ibeam(len, 0.1, 0.12, 0.012, 0.012), T(xc, 0.06, 0));
    for (let x = x0 + 0.3; x < x0 + len; x += 1.2) k.put(M.galv, box(0.2, 0.012, 0.26), T(x, 0.006, 0)).put(M.steel, cyl(0.012, 0.02, 6), T(x, 0.016, 0.1)).put(M.steel, cyl(0.012, 0.02, 6), T(x, 0.016, -0.1));
    k.put(M.rail, ibeam(len, 0.1, 0.14, 0.012, 0.01), T(xc, yT, 0));
    for (let x = x0 + 0.4; x < x0 + len; x += 1.5) { k.put(M.galv, box(0.06, H - yT - 0.07, 0.06), T(x, (H + yT + 0.07) / 2, 0)); k.put(M.galv, box(0.18, 0.012, 0.18), T(x, H - 0.006, 0)); }
    for (const x of [x0 + 0.05, x0 + len - 0.05]) { k.put(M.yellow, rbox(0.1, 0.3, 0.3, 0.02, 1), T(x, 0.2, 0)).put(M.rubber, cyl(0.08, 0.1, 14).rotateZ(PI / 2), T(x + (x < xc ? 0.1 : -0.1), 0.25, 0)); }
    // carril conductor de alimentación (lateral del riel) con soportes
    k.put(M.yellow, box(len, 0.035, 0.03), T(xc, 0.3, 0.32)); for (let x = x0 + 0.4; x < x0 + len; x += 1.6) k.put(M.dark, box(0.03, 0.3, 0.03), T(x, 0.15, 0.32));
    k.flush(r);
    return r;
  }
  const rig = {
    group: g, lift, mid, top, loadAnchor, x: 0, y: 0.3, e: 0, v: 0, a: 0, sw: 0, swv: 0, t: 0, moving: false, wheels, bea,
    // x = centro de carga en el eje del pasillo (coordenada local del padre), y = cara superior de horquilla, e = extensión (±Z)
    set(x, y, e) {
      const dx = x - this.x; this.x = x; this.y = y; this.e = clamp(e, -(o.stroke ?? 1.9), o.stroke ?? 1.9);
      g.position.x = x; for (const w of wheels) w.rotation.z -= dx / 0.125;
      lift.position.y = y; mid.position.z = this.e / 2; top.position.z = this.e / 2;
      for (const k of cables) { const y0 = y + 0.6, y1 = yT - 0.38; k.position.y = (y0 + y1) / 2; k.scale.y = Math.max(0.05, y1 - y0); }
      this._dx = (this._dx || 0) + dx;
    },
    update(dt) {
      if (!(dt > 0)) return; this.t += dt;
      const v = this._dx / dt; this._dx = 0; this.a = lag(this.a, clamp((v - this.v) / dt, -3, 3), 0.1, dt); this.v = v;
      [this.sw, this.swv] = spring(this.sw, this.swv, clamp(this.a * 0.0016, -0.006, 0.006), 30, 1.6, dt); sway.rotation.z = this.sw; // oscilación del mástil
      this.moving = Math.abs(v) > 0.02 || this.busy;
      const on = this.moving ? Math.pow(Math.max(0, Math.cos(this.t * 9)), 4) : 0; bea.material.emissiveIntensity = 0.15 + 2.4 * on;
    },
  };
  rig.set(0, 0.3, 0); rig._dx = 0;
  return { group: g, rig, rails, size: { mastX: MX, yTop: yT } };
}

// ================================================================ TRANSPALETA MANUAL (2,5 t)
// Origen = suelo bajo el centro de la carga; horquillas 1150 mm hacia +X; timón articulado en −X.
// setLift(0..1) eleva 0–0,045 m la horquilla; setTiller(rad) inclina el timón hacia −X; roll(ds) gira las ruedas.
export function createPalletJack() {
  const M = hmats(), K = materials(), g = new THREE.Group(); g.name = 'transpaleta';
  const fr = new THREE.Group(); g.add(fr); // bastidor que sube con la elevación
  const b = new Bk(), xh = -0.62; // talón
  for (const s of [-1, 1]) {
    const p = [[xh, 0.0], [0.55, 0.0], [0.6, 0.02], [0.6, 0.05], [xh, 0.075]];
    b.put(M.red, extrude(p, 0.16, 0.004).translate(0, 0, 0), T(0, 0.012, s * 0.27));
    b.put(M.dark, cyl(0.04, 0.07, 14).rotateX(PI / 2), T(0.47, 0.04, s * 0.27)); // rodillos de carga (simplificados bajo la punta)
  }
  b.put(M.red, rbox(0.22, 0.12, 0.7, 0.02, 2), T(xh - 0.08, 0.1, 0));                 // cabezal
  b.put(M.red, rbox(0.12, 0.22, 0.2, 0.02, 2), T(xh - 0.16, 0.2, 0)).put(K.chrome, cyl(0.03, 0.16, 14), T(xh - 0.16, 0.36, 0)); // bomba hidráulica
  b.flush(fr);
  const steer = new THREE.Group(); steer.position.set(xh - 0.16, 0, 0); g.add(steer);
  const wg = new THREE.Group(); wg.position.y = 0.09; steer.add(wg);
  const sw = new Bk(); for (const s of [-1, 1]) sw.put(M.rubber, cyl(0.09, 0.05, 18).rotateX(PI / 2), T(0, 0, s * 0.07)); sw.flush(wg);
  const sb = new Bk(); sb.put(M.red, box(0.1, 0.06, 0.24), T(0, 0.2, 0)); for (const s of [-1, 1]) sb.put(M.red, box(0.06, 0.14, 0.02), T(0, 0.12, s * 0.115)); sb.flush(steer);
  const tiller = new THREE.Group(); tiller.position.set(0, 0.4, 0); steer.add(tiller);
  const tb = new Bk(); tb.put(M.red, cyl(0.016, 1.0, 10), T(0, 0.5, 0)); tb.put(M.red, new THREE.TorusGeometry(0.11, 0.016, 8, 20, PI).rotateY(PI / 2), T(0, 1.0, 0));
  for (const s of [-1, 1]) tb.put(M.rubber, cyl(0.022, 0.1, 10).rotateX(PI / 2), T(0, 1.08, s * 0.08)); tb.put(M.dark, box(0.03, 0.05, 0.03), T(0.03, 1.12, 0)); tb.flush(tiller);
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  const api = { group: g, steerG: steer, tiller, lift: 0, spin: 0,
    setLift(f) { this.lift = clamp(f, 0, 1); fr.position.y = 0.045 * this.lift; },
    setTiller(a) { tiller.rotation.z = a; }, // + inclina el timón hacia −X (hacia el operario)
    setSteer(a) { steer.rotation.y = a; },
    roll(ds) { this.spin += ds / 0.09; wg.rotation.z = -this.spin; },
    // posición de las manos (local del grupo) para el operario
    gripLocal(out = new V3()) { out.set(0, 1.06, 0); tiller.localToWorld(out); g.worldToLocal(out); return out; },
  };
  api.setTiller(0.45); return api;
}

// ================================================================ ESTACIÓN P&D (entrega/recogida) frente a la puerta
// Dos largueros a lo largo de Z bajo los patines exteriores de la tarima (x = ±0,45) a altura top, con guías de
// centrado en los extremos; el montacargas entra según X y el transelevador según Z sin interferir.
export function pdStandGeo(top = 0.15) {
  const M = hmats(), b = new Bk(), g = new THREE.Group();
  for (const s of [-1, 1]) {
    b.put(M.yellow, rbox(0.1, top - 0.012, 1.3, 0.008, 1), T(s * 0.45, (top - 0.012) / 2 + 0.006, 0));
    b.put(M.galv, box(0.14, 0.012, 1.34), T(s * 0.45, 0.006, 0));
    for (const z of [-0.62, 0.62]) b.put(M.yellow, rbox(0.12, 0.12, 0.03, 0.008, 1), T(s * 0.45, top + 0.05, z).multiply(T(0, 0, 0, z > 0 ? -0.5 : 0.5)));
    for (const z of [-0.55, 0, 0.55]) b.put(M.steel, cyl(0.01, 0.02, 6), T(s * 0.45 + 0.05, 0.016, z));
  }
  b.flush(g);
  return g;
}

// ================================================================ DEMO (preview.html?m=handling)
export function demo(scene) {
  const g = new THREE.Group(); scene.add(g);
  const cr = createStackerCrane({ H: 6 }); g.add(cr.group); g.add(cr.rails(10, -1));
  const pd = pdStandGeo(0.15); pd.position.set(0, 0, 1.333); g.add(pd);
  const pal = new THREE.Group(); const pm = new THREE.Mesh(S.palletGeo(), S.palletMaterial()); pal.add(pm);
  const ct = new THREE.Mesh(S.cartonGeo(), S.cartonMaterial()); ct.position.y = S.PAL_H + 0.12; ct.scale.set(2, 1, 3); pal.add(ct); g.add(pal);
  const jk = createPalletJack(); jk.group.position.set(-2, 0, 2.5); g.add(jk.group);
  let t = 0;
  return (dt) => {
    t += dt; const c = t % 16, ph = (a, b) => clamp((c - a) / (b - a), 0, 1), sm = (u) => u * u * (3 - 2 * u);
    const e = 1.333 * (sm(ph(0, 2)) - sm(ph(3, 5))) + 1.333 * (sm(ph(10, 12)) - sm(ph(13, 15))), x = 4 * sm(ph(5, 9)) - 4 * sm(ph(15, 16)), y = 0.15 + PICK.under + 0.05 * sm(ph(2, 3)) + 3.0 * sm(ph(5, 9)) - 3.0 * sm(ph(15, 16)) - 0.05 * sm(ph(12, 13));
    cr.rig.set(x, y, -e); cr.rig.update(dt);
    const carried = c > 2.5 && c < 12.5; if (carried) { cr.rig.loadAnchor.updateWorldMatrix(true, false); pal.matrixAutoUpdate = false; pal.matrix.copy(cr.rig.loadAnchor.matrixWorld); } else { pal.matrixAutoUpdate = true; pal.position.set(c <= 2.5 ? 0 : 4, c <= 2.5 ? 0.15 : 3.15, c <= 2.5 ? 1.333 : -1.333); }
    jk.setLift(0.5 + 0.5 * Math.sin(t)); jk.roll(dt * 0.3);
  };
}
