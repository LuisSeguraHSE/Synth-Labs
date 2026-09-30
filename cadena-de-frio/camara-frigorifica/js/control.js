// MOTOR DE CONTROL: ON/OFF con histéresis y tiempos mínimos, o PID con anti-windup y velocidad mínima.
// Variable controlada: temperatura de aire de retorno al evaporador.
const MIN_ON = 120, MIN_OFF = 180, U_MIN = 0.25;

export function resetControl(c) { c.I = 0; c.dF = 0; c.prevT = null; }

export function updateControl(st, p, dt, Tctrl) {
  const c = st.ctrl;
  const blocked = !p.refrigOn || st.evap.defrostLeft > 0;
  const since = st.t - c.lastSwitch;
  const setOn = (on) => { if (c.on === on) return; c.on = on; c.lastSwitch = st.t; if (on) { c.starts++; st.energy.J += p.control === 'onoff' ? 72000 : 20000; } };
  if (blocked) { setOn(false); c.u = 0; c.uCmd = 0; c.prevT = Tctrl; return; }
  if (p.control === 'onoff') {
    if (!c.on && Tctrl > p.sp + p.hyst && since >= MIN_OFF) setOn(true);
    else if (c.on && Tctrl < p.sp - p.hyst && since >= MIN_ON) setOn(false);
    c.uCmd = c.on ? 1 : 0; c.u = c.uCmd;
    c.prevT = Tctrl;
    return;
  }
  const e = Tctrl - p.sp, dtm = dt / 60;
  const d = c.prevT === null ? 0 : (Tctrl - c.prevT) / dtm;
  c.prevT = Tctrl; c.dF += (d - c.dF) * Math.min(1, dt / 20);
  const raw = p.Kp * e + p.Ki * c.I + p.Kd * c.dF, uCmd = Math.min(1, Math.max(0, raw));
  if (raw === uCmd || (raw > 1 && e < 0) || (raw < 0 && e > 0)) c.I += e * dtm; // anti-windup condicional
  const lim = 1.2 / Math.max(p.Ki, 1e-3); c.I = Math.min(lim, Math.max(-0.5 / Math.max(p.Ki, 1e-3), c.I));
  c.uCmd = uCmd;
  if (c.on && uCmd < 0.12 && since >= MIN_ON) setOn(false);
  else if (!c.on && uCmd > 0.3 && since >= MIN_OFF) setOn(true);
  c.u = c.on ? Math.max(U_MIN, uCmd) : 0;
}
