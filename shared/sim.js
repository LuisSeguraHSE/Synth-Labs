/* Synth-Labs · motor mínimo de simulación (sin dependencias)
 * SL.app({ title, desc, params, dt, sample, unit, init, step, draw, kpis, series, clock, vars, actions, inspect })
 *  - params: [{id,label,min,max,step,value,unit,reset,opts,sec}]  (reset:true => reinicia · sec => subtítulo de grupo)
 *  - init(p,rng) -> estado ; step(s,dt,p,rng) ; draw(ctx,s,p,W,H)
 *  - kpis(s,p) -> [{label,value}] ; series(s,p) -> {nombre:valor} (muestreado cada `sample` s sim)
 *  - vars(s,p) -> { fis: [fila], ctl: [fila] }   fila = [nombre, valor, unidad, barra0..1?, color?]
 *  - actions: [{ label, hint, kind:'warn'|'crit', on(s,p)->bool, run(s,p,rng,api) }]   botones en vivo
 *  - inspect(s,p,id) -> { title, sub, fis:[fila], ctl:[fila], actions:[{label,run}] }  para zonas SL.hot(id,x,y,w,h)
 *  - SL.log(s, texto, nivel)  registra evento (bitácora + marcador en tendencias) · nivel: info|warn|crit|ok
 *  - api = { set(id,valor), log(texto,nivel), select(id) }
 *  - heat: [{ id, label, unit, max, mode:'max'|'sum', fn(s,p) -> [[x,y,valor,radio_px], …] }]  capas de mapa de calor
 *    (instantáneo o promedio en el tiempo; rampa secuencial naranja, transparente en cero)
 *    heatPos: [x,y] posición de la leyenda del mapa (opcional)
 *  - SL.time: tiempo simulado actual (para animar bandas, aspas, balizas en gfx.js)
 */
