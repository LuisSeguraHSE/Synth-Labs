/* Synth-Labs · motor mínimo de simulación (sin dependencias)
 * SL.app({ title, desc, params, dt, sample, unit, init, step, draw, kpis, series, clock })
 *  - params: [{id,label,min,max,step,value,unit,reset}]  (reset:true => reinicia al cambiar)
 *  - init(p,rng) -> estado ; step(s,dt,p,rng) ; draw(ctx,s,p,W,H)
 *  - kpis(s,p) -> [{label,value}] ; series(s,p) -> {nombre:valor} (muestreado cada `sample` s sim)
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
  SL.belt = (g, pts, w, col) => {
    g.lineJoin = 'round'; g.lineCap = 'butt'; g.strokeStyle = col || '#2a3646'; g.lineWidth = w || 22;
    g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.stroke();
  };
  SL.text = (g, t, x, y, col, font, al) => { g.fillStyle = col || '#8b9bb0'; g.font = font || '13px system-ui'; g.textAlign = al || 'left'; g.fillText(t, x, y); g.textAlign = 'left'; };
  SL.app = function (cfg) {
    const dt = cfg.dt || 0.1, sample = cfg.sample || 1, SPEEDS = cfg.speeds || DEF_SPEEDS;
    const root = document.getElementById('app');
    document.title = cfg.title + ' · Synth-Labs';
    root.innerHTML = `
      <header><a href="../../index.html">← Synth-Labs</a><h1>${cfg.title}</h1><p>${cfg.desc || ''}</p>${cfg.pitch ? `<blockquote>${cfg.pitch}</blockquote>` : ''}${cfg.obj ? `<p class="obj"><b>Objeción:</b> ${cfg.obj}</p>` : ''}</header>
      <main>
        <section class="view">
          <canvas id="c" width="${W}" height="${H}"></canvas>
          <canvas id="ch" width="${W}" height="${CH}"></canvas>
        </section>
        <aside>
          <div class="ctl">
            <button id="play">⏸ Pausa</button><button id="reset">↺ Reiniciar</button>
            <span id="spd"></span>
          </div>
          <div id="clock" class="clock"></div>
          <h3>Parámetros</h3><div id="params"></div>
          <h3>KPIs</h3><table id="kpis"></table>
        </aside>
      </main>`;

    const c = root.querySelector('#c').getContext('2d');
    const ch = root.querySelector('#ch').getContext('2d');
    const p = {};
    let state, rng, hist, running = true, speed = 1, acc = 0, last = 0, nextSample = 0;

    // --- UI de parámetros
    const box = root.querySelector('#params');
    cfg.params.forEach((q) => {
      p[q.id] = q.value;
      const row = document.createElement('label');
      if (q.opts) {
        row.innerHTML = `<span>${q.label}</span><span></span><select>${q.opts.map((o, i) => `<option value="${i}"${i === q.value ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
        const sel = row.querySelector('select');
        sel.onchange = () => { p[q.id] = +sel.value; if (q.reset !== false) reset(); };
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
    root.querySelector('#play').onclick = (e) => {
      running = !running;
      e.target.textContent = running ? '⏸ Pausa' : '▶ Continuar';
    };
    root.querySelector('#reset').onclick = reset;

    function reset() {
      rng = SL.rng(42); // semilla fija => escenarios comparables
      state = cfg.init(p, rng); state.t = 0;
      hist = { names: [], data: {} };
      nextSample = 0; acc = 0;
    }

    // --- gráfico de tendencias (cada serie normalizada a su propio máximo)
    const PAL = ['#4fc3f7', '#f5b942', '#3ecf8e', '#ef5350', '#ba68c8'];
    function drawChart(s) {
      ch.clearRect(0, 0, W, CH);
      ch.fillStyle = '#10151c'; ch.fillRect(0, 0, W, CH);
      ch.strokeStyle = '#243040'; ch.lineWidth = 1;
      for (let i = 1; i < 4; i++) { ch.beginPath(); ch.moveTo(0, (CH * i) / 4); ch.lineTo(W, (CH * i) / 4); ch.stroke(); }
      hist.names.forEach((n, k) => {
        const d = hist.data[n];
        const mx = Math.max(1e-9, ...d), mn = Math.min(0, ...d);
        ch.strokeStyle = PAL[k % PAL.length]; ch.lineWidth = 1.6; ch.beginPath();
        d.forEach((v, i) => {
          const x = (i / (MAXPTS - 1)) * W, y = CH - 26 - ((v - mn) / (mx - mn || 1)) * (CH - 50);
          i ? ch.lineTo(x, y) : ch.moveTo(x, y);
        });
        ch.stroke();
        ch.fillStyle = PAL[k % PAL.length]; ch.font = '12px system-ui';
        ch.fillText(`${n}: ${d[d.length - 1].toFixed(1)} (máx ${mx.toFixed(1)})`, 8 + k * 185, 16);
      });
    }

    const kp = root.querySelector('#kpis'), clk = root.querySelector('#clock');
    function frame(now) {
      const fdt = Math.min(0.1, (now - last) / 1000); last = now;
      if (running) {
        acc += fdt * speed;
        let n = 0;
        while (acc >= dt && n++ < 3000) {
          cfg.step(state, dt, p, rng); acc -= dt;
          state.t = (state.t || 0) + dt;
          if (cfg.series && state.t >= nextSample) {
            nextSample += sample;
            const v = cfg.series(state, p);
            Object.keys(v).forEach((k) => {
              if (!hist.data[k]) { hist.data[k] = []; hist.names.push(k); }
              hist.data[k].push(v[k]);
              if (hist.data[k].length > MAXPTS) hist.data[k].shift();
            });
          }
        }
      }
      c.clearRect(0, 0, W, H);
      cfg.draw(c, state, p, W, H);
      if (cfg.series) drawChart(state);
      clk.textContent = cfg.clock ? cfg.clock(state.t || 0) : `t = ${(state.t || 0).toFixed(1)} ${cfg.unit || 's'}`;
      kp.innerHTML = cfg.kpis(state, p).map((k) => `<tr><td>${k.label}</td><td>${k.value}</td></tr>`).join('');
      requestAnimationFrame(frame);
    }
    reset();
    requestAnimationFrame((t) => { last = t; frame(t); });
  };
})();
