// MOTOR TÉRMICO: aire por zonas (4×3×2) + paredes + puerta + producto (superficie/núcleo) + humedad.
// Modelo de parámetros concentrados, integración explícita con paso fijo (1 s).
import { GRID, SLOT, PRODUCTS } from './config.js';

const CP_AIR = 1005, RHO = 1.25, HFG = 2.5e6, P_ATM = 101325;
const STRUCT = 2.5;      // multiplicador de capacidad térmica del aire (racks, superficies, embalaje vacío)
const M_LEAK = 0.02;   // infiltración de fondo por sellos [kg/s]

// ---------- Psicrometría (Magnus) ----------
export const pws = (T) => 610.94 * Math.exp((17.625 * T) / (T + 243.04));
export const wFromRH = (T, rh) => { const p = (pws(T) * rh) / 100; return (0.622 * p) / (P_ATM - p); };
export const pvFromW = (w) => (w * P_ATM) / (0.622 + w);
export const rhFromW = (T, w) => Math.min(100, (100 * pvFromW(w)) / pws(T));
export const wsat = (T) => wFromRH(T, 100);
export const dewPoint = (w) => { const a = Math.log(Math.max(1, pvFromW(w)) / 610.94); return (243.04 * a) / (17.625 - a); };

// ---------- Geometría ----------
export function buildRoom(p) {
  const { nx, ny, nz } = GRID;
  const dx = p.L / nx, dy = p.W / ny, dz = p.H / nz, n = nx * ny * nz;
  const zid = (i, j, k) => k * nx * ny + j * nx + i;
  const Vz = dx * dy * dz, Cz = RHO * CP_AIR * Vz * STRUCT;
  const iName = (i) => (i === 0 ? 'Puerta' : i === nx - 1 ? 'Fondo (evaporador)' : i < nx / 2 ? 'Centro-frente' : 'Centro-fondo');
  const zones = [], wallA = new Float64Array(n);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const z = zid(i, j, k);
    wallA[z] = (i === 0 ? dy * dz : 0) + (i === nx - 1 ? dy * dz : 0) + (j === 0 ? dx * dz : 0) + (j === ny - 1 ? dx * dz : 0) + dx * dy * ((k === 0 ? 1 : 0) + (k === nz - 1 ? 1 : 0));
    zones[z] = { i, j, k, x: (i + 0.5) * dx, y: (j + 0.5) * dy, h: (k + 0.5) * dz, name: `${iName(i)} · Rack ${j + 1} · nivel ${k ? 'alto' : 'bajo'}` };
  }
  // Posiciones de pallets: pasillo de maniobra junto a la puerta y despeje frente al evaporador.
  const avail = p.L - SLOT.lane - SLOT.back, nP = Math.max(1, Math.floor(avail / SLOT.pitch)), sp = avail / nP;
  const slots = [];
  for (let q = 0; q < nP; q++) for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
    const x = SLOT.lane + (q + 0.5) * sp, y = (j + 0.5) * dy, h = k * dz + 0.15;
    slots.push({ id: slots.length, q, j, k, x, y, h, zone: zid(Math.min(nx - 1, Math.floor(x / dx)), j, k), used: false });
  }
  const jd = Math.floor(ny / 2);
  const doorW = [[zid(0, jd, 1), 0.4], [zid(0, jd, 0), 0.3]];
  for (const j of [jd - 1, jd + 1]) if (j >= 0 && j < ny) doorW.push([zid(0, j, 1), 0.1], [zid(0, j, 0), 0.05]);
  const sw = doorW.reduce((a, d) => a + d[1], 0); doorW.forEach((d) => (d[1] /= sw));
  const slotsPerCol = slots.filter((s) => s.j === 0).length;
  return { nx, ny, nz, dx, dy, dz, n, zid, Vz, Cz, zones, wallA, slots, slotsPerCol, doorW, doorZone: zid(0, jd, 0), jd, Mair: RHO * p.L * p.W * p.H };
}

// ---------- Producto ----------
export function makePallet(id, prodKey, T0, slot, batch) {
  const pr = PRODUCTS[prodKey], m = pr.kg, sc = Math.pow(m / 480, 0.67);
  return { id, prod: prodKey, m, Cs: 0.12 * m * pr.cp, Cc: 0.88 * m * pr.cp, Ts: T0, Tc: T0, T0, sc, slot, zone: slot.zone, batch, state: 'stored', tIn: 0 };
}

export function palletHA(pal, st, p) {
  const vr = st.air.vRatio[pal.slot.j] || 0;
  return p.hAref * pal.sc * p.hAfac * (0.25 + 0.75 * Math.pow(vr, 0.8));
}

