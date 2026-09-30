// MOTOR DE REFRIGERACIÓN: ventiladores (caudal y reparto por columna), evaporador (ε-NTU),
// capacidad equivalente del compresor, COP, potencia eléctrica, escarcha y desescarche.
import { wsat } from './thermal.js';

const CP_AIR = 1005, HFG = 2.5e6;

export function airflow(st, p, R) {
  const defrost = st.evap.defrostLeft > 0;
  const fanCmd = p.fan / 100;
  const fanFrac = defrost ? 0 : fanCmd * (p.evapFail ? 0.3 : 1);
  const occ = st.occ, Vdot = p.fanFlow * fanFrac * (1 - 0.3 * occ);
  // Reparto por columna: una columna llena de pallets ofrece más resistencia y recibe menos aire.
  const w = st.colOcc.map((o) => 1.05 - 0.7 * o), sw = w.reduce((a, b) => a + b, 0);
  const col = w.map((x) => (1.25 * Vdot * x) / sw);           // [kg/s] por columna
  const Vref = (p.fanFlow * 0.7 * 0.82) / R.ny;               // caudal de referencia por columna (70 % ventilador)
  st.air = { fanCmd, fanFrac, Vdot, mdot: 1.25 * Vdot, col, vRatio: col.map((m) => m / 1.25 / Vref) };
  st.elec.fan = defrost ? 0 : p.fanPow * 1000 * Math.pow(fanCmd, 3) * (p.evapFail ? 0.67 : 1);
}

export function evaporator(st, p, Tret) {
  const e = st.evap, a = st.air, u = st.ctrl.u;
  const avail = p.refrigOn && e.defrostLeft <= 0 ? p.capNom * 1000 * (p.capAvail / 100) : 0;
  const Qcomp = u * avail;
  const TD = 3 + 7 * u;                      // diferencia aire-evaporación: sube con la carga del compresor
  const Tevap = Tret - TD, mcp = a.mdot * CP_AIR;
  let Qair = 0, eps = 0;
  if (mcp > 1) {
    const UA = p.UAcoil * 1000 * Math.sqrt(Math.max(a.fanFrac, 1e-3)) * (p.evapFail ? 0.35 : 1) / (1 + e.frost / 200);
    eps = 1 - Math.exp(-UA / mcp);
    Qair = eps * mcp * TD;                   // lo máximo que el serpentín puede extraer con ese caudal
  }
  const Q = Qcomp > 0 ? Math.min(Qcomp, Qair) : 0;
  let mCond = 0;
  if (Q > 0) mCond = Math.max(0, eps * a.mdot * (st.w - wsat(Tevap + 1))) * Math.min(1, Q / Math.max(Qair, 1));
  let Qlat = mCond * HFG;
  if (Qlat > 0.6 * Q) { Qlat = 0.6 * Q; mCond = Qlat / HFG; }
  const Qs = Q - Qlat, Tsup = mcp > 1 ? Tret - Qs / mcp : Tret;
  const Te = Tevap + 273.15, Tc = p.tExt + 10 + 273.15;
  const cop = Math.min(7, Math.max(1.2, (p.eta * Te) / Math.max(5, Tc - Te)));
  st.evapOut = { Q, Qs, Qlat, Qcomp, Qair, avail, airLimited: Qcomp > Qair + 50 && Q > 0, Tevap, Tsup, eps, mCond, cop, TD };
  st.elec.comp = Q > 0 ? Q / cop : 0;
  st.elec.defrost = e.defrostLeft > 0 ? p.defrostKW * 1000 : 0;
  st.elec.lights = p.lights * 1000;
}

export function updateEvapState(st, p, dt, log) {
  const e = st.evap, o = st.evapOut;
  if (o.Tevap < 0) e.frost += o.mCond * dt * (p.evapFail ? 3 : 1);
  if (e.defrostLeft > 0) {
    e.defrostLeft -= dt;
    if (e.defrostLeft <= 0) { e.frost = 0; log('defrost', 'Desescarche finalizado', 'info'); }
  } else if (p.defrostEvery > 0 && st.t >= e.nextDefrost) {
    e.defrostLeft = p.defrostDur * 60; e.nextDefrost = st.t + p.defrostEvery * 3600; e.count++;
    log('defrost', `Desescarche iniciado (${p.defrostDur} min, escarcha ${e.frost.toFixed(0)} kg)`, 'info');
  }
}

export function accumulateEnergy(st, p, dt) {
  const E = st.energy, el = st.elec;
  const P = el.comp + el.fan + el.defrost + el.lights;
  el.total = P;
  E.J += P * dt; E.compJ += el.comp * dt; E.fanJ += el.fan * dt; E.otherJ += (el.defrost + el.lights) * dt;
  E.coolJ += st.evapOut.Q * dt;
}
