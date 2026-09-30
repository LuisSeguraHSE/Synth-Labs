// Arranque y relojes: el reloj de render (requestAnimationFrame) está separado del reloj de simulación
// (paso fijo de 1 s × velocidad). Pausar detiene la física, no la interfaz.
import { createSim } from './sim.js';
import { initUI } from './ui.js';

const app = { sim: null, speed: 1, playing: true, scenario: 'normal' };
const topH = () => document.documentElement.style.setProperty('--top-h', document.querySelector('.top').offsetHeight + 'px');
new ResizeObserver(topH).observe(document.querySelector('.top'));
const ui = initUI(app);

app.load = (scenario, params) => {
  app.scenario = scenario;
  app.sim = createSim({ scenario, params });
  app.scene.build(app.sim.R, app.sim.p, app.sim.st.sensors);
  ui.onLoad();
};
app.load('normal');
window.coldRoom = app; // acceso de depuración desde la consola

let last = performance.now(), acc = 0;
// Presupuesto de rendimiento: si en calidad Alta el equipo no sostiene ~25 FPS, baja a Media (una vez).
const perf = { n: 0, sum: 0, done: false };
function watchPerf(dt) {
  if (perf.done || app.userQuality || document.hidden) return;
  if (++perf.n <= 30) return; // ignora el arranque
  perf.sum += dt;
  if (perf.n >= 150) {
    perf.done = true;
    const fps = (perf.n - 30) / perf.sum;
    if (fps < 25 && (app.quality ?? 'high') === 'high') ui.setQuality('medium', `Ajustada a Media: este equipo dibujaba ${fps.toFixed(0)} FPS en Alta. Puedes volver a Alta en la barra de vista.`);
  }
}
function frame(now) {
  const raw = (now - last) / 1000, dtR = Math.min(0.1, raw); last = now;
  watchPerf(raw);
  if (app.playing) {
    acc += dtR * app.speed;
    let n = 0;
    while (acc >= 1 && n < 3000) { app.sim.step(1); acc -= 1; n++; }
  }
  app.scene.update(app.sim.st, app.sim.p, dtR, app.playing, app.speed);
  ui.refresh(false);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
