// Reglas de explicación: causa dominante, "¿Qué está pasando?" y consecuencias de cada cambio.
// Sin IA: todo sale del estado del modelo, así el texto siempre es coherente con las curvas.
import { PRODUCTS } from './config.js';
import { fmtDur } from './events.js';

const kW = (w) => (w / 1000).toFixed(1) + ' kW';

export function loadBreakdown(st) {
  const L = st.loads;
  const items = [
    { key: 'product', label: 'Producto', W: Math.max(0, L.product) },
    { key: 'door', label: 'Puerta e infiltración', W: Math.max(0, L.door) + L.doorLat },
    { key: 'walls', label: 'Paredes, techo y piso', W: Math.max(0, L.walls) },
    { key: 'lights', label: 'Iluminación', W: L.lights },
    { key: 'fans', label: 'Ventiladores', W: L.fans },
    { key: 'other', label: 'Otros (montacargas, desescarche)', W: L.other },
  ];
  return { items, total: items.reduce((a, b) => a + b.W, 0), cool: st.evapOut.Q };
}

export function dominantCause(st, p) {
  if (!p.refrigOn) return { key: 'off', text: 'Refrigeración apagada' };
  if (p.evapFail) return { key: 'fail', text: 'Falla de evaporador: flujo de aire y capacidad reducidos' };
  if (st.evap.defrostLeft > 0) return { key: 'defrost', text: 'Desescarche en curso: la refrigeración está detenida' };
  const { items } = loadBreakdown(st), top = [...items].sort((a, b) => b.W - a.W)[0];
  const recentDoor = st.door.cmd || (st.door.openedAt !== null && st.t - (st.door.openedAt + st.door.lastDur) < 900);
  if (st.door.cmd || (recentDoor && top.key === 'door')) return { key: 'door', text: 'Apertura prolongada de puerta' };
  if (top.key === 'product') return { key: 'product', text: 'Producto ingresado caliente: su calor supera la capacidad disponible' };
  if (st.evapOut.airLimited && p.fan < 60) return { key: 'fan', text: 'Ventilación insuficiente: el evaporador está limitado por el flujo de aire' };
  if (p.capAvail < 80) return { key: 'cap', text: 'Capacidad frigorífica disponible reducida' };
  if (p.tExt >= 35) return { key: 'ambient', text: 'Ambiente exterior extremo' };
  return { key: 'load', text: 'La carga térmica supera la capacidad frigorífica disponible' };
}

export const ACTIONS = {
  off: 'Encender la refrigeración y verificar la recuperación.',
  fail: 'Revisar el ventilador detenido y desescarchar el serpentín; evitar aperturas hasta repararlo.',
  defrost: 'Esperar el fin del desescarche y verificar la recuperación.',
  door: 'Cerrar la puerta y verificar la recuperación.',
  product: 'Mantener la puerta cerrada, subir ventiladores y pre-enfriar el producto antes de ingresarlo.',
  fan: 'Aumentar la velocidad de los ventiladores.',
  cap: 'Restituir la capacidad frigorífica disponible.',
  ambient: 'Reducir aperturas y revisar condensador y aislamiento.',
  load: 'Reducir la carga (aperturas, ingresos) o aumentar la capacidad.',
};

function trend(st) {
  const h = st.hist;
  if (h.length < 4) return 0;
  const a = h[Math.max(0, h.length - 21)], b = h[h.length - 1];
  return ((b.Ta - a.Ta) / Math.max(60, b.t - a.t)) * 3600; // °C/h
}

export function explain(st, p) {
  const out = [], k = st.kpi, o = st.evapOut, { items, total } = loadBreakdown(st);
  const tr = trend(st), top = [...items].sort((a, b) => b.W - a.W)[0];
  const dir = tr > 0.3 ? 'aumentando' : tr < -0.3 ? 'bajando' : 'estable';
  let s = `La temperatura del aire está ${dir} (${k.Tavg.toFixed(1)} °C, ${tr >= 0 ? '+' : ''}${tr.toFixed(1)} °C/h; setpoint ${p.sp} °C).`;
  if (dir === 'aumentando') s += ` Sube porque la carga térmica (${kW(total)}) supera la refrigeración entregada (${kW(o.Q)}). El principal aporte es: ${top.label.toLowerCase()} (${kW(top.W)}).`;
  else if (dir === 'bajando') s += ` Baja porque la refrigeración (${kW(o.Q)}) retira más calor del que entra (${kW(total)}).`;
  else s += ` Entra ${kW(total)} de calor y el sistema retira ${kW(o.Q)} en promedio; el mayor aporte es ${top.label.toLowerCase()}.`;
  out.push(s);
  if (!p.refrigOn) out.push('La refrigeración está apagada: nada compensa las ganancias de calor.');
  else if (st.evap.defrostLeft > 0) out.push(`Desescarche en curso (${fmtDur(st.evap.defrostLeft)} restantes): compresor y ventiladores detenidos, resistencias encendidas.`);
  else if (p.control === 'onoff') out.push(`Control ON/OFF: el compresor está ${st.ctrl.on ? 'ENCENDIDO al 100 %' : 'APAGADO'}; enciende sobre ${(p.sp + p.hyst).toFixed(1)} °C y apaga bajo ${(p.sp - p.hyst).toFixed(1)} °C (retorno ${k.Tret.toFixed(1)} °C).`);
  else out.push(`Control PID: el compresor trabaja al ${(st.ctrl.u * 100).toFixed(0)} % para mantener el retorno (${k.Tret.toFixed(1)} °C) en ${p.sp} °C.`);
  if (o.airLimited) out.push(`El evaporador está limitado por el aire: con ventiladores al ${p.fan} % solo puede extraer ${kW(o.Qair)} aunque el compresor ofrece ${kW(o.Qcomp)}. Subir ventiladores aumenta la capacidad efectiva.`);
  else if (st.ctrl.u >= 0.98 && tr > 0.3) out.push('El compresor ya está al 100 %: el sistema no puede enfriar más rápido.');
  if (st.door.cmd) out.push(`La puerta está abierta hace ${fmtDur(st.t - st.door.openedAt)}: entra aire a ${p.tExt} °C y ${p.rhExt} % HR (+${kW(st.door.Q)}); la humedad sube y aumenta el riesgo de condensación.`);
  const b = st.batches.filter((x) => !x.done && x.id > 0).pop();
  if (b && b.Tc !== undefined) {
    const pr = PRODUCTS[b.product];
    out.push(`Lote ${b.id} (${b.n} pallets de ${pr.name}): núcleo a ${b.Tc.toFixed(1)} °C, objetivo ${b.target.toFixed(1)} °C` + (b.est ? `; faltan ~${fmtDur(Math.max(0, b.est - (st.t - b.tStart)))}.` : b.reachable ? '; estimando tiempo…' : '; no alcanzable con el setpoint actual.'));
  }
  if (st.rec.active && st.rec.active.tEnd !== null) out.push(`Recuperando tras "${st.rec.active.label}": T máx ${st.rec.active.Tmax.toFixed(1)} °C, ${fmtDur(st.t - st.rec.active.tEnd)} desde que terminó la perturbación.`);
  if (st.alarms.active.length) out.push(`Alarma activa: ${st.alarms.active[0].title}. Causa probable: ${st.alarms.active[0].cause}.`);
  return out;
}

