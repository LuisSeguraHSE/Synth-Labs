// LOGÍSTICA VISUAL DEL INGRESO: reproduce con un retardo fijo (D) los viajes de pallet que decide el simulador y los
// convierte en una coreografía física coherente: atraque del camión con señalista, plataforma elevadora trasera,
// transpaleta con operario (tira de la carga, baja con la plataforma, escanea la etiqueta), montacargas con maniobras
// en K hasta la estación P&D frente a la puerta y transelevador por pasillo hasta la ubicación del rack.
// Los pasillos (~1,5 m) y la franja de maniobra (~1,3 m) de la cámara no admiten el giro de un montacargas: por eso
// el montacargas trabaja fuera y en la P&D, y un transelevador por pasillo ubica los pallets.
// Solo LEE la simulación (no altera resultados). Coordenadas «x'»: metros desde la cara interior del muro de la puerta.
import { THREE, Path2, clamp, lerp, smootherstep, wrapAngle, approach, lag } from './models/kit.js';
import { FORK } from './models/forklift.js';
import { PICK } from './models/handling.js';
import { TL, TRUCK } from './models/truck.js';

const PI = Math.PI, V3 = THREE.Vector3;
export const LOGI = {
  PERIOD: 46,                                // el simulador encadena viajes de 45 s (+1 s de paso)
  D_KEEP: 110, D_TRIP: 138,                  // retardo de la reproducción (puerta abierta todo el ingreso / solo al pasar cada pallet)
  DOCK: -6.6,                                // cara trasera del camión atracado (x')
  PD: 0.65, PD_H: 0.15,                      // estación P&D: centro del pallet (x') y altura de apoyo (= h de la simulación)
  XE: -1.2, RT: 0.75,                        // montacargas: x' del inicio del arco de retorno y radio de giro del eje delantero
  JACK_S: [3.6, -1.9],                       // estacionamiento de la transpaleta (d hacia fuera desde la bisagra, z del camión)
};
// Línea de tiempo de un viaje (u = s desde que el simulador crea el viaje; negativo = preparación previa)
export const CYC = { c0: [-42, -38.5], c1: [-38.5, -32.5], c2: [-32, -27], c3: [-27, -26], c4: [-26, -19], c5: [-19, -13], c6: [-13, -10.5], c7: [-10.5, -9.5], c8: [-9.5, -8], c9: [-8, -6], c10: [-6, -3.5], c11: [-3.5, -1.5], c12: [-1.5, 4] };
export const FKT = { app: [-6, -0.5], lift: [-0.5, 0.8], load: -0.2, rev: [0.8, 4.3], fwd: [4.3, 8.8], low: [8.8, 10.0], drop: 9.7, ret: [10.5, 16], door: [0.5, 13.5] };
export const CRT = { ext1: [13, 16], up1: [16, 17], load: 16.6, ret1: [17, 20], trav: [20, 32], ext2: [32, 35], dn2: [35, 36.5], drop: 35.8, ret2: [36.5, 39.5], home: [39.5, 51] };
const C = CYC, F = FKT, K = CRT;
const ph = (u, [a, b]) => clamp((u - a) / (b - a), 0, 1);
const ss = (u, w) => smootherstep(ph(u, w));

// ---------------------------------------------------------------- Polilíneas densas con arcos y curvas de Hermite
function line(a, b, out, step = 0.08) { const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); for (let i = out.length ? 1 : 0; i <= n; i++) out.push([lerp(a[0], b[0], i / n), lerp(a[1], b[1], i / n)]); return out; }
function arc(c, r, a0, a1, out) { const n = Math.max(4, Math.ceil(Math.abs(a1 - a0) / 0.05)); for (let i = out.length ? 1 : 0; i <= n; i++) { const a = lerp(a0, a1, i / n); out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); } return out; }
function herm(A, B, k = 0.5, n = 32) {
  const d = Math.hypot(B[0] - A[0], B[1] - A[1]) * k, P = [[A[0], A[1]], [A[0] + Math.cos(A[2]) * d, A[1] + Math.sin(A[2]) * d], [B[0] - Math.cos(B[2]) * d, B[1] - Math.sin(B[2]) * d], [B[0], B[1]]], out = [];
  for (let i = 0; i <= n; i++) { const u = i / n, w = [(1 - u) ** 3, 3 * u * (1 - u) ** 2, 3 * u * u * (1 - u), u ** 3]; out.push([0, 1].map((c) => w.reduce((s, wi, j) => s + wi * P[j][c], 0))); }
  return out;
}

