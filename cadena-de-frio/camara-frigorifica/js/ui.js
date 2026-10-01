// INTERFAZ: enlaza controles, KPIs, escena 3D, gráficos, eventos, alarmas, balance, modales y A/B.
// Regla: cada número responde a una pregunta; el detalle aparece al hacer clic.
import { PRODUCTS, SCENARIOS, PID_PRESETS, INSULATION, SPEEDS, COLORS, START_CLOCK } from './config.js';
import { runHeadless } from './sim.js';
import { createScene } from './scene3d.js';
import { createCharts, clock, miniChart } from './charts.js';
import { explain, hints, loadBreakdown } from './explain.js';
import { heatCSS, heatBand } from './heat.js';
import { fmtDur, batchTarget } from './events.js';
import { palletHA } from './thermal.js';
import { createLessons } from './lessons.js';

const $ = (id) => document.getElementById(id);
const f1 = (v) => (v == null || !isFinite(v) ? '—' : v.toFixed(1));
const kW = (w) => `${(w / 1000).toFixed(1)} kW`;
const GLY = { door: '▯', ingress: '▦', alarm: '⚠', fail: '✖', defrost: '❄', user: '✎', recovery: '✓', pulldown: '✓', start: '▶', control: '⚙' };
const FILTER = { all: null, door: ['door'], ingress: ['ingress', 'pulldown'], alarm: ['alarm'], ctrl: ['control', 'defrost', 'recovery', 'fail', 'start'], user: ['user'] };
const LABEL = { uMan: 'Salida manual', spRamp: 'Rampa SP', minOn: 'Mín. ON', minOff: 'Mín. OFF', uMin: 'Carga mínima', condApproach: 'Aproximación cond.', sp: 'Setpoint', fan: 'Ventiladores', hyst: 'Histéresis', tExt: 'T exterior', rhExt: 'HR exterior', capAvail: 'Capacidad disponible', Kp: 'Kp', Ki: 'Ki', Kd: 'Kd' };
const UNIT = { uMan: ' %', spRamp: ' °C/min', minOn: ' s', minOff: ' s', uMin: ' %', condApproach: ' K', sp: ' °C', fan: ' %', hyst: ' °C', tExt: ' °C', rhExt: ' %', capAvail: ' %', Kp: '', Ki: '', Kd: '' };