// Consecuencias esperadas de un cambio de parámetro (panel de contexto).
export function hints(key, from, to, st, p) {
  const up = to > from, H = [];
  const add = (d, t) => H.push({ d, t });
  switch (key) {
    case 'fan': {
      const dP = (p.fanPow * (Math.pow(to / 100, 3) - Math.pow(from / 100, 3))).toFixed(2);
      add(up ? '↑' : '↓', `Flujo de aire (${from} → ${to} %)`);
      add(up ? '↑' : '↓', `Consumo de ventiladores (${dP > 0 ? '+' : ''}${dP} kW; potencia ∝ velocidad³)`);
      add(up ? '↓' : '↑', 'Tiempo de enfriamiento del producto');
      add(up ? '↑' : '↓', 'Uniformidad térmica entre zonas');
      if (!up && to < 50) add('⚠', 'Riesgo de baja uniformidad y de evaporador limitado por aire');
      break;
    }
    case 'sp': {
      add(up ? '↓' : '↑', 'Consumo eléctrico (mayor salto de temperatura, menor COP)');
      add(up ? '↓' : '↑', 'Deshumidificación del serpentín');
      const worst = Math.min(...st.pallets.map((q) => PRODUCTS[q.prod].tMax), 99);
      if (to >= worst) add('⚠', `Setpoint igual o sobre el máximo del producto (${worst} °C)`);
      break;
    }
    case 'control':
      if (to === 'pid') { add('↓', 'Oscilación de temperatura'); add('↓', 'Arranques del compresor'); add('↑', 'COP a carga parcial (evaporación más alta)'); }
      else { add('↑', 'Oscilación (±histéresis)'); add('↑', 'Arranques del compresor'); add('↓', 'COP: el compresor siempre trabaja al 100 %'); }
      break;
    case 'hyst': add(up ? '↑' : '↓', 'Amplitud de oscilación'); add(up ? '↓' : '↑', 'Arranques del compresor'); break;
    case 'tExt': add(up ? '↑' : '↓', 'Carga por paredes y por puerta'); add(up ? '↓' : '↑', 'COP (condensación más caliente)'); break;
    case 'insulation': add(to === 'bajo' ? '↑' : '↓', 'Carga por paredes'); add(to === 'bajo' ? '↑' : '↓', 'Consumo en régimen'); break;
    case 'curtain': add(to ? '↓' : '↑', `Carga por puerta abierta (${to ? '−75 %' : '×4'})`); add(to ? '↓' : '↑', 'Humedad y riesgo de condensación'); break;
    case 'capAvail': add(up ? '↑' : '↓', 'Capacidad frigorífica disponible'); add(up ? '↓' : '↑', 'Tiempo de recuperación y de pull-down'); break;
    case 'refrigOn':
      if (!to) { add('⚠', 'Sin refrigeración: la temperatura subirá con toda la carga térmica'); add('🔒', 'Capacidad y control bloqueados mientras el sistema esté apagado'); }
      else add('↓', 'La temperatura empezará a recuperarse');
      break;
    case 'evapFail': if (to) { add('↓', 'Flujo de aire −70 %'); add('↓', 'Capacidad efectiva del serpentín'); add('↑', 'Tiempo de recuperación'); } else add('↑', 'Flujo y capacidad restituidos'); break;
    case 'pidPreset': add(to === 'agresiva' ? '↓' : '↑', 'Tiempo de respuesta'); add(to === 'agresiva' ? '↑' : '↓', 'Riesgo de sobreoscilación'); break;
    default: break;
  }
  return H;
}