export function createLogistics(env) {
  const { X } = env, rt = LOGI.RT;
  // ----- geometría del muelle: bisagra de la plataforma apoyada en el suelo y centro del pallet sobre ella
  const hingeG = LOGI.DOCK - (TL.PXD - TL.LA * Math.cos(Math.asin((TL.T - TL.PY) / TL.LA)) - TRUCK.XR);
  const xp = hingeG + 1.25;
  // ----- montacargas: poses clave (x', z) y tramos (rumbo = tangente; los tramos de retroceso se recorren hacia s = 0)
  const A = [xp + FORK.palletOffset, 0], B = [A[0] + 0.335 + rt, -rt], Cx = B[0] + rt, D = [LOGI.PD - FORK.palletOffset, 0];
  const E = [LOGI.XE, 0], Fp = [LOGI.XE - rt, -rt], Q = [LOGI.XE - rt, -2.3], G = [LOGI.XE - 2 * rt, 0];
  const W = (pts) => pts.map(([x, z]) => [X(x), z]);
  const legs = {
    app: W(line(G, A, arc([G[0], -rt], rt, 0, 0.5 * PI, line(Q, Fp, [])))),                 // Q → F → arco → G → A   (adelante)
    rev: W(line([A[0] + 0.335, 0], A, arc([A[0] + 0.335, -rt], rt, 0, 0.5 * PI, [B.slice()]))), // B → arco → A       (atrás)
    fwd: W(line([Cx, 0], D, arc([Cx, -rt], rt, PI, 0.5 * PI, [B.slice()]))),                // B → arco → C → D        (adelante)
    ret: W(line(E, D, arc([E[0], -rt], rt, PI, 0.5 * PI, line(Q, Fp, [])))),                // Q → F → arco → E → D    (atrás)
  };
  const paths = {}; for (const k in legs) paths[k] = new Path2(legs[k], 0.02);
  const QW = [X(Q[0]), Q[1], 0.5 * PI];
  // ----- estado
  const S = { tv: null, batches: [], seen: new Set(), doorDemand: false, deploy: 0, ready: false, places: [], fkCmd: null, cur: null,
    crane: env.cranes.map(() => ({ x: LOGI.PD, y: LOGI.PD_H + PICK.under - 0.025, e: 0, load: false, busy: false, vx: 0 })), techAisle: -1 };
  const tmpM = new THREE.Matrix4(), tmpM2 = new THREE.Matrix4(), tmpV = new V3();

  // ----- registro de los viajes del simulador (los pallets se crean al empezar cada viaje)
  function record(st) {
    const g = st.ingress;
    if (g) {
      let b = S.batches.find((x) => x.id === g.batch.id);
      if (!b) { b = { id: g.batch.id, n: g.batch.n, tStart: g.batch.tStart, T0: g.batch.T0, keep: g.keepDoor, trips: [], D: g.keepDoor ? LOGI.D_KEEP : LOGI.D_TRIP, closed: false, finished: false }; S.batches.push(b); }
      if (g.trip && !S.seen.has(g.trip.pal.id)) { S.seen.add(g.trip.pal.id); b.trips.push({ k: b.trips.length, pal: g.trip.pal, t0: g.trip.t0, slot: g.trip.pal.slot }); }
    }
    for (const b of S.batches) if (!b.closed && (!g || g.batch.id !== b.id)) { b.closed = true; b.n = b.trips.length; }
  }
  const t0Of = (b, k) => (b.trips[k] ? b.trips[k].t0 : (b.trips.length ? b.trips[b.trips.length - 1].t0 + LOGI.PERIOD * (k - b.trips.length + 1) : b.tStart + LOGI.PERIOD * k));

  // ----- marcos: caja del camión, plataforma (elevada) y suelo del muelle (fijo)
  const bodyIn = () => env.truck.rig.body.children[0];
  const truckSlot = (k) => { const r = Math.floor((k % 14) / 2), s = k % 2 ? 1 : -1; return [TRUCK.XR + 0.6 + r * 1.02, s * 0.59]; }; // (x, z) del camión
  const onPlat = (d, z) => d >= -0.02 && d <= TL.DEPTH + 0.02 && Math.abs(z) <= TL.WID / 2;
  // (d, z del camión) → mundo. Dentro de la caja o sobre la plataforma se usa el marco de la plataforma (a su altura);
  // fuera, el suelo del muelle (la plataforma apoyada coincide con él).
  function pt(d, z, out = new V3()) {
    const pl = env.truck.rig.platform, lifted = env.truck.rig.tl.lift > 0.004 || d < 0;
    if (lifted || onPlat(d, z)) { pl.updateWorldMatrix(true, false); out.set(-d, 0, z).applyMatrix4(pl.matrixWorld); if (!lifted && !onPlat(d, z)) out.y = 0; return out; }
    return out.set(X(hingeG + d), 0, -z);
  }
  const headingOf = (d, z, yaw) => { const a = pt(d, z), b = pt(d + 0.3 * Math.cos(yaw), z + 0.3 * Math.sin(yaw)); return Math.atan2(b.z - a.z, b.x - a.x); };

  // ===== Transpaleta + operario de muelle en el ciclo del viaje k (u) =====
  // Transpaleta: (d, z, yaw) = centro de horquillas y dirección de las puntas en el plano (d, z); yaw = π → hacia el camión.
  const JS = LOGI.JACK_S, jp = new Map();
  function jackPaths(k) {
    if (jp.has(k)) return jp.get(k);
    const [xt, zt] = truckSlot(k), dpal = -(xt - (TRUCK.XR - 0.02));
    const toTruck = herm([0.5, 0, PI], [-0.2, zt, PI], 0.5); line(toTruck[toTruck.length - 1], [dpal, zt], toTruck, 0.05);
    const o = { in: new Path2(herm([JS[0], JS[1], PI], [0.5, 0, PI], 0.45), 0.02), truck: new Path2(toTruck, 0.02), out: new Path2(herm([2.45, 0, 0], [JS[0], JS[1], 0], 0.5), 0.02), dpal, zt };
    jp.set(k, o); return o;
  }
  function cycle(k, u) {
    const P = jackPaths(k), o = { lift: 0, tiller: 0.45, act: 'push', j: [JS[0], JS[1], PI], jl: 0, pal: 'truck', pd: 0, pz: 0, py: 0, pyaw: PI };
    const at = (path, f) => { const q = path.at(f * path.length); return [q.x, q.z, q.heading]; };
    if (u < C.c0[1]) o.j = at(P.in, ss(u, C.c0));
    else if (u < C.c1[1]) { o.j = [0.5, 0, PI]; o.lift = ss(u, C.c1); o.act = 'hold'; }
    else if (u < C.c2[1]) { o.j = at(P.truck, ss(u, C.c2)); o.lift = 1; }
    else if (u < C.c3[1]) { o.j = [P.dpal, P.zt, PI]; o.lift = 1; o.jl = ph(u, C.c3); o.act = 'hold'; }
    else if (u < C.c4[1]) { const q = at(P.truck, 1 - ss(u, C.c4)); o.j = [q[0], q[1], PI + 0.6 * wrapAngle(q[2] - PI)]; o.lift = 1; o.jl = 1; o.pal = 'jack'; o.tiller = 0.75; }
    else if (u < C.c5[1]) { o.j = [0.5, 0, PI]; o.lift = 1 - ss(u, C.c5); o.jl = 1; o.pal = 'jack'; o.act = 'hold'; o.tiller = 0.25; }
    else if (u < C.c6[1]) { o.j = [lerp(0.5, 1.25, ss(u, C.c6)), 0, PI]; o.jl = 1; o.pal = 'jack'; o.tiller = 0.75; }
    else if (u < C.c7[1]) { o.j = [1.25, 0, PI]; o.jl = 1 - ph(u, C.c7); o.pal = 'jack'; o.tiller = 0.35; o.act = 'hold'; }
    else if (u < C.c8[1]) { o.j = [lerp(1.25, 2.45, ss(u, C.c8)), 0, PI]; o.pal = 'plat'; o.tiller = 0.75; }
    else if (u < C.c9[1]) { o.j = at(P.out, ss(u, C.c9)); o.j[2] = wrapAngle(o.j[2] + PI); o.pal = 'plat'; o.tiller = 0.75; }
    else { o.pal = 'plat'; o.act = 'free'; o.tiller = 0.05; }
    if (o.pal === 'jack') { o.pd = o.j[0]; o.pz = o.j[1]; o.py = Math.max(0, 0.045 * o.jl - 0.01); o.pyaw = o.j[2]; }
    if (o.pal === 'plat') { o.pd = 1.25; o.pz = 0; o.py = 0; o.pyaw = PI; }
    return o;
  }

  // ===== Transelevador: pose en la tarea del viaje (x' del centro de carga, y = cara superior de horquilla, e = extensión ±Z) =====
  const yEntry = (h) => h + PICK.under - 0.025, yLift = (h) => h + PICK.under + 0.05;
  function craneJob(u, slot, az) {
    const eP = -az, eS = env.Z(slot.y) - az, x0 = LOGI.PD, x1 = slot.x, hS = slot.h;
    let x = x0, y = yEntry(LOGI.PD_H), e = 0;
    if (u < K.ext1[1]) e = eP * ss(u, K.ext1);
    else if (u < K.up1[1]) { e = eP; y = lerp(yEntry(LOGI.PD_H), yLift(LOGI.PD_H), ss(u, K.up1)); }
    else if (u < K.ret1[1]) { e = eP * (1 - ss(u, K.ret1)); y = yLift(LOGI.PD_H); }
    else if (u < K.trav[1]) { x = lerp(x0, x1, ss(u, K.trav)); y = lerp(yLift(LOGI.PD_H), yLift(hS), ss(u, [K.trav[0] + 1, K.trav[1] - 0.5])); }
    else if (u < K.ext2[1]) { x = x1; y = yLift(hS); e = eS * ss(u, K.ext2); }
    else if (u < K.dn2[1]) { x = x1; e = eS; y = lerp(yLift(hS), yEntry(hS) - 0.02, ss(u, K.dn2)); }
    else if (u < K.ret2[1]) { x = x1; y = yEntry(hS) - 0.02; e = eS * (1 - ss(u, K.ret2)); }
    else { x = lerp(x1, x0, ss(u, K.home)); y = lerp(yEntry(hS) - 0.02, yEntry(LOGI.PD_H), ss(u, [K.home[0] + 1, K.home[1] - 1])); }
    return { x, y, e, load: u >= K.load && u < K.drop, busy: true };
  }
  function idleCrane(i, dtS, fast) {
    const s = S.crane[i], park = S.techAisle === i ? { x: 5.2, y: 2.3 } : { x: LOGI.PD, y: yEntry(LOGI.PD_H) }, dx = park.x - s.x;
    if (fast) { s.x = park.x; s.y = park.y; s.vx = 0; } else { s.vx = approach(s.vx, Math.abs(dx), 1.5, 0.5, 0.5, dtS); s.x += Math.sign(dx) * Math.min(Math.abs(dx), s.vx * dtS); s.y = lag(s.y, park.y, 0.9, dtS); }
    s.e = lag(s.e, 0, 0.3, dtS); s.load = false; s.busy = Math.abs(dx) > 0.02;
  }

  // ===== Montacargas: consigna (tramo, s, elevación, carga) en la tarea del viaje (u) =====
  const entryH = TL.T + PICK.under, travH = 0.3, dropH = LOGI.PD_H + PICK.under;
  function forkCmd(u) {
    const sAt = (k, w, back) => { const Lp = paths[k].length, f = ss(u, w); return back ? Lp * (1 - f) : Lp * f; };
    if (u < F.app[1]) return { leg: 'app', s: sAt('app', F.app), lift: lerp(FORK.parkLift, entryH, ph(u, [F.app[0], F.app[0] + 1.2])), load: false };
    if (u < F.lift[1]) return { leg: 'app', s: paths.app.length, lift: lerp(entryH, travH, ss(u, F.lift)), load: u >= F.load };
    if (u < F.rev[1]) return { leg: 'rev', s: sAt('rev', F.rev, true), lift: travH, load: true };
    if (u < F.fwd[1]) return { leg: 'fwd', s: sAt('fwd', F.fwd), lift: travH, load: true };
    if (u < F.low[1]) return { leg: 'fwd', s: paths.fwd.length, lift: lerp(travH, dropH, ss(u, F.low)), load: u < F.drop };
    if (u < F.ret[1]) return { leg: 'ret', s: sAt('ret', F.ret, true), lift: lerp(dropH - 0.07, FORK.parkLift, ph(u, [F.ret[0] + 2, F.ret[1]])), load: false };
    return null;
  }

  // ===== Bucle principal (dtS = paso en tiempo de simulación; fast = ×20 o más: todo se posiciona sin dinámica) =====
  let walker = null;
  function update(st, p, dtS, fast) {
    record(st);
    const b = S.batches.find((x) => !x.finished) || null, tr = env.truck, dr = tr.driver;
    S.places.length = 0; S.doorDemand = false;
    if (!walker && env.workers.dock) walker = new Walker(env.workers.dock);
    if (!b) {
      S.tv = null; S.cur = null; dr.update(Math.min(dtS, 0.25), { wantDocked: false }); if (fast && dr.state !== 'away') dr.snapAway();
      tr.rig.setTailLift(0, 0); S.fkCmd = { active: false, park: QW };
      env.cranes.forEach((c, i) => idleCrane(i, dtS, fast)); dockIdle(dtS, fast); return S;
    }
    if (S.cur !== b) { S.cur = b; S.tv = st.t - b.D; S.deploy = 0; jp.clear(); }
    // reloj de reproducción: avanza con la simulación pero espera al camión antes del primer ciclo
    const firstCycle = t0Of(b, 0) + C.c0[0];
    S.ready = dr.docked && S.deploy >= 1;
    let tv = Math.min(st.t - b.D, S.tv + dtS);
    if (!S.ready && tv >= firstCycle) tv = Math.max(S.tv, Math.min(tv, firstCycle));
    if (fast) tv = st.t - b.D;
    S.tv = tv;
    const n = b.closed ? b.trips.length : Math.max(b.n, b.trips.length), lastK = n - 1;
    const uLast = b.closed && n ? tv - b.trips[lastK].t0 : -1e9;
    // camión atracado hasta guardar la plataforma tras el último pallet
    const stow = [6, 14], want = n > 0 && !(b.closed && uLast > stow[1] + 0.5);
    if (fast && want && !dr.docked) { dr.snapDocked(); S.deploy = 1; }
    dr.update(Math.min(dtS, 0.25), { wantDocked: want });
    if (fast && !want && dr.state !== 'away') dr.snapAway();
    if (dr.docked && S.deploy < 1 && !(b.closed && uLast > stow[0])) S.deploy = Math.min(1, S.deploy + dtS / 8);
    let deploy = dr.state === 'docked' ? S.deploy : 0; if (b.closed && uLast > stow[0]) deploy = Math.min(deploy, 1 - ph(uLast, stow));
    // ciclo activo de la plataforma: viaje k con u en [c0, c12)
    let cyc = null, ck = -1;
    for (let k = 0; k <= lastK; k++) { const u = tv - t0Of(b, k); if (u >= C.c0[0] && u < C.c12[1]) { cyc = cycle(k, u); ck = k; break; } }
    tr.rig.setTailLift(deploy, cyc ? cyc.lift : 0); tr.rig.group.updateMatrixWorld(true);
    // ubicación visual de cada pallet del lote
    for (let k = 0; k < n; k++) {
      const t = b.trips[k], u = tv - t0Of(b, k), id = t ? t.pal.id : null, q = t ? t.pal : null, c = k === ck ? cyc : null;
      if (u < C.c3[1] || (c && c.pal === 'truck')) {
        if (k >= 14 && tv - t0Of(b, k - 14) < C.c4[1]) continue; // la fila aún está ocupada: este pallet queda «detrás»
        const [xt, zt] = truckSlot(k); S.places.push({ id, q, m: new THREE.Matrix4().makeTranslation(xt, TRUCK.FLOOR, zt).premultiply(bodyIn().matrixWorld), T0: b.T0 });
      } else if (u < F.load) {
        const pd = c ? c.pd : 1.25, pz = c ? c.pz : 0, py = c ? c.py : 0, yaw = c ? c.pyaw : PI;
        const pl = tr.rig.platform, lifted = tr.rig.tl.lift > 0.004 || pd < 0, m = new THREE.Matrix4();
        if (lifted || onPlat(pd, pz)) { m.makeRotationY(yaw - PI).setPosition(-pd, py, pz).premultiply(pl.matrixWorld); }
        else { const a = pt(pd, pz); m.makeRotationY(-headingOf(pd, pz, yaw)).setPosition(a.x, py, a.z); }
        S.places.push({ id, q, m, T0: b.T0 });
      } else if (u < F.drop) S.places.push({ id, q, fork: true, T0: b.T0 });
      else if (u < K.load) S.places.push({ id, q, m: new THREE.Matrix4().makeTranslation(X(LOGI.PD), LOGI.PD_H, 0), T0: b.T0 });
      else if (u < K.drop && t) S.places.push({ id, q, crane: env.aisleOf(t.slot), T0: b.T0 });
      else if (t) S.places.push({ id, q, stored: true });
    }
    // montacargas
    let cmd = null;
    for (let k = 0; k <= lastK && !cmd; k++) { const u = tv - t0Of(b, k); if (u >= F.app[0] && u < F.ret[1]) cmd = forkCmd(u); }
    for (let k = 0; k <= lastK; k++) { const u = tv - t0Of(b, k); if (u >= F.door[0] && u < F.door[1]) S.doorDemand = true; }
    if (b.keep && tv - t0Of(b, 0) > F.door[0] && !(b.closed && uLast > F.door[1])) S.doorDemand = true;
    S.fkCmd = cmd ? { active: true, path: legs[cmd.leg], s: cmd.s, lift: cmd.lift, load: cmd.load, radius: 0.02, leg: cmd.leg } : { active: false, park: QW };
    // transelevadores: tarea del pallet más reciente de su pasillo; si no, reposo
    env.cranes.forEach((c, i) => {
      let job = null;
      for (let k = lastK; k >= 0 && !job; k--) { const t = b.trips[k]; if (!t || env.aisleOf(t.slot) !== i) continue; const u = tv - t.t0; if (u >= K.ext1[0] - 2 && u < K.home[1]) job = craneJob(u, t.slot, c.z); }
      if (job) Object.assign(S.crane[i], job, { vx: 0 }); else idleCrane(i, dtS, fast);
    });
    dockWorker(b, tv, cyc, ck, uLast, stow, dtS, fast);
    if (b.closed && uLast > Math.max(stow[1] + 2, K.home[1]) && dr.state === 'away') b.finished = true;
    return S;
  }

  // ----- operario de muelle: señalista durante la maniobra, botonera de la plataforma y ciclo de descarga
  const spot = { idle: [X(-0.8), 2.7, -0.5 * PI], marshal: [X(-4.3), 3.0, 0], box: [X(LOGI.DOCK - 0.42), -1.8, 0.5 * PI] };
  spot.marshal[2] = Math.atan2(-spot.marshal[1], X(LOGI.DOCK - 5) - spot.marshal[0]);
  function placeJack(d, z, yaw, lift, tiller) {
    const j = env.jack, a = pt(d, z), hd = headingOf(d, z, yaw), prev = j.group.position.clone();
    if (onPlat(d, z) && env.truck.rig.tl.lift <= 0.004 && d >= 0) a.y = TL.T;
    j.group.position.copy(a); j.group.rotation.y = -hd; j.setLift(lift); j.setTiller(tiller);
    const dx = a.x - prev.x, dz = a.z - prev.z; if (dx * dx + dz * dz < 4) j.roll(Math.hypot(dx, dz) * (Math.cos(hd) * dx + Math.sin(hd) * dz >= 0 ? 1 : -1));
    return hd;
  }
  function jackPark() {
    const j = env.jack; if (!j) return;
    if (env.truck.driver.state === 'docked' && S.deploy > 0) placeJack(JS[0], JS[1], PI, 0, 0.05);
    else { j.group.position.set(X(-1.7), 0, 3.6); j.group.rotation.y = 0.2; j.setLift(0); j.setTiller(0.05); }
  }
  function dockIdle(dtS, fast) { jackPark(); if (walker) { walker.goto(spot.idle, { action: 'stand' }); walker.update(dtS, fast); } }
  function dockWorker(b, tv, cyc, ck, uLast, stow, dtS, fast) {
    if (!walker) return;
    const dr = env.truck.driver, w = env.workers.dock;
    if (cyc && dr.docked && S.deploy >= 1) {
      const u = tv - t0Of(b, ck), [jd, jz, jy] = cyc.j, hd = placeJack(jd, jz, jy, cyc.jl, cyc.tiller);
      let d = jd - 1.15 * Math.cos(jy), z = jz - 1.15 * Math.sin(jy), face = hd, act = cyc.act === 'free' ? 'stand' : 'push';
      const scanP = [1.25, -1.3], back = [JS[0] + 1.15, JS[1]];
      if (u >= C.c10[0]) { // escanea la etiqueta lateral del pallet y vuelve junto a la transpaleta
        const f1 = ss(u, C.c10), f2 = ss(u, [C.c12[0], C.c12[0] + 3]);
        [d, z] = u < C.c12[0] ? [lerp(back[0], scanP[0], f1), lerp(back[1], scanP[1], f1)] : [lerp(scanP[0], back[0], f2), lerp(scanP[1], back[1], f2)];
        const a = pt(d, z), c = pt(1.25, 0); face = u < C.c12[0] ? Math.atan2(c.z - a.z, c.x - a.x) : hd; act = u >= C.c11[0] && u < C.c12[0] ? 'scan' : 'stand';
      }
      const a = pt(d, z); let y = a.y; if (onPlat(d, z) && env.truck.rig.tl.lift <= 0.004 && d >= 0) y = TL.T;
      walker.drive(dtS, a.x, y, a.z, face, act, fast);
      return;
    }
    jackPark();
    const st = dr.state;
    if (['arrive', 'reverse', 'opening', 'final'].includes(st) || (st === 'docked' && !dr.docked)) walker.goto(spot.marshal, { action: 'signal' });
    else if (st === 'docked' && (S.deploy < 1 || (b.closed && uLast > 3))) walker.goto(spot.box, { action: 'inspect', via: [[X(LOGI.DOCK + 1.1), 2.2], [X(LOGI.DOCK + 0.75), -1.8]] });
    else if (st === 'docked') { const a = pt(JS[0] + 1.15, JS[1]); walker.goto([a.x, a.z, PI], { action: 'stand', via: [[X(LOGI.DOCK + 0.75), -1.9], [X(LOGI.DOCK + 2.4), -1.7], [X(LOGI.DOCK + 2.6), 1.9]] }); }
    else walker.goto(spot.idle, { action: 'stand' });
    walker.update(dtS, fast);
    void w;
  }

  return { update, state: S, paths, legs, poses: { A, B, D, E, Fp, Q, G, xp, hingeG }, cycle, craneJob, forkCmd, pt };
}