export function initUI(app) {
  const ui = { mode: 'eng', abRuns: 0, sel: null, filter: 'all', logLen: -1, lastUI: 0, lastChart: 0, hintTimer: null, committed: {} };
  app.ui = ui;
  const sim = () => app.sim, P = () => app.sim.p, ST = () => app.sim.st;

  // ---------- Escena y gráficos ----------
  const tip3d = $('tip3d');
  app.scene = createScene($('scene'), {
    hover(sel, x, y) {
      if (!sel) { tip3d.hidden = true; return; }
      tip3d.innerHTML = describe(sel, true); tip3d.hidden = false;
      const w = $('scene').clientWidth;
      tip3d.style.left = Math.min(x + 14, w - 290) + 'px'; tip3d.style.top = y + 14 + 'px';
    },
    select(sel) { ui.sel = sel; showDetail(); },
  });
  app.charts = createCharts({ tempCanvas: $('cvT'), powCanvas: $('cvP'), tempLegend: $('legT'), powLegend: $('legP'), tip: $('tipC'), wrap: $('chartWrap') });
  const lessons = createLessons($('lesson'), () => ({ sim: app.sim, ui }));

  // ---------- Barra superior ----------
  SPEEDS.forEach((v) => { const b = document.createElement('button'); b.textContent = '×' + v; b.dataset.v = v; $('speeds').appendChild(b); });
  const markSpeed = () => { [...$('speeds').children].forEach((b) => b.classList.toggle('on', +b.dataset.v === app.speed)); $('speedLbl').textContent = app.playing ? `×${app.speed}` : 'pausa'; };
  $('speeds').onclick = (e) => { const b = e.target.closest('button'); if (b) { app.speed = +b.dataset.v; app.playing = true; $('btnPlay').textContent = '⏸'; markSpeed(); } };
  $('btnPlay').onclick = () => { app.playing = !app.playing; $('btnPlay').textContent = app.playing ? '⏸' : '▶'; $('btnPlay').classList.toggle('accent', !app.playing); markSpeed(); };
  $('btnStep10').onclick = () => { sim().advance(600); refresh(true); };
  $('btnReset').onclick = () => app.load(app.scenario, { ...P() });
  $('modes').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    ui.mode = b.dataset.mode; document.body.className = 'mode-' + ui.mode;
    [...$('modes').children].forEach((x) => x.classList.toggle('on', x === b));
  };
  $('btnExplain').onclick = () => { renderExplain(); $('mExplain').showModal(); };
  $('explainRefresh').onclick = renderExplain;
  $('btnLesson').onclick = () => lessons.toggle();
  $('alarmPill').onclick = () => { renderAlarmDetail(); $('mAlarm').showModal(); };
  markSpeed();

  // ---------- Escenarios ----------
  $('scenario').innerHTML = Object.entries(SCENARIOS).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join('');
  $('abSc').innerHTML = $('scenario').innerHTML;
  $('scenario').onchange = () => { $('scDesc').textContent = SCENARIOS[$('scenario').value].desc; };
  $('btnLoadSc').onclick = () => app.load($('scenario').value);

  // ---------- Acciones ----------
  $('btnDoor').onclick = () => { sim().door(!ST().door.cmd); refresh(true); };
  $('inProd').innerHTML = Object.entries(PRODUCTS).map(([k, p]) => `<option value="${k}">${p.name}</option>`).join('');
  const inUpd = () => {
    const pr = PRODUCTS[$('inProd').value], n = Math.max(1, +$('inN').value || 1), free = sim().freeSlots();
    $('inMass').textContent = `${(n * pr.kg).toLocaleString('es')} kg (${pr.kg} kg/pallet)`;
    $('inFree').textContent = `Espacio libre: ${free} posiciones`;
    $('inNote').textContent = `${pr.name}: objetivo de núcleo ${Math.max(pr.tObj, P().sp + 1).toFixed(1)} °C, máximo ${pr.tMax} °C. Cada pallet tarda ~45 s en entrar.` + (n > free ? ` Solo caben ${free}.` : '');
    $('inOk').disabled = free <= 0;
  };
  ['inProd', 'inN', 'inT'].forEach((id) => ($(id).oninput = inUpd));
  $('btnIngress').onclick = () => { inUpd(); $('mIngress').showModal(); };
  $('mIngress').addEventListener('close', () => {
    if ($('mIngress').returnValue !== 'ok') return;
    const ok = sim().ingress({ product: $('inProd').value, n: Math.max(1, +$('inN').value || 1), T0: +$('inT').value, dist: $('inDist').value, keepDoor: $('inDoor').value === '1' });
    if (ok) { app.scene.setLayers({ pallets: true }); document.querySelector('[data-layer=pallets]').checked = true; }
    refresh(true);
  });

  // ---------- Parámetros ----------
  function commit(key, val, text) {
    const from = ui.committed[key] ?? P()[key];
    if (from === val) return;
    sim().setParam(key, val, text || `${LABEL[key] || key}: ${from}${UNIT[key] ?? ''} → ${val}${UNIT[key] ?? ''}`);
    showHints(key, from, val);
    ui.committed[key] = val;
  }
  function slider(id, key, out, fmt = (v) => v) {
    const el = $(id);
    el.oninput = () => { sim().setParam(key, +el.value); $(out).textContent = fmt(+el.value); if (key === 'fan') fanNote(); if (key === 'hyst' || key === 'sp') ladder(); };
    el.onchange = () => commit(key, +el.value);
  }
  slider('sp', 'sp', 'oSp', (v) => `${v} °C`);
  slider('fan', 'fan', 'oFan', (v) => `${v} %`);
  slider('hyst', 'hyst', 'oHyst', (v) => `${v} °C`);
  slider('capAvail', 'capAvail', 'oCap', (v) => `${v} % · ${((P().capNom * v) / 100).toFixed(0)} kW`);
  slider('tExt', 'tExt', 'oText', (v) => `${v} °C`);
  slider('rhExt', 'rhExt', 'oRhe', (v) => `${v} %`);
  slider('Kp', 'Kp', 'oKp'); slider('Ki', 'Ki', 'oKi'); slider('Kd', 'Kd', 'oKd');
  slider('uMan', 'uMan', 'oUman', (v) => `${v} %`);
  slider('spRamp', 'spRamp', 'oRamp', (v) => (v > 0 ? `${v} °C/min` : 'escalón'));
  slider('minOn', 'minOn', 'oMinOn', (v) => `${v} s`); slider('minOff', 'minOff', 'oMinOff', (v) => `${v} s`);
  slider('uMin', 'uMin', 'oUmin', (v) => `${v} %`);
  slider('condApproach', 'condApproach', 'oCondA', (v) => `${v} K`);
  const segBind = (id, key, label) => ($(id).onclick = (e) => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    const v = b.dataset.v, from = P()[key];
    if (from === v) return;
    sim().setParam(key, v, `${label}: ${from} → ${v}`); showHints(key, from, v); syncControls();
  });
  segBind('ctrlSeg', 'control', 'Control');
  segBind('modeSeg', 'ctrlMode', 'Modo TIC-01');
  $('physSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; ui.phys = b.dataset.v; [...$('physSeg').children].forEach((x) => x.classList.toggle('on', x === b)); renderPhys(); };
  segBind('pidSeg', 'pidPreset', 'Respuesta PID');
  segBind('insSeg', 'insulation', 'Aislamiento');
  const check = (id, key, label) => ($(id).onchange = () => {
    const v = $(id).checked; sim().setParam(key, v, `${label}: ${v ? 'activada' : 'desactivada'}`); showHints(key, !v, v); syncControls();
  });
  check('condDirty', 'condDirty', 'Condensador sucio');
  $('btnCut').onclick = () => { if (!ST().cut) sim().powerCut(10); refresh(true); };
  $('btnPulse').onclick = () => { if (!ST().door.cmd && !ST().ingress) sim().doorPulse(60); refresh(true); };
  check('refrigOn', 'refrigOn', 'Refrigeración'); check('curtain', 'curtain', 'Cortina de aire'); check('evapFail', 'evapFail', 'Falla de evaporador');
  $('btnDefrost').onclick = () => sim().defrostNow();

  const ADV = [['L', 'Largo (m)', 1], ['W', 'Ancho (m)', 1], ['H', 'Alto (m)', 0.5], ['U', 'U envolvente (W/m²K)', 0.01], ['capNom', 'Capacidad nominal (kW)', 1], ['fanFlow', 'Caudal ventiladores (m³/s)', 0.5], ['fanPow', 'Potencia ventiladores (kW)', 0.1], ['eta', 'Eficiencia vs Carnot', 0.01], ['UAcoil', 'UA serpentín (kW/K)', 0.1], ['doorW', 'Ancho puerta (m)', 0.1], ['doorH', 'Alto puerta (m)', 0.1], ['doorCd', 'Coef. intercambio puerta', 0.01], ['hAref', 'hA producto (W/K·pallet)', 10], ['Ksc', 'Conducción sup.→núcleo (W/K)', 10], ['defrostEvery', 'Desescarche cada (h, 0 = no)', 1], ['defrostDur', 'Duración desescarche (min)', 5], ['alarmOffset', 'Alarma sobre setpoint (K)', 0.5], ['lights', 'Iluminación (kW)', 0.1], ['tariff', 'Tarifa (S/ por kWh)', 0.01]];
  const GEO = ['L', 'W', 'H'];
  $('advForm').innerHTML = ADV.map(([k, l, s]) => `<span>${l}</span><input type="number" step="${s}" data-adv="${k}">`).join('');
  $('advForm').onchange = (e) => {
    const k = e.target.dataset.adv; if (!k || GEO.includes(k)) return;
    const v = +e.target.value; if (!isFinite(v)) return;
    sim().setParam(k, v, `Parámetro avanzado ${k}: ${P()[k]} → ${v}`);
  };
  $('btnApplyGeo').onclick = () => {
    const g = {}; GEO.forEach((k) => (g[k] = Math.max(k === 'H' ? 3.5 : 6, +document.querySelector(`[data-adv=${k}]`).value || P()[k])));
    app.load(app.scenario, { ...P(), ...g });
  };

  // ---------- Vista, capas y gráficos ----------
  $('viewSeg').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    app.scene.setView(b.dataset.v); [...$('viewSeg').children].forEach((x) => x.classList.toggle('on', x === b));
    $('levelSeg').hidden = b.dataset.v !== 'planta';
    if (b.dataset.v === 'planta' && app.scene.slice.mode === 'h') { // en planta el corte horizontal se ubica en el nivel mostrado
      const k = +($('levelSeg').querySelector('.on')?.dataset.v ?? 1);
      app.scene.setSlice({ h: (k + 0.5) * app.sim.R.dz }); syncSlice();
    }
  };
  function setQuality(q, why) {
    app.scene.setQuality(q); app.quality = q;
    [...$('qualSeg').children].forEach((x) => x.classList.toggle('on', x.dataset.v === q));
    if (why) { $('hints').innerHTML = `<b>Calidad gráfica</b><div>${why}</div>`; $('hints').hidden = false; clearTimeout(ui.hintTimer); ui.hintTimer = setTimeout(() => ($('hints').hidden = true), 7000); }
  }
  $('qualSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; app.userQuality = true; setQuality(b.dataset.v); };
  $('levelSeg').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return; app.scene.setLevel(+b.dataset.v); [...$('levelSeg').children].forEach((x) => x.classList.toggle('on', x === b));
    if (app.scene.slice.mode === 'h') { app.scene.setSlice({ h: (+b.dataset.v + 0.5) * app.sim.R.dz }); syncSlice(); } // el corte sigue al nivel mostrado en planta
  };
  document.querySelectorAll('[data-layer]').forEach((c) => (c.onchange = () => {
    app.scene.setLayers({ [c.dataset.layer]: c.checked });
    if (c.dataset.layer === 'slice') $('sliceCtl').hidden = !c.checked;
    legend();
  }));
  // Corte térmico: orientación (horizontal / longitudinal) y posición del plano
  function syncSlice() {
    const p = P(), sl = app.scene.slice, hor = sl.mode === 'h', el = $('sliceH');
    [...$('sliceSeg').children].forEach((x) => x.classList.toggle('on', x.dataset.v === sl.mode));
    $('sliceLbl').textContent = hor ? 'Altura del corte' : 'Posición transversal';
    el.min = 0.3; el.max = ((hor ? p.H : p.W) - 0.3).toFixed(1); el.value = (hor ? sl.h : sl.y) ?? el.min;
    $('oSlice').textContent = `${(+el.value).toFixed(1)} m`;
    $('sliceCtl').hidden = !app.scene.layers.slice;
    window.SLControls?.paint(el);
    legend();
  }
  $('sliceSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; app.scene.setSlice({ mode: b.dataset.v }); syncSlice(); };
  $('sliceH').oninput = () => { const v = +$('sliceH').value; app.scene.setSlice(app.scene.slice.mode === 'h' ? { h: v } : { y: v }); $('oSlice').textContent = `${v.toFixed(1)} m`; };
  $('winSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; app.charts.setWindow(+b.dataset.v); [...$('winSeg').children].forEach((x) => x.classList.toggle('on', x === b)); refresh(true); };
  $('btnTable').onclick = () => { $('tableBox').hidden = !$('tableBox').hidden; renderTable(); };
  $('btnCsv').onclick = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([app.charts.csv(ST())], { type: 'text/csv' }));
    a.download = `camara_${app.scenario}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  $('tabs').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    [...$('tabs').children].forEach((x) => x.classList.toggle('on', x === b));
    $('tabEvents').hidden = b.dataset.t !== 'events'; $('tabAlarms').hidden = b.dataset.t !== 'alarms'; $('tabBalance').hidden = b.dataset.t !== 'balance';
    refresh(true);
  };
  $('evFilter').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; ui.filter = b.dataset.f; ui.logLen = -1; [...$('evFilter').children].forEach((x) => x.classList.toggle('on', x === b)); renderTimeline(); };
  $('kHot').onclick = () => { ui.sel = { kind: 'zone', id: ST().kpi.hot.zone }; app.scene.select(ui.sel); showDetail(); };
  $('detClose').onclick = () => { ui.sel = null; app.scene.select(null); $('detail').hidden = true; };

  // ---------- A/B ----------
  $('btnAB').onclick = () => { $('abSc').value = app.scenario; $('mAB').showModal(); };
  $('abRun').onclick = () => {
    $('abOut').innerHTML = '<p class="muted">Calculando…</p>';
    setTimeout(runAB, 30);
  };

  // =================== Render ===================
  function syncControls() {
    const p = P();
    const set = (id, v, out, txt) => { $(id).value = v; if (out) $(out).textContent = txt; };
    set('sp', p.sp, 'oSp', `${p.sp} °C`); set('fan', p.fan, 'oFan', `${p.fan} %`); set('hyst', p.hyst, 'oHyst', `${p.hyst} °C`);
    set('capAvail', p.capAvail, 'oCap', `${p.capAvail} % · ${((p.capNom * p.capAvail) / 100).toFixed(0)} kW`);
    set('tExt', p.tExt, 'oText', `${p.tExt} °C`); set('rhExt', p.rhExt, 'oRhe', `${p.rhExt} %`);
    set('Kp', p.Kp, 'oKp', p.Kp); set('Ki', p.Ki, 'oKi', p.Ki); set('Kd', p.Kd, 'oKd', p.Kd);
    set('uMan', p.uMan, 'oUman', `${p.uMan} %`); set('spRamp', p.spRamp, 'oRamp', p.spRamp > 0 ? `${p.spRamp} °C/min` : 'escalón');
    set('minOn', p.minOn, 'oMinOn', `${p.minOn} s`); set('minOff', p.minOff, 'oMinOff', `${p.minOff} s`); set('uMin', p.uMin, 'oUmin', `${p.uMin} %`);
    set('condApproach', p.condApproach, 'oCondA', `${p.condApproach} K`); $('condDirty').checked = p.condDirty;
    $('refrigOn').checked = p.refrigOn; $('curtain').checked = p.curtain; $('evapFail').checked = p.evapFail;
    const seg = (id, v) => [...$(id).children].forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    seg('ctrlSeg', p.control); seg('pidSeg', p.pidPreset); seg('insSeg', p.insulation); seg('modeSeg', p.ctrlMode);
    $('manBox').hidden = p.ctrlMode !== 'manual';
    $('onoffBox').hidden = p.control !== 'onoff'; $('pidBox').hidden = p.control !== 'pid';
    $('insNote').textContent = `U = ${p.U} W/m²K`;
    ADV.forEach(([k]) => { const el = document.querySelector(`[data-adv=${k}]`); if (document.activeElement !== el) el.value = p[k]; });
    $('scenario').value = app.scenario; $('scDesc').textContent = SCENARIOS[app.scenario].desc;
    ['sp', 'fan', 'hyst', 'capAvail', 'tExt', 'rhExt', 'Kp', 'Ki', 'Kd', 'uMan', 'spRamp', 'minOn', 'minOff', 'uMin', 'condApproach'].forEach((k) => (ui.committed[k] = p[k]));
    fanNote(); ladder(); legend();
    window.SLControls?.paintAll();
  }

  function fanNote() {
    const p = P(), st = ST();
    if (st.evap.defrostLeft > 0) { $('fanNote').textContent = '❄ Desescarche: ventiladores detenidos'; return; }
    const from = ui.committed.fan ?? p.fan, d = p.fan - from, arrow = d > 0 ? '↑' : d < 0 ? '↓' : '·';
    $('fanNote').textContent = `Flujo de aire ${arrow} ${f1(st.air.Vdot)} m³/s · Consumo ${arrow} ${(p.fanPow * Math.pow(p.fan / 100, 3)).toFixed(2)} kW` + (p.evapFail ? ' · ⚠ 1 ventilador en falla' : '');
  }

  function ladder() {
    const p = P(), st = ST(), T = st.kpi.Tret;
    const rows = [[p.sp + p.hyst, 'Refrigeración ON'], [p.sp, 'Setpoint'], [p.sp - p.hyst, 'Refrigeración OFF']];
    $('ladder').innerHTML = rows.map(([v, t]) => `<div><b>${v.toFixed(1)} °C</b><i></i>${t}</div>`).join('') +
      `<div class="cur"><b>${f1(T)} °C</b><i></i>Retorno actual · compresor ${st.ctrl.on ? 'ON' : 'OFF'}</div>`;
  }

  function legend() {
    const p = P(), stops = [-2, -0.5, 0.5, 0.5 + (p.alarmOffset - 0.5) * 0.55, p.alarmOffset];
    const grad = stops.map((d, i) => `${heatCSS(p.sp + d, p.sp, p.alarmOffset)} ${(i / (stops.length - 1)) * 100}%`).join(',');
    const lay = app.scene.layers, sl = app.scene.slice;
    const what = lay.slice ? 'corte térmico interpolado' : 'aire por zona';
    $('heatLegend').innerHTML = `<b>Mapa térmico</b> · ${what} (°C) · <span id="legTime"></span><div class="ramp" style="background:linear-gradient(90deg,${grad})"></div>` +
      `<div class="ticks"><span>${p.sp - 2}° frío</span><span>${p.sp}° normal</span><span>caliente</span><span>${p.sp + p.alarmOffset}° crítico</span></div>` +
      `<div class="muted">Pallets: color = temperatura de núcleo${lay.heat ? ' · cajas = aire por zona' : ''}</div>` +
      (lay.slice ? `<div class="lgs"><b>Corte ${sl.mode === 'h' ? 'horizontal' : 'longitudinal'}</b> · <span id="legSlice"></span>` +
        `<div class="muted" title="Interpolación entre las ${app.sim.R.n} zonas del modelo + chorro del evaporador, puerta abierta y pallets (dentro de la carga: de superficie a núcleo)"><i class="iso"></i>isoterma <i class="iso lim"></i>límite · ▲ máx · cursor = °C</div></div>` : '');
  }

  function showHints(key, from, to) {
    const H = hints(key, from, to, ST(), P());
    if (!H.length) return;
    $('hints').innerHTML = `<b>Qué cambia</b>` + H.map((h) => `<div>${h.d} ${h.t}</div>`).join('');
    $('hints').hidden = false;
    clearTimeout(ui.hintTimer); ui.hintTimer = setTimeout(() => ($('hints').hidden = true), 7000);
  }

  function describe(sel, short) {
    const st = ST(), p = P(), R = st.R;
    if (sel.kind === 'sensor') {
      const s = st.sensors.find((x) => x.id === sel.id);
      return `<b>Sensor ${s.id}</b><div><span class="k">T</span>${s.T.toFixed(1)} °C</div><div><span class="k">HR</span>${s.rh.toFixed(0)} %</div><div><span class="k">Ubicación</span>${s.name}</div>`;
    }
    if (sel.kind === 'pallet') {
      const q = st.pallets.find((x) => x.id === sel.id); if (!q) return '—';
      const pr = PRODUCTS[q.prod];
      return `<b>Pallet #${q.id} · ${pr.name}</b><div><span class="k">Superficie</span>${q.Ts.toFixed(1)} °C</div><div><span class="k">Núcleo</span>${q.Tc.toFixed(1)} °C</div>` +
        `<div><span class="k">Zona</span>${q.state === 'stored' ? R.zones[q.zone].name.split(' · ').slice(0, 2).join(' · ') : 'en tránsito'}</div>` + (short ? '' : `<div><span class="k">Lote</span>${q.batch || 'stock inicial'}</div>`);
    }
    if (sel.kind === 'evap') {
      const o = st.evapOut;
      return `<b>EVAPORADOR EV-01</b><div><span class="k">Cooling</span>${kW(o.Q)}</div><div><span class="k">Fan</span>${p.fan} %${p.evapFail ? ' ⚠' : ''}</div><div><span class="k">Air outlet</span>${o.Tsup.toFixed(1)} °C</div>`;
    }
    if (sel.kind === 'cond') return `<b>UNIDAD CONDENSADORA CU-01</b><div><span class="k">Compresor</span>${st.ctrl.on ? (st.ctrl.u * 100).toFixed(0) + ' %' : 'detenido'}</div><div><span class="k">Potencia</span>${kW(st.elec.comp)}</div><div><span class="k">COP</span>${st.evapOut.Q > 0 ? st.evapOut.cop.toFixed(2) : '—'}</div>`;
    if (sel.kind === 'door') return `<b>PUERTA P-01</b><div><span class="k">Estado</span>${st.door.cmd ? 'ABIERTA' : 'cerrada'}</div><div><span class="k">Carga</span>${kW(st.door.Q)}</div><div><span class="k">Cortina</span>${p.curtain ? 'sí' : 'no'}</div>`;
    if (sel.kind === 'slice') {
      const T = sel.T ?? app.scene.sampleT(sel.x, sel.y, sel.h), z = R.zones[sel.zone];
      return `<b>Corte térmico · ${sel.mode === 'h' ? `h = ${sel.h.toFixed(1)} m` : `y = ${sel.y.toFixed(1)} m`}</b><div><span class="k">T interpolada</span>${T.toFixed(1)} °C (${heatBand(T, p.sp, p.alarmOffset)})</div>` +
        `<div><span class="k">Punto</span>x ${sel.x.toFixed(1)} · y ${sel.y.toFixed(1)} · h ${sel.h.toFixed(1)} m</div><div><span class="k">Zona</span>${z.name.split(' · ').slice(0, 2).join(' · ')} (${st.T[sel.zone].toFixed(1)} °C)</div>`;
    }
    if (sel.kind === 'zone') {
      const z = R.zones[sel.id];
      return `<b>${z.name}</b><div><span class="k">Aire</span>${st.T[sel.id].toFixed(1)} °C (${heatBand(st.T[sel.id], p.sp, p.alarmOffset)})</div><div><span class="k">Pallets</span>${st.pallets.filter((q) => q.zone === sel.id && q.state === 'stored').length}</div>`;
    }
    return '';
  }

  function showDetail() {
    const sel = ui.sel;
    if (!sel) { $('detail').hidden = true; return; }
    $('detail').hidden = false;
    const st = ST(), p = P(), R = st.R, cv = $('detChart');
    let title = 'Detalle', body = '';
    cv.hidden = true;
    const kv = (rows) => `<div class="kv">${rows.map(([a, b]) => `<span>${a}</span><b>${b}</b>`).join('')}</div>`;
    if (sel.kind === 'sensor') {
      const s = st.sensors.find((x) => x.id === sel.id), idx = st.sensors.indexOf(s);
      title = `Sensor ${s.id}`;
      body = kv([['T', `${s.T.toFixed(1)} °C`], ['HR', `${s.rh.toFixed(0)} %`], ['Ubicación', s.name], ['Zona', R.zones[s.zone].name], ['Estado', heatBand(s.T, p.sp, p.alarmOffset)]]) + '<p class="muted small">Histórico (últimas 2 h):</p>';
      const pts = st.hist.filter((h) => h.t >= st.t - 7200).map((h) => [h.t, h.s[idx][0]]);
      cv.hidden = false; requestAnimationFrame(() => miniChart(cv, [{ c: COLORS.sAir, pts }], { ref: p.sp, x0: pts.length ? clock(pts[0][0]) : '', x1: clock(st.t) }));
    } else if (sel.kind === 'pallet') {
      const q = st.pallets.find((x) => x.id === sel.id);
      if (q) {
        const pr = PRODUCTS[q.prod];
        title = `Pallet #${q.id} · ${pr.name}`;
        body = kv([['Lote', q.batch || 'stock inicial'], ['T inicial', `${q.T0.toFixed(1)} °C`], ['Superficie', `${q.Ts.toFixed(1)} °C`], ['Núcleo', `${q.Tc.toFixed(1)} °C`], ['Máximo producto', `${pr.tMax} °C`], ['Masa', `${q.m} kg`], ['Ubicación', q.state === 'stored' ? R.zones[q.zone].name : 'en tránsito'], ['Transferencia aire→producto', `${palletHA(q, st, p).toFixed(0)} W/K`]]);
      }
    } else if (sel.kind === 'evap') {
      const o = st.evapOut, a = st.air;
      title = 'Evaporador EV-01';
      body = kv([['Capacidad entregada', kW(o.Q)], ['— sensible / latente', `${kW(o.Qs)} / ${kW(o.Qlat)}`], ['Capacidad compresor', kW(o.Qcomp)], ['Límite por aire', kW(o.Qair)], ['Ventiladores', `${p.fan} % (efectivo ${(a.fanFrac * 100).toFixed(0)} %)`], ['Caudal', `${a.Vdot.toFixed(2)} m³/s`], ['Aire de salida', `${o.Tsup.toFixed(1)} °C`], ['Aire de retorno', `${st.kpi.Tret.toFixed(1)} °C`], ['T evaporación', `${o.Tevap.toFixed(1)} °C`], ['COP', o.cop.toFixed(2)], ['Potencia compresor', kW(st.elec.comp)], ['Escarcha', `${st.evap.frost.toFixed(0)} kg`], ['Próximo desescarche', p.defrostEvery > 0 ? clock(st.evap.nextDefrost) : 'desactivado'], ['Estado', p.evapFail ? '⚠ FALLA' : st.evap.defrostLeft > 0 ? '❄ desescarche' : 'normal']]);
    } else if (sel.kind === 'cond') {
      const o = st.evapOut;
      title = 'Unidad condensadora CU-01';
      body = kv([['Estado', !p.refrigOn ? '⏻ sistema apagado' : st.evap.defrostLeft > 0 ? '❄ detenida por desescarche' : st.ctrl.on ? 'en marcha' : 'en espera'], ['Carga del compresor', `${(st.ctrl.u * 100).toFixed(0)} %`], ['Control', p.control === 'pid' ? `PID ${p.pidPreset}` : `ON/OFF ±${p.hyst} °C`], ['Capacidad entregada', kW(o.Q)], ['Capacidad disponible', kW(o.avail)], ['Potencia compresor', kW(st.elec.comp)], ['COP', o.Q > 0 ? o.cop.toFixed(2) : '—'], ['T evaporación', `${o.Tevap.toFixed(1)} °C`], ['T condensación', `${o.Tcond.toFixed(1)} °C${p.condDirty ? ' ⚠ sucio' : ''}`], ['P succión / descarga (R-404A)', `${o.Psuc.toFixed(1)} / ${o.Pdis.toFixed(1)} bar`], ['Relación de compresión', (o.Pdis / o.Psuc).toFixed(1)], ['COP Carnot · η', `${o.copCarnot.toFixed(2)} · ${p.eta}`], ['Calor rechazado', kW(o.Qcond)], ['Arranques', st.ctrl.starts], ['Energía compresor', `${(st.energy.compJ / 3.6e6).toFixed(1)} kWh`]]);
    } else if (sel.kind === 'door') {
      const d = st.door;
      title = 'Puerta P-01';
      body = kv([['Estado', d.cmd ? '⚠ ABIERTA' : 'cerrada'], ['Apertura', `${(d.frac * 100).toFixed(0)} %`], ['Carga actual', kW(d.Q)], ['Aperturas', d.count], ['Tiempo total abierta', fmtDur(d.totalOpen + (d.cmd ? st.t - d.openedAt : 0))], ['Cortina de aire', p.curtain ? 'sí (−75 %)' : 'no'], ['Tamaño', `${p.doorW} × ${p.doorH} m`]]);
    } else if (sel.kind === 'slice') {
      const T = app.scene.sampleT(sel.x, sel.y, sel.h), z = R.zones[sel.zone], si = app.scene.sliceInfo();
      title = 'Corte térmico · punto';
      body = kv([['T en el punto', T == null ? '—' : `${T.toFixed(1)} °C (${heatBand(T, p.sp, p.alarmOffset)})`], ['Posición', `x ${sel.x.toFixed(1)} m · y ${sel.y.toFixed(1)} m · h ${sel.h.toFixed(1)} m`], ['Zona', `${z.name} · ${st.T[sel.zone].toFixed(1)} °C`],
        ['Corte', si ? `${si.mode === 'h' ? 'horizontal' : 'longitudinal'} · ${si.min.toFixed(1)} … ${si.max.toFixed(1)} °C` : '—'], ['Máximo del corte', si ? `${si.max.toFixed(1)} °C en x ${si.maxAt.x.toFixed(1)} · y ${si.maxAt.y.toFixed(1)} · h ${si.maxAt.h.toFixed(1)} m` : '—'], ['Límite de alarma', `${p.sp + p.alarmOffset} °C`]]) +
        '<p class="muted small">Campo estimado: interpolación entre zonas del modelo más chorro de impulsión, puerta y pallets. Es una visualización, no una medición.</p>';
    } else if (sel.kind === 'zone') {
      const z = R.zones[sel.id];
      title = z.name;
      body = kv([['Aire', `${st.T[sel.id].toFixed(1)} °C`], ['Estado', heatBand(st.T[sel.id], p.sp, p.alarmOffset)], ['Pallets', st.pallets.filter((q) => q.zone === sel.id && q.state === 'stored').length], ['Caudal de su rack', `${(st.air.col[z.j] / 1.25).toFixed(2)} m³/s`], ['Sensores', st.sensors.filter((s) => s.zone === sel.id).map((s) => s.id).join(', ') || '—']]);
    }
    $('detTitle').textContent = title; $('detBody').innerHTML = body;
  }

  function renderKPIs() {
    const st = ST(), p = P(), k = st.kpi, o = st.evapOut;
    const h = st.hist, a = h[Math.max(0, h.length - 21)], b = h[h.length - 1];
    const tr = a && b && b.t > a.t ? ((b.Ta - a.Ta) / (b.t - a.t)) * 3600 : 0;
    $('kTavg').textContent = `${k.Tavg.toFixed(1)} °C`;
    $('kTavg').style.color = k.Tavg >= p.sp + p.alarmOffset ? 'var(--crit)' : '';
    $('kTrend').textContent = `${tr > 0.3 ? '↗' : tr < -0.3 ? '↘' : '→'} ${tr >= 0 ? '+' : ''}${tr.toFixed(1)} °C/h · ${heatBand(k.Tavg, p.sp, p.alarmOffset)}`;
    $('kAir').textContent = `${k.Tavg.toFixed(1)} °C`; $('kSurf').textContent = k.Ts == null ? '—' : `${k.Ts.toFixed(1)} °C`; $('kCore').textContent = k.Tc == null ? '—' : `${k.Tc.toFixed(1)} °C`;
    const state = !p.refrigOn ? '⏻ Refrigeración apagada' : st.evap.defrostLeft > 0 ? `❄ Desescarche (${fmtDur(st.evap.defrostLeft)})` : st.ctrl.on ? `Compresor ${(st.ctrl.u * 100).toFixed(0)} %${st.evapOut.airLimited ? ' · limitado por aire' : ''}${p.evapFail ? ' · ⚠ falla' : ''}` : 'En espera (compresor OFF)';
    $('kState').textContent = state;
    $('kPow').textContent = kW(st.elec.total);
    $('kHot').textContent = `${k.hot.name.split(' · ').slice(0, 2).join(' / ')} · ${k.hot.T.toFixed(1)} °C`;
    $('kRh').textContent = `${k.rh.toFixed(0)} %`;
    const r = k.rhRange || [85, 95], pos = (v) => `${Math.max(0, Math.min(100, ((v - 50) / 50) * 100))}%`;
    $('rhOpt').style.left = pos(r[0]); $('rhOpt').style.width = `calc(${pos(r[1])} - ${pos(r[0])})`; $('rhMark').style.left = pos(k.rh);
    $('kOcc').textContent = `${(st.occ * 100).toFixed(0)} % · ${st.pallets.filter((q) => q.state !== 'outside').length}/${st.R.slots.length} pallets`;
    $('occBar').style.width = `${st.occ * 100}%`;
    // Refrigeración
    const util = o.avail > 0 ? o.Q / o.avail : 0;
    $('kUtil').textContent = `${(util * 100).toFixed(0)} % de ${(o.avail / 1000).toFixed(0)} kW`;
    $('utilBar').style.width = `${util * 100}%`; $('utilBar').className = util > 0.97 ? 'warn' : '';
    $('kQ').textContent = kW(o.Q); $('kPc').textContent = kW(st.elec.comp); $('kCop').textContent = o.Q > 0 ? o.cop.toFixed(2) : '—';
    const lim = $('kLimit');
    if (!p.refrigOn) { lim.hidden = false; lim.textContent = '⏻ Sistema apagado: capacidad 0 kW.'; }
    else if (o.airLimited) { lim.hidden = false; lim.textContent = `⚠ Limitado por aire: el serpentín entrega ${kW(o.Qair)} de ${kW(o.Qcomp)} del compresor. Subir ventiladores aumenta la capacidad.`; }
    else if (st.evap.defrostLeft > 0) { lim.hidden = false; lim.textContent = '❄ Desescarche: compresor y ventiladores detenidos.'; }
    else lim.hidden = true;
    // Carga térmica
    const lb = loadBreakdown(st), mx = Math.max(lb.total, lb.cool, 1000);
    $('kLoad').textContent = kW(lb.total);
    $('loadBars').innerHTML = lb.items.map((it) => `<div class="hb"><span>${it.label}</span><span class="t"><i style="width:${(it.W / mx) * 100}%"></i></span><b>${(it.W / 1000).toFixed(1)}</b></div>`).join('') +
      `<div class="hb cool"><span>Refrigeración</span><span class="t"><i style="width:${(lb.cool / mx) * 100}%"></i></span><b>${(lb.cool / 1000).toFixed(1)}</b></div>`;
    // ¿Por qué?
    const L = st.loads, rows = [['Producto', L.product], ['Puerta e infiltración', L.door + L.doorLat], ['Paredes', L.walls], ['Iluminación', L.lights], ['Ventiladores', L.fans], ['Otros', L.other], ['Refrigeración', -o.Q]].filter((x) => Math.abs(x[1]) > 50);
    const net = rows.reduce((s, x) => s + x[1], 0);
    $('why').innerHTML = rows.sort((x, y) => y[1] - x[1]).map(([n, v]) => `<div class="w ${v < 0 ? 'neg' : ''}"><span>${n}${n === 'Producto' && v < 0 ? ' (absorbe calor)' : ''}</span><b>${v >= 0 ? '+' : '−'}${Math.abs(v / 1000).toFixed(1)} kW</b></div>`).join('') +
      `<div class="w net"><span>Balance neto</span><b>${net >= 0 ? '+' : '−'}${Math.abs(net / 1000).toFixed(1)} kW</b></div>` +
      `<div class="verdict">${net > 500 ? '↑ Entra más calor del que se retira: el aire se calienta.' : net < -500 ? '↓ Se retira más calor del que entra: el aire se enfría.' : '≈ Equilibrio: la temperatura se mantiene.'}</div>`;
    // Energía
    const E = st.energy, kwh = E.J / 3.6e6;
    $('kE').textContent = `${kwh.toFixed(1)} kWh`; $('kCost').textContent = `${p.currency} ${(kwh * p.tariff).toFixed(2)}`; $('kStarts').textContent = st.ctrl.starts;
    $('kEsplit').textContent = `Compresor ${(E.compJ / 3.6e6).toFixed(1)} · Ventiladores ${(E.fanJ / 3.6e6).toFixed(1)} · Otros ${(E.otherJ / 3.6e6).toFixed(1)} kWh · Tarifa ${p.currency} ${p.tariff}/kWh`;
    // Recuperación
    const ra = st.rec.active, rl = st.rec.list[st.rec.list.length - 1], R = ra || rl;
    if (R) {
      const kv = (rows) => `<div class="kv">${rows.map(([x, y]) => `<span>${x}</span><b>${y}</b>`).join('')}</div>`;
      $('recBox').className = '';
      $('recBox').innerHTML = kv([
        ['Evento', R.label],
        ['Duración', ra && ra.tEnd === null ? `en curso ${fmtDur(st.t - R.tStart)}` : fmtDur(((R.tEnd ?? st.t) - R.tStart))],
        ['T máxima (aire)', `${R.Tmax.toFixed(1)} °C`],
        ['Recovery time', ra ? (ra.tEnd === null ? '—' : `recuperando ${fmtDur(st.t - ra.tEnd)}`) : `${R.recMin.toFixed(0)} min`],
        ['Consumo extra', ra ? `${Math.max(0, (E.J - R.E0 - R.pBase * (st.t - R.tStart)) / 3.6e6).toFixed(2)} kWh` : `${R.extraKWh.toFixed(2)} kWh`],
      ]) + (ra ? '' : `<p class="muted small">Recuperado a las ${clock(R.tRec)} · referencia ${R.ref?.toFixed(1)} °C</p>`);
    }
    // Pull-down
    const bt = st.batches.filter((x) => x.id > 0).pop();
    if (bt && bt.Tc !== undefined) {
      const pr = PRODUCTS[bt.product], el = (bt.done ? bt.tDone : st.t) - bt.tStart;
      $('pdBox').className = '';
      $('pdBox').innerHTML = `<div class="kv"><span>Lote</span><b>${bt.id} · ${bt.n} × ${pr.name}</b><span>Inicio</span><b>${bt.T0} °C</b><span>Núcleo actual</span><b>${bt.Tc.toFixed(1)} °C</b><span>Objetivo</span><b>${batchTarget(bt, p).toFixed(1)} °C</b>` +
        `<span>Tiempo estimado</span><b>${bt.done ? 'completado' : bt.est ? fmtDur(bt.est) : bt.reachable === false ? 'no alcanzable' : 'estimando…'}</b><span>Tiempo actual</span><b>${fmtDur(el)}</b></div>` +
        `<div class="prog"><i style="width:${(bt.progress * 100).toFixed(0)}%"></i></div><p class="muted small">Progreso ${(bt.progress * 100).toFixed(0)} %${bt.reachable === false ? ' · el setpoint impide llegar al objetivo' : ''}</p>`;
    }
    // Condensación
    $('kCond').textContent = k.condRisk.toUpperCase(); $('kCond').className = 'right risk-' + k.condRisk;
    $('kCondTxt').textContent = `${k.condRisk === 'alto' ? '⚠ Riesgo alto cerca de la puerta. ' : ''}Punto de rocío local ${k.dew.toFixed(1)} °C vs superficie más fría del sector puerta ${(k.dew - k.condMargin).toFixed(1)} °C.`;
  }

  function renderTop() {
    const st = ST(), day = Math.floor((START_CLOCK + st.t) / 86400) + 1;
    $('clock').textContent = `Día ${day} · ${clock(st.t)}`;
    const A = st.alarms.active, pill = $('alarmPill');
    if (!A.length) { pill.className = 'pill ok'; $('alarmText').textContent = 'Normal'; }
    else { pill.className = 'pill ' + A[0].level; $('alarmText').textContent = `⚠ ${A[0].title}${A.length > 1 ? ` (+${A.length - 1})` : ''}`; }
    // Puerta
    const d = st.door, p = P(), btn = $('btnDoor');
    btn.textContent = d.cmd ? 'CERRAR PUERTA' : 'ABRIR PUERTA'; btn.classList.toggle('open', d.cmd);
    btn.disabled = !!st.ingress; btn.title = st.ingress ? 'Puerta controlada por el ingreso en curso' : '';
    const qShow = d.cmd ? d.Q : d.loadJ / Math.max(1, d.lastDur);
    const info = `<div><span>${d.cmd ? 'Carga adicional' : 'Carga media'}</span><b>+${(qShow / 1000).toFixed(1)} kW</b></div><div><span>Tiempo abierta</span><b>${d.cmd ? fmtDur(st.t - d.openedAt) : fmtDur(d.lastDur)}</b></div><div><span>Energía adicional estimada</span><b>+${(d.elecJ / 3.6e6).toFixed(2)} kWh</b></div>`;
    $('doorInfo').hidden = !(d.cmd || d.count > 0); $('doorInfo').innerHTML = (d.cmd ? '' : '<small class="muted">Última apertura</small>') + info;
    $('doorBanner').hidden = !d.cmd;
    if (d.cmd) $('doorBanner').innerHTML = `<div><small>Puerta abierta</small><b>${fmtDur(st.t - d.openedAt)}</b></div><div><small>Carga adicional</small><b>+${(d.Q / 1000).toFixed(1)} kW</b></div><div><small>Energía adicional</small><b>+${(d.elecJ / 3.6e6).toFixed(2)} kWh</b></div><div><small>HR</small><b>${st.kpi.rh.toFixed(0)} %</b></div>`;
    // Ingreso
    const g = st.ingress, free = app.sim.freeSlots();
    $('btnIngress').disabled = !!g || free <= 0; $('btnIngress').classList.toggle('run', !!g);
    $('ingressInfo').textContent = g ? `Ingresando lote ${g.batch.id}: ${g.batch.n - g.left}/${g.batch.n} en cámara · montacargas en ruta` : free <= 0 ? 'Cámara llena.' : `${free} posiciones libres.`;
    // Bloqueos por contexto
    $('capAvail').disabled = !p.refrigOn; $('capLock').hidden = p.refrigOn;
    $('fan').disabled = st.evap.defrostLeft > 0;
    $('ctrlLock').hidden = p.refrigOn; $('ctrlLock').textContent = '🔒 Refrigeración apagada: el control no actúa.';
    $('evapFail').checked = p.evapFail;
    $('btnCut').classList.toggle('on', st.cut); $('btnCut').textContent = st.cut ? `⚡ Sin energía ${fmtDur(st.cutUntil - st.t)}` : '⚡ Corte 10 min';
    $('btnPulse').disabled = d.cmd || !!st.ingress;
    const lt = document.getElementById('legTime'); if (lt) lt.textContent = clock(st.t);
    const ls = document.getElementById('legSlice'), si = app.scene.sliceInfo();
    if (ls && si) ls.textContent = `${si.mode === 'h' ? 'h' : 'y'} = ${(si.mode === 'h' ? si.h : si.y).toFixed(1)} m · ${si.min.toFixed(1)} … ${si.max.toFixed(1)} °C · isotermas cada ${si.step} °C`;
    fanNote(); ladder();
  }

  function renderTimeline() {
    const st = ST(), fl = FILTER[ui.filter];
    const key = st.log.length + ':' + ui.filter;
    if (key === ui.logLen) return;
    ui.logLen = key;
    const items = st.log.filter((e) => !fl || fl.includes(e.kind)).slice(-200);
    const el = $('timeline'), atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    el.innerHTML = items.map((e) => `<li class="${e.level}"><time>${clock(e.t)}</time><span>${GLY[e.kind] || '•'}</span><div>${e.text}</div></li>`).join('');
    if (atBottom) el.scrollTop = el.scrollHeight;
  }

  function alarmCard(a) {
    return `<div class="alarm ${a.level}"><h4>⚠ ${a.title}</h4><div>${a.msg}</div><div class="kv"><span>Desde</span><b>${clock(a.since)} (${fmtDur(ST().t - a.since)})</b><span>Causa probable</span><b>${a.cause}</b><span>Impacto</span><b>${a.impact}</b><span>Acción sugerida</span><b>${a.action}</b></div></div>`;
  }
  function renderAlarmDetail() {
    const A = ST().alarms.active;
    $('alarmDetail').innerHTML = A.length ? A.map(alarmCard).join('') : '<p>● Sin alarmas activas. Operación normal.</p>';
  }
  function renderAlarmsTab() {
    const st = ST(), A = st.alarms.active, hist = st.log.filter((e) => e.kind === 'alarm').slice(-30).reverse();
    $('alarmList').innerHTML = (A.length ? A.map(alarmCard).join('') : '<p>● Sin alarmas activas.</p>') +
      `<h4 class="muted">Historial</h4><ol class="timeline">${hist.map((e) => `<li class="${e.level}"><time>${clock(e.t)}</time><span>${GLY.alarm}</span><div>${e.text}</div></li>`).join('') || '<li><span></span><span></span><div class="muted">Sin eventos de alarma.</div></li>'}</ol>`;
  }

  function renderBalance() {
    const st = ST(), L = st.loads, o = st.evapOut;
    const gains = [['Producto', Math.max(0, L.product)], ['Paredes', Math.max(0, L.walls)], ['Puerta', Math.max(0, L.door) + L.doorLat], ['Iluminación', L.lights], ['Ventiladores', L.fans], ['Otros', L.other]];
    const tot = gains.reduce((s, g) => s + g[1], 0), Q = o.Q, net = tot - Q;
    // Fuentes → nodo CALOR → sumideros. Si se retira más de lo que entra, la diferencia sale del aire/producto.
    const src = [...gains.map(([n, v]) => [n, v, COLORS.sLoad]), ...(net < 0 ? [['Del aire/producto', -net, '#3987e5']] : [])].filter((x) => x[1] > 0);
    const sink = [['REFRIGERACIÓN', Q, COLORS.sCool], ...(net > 0 ? [['Calienta aire y producto', net, '#8b9bb0']] : [])].filter((x) => x[1] > 0);
    const big = Math.max(tot, Q), Wd = 760, Hh = 260, gap = 5, sc = (Hh - 30 - gap * (src.length - 1)) / Math.max(big, 1000);
    const x0 = 190, xm = 360, x1 = 530, cyTop = 15 + (Hh - 30 - big * sc) / 2;
    const band = (xa, ya, ha, xb, yb, color, op) => `<path d="M${xa},${ya} C${(xa + xb) / 2},${ya} ${(xa + xb) / 2},${yb} ${xb},${yb} L${xb},${yb + ha} C${(xa + xb) / 2},${yb + ha} ${(xa + xb) / 2},${ya + ha} ${xa},${ya + ha} Z" fill="${color}" fill-opacity="${op}"/>`;
    const txt = (x, y, t, anchor = 'start', col = '#e6edf3') => `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${col}" font-size="12">${t}</text>`;
    let svg = '', y = 15, yc = cyTop;
    for (const [n, v, c] of src) {
      const h = Math.max(1.5, v * sc);
      svg += band(x0, y, h, xm, yc, c, 0.45) + `<rect x="${x0 - 8}" y="${y}" width="8" height="${h}" fill="${c}"/>` + txt(x0 - 12, y + h / 2 + 4, `${n} ${(v / 1000).toFixed(1)} kW`, 'end');
      y += h + gap; yc += v * sc;
    }
    svg += `<rect x="${xm}" y="${cyTop}" width="12" height="${Math.max(2, big * sc)}" fill="#c3c2b7"/>` + txt(xm + 6, cyTop - 5, `CALOR ${(big / 1000).toFixed(1)} kW`, 'middle', '#c3c2b7');
    let ys = cyTop, yo = 15;
    for (const [n, v, c] of sink) {
      const h = Math.max(1.5, v * sc);
      svg += band(xm + 12, ys, h, x1, yo, c, 0.5) + `<rect x="${x1}" y="${yo}" width="10" height="${h}" fill="${c}"/>` + txt(x1 + 16, yo + h / 2 + 4, `${n} ${(v / 1000).toFixed(1)} kW`);
      ys += v * sc; yo += h + 14;
    }
    $('sankey').setAttribute('viewBox', `0 0 ${Wd} ${Hh}`); $('sankey').innerHTML = svg;
    $('balTable').innerHTML = `<tr><th>Componente</th><th>kW</th><th>%</th></tr>` + gains.map(([n, v]) => `<tr><td>${n}</td><td>${(v / 1000).toFixed(2)}</td><td>${tot ? ((100 * v) / tot).toFixed(0) : 0}</td></tr>`).join('') +
      `<tr><td><b>Total cargas</b></td><td><b>${(tot / 1000).toFixed(2)}</b></td><td>100</td></tr><tr><td>Refrigeración</td><td>${(Q / 1000).toFixed(2)}</td><td></td></tr><tr><td>Neto (+ calienta / − enfría)</td><td>${(net / 1000).toFixed(2)}</td><td></td></tr>`;
  }

  function renderTable() {
    if ($('tableBox').hidden) return;
    const h = ST().hist.slice(-60).reverse();
    $('tableBox').innerHTML = `<table class="tbl"><tr><th>Hora</th><th>Aire °C</th><th>Superficie °C</th><th>Núcleo °C</th><th>Setpoint</th><th>Carga kW</th><th>Refrig. kW</th><th>Eléctrica kW</th><th>HR %</th></tr>` +
      h.map((r) => `<tr><td>${clock(r.t)}</td><td>${f1(r.Ta)}</td><td>${f1(r.Ts)}</td><td>${f1(r.Tc)}</td><td>${r.sp}</td><td>${f1(r.load)}</td><td>${f1(r.cool)}</td><td>${f1(r.elec)}</td><td>${r.rh.toFixed(0)}</td></tr>`).join('') + '</table>';
  }

  function renderExplain() { $('explainBody').innerHTML = explain(ST(), P()).map((s) => `<p>${s}</p>`).join(''); }

  function runAB() {
    const sc = $('abSc').value, dur = +$('abDur').value, base = { ...P() };
    const cfg = (side) => {
      const o = {};
      document.querySelectorAll(`[data-ab=${side}]`).forEach((el) => { const k = el.dataset.k; o[k] = el.type === 'number' ? +el.value : k === 'curtain' ? el.value === '1' : el.value; });
      Object.assign(o, PID_PRESETS[o.pidPreset] ? { Kp: PID_PRESETS[o.pidPreset].Kp, Ki: PID_PRESETS[o.pidPreset].Ki, Kd: PID_PRESETS[o.pidPreset].Kd } : {});
      o.U = INSULATION[o.insulation].U;
      return o;
    };
    const keep = { sp: base.sp, hyst: base.hyst, capNom: base.capNom, capAvail: base.capAvail, tariff: base.tariff, alarmOffset: base.alarmOffset };
    const A = runHeadless(sc, { ...keep, ...cfg('A') }, dur), B = runHeadless(sc, { ...keep, ...cfg('B') }, dur);
    ui.abRuns++;
    const rows = [
      ['Energía', (r) => r.kWh, (v) => `${v.toFixed(1)} kWh`, 'low'],
      ['Costo', (r) => r.cost, (v) => `${base.currency} ${v.toFixed(2)}`, 'low'],
      ['Oscilación T aire', (r) => r.osc, (v) => `±${(v / 2).toFixed(2)} °C`, 'low'],
      ['T aire máxima', (r) => r.Tmax, (v) => `${v.toFixed(1)} °C`, 'low'],
      ['Recovery promedio', (r) => r.recovery, (v) => (v == null ? '—' : `${v.toFixed(0)} min`), 'low'],
      ['Pull-down', (r) => r.pulldown, (v) => (v == null ? 'no completado' : fmtDur(v * 60)), 'low'],
      ['Núcleo final', (r) => r.TcEnd, (v) => `${v.toFixed(1)} °C`, 'low'],
      ['Arranques compresor', (r) => r.starts, (v) => `${v}`, 'low'],
      ['COP medio', (r) => r.copAvg, (v) => v.toFixed(2), 'high'],
      ['Minutos sobre alarma', (r) => r.aboveMin, (v) => `${v.toFixed(0)} min`, 'low'],
      ['HR final', (r) => r.rh, (v) => `${v.toFixed(0)} %`, null],
    ];
    const better = (a, b, dir) => (a == null || b == null || !dir || Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(a)) ? [false, false] : dir === 'low' ? [a < b, b < a] : [a > b, b > a]);
    const table = `<table class="tbl"><tr><th>KPI</th><th>A</th><th>B</th><th>Diferencia B − A</th></tr>` + rows.map(([n, g, fmt, dir]) => {
      const a = g(A), b = g(B), [ba, bb] = better(a, b, dir);
      const diff = a != null && b != null && typeof a === 'number' ? (b - a) : null;
      return `<tr><td>${n}</td><td class="${ba ? 'better' : ''}">${fmt(a)}${ba ? ' ✓' : ''}</td><td class="${bb ? 'better' : ''}">${fmt(b)}${bb ? ' ✓' : ''}</td><td>${diff == null ? '—' : (diff >= 0 ? '+' : '') + diff.toFixed(2)}</td></tr>`;
    }).join('') + '</table>';
    const desc = (c) => `${c.control === 'pid' ? `PID ${PID_PRESETS[c.pidPreset].label.toLowerCase()}` : 'ON/OFF'} · vent. ${c.fan} % · ${c.curtain ? 'con' : 'sin'} cortina · aislamiento ${c.insulation}`;
    $('abOut').innerHTML = `<div class="abres"><div class="card"><h4>A · ${desc(cfg('A'))}</h4><canvas id="abCa"></canvas></div><div class="card"><h4>B · ${desc(cfg('B'))}</h4><canvas id="abCb"></canvas></div></div>` +
      `<p class="muted small">${SCENARIOS[sc].name} · ${dur / 3600} h simuladas · misma semilla. ✓ = mejor valor.</p>` + table;
    const lo = Math.min(...A.trace.map((q) => q[1]), ...B.trace.map((q) => q[1])), hi = Math.max(...A.trace.map((q) => q[1]), ...B.trace.map((q) => q[1]));
    const opts = { ref: base.sp, min: lo, max: hi, x0: clock(0), x1: clock(dur) };
    requestAnimationFrame(() => { miniChart($('abCa'), [{ c: COLORS.sAir, pts: A.trace }], opts); miniChart($('abCb'), [{ c: COLORS.sAir, pts: B.trace }], opts); });
  }

  // =================== Faceplate TIC-01 y variables físicas ===================
  function renderFaceplate() {
    const st = ST(), p = P(), c = st.ctrl, man = p.ctrlMode === 'manual', pid = p.control === 'pid';
    const m = $('fpMode'); m.textContent = man ? 'MANUAL' : pid ? 'AUTO · PID' : 'AUTO · ON/OFF'; m.classList.toggle('man', man);
    const sp = c.spEff ?? p.sp, rows = [
      ['SP operador', `${p.sp.toFixed(1)} °C`], ['SP efectivo', `${sp.toFixed(2)} °C${Math.abs(sp - p.sp) > 0.01 ? ' ↝' : ''}`],
      ['PV (retorno T-02)', `${f1(c.pv)} °C`], ['Error e = PV − SP', `${(c.e || 0) >= 0 ? '+' : ''}${(c.e || 0).toFixed(2)} K`],
      ...(pid && !man ? [['P · I · D', `${c.P.toFixed(2)} · ${c.Iterm.toFixed(2)} · ${c.D.toFixed(2)}`], ['Salida calculada', `${(c.raw * 100).toFixed(0)} %${c.sat ? ' (satura)' : ''}`]] : []),
      ...(!pid && !man ? [['Banda ON / OFF', `${(sp + p.hyst).toFixed(1)} / ${(sp - p.hyst).toFixed(1)} °C`]] : []),
      ['Salida comandada', `${(c.uCmd * 100).toFixed(0)} %`], ['Carga aplicada (MV)', `${(c.u * 100).toFixed(0)} %`],
      ['Compresor', `${c.on ? 'ON' : 'OFF'} hace ${fmtDur(c.since || 0)}`], ['Bloqueo anti-ciclo', c.lockLeft > 0 ? fmtDur(c.lockLeft) : 'libre'],
      ['Arranques / h', st.t > 600 ? ((c.starts * 3600) / st.t).toFixed(1) : '—'],
    ];
    $('fpKv').innerHTML = rows.map(([a, b]) => `<span>${a}</span><b>${b}</b>`).join('');
    const why = $('fpWhy'); why.hidden = !c.why; if (c.why) why.textContent = `🔒 Salida retenida: ${c.why}.`;
    // Gráfico de barras del faceplate: PV/SP (termómetro), salida u y aportes P/I/D.
    const cv = $('fpCv'), g = cv.getContext('2d'), W = 150, H = 150, lo = sp - 5, hi = sp + 5, yT = (T) => 130 - ((Math.min(hi, Math.max(lo, T)) - lo) / (hi - lo)) * 115;
    g.clearRect(0, 0, W, H); g.font = '10px system-ui'; g.textAlign = 'center';
    g.fillStyle = '#0a1016'; g.fillRect(12, 15, 26, 115); g.strokeStyle = '#2e3e52'; g.strokeRect(12.5, 15.5, 25, 114);
    const pvy = yT(c.pv ?? sp); g.fillStyle = (c.e || 0) > p.alarmOffset ? '#d03b3b' : '#3987e5'; g.fillRect(14, pvy, 22, 130 - pvy);
    g.strokeStyle = '#fab219'; g.lineWidth = 2; g.beginPath(); g.moveTo(8, yT(sp)); g.lineTo(42, yT(sp)); g.stroke(); g.lineWidth = 1;
    if (!pid && !man) { g.setLineDash([3, 3]); g.strokeStyle = '#8b9bb0'; [sp + p.hyst, sp - p.hyst].forEach((v) => { g.beginPath(); g.moveTo(10, yT(v)); g.lineTo(40, yT(v)); g.stroke(); }); g.setLineDash([]); }
    g.fillStyle = '#8b9bb0'; g.fillText('PV', 25, 143); g.fillText(`${hi.toFixed(0)}`, 25, 11);
    g.fillStyle = '#0a1016'; g.fillRect(50, 15, 18, 115); g.strokeStyle = '#2e3e52'; g.strokeRect(50.5, 15.5, 17, 114);
    g.fillStyle = man ? '#fab219' : '#9085e9'; g.fillRect(52, 130 - c.u * 115, 14, c.u * 115); g.fillStyle = '#8b9bb0'; g.fillText('u', 59, 143);
    if (pid && !man) {
      [['P', c.P, '#3987e5'], ['I', c.Iterm, '#199e70'], ['D', c.D, '#9085e9']].forEach(([n, v, col], k) => {
        const x = 78 + k * 24, h = Math.max(-1, Math.min(1, v)) * 55;
        g.fillStyle = '#0a1016'; g.fillRect(x, 15, 18, 115); g.fillStyle = col; g.fillRect(x + 2, h > 0 ? 72 - h : 72, 14, Math.abs(h));
        g.strokeStyle = '#8b9bb0'; g.beginPath(); g.moveTo(x, 72.5); g.lineTo(x + 18, 72.5); g.stroke(); g.fillStyle = '#8b9bb0'; g.fillText(n, x + 9, 143);
      });
    } else { g.fillStyle = '#5b6b80'; g.textAlign = 'left'; g.fillText(man ? 'lazo abierto' : 'histéresis', 78, 75); }
  }

  function renderPhys() {
    const st = ST(), p = P(), o = st.evapOut, a = st.air, k = st.kpi, L = st.loads, R = st.R, tab = ui.phys || 'cyc';
    const r = (n, v, u = '') => `<tr><td>${n}</td><td>${v}${u ? ` <small>${u}</small>` : ''}</td></tr>`, h = (t) => `<tr class="h"><td colspan="2">${t}</td></tr>`;
    let out = '';
    if (tab === 'cyc') out = h('Evaporador (lado aire)') + r('Capacidad total Q', (o.Q / 1000).toFixed(2), 'kW') + r('Sensible / latente', `${(o.Qs / 1000).toFixed(2)} / ${(o.Qlat / 1000).toFixed(2)}`, 'kW') + r('Factor de calor sensible', o.SHR.toFixed(2)) + r('T evaporación', o.Tevap.toFixed(1), '°C') + r('ΔT aire–evaporación', o.TD.toFixed(1), 'K') + r('Efectividad ε (NTU)', o.eps.toFixed(2)) + r('UA efectivo (con escarcha)', (o.UA / 1000).toFixed(2), 'kW/K') + r('Escarcha acumulada', st.evap.frost.toFixed(1), 'kg') + r('Condensado', (o.mCond * 3600).toFixed(1), 'kg/h') +
      h('Compresor y condensador (R-404A aprox.)') + r('P succión', o.Psuc.toFixed(2), 'bar abs') + r('P descarga', o.Pdis.toFixed(2), 'bar abs') + r('Relación de compresión', (o.Pdis / o.Psuc).toFixed(2)) + r('T condensación', o.Tcond.toFixed(1), '°C') + r('Lift térmico', (o.Tcond - o.Tevap).toFixed(1), 'K') + r('COP Carnot / real', `${o.copCarnot.toFixed(2)} / ${o.Q > 0 ? o.cop.toFixed(2) : '—'}`) + r('Potencia compresor', (st.elec.comp / 1000).toFixed(2), 'kW') + r('Calor rechazado', (o.Qcond / 1000).toFixed(2), 'kW');
    else if (tab === 'air') out = h('Ventilación') + r('Caudal volumétrico', a.Vdot.toFixed(2), 'm³/s') + r('Caudal másico', a.mdot.toFixed(2), 'kg/s') + r('Renovaciones internas', ((a.Vdot * 3600) / (p.L * p.W * p.H)).toFixed(0), '1/h') + r('Potencia ventiladores', (st.elec.fan / 1000).toFixed(2), 'kW') + r('T impulsión / retorno', `${o.Tsup.toFixed(1)} / ${k.Tret.toFixed(1)}`, '°C') +
      a.col.map((m, j) => r(`Pasillo rack ${j + 1}`, `${m.toFixed(2)} kg/s · ${(a.vRatio[j] * 100).toFixed(0)} %`, 'del ref.')).join('') +
      h('Psicrometría') + r('HR media', k.rh.toFixed(0), '%') + r('Humedad absoluta w', (st.w * 1000).toFixed(2), 'g/kg') + r('Punto de rocío local (puerta)', k.dew.toFixed(1), '°C') + r('w exterior', (st.wExt * 1000).toFixed(2), 'g/kg') + r('Transpiración producto', (st.mTr * 3600).toFixed(2), 'kg/h') +
      h('Estratificación') + r('Zona más caliente', `${k.hot.T.toFixed(1)} °C`) + r('Rango entre zonas', (Math.max(...st.T) - Math.min(...st.T)).toFixed(2), 'K');
    else if (tab === 'env') out = h('Envolvente') + r('U paneles', p.U.toFixed(2), 'W/m²K') + r('Área total', R.wallA.reduce((s, x) => s + x, 0).toFixed(0), 'm²') + r('Conducción paredes', (L.walls / 1000).toFixed(2), 'kW') + r('ΔT exterior–interior', (p.tExt - k.Tavg).toFixed(1), 'K') +
      h('Puerta') + r('Apertura', (st.door.frac * 100).toFixed(0), '%') + r('Infiltración de aire', st.door.mInf.toFixed(2), 'kg/s') + r('Carga sensible puerta', (L.door / 1000).toFixed(2), 'kW') + r('Carga latente puerta', (L.doorLat / 1000).toFixed(2), 'kW') + r('Cortina de aire', p.curtain ? 'sí (−75 %)' : 'no') + r('Aperturas / tiempo total', `${st.door.count} / ${fmtDur(st.door.totalOpen + (st.door.cmd ? st.t - st.door.openedAt : 0))}`) +
      h('Internas') + r('Iluminación', (L.lights / 1000).toFixed(2), 'kW') + r('Otros (desescarche, montacargas)', (L.other / 1000).toFixed(2), 'kW');
    else {
      const inside = st.pallets.filter((q) => q.state !== 'outside');
      const resp = inside.reduce((s, q) => s + PRODUCTS[q.prod].resp * q.m * Math.exp(0.07 * q.Tc), 0);
      const E = inside.reduce((s, q) => s + q.Cs * (q.Ts - p.sp) + q.Cc * (q.Tc - p.sp), 0);
      const hp = k.hotPallet;
      out = h('Inventario') + r('Pallets en cámara', `${inside.length}`) + r('Masa de producto', (k.mass / 1000).toFixed(1), 't') + r('T superficie / núcleo', `${f1(k.Ts)} / ${f1(k.Tc)}`, '°C') + r('Calor sensible por retirar', (Math.max(0, E) / 3.6e6).toFixed(1), 'kWh') +
        r('Calor de respiración', (resp / 1000).toFixed(2), 'kW') + r('Intercambio aire→producto', (-L.product / 1000).toFixed(2), 'kW') +
        (hp ? h('Pallet más caliente') + r('Pallet', `#${hp.id} · ${PRODUCTS[hp.prod].name}`) + r('T superficie / núcleo', `${hp.Ts.toFixed(1)} / ${hp.Tc.toFixed(1)}`, '°C') + r('Límite de núcleo', PRODUCTS[hp.prod].tMax, '°C') : '') +
        (k.rhRange ? r('Rango HR recomendado', `${k.rhRange[0]}–${k.rhRange[1]}`, '%') : '');
    }
    $('physTbl').innerHTML = out;
  }

  // =================== Ciclo de refresco ===================
  function refresh(force) {
    const now = performance.now();
    if (force || now - ui.lastUI > 150) {
      ui.lastUI = now;
      renderTop(); renderKPIs(); renderTimeline(); lessons.tick(); renderFaceplate(); renderPhys();
      if (!$('tabAlarms').hidden) renderAlarmsTab();
      if (!$('tabBalance').hidden) renderBalance();
      if (ui.sel) showDetail();
    }
    if (force || now - ui.lastChart > 400) { ui.lastChart = now; app.charts.render(ST(), P()); renderTable(); }
  }

  return {
    refresh, setQuality,
    onLoad() {
      ui.sel = null; $('detail').hidden = true; ui.logLen = -1;
      syncControls(); syncSlice(); lessons.reset(); refresh(true);
    },
  };
}
