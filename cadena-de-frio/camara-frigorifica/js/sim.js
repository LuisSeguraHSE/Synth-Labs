// ORQUESTADOR: une los motores térmico, de refrigeración, de control y de eventos con paso fijo de 1 s.
// No toca el DOM ni Three.js: la misma instancia sirve para la vista en vivo y para la comparación A/B.
import { DEFAULTS, SCENARIOS, INSULATION, PID_PRESETS, PRODUCTS, GRID } from './config.js';
import { buildRoom, stepThermal, avgT, returnT, doorMassFlow, wFromRH, rhFromW, dewPoint } from './thermal.js';
import { airflow, evaporator, updateEvapState, accumulateEnergy } from './refrigeration.js';
import { updateControl, resetControl } from './control.js';
import { log, schedule, startDisturbance, processQueue, setDoor, updateDoor, setFail, startIngress, updateIngress, placeStock, updateRecovery, updatePulldown, freeSlots } from './events.js';
import { updateAlarms, excursionCount } from './alarms.js';

const SAMPLE = 30;      // s entre muestras del historial
const MAX_HIST = 20000;

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function sensorDefs(R) {
  const { nx, ny, jd } = R;
  return [
    { id: 'T-01', name: 'Salida evaporador', kind: 'supply', i: nx - 1, j: jd, k: 1 },
    { id: 'T-02', name: 'Retorno (control)', kind: 'return', i: nx - 1, j: jd, k: 0 },
    { id: 'T-03', name: 'Puerta / nivel alto', i: 0, j: jd, k: 1 },
    { id: 'T-04', name: 'Puerta / nivel medio', i: 0, j: jd, k: 0 },
    { id: 'T-05', name: 'Centro / nivel alto', i: 1, j: jd, k: 1 },
    { id: 'T-06', name: 'Centro / nivel bajo', i: 2, j: jd, k: 0 },
    { id: 'T-07', name: 'Esquina fondo · Rack 1', i: nx - 1, j: 0, k: 1 },
    { id: 'T-08', name: 'Esquina frente · Rack 3', i: 0, j: ny - 1, k: 0 },
    { id: 'T-09', name: 'Rack 1 · centro', i: 1, j: 0, k: 0 },
    { id: 'T-10', name: `Rack ${ny} · fondo alto`, i: 2, j: ny - 1, k: 1 },
  ].map((s) => ({ ...s, zone: R.zid(s.i, s.j, s.k), T: 0, rh: 0 }));
}