// ---------------------------------------------------------------- Caminante: lleva a un operario a un destino (con escalas)
// goto([x, z, face], {action, via, speed, gate}) fija el destino (replanifica si cambia); update(dt) camina con perfil de
// velocidad limitado por curvatura y se encara al llegar; drive() lo posiciona cinemáticamente (coreografías dirigidas).
export class Walker {
  constructor(worker) { this.w = worker; this.key = ''; this.path = null; this.s = 0; this.v = 0; this.done = true; this.target = null; this.act = null; this.opts = {}; }
  goto(tg, o = {}) {
    const key = tg.map((v) => v.toFixed(2)).join(',') + (o.action || '') + (o.via ? o.via.length : 0);
    if (key === this.key) return; this.key = key; this.target = tg; this.opts = o;
    const g = this.w.group, pts = [[g.position.x, g.position.z], ...(o.via || []), [tg[0], tg[1]]].filter((q, i, a) => i === 0 || Math.hypot(q[0] - a[i - 1][0], q[1] - a[i - 1][1]) > 0.05);
    this.path = pts.length > 1 ? new Path2(pts, 0.5) : null; this.s = 0; this.done = !this.path; this.act = null;
  }
  get arrived() { return this.done; }
  update(dt, fast) {
    const w = this.w, g = w.group, o = this.opts || {}, tg = this.target, dtw = Math.min(dt, 0.05); if (!tg) { w.update(dtw); return; }
    let hT = -g.rotation.y;
    if (this.path && !this.done) {
      if (o.gate && !o.gate()) { if (this.act !== 'wait') { this.act = 'wait'; w.setAction('stand'); } w.update(dtw, { headingTarget: hT }); return; }
      const Lp = this.path.length; let vmax = o.speed ?? 1.3;
      for (const d of [0, 0.4, 0.9, 1.5]) { if (this.s + d > Lp) break; const c = Math.abs(this.path.at(this.s + d).curv); vmax = Math.min(vmax, Math.sqrt(0.6 / Math.max(1e-3, c) + 1.6 * d)); }
      if (fast) { // a ×20 o más avanza a saltos de 0,3 m, pero respeta la compuerta de la puerta
        for (let i = 0; i < 60 && this.s < Lp; i++) { this.s = Math.min(Lp, this.s + 0.3); const q = this.path.at(this.s); g.position.set(q.x, 0, q.z); if (o.gate && !o.gate()) break; }
      } else { this.v = approach(this.v, Lp - this.s, vmax, 0.9, 0.9, dt); this.s = Math.min(Lp, this.s + this.v * dt); }
      const q = this.path.at(this.s); g.position.set(q.x, 0, q.z); hT = q.heading;
      if (this.act !== 'walk') { this.act = 'walk'; w.setAction(o.walkAction || 'stand'); }
      if (this.s >= Lp - 1e-3) { this.done = true; this.v = 0; }
    }
    if (this.done) { if (tg[2] !== undefined) hT = tg[2]; if (this.act !== 'act') { this.act = 'act'; w.setAction(o.action || 'stand'); } }
    const yaw = -g.rotation.y, e = wrapAngle(hT - yaw); g.rotation.y = -(yaw + clamp(e, -2.6 * dt, 2.6 * dt));
    w.update(dtw, { headingTarget: hT });
  }
  // posición dirigida (el objetivo se mueve suavemente); si está lejos, primero camina hasta él
  drive(dt, x, y, z, face, action, fast) {
    const w = this.w, g = w.group, d = Math.hypot(x - g.position.x, z - g.position.z);
    if (d > 0.8 && !fast) { this.goto([x, z, face], { action }); this.update(dt, fast); return; }
    this.key = ''; this.target = null;
    const vx = x - g.position.x, vz = z - g.position.z, mv = Math.hypot(vx, vz);
    g.position.set(x, y, z);
    if (this.act !== 'drive:' + action) { this.act = 'drive:' + action; w.setAction(action); }
    let hT = face; if (mv > 2e-3 && action === 'stand') hT = Math.atan2(vz, vx);
    const yaw = -g.rotation.y, e = wrapAngle(hT - yaw); g.rotation.y = -(yaw + clamp(e, -3 * dt, 3 * dt));
    w.update(Math.min(dt, 0.05), { headingTarget: hT });
  }
}

