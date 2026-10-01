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
  // Transportador: bastidor, guías laterales, banda y rodillos (líneas finas < 10 px se dibujan simples).
  SL.belt = (g, pts, w, col) => {
    w = w || 22;
    const path = () => { g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); };
    g.save(); g.lineJoin = 'round'; g.lineCap = 'butt';
    if (w < 10) { path(); g.strokeStyle = col || '#2a3646'; g.lineWidth = w; g.stroke(); g.restore(); return; }
    path(); g.strokeStyle = '#070b10'; g.lineWidth = w + 7; g.stroke();
    g.shadowColor = 'transparent';
    path(); g.strokeStyle = '#6b7d93'; g.lineWidth = w + 3; g.stroke();
    path(); g.strokeStyle = col || '#2a3646'; g.lineWidth = w - 1; g.stroke();
    path(); g.setLineDash([2, 8]); g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = w - 3; g.stroke();
    path(); g.setLineDash([]); g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = Math.max(2, w * 0.25); g.stroke();
    g.restore();
  };
  // Zonas interactivas: se registran en cada cuadro dentro de draw().
  let HOTS = [];
  SL.hot = (id, x, y, w, h) => { HOTS.push({ id, x, y, w, h }); };
  SL.log = (s, msg, lvl) => { (s._log || (s._log = [])).push({ t: s.t || 0, msg, lvl: lvl || 'info' }); if (s._log.length > 60) s._log.shift(); };
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
      if (!d) { tip.hidden = true; return; }
      const rows = [...(d.fis || []).slice(0, 3), ...(d.ctl || []).slice(0, 2)];
      tip.innerHTML = `<b>${d.title}</b>${rows.map((q) => `<div><span>${q[0]}</span><em>${q[1]}${q[2] ? ' ' + q[2] : ''}</em></div>`).join('')}<small>clic para inspeccionar</small>`;
      tip.hidden = false;
      const px = ev.clientX - r.left, py = ev.clientY - r.top;
      tip.style.left = Math.min(px + 14, r.width - tip.offsetWidth - 4) + 'px'; tip.style.top = Math.min(py + 14, r.height - tip.offsetHeight - 4) + 'px';
    });
    cv.addEventListener('mouseleave', () => { tip.hidden = true; hover = null; });
    cv.addEventListener('click', (ev) => { if (!cfg.inspect) return; const [x, y] = toLogic(ev, cv, H), z = hitAt(x, y); select(z ? z.id : null); });

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
      nextSample = 0; acc = 0; logSeen = -1;
      if (typeof select === 'function' && selId) renderInsp(true);
    }
    let logSeen = -1;

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
      HOTS = [];
      c.save(); cfg.draw(c, state, p, W, H); c.restore(); // las figuras de gfx.js manejan su propia sombra
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