export function createSim(opts = {}) {
  const scKey = opts.scenario || 'normal', sc = SCENARIOS[scKey];
  const p = { ...DEFAULTS, ...sc.params, ...(opts.params || {}) };
  if (!opts.params || opts.params.U === undefined) p.U = INSULATION[p.insulation].U;
  const R = buildRoom(p);
  const st = {
    t: 0, R, scenario: scKey, rng: mulberry32(opts.seed ?? 7),
    T: new Float64Array(R.n).fill(p.sp), dQ: new Float64Array(R.n),
    w: wFromRH(p.sp, 88), wExt: wFromRH(p.tExt, p.rhExt), mTr: 0,
    pallets: [], nextId: 1, batches: [], queue: [], log: [], ingress: null, forklift: null,
    door: { cmd: false, frac: 0, openedAt: null, mInf: 0, Q: 0, loadJ: 0, elecJ: 0, lastDur: 0, totalOpen: 0, count: 0 },
    evap: { frost: 0, defrostLeft: 0, nextDefrost: p.defrostEvery * 3600, count: 0 },
    ctrl: { on: false, u: 0, uCmd: 0, I: 0, dF: 0, prevT: null, lastSwitch: -1e4, starts: 0, spEff: null, e: 0, P: 0, Iterm: 0, D: 0, raw: 0, sat: false, since: 0, lockLeft: 0, why: '' },
    cut: false, cutUntil: -1,
    air: { fanCmd: 0, fanFrac: 0, Vdot: 0, mdot: 0, col: new Array(R.ny).fill(0), vRatio: new Array(R.ny).fill(0) },
    evapOut: { Q: 0, Qs: 0, Qlat: 0, Qcomp: 0, Qair: 0, avail: 0, airLimited: false, Tevap: p.sp, Tsup: p.sp, eps: 0, mCond: 0, cop: 3, TD: 3 },
    elec: { comp: 0, fan: 0, defrost: 0, lights: 0, total: 0 },
    energy: { J: 0, compJ: 0, fanJ: 0, otherJ: 0, coolJ: 0 },
    loads: { walls: 0, door: 0, doorLat: 0, product: 0, lights: 0, fans: 0, other: 0 },
    rec: { active: null, list: [], pBase: 4000 },
    alarms: { active: [], timers: {}, count: 0 },
    kpi: { Tavg: p.sp, TaSlow: p.sp, Tret: p.sp, rh: 88, Ts: p.sp, Tc: p.sp, hot: null, condRisk: 'bajo', excursion: 0, occ: 0, oscMin: p.sp, oscMax: p.sp },
    hist: [], nextSample: 0, occ: 0, colOcc: new Array(R.ny).fill(0),
  };
  st.sensors = sensorDefs(R).map((s) => ({ ...s, T: p.sp, rh: 88 }));
  placeStock(st, p, sc.stock);
  (sc.events || []).forEach((e) => schedule(st, { ...e }));
  log(st, 'start', `Inicio · escenario "${sc.name}"`, 'info');

  function occupancy() {
    const used = R.slots.filter((s) => s.used);
    st.occ = used.length / R.slots.length;
    for (let j = 0; j < R.ny; j++) st.colOcc[j] = used.filter((s) => s.j === j).length / R.slotsPerCol;
  }

  function kpis(dt) {
    const k = st.kpi, T = st.T;
    k.Tavg = avgT(st, R); k.TaSlow += ((k.Tavg - k.TaSlow) * dt) / 600; k.Tret = returnT(st, R);
    k.rh = rhFromW(k.Tavg, st.w);
    let hz = 0; for (let z = 1; z < R.n; z++) if (T[z] > T[hz]) hz = z;
    k.hot = { zone: hz, T: T[hz], name: R.zones[hz].name };
    // Producto (promedio ponderado por masa de lo que está dentro de la cámara)
    let m = 0, s = 0, c = 0, hotP = null, ranges = null;
    for (const q of st.pallets) {
      if (q.state === 'outside') continue;
      m += q.m; s += q.m * q.Ts; c += q.m * q.Tc;
      if (!hotP || q.Tc > hotP.Tc) hotP = q;
      const r = PRODUCTS[q.prod].rh; ranges = ranges ? [Math.max(ranges[0], r[0]), Math.min(ranges[1], r[1])] : [...r];
    }
    k.Ts = m ? s / m : null; k.Tc = m ? c / m : null; k.hotPallet = hotP; k.rhRange = ranges; k.mass = m;
    // Condensación cerca de la puerta: punto de rocío local vs superficie más fría del sector.
    const wLoc = st.w + st.door.frac * 0.5 * (st.wExt - st.w), Td = dewPoint(wLoc);
    let Tsurf = Math.min(T[R.doorZone], T[R.zid(0, R.jd, 1)]);
    for (const q of st.pallets) if (q.state !== 'outside' && (q.state === 'moving' || R.zones[q.zone].i === 0)) Tsurf = Math.min(Tsurf, q.Ts);
    const margin = Td - Tsurf;
    k.dew = Td; k.condMargin = margin; k.condRisk = margin > 0.5 ? 'alto' : margin > -0.5 ? 'medio' : 'bajo';
    k.excursion = excursionCount(st);
  }

  function sensorsUpdate(dt) {
    for (const s of st.sensors) {
      const target = s.kind === 'supply' ? st.evapOut.Tsup : s.kind === 'return' ? st.kpi.Tret : st.T[s.zone];
      s.T += ((target - s.T) * dt) / 30;
      const w = s.i === 0 ? st.w + st.door.frac * 0.5 * (st.wExt - st.w) : st.w;
      s.rh = rhFromW(s.T, w);
    }
  }

  function sample() {
    const L = st.loads, total = Math.max(0, L.product) + Math.max(0, L.door) + L.doorLat + Math.max(0, L.walls) + L.lights + L.fans + L.other;
    st.hist.push({
      t: st.t, Ta: st.kpi.Tavg, Tr: st.kpi.Tret, Ts: st.kpi.Ts, Tc: st.kpi.Tc, sp: st.ctrl.spEff ?? p.sp, lim: p.sp + p.alarmOffset,
      load: total / 1000, cool: st.evapOut.Q / 1000, elec: st.elec.total / 1000, u: st.ctrl.u, rh: st.kpi.rh,
      s: st.sensors.map((x) => [x.T, x.rh]),
    });
    if (st.hist.length > MAX_HIST) st.hist.shift();
  }

  function step(dt = 1) {
    st.t += dt;
    const cut = st.t < st.cutUntil;
    if (st.cut && !cut) log(st, 'fail', 'Energía restablecida', 'info');
    st.cut = cut;
    processQueue(st, p, R);
    updateDoor(st, dt);
    updateIngress(st, p, R);
    occupancy();
    st.wExt = wFromRH(p.tExt, p.rhExt);
    airflow(st, p, R);
    const Tret = returnT(st, R);
    updateControl(st, p, dt, Tret);
    evaporator(st, p, Tret);
    const Td = st.T[R.zid(0, R.jd, 1)];
    st.door.mInf = doorMassFlow(p, st.door.frac, Td);
    stepThermal(st, p, R, dt);
    updateEvapState(st, p, dt, (k, t, l) => log(st, k, t, l));
    accumulateEnergy(st, p, dt);
    const d = st.door;
    d.Q = d.mInf > 0 ? d.mInf * (1005 * (p.tExt - Td) + Math.max(0, st.wExt - st.w) * 2.5e6) : 0;
    if (d.cmd || d.frac > 0) { d.loadJ += d.Q * dt; d.elecJ += (d.Q / st.evapOut.cop) * dt; }
    kpis(dt);
    updateRecovery(st, p, dt);
    updatePulldown(st, p);
    updateAlarms(st, p, dt);
    sensorsUpdate(dt);
    if (st.t >= st.nextSample) { sample(); st.nextSample += SAMPLE; }
  }

  // Pre-simulación silenciosa (1 h) para arrancar con el sistema asentado a mitad de ciclo.
  const held = st.queue; st.queue = [];
  for (let i = 0; i < (opts.warmup ?? 3600); i++) step(1);
  const W = st.t;
  Object.assign(st, { t: 0, queue: held, hist: [], nextSample: 0 });
  st.log = st.log.filter((l) => l.kind === 'start'); st.log.forEach((l) => (l.t = 0));
  st.energy = { J: 0, compJ: 0, fanJ: 0, otherJ: 0, coolJ: 0 };
  st.ctrl.starts = 0; st.ctrl.lastSwitch -= W; st.evap.nextDefrost = p.defrostEvery * 3600; st.evap.count = 0;
  st.alarms = { active: [], timers: {}, count: 0 }; st.rec = { active: null, list: [], pBase: st.rec.pBase };
  sample(); st.nextSample = SAMPLE;

  // ---------- API para la UI ----------
  const api = {
    st, p, R, step,
    advance(sec) { for (let i = 0; i < sec; i++) step(1); },
    setParam(key, val, label) {
      const from = p[key];
      if (from === val) return;
      p[key] = val;
      if (key === 'insulation') p.U = INSULATION[val].U;
      if (key === 'control') resetControl(st.ctrl);
      if (key === 'pidPreset') Object.assign(p, { Kp: PID_PRESETS[val].Kp, Ki: PID_PRESETS[val].Ki, Kd: PID_PRESETS[val].Kd });
      if (key === 'evapFail') { p[key] = from; setFail(st, p, val); return; }
      if (key === 'defrostEvery') st.evap.nextDefrost = st.t + val * 3600;
      if (label) log(st, 'user', label, 'user');
    },
    door(open) { setDoor(st, open, 'usuario'); },
    ingress(spec) { return startIngress(st, p, R, spec); },
    freeSlots: () => freeSlots(st),
    powerCut(min) { st.cutUntil = st.t + min * 60; st.cut = true; log(st, 'fail', `Corte de energía (${min} min): compresor, ventiladores y luces detenidos`, 'crit'); startDisturbance(st, 'Corte de energía'); schedule(st, { t: st.cutUntil + 1, type: 'endDist' }); },
    doorPulse(sec) { setDoor(st, true, 'pulso'); schedule(st, { t: st.t + sec, type: 'door', open: false }); },
    defrostNow() { if (st.evap.defrostLeft <= 0) { st.evap.nextDefrost = st.t; } },
  };
  return api;
}