// ---------------------------------------------------------------- Operarios de ronda: técnico de frío y supervisor
// Técnico: rondas exteriores (unidad condensadora); con condensador sucio o refrigeración cortada inspecciona la unidad;
// con falla de evaporador o desescarche entra (solo con la puerta abierta > 80 % y sin tráfico de carga), recorre el
// pasillo superior por la franja libre junto al rack y revisa el evaporador. Supervisor: vuelta lenta con tableta por el
// patio y, si la puerta está abierta, una pasada por la franja de maniobra. Ninguno cruza racks ni la ruta del montacargas.
export function createCrew(env) {
  const { X, L } = env, PI2 = PI / 2, crew = [];
  const P = (x, z) => [X(x), z], xr = (g) => g.position.x - X(0);
  const doorOK = () => env.doorFrac() > 0.8 && !env.traffic();
  // compuerta de la puerta: se espera antes de cruzar (desde fuera o desde dentro); ya en el vano se sigue
  const gateIn = (w) => () => { const x = xr(w.w.group); return !(x > -1.15 && x < -0.55) || doorOK(); };
  const gateOut = (w) => () => { const x = xr(w.w.group); return !(x > -0.1 && x < 0.45) || doorOK(); };
  if (env.workers.tech) {
    const w = new Walker(env.workers.tech), home = [...P(-0.4, 4.75), -PI2];
    const out = [P(-0.4, 4.75), P(L + 0.45, 4.75), P(L + 0.45, -0.7)], cu = [...P(L + 1.45, -1.05), -PI2];
    const zA = env.aisleZ + 0.52, inn = [P(-0.9, 1.0), P(0.35, 1.0), P(0.8, zA), P(10.95, zA)], ev = [...P(11.25, 0.75), 0];
    const T = { mode: 'home', t: 0, w };
    T.step = (dt, fast) => {
      const f = env.flags(); T.t += dt;
      const go = (m) => { T.mode = m; T.t = 0; };
      switch (T.mode) {
        case 'home': w.goto(home, { action: 'stand' }); if (w.arrived && (f.evap || f.cond || T.t > 30)) go(f.evap ? 'toEvap' : 'toCU'); break;
        case 'toCU': w.goto(cu, { action: 'inspect', via: out.slice(1, 3) }); if (w.arrived && T.t > 16 && !f.cond) go('backCU'); else if (w.arrived && f.evap && !f.cond) go('backCU'); break;
        case 'backCU': w.goto(home, { action: 'stand', via: [out[2], out[1]] }); if (w.arrived) go('home'); break;
        case 'toEvap': w.goto(ev, { action: 'inspect', via: inn, gate: gateIn(w) }); env.setTechAisle(xr(w.w.group) > 0.6); if (w.arrived && !f.evap && T.t > 20) go('back'); break;
        case 'back': w.goto(home, { action: 'stand', via: inn.slice().reverse(), gate: gateOut(w) }); env.setTechAisle(xr(w.w.group) > 0.6); if (w.arrived) { go('home'); env.setTechAisle(false); } break;
      }
      w.update(dt, fast);
    };
    crew.push(T);
  }
  if (env.workers.sup) {
    const w = new Walker(env.workers.sup), a = [...P(-0.9, 3.3), -PI2], b = [...P(-4.9, 3.7), Math.atan2(-3.7, -1.8)], c = [...P(0.75, 2.75), 0];
    const S = { mode: 'a', t: 0, laps: 0, w };
    S.step = (dt, fast) => {
      S.t += dt; const go = (m) => { S.mode = m; S.t = 0; };
      switch (S.mode) {
        case 'a': w.goto(a, { action: 'inspect', speed: 0.9 }); if (w.arrived && S.t > 10) go(S.laps++ % 2 && doorOK() ? 'in' : 'b'); break;
        case 'b': w.goto(b, { action: 'inspect', speed: 0.9, via: [P(-2.6, 4.2)] }); if (w.arrived && S.t > 14) go('a2'); break;
        case 'a2': w.goto([...P(-0.9, 4.3), PI2], { action: 'stand', speed: 0.9, via: [P(-3.2, 4.4)] }); if (w.arrived && S.t > 4) go('a'); break;
        case 'in': w.goto(c, { action: 'inspect', speed: 0.9, via: [P(-0.9, 1.15), P(0.35, 1.15)], gate: gateIn(w) }); if (w.arrived && S.t > 12) go('out'); break;
        case 'out': w.goto(a, { action: 'inspect', speed: 0.9, via: [P(0.35, 1.15), P(-0.9, 1.15)], gate: gateOut(w) }); if (w.arrived) go('b'); break;
      }
      w.update(dt, fast);
    };
    crew.push(S);
  }
  return { update(dt, fast) { for (const c of crew) c.step(dt, fast); }, crew };
}
