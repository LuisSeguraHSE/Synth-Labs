// Alarmas por reglas con retardo: se activan tras `delay` s de condición sostenida y se normalizan solas.
import { log, fmtDur } from './events.js';
import { dominantCause, ACTIONS } from './explain.js';
import { PRODUCTS } from './config.js';

const RULES = [
  {
    id: 'T_HIGH', level: 'crit', delay: 180, title: 'Temperatura alta',
    test: (st, p) => st.kpi.Tavg > p.sp + p.alarmOffset,
    msg: (st, p) => `Cámara > ${(p.sp + p.alarmOffset).toFixed(1)} °C durante 3 min (${st.kpi.Tavg.toFixed(1)} °C)`,
    cause: (st, p) => dominantCause(st, p),
    impact: (st, p) => (st.kpi.Tavg > p.sp + p.alarmOffset + 3 ? 'Alto: riesgo de pérdida de calidad' : 'Moderado'),
  },
  {
    id: 'PROD_EXC', level: 'crit', delay: 60, title: 'Excursión de producto',
    test: (st) => st.kpi.excursion > 0,
    msg: (st) => `${st.kpi.excursion} pallet(s) ya enfriado(s) con núcleo sobre su límite`,
    cause: (st, p) => dominantCause(st, p),
    impact: () => 'Alto: producto fuera de especificación',
  },
  {
    id: 'EVAP_FAIL', level: 'crit', delay: 0, title: 'Falla de evaporador',
    test: (st, p) => p.evapFail,
    msg: () => 'Ventilador detenido y serpentín con hielo: flujo de aire reducido',
    cause: () => ({ key: 'fail', text: 'Falla mecánica o eléctrica en el evaporador' }),
    impact: () => 'Alto: capacidad efectiva reducida',
  },
  {
    id: 'DOOR_LONG', level: 'warn', delay: 300, title: 'Puerta abierta prolongada',
    test: (st) => st.door.cmd,
    msg: (st) => `Puerta abierta hace ${fmtDur(st.t - st.door.openedAt)}`,
    cause: () => ({ key: 'door', text: 'Carga/descarga en curso o puerta sin cerrar' }),
    impact: () => 'Moderado: carga térmica, humedad y hielo en el evaporador',
  },
  {
    id: 'COND', level: 'warn', delay: 120, title: 'Riesgo de condensación',
    test: (st) => st.kpi.condRisk === 'alto',
    msg: () => 'Riesgo alto de condensación cerca de la puerta',
    cause: () => ({ key: 'door', text: 'Aire exterior húmedo sobre superficies frías (punto de rocío sobre la temperatura superficial)' }),
    impact: () => 'Moderado: cajas húmedas, goteo y hongos',
  },
  {
    id: 'CAP_SAT', level: 'warn', delay: 900, title: 'Capacidad frigorífica saturada',
    test: (st, p) => st.ctrl.u >= 0.98 && st.kpi.Tavg > p.sp + 1,
    msg: () => 'Compresor al 100 % por más de 15 min sin alcanzar el setpoint',
    cause: (st, p) => dominantCause(st, p),
    impact: () => 'Moderado: recuperación lenta',
  },
  {
    id: 'POWER', level: 'crit', delay: 0, title: 'Corte de energía',
    test: (st) => st.cut,
    msg: (st) => `Sin energía: restablece en ${Math.max(0, Math.round((st.cutUntil - st.t) / 60))} min`,
    cause: () => ({ key: 'off', text: 'Corte de suministro eléctrico' }),
    impact: () => 'Alto: la cámara gana calor sin compensación',
  },
  {
    id: 'COND_HP', level: 'warn', delay: 300, title: 'Alta presión de condensación',
    test: (st) => st.evapOut.Q > 0 && st.evapOut.Tcond > 48,
    msg: (st) => `T condensación ${st.evapOut.Tcond.toFixed(0)} °C (${st.evapOut.Pdis.toFixed(1)} bar): el COP cae a ${st.evapOut.cop.toFixed(2)}`,
    cause: (st, p) => ({ key: 'cond', text: p.condDirty ? 'Condensador sucio / ventilador de condensador degradado' : 'Temperatura exterior alta' }),
    impact: () => 'Moderado: más consumo eléctrico por kW de frío',
  },
  {
    id: 'MANUAL', level: 'warn', delay: 0, title: 'Control en manual',
    test: (st, p) => p.ctrlMode === 'manual',
    msg: (st, p) => `Salida fija al ${p.uMan} %: la temperatura no se regula`,
    cause: () => ({ key: 'user', text: 'Operador pasó el lazo a manual' }),
    impact: () => 'Riesgo de desviación si cambia la carga',
  },
  {
    id: 'SYS_OFF', level: 'warn', delay: 0, title: 'Refrigeración apagada',
    test: (st, p) => !p.refrigOn,
    msg: () => 'El sistema frigorífico está apagado',
    cause: () => ({ key: 'off', text: 'Apagado manual' }),
    impact: () => 'Alto si se prolonga',
  },
  {
    id: 'RH', level: 'warn', delay: 1200, title: 'Humedad fuera de rango',
    test: (st) => { const r = st.kpi.rhRange; return r && (st.kpi.rh < r[0] - 8 || st.kpi.rh > 99); },
    msg: (st) => `HR ${st.kpi.rh.toFixed(0)} % fuera del rango recomendado`,
    cause: (st) => ({ key: 'load', text: st.kpi.rh < 80 ? 'Deshumidificación excesiva: serpentín muy frío (ON/OFF, setpoint bajo)' : 'Ingreso de aire húmedo' }),
    impact: () => 'Bajo/Moderado: deshidratación o condensación',
  },
];

export function updateAlarms(st, p, dt) {
  const A = st.alarms;
  for (const r of RULES) {
    const on = r.test(st, p);
    A.timers[r.id] = on ? (A.timers[r.id] || 0) + dt : 0;
    let a = A.active.find((x) => x.id === r.id);
    if (on && !a && A.timers[r.id] >= r.delay) {
      const c = r.cause(st, p);
      a = { id: r.id, level: r.level, title: r.title, since: st.t, cause: c.text, action: ACTIONS[c.key] || ACTIONS.load, impact: r.impact(st, p), msg: r.msg(st, p) };
      A.active.push(a); A.count++;
      A.active.sort((x, y) => (x.level === y.level ? x.since - y.since : x.level === 'crit' ? -1 : 1));
      log(st, 'alarm', `${a.title}: ${a.msg}`, r.level);
    } else if (a && !on) {
      A.active = A.active.filter((x) => x !== a);
      log(st, 'alarm', `Normalizada: ${a.title} (duró ${fmtDur(st.t - a.since)})`, 'ok');
    } else if (a) a.msg = r.msg(st, p);
  }
}

export function excursionCount(st) {
  let n = 0;
  for (const q of st.pallets) {
    if (q.state !== 'stored') continue;
    const b = q.batch ? st.batches[q.batch - 1] : null;
    if ((!b || b.done) && q.Tc > PRODUCTS[q.prod].tMax) n++;
  }
  return n;
}
