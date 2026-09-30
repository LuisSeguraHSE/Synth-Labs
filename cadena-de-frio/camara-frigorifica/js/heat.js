// Escala térmica semántica única (mapa 3D, pallets, sensores y leyenda):
// azul = frío · verde = normal · amarillo = caliente · rojo = crítico (≥ límite de alarma).
const STOPS = [
  [-2, [0x1c, 0x5c, 0xab]], // frío
  [-0.5, [0x39, 0x87, 0xe5]],
  [0.5, [0x0c, 0xa3, 0x0c]], // normal
  [0.5, [0x0c, 0xa3, 0x0c]],
  [0.55, [0xfa, 0xb2, 0x19]], // caliente (fracción del margen de alarma)
  [1, [0xd0, 0x3b, 0x3b]],    // crítico
];

// Devuelve [r,g,b] en 0..1 para una temperatura, relativa al setpoint y al margen de alarma.
export function heatRGB(T, sp, off) {
  const d = T - sp;
  let pts;
  if (d <= 0.5) pts = [[-2, STOPS[0][1]], [-0.5, STOPS[1][1]], [0.5, STOPS[2][1]]];
  else { const f = (d - 0.5) / Math.max(0.5, off - 0.5); pts = [[0, STOPS[3][1]], [0.55, STOPS[4][1]], [1, STOPS[5][1]]]; return interp(pts, f); }
  return interp(pts, d);
}

function interp(pts, x) {
  if (x <= pts[0][0]) return pts[0][1].map((v) => v / 255);
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, c0] = pts[i - 1], [x1, c1] = pts[i], t = (x - x0) / (x1 - x0 || 1);
      return c0.map((v, k) => (v + (c1[k] - v) * t) / 255);
    }
  }
  return pts[pts.length - 1][1].map((v) => v / 255);
}

export const heatCSS = (T, sp, off) => { const c = heatRGB(T, sp, off); return `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`; };
export const heatBand = (T, sp, off) => (T >= sp + off ? 'crítico' : T > sp + 1 ? 'caliente' : T >= sp - 1 ? 'normal' : 'frío');
