// Gráficos temporales (canvas 2D): temperaturas y potencias en dos paneles con el mismo eje de tiempo
// (nunca doble eje Y), cursor compartido con tooltip y marcadores de eventos sincronizados con la línea de tiempo.
import { COLORS, START_CLOCK } from './config.js';

export const clock = (t) => { const s = (START_CLOCK + t) % 86400; return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`; };
const INK = '#e6edf3', MUTED = '#8b9bb0', GRID = '#243040', SURF = '#10151c';
const TEMP = [{ k: 'Ta', n: 'Aire', c: COLORS.sAir }, { k: 'Ts', n: 'Superficie', c: COLORS.sSurf }, { k: 'Tc', n: 'Núcleo', c: COLORS.sCore }];
const POW = [{ k: 'load', n: 'Carga térmica', c: COLORS.sLoad }, { k: 'cool', n: 'Refrigeración', c: COLORS.sCool }, { k: 'elec', n: 'Potencia eléctrica', c: COLORS.sElec }];
const GLYPH = { door: '▯', ingress: '▦', alarm: '⚠', fail: '✖', defrost: '❄', user: '•', recovery: '✓', pulldown: '✓' };

function nice(span, n) {
  const raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), r = raw / mag;
  return (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
}

export function createCharts(o) {
  const S = { win: 4 * 3600, hoverT: null, mx: null, my: null, src: null, st: null, p: null };
  const pads = { l: 46, r: 14, t: 22, b: 22 };
  const panels = [
    { cv: o.tempCanvas, legend: o.tempLegend, series: TEMP, unit: '°C', ref: true, events: true },
    { cv: o.powCanvas, legend: o.powLegend, series: POW, unit: 'kW', zero: true },
  ];

  function view(st) {
    const h = st.hist; if (!h.length) return null;
    const tEnd = h[h.length - 1].t, t0 = S.win ? Math.max(h[0].t, tEnd - S.win) : h[0].t;
    let i0 = 0; while (i0 < h.length - 1 && h[i0].t < t0) i0++;
    return { h, i0, t0, t1: Math.max(tEnd, t0 + 60) };
  }

  function drawPanel(P, st, p, V) {
    const cv = P.cv, dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, hgt = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hgt * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = SURF; g.fillRect(0, 0, w, hgt);
    if (!V) return;
    const { h, i0, t0, t1 } = V, pw = w - pads.l - pads.r, ph = hgt - pads.t - pads.b;
    let lo = Infinity, hi = -Infinity;
    for (let i = i0; i < h.length; i++) for (const s of P.series) { const v = h[i][s.k]; if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    if (P.ref) { lo = Math.min(lo, p.sp - 1); hi = Math.max(hi, p.sp + 1); if (hi > p.sp + p.alarmOffset - 1.5) hi = Math.max(hi, p.sp + p.alarmOffset + 0.3); }
    if (P.zero) lo = 0;
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    const step = nice(Math.max(0.5, hi - lo), 4); lo = Math.floor(lo / step) * step; hi = Math.ceil((hi + 1e-9) / step) * step;
    const X = (t) => pads.l + ((t - t0) / (t1 - t0)) * pw, Y = (v) => pads.t + ph - ((v - lo) / (hi - lo)) * ph;
    P.X = X; P.Y = Y; P.t0 = t0; P.t1 = t1;
    // Rejilla y ejes (recesivos)
    g.font = '11px system-ui'; g.lineWidth = 1;
    for (let v = lo; v <= hi + 1e-9; v += step) {
      g.strokeStyle = GRID; g.beginPath(); g.moveTo(pads.l, Y(v)); g.lineTo(w - pads.r, Y(v)); g.stroke();
      g.fillStyle = MUTED; g.textAlign = 'right'; g.fillText(`${+v.toFixed(1)}`, pads.l - 6, Y(v) + 4);
    }
    g.textAlign = 'left'; g.fillText(P.unit, 4, pads.t - 8);
    const tStep = [600, 1200, 1800, 3600, 7200, 10800, 21600].find((s) => (t1 - t0) / s <= 7) || 43200;
    g.textAlign = 'center';
    for (let t = Math.ceil(t0 / tStep) * tStep; t <= t1; t += tStep) { g.strokeStyle = GRID; g.beginPath(); g.moveTo(X(t), pads.t); g.lineTo(X(t), pads.t + ph); g.stroke(); g.fillStyle = MUTED; g.fillText(clock(t), X(t), hgt - 6); }
    // Referencias: setpoint y límite de alarma (etiquetadas; no dependen del color)
    if (P.ref) {
      g.setLineDash([6, 4]); g.strokeStyle = '#c3c2b7'; g.beginPath(); g.moveTo(pads.l, Y(p.sp)); g.lineTo(w - pads.r, Y(p.sp)); g.stroke();
      g.fillStyle = '#c3c2b7'; g.textAlign = 'right'; g.fillText(`SP ${p.sp} °C`, w - pads.r - 2, Y(p.sp) - 4);
      const lim = p.sp + p.alarmOffset;
      if (lim <= hi) { g.setLineDash([2, 4]); g.strokeStyle = MUTED; g.beginPath(); g.moveTo(pads.l, Y(lim)); g.lineTo(w - pads.r, Y(lim)); g.stroke(); g.fillStyle = MUTED; g.fillText(`⚠ alarma ${lim} °C`, w - pads.r - 2, Y(lim) - 4); }
      g.setLineDash([]);
    }
    // Series (2 px)
    const stride = Math.max(1, Math.floor((h.length - i0) / pw));
    for (const s of P.series) {
      g.strokeStyle = s.c; g.lineWidth = 2; g.lineJoin = 'round'; g.beginPath();
      let pen = false;
      for (let i = i0; i < h.length; i += stride) { const v = h[i][s.k]; if (v == null) { pen = false; continue; } const x = X(h[i].t), y = Y(v); pen ? g.lineTo(x, y) : g.moveTo(x, y); pen = true; }
      g.stroke();
    }
    // Marcadores de eventos
    if (P.events) {
      P.marks = [];
      g.font = '12px system-ui'; g.textAlign = 'center';
      for (const e of st.log) {
        if (!GLYPH[e.kind] || e.t < t0 || e.t > t1) continue;
        const x = X(e.t);
        g.strokeStyle = e.level === 'crit' ? '#d03b3b' : e.level === 'warn' ? '#fab219' : '#5b6b80'; g.globalAlpha = 0.5; g.beginPath(); g.moveTo(x, pads.t); g.lineTo(x, pads.t + ph); g.stroke(); g.globalAlpha = 1;
        g.fillStyle = e.level === 'crit' ? '#d03b3b' : e.level === 'warn' ? '#fab219' : MUTED; g.fillText(GLYPH[e.kind], x, pads.t - 6);
        P.marks.push({ x, e });
      }
    }
    // Cursor
    if (S.hoverT !== null && S.hoverT >= t0 && S.hoverT <= t1) {
      const x = X(S.hoverT); g.strokeStyle = INK; g.globalAlpha = 0.6; g.beginPath(); g.moveTo(x, pads.t); g.lineTo(x, pads.t + ph); g.stroke(); g.globalAlpha = 1;
      const smp = nearest(h, S.hoverT);
      for (const s of P.series) { const v = smp?.[s.k]; if (v == null) continue; g.fillStyle = s.c; g.beginPath(); g.arc(x, Y(v), 4, 0, 7); g.fill(); g.strokeStyle = SURF; g.lineWidth = 2; g.stroke(); }
    }
  }

  function nearest(h, t) { let lo = 0, hi = h.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (h[m].t < t) lo = m; else hi = m; } return Math.abs(h[lo].t - t) < Math.abs(h[hi].t - t) ? h[lo] : h[hi]; }

  function legends(st) {
    const smp = S.hoverT !== null && st.hist.length ? nearest(st.hist, S.hoverT) : st.hist[st.hist.length - 1];
    for (const P of panels) {
      P.legend.innerHTML = P.series.map((s) => `<span class="lg"><i style="background:${s.c}"></i>${s.n} <b>${smp && smp[s.k] != null ? smp[s.k].toFixed(1) : '—'} ${P.unit}</b></span>`).join('') + (P.ref ? `<span class="lg"><i class="dash"></i>Setpoint <b>${st && S.p ? S.p.sp : ''} °C</b></span>` : '');
    }
  }

  function tooltip(st) {
    const tip = o.tip;
    if (S.hoverT === null || !st.hist.length) { tip.hidden = true; return; }
    const smp = nearest(st.hist, S.hoverT);
    let html = `<b>${clock(smp.t)}</b>`;
    html += TEMP.map((s) => `<div><i style="background:${s.c}"></i>${s.n}: ${smp[s.k] != null ? smp[s.k].toFixed(1) + ' °C' : '—'}</div>`).join('');
    html += POW.map((s) => `<div><i style="background:${s.c}"></i>${s.n}: ${smp[s.k].toFixed(1)} kW</div>`).join('');
    const P = panels[0];
    if (S.src === 0 && P.marks) {
      const ev = P.marks.filter((m) => Math.abs(m.x - S.mx) < 6).map((m) => `<div class="ev">${clock(m.e.t)} ${m.e.text}</div>`);
      if (ev.length) html += ev.slice(0, 4).join('');
    }
    tip.innerHTML = html; tip.hidden = false;
    const box = o.wrap.getBoundingClientRect(), cvr = panels[S.src].cv.getBoundingClientRect();
    let left = cvr.left - box.left + S.mx + 14, top = cvr.top - box.top + 6;
    if (left + 230 > box.width) left = cvr.left - box.left + S.mx - 240;
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  }

  panels.forEach((P, idx) => {
    P.cv.addEventListener('pointermove', (e) => {
      const r = P.cv.getBoundingClientRect(); S.mx = e.clientX - r.left; S.my = e.clientY - r.top; S.src = idx;
      if (P.X && S.mx >= pads.l) S.hoverT = P.t0 + ((S.mx - pads.l) / (r.width - pads.l - pads.r)) * (P.t1 - P.t0); else S.hoverT = null;
      if (S.st) render(S.st, S.p);
    });
    P.cv.addEventListener('pointerleave', () => { S.hoverT = null; if (S.st) render(S.st, S.p); });
  });

  function render(st, p) {
    S.st = st; S.p = p;
    const V = view(st);
    panels.forEach((P) => drawPanel(P, st, p, V));
    legends(st); tooltip(st);
  }

  return {
    render,
    setWindow(sec) { S.win = sec; },
    csv(st) {
      const head = 'hora,t_s,aire_C,retorno_C,superficie_C,nucleo_C,setpoint_C,carga_kW,refrigeracion_kW,electrica_kW,compresor_pct,HR_pct';
      return [head, ...st.hist.map((r) => [clock(r.t), r.t, r.Ta, r.Tr, r.Ts, r.Tc, r.sp, r.load, r.cool, r.elec, r.u * 100, r.rh].map((v) => (typeof v === 'number' ? +v.toFixed(3) : v ?? '')).join(','))].join('\n');
    },
  };
}

// Mini gráfico (detalle de sensor y comparación A/B)
export function miniChart(cv, series, opts = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = SURF; g.fillRect(0, 0, w, h);
  const all = series.flatMap((s) => s.pts.map((q) => q[1])).filter((v) => v != null);
  if (!all.length) return;
  let lo = Math.min(...all, opts.min ?? Infinity), hi = Math.max(...all, opts.max ?? -Infinity);
  if (hi - lo < 1) { hi += 0.5; lo -= 0.5; }
  const ts = series.flatMap((s) => s.pts.map((q) => q[0])), t0 = Math.min(...ts), t1 = Math.max(...ts, t0 + 1);
  const pl = 34, pr = 6, pt = 8, pb = 16, X = (t) => pl + ((t - t0) / (t1 - t0)) * (w - pl - pr), Y = (v) => pt + (h - pt - pb) - ((v - lo) / (hi - lo)) * (h - pt - pb);
  g.font = '10px system-ui'; g.fillStyle = MUTED; g.textAlign = 'right';
  [lo, (lo + hi) / 2, hi].forEach((v) => { g.strokeStyle = GRID; g.beginPath(); g.moveTo(pl, Y(v)); g.lineTo(w - pr, Y(v)); g.stroke(); g.fillText(v.toFixed(1), pl - 4, Y(v) + 3); });
  g.textAlign = 'left'; g.fillText(opts.x0 || '', pl, h - 3); g.textAlign = 'right'; g.fillText(opts.x1 || '', w - pr, h - 3);
  if (opts.ref != null) { g.setLineDash([5, 4]); g.strokeStyle = '#c3c2b7'; g.beginPath(); g.moveTo(pl, Y(opts.ref)); g.lineTo(w - pr, Y(opts.ref)); g.stroke(); g.setLineDash([]); }
  for (const s of series) {
    g.strokeStyle = s.c; g.lineWidth = 2; g.beginPath();
    s.pts.forEach((q, i) => (i ? g.lineTo(X(q[0]), Y(q[1])) : g.moveTo(X(q[0]), Y(q[1]))));
    g.stroke();
  }
}
