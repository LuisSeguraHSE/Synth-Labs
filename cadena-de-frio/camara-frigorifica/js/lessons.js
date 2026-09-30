// Laboratorio guiado: pasos con detección automática de cumplimiento a partir del estado del simulador.
import { loadBreakdown } from './explain.js';

const lastBatch = (st) => st.batches.filter((b) => b.id > 0).pop();

export const LESSONS = [
  {
    id: 'pulldown', title: 'Pull-down y ventiladores',
    steps: [
      { text: 'Ingrese 10 pallets de arándano a 15 °C con «INGRESAR PALLETS».', done: (s) => s.st.batches.some((b) => b.n >= 8 && b.T0 >= 12) },
      { text: 'Observe la carga térmica (modo Ingeniería): el producto pasa a ser el mayor aporte y el compresor se satura.', done: (s, ui) => ui.mode !== 'op' && [...loadBreakdown(s.st).items].sort((a, b) => b.W - a.W)[0].key === 'product' },
      { text: 'Suba los ventiladores al 100 %: más flujo, más transferencia al producto… y más consumo.', done: (s) => s.p.fan >= 95 },
      { text: 'Avance (×100 o +10 min) hasta que el núcleo del lote baje de 8 °C. Mire «Pull-down»: tiempo estimado vs. actual.', done: (s) => { const b = lastBatch(s.st); return b && b.Tc !== undefined && b.Tc < 8; } },
      { text: 'Baje los ventiladores al 40 %: el tiempo estimado sube y el consumo de ventiladores baja (∝ velocidad³).', done: (s) => s.p.fan <= 45 },
    ],
  },
  {
    id: 'door', title: 'Puerta y recuperación',
    steps: [
      { text: 'Abra la puerta con «ABRIR PUERTA». Active la capa «Flujo de aire» para ver el intercambio.', done: (s) => s.st.door.cmd },
      { text: 'Déjela abierta 3 min simulados: mire la carga adicional, el mapa térmico junto a la puerta y la humedad.', done: (s) => s.st.door.cmd && s.st.t - s.st.door.openedAt >= 180 },
      { text: 'Cierre la puerta.', done: (s) => !s.st.door.cmd },
      { text: 'Espere la recuperación y lea la tarjeta «Recuperación»: T máxima, tiempo y consumo extra.', done: (s) => s.st.rec.list.length > 0 && !s.st.rec.active },
      { text: 'Active «Cortina de aire», repita la apertura 3 min y compare la nueva recuperación en la línea de eventos.', done: (s, ui, c) => s.p.curtain && s.st.rec.list.length > c.recAtStart },
    ],
  },
  {
    id: 'control', title: 'Control ON/OFF vs PID',
    steps: [
      { text: 'Seleccione control ON/OFF y observe 1 h simulada: la temperatura oscila ±histéresis y el compresor arranca y para.', done: (s, ui, c) => s.p.control === 'onoff' && s.st.t - c.t0 >= 3600 },
      { text: 'Cambie a PID (panel Control) y observe 1 h: la curva se aplana y el compresor modula.', done: (s, ui, c) => s.p.control === 'pid' && s.st.t - c.t0 >= 3600 },
      { text: 'Pase a modo Simulación y abra «Comparar A/B»: ejecute ON/OFF (A) contra PID (B).', done: (s, ui) => ui.abRuns > 0 },
    ],
  },
];

export function createLessons(el, getCtx) {
  let cur = null;
  function menu() {
    el.hidden = false;
    el.innerHTML = `<h4>Laboratorio guiado</h4><p class="muted small">Elija una práctica. Cada paso se marca solo cuando el simulador detecta que lo cumplió.</p>` +
      LESSONS.map((l) => `<button class="wide" data-l="${l.id}" style="margin:4px 0">${l.title}</button>`).join('') +
      `<div class="lb"><button data-x="close">Cerrar</button></div>`;
  }
  function start(id) {
    const { sim } = getCtx();
    cur = { l: LESSONS.find((x) => x.id === id), i: 0, ctx: { t0: sim.st.t, recAtStart: sim.st.rec.list.length } };
    render();
  }
  function render() {
    if (!cur) return;
    const { l, i } = cur;
    el.innerHTML = `<h4>${l.title}</h4><ol>${l.steps.map((s, k) => `<li class="${k < i ? 'done' : k === i ? 'cur' : ''}">${s.text}</li>`).join('')}</ol>` +
      (i >= l.steps.length ? '<p class="better">✓ Práctica completada.</p>' : '') +
      `<div class="lb"><button data-x="skip" ${i >= l.steps.length ? 'disabled' : ''}>Omitir paso</button><button data-x="menu">Prácticas</button><button data-x="close">Salir</button></div>`;
  }
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.l) start(b.dataset.l);
    else if (b.dataset.x === 'close') { cur = null; el.hidden = true; }
    else if (b.dataset.x === 'menu') { cur = null; menu(); }
    else if (b.dataset.x === 'skip' && cur) advance();
  });
  function advance() {
    const { sim } = getCtx();
    cur.i++; cur.ctx.t0 = sim.st.t; cur.ctx.recAtStart = sim.st.rec.list.length; render();
  }
  return {
    toggle() { if (el.hidden) menu(); else { cur = null; el.hidden = true; } },
    tick() {
      if (!cur || cur.i >= cur.l.steps.length) return;
      const { sim, ui } = getCtx();
      if (cur.l.steps[cur.i].done(sim, ui, cur.ctx)) advance();
    },
    reset() { if (cur) { const { sim } = getCtx(); cur.ctx.t0 = sim.st.t; cur.ctx.recAtStart = 0; } },
  };
}
