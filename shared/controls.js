// Synth-Labs · comportamiento común de controles: pinta el relleno de los sliders (variable CSS --p).
(function () {
  const paint = (el) => {
    const min = +el.min || 0, max = el.max === '' ? 100 : +el.max, v = +el.value;
    el.style.setProperty('--p', ((v - min) / (max - min || 1)) * 100 + '%');
  };
  const paintAll = (root = document) => root.querySelectorAll('input[type=range]').forEach(paint);
  document.addEventListener('input', (e) => { if (e.target.matches && e.target.matches('input[type=range]')) paint(e.target); }, true);
  window.SLControls = { paint, paintAll };
  if (document.readyState !== 'loading') paintAll(); else document.addEventListener('DOMContentLoaded', () => paintAll());
})();
