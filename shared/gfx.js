/* Synth-Labs · kit de dibujo industrial 2D (canvas) · LOD alto. Extiende window.SL (cargar después de sim.js).
 * Todas las funciones dibujan en unidades lógicas del lienzo (800 × 450). Vista lateral con volumen (cara frontal,
 * canto superior iluminado, sombra de contacto). SL.time (lo fija el motor) anima aspas, bandas y balizas.
 * Estados: run (verde) · idle (gris) · block/warn (amarillo) · down (rojo) · setup (violeta) · info (azul). */
(function () {
  const SL = window.SL;
  const ST = { run: '#3ecf8e', idle: '#8b9bb0', block: '#f5b942', warn: '#f5b942', down: '#ef5350', setup: '#b39ddb', info: '#4fc3f7', off: '#4a5a6e' };
  SL.STATE = ST;
  const T = () => SL.time || 0;
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
  // Metal cepillado: gradiente vertical de 4 paradas con reflejo.
  const metal = (g, y, h, c) => { const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, SL.tint(c, 0.35)); gr.addColorStop(0.12, SL.tint(c, 0.12)); gr.addColorStop(0.55, c); gr.addColorStop(1, SL.tint(c, -0.4)); return gr; };
  SL.metal = metal;
  const shadow = (g, b = 8, y = 3, a = 0.5) => { g.shadowColor = `rgba(0,0,0,${a})`; g.shadowBlur = b; g.shadowOffsetY = y; };
  const noShadow = (g) => { g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0; };
  // Sombra de contacto elíptica (oclusión ambiental bajo objetos apoyados).
  SL.contact = (g, cx, cy, rx, ry = 3, a = 0.45) => {
    g.save(); const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rx); gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.translate(cx, cy); g.scale(1, ry / rx); g.translate(-cx, -cy); g.beginPath(); g.arc(cx, cy, rx, 0, 7); g.fill(); g.restore();
  };
  SL.bolt = (g, x, y, r = 1.2) => { g.fillStyle = 'rgba(0,0,0,.5)'; g.beginPath(); g.arc(x + 0.4, y + 0.5, r, 0, 7); g.fill(); g.fillStyle = 'rgba(220,230,240,.55)'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
  const hazard = (g, x, y, w, h, a = 1) => { // franja amarilla/negra diagonal
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.fillStyle = `rgba(245,185,66,${a})`; g.fillRect(x, y, w, h);
    g.fillStyle = `rgba(15,18,22,${a})`; for (let k = -h; k < w + h; k += 8) { g.beginPath(); g.moveTo(x + k, y + h); g.lineTo(x + k + 4, y + h); g.lineTo(x + k + 4 + h, y); g.lineTo(x + k + h, y); g.fill(); }
    g.restore();
  };
  SL.hazard = hazard;

  // ---------- Entorno ----------
  // Charco de luz cenital (luminaria) sobre el piso.
  SL.lightPool = (g, x, y, r = 90, a = 0.08, col = '255,236,200') => {
    g.save(); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); g.restore();
  };
  // Zona demarcada en el piso (pasillo, área de trabajo, acopio) con borde y rótulo.
  SL.zone = (g, x, y, w, h, o = {}) => {
    const col = o.color || '#f5b942';
    g.save();
    g.fillStyle = SL.alpha(col, o.fill ?? 0.05); g.fillRect(x, y, w, h);
    if (o.hatch) { g.beginPath(); g.rect(x, y, w, h); g.clip(); g.strokeStyle = SL.alpha(col, 0.14); g.lineWidth = 1; for (let k = -h; k < w; k += 10) { g.moveTo(x + k, y + h); g.lineTo(x + k + h, y); } g.stroke(); g.restore(); g.save(); }
    g.strokeStyle = SL.alpha(col, 0.55); g.lineWidth = 2; g.setLineDash(o.dash || [10, 6]); g.strokeRect(x + 1, y + 1, w - 2, h - 2); g.setLineDash([]);
    if (o.label) { g.font = '600 9.5px system-ui'; g.fillStyle = SL.alpha(col, 0.8); g.fillText(o.label.toUpperCase(), x + 6, y + 12); }
    g.restore();
  };
  // Bandeja portacables aérea con cables.
  SL.cableTray = (g, x1, y, x2, o = {}) => {
    g.save(); g.fillStyle = '#2b3746'; g.fillRect(x1, y, x2 - x1, 4); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x1, y, x2 - x1, 1);
    const cols = o.cables || ['#1d2733', '#3a2a1a', '#203a2a'];
    cols.forEach((c, i) => { g.strokeStyle = c; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x1, y - 1 - i * 1.6); g.lineTo(x2, y - 1 - i * 1.6); g.stroke(); });
    g.strokeStyle = '#3a4a5c'; g.lineWidth = 1; for (let x = x1 + 30; x < x2; x += 80) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - (o.drop || 14)); g.stroke(); }
    g.restore();
  };
  // Baliza de torre (andon) con 3 pisos; el activo parpadea si blink.
  SL.stackLight = (g, x, y, state = 'run', o = {}) => {
    const s = o.s || 1, on = { down: 0, block: 1, warn: 1, run: 2, setup: 1, idle: -1, off: -1 }[state] ?? -1, cols = ['#ef5350', '#f5b942', '#3ecf8e'];
    const blink = state === 'down' ? Math.floor(T() * 4) % 2 === 0 : true;
    g.save(); g.translate(x, y); g.scale(s, s);
    g.fillStyle = '#5b6b80'; g.fillRect(-1, -4, 2, 8); g.fillStyle = '#20282f'; g.fillRect(-4, 2, 8, 3);
    cols.forEach((c, i) => {
      const yy = -6 - (2 - i) * 6, lit = i === on && blink;
      if (lit) { const gr = g.createRadialGradient(0, yy - 2.5, 0, 0, yy - 2.5, 12); gr.addColorStop(0, SL.alpha(c, 0.55)); gr.addColorStop(1, SL.alpha(c, 0)); g.fillStyle = gr; g.fillRect(-12, yy - 14, 24, 24); }
      SL.rr(g, -3.2, yy - 5.5, 6.4, 5.6, 1.2); g.fillStyle = lit ? c : SL.tint(c, -0.7); g.fill();
      g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(-2.2, yy - 5, 1.2, 4.6);
    });
    g.fillStyle = '#2a3440'; SL.rr(g, -3.6, -30, 7.2, 3, 1.5); g.fill();
    g.restore();
  };
  // Instrumento redondo de aguja (manómetro, tacómetro); frac 0..1.
  SL.dial = (g, x, y, r, frac, o = {}) => {
    g.save(); shadow(g, 5, 2, 0.5); g.fillStyle = '#c3ccd6'; g.beginPath(); g.arc(x, y, r + 1.6, 0, 7); g.fill(); noShadow(g);
    g.fillStyle = '#f1f4f7'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    if (o.red != null) { g.strokeStyle = '#e04a3f'; g.lineWidth = r * 0.18; g.beginPath(); g.arc(x, y, r * 0.78, a0 + (a1 - a0) * o.red, a1); g.stroke(); }
    g.strokeStyle = '#26313d'; g.lineWidth = 0.7;
    for (let i = 0; i <= 10; i++) { const a = a0 + ((a1 - a0) * i) / 10, l = i % 5 ? 0.82 : 0.7; g.beginPath(); g.moveTo(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92); g.lineTo(x + Math.cos(a) * r * l, y + Math.sin(a) * r * l); g.stroke(); }
    const a = a0 + (a1 - a0) * Math.max(0, Math.min(1, frac));
    g.strokeStyle = '#d03b3b'; g.lineWidth = 1.3; g.beginPath(); g.moveTo(x - Math.cos(a) * r * 0.15, y - Math.sin(a) * r * 0.15); g.lineTo(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8); g.stroke();
    g.fillStyle = '#26313d'; g.beginPath(); g.arc(x, y, r * 0.12, 0, 7); g.fill();
    if (o.label) { g.font = `600 ${Math.max(6, r * 0.4)}px system-ui`; g.textAlign = 'center'; g.fillStyle = '#26313d'; g.fillText(o.label, x, y + r * 0.55); }
    g.restore();
  };
  // Ventilador / aspa giratoria (vista frontal).
  SL.fan = (g, x, y, r, run = true, speed = 1) => {
    g.save(); g.fillStyle = '#10161d'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.translate(x, y); g.rotate(run ? T() * 8 * speed : 0.3); g.fillStyle = run ? '#7d8fa3' : '#56657a';
    for (let i = 0; i < 5; i++) { g.rotate((Math.PI * 2) / 5); g.beginPath(); g.ellipse(r * 0.45, 0, r * 0.45, r * 0.16, 0.35, 0, 7); g.fill(); }
    g.fillStyle = '#2a3440'; g.beginPath(); g.arc(0, 0, r * 0.18, 0, 7); g.fill();
    g.rotate(-(run ? T() * 8 * speed : 0.3)); g.strokeStyle = 'rgba(195,204,214,.45)'; g.lineWidth = 0.7;
    for (const k of [0.45, 0.75, 1]) { g.beginPath(); g.arc(0, 0, r * k, 0, 7); g.stroke(); }
    g.beginPath(); g.moveTo(-r, 0); g.lineTo(r, 0); g.moveTo(0, -r); g.lineTo(0, r); g.stroke();
    g.restore();
  };
  // Válvula de compuerta / mariposa en línea con volante; open 0..1.
  SL.valve = (g, x, y, s = 1, open = 1, col = '#c3ccd6') => {
    g.save(); g.translate(x, y); g.scale(s, s);
    g.fillStyle = '#5b6b80'; g.fillRect(-12, -7, 3, 14); g.fillRect(9, -7, 3, 14);
    g.fillStyle = metal(g, -8, 16, col); g.beginPath(); g.moveTo(-9, -8); g.lineTo(9, 8); g.lineTo(9, -8); g.lineTo(-9, 8); g.closePath(); g.fill();
    g.fillStyle = '#5b6b80'; g.fillRect(-1.5, -20, 3, 12);
    g.strokeStyle = open > 0.5 ? '#3ecf8e' : '#ef5350'; g.lineWidth = 2.4; g.beginPath(); g.ellipse(0, -21, 9, 2.6, 0, 0, 7); g.stroke();
    g.restore();
  };
  // Cono de seguridad y bolardo.
  SL.cone = (g, x, y, s = 1) => { g.save(); g.translate(x, y); g.scale(s, s); SL.contact(g, 0, 0, 7, 2); g.fillStyle = '#e8672b'; g.beginPath(); g.moveTo(-5, 0); g.lineTo(-1.5, -14); g.lineTo(1.5, -14); g.lineTo(5, 0); g.fill(); g.fillStyle = '#f1f4f7'; g.fillRect(-3.2, -8, 6.4, 2.2); g.fillStyle = '#20282f'; g.fillRect(-6.5, -1.5, 13, 2); g.restore(); };
  SL.bollard = (g, x, y, h = 22) => { SL.contact(g, x, y, 7, 2); g.save(); g.fillStyle = SL.hgrad(g, x - 4, 8, '#f5c542', '#a97f12'); g.fillRect(x - 4, y - h, 8, h); g.fillStyle = '#15191e'; for (let k = 4; k < h; k += 8) g.fillRect(x - 4, y - h + k, 8, 3); g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(x - 3, y - h, 1.5, h); g.restore(); };
  // Cartel/rótulo industrial.
  SL.sign = (g, x, y, text, o = {}) => {
    g.save(); g.font = o.font || '700 9px system-ui'; const w = g.measureText(text).width + 12, h = 15, col = o.color || '#2f6fb0';
    shadow(g, 4, 2, 0.4); SL.rr(g, x - w / 2, y - h / 2, w, h, 2); g.fillStyle = col; g.fill(); noShadow(g);
    g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1; SL.rr(g, x - w / 2 + 2, y - h / 2 + 2, w - 4, h - 4, 1.5); g.stroke();
    g.fillStyle = o.ink || '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y + 0.5); g.restore();
  };

  // ---------- Señales ----------
  SL.led = (g, x, y, r, col, on = true) => {
    g.save();
    if (on) { const gr = g.createRadialGradient(x, y, 0, x, y, r * 3.6); gr.addColorStop(0, SL.alpha(col, 0.6)); gr.addColorStop(1, SL.alpha(col, 0)); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r * 3.6, 0, 7); g.fill(); }
    g.fillStyle = '#0a0f14'; g.beginPath(); g.arc(x, y, r + 0.9, 0, 7); g.fill();               // bisel
    const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    gr.addColorStop(0, on ? SL.tint(col, 0.55) : '#3a4654'); gr.addColorStop(1, on ? col : '#1d2630');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.arc(x - r * 0.35, y - r * 0.38, r * 0.3, 0, 7); g.fill();
    g.restore();
  };
  SL.tag = (g, text, cx, cy, col = ST.info, font = '600 11px system-ui') => {
    g.save(); g.font = font;
    const w = g.measureText(text).width + 16;
    shadow(g, 6, 2, 0.55);
    SL.rr(g, cx - w / 2, cy - 9, w, 18, 9); g.fillStyle = 'rgba(8,12,18,.92)'; g.fill();
    noShadow(g);
    g.strokeStyle = col; g.lineWidth = 1.2; g.stroke();
    g.fillStyle = col; g.beginPath(); g.arc(cx - w / 2 + 7, cy, 2, 0, 7); g.fill();                // punto de color
    g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, cx + 2, cy + 0.5);
    g.restore();
  };
  // Barra de nivel con escala (frac 0..1)
  SL.gauge = (g, x, y, w, h, frac, col, label) => {
    g.save();
    SL.rr(g, x - 1, y - 1, w + 2, h + 2, (h + 2) / 2); g.fillStyle = '#05080c'; g.fill();
    SL.rr(g, x, y, w, h, h / 2); g.fillStyle = SL.vgrad(g, y, h, '#060a0f', '#111a24'); g.fill(); g.strokeStyle = '#2e3e52'; g.lineWidth = 1; g.stroke();
    const f = Math.max(0, Math.min(1, frac));
    if (f > 0) {
      SL.rr(g, x + 1, y + 1, Math.max(h - 2, (w - 2) * f), h - 2, (h - 2) / 2); g.fillStyle = SL.vgrad(g, y, h, SL.tint(col, 0.35), SL.tint(col, -0.25)); g.fill();
      g.fillStyle = 'rgba(255,255,255,.28)'; g.fillRect(x + 3, y + 1.5, Math.max(0, (w - 2) * f - 4), Math.max(1, h * 0.22));
    }
    g.strokeStyle = 'rgba(230,237,243,.2)';
    for (let i = 1; i < 10; i++) { const xx = x + (w * i) / 10; g.beginPath(); g.moveTo(xx, y + h - (i === 5 ? 4 : 3)); g.lineTo(xx, y + h - 1); g.stroke(); }
    if (label) { g.fillStyle = '#e6edf3'; g.font = '600 10px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = 3; g.fillText(label, x + w / 2, y + h / 2 + 0.5); }
    g.restore();
  };

  // ---------- Máquina / estación con gabinete, puerta, HMI y baliza ----------
  SL.machine = (g, x, y, w, h, o = {}) => {
    const c = o.color || '#3d4d61', sc = ST[o.state] || o.stateColor || ST.idle;
    g.save();
    SL.contact(g, x + w / 2, y + h + 4, w * 0.62, 4, 0.55);
    g.fillStyle = '#070b10'; g.fillRect(x + 5, y + h - 1, 10, 6); g.fillRect(x + w - 15, y + h - 1, 10, 6);  // patas niveladoras
    g.fillStyle = '#56657a'; g.fillRect(x + 3, y + h + 4, 14, 1.6); g.fillRect(x + w - 17, y + h + 4, 14, 1.6);
    shadow(g, 12, 5, 0.55);
    SL.rr(g, x, y, w, h, 6); g.fillStyle = metal(g, y, h, c); g.fill();
    noShadow(g);
    g.strokeStyle = 'rgba(255,255,255,.16)'; g.lineWidth = 1; g.stroke();
    g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(x + 6, y + 1, w - 12, 1);                         // canto iluminado
    SL.rr(g, x + 3, y + 3, w - 6, 6, 3); g.fillStyle = SL.vgrad(g, y + 3, 6, SL.tint(sc, 0.3), SL.tint(sc, -0.2)); g.fill(); // franja de estado
    if (w > 40 && h > 34) { // puerta de gabinete con junta, bisagras y manija
      const dx = x + 6, dy = y + 13, dw = w - 36, dh = h - 20;
      g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1; SL.rr(g, dx, dy, dw, dh, 3); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.08)'; SL.rr(g, dx + 1, dy + 1, dw - 2, dh - 2, 2.5); g.stroke();
      g.fillStyle = '#1a222b'; g.fillRect(dx - 1.5, dy + 4, 2.5, 5); g.fillRect(dx - 1.5, dy + dh - 9, 2.5, 5);
      g.fillStyle = metal(g, dy + dh / 2 - 6, 12, '#9aa6b3'); SL.rr(g, dx + dw - 6, dy + dh / 2 - 6, 3, 12, 1.5); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1.1;                                              // rejilla de ventilación
      for (let i = 0; i < 4; i++) { const yy = dy + dh - 6 - i * 3.5; g.beginPath(); g.moveTo(dx + 5, yy); g.lineTo(dx + 5 + Math.min(26, dw * 0.45), yy); g.stroke(); }
      if (dw > 30) { g.fillStyle = 'rgba(230,237,243,.82)'; g.fillRect(dx + 4, dy + 4, Math.min(20, dw * 0.35), 6); g.fillStyle = '#26313d'; g.fillRect(dx + 6, dy + 6, Math.min(14, dw * 0.25), 1); g.fillRect(dx + 6, dy + 8, Math.min(10, dw * 0.18), 0.8); } // placa
      hazard(g, x + 3, y + h - 5, Math.min(18, w * 0.25), 3, 0.85);
    }
    for (const [bx, by] of [[x + 4, y + 12], [x + w - 4, y + 12], [x + 4, y + h - 4], [x + w - 4, y + h - 4]]) SL.bolt(g, bx, by, 1);
    const px = x + w - 25, py = y + 14;                                                              // panel HMI
    SL.rr(g, px - 1, py - 1, 21, 30, 2.5); g.fillStyle = '#05080c'; g.fill();
    SL.rr(g, px, py, 19, 28, 2); g.fillStyle = SL.vgrad(g, py, 28, '#1a222b', '#0a1016'); g.fill();
    const scr = g.createLinearGradient(0, py + 3, 0, py + 12); scr.addColorStop(0, o.state === 'down' ? '#5a1d1d' : '#1d5778'); scr.addColorStop(1, o.state === 'down' ? '#2a0d0d' : '#0c2c40');
    g.fillStyle = scr; g.fillRect(px + 2.5, py + 2.5, 14, 9);
    g.fillStyle = SL.alpha(sc, 0.95); g.fillRect(px + 4, py + 4.5, 10 * (o.load ?? 0.6), 1.6);
    g.fillStyle = 'rgba(159,227,255,.6)'; for (let k = 0; k < 4; k++) g.fillRect(px + 4 + k * 3, py + 10 - ((k * 37 + Math.floor(T())) % 4), 2, 1 + ((k * 37 + Math.floor(T())) % 4));
    SL.led(g, px + 6, py + 17, 2, sc, o.state !== 'idle' && o.state !== 'off');
    SL.led(g, px + 13, py + 17, 2, ST.down, o.state === 'down');
    g.fillStyle = '#f5c542'; g.beginPath(); g.arc(px + 9.5, py + 24, 3, 0, 7); g.fill();               // paro de emergencia
    g.fillStyle = '#c0392b'; g.beginPath(); g.arc(px + 9.5, py + 24, 2, 0, 7); g.fill();
    if (h > 40 && !o.noBeacon) SL.stackLight(g, x + w - 6, y - 1, o.state || 'idle', { s: 0.75 });
    if (o.label) { g.fillStyle = '#e6edf3'; g.font = `600 ${o.fs || 13}px system-ui`; g.textAlign = 'center'; g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 3; g.fillText(o.label, x + (w - 22) / 2 + 2, y + h / 2 + (o.sub ? 0 : 5)); g.shadowBlur = 0; }
    if (o.sub) { g.fillStyle = 'rgba(230,237,243,.75)'; g.font = '11px system-ui'; g.textAlign = 'center'; g.fillText(o.sub, x + (w - 22) / 2 + 2, y + h / 2 + 15); }
    g.restore();
    if (o.tag) SL.tag(g, o.tag, x + w / 2, y - 14, sc);
  };

  // ---------- Operario (vista lateral; x,y = pies) con EPP: casco, chaleco, guantes, botas ----------
  SL.person = (g, x, y, o = {}) => {
    const s = o.s || 1, shirt = o.shirt || '#2f6fb0', dir = o.dir || 1, busy = o.busy || o.carry;
    const ph = o.walk ?? (busy && !o.carry ? T() * 6 : 0), st = o.walk ? Math.sin(o.walk) * 3 : 0, sw = o.walk ? Math.sin(o.walk) * 3.5 : busy ? Math.sin(ph) * 2.5 : 0;
    g.save(); g.translate(x, y); g.scale(dir * s, s);
    SL.contact(g, 0, 0, 9, 2.4, 0.5);
    g.lineCap = 'round';
    // brazo trasero
    g.strokeStyle = SL.tint(shirt, -0.35); g.lineWidth = 2.6; g.beginPath(); g.moveTo(-1.5, -25); g.lineTo(-3 - sw * 0.6, -17); g.lineTo(-2.5 - sw * 0.6, -13.5); g.stroke();
    // piernas con pantalón, rodilla y botas
    g.strokeStyle = '#1f2b38'; g.lineWidth = 3.6;
    g.beginPath(); g.moveTo(-1.5, -14); g.lineTo(-2 - st * 0.6, -7); g.lineTo(-2.5 - st, -1.5); g.moveTo(1.5, -14); g.lineTo(2 + st * 0.6, -7); g.lineTo(2.5 + st, -1.5); g.stroke();
    g.strokeStyle = 'rgba(215,222,230,.6)'; g.lineWidth = 3.6; g.beginPath(); g.moveTo(-2.3 - st * 0.8, -5); g.lineTo(-2.4 - st * 0.85, -4.2); g.moveTo(2.3 + st * 0.8, -5); g.lineTo(2.4 + st * 0.85, -4.2); g.stroke(); // reflectivo pantalón
    g.fillStyle = '#0b0f14'; SL.rr(g, -5 - st, -2.6, 5.2, 2.6, 1); g.fill(); SL.rr(g, 0 + st, -2.6, 5.2, 2.6, 1); g.fill();
    g.fillStyle = '#5a3a1e'; g.fillRect(-4.6 - st, -0.8, 4.5, 0.8); g.fillRect(0.4 + st, -0.8, 4.5, 0.8);
    // torso: camisa + chaleco de alta visibilidad
    SL.rr(g, -5.5, -28, 11, 15, 3); g.fillStyle = SL.vgrad(g, -28, 15, SL.tint(shirt, 0.15), SL.tint(shirt, -0.3)); g.fill();
    const vest = o.vest || '#c8e04a';
    g.fillStyle = SL.alpha(vest, 0.92); g.beginPath(); g.moveTo(-5.5, -26); g.lineTo(-2, -27.5); g.lineTo(-1.5, -14); g.lineTo(-5.5, -14); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(5.5, -26); g.lineTo(2, -27.5); g.lineTo(1.5, -14); g.lineTo(5.5, -14); g.closePath(); g.fill();
    g.fillStyle = '#e8edf2'; g.fillRect(-5.5, -21.5, 11, 1.4); g.fillRect(-5.5, -18, 11, 1.1);           // cintas reflectivas
    g.fillStyle = '#3a2a1a'; g.fillRect(-5.5, -14.8, 11, 1.4);                                          // cinturón
    g.fillStyle = '#9aa6b3'; g.fillRect(-0.8, -14.8, 1.6, 1.4);
    if (o.radio !== false) { g.fillStyle = '#15191e'; g.fillRect(-6.2, -17, 1.6, 3.5); }
    // brazo delantero con guante
    const fx = busy ? 9 + sw * 0.5 : 4.5 + sw * 0.6, fy = busy ? -20 + Math.abs(sw) * 0.4 : -14.5;
    g.strokeStyle = SL.tint(shirt, -0.05); g.lineWidth = 2.8; g.beginPath(); g.moveTo(3, -25.5); g.lineTo(busy ? 6.5 : 4.2, busy ? -21.5 : -19); g.lineTo(fx, fy); g.stroke();
    g.fillStyle = '#e0a83a'; g.beginPath(); g.arc(fx + 0.6, fy, 1.7, 0, 7); g.fill();
    // cabeza: cuello, cara, oreja, lentes, casco con ala y barbiquejo
    g.fillStyle = '#c99868'; g.fillRect(-1.3, -30, 2.6, 2.4);
    g.fillStyle = '#d9a878'; g.beginPath(); g.ellipse(0.6, -33, 4, 4.4, 0, 0, 7); g.fill();
    g.fillStyle = '#b7865a'; g.beginPath(); g.arc(-1.4, -32.6, 1, 0, 7); g.fill();
    g.fillStyle = 'rgba(40,60,80,.85)'; g.fillRect(2, -34.2, 3, 1.5);                                   // lentes de seguridad
    g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(-2.6, -33); g.lineTo(-0.5, -29.6); g.stroke();
    const hc = o.helmet || '#f2f4f7';
    g.fillStyle = SL.vgrad(g, -39, 6, SL.tint(hc, 0.3), SL.tint(hc, -0.2)); g.beginPath(); g.arc(0.3, -34.2, 4.8, Math.PI, 0); g.fill();
    g.fillStyle = SL.tint(hc, -0.15); g.beginPath(); g.ellipse(0.8, -34.3, 6.4, 1.1, 0, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.ellipse(-1.2, -37, 1.6, 0.9, -0.4, 0, 7); g.fill();
    g.restore();
    if (o.carry) SL.carton(g, x + dir * 5.5 * s, y - 30 * s, 11 * s, 9 * s, o.carry);
  };

  // ---------- Carga ----------
  // Caja de cartón con volumen (cara frontal + tapa en perspectiva), solapas, cinta, etiqueta y código de barras.
  SL.carton = (g, x, y, w, h, col = '#b98a58') => {
    g.save();
    const d = Math.min(4, w * 0.18, h * 0.3);
    g.fillStyle = SL.tint(col, 0.3); g.beginPath(); g.moveTo(x, y); g.lineTo(x + d, y - d); g.lineTo(x + w + d, y - d); g.lineTo(x + w, y); g.closePath(); g.fill(); // tapa
    g.fillStyle = SL.tint(col, -0.35); g.beginPath(); g.moveTo(x + w, y); g.lineTo(x + w + d, y - d); g.lineTo(x + w + d, y + h - d); g.lineTo(x + w, y + h); g.closePath(); g.fill(); // lateral
    g.fillStyle = SL.vgrad(g, y, h, SL.tint(col, 0.12), SL.tint(col, -0.2)); g.fillRect(x, y, w, h);
    if (w > 6) {
      g.fillStyle = 'rgba(255,240,210,.28)'; g.fillRect(x + w * 0.44, y - d, Math.max(1, w * 0.12), h + d);              // cinta
      g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 0.6; g.beginPath(); g.moveTo(x, y + h * 0.18); g.lineTo(x + w, y + h * 0.18); g.stroke(); // solapa
    }
    if (w > 10 && h > 7) {
      g.fillStyle = 'rgba(250,250,245,.9)'; g.fillRect(x + w * 0.58, y + h * 0.5, w * 0.32, h * 0.32);                   // etiqueta
      g.fillStyle = '#1b2026'; for (let k = 0; k < 6; k++) g.fillRect(x + w * 0.6 + k * w * 0.045, y + h * 0.56, k % 2 ? 0.6 : 0.9, h * 0.14);
      g.fillStyle = 'rgba(20,20,20,.55)'; g.font = `${Math.max(4, h * 0.22)}px system-ui`; g.fillText('↑↑', x + 2, y + h * 0.5);
    }
    g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 0.7; g.strokeRect(x + 0.35, y + 0.35, w - 0.7, h - 0.7);
    g.restore();
  };
  SL.pallet = (g, x, y, w) => { // tarima europea: tablas superiores, tacos, tablas inferiores; alto 7 px
    g.save();
    SL.contact(g, x + w / 2, y + 7.5, w * 0.6, 2.5, 0.45);
    const n = Math.max(3, Math.round(w / 7));
    for (let i = 0; i < n; i++) { const bx = x + (i * (w - 3)) / (n - 1); g.fillStyle = i % 2 ? '#a77c4e' : '#b48a59'; g.fillRect(bx, y, 3.4, 2.3); }
    g.fillStyle = '#9a6f43'; g.fillRect(x, y + 1.6, w, 0.8);
    for (const f of [0, 0.5, 1]) { g.fillStyle = SL.vgrad(g, y + 2.3, 3.4, '#8a5f37', '#6a4627'); g.fillRect(x + f * (w - 5), y + 2.3, 5, 3.4); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + f * (w - 5) + 2, y + 3.4, 1, 1); }
    g.fillStyle = '#8f6740'; g.fillRect(x, y + 5.7, w, 1.7);
    g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x, y + 7.2, w, 0.6);
    g.restore();
  };
  SL.crate = (g, x, y, w, h, col = '#2e8b57') => { // jaba plástica con asas, nervios y producto
    g.save();
    SL.contact(g, x + w / 2, y + h + 1, w * 0.6, 2, 0.4);
    if (h > 8) for (let i = 0; i < Math.floor(w / 4); i++) { g.fillStyle = ['#d14b3a', '#f2a541', '#7cb342'][(i + Math.round(x)) % 3]; g.beginPath(); g.arc(x + 2.5 + i * 4, y + 0.5, 2, Math.PI, 0); g.fill(); } // producto asomando
    SL.rr(g, x, y, w, h, 1.5); g.fillStyle = SL.vgrad(g, y, h, SL.tint(col, 0.25), SL.tint(col, -0.3)); g.fill();
    g.fillStyle = 'rgba(0,0,0,.4)'; const n = Math.max(2, Math.floor(w / 5));
    for (let i = 0; i < n; i++) g.fillRect(x + 2 + (i * (w - 4)) / n, y + h * 0.38, (w - 4) / n - 1.3, h * 0.32);
    g.fillStyle = 'rgba(0,0,0,.5)'; SL.rr(g, x + w * 0.35, y + 1.5, w * 0.3, Math.max(1.5, h * 0.16), 1); g.fill(); // asa
    g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(x, y, w, 1.2); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x, y + h - 1.4, w, 1.4);
    g.restore();
  };
  SL.bucket = (g, x, y, s = 1, col = '#d9dee4', label) => { // balde con aro, asa y tapa; x,y = base central
    g.save(); g.translate(x, y); g.scale(s, s);
    SL.contact(g, 0, 0.5, 8, 2, 0.45);
    g.beginPath(); g.moveTo(-6, -15); g.lineTo(6, -15); g.lineTo(5, 0); g.lineTo(-5, 0); g.closePath();
    g.fillStyle = SL.hgrad(g, -6, 12, SL.tint(col, -0.3), SL.tint(col, 0.15)); g.fill();
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(-3.5, -14, 1.2, 13);
    g.fillStyle = SL.tint(col, -0.35); g.fillRect(-6.6, -16.2, 13.2, 2.2); g.fillRect(-5.8, -10.5, 11.6, 0.9); g.fillRect(-5.4, -5, 10.8, 0.9);
    if (label) { g.fillStyle = label; g.fillRect(-4.5, -9.4, 9, 4); g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(-3.5, -8.2, 5, 0.8); }
    g.strokeStyle = 'rgba(40,50,60,.85)'; g.lineWidth = 0.8; g.beginPath(); g.arc(0, -15, 6, Math.PI, 0); g.stroke();
    g.restore();
  };
  SL.mattress = (g, x, y, w, h, col = '#e4e0d4') => { // colchón con bordón, capitoné y etiqueta
    g.save(); shadow(g, 6, 2, 0.4); SL.rr(g, x, y, w, h, h / 2.5); g.fillStyle = SL.vgrad(g, y, h, SL.tint(col, 0.12), SL.tint(col, -0.22)); g.fill(); noShadow(g);
    g.strokeStyle = SL.tint(col, -0.35); g.lineWidth = 1; SL.rr(g, x + 1, y + 1, w - 2, h - 2, h / 2.6); g.stroke();       // bordón
    g.strokeStyle = 'rgba(90,90,110,.35)'; g.setLineDash([2, 3]); g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(x + 3, y + h / 2); g.lineTo(x + w - 3, y + h / 2); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(80,80,100,.35)'; for (let xx = x + 8; xx < x + w - 4; xx += 9) for (const yy of [y + h * 0.3, y + h * 0.7]) { g.beginPath(); g.arc(xx, yy, 0.9, 0, 7); g.fill(); }
    if (w > 30) { g.fillStyle = '#2f6fb0'; g.fillRect(x + w - 12, y + h - 4, 7, 3); }
    g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(x + h / 2.5, y + 1, w - h, 1.2);
    g.restore();
  };

  // ---------- Vehículos ----------
  const wheel = (g, x, y, r, rot = 0, rim = '#7d8793') => {
    g.fillStyle = '#0d1014'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.strokeStyle = '#22282f'; g.lineWidth = r * 0.18; g.beginPath(); g.arc(x, y, r * 0.86, 0, 7); g.stroke(); // banda
    g.fillStyle = SL.vgrad(g, y - r * 0.55, r * 1.1, SL.tint(rim, 0.3), SL.tint(rim, -0.3)); g.beginPath(); g.arc(x, y, r * 0.55, 0, 7); g.fill();
    g.fillStyle = '#2a3038'; for (let k = 0; k < 5; k++) { const a = rot + (k * Math.PI * 2) / 5; g.beginPath(); g.arc(x + Math.cos(a) * r * 0.33, y + Math.sin(a) * r * 0.33, Math.max(0.5, r * 0.07), 0, 7); g.fill(); }
    g.fillStyle = '#1b2026'; g.beginPath(); g.arc(x, y, r * 0.16, 0, 7); g.fill();
  };
  SL.wheel = wheel;
  SL.haulTruck = (g, x, y, o = {}) => { // camión minero; x,y = centro del eje trasero en el suelo
    const s = o.s || 1, dir = o.dir || 1, col = o.color || '#c9912a', rot = (o.dist ?? T() * 3) / 5;
    g.save(); g.translate(x, y); g.scale(dir * s, s);
    SL.contact(g, 4, 0, 26, 3.4, 0.55);
    g.fillStyle = '#1b2026'; g.fillRect(-17, -11, 38, 3.5);                                                // chasis
    g.fillStyle = '#2a3038'; g.fillRect(-12, -9, 3, 4); g.fillRect(12, -9, 3, 4);                         // suspensión
    g.beginPath(); g.moveTo(-19, -10); g.lineTo(13, -10); g.lineTo(18, -21); g.lineTo(-22, -21); g.closePath();     // tolva
    g.fillStyle = metal(g, -21, 11, col); g.fill();
    g.strokeStyle = SL.tint(col, -0.45); g.lineWidth = 0.9; for (const k of [-12, -4, 4]) { g.beginPath(); g.moveTo(k, -20.5); g.lineTo(k + 1.5, -10.5); g.stroke(); } // nervios
    g.fillStyle = SL.tint(col, -0.2); g.fillRect(12, -27, 10, 4);                                          // visera sobre cabina
    if (o.loaded) { g.fillStyle = SL.vgrad(g, -31, 10, '#8a6e55', '#5e4a38'); g.beginPath(); g.moveTo(-21, -21); g.quadraticCurveTo(-8, -33, 4, -29); g.quadraticCurveTo(12, -27, 17, -21); g.fill(); g.fillStyle = 'rgba(0,0,0,.25)'; for (let k = 0; k < 7; k++) { g.beginPath(); g.arc(-15 + k * 4.5, -23 - (k % 3) * 1.6, 1.2, 0, 7); g.fill(); } }
    g.fillStyle = metal(g, -18, 9, SL.tint(col, -0.1)); g.fillRect(13, -18, 10, 8.5);                      // cabina
    g.fillStyle = SL.vgrad(g, -16.5, 4, '#bfe6ff', '#4f87b0'); g.fillRect(17.5, -16.5, 5, 4);
    g.strokeStyle = '#3a414a'; g.lineWidth = 0.8; for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(10.5 + k, -10 + 0); g.lineTo(10.5 + k, -10); g.stroke(); }
    g.strokeStyle = '#c3ccd6'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(11, -10); g.lineTo(13, -17); g.stroke(); // escalera
    for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(11.3 + k * 0.6, -11.5 - k * 2); g.lineTo(13, -11.5 - k * 2); g.stroke(); }
    g.fillStyle = '#ffe9a8'; g.fillRect(22.3, -12.5, 1.6, 2);                                             // faro
    g.fillStyle = '#3a414a'; g.fillRect(19, -23, 1.6, 5);                                                 // escape
    wheel(g, -10, -5, 5.6, rot); wheel(g, 15, -5, 5.6, rot);
    g.restore();
    if (o.state) SL.led(g, x + dir * 6 * s, y - 30 * s, 2.2, ST[o.state]);
  };
  SL.van = (g, x, y, o = {}) => { // camión de reparto / refrigerado; x,y = rueda trasera en el suelo
    const s = o.s || 1, dir = o.dir || 1, body = o.body || '#dde5ee', cab = o.cab || '#2f6fb0', rot = (o.dist ?? 0) / 4;
    g.save(); g.translate(x, y); g.scale(dir * s, s);
    SL.contact(g, 14, 0, 38, 3.4, 0.5);
    g.fillStyle = metal(g, -34, 26, body); g.fillRect(-14, -34, 44, 26);                                   // caja
    g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 0.8; for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(-14 + i * 7.3, -34); g.lineTo(-14 + i * 7.3, -8); g.stroke(); }
    g.fillStyle = SL.alpha(cab, 0.85); g.fillRect(-14, -19, 44, 2.4);                                      // franja corporativa
    g.fillStyle = 'rgba(255,255,255,.3)'; g.fillRect(-14, -34, 44, 1.2);
    g.fillStyle = '#f5c542'; g.fillRect(-14, -9.5, 44, 1.2);                                               // cinta reflectiva
    g.fillStyle = '#c0392b'; g.fillRect(-14.5, -14, 1.6, 3);                                               // luz trasera
    if (o.reefer) { g.fillStyle = metal(g, -35, 12, '#7d8fa3'); g.fillRect(24, -35, 7, 12); g.fillStyle = '#20282f'; for (let k = 0; k < 4; k++) g.fillRect(25, -33 + k * 2.6, 5, 1.4); SL.led(g, 27.5, -21.5, 1.1, '#4fc3f7', true); }
    if (o.open) { g.fillStyle = '#05080c'; g.fillRect(-15, -33, 3, 24); g.fillStyle = metal(g, -34, 25, body); g.fillRect(-19, -34, 4, 25); }
    else { g.strokeStyle = 'rgba(0,0,0,.4)'; g.beginPath(); g.moveTo(-13.5, -33); g.lineTo(-13.5, -9); g.stroke(); g.fillStyle = '#9aa6b3'; g.fillRect(-13, -23, 1, 6); }
    g.fillStyle = metal(g, -27, 19, cab); g.beginPath(); g.moveTo(31, -8); g.lineTo(31, -27); g.lineTo(40, -27); g.lineTo(45.5, -17); g.lineTo(45.5, -8); g.fill();
    g.fillStyle = SL.vgrad(g, -25, 8, '#cdeeff', '#3f77a0'); g.beginPath(); g.moveTo(34, -25); g.lineTo(39.5, -25); g.lineTo(43.5, -17.5); g.lineTo(34, -17.5); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.moveTo(33, -16); g.lineTo(33, -9); g.stroke(); g.fillStyle = '#c3ccd6'; g.fillRect(34, -15, 2.5, 0.9);
    g.fillStyle = '#20282f'; g.fillRect(31, -25, 1.4, 5);                                                  // espejo
    g.fillStyle = '#ffe9a8'; g.fillRect(44.5, -14, 1.4, 2.2); g.fillStyle = '#f5b942'; g.fillRect(44.5, -11.5, 1.4, 1.2);
    g.fillStyle = '#1b2026'; g.fillRect(-14, -8, 60, 3); g.fillStyle = '#3a414a'; g.fillRect(40, -8.5, 6, 2);
    for (const wx of [-4, 5.5, 38]) { g.fillStyle = '#10161d'; g.beginPath(); g.arc(wx, -5, 5.6, Math.PI, 0); g.fill(); wheel(g, wx, -4, 4.4, rot); }
    g.restore();
  };
  SL.forklift = (g, x, y, o = {}) => { // x,y = centro en el suelo
    const s = o.s || 1, dir = o.dir || 1, rot = (o.dist ?? 0) / 3;
    g.save(); g.translate(x, y); g.scale(dir * s, s);
    SL.contact(g, 0, 0, 18, 2.8, 0.5);
    g.fillStyle = metal(g, -14, 10, '#2a3038'); SL.rr(g, -17, -14, 8, 10, 2); g.fill();                     // contrapeso
    g.fillStyle = metal(g, -13, 9, '#e0aa1e'); SL.rr(g, -12, -13, 21, 9, 2); g.fill();
    hazard(g, -12, -6.2, 21, 1.6, 0.9);
    g.strokeStyle = '#2a3038'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(-10, -13); g.lineTo(-10, -28); g.lineTo(4.5, -28); g.lineTo(4.5, -13); g.stroke(); // techo protector
    g.lineWidth = 0.7; for (let k = -8; k < 4; k += 2.5) { g.beginPath(); g.moveTo(k, -28); g.lineTo(k + 1, -28); g.stroke(); }
    g.fillStyle = '#20282f'; g.fillRect(-7, -17, 5, 4); g.fillRect(-7, -21, 1.5, 4);                         // asiento
    g.save(); g.translate(-3, -13); g.scale(0.36, 0.36); SL.person(g, 0, 0, { dir: 1, s: 1, helmet: '#f2f4f7', shirt: '#2f6fb0', busy: true }); g.restore();
    g.strokeStyle = '#3a414a'; g.lineWidth = 1; g.beginPath(); g.moveTo(1, -17); g.lineTo(3, -21); g.stroke();       // volante
    const blink = Math.floor(T() * 3) % 2 === 0; SL.led(g, -9, -30, 1.6, '#f5b942', blink);                // baliza
    g.fillStyle = metal(g, -31, 30, '#4a525c'); g.fillRect(8, -31, 3, 29); g.fillRect(11.5, -31, 1.5, 29);    // mástil
    g.strokeStyle = '#15191e'; g.lineWidth = 0.6; g.setLineDash([1, 1]); g.beginPath(); g.moveTo(10, -30); g.lineTo(10, -4); g.stroke(); g.setLineDash([]);
    const lift = o.lift || 0; g.fillStyle = '#5b6b80'; g.fillRect(12, -10 - lift, 2, 8); g.fillStyle = metal(g, -3 - lift, 2, '#9aa6b3'); g.fillRect(12, -3.2 - lift, 13, 2);
    if (o.load) { SL.pallet(g, 12, -11 - lift, 13); SL.carton(g, 13, -21 - lift, 10, 10, o.load); }
    wheel(g, -8, -3.5, 3.8, rot); wheel(g, 5, -3.5, 3.6, rot);
    g.restore();
  };

  // ---------- Equipos de proceso ----------
  SL.tank = (g, x, y, w, h, frac, o = {}) => { // tanque vertical con anillos, escalera, boca de hombre y boquillas; frac = nivel 0..1
    g.save();
    const e = w * 0.12, liq = o.liquid || '#2d8fd5', t = T();
    SL.contact(g, x + w / 2, y + h + 9, w * 0.65, 5, 0.5);
    shadow(g, 12, 5); g.fillStyle = SL.hgrad(g, x, w, '#2a3644', '#4b5d72'); g.fillRect(x, y, w, h); noShadow(g);
    const sh = g.createLinearGradient(x, 0, x + w, 0); sh.addColorStop(0, 'rgba(0,0,0,.35)'); sh.addColorStop(0.3, 'rgba(255,255,255,.06)'); sh.addColorStop(0.45, 'rgba(255,255,255,.12)'); sh.addColorStop(1, 'rgba(0,0,0,.45)');
    const ly = y + h - h * Math.max(0, Math.min(1, frac));
    g.fillStyle = SL.hgrad(g, x, w, SL.tint(liq, -0.3), SL.tint(liq, 0.12)); g.fillRect(x + 3, ly, w - 6, y + h - ly - 2);
    g.strokeStyle = 'rgba(191,230,255,.55)'; g.lineWidth = 1.2; g.beginPath();                                // superficie con oleaje
    for (let xx = x + 3; xx <= x + w - 3; xx += 3) { const yy = ly + Math.sin(xx * 0.15 + t * 3) * 1.2; xx === x + 3 ? g.moveTo(xx, yy) : g.lineTo(xx, yy); } g.stroke();
    g.fillStyle = 'rgba(255,255,255,.18)'; for (let k = 0; k < 6; k++) { const by = y + h - 4 - ((t * 25 + k * 37) % Math.max(5, y + h - ly - 6)); if (by > ly + 2) { g.beginPath(); g.arc(x + 12 + ((k * 53) % (w - 24)), by, 1.3, 0, 7); g.fill(); } } // burbujas
    g.fillStyle = sh; g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1; for (let k = 1; k < 5; k++) { const yy = y + (h * k) / 5; g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w, yy); g.stroke(); } // anillos
    g.fillStyle = 'rgba(255,255,255,.12)'; for (let k = 1; k < 5; k++) g.fillRect(x, y + (h * k) / 5 + 1, w, 0.8);
    g.strokeStyle = '#8fa3b8'; g.lineWidth = 2.5; g.strokeRect(x, y, w, h);
    g.fillStyle = metal(g, y - e, e, '#6a7b8f'); g.beginPath(); g.ellipse(x + w / 2, y, w / 2, e, 0, Math.PI, 0); g.fill();
    g.fillStyle = '#3a4654'; g.fillRect(x + w * 0.62, y - e * 0.9 - 4, 10, 4); g.fillRect(x + w * 0.3, y - e * 0.8 - 3, 3, 3);      // venteo y boca
    g.strokeStyle = '#c3ccd6'; g.lineWidth = 1; g.beginPath(); g.moveTo(x + w * 0.2, y - e); g.lineTo(x + w * 0.2, y - e - 7); g.lineTo(x + w * 0.8, y - e - 7); g.lineTo(x + w * 0.8, y - e); g.stroke(); // baranda
    const lx = x + w + 4; g.strokeStyle = '#7d8fa3'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(lx, y - 6); g.lineTo(lx, y + h); g.moveTo(lx + 6, y - 6); g.lineTo(lx + 6, y + h); g.stroke(); // escalera con jaula
    g.lineWidth = 0.8; for (let yy = y; yy < y + h; yy += 6) { g.beginPath(); g.moveTo(lx, yy); g.lineTo(lx + 6, yy); g.stroke(); }
    g.strokeStyle = 'rgba(125,143,163,.6)'; for (let yy = y + 10; yy < y + h - 20; yy += 18) { g.beginPath(); g.arc(lx + 3, yy, 7, -Math.PI / 2, Math.PI / 2); g.stroke(); }
    g.fillStyle = metal(g, y + h - 30, 16, '#5b6b80'); g.beginPath(); g.ellipse(x + w * 0.3, y + h - 22, 7, 8, 0, 0, 7); g.fill(); // boca de hombre
    for (let k = 0; k < 8; k++) SL.bolt(g, x + w * 0.3 + Math.cos(k * 0.785) * 6, y + h - 22 + Math.sin(k * 0.785) * 7, 0.7);
    g.strokeStyle = 'rgba(230,237,243,.4)'; g.lineWidth = 1; g.font = '10px system-ui'; g.fillStyle = 'rgba(230,237,243,.55)'; g.textAlign = 'right';
    const n = o.ticks || 8;
    for (let i = 0; i <= n; i++) { const yy = y + h - (h * i) / n; g.beginPath(); g.moveTo(x - 6, yy); g.lineTo(x, yy); g.stroke(); if (o.max) g.fillText(((o.max * i) / n).toFixed(1), x - 9, yy + 3); }
    g.fillStyle = '#2a3440'; for (const fx of [x + 4, x + w / 2 - 4, x + w - 12]) { g.fillRect(fx, y + h, 8, 10); g.fillStyle = '#1a222b'; g.fillRect(fx - 2, y + h + 8, 12, 2); g.fillStyle = '#2a3440'; }
    g.restore();
  };
  SL.pump = (g, cx, cy, r, run, angle = 0) => { // bomba centrífuga con voluta, bridas, acople con guarda y motor TEFC
    g.save();
    g.fillStyle = metal(g, cy + r - 2, 7, '#3a4654'); g.fillRect(cx - r - 6, cy + r - 2, 2 * r + 40, 7);                // bancada
    for (let k = 0; k < 4; k++) SL.bolt(g, cx - r - 2 + k * ((2 * r + 34) / 3), cy + r + 1.5, 1);
    SL.contact(g, cx + 12, cy + r + 6, r + 26, 3, 0.5);
    g.fillStyle = metal(g, cy - r * 0.6, r * 1.2, '#5a6f86'); g.fillRect(cx + r + 9, cy - r * 0.62, 30, r * 1.24);       // motor
    g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 1; for (let i = 1; i < 7; i++) { g.beginPath(); g.moveTo(cx + r + 9 + i * 4, cy - r * 0.62); g.lineTo(cx + r + 9 + i * 4, cy + r * 0.62); g.stroke(); } // aletas
    g.fillStyle = '#2e3a48'; g.fillRect(cx + r + 37, cy - r * 0.5, 4, r); g.fillStyle = '#3a4654'; g.fillRect(cx + r + 18, cy - r * 0.62 - 6, 10, 6); // tapa ventilador y caja de bornes
    g.fillStyle = 'rgba(230,237,243,.8)'; g.fillRect(cx + r + 26, cy + r * 0.1, 7, 4);
    g.fillStyle = '#f5c542'; g.fillRect(cx + r + 1, cy - r * 0.38, 9, r * 0.76); g.strokeStyle = 'rgba(0,0,0,.4)'; for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(cx + r + 2 + k * 3, cy - r * 0.38); g.lineTo(cx + r + 2 + k * 3, cy + r * 0.38); g.stroke(); } // guarda de acople
    shadow(g, 8, 3); g.fillStyle = metal(g, cy - r, 2 * r, '#4f6379'); g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill(); noShadow(g); // voluta
    g.fillStyle = metal(g, cy - r - 9, 9, '#5b6b80'); g.fillRect(cx - r * 0.35, cy - r - 8, r * 0.7, 9); g.fillRect(cx - r * 0.5, cy - r - 10, r, 3); // brida de descarga
    g.fillStyle = '#5b6b80'; g.fillRect(cx - r - 8, cy - r * 0.3, 9, r * 0.6); g.fillRect(cx - r - 10, cy - r * 0.45, 3, r * 0.9); // brida de succión
    g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, r * 0.75, 0, 7); g.stroke();
    g.translate(cx, cy); g.rotate(angle);
    g.strokeStyle = run ? '#9fe3ff' : '#6b7d93'; g.lineWidth = 2.2;
    for (let i = 0; i < 6; i++) { g.rotate(Math.PI / 3); g.beginPath(); g.moveTo(r * 0.18, 0); g.quadraticCurveTo(r * 0.5, r * 0.25, r * 0.78, r * 0.1); g.stroke(); }
    g.fillStyle = '#10161d'; g.beginPath(); g.arc(0, 0, r * 0.2, 0, 7); g.fill();
    g.restore();
    SL.led(g, cx + r + 34, cy - r * 0.62 - 6, 2.2, ST.run, run);
  };
  SL.pipe = (g, pts, w = 8, col = '#6b7d93') => { // tubería con bridas en codos, soportes y reflejo
    const path = () => { g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); };
    g.save(); g.lineJoin = 'round'; g.lineCap = 'butt';
    path(); g.strokeStyle = '#05080c'; g.lineWidth = w + 3.5; g.stroke();
    path(); g.strokeStyle = SL.tint(col, -0.3); g.lineWidth = w; g.stroke();
    path(); g.strokeStyle = col; g.lineWidth = w * 0.6; g.stroke();
    path(); g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = Math.max(1, w * 0.18); g.stroke();
    for (let i = 1; i < pts.length - 1; i++) { const [px, py] = pts[i]; g.fillStyle = SL.tint(col, -0.15); g.beginPath(); g.arc(px, py, w * 0.62, 0, 7); g.fill(); } // codos
    for (let i = 1; i < pts.length; i++) { // bridas cada ~120 px
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], L = Math.hypot(bx - ax, by - ay), n = Math.floor(L / 120);
      for (let k = 1; k <= n; k++) { const t = k / (n + 1), x = ax + (bx - ax) * t, y = ay + (by - ay) * t, hz = Math.abs(by - ay) < Math.abs(bx - ax);
        g.fillStyle = SL.tint(col, 0.1); hz ? g.fillRect(x - 1.5, y - w * 0.85, 3, w * 1.7) : g.fillRect(x - w * 0.85, y - 1.5, w * 1.7, 3); }
    }
    g.restore();
  };
  // Flechas de flujo a lo largo de un tramo (n ∝ magnitud); se desplazan con SL.time para indicar movimiento.
  SL.flow = (g, x1, y1, x2, y2, n, col) => {
    const L = Math.hypot(x2 - x1, y2 - y1), a = Math.atan2(y2 - y1, x2 - x1), ph = n ? (T() * 0.6) % (1 / (n + 1)) : 0;
    g.save(); g.fillStyle = col;
    for (let i = 0; i <= n; i++) {
      const t = i / (n + 1) + ph; if (t <= 0.02 || t >= 0.98) continue;
      const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
      g.save(); g.translate(x, y); g.rotate(a); g.globalAlpha = 0.85; g.beginPath(); g.moveTo(5, 0); g.lineTo(-3, -4); g.lineTo(-1.5, 0); g.lineTo(-3, 4); g.fill(); g.restore();
    }
    g.restore(); return L;
  };
  SL.solar = (g, x, y, w, h, frac) => { // arreglo PV con celdas, marco, estructura y sol
    g.save();
    const sx = x + w - 10, sy = y - 22;
    if (frac > 0.02) { const r = 8 + 6 * frac, gr = g.createRadialGradient(sx, sy, 0, sx, sy, r * 2.8); gr.addColorStop(0, `rgba(255,214,102,${0.9 * frac})`); gr.addColorStop(1, 'rgba(255,214,102,0)'); g.fillStyle = gr; g.beginPath(); g.arc(sx, sy, r * 2.8, 0, 7); g.fill(); g.fillStyle = '#ffd666'; g.beginPath(); g.arc(sx, sy, r * 0.7, 0, 7); g.fill();
      g.strokeStyle = `rgba(255,214,102,${0.5 * frac})`; g.lineWidth = 1.2; for (let k = 0; k < 8; k++) { const a = k * 0.785 + T() * 0.2; g.beginPath(); g.moveTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r); g.lineTo(sx + Math.cos(a) * r * 1.7, sy + Math.sin(a) * r * 1.7); g.stroke(); } }
    for (let k = 0; k < 3; k++) {
      const px = x + k * (w / 3), pw = w / 3 - 6, py = y + 6, ph = h - 14;
      SL.contact(g, px + pw / 2, y + h, pw * 0.6, 3, 0.4);
      g.fillStyle = '#56616d'; g.fillRect(px + pw * 0.25, y + h - 12, 2.5, 12); g.fillRect(px + pw * 0.75, y + h - 8, 2.5, 8);
      g.save(); g.translate(px + pw / 2, py + ph); g.transform(1, 0, -0.35, 1, 0, 0); g.translate(-pw / 2, -ph);
      shadow(g, 6, 3); g.fillStyle = SL.vgrad(g, 0, ph, '#22579c', '#0d2547'); g.fillRect(0, 0, pw, ph); noShadow(g);
      g.strokeStyle = `rgba(160,200,255,${0.25 + 0.4 * frac})`; g.lineWidth = 0.7;
      for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo((pw * i) / 6, 0); g.lineTo((pw * i) / 6, ph); g.stroke(); }
      for (let i = 1; i < 10; i++) { g.beginPath(); g.moveTo(0, (ph * i) / 10); g.lineTo(pw, (ph * i) / 10); g.stroke(); }
      g.strokeStyle = 'rgba(220,230,240,.25)'; g.lineWidth = 0.4; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo((pw * (i + 0.5)) / 6, 0); g.lineTo((pw * (i + 0.5)) / 6, ph); g.stroke(); } // buses
      g.strokeStyle = '#c3ccd6'; g.lineWidth = 1.6; g.strokeRect(0, 0, pw, ph);
      g.fillStyle = `rgba(255,255,255,${0.08 + 0.18 * frac})`; g.beginPath(); g.moveTo(0, 0); g.lineTo(pw * 0.5, 0); g.lineTo(0, ph * 0.5); g.fill();
      g.restore();
    }
    g.fillStyle = metal(g, y + h - 18, 16, '#c3ccd6'); g.fillRect(x + w - 20, y + h - 18, 14, 16); SL.led(g, x + w - 13, y + h - 13, 1.4, ST.run, frac > 0.05); // inversor
    g.restore();
  };
  SL.battery = (g, x, y, w, h, soc, o = {}) => { // contenedor BESS con puertas, rack de módulos, HVAC y rotulado
    g.save();
    SL.contact(g, x + w / 2, y + h + 3, w * 0.6, 4, 0.5);
    shadow(g, 10, 4); SL.rr(g, x, y, w, h, 4); g.fillStyle = metal(g, y, h, '#d4dbe3'); g.fill(); noShadow(g);
    g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 1; for (let k = x + 6; k < x + w; k += 6) { g.beginPath(); g.moveTo(k, y + 2); g.lineTo(k, y + h - 2); g.stroke(); } // corrugado
    g.fillStyle = metal(g, y - 10, 10, '#9aa6b3'); g.fillRect(x + w - 34, y - 10, 26, 10); SL.fan(g, x + w - 21, y - 5, 4, Math.abs(o.flow || 0) > 1, 0.6); // HVAC
    const cols = 6, rows = 3, mw = (w - 16) / cols, mh = (h - 28) / rows, on = Math.round(soc * cols * rows);
    g.fillStyle = '#0d141b'; g.fillRect(x + 6, y + 6, w - 12, h - 24);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = (rows - 1 - r) * cols + c, mx = x + 8 + c * mw, my = y + 8 + r * mh;
      g.fillStyle = SL.vgrad(g, my, mh - 3, '#33404e', '#1d2630'); g.fillRect(mx, my, mw - 3, mh - 3);
      g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(mx, my, mw - 3, 1);
      g.fillStyle = i < on ? SL.color(soc) : '#3a4654'; g.fillRect(mx + 2, my + mh - 7, mw - 7, 2.5);
      SL.led(g, mx + mw - 6, my + 3.5, 0.9, i < on ? ST.run : ST.off, i < on);
    }
    SL.gauge(g, x + 8, y + h - 16, w - 16, 10, soc, SL.color(soc), `${Math.round(soc * 100)} % SOC`);
    g.fillStyle = '#f5c542'; g.beginPath(); g.moveTo(x + 14, y - 1); g.lineTo(x + 20, y - 11); g.lineTo(x + 26, y - 1); g.fill(); g.fillStyle = '#15191e'; g.font = '700 7px system-ui'; g.textAlign = 'center'; g.fillText('⚡', x + 20, y - 3);
    if (o.flow) SL.led(g, x + w - 8, y - 14, 2.4, o.flow > 0 ? ST.run : ST.info, Math.abs(o.flow) > 1);
    g.restore();
  };
  SL.genset = (g, x, y, w, h, on, t = 0) => { // grupo electrógeno: contenedor insonorizado, silenciador, radiador y tanque
    g.save();
    if (on) for (let i = 0; i < 6; i++) { const k = (t * 0.6 + i / 6) % 1; g.fillStyle = `rgba(140,150,160,${0.4 * (1 - k)})`; g.beginPath(); g.arc(x + w - 16 + k * 14 + Math.sin(k * 6 + i) * 3, y - 22 - k * 40, 4 + k * 12, 0, 7); g.fill(); }
    g.fillStyle = metal(g, y - 22, 22, '#4a525c'); g.fillRect(x + w - 21, y - 22, 8, 22); g.fillStyle = '#2a3038'; g.fillRect(x + w - 23, y - 23, 12, 3);
    g.fillStyle = metal(g, y - 8, 7, '#6a7684'); SL.rr(g, x + w - 40, y - 9, 16, 7, 3); g.fill();                     // silenciador
    SL.contact(g, x + w / 2, y + h + 4, w * 0.6, 4, 0.5);
    g.fillStyle = metal(g, y + h - 2, 7, '#2a3038'); g.fillRect(x - 2, y + h - 2, w + 4, 7);                            // tanque base
    shadow(g, 10, 4); SL.rr(g, x, y, w, h, 3); g.fillStyle = metal(g, y, h, '#5f6e7e'); g.fill(); noShadow(g);
    g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1;
    for (let i = 0; i < 10; i++) { const xx = x + 6 + i * 3.6; g.beginPath(); g.moveTo(xx, y + 8); g.lineTo(xx, y + h - 8); g.stroke(); } // radiador
    if (on) SL.fan(g, x + 22, y + h / 2, Math.min(14, h * 0.32), true, 1.2);
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(x + w * 0.45 + i * ((w * 0.5) / 4), y + 4); g.lineTo(x + w * 0.45 + i * ((w * 0.5) / 4), y + h - 4); g.stroke(); }
    g.fillStyle = '#9aa6b3'; for (let i = 0; i < 4; i++) g.fillRect(x + w * 0.45 + i * ((w * 0.5) / 4) + 6, y + h / 2 - 2, 1.5, 4);       // manijas
    g.fillStyle = '#0a1016'; g.fillRect(x + w * 0.5, y + 8, 18, 12); g.fillStyle = on ? '#1d5778' : '#1a222b'; g.fillRect(x + w * 0.5 + 2, y + 10, 14, 6);
    SL.dial(g, x + w * 0.5 + 26, y + 14, 5, on ? 0.6 + 0.03 * Math.sin(t * 9) : 0);
    SL.led(g, x + w - 10, y + 10, 2.4, ST.run, on);
    g.restore();
  };
  SL.building = (g, x, y, w, h, o = {}) => { // nave industrial: diente de sierra, canaletas, portones, ventanas y rótulo
    g.save();
    SL.contact(g, x + w / 2, y + h + 2, w * 0.6, 5, 0.5);
    shadow(g, 12, 5); g.fillStyle = metal(g, y, h, '#4a5a6c'); g.fillRect(x, y, w, h); noShadow(g);
    g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 1; for (let k = x + 5; k < x + w; k += 5) { g.beginPath(); g.moveTo(k, y); g.lineTo(k, y + h); g.stroke(); }
    const teeth = Math.max(2, Math.round(w / 32)), tw = w / teeth;
    for (let i = 0; i < teeth; i++) { g.fillStyle = metal(g, y - 14, 14, '#6a7b8f'); g.beginPath(); g.moveTo(x + i * tw, y); g.lineTo(x + i * tw, y - 14); g.lineTo(x + (i + 1) * tw, y); g.fill(); g.fillStyle = SL.vgrad(g, y - 13, 12, 'rgba(190,225,255,.75)', 'rgba(90,140,190,.45)'); g.fillRect(x + i * tw + 1, y - 13, 3, 12); }
    g.fillStyle = '#2a3440'; g.fillRect(x - 2, y - 1, w + 4, 2.5); g.fillRect(x + 3, y, 2, h);                     // canaleta y bajada
    const lit = o.load ?? 0.6;
    for (let r = 0; r < 2; r++) for (let c = 0; c < Math.floor((w - 16) / 18); c++) {
      const on = (c + r) % 3 < lit * 3, wx = x + 10 + c * 18, wy = y + 10 + r * 16;
      g.fillStyle = '#15191e'; g.fillRect(wx - 1, wy - 1, 12, 10);
      g.fillStyle = on ? SL.vgrad(g, wy, 8, 'rgba(255,230,150,.95)', 'rgba(230,170,70,.85)') : 'rgba(20,28,36,.95)'; g.fillRect(wx, wy, 10, 8);
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(wx + 4.5, wy, 1, 8);
    }
    const dw = Math.min(26, w * 0.2), dx = x + w / 2 - dw / 2;
    g.fillStyle = SL.vgrad(g, y + h - 26, 26, '#3a4654', '#20282f'); g.fillRect(dx, y + h - 26, dw, 26);
    g.strokeStyle = 'rgba(0,0,0,.4)'; for (let k = y + h - 24; k < y + h; k += 3) { g.beginPath(); g.moveTo(dx, k); g.lineTo(dx + dw, k); g.stroke(); } // portón seccional
    hazard(g, dx - 4, y + h - 26, 3, 26, 0.9); hazard(g, dx + dw + 1, y + h - 26, 3, 26, 0.9);
    g.fillStyle = '#c3ccd6'; g.fillRect(x + w - 16, y + h - 15, 8, 15); g.fillStyle = '#2f6fb0'; g.fillRect(x + w - 15, y + h - 14, 6, 6);
    if (o.label) SL.sign(g, x + w / 2, y - 22, o.label);
    g.restore();
  };
  SL.excavator = (g, x, y, o = {}) => { // pala hidráulica: orugas con zapatas, contrapeso, barandas, brazo con cilindros y cucharón dentado
    const s = o.s || 1, t = o.t ?? T(), dig = o.busy ? Math.sin(t * 2) : 0.4;
    g.save(); g.translate(x, y); g.scale(s, s);
    SL.contact(g, 0, 0, 38, 5, 0.55);
    SL.rr(g, -32, -11, 64, 11, 5.5); g.fillStyle = '#15191e'; g.fill();
    g.fillStyle = '#2a3038'; for (let i = -30; i <= 30; i += 4) g.fillRect(i + ((t * 6) % 4), -11.5, 2.5, 1.6);      // zapatas
    g.fillStyle = '#4a525c'; for (let i = -24; i <= 24; i += 8) { g.beginPath(); g.arc(i, -5.5, 2.8, 0, 7); g.fill(); g.fillStyle = '#2a3038'; g.beginPath(); g.arc(i, -5.5, 1, 0, 7); g.fill(); g.fillStyle = '#4a525c'; }
    g.fillStyle = '#3a414a'; g.fillRect(-8, -15, 16, 4);                                                             // tornamesa
    SL.rr(g, -26, -32, 44, 18, 3); g.fillStyle = metal(g, -32, 18, '#e0b23a'); g.fill();
    g.fillStyle = metal(g, -30, 14, '#2a3038'); SL.rr(g, -32, -30, 8, 14, 2); g.fill();                              // contrapeso
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1; for (let k = -18; k < 0; k += 3) { g.beginPath(); g.moveTo(k, -29); g.lineTo(k, -20); g.stroke(); } // rejilla motor
    g.strokeStyle = '#c3ccd6'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(-24, -32); g.lineTo(-24, -37); g.lineTo(-8, -37); g.lineTo(-8, -32); g.stroke(); // baranda
    g.fillStyle = metal(g, -46, 14, '#2a3038'); g.fillRect(-6, -46, 16, 14); g.fillStyle = SL.vgrad(g, -44, 8, '#cdeeff', '#3f77a0'); g.fillRect(-3, -44, 11, 8);
    g.fillStyle = '#3a414a'; g.fillRect(-14, -36, 2, 5);
    SL.led(g, 2, -48, 1.5, '#f5b942', o.busy && Math.floor(t * 3) % 2 === 0);
    const a1 = -0.9 + 0.25 * dig, a2 = 1.2 + 0.45 * dig;
    g.translate(14, -26); g.rotate(a1); g.fillStyle = metal(g, -4, 8, '#c9912a'); g.fillRect(0, -4, 44, 8);
    g.strokeStyle = '#c3ccd6'; g.lineWidth = 2; g.beginPath(); g.moveTo(4, 5); g.lineTo(26, 5); g.stroke(); g.strokeStyle = '#3a414a'; g.lineWidth = 3; g.beginPath(); g.moveTo(2, 5); g.lineTo(14, 5); g.stroke(); // cilindro
    g.translate(44, 0); g.rotate(a2); g.fillStyle = metal(g, -3, 6, '#c9912a'); g.fillRect(0, -3, 30, 6);
    g.strokeStyle = '#c3ccd6'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(3, -5); g.lineTo(22, -5); g.stroke();
    g.translate(30, 0); g.rotate(0.6 * dig); g.fillStyle = metal(g, -8, 16, '#6d747c'); g.beginPath(); g.moveTo(0, -6); g.lineTo(13, -8); g.lineTo(11, 8); g.lineTo(0, 6); g.fill();
    g.fillStyle = '#c3ccd6'; for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(11 + k * -0.2, -6 + k * 4); g.lineTo(15, -5 + k * 4); g.lineTo(11, -3.5 + k * 4); g.fill(); } // dientes
    if (o.busy && dig > 0.3) { g.fillStyle = '#7a6049'; g.beginPath(); g.arc(6, 0, 4, 0, 7); g.fill(); }
    g.restore();
  };
  SL.crusher = (g, x, y, o = {}) => { // chancador con tolva, estructura, pasarela, motor con poleas y faja de descarga
    const s = o.s || 1, run = o.state === 'run' || o.state == null;
    g.save(); g.translate(x, y); g.scale(s, s);
    SL.contact(g, 0, 0, 42, 5, 0.55);
    g.strokeStyle = '#3a4a5c'; g.lineWidth = 2.4; for (const k of [-30, 30]) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k * 0.8, -48); g.stroke(); } // columnas
    g.lineWidth = 1; g.beginPath(); g.moveTo(-30, 0); g.lineTo(24, -46); g.moveTo(30, 0); g.lineTo(-24, -46); g.stroke();
    shadow(g, 10, 4);
    g.fillStyle = metal(g, -72, 28, '#6d7c8c'); g.beginPath(); g.moveTo(-36, -72); g.lineTo(36, -72); g.lineTo(18, -44); g.lineTo(-18, -44); g.closePath(); g.fill();
    g.fillStyle = metal(g, -44, 44, '#556477'); g.fillRect(-24, -44, 48, 40);
    noShadow(g);
    g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 1; for (let k = -30; k <= 30; k += 10) { g.beginPath(); g.moveTo(k, -72); g.lineTo(k * 0.5, -44); g.stroke(); }
    if (o.load) { g.fillStyle = SL.vgrad(g, -82, 12, '#8a6e55', '#5e4a38'); g.beginPath(); g.moveTo(-30, -68); g.quadraticCurveTo(0, -72 - 14 * Math.min(1, o.load), 30, -68); g.fill(); g.fillStyle = 'rgba(0,0,0,.25)'; for (let k = 0; k < 8; k++) { g.beginPath(); g.arc(-24 + k * 7, -69 - (k % 3) * 2 * Math.min(1, o.load), 1.4, 0, 7); g.fill(); } }
    g.strokeStyle = '#c3ccd6'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(-40, -72); g.lineTo(-40, -80); g.lineTo(40, -80); g.lineTo(40, -72); g.stroke(); // baranda
    g.strokeStyle = '#1b2026'; g.lineWidth = 3; g.beginPath(); g.moveTo(-10, -40); g.lineTo(-4, -10); g.moveTo(10, -40); g.lineTo(4, -10); g.stroke(); // mandíbulas
    const sw = run ? Math.sin(T() * 12) * 1.5 : 0; g.fillStyle = '#2a3038'; g.beginPath(); g.arc(28 + sw * 0.2, -30, 8, 0, 7); g.fill(); g.fillStyle = '#5b6b80'; g.beginPath(); g.arc(28, -30, 3, 0, 7); g.fill(); // volante
    g.fillStyle = metal(g, -16, 12, '#4f6379'); g.fillRect(34, -18, 18, 12); g.strokeStyle = '#15191e'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(28, -38); g.lineTo(43, -18); g.moveTo(28, -22); g.lineTo(43, -6); g.stroke(); // motor y fajas
    g.fillStyle = '#2a3038'; g.fillRect(-30, -4, 60, 4);
    if (run && o.load) for (let k = 0; k < 3; k++) { const a = (T() * 2 + k / 3) % 1; g.fillStyle = `rgba(150,140,120,${0.3 * (1 - a)})`; g.beginPath(); g.arc(-10 + k * 10, -76 - a * 18, 4 + a * 7, 0, 7); g.fill(); } // polvo
    g.restore();
    if (o.state) SL.led(g, x + 20 * s, y - 60 * s, 2.6, ST[o.state]);
  };
  SL.shelf = (g, x, y, w, h, levels = 3, fill = 0.7, seed = 1) => { // rack selectivo: parantes perforados, largueros, protectores, rótulos de ubicación
    g.save();
    SL.contact(g, x + w / 2, y + h + 1, w * 0.55, 3, 0.4);
    for (const px of [x, x + w]) {
      g.fillStyle = metal(g, y, h, '#3f6d9c'); g.fillRect(px - 2, y, 4, h);
      g.fillStyle = 'rgba(0,0,0,.45)'; for (let yy = y + 3; yy < y + h; yy += 4) g.fillRect(px - 0.6, yy, 1.2, 1.6);  // perforaciones
      g.fillStyle = '#20282f'; g.fillRect(px - 4, y + h - 1.5, 8, 2);                                                // placa base
      hazard(g, px - 4, y + h - 9, 8, 7, 0.9);                                                                        // protector
    }
    for (let l = 0; l < levels; l++) {
      const ly = y + ((l + 1) * h) / levels, lh = h / levels;
      let bx = x + 3;
      for (let k = 0; bx < x + w - 10; k++) { const bw = 8 + ((seed * 7 + k * 13 + l * 5) % 7), on = ((seed * 3 + k * 11 + l * 7) % 10) / 10 < fill; if (on) SL.carton(g, bx, ly - 3.5 - lh * 0.58, bw, lh * 0.58, ['#b98a58', '#a57a4c', '#c9a06a'][k % 3]); bx += bw + 3; }
      g.fillStyle = metal(g, ly - 3.5, 3.5, '#e07b2a'); g.fillRect(x, ly - 3.5, w, 3.5);                             // larguero naranja
      if (w > 60) for (let k = 0; k < 3; k++) { g.fillStyle = 'rgba(245,247,250,.92)'; g.fillRect(x + 6 + (k * (w - 18)) / 2.2, ly - 3, 7, 2.6); }
    }
    g.restore();
  };
  SL.table = (g, x, y, w, h = 6) => { // mesa de trabajo con tablero, cajón, travesaño y regatones
    g.save(); SL.contact(g, x + w / 2, y + h + 18, w * 0.6, 2.5, 0.4);
    g.fillStyle = metal(g, y, h, '#6a7b8f'); g.fillRect(x, y, w, h); g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x, y, w, 1.5);
    g.fillStyle = '#2a3440'; g.fillRect(x + 3, y + h, 3, 18); g.fillRect(x + w - 6, y + h, 3, 18); g.fillRect(x + 4, y + h + 12, w - 8, 1.8);
    if (w > 30) { g.fillStyle = '#3a4654'; g.fillRect(x + w * 0.55, y + h, w * 0.32, 5); g.fillStyle = '#9aa6b3'; g.fillRect(x + w * 0.68, y + h + 2, 5, 1); }
    g.fillStyle = '#10161d'; g.fillRect(x + 2, y + h + 17, 5, 1.5); g.fillRect(x + w - 7, y + h + 17, 5, 1.5);
    g.restore();
  };
  SL.chute = (g, x, y, w, h, frac, col, label) => { // chute / tolva de destino con nivel, refuerzos y baliza
    g.save();
    SL.contact(g, x + w / 2, y + h + 2, w * 0.55, 3, 0.45);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w - 8, y + h); g.lineTo(x + 8, y + h); g.closePath();
    g.fillStyle = metal(g, y, h, '#3a4a5e'); g.fill(); g.strokeStyle = '#6b7d93'; g.lineWidth = 1.5; g.stroke();
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1; for (let k = 1; k < 3; k++) { const yy = y + (h * k) / 3, ins = (8 * k) / 3; g.beginPath(); g.moveTo(x + ins, yy); g.lineTo(x + w - ins, yy); g.stroke(); }
    const f = Math.max(0, Math.min(1, frac));
    if (f > 0) { const fy = y + h - (h - 6) * f - 2; g.fillStyle = SL.vgrad(g, fy, (h - 6) * f, SL.alpha(col, 0.75), SL.alpha(col, 0.4)); g.fillRect(x + 9, fy, w - 18, (h - 6) * f); g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(x + 9, fy, w - 18, 1); }
    g.fillStyle = '#c3ccd6'; g.fillRect(x - 1, y - 2, w + 2, 2.5);
    if (f > 0.85) SL.led(g, x + w - 6, y - 6, 2, ST.down, Math.floor(T() * 3) % 2 === 0);
    if (label) { g.fillStyle = '#e6edf3'; g.font = '600 11px system-ui'; g.textAlign = 'center'; g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = 3; g.fillText(label, x + w / 2, y + 13); }
    g.restore();
  };
  SL.store = (g, x, y, w, h, label) => { // tienda: toldo, vitrina con góndolas, puerta, letrero luminoso
    g.save(); SL.contact(g, x + w / 2, y + h + 2, w * 0.6, 3, 0.45);
    shadow(g, 8, 3); g.fillStyle = metal(g, y, h, '#dfe5ec'); g.fillRect(x, y, w, h); noShadow(g);
    const aw = 6; for (let i = 0; i < w / aw; i++) { g.fillStyle = i % 2 ? '#e6edf3' : '#2f6fb0'; g.beginPath(); g.moveTo(x + i * aw, y - 7); g.lineTo(x + (i + 1) * aw, y - 7); g.lineTo(x + (i + 1) * aw, y - 1); g.quadraticCurveTo(x + (i + 0.5) * aw, y + 2, x + i * aw, y - 1); g.fill(); }
    g.fillStyle = SL.vgrad(g, y + 6, h * 0.35, '#cdeeff', '#5f97c0'); g.fillRect(x + 4, y + 6, w - 8, h * 0.35);
    g.fillStyle = 'rgba(20,30,40,.55)'; for (let k = x + 8; k < x + w - 8; k += 7) g.fillRect(k, y + 8 + h * 0.18, 4, h * 0.15);
    g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.moveTo(x + 6, y + 6); g.lineTo(x + 14, y + 6); g.lineTo(x + 6, y + 6 + h * 0.3); g.fill();
    g.fillStyle = '#26313d'; g.fillRect(x + w / 2 - 4, y + h - 13, 8, 13); g.fillStyle = 'rgba(159,211,255,.5)'; g.fillRect(x + w / 2 - 3, y + h - 12, 6, 6);
    if (label) { g.fillStyle = '#0b1117'; g.font = '600 10px system-ui'; g.textAlign = 'center'; g.fillText(label, x + w / 2, y + h - 16); }
    g.restore();
  };
  SL.road = (g, pts, w = 26) => { // camino de acarreo: berma con rocas, calzada con huellas, eje
    const path = () => { g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); };
    g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
    path(); g.strokeStyle = '#3a3027'; g.lineWidth = w + 12; g.stroke();
    path(); g.setLineDash([3, 7]); g.strokeStyle = '#5e4f40'; g.lineWidth = w + 10; g.stroke(); g.setLineDash([]); // rocas de berma
    path(); g.strokeStyle = '#6e5d4b'; g.lineWidth = w; g.stroke();
    path(); g.strokeStyle = 'rgba(40,30,22,.35)'; g.lineWidth = w * 0.7; g.setLineDash([2, 2]); g.stroke();            // huellas
    path(); g.strokeStyle = '#6e5d4b'; g.lineWidth = w * 0.3; g.setLineDash([]); g.stroke();
    path(); g.setLineDash([10, 10]); g.strokeStyle = 'rgba(230,220,200,.35)'; g.lineWidth = 1.5; g.stroke();
    g.restore();
  };
})();
