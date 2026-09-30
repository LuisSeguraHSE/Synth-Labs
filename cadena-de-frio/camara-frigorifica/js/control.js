// MOTOR DE CONTROL: ON/OFF con histéresis y tiempos mínimos, o PID con anti-windup y velocidad mínima.
// Variable controlada: temperatura de aire de retorno al evaporador. Modo manual (salida fija, sin salto al volver a
// automático) y rampa de setpoint. Todas las señales internas quedan en st.ctrl para el faceplate.
export function resetControl(c) { c.I = 0; c.dF = 0; c.prevT = null; }

export function updateControl(st, p, dt, Tctrl) {
  const c = st.ctrl, MIN_ON = p.minOn, MIN_OFF = p.minOff, U_MIN = p.uMin / 100;
  // Rampa de setpoint: el SP efectivo se mueve hacia p.sp a p.spRamp °C/min.
  if (c.spEff == null || !(p.spRamp > 0)) c.spEff = p.sp;
  else c.spEff += Math.sign(p.sp - c.spEff) * Math.min(Math.abs(p.sp - c.spEff), (p.spRamp * dt) / 60);
  const sp = c.spEff;
  c.pv = Tctrl; c.e = Tctrl - sp;
  const blocked = !p.refrigOn || st.evap.defrostLeft > 0 || st.cut;
  const since = st.t - c.lastSwitch;
  c.since = since; c.lockLeft = c.on ? Math.max(0, MIN_ON - since) : Math.max(0, MIN_OFF - since);
  const setOn = (on) => { if (c.on === on) return; c.on = on; c.lastSwitch = st.t; if (on) { c.starts++; st.energy.J += p.control === 'onoff' ? 72000 : 20000; } };
  c.P = c.Iterm = c.D = 0; c.raw = 0; c.sat = false;
  if (blocked) { c.why = st.cut ? 'corte de energía' : !p.refrigOn ? 'sistema apagado' : 'desescarche'; setOn(false); c.u = 0; c.uCmd = 0; c.prevT = Tctrl; return; }
  c.why = '';
  if (p.ctrlMode === 'manual') {
    c.uCmd = p.uMan / 100; c.raw = c.uCmd;
    if (!c.on && c.uCmd > 0.05 && since >= MIN_OFF) setOn(true);
    else if (c.on && c.uCmd <= 0.05 && since >= MIN_ON) setOn(false);
    if (c.lockLeft > 0 && (c.uCmd > 0.05) !== c.on) c.why = 'anti-ciclo';
    c.u = c.on ? Math.max(U_MIN, c.uCmd) : 0;
    if (p.Ki > 0) c.I = (c.uCmd - p.Kp * c.e) / p.Ki; // seguimiento: al volver a AUTO no hay salto
    c.prevT = Tctrl; c.dF = 0;
    return;
  }
  if (p.control === 'onoff') {
    if (!c.on && Tctrl > sp + p.hyst) { if (since >= MIN_OFF) setOn(true); else c.why = 'anti-ciclo (mín. OFF)'; }
    else if (c.on && Tctrl < sp - p.hyst) { if (since >= MIN_ON) setOn(false); else c.why = 'anti-ciclo (mín. ON)'; }
    c.uCmd = c.on ? 1 : 0; c.u = c.uCmd; c.raw = c.uCmd;
    c.prevT = Tctrl;
    return;
  }
  const e = c.e, dtm = dt / 60;
  const d = c.prevT === null ? 0 : (Tctrl - c.prevT) / dtm;
  c.prevT = Tctrl; c.dF += (d - c.dF) * Math.min(1, dt / 20);
  c.P = p.Kp * e; c.Iterm = p.Ki * c.I; c.D = p.Kd * c.dF;
  const raw = c.P + c.Iterm + c.D, uCmd = Math.min(1, Math.max(0, raw));
  c.raw = raw; c.sat = raw !== uCmd;
  if (raw === uCmd || (raw > 1 && e < 0) || (raw < 0 && e > 0)) c.I += e * dtm; // anti-windup condicional
  const lim = 1.2 / Math.max(p.Ki, 1e-3); c.I = Math.min(lim, Math.max(-0.5 / Math.max(p.Ki, 1e-3), c.I));
  c.uCmd = uCmd;
  if (c.on && uCmd < 0.12) { if (since >= MIN_ON) setOn(false); else c.why = 'anti-ciclo (mín. ON)'; }
  else if (!c.on && uCmd > 0.3) { if (since >= MIN_OFF) setOn(true); else c.why = 'anti-ciclo (mín. OFF)'; }
  c.u = c.on ? Math.max(U_MIN, uCmd) : 0;
}