(function () {
  const SL = (window.SL = {});
  const W = 800, H = 450, CH = 200, MAXPTS = 400, DEF_SPEEDS = [1, 5, 20, 60];

  SL.rng = function (seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s += 0x6d2b79f5;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  SL.exp = (r, mean) => -mean * Math.log(1 - r());
  SL.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  SL.lerp = (a, b, t) => a + (b - a) * t;
  SL.color = (v) => (v > 0.66 ? '#3ecf8e' : v > 0.33 ? '#f5b942' : '#ef5350'); // v en 0..1

  // Polilínea: SL.along(pts,d) -> {x,y,a} a distancia d (px) ; SL.len(pts) ; SL.belt(g,pts,w)
  SL.len = (pts) => pts.reduce((a, q, i) => (i ? a + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0), 0);
  SL.along = (pts, d) => {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d <= l || i === pts.length - 1) { const f = SL.clamp(d / l, 0, 1); return { x: SL.lerp(a[0], b[0], f), y: SL.lerp(a[1], b[1], f), a: Math.atan2(b[1] - a[1], b[0] - a[0]) }; }
      d -= l;
    }
  };
  // Transportador: patas, bastidor, guías laterales, banda con tacos que avanzan (SL.time × spd), rodillos y tambores.
  SL.belt = (g, pts, w, col, spd = 1) => {
    w = w || 22;
    const path = () => { g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); };
    g.save(); g.lineJoin = 'round'; g.lineCap = 'butt';
    if (w < 10) { path(); g.strokeStyle = col || '#2a3646'; g.lineWidth = w; g.stroke(); g.restore(); return; }
    // patas de soporte en tramos casi horizontales
    g.strokeStyle = '#2a3644'; g.lineWidth = 2;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], L = Math.hypot(bx - ax, by - ay);
      if (Math.abs(by - ay) > L * 0.3) continue;
      for (let d = 20; d < L - 10; d += 70) { const x = ax + ((bx - ax) * d) / L, y = ay + ((by - ay) * d) / L; g.beginPath(); g.moveTo(x - 3, y + w / 2 + 2); g.lineTo(x - 5, y + w / 2 + 14); g.moveTo(x + 3, y + w / 2 + 2); g.lineTo(x + 5, y + w / 2 + 14); g.stroke(); g.fillStyle = '#10161d'; g.fillRect(x - 7, y + w / 2 + 13, 4, 1.5); g.fillRect(x + 3, y + w / 2 + 13, 4, 1.5); }
    }
    path(); g.strokeStyle = '#05080c'; g.lineWidth = w + 8; g.stroke();
    path(); g.strokeStyle = '#7b8da3'; g.lineWidth = w + 4; g.stroke();
    path(); g.strokeStyle = '#4b5b6e'; g.lineWidth = w + 1.5; g.stroke();
    path(); g.strokeStyle = col || '#232e3b'; g.lineWidth = w - 1; g.stroke();
    path(); g.setLineDash([1.5, 9]); g.lineDashOffset = -(SL.time || 0) * 30 * spd; g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = w - 3; g.stroke(); // tacos en movimiento
    path(); g.setLineDash([]); g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = Math.max(2, w * 0.3); g.stroke();
    path(); g.setLineDash([2, 14]); g.lineDashOffset = 0; g.strokeStyle = 'rgba(195,204,214,.35)'; g.lineWidth = w + 4; g.stroke(); // pernos del bastidor
    g.setLineDash([]);
    for (const q of [pts[0], pts[pts.length - 1]]) { g.fillStyle = '#5b6b80'; g.beginPath(); g.arc(q[0], q[1], w / 2 + 1, 0, 7); g.fill(); g.fillStyle = '#26313d'; g.beginPath(); g.arc(q[0], q[1], w / 5, 0, 7); g.fill(); } // tambores
    g.restore();
  };
  // Zonas interactivas: se registran en cada cuadro dentro de draw().
  let HOTS = [];
  SL.hot = (id, x, y, w, h) => { HOTS.push({ id, x, y, w, h }); };
  SL.log = (s, msg, lvl) => { (s._log || (s._log = [])).push({ t: s.t || 0, msg, lvl: lvl || 'info' }); if (s._log.length > 60) s._log.shift(); };
  SL.time = 0;
  // Rampa secuencial de un solo tono (naranja), oscuro = bajo → claro = alto sobre fondo oscuro.
  const HEAT_STOPS = [[0, [122, 46, 16]], [0.35, [180, 70, 30]], [0.6, [217, 89, 38]], [0.8, [243, 154, 107]], [1, [253, 224, 207]]];
  SL.heatRGB = (t) => {
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < HEAT_STOPS.length; i++) if (t <= HEAT_STOPS[i][0]) {
      const [a, ca] = HEAT_STOPS[i - 1], [b, cb] = HEAT_STOPS[i], f = (t - a) / (b - a);
      return ca.map((v, k) => Math.round(v + (cb[k] - v) * f));
    }
    return HEAT_STOPS[HEAT_STOPS.length - 1][1];
  };
  SL.fmt = (v, d = 1) => (v == null || !isFinite(v) ? '—' : (+v).toFixed(d));
  SL.text = (g, t, x, y, col, font, al) => { g.fillStyle = col || '#8b9bb0'; g.font = font || '13px system-ui'; g.textAlign = al || 'left'; g.fillText(t, x, y); g.textAlign = 'left'; };
  SL.app = function (cfg) {
    const dt = cfg.dt || 0.1, sample = cfg.sample || 1, SPEEDS = cfg.speeds || DEF_SPEEDS;
    const root = document.getElementById('app');
    document.title = cfg.title + ' · Synth-Labs';
    root.innerHTML = `
      <header><a href="../../index.html">← Synth-Labs</a><h1>${cfg.title}</h1><p>${cfg.desc || ''}</p>${cfg.pitch ? `<blockquote>${cfg.pitch}</blockquote>` : ''}${cfg.obj ? `<p class="obj"><b>Objeción:</b> ${cfg.obj}</p>` : ''}</header>
      <main>
        <section class="view">
          ${cfg.heat ? `<div class="heatbar"><span class="hb-l">Mapa de calor</span><span id="heatSeg" class="seg small"><button data-h="-1" class="on">Off</button>${cfg.heat.map((h, i) => `<button data-h="${i}">${h.label}</button>`).join('')}</span><span id="heatMode" class="seg small"><button data-m="inst" class="on">Instantáneo</button><button data-m="avg">Promedio</button></span></div>` : ''}
          <div class="stage"><canvas id="c" width="${W}" height="${H}"></canvas><div id="tip" class="sl-tip" hidden></div>
            <div class="hint">${cfg.inspect ? '🖱 Pasa el cursor y haz clic sobre los equipos para inspeccionar · ' : ''}Espacio = pausa · R = reiniciar</div></div>
          <div class="stage"><canvas id="ch" width="${W}" height="${CH}"></canvas><div id="ctip" class="sl-tip" hidden></div></div>
        </section>
        <aside class="panel">
          <div class="ctl">
            <button id="play">⏸ Pausa</button><button id="reset">↺ Reiniciar</button>
            <span id="spd" class="seg"></span>
          </div>
          <div id="clock" class="clock"></div>
          <div id="insp" class="insp" hidden></div>
          ${cfg.actions ? '<h3>Acciones en vivo</h3><div id="acts" class="acts"></div>' : ''}
          <h3>Parámetros</h3><div id="params"></div>
          <div class="tabs" id="vtabs"><button data-t="k" class="on">KPIs</button>${cfg.vars ? '<button data-t="f">Físicas</button><button data-t="c">Control</button>' : ''}</div>
          <table id="kpis" class="vt"></table>
          <h3>Bitácora</h3><ol id="log" class="log"><li class="mut">Sin eventos aún</li></ol>
        </aside>
      </main>`;

    // Lienzos nítidos en pantallas de alta densidad: se dibuja en unidades lógicas (800 × 450).
    const dpr = Math.min(2, window.devicePixelRatio || 1), cv = root.querySelector('#c'), cvh = root.querySelector('#ch');
    cv.width = W * dpr; cv.height = H * dpr; cvh.width = W * dpr; cvh.height = CH * dpr;
    const c = cv.getContext('2d'), ch = cvh.getContext('2d');
    // Fondo de plano técnico (retícula + viñeta), pre-renderizado una vez.
    const bg = document.createElement('canvas'); bg.width = W * dpr; bg.height = H * dpr;
    (() => {
      const g = bg.getContext('2d'); g.scale(dpr, dpr);
      g.fillStyle = '#0e141b'; g.fillRect(0, 0, W, H);
      for (const [step, a] of [[25, 0.045], [100, 0.09]]) {
        g.strokeStyle = `rgba(56,189,248,${a})`; g.lineWidth = 1; g.beginPath();
        for (let x = 0; x <= W; x += step) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); }
        for (let y = 0; y <= H; y += step) { g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); }
        g.stroke();
      }
      const v = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.7);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.45)'); g.fillStyle = v; g.fillRect(0, 0, W, H);
    })();
    const p = {};
    let state, rng, hist, running = true, speed = 1, acc = 0, last = 0, nextSample = 0;

    // --- UI de parámetros
    const box = root.querySelector('#params');
    const ctrls = {};
    cfg.params.forEach((q) => {
      p[q.id] = q.value;
      if (q.sec) { const h = document.createElement('h4'); h.className = 'sec'; h.textContent = q.sec; box.appendChild(h); }
      const row = document.createElement('label');
      if (q.opts) {
        row.innerHTML = `<span>${q.label}</span><span></span><select>${q.opts.map((o, i) => `<option value="${i}"${i === q.value ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
        const sel = row.querySelector('select');
        sel.onchange = () => { p[q.id] = +sel.value; if (q.reset !== false) reset(); };
        ctrls[q.id] = (v) => { sel.value = v; p[q.id] = +v; };
        box.appendChild(row);
        return;
      }
      row.innerHTML = `<span>${q.label}</span><output>${q.value} ${q.unit || ''}</output>
        <input type="range" min="${q.min}" max="${q.max}" step="${q.step}" value="${q.value}">`;
      const inp = row.querySelector('input'), out = row.querySelector('output');
      inp.oninput = () => {
        p[q.id] = +inp.value;
        out.textContent = `${inp.value} ${q.unit || ''}`;
        if (q.reset) reset();
      };
      ctrls[q.id] = (v) => { inp.value = v; p[q.id] = +inp.value; out.textContent = `${inp.value} ${q.unit || ''}`; window.SLControls?.paint(inp); };
      // Clic en la lectura LCD => entrada numérica exacta
      out.title = 'Clic para escribir un valor exacto'; out.classList.add('edit');
      out.onclick = (e) => {
        e.preventDefault();
        const n = document.createElement('input'); n.type = 'number'; n.min = q.min; n.max = q.max; n.step = q.step; n.value = p[q.id]; n.className = 'num';
        out.replaceWith(n); n.focus(); n.select();
        const done = (ok) => { if (ok && n.value !== '') { ctrls[q.id](SL.clamp(+n.value, q.min, q.max)); if (q.reset) reset(); } n.replaceWith(out); };
        n.onkeydown = (k) => { if (k.key === 'Enter') done(true); if (k.key === 'Escape') done(false); };
        n.onblur = () => done(true);
      };
      box.appendChild(row);
    });
    const spd = root.querySelector('#spd');
    SPEEDS.forEach((v) => {
      const b = document.createElement('button');
      b.textContent = '×' + v;
      b.onclick = () => { speed = v; mark(); };
      spd.appendChild(b);
    });
    const mark = () => [...spd.children].forEach((b, i) => b.classList.toggle('on', SPEEDS[i] === speed));
    mark();
    window.SLControls?.paintAll(root);
    root.querySelector('#play').onclick = (e) => {
      running = !running;
      e.target.textContent = running ? '⏸ Pausa' : '▶ Continuar';
      e.target.classList.toggle('accent', !running);
    };
    root.querySelector('#reset').onclick = reset;
    const playBtn = root.querySelector('#play');
    document.addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('input,select,textarea')) return;
      if (e.code === 'Space') { e.preventDefault(); playBtn.click(); }
      else if (e.key === 'r' || e.key === 'R') reset();
      else if (e.key === 'Escape') select(null);
    });

    // --- API para acciones e inspector
    let selId = null;
    const api = {
      set: (id, v) => { if (ctrls[id]) ctrls[id](v); },
      log: (msg, lvl) => SL.log(state, msg, lvl),
      select: (id) => select(id),
    };
    const acts = root.querySelector('#acts');
    const actBtns = [];
    (cfg.actions || []).forEach((a) => {
      const b = document.createElement('button'); b.className = 'big act' + (a.kind ? ' ' + a.kind : ''); b.textContent = a.label; if (a.hint) b.title = a.hint;
      b.onclick = () => { a.run(state, p, rng, api); if (!a.on) SL.log(state, a.label, a.kind === 'crit' ? 'crit' : a.kind === 'warn' ? 'warn' : 'info'); };
      acts.appendChild(b); actBtns.push([a, b]);
    });

    // --- Tabla de variables (KPIs / físicas / control)
    let vtab = 'k';
    root.querySelector('#vtabs').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return; vtab = b.dataset.t;
      [...e.currentTarget.children].forEach((x) => x.classList.toggle('on', x === b));
    };
    const rowsHTML = (rows) => (rows || []).map((r) => {
      const [k, v, u, bar, col] = r;
      const b = bar == null ? '' : `<div class="vbar"><i style="width:${(100 * SL.clamp(bar, 0, 1)).toFixed(1)}%;${col ? 'background:' + col : ''}"></i></div>`;
      return `<tr><td>${k}${b}</td><td${col ? ` style="color:${col}"` : ''}>${v}${u ? `<small> ${u}</small>` : ''}</td></tr>`;
    }).join('');

    // --- Inspector (clic en canvas) y tooltip
    const insp = root.querySelector('#insp'), tip = root.querySelector('#tip');
    const toLogic = (ev, el, h) => { const r = el.getBoundingClientRect(); return [((ev.clientX - r.left) / r.width) * W, ((ev.clientY - r.top) / r.height) * h, r]; };
    const hitAt = (x, y) => { for (let i = HOTS.length - 1; i >= 0; i--) { const z = HOTS[i]; if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return z; } return null; };
    let hover = null;
    function select(id) {
      selId = id; insp.hidden = !id; if (id) renderInsp(true);
    }
    function renderInsp(full) {
      const d = selId && cfg.inspect && cfg.inspect(state, p, selId);
      if (!d) { insp.hidden = true; selId = null; return; }
      const sec = (t, rows) => (rows && rows.length ? `<h5>${t}</h5><table class="vt">${rowsHTML(rows)}</table>` : '');
      const body = `${sec('Variables físicas', d.fis)}${sec('Variables de control', d.ctl)}`;
      if (full || !insp.querySelector('.ib')) {
        insp.innerHTML = `<div class="ih"><b>${d.title}</b><button class="ghost x" title="Cerrar (Esc)">✕</button></div>${d.sub ? `<p class="mut">${d.sub}</p>` : ''}<div class="ib">${body}</div><div class="ia"></div>`;
        insp.querySelector('.x').onclick = () => select(null);
        const ia = insp.querySelector('.ia');
        (d.actions || []).forEach((a, i) => { const b = document.createElement('button'); b.textContent = a.label; b.onclick = () => { const cur = cfg.inspect(state, p, selId); cur && cur.actions && cur.actions[i] && cur.actions[i].run(state, p, rng, api); SL.log(state, `${d.title}: ${a.label}`, a.kind || 'warn'); renderInsp(true); }; ia.appendChild(b); });
      } else insp.querySelector('.ib').innerHTML = body;
    }
    cv.addEventListener('mousemove', (ev) => {
      if (!cfg.inspect) return;
      const [x, y, r] = toLogic(ev, cv, H), z = hitAt(x, y);
      hover = z ? z.id : null; cv.style.cursor = z ? 'pointer' : '';
      const d = z && cfg.inspect(state, p, z.id);
      const hv = heatI >= 0 ? `<div><span>🔥 ${cfg.heat[heatI].label}</span><em>${SL.fmt(heatAt(x, y), 2)} ${cfg.heat[heatI].unit || ''}</em></div>` : '';
      if (!d && !hv) { tip.hidden = true; return; }
      if (!d) { tip.innerHTML = `<b>Mapa de calor</b>${hv}`; tip.hidden = false; const px = ev.clientX - r.left, py = ev.clientY - r.top; tip.style.left = Math.min(px + 14, r.width - tip.offsetWidth - 4) + 'px'; tip.style.top = Math.min(py + 14, r.height - tip.offsetHeight - 4) + 'px'; return; }
      const rows = [...(d.fis || []).slice(0, 3), ...(d.ctl || []).slice(0, 2)];
      tip.innerHTML = `<b>${d.title}</b>${rows.map((q) => `<div><span>${q[0]}</span><em>${q[1]}${q[2] ? ' ' + q[2] : ''}</em></div>`).join('')}${hv}<small>clic para inspeccionar</small>`;
      tip.hidden = false;
      const px = ev.clientX - r.left, py = ev.clientY - r.top;
      tip.style.left = Math.min(px + 14, r.width - tip.offsetWidth - 4) + 'px'; tip.style.top = Math.min(py + 14, r.height - tip.offsetHeight - 4) + 'px';
    });
    cv.addEventListener('mouseleave', () => { tip.hidden = true; hover = null; });
    cv.addEventListener('click', (ev) => { if (!cfg.inspect) return; const [x, y] = toLogic(ev, cv, H), z = hitAt(x, y); select(z ? z.id : null); });

    // --- Mapa de calor: rejilla 160×90 (celda 5 px) con núcleo gaussiano, instantáneo o promedio temporal
    const GW = 160, GH = 90, CS = W / GW;
    let heatI = -1, heatM = 'inst', heatInst = new Float32Array(GW * GH), heatAcc = [], heatN = [], heatMax = [], heatFrame = 0;
    const heatCv = document.createElement('canvas'); heatCv.width = GW; heatCv.height = GH;
    const hctx = heatCv.getContext('2d'), himg = hctx.createImageData(GW, GH);
    function heatGrid(L, out) {
      out.fill(0);
      const pts = L.fn(state, p) || [], sum = L.mode === 'sum';
      for (const [x, y, v, r0] of pts) {
        if (!(v > 0)) continue;
        const r = Math.max(CS, r0 || 30), sig2 = 2 * (r / 2) ** 2, R = Math.ceil(r / CS);
        const cx = Math.floor(x / CS), cy = Math.floor(y / CS);
        for (let j = Math.max(0, cy - R); j <= Math.min(GH - 1, cy + R); j++) for (let i = Math.max(0, cx - R); i <= Math.min(GW - 1, cx + R); i++) {
          const dx = (i + 0.5) * CS - x, dy = (j + 0.5) * CS - y, k = Math.exp(-(dx * dx + dy * dy) / sig2);
          if (k < 0.02) continue;
          const o = j * GW + i;
          if (sum) out[o] += v * k; else if (v * k > out[o]) out[o] = v * k;
        }
      }
      return out;
    }
    function heatSample() { // acumula todas las capas para el promedio temporal
      (cfg.heat || []).forEach((L, k) => {
        if (!heatAcc[k]) { heatAcc[k] = new Float32Array(GW * GH); heatN[k] = 0; }
        const g = heatGrid(L, new Float32Array(GW * GH)); for (let o = 0; o < g.length; o++) heatAcc[k][o] += g[o]; heatN[k]++;
      });
    }
    function heatField() {
      const L = cfg.heat[heatI];
      if (heatM === 'avg' && heatN[heatI]) { const a = heatAcc[heatI], n = heatN[heatI]; for (let o = 0; o < a.length; o++) heatInst[o] = a[o] / n; }
      else heatGrid(L, heatInst);
      return heatInst;
    }
    let heatPeak = null, heatScale = 1;
    function drawHeat(g) {
      if (heatI < 0) return;
      const L = cfg.heat[heatI];
      if ((heatFrame = (heatFrame + 1) % 3) === 1 || !heatPeak) {
        const f = heatField(); let mx = 0, mo = 0; for (let o = 0; o < f.length; o++) if (f[o] > mx) { mx = f[o]; mo = o; }
        const fixed = typeof L.max === 'function' ? L.max(state, p) : L.max;
        heatMax[heatI] = Math.max(heatMax[heatI] || 0, mx);
        heatScale = fixed || heatMax[heatI] || 1;
        heatPeak = { x: (mo % GW + 0.5) * CS, y: (Math.floor(mo / GW) + 0.5) * CS, v: mx };
        const d = himg.data;
        for (let o = 0; o < f.length; o++) {
          const t = f[o] / heatScale, q = o * 4;
          if (t < 0.03) { d[q + 3] = 0; continue; }
          const c = SL.heatRGB(t); d[q] = c[0]; d[q + 1] = c[1]; d[q + 2] = c[2]; d[q + 3] = Math.round(255 * Math.min(0.72, 0.18 + 0.6 * t));
        }
        hctx.putImageData(himg, 0, 0);
      }
      g.save(); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(heatCv, 0, 0, W, H);
      // Isolíneas a 25 / 50 / 75 % de la escala (marching squares con interpolación lineal sobre centros de celda)
      g.lineWidth = 1; const f = heatInst;
      for (const lv of [0.25, 0.5, 0.75]) {
        const th = lv * heatScale; g.strokeStyle = `rgba(253,224,207,${0.2 + 0.4 * lv})`; g.beginPath();
        for (let j = 0; j < GH - 1; j++) for (let i = 0; i < GW - 1; i++) {
          const v0 = f[j * GW + i], v1 = f[j * GW + i + 1], v2 = f[(j + 1) * GW + i + 1], v3 = f[(j + 1) * GW + i];
          const k = (v0 >= th) | ((v1 >= th) << 1) | ((v2 >= th) << 2) | ((v3 >= th) << 3);
          if (k === 0 || k === 15) continue;
          const x0 = (i + 0.5) * CS, y0 = (j + 0.5) * CS, it = (a, b) => (th - a) / (b - a || 1e-9);
          const E = [[x0 + CS * it(v0, v1), y0], [x0 + CS, y0 + CS * it(v1, v2)], [x0 + CS * it(v3, v2), y0 + CS], [x0, y0 + CS * it(v0, v3)]];
          const seg = (a, b) => { g.moveTo(E[a][0], E[a][1]); g.lineTo(E[b][0], E[b][1]); };
          switch (k) { case 1: case 14: seg(3, 0); break; case 2: case 13: seg(0, 1); break; case 3: case 12: seg(3, 1); break; case 4: case 11: seg(1, 2); break;
            case 6: case 9: seg(0, 2); break; case 7: case 8: seg(3, 2); break; case 5: seg(3, 0); seg(1, 2); break; case 10: seg(0, 1); seg(2, 3); break; }
        }
        g.stroke();
      }
      // Pico
      if (heatPeak && heatPeak.v > 0.03 * heatScale) {
        const { x, y, v } = heatPeak; g.strokeStyle = '#fde0cf'; g.lineWidth = 1.5;
        g.beginPath(); g.arc(x, y, 7, 0, 7); g.moveTo(x - 11, y); g.lineTo(x - 4, y); g.moveTo(x + 4, y); g.lineTo(x + 11, y); g.moveTo(x, y - 11); g.lineTo(x, y - 4); g.moveTo(x, y + 4); g.lineTo(x, y + 11); g.stroke();
        SL.tag(g, `máx ${SL.fmt(v, v < 10 ? 2 : 0)} ${L.unit || ''}`, SL.clamp(x, 50, W - 50), y > 30 ? y - 20 : y + 20, '#fde0cf');
      }
      // Leyenda: barra de gradiente con extremos y unidad
      const lx = (cfg.heatPos || [12])[0], ly = (cfg.heatPos || [0, 14])[1], lw = 150;
      const ttl = `${L.label} · ${heatM === 'avg' ? `promedio (${heatN[heatI] || 0} muestras)` : 'instantáneo'}`;
      g.font = '600 10.5px system-ui'; const bw = Math.max(lw, g.measureText(ttl).width) + 12;
      g.fillStyle = 'rgba(8,12,18,.88)'; SL.rr ? SL.rr(g, lx - 6, ly - 8, bw, 40, 6) : g.rect(lx - 6, ly - 8, bw, 40); g.fill();
      const gr = g.createLinearGradient(lx, 0, lx + lw, 0); for (let k = 0; k <= 10; k++) { const c = SL.heatRGB(k / 10); gr.addColorStop(k / 10, `rgb(${c})`); }
      g.fillStyle = gr; g.fillRect(lx, ly + 6, lw, 7);
      g.font = '600 10.5px system-ui'; g.fillStyle = '#e6edf3'; g.textAlign = 'left'; g.fillText(ttl, lx, ly + 2);
      g.font = '10px system-ui'; g.fillStyle = '#8b9bb0'; g.fillText('0', lx, ly + 25); g.textAlign = 'right'; g.fillText(`${SL.fmt(heatScale, heatScale < 10 ? 1 : 0)} ${L.unit || ''}`, lx + lw, ly + 25);
      g.restore();
    }
    const heatAt = (x, y) => { const i = Math.floor(x / CS), j = Math.floor(y / CS); return i >= 0 && j >= 0 && i < GW && j < GH ? heatInst[j * GW + i] : 0; };
    if (cfg.heat) {
      const hs = root.querySelector('#heatSeg'), hm = root.querySelector('#heatMode');
      hs.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; heatI = +b.dataset.h; heatPeak = null; [...hs.children].forEach((x) => x.classList.toggle('on', x === b)); };
      hm.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; heatM = b.dataset.m; heatPeak = null; [...hm.children].forEach((x) => x.classList.toggle('on', x === b)); };
    }

    // --- Tendencias: leyenda conmutable y cursor con lectura
    const hidden = new Set(); let cx = -1, legX = [];
    cvh.addEventListener('mousemove', (ev) => { cx = toLogic(ev, cvh, CH)[0]; });
    cvh.addEventListener('mouseleave', () => { cx = -1; ctip.hidden = true; });
    cvh.addEventListener('click', (ev) => {
      const [x, y] = toLogic(ev, cvh, CH); if (y > 24) return;
      const hit = legX.find((q) => x >= q[0] && x < q[1]); if (!hit) return; const n = hit[2];
      hidden.has(n) ? hidden.delete(n) : hidden.add(n);
    });
    const ctip = root.querySelector('#ctip');

    function reset() {
      rng = SL.rng(42); // semilla fija => escenarios comparables
      state = cfg.init(p, rng); state.t = 0;
      hist = { names: [], data: {}, n: 0 };
      if (typeof heatAcc !== 'undefined') { heatAcc = []; heatN = []; heatMax = []; heatPeak = null; }
      nextSample = 0; nextHeat = 0; acc = 0; logSeen = -1;
      if (typeof select === 'function' && selId) renderInsp(true);
    }
    let logSeen = -1, nextHeat = 0;

    // --- gráfico de tendencias (cada serie normalizada a su propio máximo)
    const PAL = ['#4fc3f7', '#f5b942', '#3ecf8e', '#ef5350', '#ba68c8'];
    function drawChart(s) {
      ch.setTransform(dpr, 0, 0, dpr, 0, 0);
      ch.clearRect(0, 0, W, CH);
      ch.fillStyle = '#10151c'; ch.fillRect(0, 0, W, CH);
      ch.strokeStyle = '#243040'; ch.lineWidth = 1;
      for (let i = 1; i < 4; i++) { ch.beginPath(); ch.moveTo(0, (CH * i) / 4); ch.lineTo(W, (CH * i) / 4); ch.stroke(); }
      const len = hist.names.length ? hist.data[hist.names[0]].length : 0, x0 = hist.n - len;
      // Marcadores de eventos (bitácora)
      for (const e of s._log || []) {
        if (e.i == null || e.i < x0) continue;
        const x = ((e.i - x0) / (MAXPTS - 1)) * W;
        ch.strokeStyle = LV[e.lvl] || LV.info; ch.globalAlpha = 0.55; ch.setLineDash([3, 3]); ch.beginPath(); ch.moveTo(x, 24); ch.lineTo(x, CH - 18); ch.stroke(); ch.setLineDash([]); ch.globalAlpha = 1;
        ch.fillStyle = LV[e.lvl] || LV.info; ch.beginPath(); ch.moveTo(x - 4, CH - 12); ch.lineTo(x + 4, CH - 12); ch.lineTo(x, CH - 18); ch.fill();
      }
      legX = []; let lx = 8; ch.font = '12px system-ui'; const compact = hist.names.length > 3;
      const ci = cx >= 0 ? Math.round((cx / W) * (MAXPTS - 1)) : -1, rd = [];
      hist.names.forEach((n, k) => {
        const d = hist.data[n], col = PAL[k % PAL.length], off = hidden.has(n);
        const mx = Math.max(1e-9, ...d), mn = Math.min(0, ...d);
        if (!off) {
          ch.strokeStyle = col; ch.lineWidth = 1.6; ch.beginPath();
          d.forEach((v, i) => {
            const x = (i / (MAXPTS - 1)) * W, y = CH - 26 - ((v - mn) / (mx - mn || 1)) * (CH - 50);
            i ? ch.lineTo(x, y) : ch.moveTo(x, y);
          });
          ch.stroke();
          if (ci >= 0 && ci < d.length) { const y = CH - 26 - ((d[ci] - mn) / (mx - mn || 1)) * (CH - 50); ch.fillStyle = col; ch.beginPath(); ch.arc((ci / (MAXPTS - 1)) * W, y, 3.5, 0, 7); ch.fill(); rd.push([n, d[ci], col]); }
        }
        const lbl = `${n}: ${d[d.length - 1].toFixed(1)}${compact ? '' : ` (máx ${mx.toFixed(1)})`}`, lw = ch.measureText(lbl).width + 30;
        ch.globalAlpha = off ? 0.35 : 1; ch.fillStyle = col; ch.fillRect(lx, 8, 9, 9);
        ch.fillStyle = off ? '#5b6b80' : col;
        ch.fillText(lbl, lx + 14, 16); ch.globalAlpha = 1; legX.push([lx, lx + lw, n]); lx += lw;
      });
      if (ci >= 0 && ci < len) {
        const x = (ci / (MAXPTS - 1)) * W; ch.strokeStyle = 'rgba(230,237,243,.35)'; ch.beginPath(); ch.moveTo(x, 22); ch.lineTo(x, CH); ch.stroke();
        const t = (x0 + ci) * sample;
        ctip.innerHTML = `<b>${cfg.clock ? cfg.clock(t) : 't = ' + t.toFixed(1) + ' ' + (cfg.unit || 's')}</b>` + rd.map(([n, v, col]) => `<div><span style="color:${col}">● ${n}</span><em>${SL.fmt(v, 2)}</em></div>`).join('');
        ctip.hidden = false; const r = cvh.getBoundingClientRect(), px = (x / W) * r.width;
        ctip.style.left = (px > r.width / 2 ? px - ctip.offsetWidth - 12 : px + 12) + 'px'; ctip.style.top = '26px';
      } else ctip.hidden = true;
      ch.fillStyle = '#5b6b80'; ch.font = '11px system-ui'; ch.textAlign = 'right'; ch.fillText('clic en la leyenda = mostrar/ocultar · cada serie escalada a su propio máximo', W - 8, CH - 4); ch.textAlign = 'left';
    }
    const LV = { info: '#4fc3f7', warn: '#f5b942', crit: '#ef5350', ok: '#3ecf8e' };
    const logEl = root.querySelector('#log'), vtbl = root.querySelector('#kpis');

    const clk = root.querySelector('#clock');
    function frame(now) {
      const fdt = Math.min(0.1, (now - last) / 1000); last = now;
      if (running) {
        acc += fdt * speed;
        let n = 0;
        while (acc >= dt && n++ < 3000) {
          cfg.step(state, dt, p, rng); acc -= dt;
          if (state._log) for (const e of state._log) if (e.i == null) e.i = hist.n;
          state.t = (state.t || 0) + dt;
          if (cfg.heat && state.t >= nextHeat) { nextHeat += sample; heatSample(); }
          if (cfg.series && state.t >= nextSample) {
            nextSample += sample;
            const v = cfg.series(state, p);
            Object.keys(v).forEach((k) => {
              if (!hist.data[k]) { hist.data[k] = []; hist.names.push(k); }
              hist.data[k].push(v[k]);
              if (hist.data[k].length > MAXPTS) hist.data[k].shift();
            });
            hist.n++;
          }
        }
      }
      c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(bg, 0, 0);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      HOTS = []; SL.time = state.t || 0;
      c.save(); cfg.draw(c, state, p, W, H); c.restore();
      if (cfg.heat) drawHeat(c); // las figuras de gfx.js manejan su propia sombra
      if (state._log) for (const e of state._log) if (e.i == null) e.i = hist.n; // eventos disparados en pausa
      // Resalte de zona seleccionada / bajo el cursor
      for (const z of HOTS) {
        if (z.id !== selId && z.id !== hover) continue;
        c.save(); c.strokeStyle = z.id === selId ? '#38bdf8' : 'rgba(125,211,252,.55)'; c.lineWidth = z.id === selId ? 2 : 1.2; c.setLineDash(z.id === selId ? [6, 4] : [3, 3]);
        c.lineDashOffset = -((last / 60) % 20); c.strokeRect(z.x - 3, z.y - 3, z.w + 6, z.h + 6);
        if (z.id === selId) { c.setLineDash([]); c.fillStyle = 'rgba(56,189,248,.07)'; c.fillRect(z.x - 3, z.y - 3, z.w + 6, z.h + 6); }
        c.restore();
      }
      if (cfg.series) drawChart(state);
      clk.textContent = cfg.clock ? cfg.clock(state.t || 0) : `t = ${(state.t || 0).toFixed(1)} ${cfg.unit || 's'}`;
      if ((frameN = (frameN + 1) % 6) === 0) paintPanels(); // tablas a ~10 Hz: legibles y baratas
      requestAnimationFrame(frame);
    }
    let frameN = 0;
    function paintPanels() {
      if (vtab === 'k') vtbl.innerHTML = cfg.kpis(state, p).map((k) => `<tr><td>${k.label}</td><td>${k.value}</td></tr>`).join('');
      else { const v = cfg.vars(state, p) || {}; vtbl.innerHTML = rowsHTML(vtab === 'f' ? v.fis : v.ctl); }
      for (const [a, b] of actBtns) if (a.on) { const on = !!a.on(state, p); b.classList.toggle('open', on); }
      if (selId) renderInsp(false);
      const L = state._log || [], n = L.length ? L.length + '|' + L[L.length - 1].t : '0';
      if (n !== logSeen) {
        logSeen = n;
        logEl.innerHTML = L.length ? L.slice(-8).reverse().map((e) => `<li class="${e.lvl}"><time>${cfg.clock ? cfg.clock(e.t) : e.t.toFixed(1) + ' ' + (cfg.unit || 's')}</time>${e.msg}</li>`).join('') : '<li class="mut">Sin eventos aún</li>';
      }
    }
    reset();
    requestAnimationFrame((t) => { last = t; frame(t); });
  };
})();