// ---------- Paso térmico ----------
export function stepThermal(st, p, R, dt) {
  const { nx, ny, zid } = R, T = st.T, dQ = st.dQ.fill(0);
  const a = st.air, ev = st.evapOut, Text = p.tExt;
  const L = st.loads; // [W]
  L.walls = 0; L.door = 0; L.doorLat = 0; L.product = 0; L.lights = p.lights * 1000; L.fans = st.elec.fan; L.other = 0;

  // 1) Advección: lazo por columna — techo (fondo→puerta), baja en la puerta, piso (puerta→fondo), retorno.
  for (let j = 0; j < ny; j++) {
    const mc = a.col[j] * CP_AIR;
    if (mc <= 0) continue;
    for (let i = nx - 1; i >= 0; i--) { const z = zid(i, j, 1), up = i === nx - 1 ? ev.Tsup : T[zid(i + 1, j, 1)]; dQ[z] += mc * (up - T[z]); }
    for (let i = 0; i < nx; i++) { const z = zid(i, j, 0), up = i === 0 ? T[zid(0, j, 1)] : T[zid(i - 1, j, 0)]; dQ[z] += mc * (up - T[z]); }
  }
  // 2) Mezcla turbulenta / convección natural entre zonas vecinas.
  const f = a.fanFrac, Gy = 80 + 400 * f, Gk = 60 + 250 * f, Gx = 40 + 100 * f;
  for (let k = 0; k < 2; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const z = zid(i, j, k);
    if (j + 1 < ny) { const z2 = zid(i, j + 1, k), q = Gy * (T[z2] - T[z]); dQ[z] += q; dQ[z2] -= q; }
    if (i + 1 < nx) { const z2 = zid(i + 1, j, k), q = Gx * (T[z2] - T[z]); dQ[z] += q; dQ[z2] -= q; }
    if (k === 0) { const z2 = zid(i, j, 1), q = Gk * (T[z2] - T[z]); dQ[z] += q; dQ[z2] -= q; }
  }
  // 3) Paredes, techo y piso: Q = U·A·(Text − Tint)
  for (let z = 0; z < R.n; z++) { const q = p.U * R.wallA[z] * (Text - T[z]); dQ[z] += q; L.walls += q; }
  // 4) Puerta (intercambio por diferencia de densidad) + infiltración de fondo.
  const mInf = st.door.mInf + M_LEAK;
  for (const [z, w] of R.doorW) { const q = w * mInf * CP_AIR * (Text - T[z]); dQ[z] += q; L.door += q; }
  L.doorLat = Math.max(0, mInf * (st.wExt - st.w) * HFG);
  // 5) Ganancias internas: iluminación, ventiladores, resistencias de desescarche, montacargas.
  for (let z = 0; z < R.n; z++) dQ[z] += L.lights / R.n;
  const back = []; for (let j = 0; j < ny; j++) back.push(zid(nx - 1, j, 1));
  const defrostHeat = st.evap.defrostLeft > 0 ? 0.35 * p.defrostKW * 1000 : 0;
  for (const z of back) dQ[z] += (L.fans + defrostHeat) / ny;
  L.other = defrostHeat;
  if (st.forklift) { dQ[st.forklift.zone] += st.forklift.W; L.other += st.forklift.W; }
  // 6) Producto: aire → superficie → núcleo (+ respiración en el núcleo) y transpiración.
  let mTr = 0; const pv = pvFromW(st.w);
  for (const pal of st.pallets) {
    if (pal.state === 'outside') continue;
    const z = pal.state === 'moving' ? R.doorZone : pal.zone;
    const pr = PRODUCTS[pal.prod], hA = palletHA(pal, st, p), Ksc = p.Ksc * pal.sc;
    const qas = hA * (T[z] - pal.Ts), qsc = Ksc * (pal.Ts - pal.Tc), qr = pr.resp * pal.m * Math.exp(0.07 * pal.Tc);
    pal.Ts += (dt * (qas - qsc)) / pal.Cs;
    pal.Tc += (dt * (qsc + qr)) / pal.Cc;
    dQ[z] -= qas; L.product -= qas;
    mTr += pr.tr * pal.m * Math.max(0, 0.98 * pws(pal.Ts) - pv);
  }
  // 7) Integración de temperaturas de aire.
  for (let z = 0; z < R.n; z++) T[z] += (dQ[z] * dt) / R.Cz;
  // 8) Humedad (un nodo): infiltración + transpiración − condensación en el evaporador.
  st.w += ((mInf * (st.wExt - st.w) + mTr - ev.mCond) * dt) / (R.Mair * 3);
  st.w = Math.max(1e-4, Math.min(st.w, wsat(avgT(st, R)) * 1.0));
  st.mTr = mTr;
}

export function avgT(st, R) { let s = 0; for (let z = 0; z < R.n; z++) s += st.T[z]; return s / R.n; }
export function returnT(st, R) {
  // Aire de retorno: mezcla de las zonas bajas del fondo, ponderada por el caudal de cada columna.
  let s = 0, m = 0;
  for (let j = 0; j < R.ny; j++) { const w = st.air.col[j] + 1e-6; s += w * st.T[R.zid(R.nx - 1, j, 0)]; m += w; }
  return s / m;
}

// Intercambio por puerta abierta (flujo por diferencia de densidad, tipo Tamm/Gosney simplificado).
export function doorMassFlow(p, frac, Tin) {
  if (frac <= 0) return 0;
  const dT = Math.max(0, p.tExt - Tin), Tabs = p.tExt + 273.15;
  const V = p.doorCd * ((p.doorW * p.doorH) / 3) * Math.sqrt((9.81 * p.doorH * dT) / Tabs) * frac * (p.curtain ? 0.25 : 1);
  return 1.18 * V; // [kg/s] aire exterior que entra (y el mismo caudal frío que sale)
}
