/* Synth-Labs · kit de dibujo industrial 2D (canvas). Extiende window.SL (cargar después de sim.js).
 * Todas las funciones dibujan en unidades lógicas del lienzo (800 × 450). Vista lateral simple.
 * Estados: run (verde) · idle (gris) · block/warn (amarillo) · down (rojo) · setup (violeta) · info (azul). */
(function () {
  const SL = window.SL;
  const ST = { run: '#3ecf8e', idle: '#8b9bb0', block: '#f5b942', warn: '#f5b942', down: '#ef5350', setup: '#b39ddb', info: '#4fc3f7', off: '#4a5a6e' };
  SL.STATE = ST;
  const hex = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  // Aclara (k > 0) u oscurece (k < 0) un color #hex.
  SL.tint = (c, k) => {
    if (!c || c[0] !== '#') return c;
    const f = (v) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k));
    return `rgb(${hex(c).map(f).join(',')})`;
  };
  SL.alpha = (c, a) => (c && c[0] === '#' ? `rgba(${hex(c).join(',')},${a})` : c);
  SL.rr = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  SL.vgrad = (g, y, h, c1, c2) => { const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, c1); gr.addColorStop(1, c2); return gr; };
  SL.hgrad = (g, x, w, c1, c2) => { const gr = g.createLinearGradient(x, 0, x + w, 0); gr.addColorStop(0, c1); gr.addColorStop(1, c2); return gr; };
  const shadow = (g, b = 8, y = 3, a = 0.5) => { g.shadowColor = `rgba(0,0,0,${a})`; g.shadowBlur = b; g.shadowOffsetY = y; };
  const noShadow = (g) => { g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0; };

  // ---------- Señales ----------
  SL.led = (g, x, y, r, col, on = true) => {
    g.save();
    if (on) { const gr = g.createRadialGradient(x, y, 0, x, y, r * 3.2); gr.addColorStop(0, SL.alpha(col, 0.55)); gr.addColorStop(1, SL.alpha(col, 0)); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r * 3.2, 0, 7); g.fill(); }
    g.fillStyle = on ? col : '#26313d'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.arc(x - r * 0.35, y - r * 0.35, r * 0.35, 0, 7); g.fill();
    g.restore();
  };
  SL.tag = (g, text, cx, cy, col = ST.info, font = '600 11px system-ui') => {
    g.save(); g.font = font;
    const w = g.measureText(text).width + 14;
    SL.rr(g, cx - w / 2, cy - 9, w, 18, 9); g.fillStyle = 'rgba(8,12,18,.88)'; g.fill();
    g.strokeStyle = col; g.lineWidth = 1.2; g.stroke();
    g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, cx, cy + 0.5);
    g.restore();
  };
  // Barra de nivel con escala (frac 0..1)
  SL.gauge = (g, x, y, w, h, frac, col, label) => {
    g.save();
    SL.rr(g, x, y, w, h, h / 2); g.fillStyle = '#0a1016'; g.fill(); g.strokeStyle = '#2e3e52'; g.lineWidth = 1; g.stroke();
    const f = Math.max(0, Math.min(1, frac));
    if (f > 0) { SL.rr(g, x + 1, y + 1, Math.max(h - 2, (w - 2) * f), h - 2, (h - 2) / 2); g.fillStyle = SL.vgrad(g, y, h, SL.tint(col, 0.25), SL.tint(col, -0.2)); g.fill(); }
    g.strokeStyle = 'rgba(230,237,243,.18)';
    for (let i = 1; i < 10; i++) { const xx = x + (w * i) / 10; g.beginPath(); g.moveTo(xx, y + h - 3); g.lineTo(xx, y + h - 1); g.stroke(); }
    if (label) { g.fillStyle = '#e6edf3'; g.font = '600 10px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, x + w / 2, y + h / 2 + 0.5); }
    g.restore();
  };

  // ---------- Máquina / estación con panel de mando ----------
  SL.machine = (g, x, y, w, h, o = {}) => {
    const c = o.color || '#3d4d61', sc = ST[o.state] || o.stateColor || ST.idle;
    g.save();
    g.fillStyle = '#070b10'; g.fillRect(x + 6, y + h - 1, 9, 6); g.fillRect(x + w - 15, y + h - 1, 9, 6);
    shadow(g, 10, 4);
    SL.rr(g, x, y, w, h, 6); g.fillStyle = SL.vgrad(g, y, h, SL.tint(c, 0.2), SL.tint(c, -0.3)); g.fill();
    noShadow(g);
    g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 1; g.stroke();
    SL.rr(g, x + 3, y + 3, w - 6, 6, 3); g.fillStyle = sc; g.fill();                  // franja de estado
    g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(x + 4, y + 11, w - 8, 2);
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1.2;                              // rejilla de ventilación
    for (let i = 0; i < 4; i++) { const yy = y + h - 9 - i * 4; g.beginPath(); g.moveTo(x + 8, yy); g.lineTo(x + 8 + Math.min(28, w * 0.3), yy); g.stroke(); }
    const px = x + w - 25, py = y + 16;                                                 // panel de mando
    SL.rr(g, px, py, 19, 26, 2); g.fillStyle = '#0a1016'; g.fill();
    g.fillStyle = o.state === 'down' ? '#3a1515' : '#12344a'; g.fillRect(px + 3, py + 3, 13, 8);
    g.fillStyle = SL.alpha(sc, 0.9); g.fillRect(px + 4, py + 5, 7 * (o.load ?? 0.6), 1.5); g.fillRect(px + 4, py + 8, 10, 1);
    SL.led(g, px + 6, py + 17, 2.2, sc, o.state !== 'idle' && o.state !== 'off');
    SL.led(g, px + 13, py + 17, 2.2, ST.down, o.state === 'down');
    g.fillStyle = '#c0392b'; g.beginPath(); g.arc(px + 9.5, py + 23, 1.8, 0, 7); g.fill();  // paro de emergencia
    if (o.label) { g.fillStyle = '#e6edf3'; g.font = `600 ${o.fs || 13}px system-ui`; g.textAlign = 'center'; g.fillText(o.label, x + (w - 22) / 2 + 2, y + h / 2 + (o.sub ? 0 : 5)); }
    if (o.sub) { g.fillStyle = 'rgba(230,237,243,.72)'; g.font = '11px system-ui'; g.textAlign = 'center'; g.fillText(o.sub, x + (w - 22) / 2 + 2, y + h / 2 + 15); }
    g.restore();
    if (o.tag) SL.tag(g, o.tag, x + w / 2, y - 12, sc);
  };

  // ---------- Operario (vista lateral; x,y = pies) ----------
  SL.person = (g, x, y, o = {}) => {
    const s = o.s || 1, shirt = o.shirt || '#2f6fb0', dir = o.dir || 1, busy = o.busy || o.carry;
    g.save(); g.translate(x, y); g.scale(dir * s, s);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(0, 0, 8, 2.2, 0, 0, 7); g.fill();
    g.strokeStyle = '#22303f'; g.lineWidth = 3.4; g.lineCap = 'round';
    const st = o.walk ? Math.sin(o.walk) * 3 : 0;
    g.beginPath(); g.moveTo(-1.5, -14); g.lineTo(-2.5 - st, -1); g.moveTo(1.5, -14); g.lineTo(2.5 + st, -1); g.stroke();
    g.fillStyle = '#10161d'; g.fillRect(-4.5 - st, -2, 4, 2); g.fillRect(0.5 + st, -2, 4, 2);
    SL.rr(g, -5.5, -28, 11, 15, 3); g.fillStyle = SL.vgrad(g, -28, 15, SL.tint(shirt, 0.15), SL.tint(shirt, -0.25)); g.fill();
    g.fillStyle = '#d7dee6'; g.fillRect(-5.5, -22, 11, 1.8); g.fillRect(-5.5, -18.5, 11, 1.2); // cinta reflectiva
    g.strokeStyle = SL.tint(shirt, -0.1); g.lineWidth = 2.6;
    g.beginPath(); g.moveTo(3.5, -26); g.lineTo(busy ? 9 : 5, busy ? -20 : -15); g.stroke();
    g.fillStyle = '#d9a878'; g.beginPath(); g.arc(0, -32.5, 4.2, 0, 7); g.fill();
    g.fillStyle = o.helmet || '#f2f4f7'; g.beginPath(); g.arc(0, -33.5, 4.6, Math.PI, 0); g.fill(); g.fillRect(-5.5, -33.8, 11.5, 1.6);
    g.restore();
    if (o.carry) SL.carton(g, x + dir * 6 * s, y - 29 * s, 11 * s, 9 * s, o.carry);
  };

  // ---------- Carga ----------
  SL.carton = (g, x, y, w, h, col = '#b98a58') => {
    g.save();
    g.fillStyle = SL.vgrad(g, y, h, SL.tint(col, 0.18), SL.tint(col, -0.22)); g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(x + w * 0.44, y, Math.max(1, w * 0.12), h);          // cinta
    if (w > 9) { g.fillStyle = 'rgba(255,255,255,.75)'; g.fillRect(x + w * 0.62, y + h * 0.55, w * 0.28, h * 0.25); } // etiqueta
    g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 0.8; g.strokeRect(x + 0.4, y + 0.4, w - 0.8, h - 0.8);
    g.restore();
  };
  SL.pallet = (g, x, y, w) => { // x,y = esquina superior izquierda de la tarima; alto 7 px
    g.save(); g.fillStyle = '#9a6f43'; g.fillRect(x, y, w, 2.2); g.fillRect(x, y + 5.5, w, 1.8);
    g.fillStyle = '#7a5532'; for (const f of [0, 0.5, 1]) g.fillRect(x + f * (w - 5), y + 2.2, 5, 3.3);
    g.restore();
  };
  SL.crate = (g, x, y, w, h, col = '#2e8b57') => { // jaba plástica
    g.save(); SL.rr(g, x, y, w, h, 1.5); g.fillStyle = SL.vgrad(g, y, h, SL.tint(col, 0.2), SL.tint(col, -0.25)); g.fill();
    g.fillStyle = 'rgba(0,0,0,.35)'; const n = Math.max(2, Math.floor(w / 5));
    for (let i = 0; i < n; i++) g.fillRect(x + 2 + (i * (w - 4)) / n, y + h * 0.35, (w - 4) / n - 1.2, h * 0.3);
    g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x, y, w, 1.2);
    g.restore();
  };
  SL.bucket = (g, x, y, s = 1, col = '#d9dee4', label) => { // balde; x,y = base central
    g.save(); g.translate(x, y); g.scale(s, s);
    g.beginPath(); g.moveTo(-6, -15); g.lineTo(6, -15); g.lineTo(5, 0); g.lineTo(-5, 0); g.closePath();
    g.fillStyle = SL.hgrad(g, -6, 12, SL.tint(col, -0.25), SL.tint(col, 0.1)); g.fill();
    g.fillStyle = SL.tint(col, -0.35); g.fillRect(-6.5, -16, 13, 2);
    if (label) { g.fillStyle = label; g.fillRect(-4.5, -10, 9, 5); }
    g.strokeStyle = 'rgba(40,50,60,.8)'; g.lineWidth = 0.8; g.beginPath(); g.arc(0, -15, 6, Math.PI, 0); g.stroke();
    g.restore();
  };
  SL.mattress = (g, x, y, w, h, col = '#e4e0d4') => {
    g.save(); shadow(g, 6, 2, 0.4); SL.rr(g, x, y, w, h, h / 2.5); g.fillStyle = SL.vgrad(g, y, h, SL.tint(col, 0.1), SL.tint(col, -0.2)); g.fill(); noShadow(g);
    g.strokeStyle = 'rgba(90,90,110,.35)'; g.setLineDash([2, 3]); g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(x + 3, y + h / 2); g.lineTo(x + w - 3, y + h / 2); g.stroke();
    for (let xx = x + 8; xx < x + w - 4; xx += 9) { g.beginPath(); g.moveTo(xx, y + 2); g.lineTo(xx, y + h - 2); g.stroke(); }
    g.restore();
  };

  // ---------- Vehículos ----------
  SL.haulTruck = (g, x, y, o = {}) => { // camión minero; x,y = centro del eje trasero en el suelo
    const s = o.s || 1, dir = o.dir || 1, col = o.color || '#c9912a';
    g.save(); g.translate(x, y); g.scale(dir * s, s);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(4, 0, 22, 3, 0, 0, 7); g.fill();
    g.beginPath(); g.moveTo(-18, -9); g.lineTo(14, -9); g.lineTo(18, -20); g.lineTo(-20, -20); g.closePath(); // tolva
    g.fillStyle = SL.vgrad(g, -20, 11, SL.tint(col, 0.15), SL.tint(col, -0.3)); g.fill();
    if (o.loaded) { g.fillStyle = '#7a6049'; g.beginPath(); g.moveTo(-18, -20); g.quadraticCurveTo(0, -30, 17, -20); g.fill(); }
    g.fillStyle = SL.tint(col, -0.15); g.fillRect(12, -17, 11, 8);                   // cabina
    g.fillStyle = '#9fd3ff'; g.fillRect(17, -15.5, 5, 3.5);
    g.fillStyle = '#1b2026'; g.fillRect(-16, -9, 38, 3);
    for (const wx of [-10, 15]) { g.fillStyle = '#111418'; g.beginPath(); g.arc(wx, -4.5, 5.2, 0, 7); g.fill(); g.fillStyle = '#6b7684'; g.beginPath(); g.arc(wx, -4.5, 2, 0, 7); g.fill(); }
    g.restore();
    if (o.state) SL.led(g, x + dir * 6 * s, y - 24 * s, 2.2, ST[o.state]);
  };
  SL.van = (g, x, y, o = {}) => { // camión de reparto / refrigerado; x,y = rueda trasera en el suelo
    const s = o.s || 1, dir = o.dir || 1, body = o.body || '#dde5ee', cab = o.cab || '#2f6fb0';
    g.save(); g.translate(x, y); g.scale(dir * s, s);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(12, 0, 34, 3, 0, 0, 7); g.fill();
    g.fillStyle = SL.vgrad(g, -34, 26, SL.tint(body, 0.1), SL.tint(body, -0.2)); g.fillRect(-14, -34, 44, 26); // caja
    g.strokeStyle = 'rgba(0,0,0,.25)'; for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(-14 + i * 8.8, -34); g.lineTo(-14 + i * 8.8, -8); g.stroke(); }
    if (o.reefer) { g.fillStyle = '#5b6b80'; g.fillRect(24, -33, 6, 10); g.fillStyle = '#20282f'; g.fillRect(25, -31, 4, 6); }
    if (o.open) { g.fillStyle = '#0b1117'; g.fillRect(-15, -33, 3, 24); }
    g.fillStyle = SL.vgrad(g, -26, 18, SL.tint(cab, 0.2), SL.tint(cab, -0.25)); g.beginPath(); g.moveTo(31, -8); g.lineTo(31, -26); g.lineTo(40, -26); g.lineTo(45, -16); g.lineTo(45, -8); g.fill();
    g.fillStyle = '#9fd3ff'; g.beginPath(); g.moveTo(34, -24); g.lineTo(39.5, -24); g.lineTo(43, -17); g.lineTo(34, -17); g.fill();
    g.fillStyle = '#1b2026'; g.fillRect(-14, -8, 59, 3);
    for (const wx of [-4, 5, 38]) { g.fillStyle = '#111418'; g.beginPath(); g.arc(wx, -4, 4.2, 0, 7); g.fill(); g.fillStyle = '#7d8793'; g.beginPath(); g.arc(wx, -4, 1.6, 0, 7); g.fill(); }
    g.restore();
  };
  SL.forklift = (g, x, y, o = {}) => { // x,y = centro en el suelo
    const s = o.s || 1, dir = o.dir || 1;
    g.save(); g.translate(x, y); g.scale(dir * s, s);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(0, 0, 16, 2.5, 0, 0, 7); g.fill();
    g.fillStyle = '#d1a21c'; SL.rr(g, -12, -12, 20, 8, 2); g.fill();
    g.fillStyle = '#2a3038'; g.fillRect(-15, -13, 5, 9);
    g.strokeStyle = '#2a3038'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-9, -12); g.lineTo(-9, -26); g.lineTo(4, -26); g.lineTo(4, -12); g.stroke();
    g.fillStyle = '#d9a878'; g.beginPath(); g.arc(-3, -18, 2.5, 0, 7); g.fill();
    g.fillStyle = '#3a414a'; g.fillRect(8, -28, 2.5, 26);
    const lift = o.lift || 0; g.fillStyle = '#9aa6b3'; g.fillRect(10, -3 - lift, 13, 1.8);
    if (o.load) { SL.pallet(g, 10, -11 - lift, 13); SL.carton(g, 11, -21 - lift, 11, 10, o.load); }
    for (const wx of [-8, 5]) { g.fillStyle = '#111418'; g.beginPath(); g.arc(wx, -3.5, 3.5, 0, 7); g.fill(); }
    g.restore();
  };

  // ---------- Equipos de proceso ----------
  SL.tank = (g, x, y, w, h, frac, o = {}) => { // tanque vertical; frac = nivel 0..1
    g.save();
    const e = w * 0.12, liq = o.liquid || '#2d8fd5';
    shadow(g, 12, 5); g.fillStyle = SL.hgrad(g, x, w, '#3a4a5c', '#1d2631'); g.fillRect(x, y, w, h); noShadow(g);
    const ly = y + h - h * Math.max(0, Math.min(1, frac));
    g.fillStyle = SL.hgrad(g, x, w, SL.tint(liq, -0.25), SL.tint(liq, 0.15)); g.fillRect(x + 3, ly, w - 6, y + h - ly - 2);
    g.fillStyle = SL.alpha('#bfe6ff', 0.35); g.beginPath(); g.ellipse(x + w / 2, ly, (w - 6) / 2, e * 0.5, 0, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(x + w * 0.12, y + 6, w * 0.08, h - 12);    // brillo del vidrio
    g.strokeStyle = '#8fa3b8'; g.lineWidth = 2.5; g.strokeRect(x, y, w, h);
    g.fillStyle = '#556477'; g.beginPath(); g.ellipse(x + w / 2, y, w / 2, e, 0, Math.PI, 0); g.fill();
    g.strokeStyle = 'rgba(230,237,243,.4)'; g.lineWidth = 1; g.font = '10px system-ui'; g.fillStyle = 'rgba(230,237,243,.55)'; g.textAlign = 'right';
    const n = o.ticks || 8;
    for (let i = 0; i <= n; i++) { const yy = y + h - (h * i) / n; g.beginPath(); g.moveTo(x - 6, yy); g.lineTo(x, yy); g.stroke(); if (o.max) g.fillText(((o.max * i) / n).toFixed(1), x - 9, yy + 3); }
    g.fillStyle = '#2a3440'; g.fillRect(x + 6, y + h, 6, 10); g.fillRect(x + w - 12, y + h, 6, 10);
    g.restore();
  };
  SL.pump = (g, cx, cy, r, run, angle = 0) => {
    g.save();
    g.fillStyle = '#2a3440'; g.fillRect(cx - r - 4, cy + r - 2, 2 * r + 30, 6);                 // bancada
    shadow(g, 8, 3); g.fillStyle = SL.vgrad(g, cy - r, 2 * r, '#4f6379', '#26313d'); g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill(); noShadow(g);
    g.fillStyle = SL.vgrad(g, cy - r * 0.6, r * 1.2, '#5a6f86', '#2e3a48'); g.fillRect(cx + r - 2, cy - r * 0.6, 28, r * 1.2); // motor
    g.strokeStyle = 'rgba(0,0,0,.35)'; for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(cx + r + i * 4.5, cy - r * 0.6); g.lineTo(cx + r + i * 4.5, cy + r * 0.6); g.stroke(); }
    g.translate(cx, cy); g.rotate(angle);
    g.strokeStyle = run ? '#9fe3ff' : '#6b7d93'; g.lineWidth = 2.2;
    for (let i = 0; i < 6; i++) { g.rotate(Math.PI / 3); g.beginPath(); g.moveTo(r * 0.18, 0); g.quadraticCurveTo(r * 0.5, r * 0.25, r * 0.8, r * 0.1); g.stroke(); }
    g.fillStyle = '#10161d'; g.beginPath(); g.arc(0, 0, r * 0.2, 0, 7); g.fill();
    g.restore();
    SL.led(g, cx + r + 22, cy - r * 0.6 - 5, 2.4, ST.run, run);
  };
  SL.pipe = (g, pts, w = 8, col = '#6b7d93') => {
    const path = () => { g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); };
    g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
    path(); g.strokeStyle = '#0a0f14'; g.lineWidth = w + 3; g.stroke();
    path(); g.strokeStyle = col; g.lineWidth = w; g.stroke();
    path(); g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = Math.max(1, w * 0.25); g.stroke();
    g.restore();
  };
  // Flechas de flujo a lo largo de un tramo (n ∝ magnitud); estáticas, representan dirección y magnitud.
  SL.flow = (g, x1, y1, x2, y2, n, col) => {
    const L = Math.hypot(x2 - x1, y2 - y1), a = Math.atan2(y2 - y1, x2 - x1);
    g.save(); g.fillStyle = col;
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1), x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
      g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.moveTo(5, 0); g.lineTo(-3, -4); g.lineTo(-3, 4); g.fill(); g.restore();
    }
    g.restore(); return L;
  };
  SL.solar = (g, x, y, w, h, frac) => { // arreglo PV con celdas; frac = irradiancia 0..1
    g.save();
    const sx = x + w - 10, sy = y - 22;
    if (frac > 0.02) { const r = 8 + 6 * frac, gr = g.createRadialGradient(sx, sy, 0, sx, sy, r * 2.5); gr.addColorStop(0, `rgba(255,214,102,${0.9 * frac})`); gr.addColorStop(1, 'rgba(255,214,102,0)'); g.fillStyle = gr; g.beginPath(); g.arc(sx, sy, r * 2.5, 0, 7); g.fill(); g.fillStyle = '#ffd666'; g.beginPath(); g.arc(sx, sy, r * 0.7, 0, 7); g.fill(); }
    for (let k = 0; k < 3; k++) {
      const px = x + k * (w / 3), pw = w / 3 - 6, py = y + 6, ph = h - 14;
      g.save(); g.translate(px + pw / 2, py + ph); g.transform(1, 0, -0.35, 1, 0, 0); g.translate(-pw / 2, -ph);
      shadow(g, 6, 3); g.fillStyle = SL.vgrad(g, 0, ph, '#1f4f8f', '#0f2a4f'); g.fillRect(0, 0, pw, ph); noShadow(g);
      g.strokeStyle = `rgba(160,200,255,${0.25 + 0.4 * frac})`; g.lineWidth = 0.8;
      for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo((pw * i) / 4, 0); g.lineTo((pw * i) / 4, ph); g.stroke(); }
      for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(0, (ph * i) / 6); g.lineTo(pw, (ph * i) / 6); g.stroke(); }
      g.strokeStyle = '#c3ccd6'; g.lineWidth = 1.5; g.strokeRect(0, 0, pw, ph);
      g.fillStyle = `rgba(255,255,255,${0.08 + 0.15 * frac})`; g.beginPath(); g.moveTo(0, 0); g.lineTo(pw * 0.5, 0); g.lineTo(0, ph * 0.5); g.fill();
      g.restore();
      g.fillStyle = '#56616d'; g.fillRect(px + pw / 2 - 1.5, y + h - 8, 3, 8);
    }
    g.restore();
  };
  SL.battery = (g, x, y, w, h, soc, o = {}) => { // contenedor BESS con módulos
    g.save();
    shadow(g, 10, 4); SL.rr(g, x, y, w, h, 4); g.fillStyle = SL.vgrad(g, y, h, '#e3e8ee', '#a9b4c0'); g.fill(); noShadow(g);
    const cols = 6, rows = 3, mw = (w - 16) / cols, mh = (h - 26) / rows, on = Math.round(soc * cols * rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = (rows - 1 - r) * cols + c, mx = x + 8 + c * mw, my = y + 8 + r * mh;
      g.fillStyle = '#26313d'; g.fillRect(mx, my, mw - 3, mh - 3);
      g.fillStyle = i < on ? SL.color(soc) : '#3a4654'; g.fillRect(mx + 2, my + mh - 7, mw - 7, 2.5);
    }
    SL.gauge(g, x + 8, y + h - 16, w - 16, 10, soc, SL.color(soc), `${Math.round(soc * 100)} % SOC`);
    if (o.flow) SL.led(g, x + w - 8, y - 6, 2.4, o.flow > 0 ? ST.run : ST.info, Math.abs(o.flow) > 1);
    g.restore();
  };
  SL.genset = (g, x, y, w, h, on, t = 0) => { // grupo electrógeno en contenedor
    g.save();
    if (on) for (let i = 0; i < 4; i++) { const k = ((t * 0.6 + i / 4) % 1); g.fillStyle = `rgba(150,160,170,${0.35 * (1 - k)})`; g.beginPath(); g.arc(x + w - 16 + k * 10, y - 16 - k * 34, 5 + k * 10, 0, 7); g.fill(); }
    g.fillStyle = '#3a414a'; g.fillRect(x + w - 20, y - 16, 7, 16);
    shadow(g, 10, 4); SL.rr(g, x, y, w, h, 3); g.fillStyle = SL.vgrad(g, y, h, '#5f6e7e', '#2f3945'); g.fill(); noShadow(g);
    g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 1;
    for (let i = 0; i < 9; i++) { const xx = x + 6 + i * 4; g.beginPath(); g.moveTo(xx, y + 8); g.lineTo(xx, y + h - 8); g.stroke(); }
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(x + w * 0.45 + i * ((w * 0.5) / 4), y + 4); g.lineTo(x + w * 0.45 + i * ((w * 0.5) / 4), y + h - 4); g.stroke(); }
    SL.led(g, x + w - 10, y + 10, 2.4, ST.run, on);
    g.restore();
  };
  SL.building = (g, x, y, w, h, o = {}) => { // nave industrial con techo en diente de sierra
    g.save();
    shadow(g, 12, 5); g.fillStyle = SL.vgrad(g, y, h, '#4a5a6c', '#2a3440'); g.fillRect(x, y, w, h); noShadow(g);
    const teeth = Math.max(2, Math.round(w / 32)), tw = w / teeth;
    g.fillStyle = '#5b6b80'; for (let i = 0; i < teeth; i++) { g.beginPath(); g.moveTo(x + i * tw, y); g.lineTo(x + i * tw, y - 14); g.lineTo(x + (i + 1) * tw, y); g.fill(); g.fillStyle = 'rgba(159,211,255,.45)'; g.fillRect(x + i * tw + 1, y - 13, 3, 12); g.fillStyle = '#5b6b80'; }
    const lit = o.load ?? 0.6;
    for (let r = 0; r < 2; r++) for (let c = 0; c < Math.floor(w / 18); c++) { g.fillStyle = (c + r) % 3 < lit * 3 ? 'rgba(255,214,102,.8)' : 'rgba(20,28,36,.9)'; g.fillRect(x + 8 + c * 18, y + 10 + r * 16, 10, 8); }
    g.fillStyle = '#1a222b'; g.fillRect(x + w / 2 - 10, y + h - 22, 20, 22);
    g.restore();
  };
  SL.excavator = (g, x, y, o = {}) => { // pala hidráulica; x,y = centro de orugas en el suelo
    const s = o.s || 1, t = o.t || 0, dig = o.busy ? Math.sin(t * 2) : 0.4;
    g.save(); g.translate(x, y); g.scale(s, s);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(0, 0, 34, 4, 0, 0, 7); g.fill();
    SL.rr(g, -30, -10, 60, 10, 5); g.fillStyle = '#1b2026'; g.fill();
    g.fillStyle = '#4a525c'; for (let i = -24; i <= 24; i += 8) { g.beginPath(); g.arc(i, -5, 2.6, 0, 7); g.fill(); }
    SL.rr(g, -24, -30, 42, 20, 3); g.fillStyle = SL.vgrad(g, -30, 20, '#e0b23a', '#9c7416'); g.fill();
    g.fillStyle = '#2a3038'; g.fillRect(-22, -42, 16, 12); g.fillStyle = '#9fd3ff'; g.fillRect(-19, -40, 10, 6);
    const a1 = -0.9 + 0.25 * dig, a2 = 1.2 + 0.45 * dig;
    g.translate(14, -26); g.rotate(a1); g.fillStyle = '#c9912a'; g.fillRect(0, -3.5, 42, 7);
    g.translate(42, 0); g.rotate(a2); g.fillRect(0, -3, 30, 6);
    g.translate(30, 0); g.rotate(0.6 * dig); g.fillStyle = '#6d747c'; g.beginPath(); g.moveTo(0, -6); g.lineTo(12, -8); g.lineTo(10, 8); g.lineTo(0, 6); g.fill();
    g.restore();
  };
  SL.crusher = (g, x, y, o = {}) => { // chancador con tolva; x,y = base central
    const s = o.s || 1;
    g.save(); g.translate(x, y); g.scale(s, s);
    shadow(g, 10, 4);
    g.fillStyle = SL.vgrad(g, -70, 26, '#6d7c8c', '#3a4654'); g.beginPath(); g.moveTo(-34, -70); g.lineTo(34, -70); g.lineTo(18, -44); g.lineTo(-18, -44); g.closePath(); g.fill();
    g.fillStyle = SL.vgrad(g, -44, 44, '#556477', '#2a3440'); g.fillRect(-24, -44, 48, 44);
    noShadow(g);
    if (o.load) { g.fillStyle = '#7a6049'; g.beginPath(); g.moveTo(-28, -66); g.quadraticCurveTo(0, -80 * Math.min(1, o.load), 28, -66); g.fill(); }
    g.strokeStyle = '#1b2026'; g.lineWidth = 3; g.beginPath(); g.moveTo(-10, -40); g.lineTo(-4, -8); g.moveTo(10, -40); g.lineTo(4, -8); g.stroke();
    g.fillStyle = '#2a3038'; g.fillRect(-30, -4, 60, 4);
    g.restore();
    if (o.state) SL.led(g, x + 20 * s, y - 60 * s, 2.6, ST[o.state]);
  };
  SL.shelf = (g, x, y, w, h, levels = 3, fill = 0.7, seed = 1) => { // estantería con cajas
    g.save();
    g.strokeStyle = '#4b5d73'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + h); g.moveTo(x + w, y); g.lineTo(x + w, y + h); g.stroke();
    for (let l = 0; l < levels; l++) {
      const ly = y + ((l + 1) * h) / levels; g.fillStyle = '#2f5277'; g.fillRect(x, ly - 3, w, 3);
      let bx = x + 3;
      for (let k = 0; bx < x + w - 10; k++) { const bw = 8 + ((seed * 7 + k * 13 + l * 5) % 7), on = ((seed * 3 + k * 11 + l * 7) % 10) / 10 < fill; if (on) SL.carton(g, bx, ly - 3 - (h / levels) * 0.6, bw, (h / levels) * 0.6, ['#b98a58', '#a57a4c', '#c9a06a'][k % 3]); bx += bw + 2; }
    }
    g.restore();
  };
  SL.table = (g, x, y, w, h = 6) => { // mesa de trabajo; x,y = superficie
    g.save(); g.fillStyle = '#5b6b80'; g.fillRect(x, y, w, h); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x, y, w, 1.5);
    g.fillStyle = '#2a3440'; g.fillRect(x + 3, y + h, 3, 18); g.fillRect(x + w - 6, y + h, 3, 18); g.restore();
  };
  SL.chute = (g, x, y, w, h, frac, col, label) => { // chute / tolva de destino con nivel
    g.save();
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w - 8, y + h); g.lineTo(x + 8, y + h); g.closePath();
    g.fillStyle = SL.vgrad(g, y, h, '#3a4a5e', '#1c2633'); g.fill(); g.strokeStyle = '#6b7d93'; g.lineWidth = 1.5; g.stroke();
    const f = Math.max(0, Math.min(1, frac)); if (f > 0) { g.fillStyle = SL.alpha(col, 0.55); g.fillRect(x + 9, y + h - (h - 6) * f - 2, w - 18, (h - 6) * f); }
    if (label) { g.fillStyle = '#e6edf3'; g.font = '600 11px system-ui'; g.textAlign = 'center'; g.fillText(label, x + w / 2, y + 13); }
    g.restore();
  };
  SL.store = (g, x, y, w, h, label) => { // tienda / punto de entrega
    g.save(); shadow(g, 8, 3); g.fillStyle = SL.vgrad(g, y, h, '#e3e8ee', '#aeb8c2'); g.fillRect(x, y, w, h); noShadow(g);
    const aw = 6; for (let i = 0; i < w / aw; i++) { g.fillStyle = i % 2 ? '#e6edf3' : '#2f6fb0'; g.fillRect(x + i * aw, y - 6, aw, 6); }
    g.fillStyle = '#9fd3ff'; g.fillRect(x + 4, y + 6, w - 8, h * 0.35); g.fillStyle = '#26313d'; g.fillRect(x + w / 2 - 4, y + h - 12, 8, 12);
    if (label) { g.fillStyle = '#0b1117'; g.font = '600 10px system-ui'; g.textAlign = 'center'; g.fillText(label, x + w / 2, y + h - 16); }
    g.restore();
  };
  SL.road = (g, pts, w = 26) => { // camino de acarreo con bermas y eje
    const path = () => { g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); };
    g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
    path(); g.strokeStyle = '#4a3d31'; g.lineWidth = w + 8; g.stroke();
    path(); g.strokeStyle = '#6e5d4b'; g.lineWidth = w; g.stroke();
    path(); g.setLineDash([10, 10]); g.strokeStyle = 'rgba(230,220,200,.35)'; g.lineWidth = 1.5; g.stroke();
    g.restore();
  };
})();
