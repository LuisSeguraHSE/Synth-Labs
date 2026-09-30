// MOTOR DE EVENTOS: programación de eventos, puerta, ingreso de pallets, fallas, línea de tiempo
// y seguimiento de perturbaciones (recuperación) y enfriamiento de lotes (pull-down).
import { PRODUCTS } from './config.js';
import { makePallet } from './thermal.js';

export const fmtDur = (s) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};

export function log(st, kind, text, level = 'info') {
  st.log.push({ t: st.t, kind, text, level });
  if (st.log.length > 600) st.log.shift();
}

// ---------- Programación ----------
export function schedule(st, e) { st.queue.push(e); st.queue.sort((a, b) => a.t - b.t); }

export function processQueue(st, p, R) {
  while (st.queue.length && st.queue[0].t <= st.t) {
    const e = st.queue.shift();
    if (e.type === 'door') setDoor(st, e.open, e.auto ? 'auto' : 'programado');
    else if (e.type === 'doorCycle') {
      const dur = e.dur * (0.8 + 0.4 * st.rng());
      schedule(st, { t: st.t, type: 'door', open: true, auto: true });
      schedule(st, { t: st.t + dur, type: 'door', open: false, auto: true });
      schedule(st, { ...e, t: st.t + e.every * (0.8 + 0.4 * st.rng()) });
    } else if (e.type === 'ingress') startIngress(st, p, R, e);
    else if (e.type === 'fail') setFail(st, p, e.on);
    else if (e.type === 'endDist') endDisturbance(st);
  }
}

// ---------- Puerta ----------
export function setDoor(st, open, source = 'usuario') {
  const d = st.door;
  if (open && !d.cmd) {
    d.cmd = true; d.openedAt = st.t; d.loadJ = 0; d.elecJ = 0; d.count++;
    log(st, 'door', `Puerta abierta (${source})`, 'warn');
    startDisturbance(st, 'Puerta abierta');
  } else if (!open && d.cmd) {
    d.cmd = false; d.lastDur = st.t - d.openedAt; d.totalOpen += d.lastDur;
    log(st, 'door', `Puerta cerrada tras ${fmtDur(d.lastDur)} · +${(d.elecJ / 3.6e6).toFixed(2)} kWh`, 'info');
    endDisturbance(st);
  }
}

export function updateDoor(st, dt) {
  const d = st.door, target = d.cmd ? 1 : 0;
  d.frac += Math.sign(target - d.frac) * Math.min(Math.abs(target - d.frac), dt / 4);
}

// ---------- Fallas ----------
export function setFail(st, p, on) {
  if (p.evapFail === on) return;
  p.evapFail = on;
  log(st, 'fail', on ? 'FALLA de evaporador: 1 ventilador detenido y serpentín con hielo' : 'Evaporador reparado', on ? 'crit' : 'info');
  if (on) startDisturbance(st, 'Falla de evaporador'); else endDisturbance(st);
}

// ---------- Ingreso de pallets ----------
export function freeSlots(st) { return st.R.slots.filter((s) => !s.used).length; }

function pickSlot(st, dist) {
  const free = st.R.slots.filter((s) => !s.used);
  if (!free.length) return null;
  const key = dist === 'concentrada' ? (s) => (s.j * 1000 + s.q) * 10 + s.k : (s) => (s.q * 10 + s.k) * 10 + ((s.j + 1) % st.R.ny);
  free.sort((a, b) => key(a) - key(b));
  return free[0];
}

export function placeStock(st, p, stock) {
  const pr = stock.product || 'arandano', T0 = stock.T ?? p.sp + 0.3;
  for (let i = 0; i < stock.n; i++) {
    const s = pickSlot(st, stock.dist || 'distribuida');
    if (!s) break;
    s.used = true;
    st.pallets.push(makePallet(st.nextId++, pr, T0, s, 0));
  }
}

export function startIngress(st, p, R, e) {
  if (st.ingress) { log(st, 'ingress', 'Ingreso rechazado: hay otro ingreso en curso', 'warn'); return false; }
  const n = Math.min(e.n, freeSlots(st));
  if (n <= 0) { log(st, 'ingress', 'Ingreso rechazado: cámara llena', 'warn'); return false; }
  const pr = PRODUCTS[e.product];
  const batch = { id: st.batches.length + 1, product: e.product, n, T0: e.T0, tStart: st.t, tArrived: null, done: false, tDone: null, est: null };
  st.batches.push(batch);
  st.ingress = { batch, left: n, trip: null, tripDur: 45, dist: e.dist, keepDoor: e.keepDoor !== false, openedDoor: false };
  log(st, 'ingress', `+${n} pallets de ${pr.name} a ${e.T0} °C (${(n * pr.kg).toLocaleString('es')} kg)`, 'warn');
  startDisturbance(st, `Ingreso de ${n} pallets`);
  if (st.ingress.keepDoor && !st.door.cmd) { setDoor(st, true, 'ingreso'); st.ingress.openedDoor = true; }
  return true;
}

