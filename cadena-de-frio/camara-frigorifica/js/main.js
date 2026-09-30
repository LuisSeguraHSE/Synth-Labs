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
function frame(now) {
  const dtR = Math.min(0.1, (now - last) / 1000); last = now;
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