// Corre un escenario sin interfaz y devuelve KPIs comparables (comparación A/B).
export function runHeadless(scenario, params, seconds, seed = 7) {
  const sim = createSim({ scenario, params, seed });
  const st = sim.st, p = sim.p;
  let above = 0, n = 0, s2 = 0, Tmax = -99, ema = st.kpi.Tavg;
  const trace = [];
  for (let i = 0; i < seconds; i++) {
    sim.step(1);
    const T = st.kpi.Tavg;
    ema += (T - ema) / 3600; // tendencia (τ = 60 min): la oscilación es lo que queda al restarla
    if (T > p.sp + p.alarmOffset) above++;
    Tmax = Math.max(Tmax, T);
    if (i > 1800 && !st.door.cmd && !st.ingress) { n++; s2 += (T - ema) ** 2; }
    if (i % 60 === 0) trace.push([i, T]);
  }
  const std = n > 10 ? Math.sqrt(s2 / n) : 0;
  const recs = st.rec.list, kWh = st.energy.J / 3.6e6;
  const pd = st.batches.filter((b) => b.done);
  return {
    sim, trace,
    kWh, cost: kWh * p.tariff, osc: 2 * std, Tmax,
    recovery: recs.length ? recs.reduce((a, r) => a + r.recMin, 0) / recs.length : null,
    pulldown: pd.length ? pd.reduce((a, b) => a + (b.tDone - b.tStart), 0) / pd.length / 60 : null,
    TcEnd: st.kpi.Tc, starts: st.ctrl.starts, aboveMin: above / 60, alarms: st.alarms.count,
    copAvg: st.energy.coolJ / Math.max(1, st.energy.compJ), rh: st.kpi.rh,
  };
}

export { GRID };