export function updateIngress(st, p, R) {
  const g = st.ingress;
  st.forklift = null;
  if (!g) return;
  if (!g.trip && g.left > 0) {
    const s = pickSlot(st, g.dist);
    if (!s) { g.left = 0; } else {
      s.used = true;
      const pal = makePallet(st.nextId++, g.batch.product, g.batch.T0, s, g.batch.id);
      pal.state = 'outside'; pal.tIn = st.t;
      st.pallets.push(pal);
      g.trip = { pal, t0: st.t };
      if (!g.keepDoor && !st.door.cmd) { setDoor(st, true, 'paso de pallet'); g.tripDoor = true; }
    }
  }
  if (g.trip) {
    const f = (st.t - g.trip.t0) / g.tripDur, pal = g.trip.pal;
    pal.progress = Math.min(1, f);
    if (f > 0.3 && pal.state === 'outside') pal.state = 'moving';
    if (g.tripDoor && f > 0.45) { setDoor(st, false); g.tripDoor = false; }
    st.forklift = { zone: f < 0.6 ? R.doorZone : pal.slot.zone, W: p.forkliftKW * 1000, pal };
    if (f >= 1) { pal.state = 'stored'; pal.progress = 1; g.left--; g.trip = null; }
  }
  if (!g.trip && g.left <= 0) {
    g.batch.tArrived = st.t;
    log(st, 'ingress', `Ingreso completado: lote ${g.batch.id} en cámara (${fmtDur(st.t - g.batch.tStart)})`, 'info');
    if (g.openedDoor && st.door.cmd) setDoor(st, false, 'ingreso');
    st.ingress = null;
    endDisturbance(st);
  }
}

// ---------- Perturbaciones y recuperación ----------
export function startDisturbance(st, label) {
  const r = st.rec;
  if (r.active) { r.active.open++; r.active.tEnd = null; if (!r.active.label.includes(label)) r.active.label += ' + ' + label; return; }
  r.active = { label, tStart: st.t, tEnd: null, open: 1, Tmax: st.kpi.Tavg, E0: st.energy.J, pBase: r.pBase, okFor: 0, Tref: st.kpi.TaSlow };
}

export function endDisturbance(st) {
  const a = st.rec.active;
  if (!a) return;
  a.open = Math.max(0, a.open - 1);
  if (a.open === 0) a.tEnd = st.t;
}

export function updateRecovery(st, p, dt) {
  const r = st.rec, a = r.active, Tavg = st.kpi.Tavg;
  if (!a) { r.pBase += ((st.elec.total - r.pBase) * dt) / 600; return; }
  a.Tmax = Math.max(a.Tmax, Tavg);
  if (a.tEnd === null) return;
  // Recuperado = el aire vuelve a su nivel previo al evento (+0,3 K) y no quedan puntos calientes.
  const ref = Math.max(a.Tref, p.sp - (p.control === 'onoff' ? p.hyst : 0.5)) + 0.3;
  a.ref = ref;
  a.okFor = Tavg <= ref && st.kpi.hot.T <= ref + 1.5 ? a.okFor + dt : 0;
  if (a.okFor >= 60) {
    const t = st.t - a.okFor;
    a.recMin = Math.max(0, (t - a.tEnd) / 60);
    a.durMin = (a.tEnd - a.tStart) / 60;
    a.extraKWh = Math.max(0, (st.energy.J - a.E0 - a.pBase * (st.t - a.tStart)) / 3.6e6);
    a.tRec = t;
    r.list.push(a); r.active = null;
    log(st, 'recovery', `Setpoint recuperado tras "${a.label}": ${a.recMin.toFixed(0)} min · T máx ${a.Tmax.toFixed(1)} °C · +${a.extraKWh.toFixed(2)} kWh`, 'ok');
  }
}

// ---------- Pull-down de lotes ----------
export function batchTarget(b, p) { return Math.max(PRODUCTS[b.product].tObj, p.sp + 1); }

export function updatePulldown(st, p) {
  for (const b of st.batches) {
    if (b.done || b.id === 0) continue;
    const pals = st.pallets.filter((q) => q.batch === b.id && q.state !== 'outside');
    if (!pals.length) continue;
    const Tc = pals.reduce((s, q) => s + q.Tc, 0) / pals.length, Ts = pals.reduce((s, q) => s + q.Ts, 0) / pals.length;
    // Aire esperado en régimen: la media lenta, acotada al setpoint para no penalizar el transitorio.
    const target = batchTarget(b, p), Ta = Math.min(st.kpi.TaSlow, p.sp), el = st.t - b.tStart;
    b.Tc = Tc; b.Ts = Ts; b.target = target;
    b.progress = Math.max(0, Math.min(1, (b.T0 - Tc) / Math.max(0.1, b.T0 - target)));
    b.est = null; b.reachable = target > Ta + 0.1;
    if (el > 900 && b.T0 - Ta > 0.5 && Tc - Ta > 0.05 && b.T0 - Tc > 0.2) {
      const tau = el / Math.log((b.T0 - Ta) / (Tc - Ta));
      if (b.reachable && isFinite(tau) && tau > 0) b.est = tau * Math.log((b.T0 - Ta) / (target - Ta));
    }
    if (Tc <= target && b.tArrived !== null) {
      b.done = true; b.tDone = st.t;
      log(st, 'pulldown', `Pull-down completado: lote ${b.id} (${b.n} pallets) de ${b.T0} a ${target.toFixed(1)} °C en ${fmtDur(st.t - b.tStart)}`, 'ok');
    }
  }
}
