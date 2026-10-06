// MOTOR VISUAL 3D (Three.js): sala de paneles con entorno exterior (asfalto, demarcación, marquesina, bolardos),
// puerta corrediza con cortina de tiras, evaporador y unidad condensadora detallados con líneas frigoríficas,
// racks selectivos etiquetados, pallets con tarima, cartones, film, esquineros y etiqueta, montacargas, camión,
// seguridad (extintor, EPP, salida, alarma hombre atrapado), mapa térmico por zonas y CORTE TÉRMICO continuo
// (campo interpolado con isotermas). La escena solo LEE el estado del simulador: nunca es la fuente de verdad.
// Geometría repetida con InstancedMesh y piezas estáticas fusionadas por material (pocas draw calls).
// En calidad Media se omite el detalle fino (grupo «hi»), las sombras y el film.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { heatRGB } from './heat.js';
import { SLOT } from './config.js';
import { makeRackMaterials, uprightGeo, basePlateGeo, protectorGeo, braceGeo, beamGeo, deckGeo, frameGuardGeo, loadSignGeo, PAL_H, palletGeo, palletMaterial,
  cartonGeo, cartonMaterial, filmGeo, filmMaterial, palletDressGeo, kraftMaterial, panelMaterial, wallGeo, ceilingGeo, coveGeo, camLockGeo, hangerGeo,
  drainGeo, stripGeo, shellMaterials, floorMaterial } from './models/storage.js';
import { createEvaporator, createCondensingUnit, createSlidingDoor } from './models/equipment.js';
import { createForklift, FORK } from './models/forklift.js';
import { createTruck } from './models/truck.js';
import { createWorker } from './models/person.js';
import { createStackerCrane, createPalletJack, pdStandGeo, PICK } from './models/handling.js';
import { createLogistics, createCrew, LOGI } from './logistics.js';

const N_FLOW = 600, N_DOOR = 140;
const CART = { nx: 2, nz: 3, ny: 6, sx: 0.47, sy: 0.24, sz: 0.38, pitchY: 0.243 };
const CPP = CART.nx * CART.nz * CART.ny; // cartones por pallet
const STACK_H = CART.ny * CART.pitchY;   // altura de la carga sobre la tarima
const SRGB = THREE.SRGBColorSpace;
const PI = Math.PI;

// Cartones: d = 0 expuesto (color = superficie) … 1 interior (color = núcleo)
const CARTONS = [];
for (let l = 0; l < CART.ny; l++) for (let ix = 0; ix < CART.nx; ix++) for (let iz = 0; iz < CART.nz; iz++) {
  CARTONS.push({ x: (ix - 0.5) * 0.49, y: PAL_H + 0.004 + (l + 0.5) * CART.pitchY, z: (iz - 1) * 0.4, d: 0.5 * (iz === 1) + 0.5 * (l > 0 && l < CART.ny - 1) });
}
const hash = (n) => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ======================= Texturas procedurales (canvas, sin archivos externos) =======================
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = makeCanvas(w, h); draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = SRGB; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); t.anisotropy = 8;
  return t;
}
const speckle = (g, w, h, n, light, dark, a) => { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? light : dark},${Math.random() * a})`; const s = 1 + Math.random() * 1.5; g.fillRect(Math.random() * w, Math.random() * h, s, s); } };
const blotch = (g, w, h, n, a) => { for (let i = 0; i < n; i++) { const r = 40 + Math.random() * 120, x = Math.random() * w, y = Math.random() * h, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); } };
const TEX = {
  concrete: (rx, ry, base = '#3a434d') => canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h); blotch(g, w, h, 40, 0.05); speckle(g, w, h, 5000, '230,236,242', '10,14,18', 0.12);
    g.strokeStyle = 'rgba(10,14,18,.35)'; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2); // juntas de losa
  }, [rx, ry]),
  asphalt: (rx, ry) => canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#2a2e33'; g.fillRect(0, 0, w, h); blotch(g, w, h, 30, 0.06); speckle(g, w, h, 16000, '160,165,170', '8,9,11', 0.28);
    g.strokeStyle = 'rgba(8,9,11,.5)'; g.lineWidth = 1.2;
    for (let i = 0; i < 4; i++) { g.beginPath(); let x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); for (let k = 0; k < 14; k++) { x += (Math.random() - 0.5) * 28; y += (Math.random() - 0.5) * 28; g.lineTo(x, y); } g.stroke(); }
  }, [rx, ry]),
  perforated: (ry) => canvasTex(32, 128, (g, w, h) => {
    g.fillStyle = '#6f87a2'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1b2430';
    for (let y = 6; y < h; y += 32) for (const x of [7, 19]) { g.beginPath(); g.roundRect(x, y, 6, 16, 3); g.fill(); }
  }, [1, ry]),
  hazard: (rx) => canvasTex(128, 32, (g, w, h) => {
    g.fillStyle = '#f2b90f'; g.fillRect(0, 0, w, h); g.fillStyle = '#16181b';
    for (let x = -h; x < w + h; x += 32) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 16, h); g.lineTo(x + 16 + h, 0); g.lineTo(x + h, 0); g.fill(); }
  }, [rx, 1]),
  carton: () => canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, h);
    const e = g.createLinearGradient(0, 0, w, 0); e.addColorStop(0, 'rgba(0,0,0,.18)'); e.addColorStop(0.08, 'rgba(0,0,0,0)'); e.addColorStop(0.92, 'rgba(0,0,0,0)'); e.addColorStop(1, 'rgba(0,0,0,.18)'); g.fillStyle = e; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(56, 0, 16, h);                         // cinta
    g.fillStyle = '#ffffff'; g.fillRect(80, 76, 38, 30); g.fillStyle = '#333'; for (let i = 0; i < 5; i++) g.fillRect(84, 80 + i * 5, 30 - i * 4, 2); // etiqueta
    for (let i = 0; i < 9; i++) g.fillRect(84 + i * 3, 100, 1.5, 4);
  }),
  fins: (rx = 4) => canvasTex(256, 64, (g, w, h) => {
    for (let x = 0; x < w; x += 2) { g.fillStyle = x % 4 ? '#8f9baa' : '#c5ced8'; g.fillRect(x, 0, 2, h); }
    g.fillStyle = 'rgba(40,50,60,.55)'; for (let y = 8; y < h; y += 16) g.fillRect(0, y, w, 3);
  }, [rx, 1]),
  armaflex: () => canvasTex(128, 32, (g, w, h) => { // espuma elastomérica negra con cinta en cada unión
    g.fillStyle = '#1a1c1f'; g.fillRect(0, 0, w, h); speckle(g, w, h, 900, '255,255,255', '0,0,0', 0.09);
    g.fillStyle = '#2c3035'; g.fillRect(w - 12, 0, 12, h); g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(w - 12, 0, 2, h);
  }),
  grate: (rx, ry) => canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#15181c'; g.fillRect(0, 0, w, h); g.fillStyle = '#8d97a3';
    for (let y = 2; y < h; y += 8) g.fillRect(0, y, w, 4); g.fillStyle = '#5d6772'; g.fillRect(0, 0, 3, h); g.fillRect(w - 3, 0, 3, h);
  }, [rx, ry]),
  grit: (rx) => canvasTex(128, 32, (g, w, h) => {
    g.fillStyle = '#2b2e32'; g.fillRect(0, 0, w, h); speckle(g, w, h, 1500, '200,205,210', '0,0,0', 0.5);
    g.fillStyle = '#f2b90f'; g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3);
  }, [rx, 1]),
  film: () => canvasTex(128, 128, (g, w, h) => { // film estirable: vetas diagonales y bandas de solape
    g.fillStyle = '#f4f8fc'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '150,170,190'},${0.25 + Math.random() * 0.35})`; g.lineWidth = 1 + Math.random() * 3; const y = Math.random() * h * 1.5; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y - w * 0.35); g.stroke(); }
    g.fillStyle = 'rgba(190,205,220,.35)'; for (let y = 10; y < h; y += 42) g.fillRect(0, y, w, 6);
  }),
  glow: () => canvasTex(64, 64, (g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.4, 'rgba(255,255,255,.45)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); }),
  wire: (rx, ry) => canvasTex(64, 64, (g, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = '#c3ccd6'; g.lineWidth = 2; for (let i = 0; i <= w; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); } }, [rx, ry]),
};

// Atlas de señalética y etiquetas: un solo material para decenas de carteles (1 draw call por grupo).
function txt(g, s, x, y, size, color = '#fff', weight = 'bold', align = 'center') { g.font = `${weight} ${size}px sans-serif`; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y); }
function barcode(g, x, y, w, h, seed) { g.fillStyle = '#111'; let cx = x; let i = 0; while (cx < x + w) { const bw = 1 + Math.floor(hash(seed + i++) * 3); if (i % 2) g.fillRect(cx, y, bw, h); cx += bw + 1; } }
function buildAtlas(ny, nB) {
  const cells = [
    { key: 'truck', w: 512, h: 128, draw: (g, w, h) => {
      g.fillStyle = '#f4f6f8'; g.fillRect(0, 0, w, h); g.fillStyle = '#1d4f91'; g.fillRect(0, h - 22, w, 22); g.fillStyle = '#3987e5'; g.fillRect(0, h - 28, w, 5);
      g.strokeStyle = '#1d4f91'; g.lineWidth = 5; g.lineCap = 'round';
      for (let k = 0; k < 3; k++) { const a = (k * PI) / 3; g.beginPath(); g.moveTo(58 - 34 * Math.cos(a), 52 - 34 * Math.sin(a)); g.lineTo(58 + 34 * Math.cos(a), 52 + 34 * Math.sin(a)); g.stroke(); }
      txt(g, 'TRANSPORTE REFRIGERADO', 300, 40, 34, '#1d4f91'); txt(g, 'Cadena de frío · de -25 a +15 °C', 300, 78, 20, '#33475b', '600');
    } },
    { key: 'ppe', w: 288, h: 192, draw: (g, w, h) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#1d5fb0'; g.fillRect(0, 0, w, 40); txt(g, 'USO OBLIGATORIO DE EPP', w / 2, 21, 17);
      const ic = [['CASCO', (x, y) => { g.beginPath(); g.arc(x, y + 6, 18, PI, 0); g.fill(); g.fillRect(x - 24, y + 4, 48, 6); }],
        ['GUANTES', (x, y) => { g.beginPath(); g.roundRect(x - 11, y - 16, 22, 34, 6); g.fill(); g.beginPath(); g.roundRect(x - 22, y - 2, 13, 8, 4); g.fill(); }],
        ['CHAQUETA', (x, y) => { g.beginPath(); g.moveTo(x - 14, y - 18); g.lineTo(x + 14, y - 18); g.lineTo(x + 24, y + 18); g.lineTo(x - 24, y + 18); g.fill(); }]];
      ic.forEach(([n, f], i) => { const x = 52 + i * 92, y = 98; g.fillStyle = '#1d5fb0'; g.beginPath(); g.arc(x, y, 36, 0, 2 * PI); g.fill(); g.fillStyle = '#fff'; f(x, y); txt(g, n, x, 158, 13, '#1d5fb0'); });
      txt(g, 'Cámara a baja temperatura', w / 2, 180, 12, '#33475b', '600');
    } },
    { key: 'room', w: 320, h: 96, draw: (g, w, h) => { g.fillStyle = '#1d4f91'; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeRect(6, 6, w - 12, h - 12); txt(g, 'CÁMARA 01', w / 2, 38, 36); txt(g, 'CONSERVACIÓN · FRUTA FRESCA', w / 2, 72, 17, '#cfe0f5', '600'); } },
    { key: 'panel', w: 160, h: 192, draw: (g, w, h) => {
      g.fillStyle = '#c9ced4'; g.fillRect(0, 0, w, h); g.strokeStyle = '#8b939c'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
      g.fillStyle = '#16181b'; g.fillRect(20, 16, 120, 22); txt(g, 'TABLERO CU-01', 80, 28, 13);
      g.fillStyle = '#f2b90f'; g.beginPath(); g.moveTo(80, 52); g.lineTo(104, 92); g.lineTo(56, 92); g.closePath(); g.fill(); g.strokeStyle = '#111'; g.lineWidth = 3; g.beginPath(); g.moveTo(84, 60); g.lineTo(74, 76); g.lineTo(86, 76); g.lineTo(76, 88); g.stroke();
      for (const [x, c] of [[50, '#2a3a2a'], [80, '#3a2a1a'], [110, '#3a1a1a']]) { g.fillStyle = '#333'; g.beginPath(); g.arc(x, 120, 11, 0, 2 * PI); g.fill(); g.fillStyle = c; g.beginPath(); g.arc(x, 120, 7, 0, 2 * PI); g.fill(); }
      txt(g, 'MARCHA  ALARMA  FALLA', 80, 142, 9, '#222', '600'); g.fillStyle = '#5b6470'; g.fillRect(132, 150, 10, 30); txt(g, '400 V', 50, 170, 12, '#222');
    } },
    { key: 'pallet', w: 128, h: 176, draw: (g, w, h) => {
      g.fillStyle = '#fbfbf8'; g.fillRect(0, 0, w, h); g.fillStyle = '#16181b'; g.fillRect(0, 0, w, 26); txt(g, 'PALLET', w / 2, 14, 15);
      txt(g, 'ARÁNDANO', w / 2, 44, 15, '#111'); txt(g, 'LOTE 26-0412', w / 2, 64, 12, '#333', '600'); txt(g, 'CONSERVAR 0 a 2 °C', w / 2, 82, 11, '#1d4f91');
      barcode(g, 12, 98, 104, 46, 7); txt(g, '7 750123 004127', w / 2, 156, 11, '#111', '600');
    } },
    { key: 'ext', w: 128, h: 160, draw: (g, w, h) => {
      g.fillStyle = '#c62828'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff';
      g.beginPath(); g.roundRect(46, 40, 36, 80, 10); g.fill(); g.fillRect(56, 26, 16, 16); g.fillRect(70, 28, 26, 7); g.beginPath(); g.moveTo(96, 28); g.lineTo(104, 50); g.lineTo(98, 52); g.fill();
      txt(g, 'EXTINTOR', w / 2, 140, 18);
    } },
    { key: 'fork', w: 160, h: 144, draw: (g, w, h) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#16181b'; g.beginPath(); g.moveTo(80, 6); g.lineTo(150, 112); g.lineTo(10, 112); g.closePath(); g.fill();
      g.fillStyle = '#f2b90f'; g.beginPath(); g.moveTo(80, 18); g.lineTo(138, 106); g.lineTo(22, 106); g.closePath(); g.fill();
      g.fillStyle = '#16181b'; g.fillRect(56, 72, 34, 18); g.fillRect(62, 56, 4, 18); g.fillRect(90, 50, 4, 42); g.fillRect(94, 86, 18, 3); g.beginPath(); g.arc(62, 94, 6, 0, 2 * PI); g.arc(84, 94, 6, 0, 2 * PI); g.fill();
      txt(g, 'TRÁNSITO DE MONTACARGAS', 80, 128, 11, '#111');
    } },
    { key: 'trap', w: 192, h: 96, draw: (g, w, h) => { g.fillStyle = '#f2b90f'; g.fillRect(0, 0, w, h); g.strokeStyle = '#16181b'; g.lineWidth = 4; g.strokeRect(4, 4, w - 8, h - 8); txt(g, 'ALARMA', w / 2, 26, 18, '#111'); txt(g, 'HOMBRE ATRAPADO', w / 2, 50, 17, '#111'); txt(g, 'Pulse en caso de emergencia', w / 2, 74, 12, '#222', '600'); } },
    { key: 'cold', w: 192, h: 96, draw: (g, w, h) => {
      g.fillStyle = '#16181b'; g.fillRect(0, 0, w, h); g.fillStyle = '#f2b90f'; g.fillRect(8, 8, w - 16, h - 16);
      txt(g, 'PELIGRO', w / 2, 34, 24, '#111'); txt(g, 'BAJA TEMPERATURA', w / 2, 64, 17, '#111');
    } },
    { key: 'release', w: 192, h: 80, draw: (g, w, h) => { g.fillStyle = '#0a7a2a'; g.fillRect(0, 0, w, h); txt(g, 'APERTURA DE', w / 2, 24, 16); txt(g, 'EMERGENCIA', w / 2, 46, 16); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(w / 2 - 20, 60); g.lineTo(w / 2 + 12, 60); g.lineTo(w / 2 + 12, 54); g.lineTo(w / 2 + 26, 66); g.lineTo(w / 2 + 12, 78); g.lineTo(w / 2 + 12, 72); g.lineTo(w / 2 - 20, 72); g.fill(); } },
    { key: 'evPlate', w: 192, h: 64, draw: (g, w, h) => { g.fillStyle = '#d5dbe1'; g.fillRect(0, 0, w, h); g.strokeStyle = '#7b848e'; g.lineWidth = 3; g.strokeRect(2, 2, w - 4, h - 4); txt(g, 'EV-01 · EVAPORADOR', w / 2, 22, 17, '#16181b'); txt(g, 'R-404A · 3 × Ø500 mm · 230 V', w / 2, 46, 12, '#333', '600'); } },
    { key: 'cuPlate', w: 192, h: 64, draw: (g, w, h) => { g.fillStyle = '#d5dbe1'; g.fillRect(0, 0, w, h); g.strokeStyle = '#7b848e'; g.lineWidth = 3; g.strokeRect(2, 2, w - 4, h - 4); txt(g, 'CU-01 · CONDENSADORA', w / 2, 22, 16, '#16181b'); txt(g, 'R-404A · 30 kW · 400 V', w / 2, 46, 12, '#333', '600'); } },
    { key: 'louver', w: 128, h: 128, draw: (g, w, h) => { g.fillStyle = '#b9c1ca'; g.fillRect(0, 0, w, h); for (let y = 6; y < h - 4; y += 12) { const gr = g.createLinearGradient(0, y, 0, y + 9); gr.addColorStop(0, '#2a3038'); gr.addColorStop(1, '#d6dce2'); g.fillStyle = gr; g.fillRect(8, y, w - 16, 9); } } },
    { key: 'pull', w: 96, h: 112, draw: (g, w, h) => { g.fillStyle = '#c62828'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.beginPath(); g.roundRect(14, 30, 68, 50, 6); g.fill(); g.fillStyle = '#c62828'; g.fillRect(24, 52, 48, 8); txt(g, 'FUEGO', w / 2, 16, 17); txt(g, 'TIRE AQUÍ', w / 2, 96, 13); } },
    { key: 'maxLoad', w: 128, h: 96, draw: (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.strokeStyle = '#1d5fb0'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6); txt(g, 'CARGA MÁX.', w / 2, 24, 14, '#1d5fb0'); txt(g, '1000 kg', w / 2, 52, 24, '#111'); txt(g, 'POR NIVEL', w / 2, 78, 12, '#1d5fb0'); } },
    { key: 'plate', w: 128, h: 40, draw: (g, w, h) => { g.fillStyle = '#fafafa'; g.fillRect(0, 0, w, h); g.strokeStyle = '#111'; g.lineWidth = 3; g.strokeRect(2, 2, w - 4, h - 4); txt(g, 'CF·2026', w / 2, h / 2 + 1, 24, '#111'); } },
  ];
  for (let j = 0; j < ny; j++) for (let b = 0; b < nB; b++) {
    cells.push({ key: `r${j}-${b}`, w: 128, h: 48, draw: (g, w, h) => {
      g.fillStyle = '#fdfdfb'; g.fillRect(0, 0, w, h); g.fillStyle = '#1d5fb0'; g.fillRect(0, 0, 8, h);
      txt(g, `R${j + 1}-${String(b + 1).padStart(2, '0')}`, 14, 17, 21, '#111', 'bold', 'left'); txt(g, 'A ↓  B ↑', 118, 17, 11, '#333', '600', 'right');
      barcode(g, 14, 32, 100, 12, j * 100 + b);
    } });
  }
  const AW = 2048, AH = 1024, c = makeCanvas(AW, AH), g = c.getContext('2d'), uv = {};
  let x = 0, y = 0, rowH = 0;
  for (const cell of cells) {
    if (x + cell.w + 4 > AW) { x = 0; y += rowH + 4; rowH = 0; }
    g.save(); g.translate(x + 2, y + 2); g.beginPath(); g.rect(0, 0, cell.w, cell.h); g.clip(); cell.draw(g, cell.w, cell.h); g.restore();
    uv[cell.key] = [(x + 2.5) / AW, 1 - (y + 1.5 + cell.h) / AH, (x + 1.5 + cell.w) / AW, 1 - (y + 2.5) / AH];
    x += cell.w + 4; rowH = Math.max(rowH, cell.h);
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = SRGB; tex.anisotropy = 8;
  return { tex, uv };
}

// ======================= Geometría: fusión por material, tubos con codos =======================
const GEO = { box: new THREE.BoxGeometry(1, 1, 1), cyl: {}, sph: new THREE.SphereGeometry(1, 14, 10), hemi: new THREE.SphereGeometry(1, 14, 7, 0, PI * 2, 0, PI / 2) };
const cylG = (seg) => (GEO.cyl[seg] ||= new THREE.CylinderGeometry(1, 1, 1, seg));
const UPV = new THREE.Vector3(0, 1, 0), _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function mat4(pos, rot, scl) {
  _e.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0);
  return new THREE.Matrix4().compose(_p.set(pos ? pos[0] : 0, pos ? pos[1] : 0, pos ? pos[2] : 0), _q.setFromEuler(_e), _s.set(scl ? scl[0] : 1, scl ? scl[1] : 1, scl ? scl[2] : 1));
}
function mergeGeos(list) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += c; g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}
// Acumula piezas estáticas y las fusiona en una malla por material.
function bucket(pick) {
  const map = new Map();
  const B = {
    add(mat, geo, pos, rot, scl, m0) {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      g.applyMatrix4(m0 ? (pos || rot || scl ? m0.clone().multiply(mat4(pos, rot, scl)) : m0) : mat4(pos, rot, scl));
      if (!map.has(mat)) map.set(mat, []);
      map.get(mat).push(g); return B;
    },
    box(mat, sx, sy, sz, pos, rot) { return B.add(mat, GEO.box, pos, rot, [sx, sy, sz]); },
    cyl(mat, r, h, pos, rot, seg = 12) { return B.add(mat, cylG(seg), pos, rot, [r, h, r]); },
    sph(mat, r, pos, sy = 1) { return B.add(mat, GEO.sph, pos, null, [r, r * sy, r]); },
    rod(mat, a, b, r, seg = 8) { // cilindro entre dos puntos
      const va = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(va), len = d.length();
      if (len < 1e-5) return B;
      const m = new THREE.Matrix4().compose(va.addScaledVector(d, 0.5), new THREE.Quaternion().setFromUnitVectors(UPV, d.normalize()), new THREE.Vector3(r, len, r));
      return B.add(mat, cylG(seg), null, null, null, m);
    },
    flush(parent, { cast = false, receive = true } = {}) {
      const out = [];
      for (const [mat, list] of map) {
        const m = new THREE.Mesh(mergeGeos(list), mat); m.castShadow = cast; m.receiveShadow = receive;
        if (pick) m.userData.pick = pick; parent.add(m); out.push(m);
      }
      map.clear(); return out;
    },
  };
  return B;
}
function quadGeo(w, h, r) {
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, r[0] + uv.getX(i) * (r[2] - r[0]), r[1] + uv.getY(i) * (r[3] - r[1]));
  return g;
}
// Recorrido de tubería: polilínea con codos redondeados (radio rb) → TubeGeometry. uvPerM repite la textura por metro.
function tubeGeo(pts, r, rb = 0.12, uvPerM = 0) {
  const P = pts.map((a) => new THREE.Vector3(...a)), path = new THREE.CurvePath();
  let cur = P[0].clone();
  for (let i = 1; i < P.length; i++) {
    const a = P[i];
    if (i === P.length - 1) { if (cur.distanceTo(a) > 1e-4) path.add(new THREE.LineCurve3(cur, a.clone())); break; }
    const b = P[i + 1], rr = Math.min(rb, a.distanceTo(P[i - 1]) * 0.45, b.distanceTo(a) * 0.45);
    const p1 = a.clone().add(P[i - 1].clone().sub(a).setLength(rr)), p2 = a.clone().add(b.clone().sub(a).setLength(rr));
    if (cur.distanceTo(p1) > 1e-4) path.add(new THREE.LineCurve3(cur, p1));
    path.add(new THREE.QuadraticBezierCurve3(p1, a.clone(), p2));
    cur = p2;
  }
  const len = path.getLength(), g = new THREE.TubeGeometry(path, Math.max(24, Math.round(len * 16)), r, 10, false);
  if (uvPerM) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len * uvPerM); }
  return g;
}

export function createScene(container, handlers) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1016);
  scene.fog = new THREE.Fog(0x0b1016, 45, 110);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 1.5; controls.maxDistance = 70;
  scene.add(new THREE.HemisphereLight(0xdde8ff, 0x1a2230, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-10, 22, 14); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  // Oclusión ambiental (GTAO) solo en calidad Alta: contacto entre piezas, rincones y bajo los pallets.
  const composer = new EffectComposer(renderer), gtao = new GTAOPass(scene, camera, 2, 2);
  gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  gtao.blendIntensity = 0.85;
  // El pase de normales/profundidad del GTAO no debe ver sprites ni velos transparentes (vaho, reverberación, film, cortes):
  // si no, se dibujarían como sólidos oscuros.
  gtao.overrideVisibility = function () {
    const cache = this._visibilityCache;
    this.scene.traverse((o) => { cache.set(o, o.visible); const m = o.material; if (o.isPoints || o.isLine || o.isSprite || (m && !Array.isArray(m) && m.transparent && m.depthWrite === false)) o.visible = false; });
  };
  composer.addPass(new RenderPass(scene, camera)); composer.addPass(gtao); composer.addPass(new OutputPass());
  let useAO = true;
  const labels = document.createElement('div'); labels.className = 'labels3d'; container.appendChild(labels);
  const S = {
    layers: { heat: false, flow: false, sensors: false, pallets: true, slice: true }, view: '3d', level: 1, sel: null, tween: null, fanAngle: 0, condAngle: 0, t: 0, quality: 'high',
    slice: { mode: 'h', h: null, y: null }, lastSt: null, lastP: null,
  };
  let W3 = null;
  const tmpM = new THREE.Matrix4(), tmpM2 = new THREE.Matrix4(), tmpC = new THREE.Color(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), IDQ = new THREE.Quaternion(), UNIT = new THREE.BoxGeometry(1, 1, 1);
  const ZAX = new THREE.Vector3(0, 0, 1), YAX = new THREE.Vector3(0, 1, 0);

  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1, ...extra });
  const glowTex = TEX.glow();
  const M = {
    steel: std(0x9aa7b8, { metalness: 0.55, roughness: 0.35 }), galv: std(0x9aa6b3, { metalness: 0.7, roughness: 0.35 }),
    beam: std(0x2f5277, { metalness: 0.45, roughness: 0.45 }), dark: std(0x1f262e, { roughness: 0.8 }), rubber: std(0x121417, { roughness: 0.95 }),
    white: std(0xdfe6ee, { metalness: 0.25, roughness: 0.4 }), wood: std(0xa57a4c, { roughness: 0.9 }), copper: std(0xb87333, { metalness: 0.85, roughness: 0.3 }),
    fork: std(0xd1a21c, { metalness: 0.3, roughness: 0.5 }), glass: new THREE.MeshStandardMaterial({ color: 0x9fb3c8, transparent: true, opacity: 0.35, roughness: 0.1 }),
    red: std(0xc62828, { roughness: 0.45, metalness: 0.2 }), yellow: std(0xf2b90f, { roughness: 0.55 }), brass: std(0xc9a227, { metalness: 0.8, roughness: 0.3 }),
    grey: std(0x5b6470, { metalness: 0.3, roughness: 0.55 }), panel: std(0xc9d1d9, { metalness: 0.3, roughness: 0.45 }), pvc: std(0xe9eef3, { roughness: 0.5 }),
    kraft: std(0xb08a5a, { roughness: 0.95 }), blue: std(0x1e4f8f, { roughness: 0.8 }), lightConc: std(0x8b929a, { roughness: 0.95 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf4ff, emissiveIntensity: 1.6 }),
    redLamp: new THREE.MeshBasicMaterial({ color: 0xff2a2a, toneMapped: false }), amberLamp: new THREE.MeshBasicMaterial({ color: 0xffa31a, toneMapped: false }),
    whiteLamp: new THREE.MeshBasicMaterial({ color: 0xfff6dc, toneMapped: false }), greenLamp: new THREE.MeshBasicMaterial({ color: 0x35ff7a, toneMapped: false }),
    heater: std(0x9a3b1f, { roughness: 0.6 }), tape: std(0xe06a1b, { roughness: 0.6 }),
    armaflex: std(0xffffff, { map: TEX.armaflex(), roughness: 0.9 }),
  };
  const mesh = (geo, mat, pos, parent, pick, shadow = true) => {
    const m = new THREE.Mesh(geo, mat); if (pos) m.position.set(pos[0], pos[1], pos[2]);
    m.castShadow = shadow; m.receiveShadow = shadow; if (pick) m.userData.pick = pick; parent.add(m); return m;
  };
  const box = (sx, sy, sz, mat, pos, parent, pick, shadow) => mesh(new THREE.BoxGeometry(sx, sy, sz), mat, pos, parent, pick, shadow);
  function inst(mat, items, parent, shadow = true, geo = UNIT) {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
    items.forEach((it, i) => { tmpM.compose(tmpV.set(it[0], it[1], it[2]), it.q || IDQ, tmpS.set(it[3], it[4], it[5])); im.setMatrixAt(i, tmpM); });
    im.count = items.length; im.castShadow = shadow; im.receiveShadow = shadow; parent.add(im); return im;
  }
  const lineSet = (segs, color, opacity, parent) => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity })); parent.add(l); return l;
  };
  const qAxis = (ax, a) => new THREE.Quaternion().setFromAxisAngle(ax, a);

  function disposeGroup(g) {
    const shared = Object.values(M);
    g.traverse((o) => {
      if (o.geometry && o.geometry !== UNIT) o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m && !shared.includes(m)) { if (m.map && m.map !== glowTex) m.map.dispose(); m.dispose(); } });
    });
  }

  // ======================= Construcción =======================
  function build(R, p, sensors) {
    if (W3) { scene.remove(W3.group); disposeGroup(W3.group); labels.innerHTML = ''; }
    const group = new THREE.Group(); scene.add(group);
    const L = p.L, W = p.W, H = p.H, X = (x) => x - L / 2, Z = (y) => y - W / 2;
    const o = { group, R, p, X, Z, walls: { front: [], back: [], left: [], right: [], ceiling: [] }, pickStatic: [], hiList: [] };
    const dw = p.doorW, dh = Math.min(p.doorH, H - 0.4), side = (W - dw) / 2;
    const ew = Math.min(W * 0.62, 6); o.ew = ew; o.dw = dw; o.dh = dh;
    const ext = Math.max(L, W) * 0.75 + 2;
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, far: 90 }); sun.shadow.camera.updateProjectionMatrix();
    // Grupos: «hi» = solo calidad Alta; listas de pared/techo para ocultar según la vista
    const sub = (parent, list) => { const g = new THREE.Group(); parent.add(g); if (list) list.push(g); return g; };
    const hi = sub(group); o.hi = hi;
    const ceil = sub(group, o.walls.ceiling), hiCeil = sub(hi, o.walls.ceiling), right = sub(group, o.walls.right), hiRight = sub(hi, o.walls.right);
    // Disposición de racks (se usa también en el atlas y el corte térmico)
    // Bastidor de fondo = palletD − 0,2 m: el pallet apoya sobre ambos largueros (vuelo ≈ 16 mm); los centros de las
    // posiciones del simulador no cambian. Larguero inferior con cara superior a h = 0,15 m (nivel 0 de la simulación).
    const qs = [...new Set(R.slots.map((s) => s.x))].sort((a, b) => a - b), pitch = qs.length > 1 ? qs[1] - qs[0] : SLOT.pitch;
    const x0 = qs[0] - pitch / 2, nB = qs.length, depth = SLOT.palletD - 0.2, hU = Math.min(H - 0.9, R.dz * (R.nz - 1) + 0.15 + SLOT.palletH + 0.3);
    const levels = []; for (let k = 0; k < R.nz; k++) levels.push(k * R.dz + 0.15);
    o.rackLayout = { x0, nB, pitch, depth: SLOT.rackDepth };
    const A = buildAtlas(R.ny, nB), atlasMat = std(0xffffff, { map: A.tex, roughness: 0.55 });
    const sign = (B, key, w, h, pos, rot) => B.add(atlasMat, quadGeo(w, h, A.uv[key]), pos, rot);
    const FX = [0, PI / 2, 0], FNX = [0, -PI / 2, 0], FZ = [0, 0, 0], FNZ = [0, PI, 0]; // orientación de carteles (+x, −x, +z, −z)

    // ---- Entorno exterior: patio de asfalto (cubre la maniobra del camión), losa de muelle, demarcación, veredas
    const WT = 0.15, xo = X(0) - WT, xb = X(L) + WT;                    // espesor del panel y caras exteriores
    const XS = (x) => X(x);                                              // x' (desde la cara interior del muro de la puerta) → escena
    const gx0 = X(0) - 40, gx1 = X(L) + 9, gz = 31, GW = gx1 - gx0, GD = 2 * gz;
    const ground = mesh(new THREE.PlaneGeometry(GW, GD), std(0xffffff, { map: TEX.asphalt(GW / 6, GD / 6), roughness: 0.95 }), null, group, null);
    ground.rotation.x = -PI / 2; ground.position.set((gx0 + gx1) / 2, -0.012, 0); ground.castShadow = false;
    const apron = mesh(new THREE.PlaneGeometry(8.4, W + 2.4), std(0xffffff, { map: TEX.concrete(2, 2.5, '#6a7179'), roughness: 0.9 }), null, group, null);
    apron.rotation.x = -PI / 2; apron.position.set(xo - 4.2, -0.004, 0); apron.castShadow = false;
    {
      const cw = 2048, ch = Math.round((cw * GD) / GW), c = makeCanvas(cw, ch), g = c.getContext('2d'), k = cw / GW;
      const U = (x) => (x - gx0) * k, V = (z) => (z + gz) * k;
      const rect = (xa, za, xb2, zb, col) => { g.fillStyle = col; g.fillRect(U(Math.min(xa, xb2)), V(Math.min(za, zb)), Math.abs(xb2 - xa) * k, Math.abs(zb - za) * k); };
      const W_ = 'rgba(236,240,244,.92)', Y_ = 'rgba(242,185,15,.92)', G_ = 'rgba(40,150,80,.55)';
      const hatch = (x0, z0, x1, z1, col, step = 0.35) => { g.save(); g.beginPath(); g.rect(U(x0), V(z0), (x1 - x0) * k, (z1 - z0) * k); g.clip(); g.strokeStyle = col; g.lineWidth = 0.1 * k; for (let d = -(z1 - z0) - 1; d < x1 - x0 + 1; d += step) { g.beginPath(); g.moveTo(U(x0 + d), V(z0)); g.lineTo(U(x0 + d + (z1 - z0)), V(z1)); g.stroke(); } g.restore(); g.strokeStyle = col; g.strokeRect(U(x0), V(z0), (x1 - x0) * k, (z1 - z0) * k); };
      const text = (s, x, z, size, col, rot = 0) => { g.save(); g.translate(U(x), V(z)); g.rotate(rot); g.font = `bold ${size * k}px sans-serif`; g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, 0, 0); g.restore(); };
      const dock = XS(LOGI.DOCK);
      // calle de acceso (eje discontinuo y bordes) y bahía de atraque con línea de detención
      const xr = dock - 11 - 1.6; for (let z = -gz; z < gz; z += 3) rect(xr - 0.06, z, xr + 0.06, z + 1.6, W_);
      for (const x of [xr - 4.2, xr + 4.2]) rect(x - 0.06, -gz, x + 0.06, gz, W_);
      for (const z of [-1.75, 1.75]) rect(dock - 10, z - 0.06, dock, z + 0.06, W_);
      rect(dock - 0.06, -1.75, dock + 0.18, 1.75, Y_); text('ALTO', dock - 0.9, 0, 0.55, W_, -PI / 2);
      // zona de la plataforma elevadora (achurada) y carril del montacargas hasta la puerta
      hatch(dock + 0.1, -1.35, dock + 2.15, 1.35, Y_);
      for (let x = dock + 2.4; x < xo - 0.3; x += 0.9) for (const z of [-1.0, 1.0]) rect(x, z - 0.05, x + 0.5, z + 0.05, Y_);
      // franja peatonal (+z) y estacionamiento/carga del montacargas (−z)
      rect(dock + 0.6, 2.35, xo - 0.2, 2.45, W_); rect(dock + 0.6, 4.3, xo - 0.2, 4.4, W_);
      for (let x = dock + 0.8; x < xo - 0.4; x += 0.8) rect(x, 2.6, x + 0.4, 4.15, G_);
      const qx = XS(LOGI.XE - LOGI.RT); g.lineWidth = 0.1 * k; g.strokeStyle = Y_; g.strokeRect(U(qx - 0.75), V(-5.35), 1.5 * k, 3.4 * k); text('CARGA', qx, -4.9, 0.32, Y_);
      // estación P&D y umbral de la puerta (dentro de la cámara se dibuja en el piso propio)
      hatch(XS(L) + 0.5, -2.2 - 0.95, XS(L) + 2.6, -2.2 + 0.95, Y_);                     // frente a la unidad condensadora
      for (let x = X(0) + 0.5; x <= Math.min(X(L) - 0.5, X(0) + 13); x += 2.5) rect(x - 0.05, W / 2 + 2.6, x + 0.05, W / 2 + 7.4, W_); // estacionamientos
      rect(X(0) + 0.5, W / 2 + 2.55, Math.min(X(L) - 0.5, X(0) + 13), W / 2 + 2.65, W_);
      const t = new THREE.CanvasTexture(c); t.colorSpace = SRGB; t.anisotropy = 8;
      const mk = mesh(new THREE.PlaneGeometry(GW, GD), new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }), null, group, null, false);
      mk.rotation.x = -PI / 2; mk.position.set((gx0 + gx1) / 2, 0.003, 0); mk.receiveShadow = true;
    }
    // Vereda perimetral, cantoneras y remate superior de la envolvente (exterior, caras exteriores del panel)
    {
      const b = bucket(), br = bucket(), trim = std(0xe4e9ef, { metalness: 0.35, roughness: 0.45 });
      b.box(M.lightConc, 0.3, 0.12, W + 2 * WT + 0.6, [xb + 0.15, 0.06, 0]).box(M.lightConc, L + 2 * WT, 0.12, 0.3, [0, 0.06, Z(0) - WT - 0.15]);
      br.box(M.lightConc, L + 2 * WT, 0.12, 0.3, [0, 0.06, Z(W) + WT + 0.15]);
      for (const s of [-1, 1]) b.box(M.lightConc, 0.3, 0.12, side - 0.3 + WT, [xo - 0.15, 0.06, s * (dw / 2 + 0.3 + (side - 0.3 + WT) / 2)]);
      for (const [sx, xx] of [[-1, xo], [1, xb]]) for (const [sz, zz] of [[-1, Z(0) - WT], [1, Z(W) + WT]]) {
        const B = sz > 0 ? br : b;
        B.box(trim, 0.14, H + 0.08, 0.012, [xx - sx * 0.06, H / 2 + 0.04, zz + sz * 0.006]).box(trim, 0.012, H + 0.08, 0.14, [xx + sx * 0.006, H / 2 + 0.04, zz - sz * 0.06]);
      }
      b.box(trim, L + 2 * WT + 0.1, 0.08, WT + 0.1, [0, H + 0.04, Z(0) - WT / 2]).box(trim, WT + 0.1, 0.08, W + 2 * WT + 0.1, [xo + WT / 2, H + 0.04, 0]).box(trim, WT + 0.1, 0.08, W + 2 * WT + 0.1, [xb - WT / 2, H + 0.04, 0]);
      br.box(trim, L + 2 * WT + 0.1, 0.08, WT + 0.1, [0, H + 0.04, Z(W) + WT / 2]);
      b.flush(group, { cast: true }); br.flush(right, { cast: true });
    }

    // ---- Piso epoxi, demarcación interior, sumideros, bandas antideslizantes
    const SH = shellMaterials();
    const floor = mesh(new THREE.PlaneGeometry(L, W), floorMaterial(L, W), null, group, null);
    floor.rotation.x = -PI / 2; floor.position.y = 0.002; floor.castShadow = false;
    {
      const b = bucket();
      for (let j = 0; j < R.ny - 1; j++) for (const s of [-1, 1]) { const z = Z((j + 1) * R.dy) + s * 0.76; b.add(SH.paintWhite, stripGeo(L - SLOT.lane - 0.6, 0.06), [X((SLOT.lane + L) / 2 - 0.1), 0.001, z]); }
      // estación P&D: recuadro amarillo y banda de seguridad en el umbral
      for (const [w, d, x, z] of [[1.5, 0.08, LOGI.PD, -0.8], [1.5, 0.08, LOGI.PD, 0.8], [0.08, 1.6, LOGI.PD - 0.75, 0], [0.08, 1.6, LOGI.PD + 0.75, 0]]) b.add(SH.paintYellow, stripGeo(w, d), [X(x), 0.001, z]);
      for (const x of [0.08, 0.32]) b.add(SH.antiSlip, stripGeo(dw - 0.3, 0.14), [X(x), 0.001, 0], [0, PI / 2, 0]);
      for (const x of [-0.45, -0.75]) b.add(SH.antiSlip, stripGeo(dw - 0.3, 0.14), [xo + x + WT, 0.0, 0], [0, PI / 2, 0]);
      b.flush(hi);
      for (const z of [-0.6, 0.6]) { const m = new THREE.Mesh(drainGeo(0.3), SH.steel); m.position.set(X(L - 0.65), 0.002, z); m.receiveShadow = true; hi.add(m); }
    }

    // ---- Envolvente: panel sándwich (cara interior opaca, vista de «casa de muñecas»: la cara que mira a la cámara se
    // descarta por backface culling) + piel exterior translúcida con juntas, zócalo sanitario, cam-locks y colgadores
    const PM = panelMaterial();
    const wall = (w, h, pos, rotY, list, parent = group) => { const m = new THREE.Mesh(wallGeo(w, h), PM); m.position.set(...pos); m.rotation.y = rotY; m.receiveShadow = true; m.castShadow = false; parent.add(m); list.push(m); return m; };
    wall(L, H, [0, 0, Z(0)], 0, o.walls.left); wall(L, H, [0, 0, Z(W)], PI, o.walls.right); wall(W, H, [X(L), 0, 0], -PI / 2, o.walls.back);
    for (const s of [-1, 1]) wall(side, H, [X(0), 0, s * (dw / 2 + side / 2)], PI / 2, o.walls.front);
    wall(dw, H - dh, [X(0), dh, 0], PI / 2, o.walls.front);
    { const c = new THREE.Mesh(ceilingGeo(L, W), PM); c.position.y = H; c.receiveShadow = true; group.add(c); o.walls.ceiling.push(c); }
    const wm = () => new THREE.MeshStandardMaterial({ color: 0xb8c7d6, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false, roughness: 0.3 });
    const plane = (w, h, pos, rotY, rotX, list) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wm()); m.position.copy(pos); m.rotation.set(rotX || 0, rotY || 0, 0); group.add(m); list.push(m); return m; };
    plane(W + 2 * WT, H, new THREE.Vector3(xb, H / 2, 0), PI / 2, 0, o.walls.back);
    plane(L + 2 * WT, H, new THREE.Vector3(0, H / 2, Z(0) - WT), 0, 0, o.walls.left);
    plane(L + 2 * WT, H, new THREE.Vector3(0, H / 2, Z(W) + WT), 0, 0, o.walls.right);
    plane(L + 2 * WT, W + 2 * WT, new THREE.Vector3(0, H + 0.001, 0), 0, PI / 2, o.walls.ceiling);
    plane(side + WT, H, new THREE.Vector3(xo, H / 2, -dw / 2 - (side + WT) / 2), PI / 2, 0, o.walls.front);
    plane(side + WT, H, new THREE.Vector3(xo, H / 2, dw / 2 + (side + WT) / 2), PI / 2, 0, o.walls.front);
    plane(dw, H - dh, new THREE.Vector3(xo, dh + (H - dh) / 2, 0), PI / 2, 0, o.walls.front);
    const P = 1.2, segL = [], segR = [], segB = [], segF = [], segC = [];
    for (let x = P; x < L; x += P) { segL.push(X(x), 0, Z(0) - WT, X(x), H, Z(0) - WT); segR.push(X(x), 0, Z(W) + WT, X(x), H, Z(W) + WT); segC.push(X(x), H + 0.002, Z(0), X(x), H + 0.002, Z(W)); }
    for (let y = P; y < W; y += P) { segB.push(xb, 0, Z(y), xb, H, Z(y)); segF.push(xo, Math.abs(Z(y)) < dw / 2 + 0.1 ? dh : 0, Z(y), xo, H, Z(y)); }
    o.walls.left.push(lineSet(segL, 0xaabbd0, 0.22, group)); o.walls.right.push(lineSet(segR, 0xaabbd0, 0.22, group));
    o.walls.back.push(lineSet(segB, 0xaabbd0, 0.22, group)); o.walls.front.push(lineSet(segF, 0xaabbd0, 0.22, group)); o.walls.ceiling.push(lineSet(segC, 0xaabbd0, 0.18, group));
    {
      // zócalo sanitario con media caña (PVC) en todo el perímetro interior
      const cv = (len, pos, ry, list) => { const m = new THREE.Mesh(coveGeo(len), SH.pvc); m.position.set(...pos); m.rotation.y = ry; m.receiveShadow = true; group.add(m); list.push(m); };
      cv(L, [0, 0, Z(0)], 0, o.walls.left); cv(L, [0, 0, Z(W)], PI, o.walls.right); cv(W - 0.3, [X(L), 0, 0], -PI / 2, o.walls.back);
      for (const s of [-1, 1]) cv(side - 0.05, [X(0), 0, s * (dw / 2 + 0.05 + (side - 0.05) / 2)], PI / 2, o.walls.front);
      // tapas cam-lock en las juntas (Alta) y colgadores del techo
      const qL = qAxis(new THREE.Vector3(1, 0, 0), PI / 2), qR = qAxis(new THREE.Vector3(1, 0, 0), -PI / 2), qB = qAxis(ZAX, PI / 2), qF = qAxis(ZAX, -PI / 2), cl = [], cr = [], hg = [];
      for (let h = 0.9; h < H - 0.2; h += 1.2) {
        for (let x = P; x < L - 0.01; x += P) { cl.push(Object.assign([X(x), h, Z(0), 1, 1, 1], { q: qL })); cr.push(Object.assign([X(x), h, Z(W), 1, 1, 1], { q: qR })); }
        for (let y = P; y < W - 0.01; y += P) { cl.push(Object.assign([X(L), h, Z(y), 1, 1, 1], { q: qB })); if (!(Math.abs(Z(y)) < dw / 2 + 0.2 && h < dh + 0.3)) cl.push(Object.assign([X(0), h, Z(y), 1, 1, 1], { q: qF })); }
      }
      inst(SH.camLock, cl, hi, false, camLockGeo()); inst(SH.camLock, cr, hiRight, false, camLockGeo());
      for (let x = 1.2; x < L - 0.5; x += 2.4) for (let y = 1.0; y < W - 0.5; y += 2.0) hg.push([X(x), H, Z(y), 1, 1, 1]);
      inst(SH.steel, hg, hiCeil, false, hangerGeo(0.35));
    }
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(L + 2 * WT, H, W + 2 * WT)), new THREE.LineBasicMaterial({ color: 0x6d8199 }));
    edges.position.y = H / 2; group.add(edges); o.edges = edges;

    // ---- Luminarias LED estancas (sobre los racks, fuera del gálibo de los transelevadores) y bandeja portacables
    const aisleZ = []; for (let j = 0; j < R.ny - 1; j++) aisleZ.push(Z((j + 1) * R.dy));
    {
      const lz = []; for (let j = 0; j < R.ny; j++) lz.push(Z((j + 0.5) * R.dy));
      const lx = []; for (let x = 1.4; x < L - 1.0; x += 2.4) lx.push(x);
      const hous = [], diff = [], caps = [], hang = [];
      for (const z of lz) for (const x of lx) {
        hous.push([X(x), H - 0.33, z, 1.25, 0.07, 0.17]); diff.push([X(x), H - 0.37, z, 1.18, 0.018, 0.12]);
        for (const s of [-1, 1]) { caps.push([X(x) + s * 0.63, H - 0.335, z, 0.03, 0.08, 0.18]); hang.push([X(x) + s * 0.45, H - 0.15, z, 0.008, 0.3, 0.008]); }
      }
      inst(std(0xe9eef3, { metalness: 0.3, roughness: 0.4 }), hous, ceil, false); inst(M.lamp, diff, ceil, false);
      inst(M.dark, caps, hiCeil, false); inst(M.galv, hang, hiCeil, false);
      const bc = bucket(), bh = bucket(), ty = H - 0.25, tz = Z(0.6), xa = X(0.8), xb2 = X(L) - 1.0;
      for (const s of [-1, 1]) bc.box(M.galv, xb2 - xa, 0.08, 0.008, [(xa + xb2) / 2, ty, tz + s * 0.15]);
      for (let x = xa + 0.15; x < xb2; x += 0.3) bc.box(M.galv, 0.03, 0.012, 0.3, [x, ty - 0.035, tz]);
      for (let x = xa + 0.4; x < xb2; x += 1.5) { bh.box(M.galv, 0.04, 0.03, 0.42, [x, ty - 0.055, tz]); for (const s of [-1, 1]) bh.cyl(M.galv, 0.006, 0.25, [x, H - 0.13, tz + s * 0.19], null, 6); }
      const cab = [[std(0x1b1d20), 0.012, -0.08], [std(0x5f6670), 0.01, -0.04], [std(0xd9822b), 0.009, 0.0], [std(0x2f6fb0), 0.008, 0.05], [std(0x1b1d20), 0.011, 0.09]];
      for (const [m, r, dz] of cab) bh.rod(m, [xa, ty - 0.017 + r, tz + dz], [xb2, ty - 0.017 + r, tz + dz], r, 8);
      for (const z of lz) bh.rod(cab[0][0], [X(lx[0]), H - 0.29, z], [X(lx[lx.length - 1]), H - 0.29, z], 0.007, 6);
      o.trayEnd = [xb2, ty, tz]; o.cableMat = cab[0][0];
      bc.flush(ceil); bh.flush(hiCeil);
    }

    // ---- Puerta corrediza frigorífica (motor con perfil de velocidad, cortina de tiras con péndulos) y señalética
    const pd = { kind: 'door', id: 0 };
    o.door = createSlidingDoor({ w: dw, h: dh, wallT: WT }); o.door.group.position.set(xo, 0, 0); group.add(o.door.group);
    o.leaf = o.door.leaf; o.doorSynth = 0;
    {
      const bl = bucket(pd);
      sign(bl, 'room', 1.2, 0.36, [xo - 0.012, Math.min(H - 0.25, dh + 0.75), -0.2], FNX);
      sign(bl, 'cold', 0.48, 0.24, [xo - 0.012, 1.6, -dw / 2 - 0.5], FNX);
      bl.flush(hi);
    }
    const bol = std(0xffffff, { map: TEX.hazard(3), roughness: 0.6 });
    {
      const bp = [[xo - 0.25, -(dw / 2 + 0.55)], [xo - 0.25, dw / 2 + 0.55]], zc = -2.2;
      for (const dz of [-0.75, 0, 0.75]) bp.push([xb + 2.6, zc + dz]);
      inst(bol, bp.map(([x, z]) => [x, 0.55, z, 1, 1, 1]), group, true, new THREE.CylinderGeometry(0.08, 0.08, 1.1, 16));
      inst(M.yellow, bp.map(([x, z]) => [x, 1.1, z, 0.08, 0.05, 0.08]), hi, false, new THREE.SphereGeometry(1, 14, 7, 0, PI * 2, 0, PI / 2));
    }
    // Marquesina sobre la puerta (oculta en planta): chapa, frontón, tensores, canaleta, bajada y foco LED
    {
      const cg = new THREE.Group(); hi.add(cg); o.walls.ceiling.push(cg);
      const b = bucket(), cy = dh + 1.0, cz = dw / 2 + 0.7, cd = 1.25, sheet = std(0x7f8b98, { metalness: 0.55, roughness: 0.45 });
      b.box(sheet, cd, 0.04, 2 * cz + 0.2, [xo - cd / 2, cy, 0], [0, 0, -0.05]);
      for (let z = -cz; z <= cz + 0.01; z += 0.25) b.box(sheet, cd, 0.03, 0.03, [xo - cd / 2, cy + 0.03, z], [0, 0, -0.05]);
      b.box(M.grey, 0.05, 0.2, 2 * cz + 0.2, [xo - cd, cy - 0.06, 0]);
      for (const s of [-1, 1]) { b.rod(M.galv, [xo - cd + 0.05, cy + 0.02, s * cz], [xo - 0.02, cy + 0.9, s * cz], 0.012); b.box(M.galv, 0.04, 0.2, 0.08, [xo - 0.02, cy + 0.9, s * cz]); }
      b.add(M.grey, new THREE.CylinderGeometry(0.06, 0.06, 2 * cz + 0.2, 12, 1, true, 0, PI), [xo - cd - 0.06, cy - 0.14, 0], [PI / 2, 0, 0]);
      b.cyl(M.grey, 0.04, cy - 0.1, [xo - cd - 0.08, (cy - 0.1) / 2, -cz - 0.05], null, 10);
      b.box(M.grey, 0.5, 0.05, 0.22, [xo - 0.6, cy - 0.07, 0]).box(M.lamp, 0.44, 0.012, 0.16, [xo - 0.6, cy - 0.1, 0]);
      b.flush(cg, { cast: true });
      const gl = mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: glowTex, color: 0xfff1d0, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), [xo - 0.6, 0.02, 0], cg, null, false);
      gl.rotation.x = -PI / 2;
    }

    // ---- Evaporador EV-01 (bajo el techo junto al muro del fondo) y unidad condensadora CU-01 (exterior)
    const EL = 2.05; o.ew = EL; o.jetW = Math.min(W * 0.62, 6); // largo del equipo; ancho del chorro del corte térmico (sin cambios)
    o.evap = createEvaporator({ fans: 3, length: EL, depth: 0.72, height: 0.62, hang: 0.2, fanD: 0.45 });
    o.evap.group.position.set(X(L) - 0.45, H, 0); group.add(o.evap.group); o.evapBody = o.evap.group;
    const zc = -2.2, Cx = xb + 1.45;
    o.cond = createCondensingUnit(); o.cond.group.position.set(Cx, 0.1, zc); group.add(o.cond.group);
    group.updateMatrixWorld(true);
    {
      const wp = (obj, v) => obj.group.localToWorld(v.clone()), sP = wp(o.evap, o.evap.ports.suction), lP = wp(o.evap, o.evap.ports.liquid), dP = wp(o.evap, o.evap.ports.drain), kP = wp(o.evap, o.evap.ports.cable);
      const cS = wp(o.cond, o.cond.ports.suction), cL = wp(o.cond, o.cond.ports.liquid);
      const pcu = { kind: 'cond', id: 0 }, pe = { kind: 'evap', id: 0 }, bp = bucket(pcu), bd = bucket(pe), xw = xb + 0.22, xw2 = xb + 0.4, ry = H + 0.28;
      // succión aislada (Armaflex) y línea de líquido (cobre) por el techo, bajando por el muro del fondo hasta las válvulas
      bp.add(M.armaflex, tubeGeo([[sP.x, sP.y - 0.02, sP.z], [sP.x, ry, sP.z], [xw, ry, sP.z], [xw, cS.y, sP.z], [xw, cS.y, cS.z], [cS.x, cS.y, cS.z]], 0.045, 0.16, 1));
      bp.add(M.copper, tubeGeo([[lP.x, lP.y - 0.02, lP.z], [lP.x, ry - 0.1, lP.z], [xw2, ry - 0.1, lP.z], [xw2, cL.y, lP.z], [xw2, cL.y, cL.z], [cL.x, cL.y, cL.z]], 0.012, 0.1));
      for (const q of [sP, lP]) bp.box(M.white, 0.16, 0.08, 0.16, [q.x, H + 0.04, q.z]);                        // pasamuros sellados en el techo
      bp.box(M.white, 0.1, 0.22, 0.42, [xb + 0.03, H + 0.12, (sP.z + lP.z) / 2]);
      bp.cyl(M.steel, 0.034, 0.24, [xw2, 1.75, lP.z], null, 14).cyl(M.copper, 0.014, 0.3, [xw2, 1.75, lP.z], null, 8);  // filtro deshidratador
      bp.cyl(M.brass, 0.024, 0.08, [xw2, 1.25, lP.z], null, 12);                                                       // visor de líquido
      bp.add(M.greenLamp, new THREE.CircleGeometry(0.014, 14), [xw2 + 0.025, 1.25, lP.z], [0, PI / 2, 0]);
      for (const y of [1.0, 2.4, 3.8, 5.2].filter((v) => v < H - 0.4)) {                                                   // soportes tipo unistrut
        bp.box(M.galv, 0.45, 0.04, 0.04, [xb + 0.22, y, (sP.z + lP.z) / 2]).box(M.galv, 0.04, 0.04, Math.abs(sP.z - lP.z) + 0.2, [xb + 0.36, y, (sP.z + lP.z) / 2]);
        bp.add(M.galv, new THREE.TorusGeometry(0.05, 0.006, 6, 18), [xw, y + 0.03, sP.z], [PI / 2, 0, 0]).add(M.galv, new THREE.TorusGeometry(0.017, 0.004, 6, 14), [xw2, y + 0.03, lP.z], [PI / 2, 0, 0]);
      }
      // drenaje con resistencia: de la bandeja al muro, baja por dentro y sale al sifón exterior
      const dpts = [[dP.x, dP.y, dP.z], [dP.x, dP.y - 0.12, dP.z], [X(L) - 0.1, dP.y - 0.12, dP.z], [X(L) - 0.1, 0.6, dP.z], [xb + 0.3, 0.6, dP.z], [xb + 0.3, 0.06, dP.z]];
      bd.add(M.pvc, tubeGeo(dpts, 0.024, 0.12));
      bd.box(M.white, WT + 0.1, 0.12, 0.12, [X(L) + WT / 2, 0.6, dP.z]).box(M.dark, 0.3, 0.03, 0.3, [xb + 0.3, 0.015, dP.z]);
      // alimentación eléctrica del evaporador desde la bandeja portacables
      const te = o.trayEnd; bd.add(o.cableMat, tubeGeo([[kP.x, kP.y - 0.02, kP.z], [kP.x, H - 0.1, kP.z], [kP.x - 0.3, H - 0.1, kP.z], [kP.x - 0.3, H - 0.1, te[2] + 0.15], [te[0] + 0.1, te[1] + 0.01, te[2] + 0.15]], 0.011, 0.1));
      bp.flush(group, { cast: true }); bd.flush(group, { cast: true });
      const bt = bucket(pe); bt.add(M.tape, tubeGeo(dpts.map((q) => [q[0], q[1], q[2] + 0.027]), 0.006, 0.12)); bt.flush(hi);
      const bz = bucket(pcu); bz.box(std(0x6b737c, { roughness: 1 }), 1.8, 0.1, 1.2, [Cx, 0.05, zc]); bz.box(M.grey, 0.12, 0.1, 0.3, [xb + 0.08, Math.min(3.4, H - 0.6), zc + 1.0]).box(M.lamp, 0.01, 0.06, 0.24, [xb + 0.145, Math.min(3.4, H - 0.6) - 0.01, zc + 1.0]); bz.flush(group, { cast: true });
    }

    // ---- Racks selectivos (puntal perforado real, largueros escalonados, arriostres, deck de malla, protecciones)
    {
      const RM = makeRackMaterials({ frame: 'blue' }), dk = deckGeo(pitch - 0.1, depth + 0.1), nd = 6, by0 = 0.25, by1 = hU - 0.2;
      const dy = (by1 - by0) / nd, dl = Math.hypot(depth, dy), dGeo = braceGeo(Math.round(dl * 1000) / 1000), hGeo = braceGeo(depth);
      const I = (geo, mat, list, parent, cast = true) => { const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)); list.forEach((m, i) => im.setMatrixAt(i, m)); im.count = list.length; im.castShadow = cast; im.receiveShadow = true; parent.add(im); return im; };
      const T4 = (x, y, z, ry = 0, rx = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0)), new THREE.Vector3(1, 1, 1));
      o.racks = [];
      for (let j = 0; j < R.ny; j++) {
        const zc0 = Z((j + 0.5) * R.dy), ups = [], plates = [], prots = [], hb = [], db = [], beams = [], decks = [];
        const aisleF = j > 0, aisleB = j < R.ny - 1; // cara −Z / +Z frente a un pasillo
        for (let f = 0; f <= nB; f++) {
          const x = X(x0 + f * pitch);
          for (const s of [-1, 1]) {
            const z = zc0 + (s * depth) / 2, ry = s < 0 ? 0 : PI;
            ups.push(T4(x, 0.006, z, ry)); plates.push(T4(x, 0, z, ry));
            if ((s < 0 && aisleF) || (s > 0 && aisleB)) prots.push(T4(x, 0, z, ry));
          }
          for (const y of [by0, by1]) hb.push(T4(x, y, zc0));
          for (let k = 0; k < nd; k++) { const ya = by0 + dy * k, dz = (k % 2 ? -1 : 1) * depth; db.push(T4(x, ya + dy / 2, zc0, 0, Math.atan2(-dy, dz))); }
        }
        for (let b = 0; b < nB; b++) {
          const xc = X(x0 + (b + 0.5) * pitch);
          for (const h of levels) { const yb = h - 0.055; for (const s of [-1, 1]) beams.push(T4(xc, yb, zc0 + (s * depth) / 2, s < 0 ? 0 : PI)); decks.push(T4(xc, yb + 0.04, zc0)); }
        }
        const set = [I(uprightGeo(Math.round(hU * 100) / 100), RM.upright, ups, group), I(basePlateGeo(), RM.galv, plates, group, false), I(hGeo, RM.brace, hb, group), I(dGeo, RM.brace, db, group),
          I(beamGeo(pitch), RM.beam, beams, group), I(dk.mesh, RM.deck, decks, group, false), I(dk.supports, RM.galv, decks, hi, false), I(protectorGeo(), RM.hazard, prots, group)];
        const gm = new THREE.Mesh(frameGuardGeo(depth), RM.hazard); gm.position.set(X(x0), 0, zc0); gm.castShadow = gm.receiveShadow = true; group.add(gm); set.push(gm);
        const sg = new THREE.Mesh(loadSignGeo(), RM.sign); sg.position.set(X(x0) - 0.06, 1.45, zc0); sg.rotation.y = -PI / 2; hi.add(sg); set.push(sg);
        // etiquetas de ubicación en las caras de los largueros que dan a un pasillo
        const bl = bucket();
        for (let b = 0; b < nB; b++) for (const h of levels.slice(1)) {
          const xc = X(x0 + (b + 0.5) * pitch);
          if (aisleF) sign(bl, `r${j}-${b}`, 0.3, 0.1125, [xc, h - 0.055, zc0 - depth / 2 - 0.0855], FNZ);
          if (aisleB) sign(bl, `r${j}-${b}`, 0.3, 0.1125, [xc, h - 0.055, zc0 + depth / 2 + 0.0855], FZ);
        }
        set.push(...bl.flush(hi));
        o.racks.push(set);
      }
    }

    // ---- Pallets (instancias): tarima de bloques, cartones impresos (tinte por temperatura), film, esquineros y etiqueta
    const nMax = R.slots.length + 34;
    o.palMesh = new THREE.InstancedMesh(palletGeo(), palletMaterial(), nMax);
    o.cartons = new THREE.InstancedMesh(cartonGeo(CART.sx, CART.sy, CART.sz), cartonMaterial(), nMax * CPP);
    o.cartons.setColorAt(0, tmpC.set(0xffffff));
    o.wraps = new THREE.InstancedMesh(filmGeo(0.96, 1.18, STACK_H), filmMaterial(), nMax);
    o.corners = new THREE.InstancedMesh(palletDressGeo(0.96, 1.18, STACK_H), kraftMaterial(), nMax);
    {
      const bl = bucket(); sign(bl, 'pallet', 0.21, 0.29, [-0.497, PAL_H + STACK_H * 0.6, 0.25], FNX); sign(bl, 'pallet', 0.21, 0.29, [-0.2, PAL_H + STACK_H * 0.6, 0.607], FZ);
      o.palLabels = new THREE.InstancedMesh(bl.flush(new THREE.Group())[0].geometry, atlasMat, nMax);
    }
    for (const im of [o.palMesh, o.cartons, o.wraps, o.corners, o.palLabels]) { im.count = 0; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.frustumCulled = false; group.add(im); }
    o.palMesh.castShadow = o.palMesh.receiveShadow = true; o.cartons.castShadow = o.cartons.receiveShadow = true; o.corners.receiveShadow = true;
    o.palIds = []; o.palMat = new Map();

    // ---- Manutención: estación P&D, transelevadores por pasillo (con rieles), transpaleta
    { const s = pdStandGeo(LOGI.PD_H); s.position.set(X(LOGI.PD), 0, 0); group.add(s); }
    o.cranes = aisleZ.map((z, i) => {
      const cg = new THREE.Group(); cg.position.set(X(0), 0, z); group.add(cg);
      const c = createStackerCrane({ H }); cg.add(c.group); const rails = c.rails(L - 0.25 - 0.95, 0.95); cg.add(rails);
      return { ...c, holder: cg, z, i };
    });
    o.jack = createPalletJack(); group.add(o.jack.group);
    // ---- Montacargas (operador sentado incluido) con estación de carga de baterías junto a su estacionamiento
    o.fk = createForklift(); group.add(o.fk.group);
    {
      const b = bucket(), qx = X(LOGI.XE - LOGI.RT);
      b.box(M.grey, 0.4, 1.2, 0.3, [qx, 0.6, -5.55]).box(M.dark, 0.32, 0.22, 0.02, [qx, 0.95, -5.39]).box(M.greenLamp, 0.04, 0.04, 0.01, [qx + 0.1, 1.1, -5.39]);
      b.add(M.dark, tubeGeo([[qx - 0.1, 0.4, -5.4], [qx - 0.25, 0.2, -5.1], [qx - 0.3, 0.12, -4.7]], 0.014, 0.1));
      b.flush(hi, { cast: true });
    }
    // ---- Camión frigorífico con plataforma elevadora (atraca solo durante un ingreso)
    o.truck = createTruck({ dock: { x: X(LOGI.DOCK), z: 0, heading: PI }, driver: { road: 11, from: 22, to: 26, side: 1 } }); group.add(o.truck.group);
    // ---- Operarios: muelle (alta visibilidad), técnico de frío y supervisor con tableta
    o.workers = { dock: createWorker({ jacket: 'orange', helmet: 'yellow', hiVis: true, vapour: false, seed: 2 }), tech: createWorker({ jacket: 'grey', helmet: 'blue', item: 'clipboard', vapour: false, seed: 3 }), sup: createWorker({ jacket: 'blue', helmet: 'white', item: 'tablet', vapour: false, seed: 1 }) };
    o.workers.dock.group.position.set(X(-0.8), 0, 2.7); o.workers.tech.group.position.set(X(-0.4), 0, 4.75); o.workers.sup.group.position.set(X(-0.9), 0, 3.3);
    for (const w of Object.values(o.workers)) group.add(w.group);
    o.crewHi = [o.workers.tech.group, o.workers.sup.group];
    const aisleOf = (s) => clamp(Math.round((s.j < R.jd ? (s.j + 1) * R.dy : s.j * R.dy) / R.dy) - 1, 0, o.cranes.length - 1);
    o.logi = createLogistics({ X, Z, R, p0: p, truck: o.truck, cranes: o.cranes.map((c) => ({ z: c.z })), jack: o.jack, workers: o.workers, aisleOf });
    o.aisleOf = aisleOf;
    const upper = o.cranes.length - 1;
    o.crew = createCrew({ X, L, workers: o.workers, aisleZ: aisleZ[upper], doorFrac: () => o.doorVis ?? 0, traffic: () => !!o.logi.state.cur, flags: () => ({ evap: !!(o.flagEvap), cond: !!(o.flagCond) }), setTechAisle: (on) => { o.logi.state.techAisle = on ? upper : -1; } });

    // HMI de la cámara (canvas con datos del simulador), registrador gráfico y señalética junto a la puerta
    const hc = makeCanvas(256, 160); o.hmiCtx = hc.getContext('2d');
    o.hmiTex = new THREE.CanvasTexture(hc); o.hmiTex.colorSpace = SRGB;
    const hmi = new THREE.Group(); hmi.position.set(xo - 0.045, 1.55, -dw / 2 - 1.0); hmi.rotation.y = -PI / 2; group.add(hmi);
    box(0.62, 0.46, 0.08, M.dark, [0, 0, 0], hmi, pd);
    mesh(new THREE.PlaneGeometry(0.52, 0.33), new THREE.MeshBasicMaterial({ map: o.hmiTex, toneMapped: false }), [0, 0.02, 0.045], hmi, null, false);
    o.hmiLast = -1;
    const rc = makeCanvas(256, 256); o.recCtx = rc.getContext('2d'); o.recTex = new THREE.CanvasTexture(rc); o.recTex.colorSpace = SRGB;
    const tc = makeCanvas(256, 112); o.thermoCtx = tc.getContext('2d'); o.thermoTex = new THREE.CanvasTexture(tc); o.thermoTex.colorSpace = SRGB;
    {
      const b = bucket(pd), rec = new THREE.Group(); rec.position.set(xo - 0.055, 1.55, -dw / 2 - 1.85); rec.rotation.y = -PI / 2; hi.add(rec);
      box(0.4, 0.42, 0.1, M.grey, [0, 0, 0], rec, pd, false);
      mesh(new THREE.CircleGeometry(0.17, 40), new THREE.MeshStandardMaterial({ map: o.recTex, roughness: 0.5 }), [0, 0, 0.052], rec, pd, false);
      mesh(new THREE.TorusGeometry(0.175, 0.012, 6, 40), M.dark, [0, 0, 0.055], rec, pd, false);
      const th = new THREE.Group(); th.position.set(X(0.9), Math.min(2.3, H - 0.6), Z(0) + 0.035); hi.add(th);
      box(0.56, 0.27, 0.05, M.dark, [0, 0, 0], th, null, false);
      mesh(new THREE.PlaneGeometry(0.5, 0.22), new THREE.MeshBasicMaterial({ map: o.thermoTex, toneMapped: false }), [0, 0, 0.026], th, null, false);
      sign(b, 'fork', 0.4, 0.36, [xo - 0.012, Math.min(2.35, H - 0.4), -dw / 2 - 1.0], FNX);
      b.box(M.red, 0.05, 0.14, 0.12, [xo - 0.03, 1.4, -dw / 2 - 0.42]); sign(b, 'pull', 0.11, 0.128, [xo - 0.056, 1.4, -dw / 2 - 0.42], FNX);
      // Interior: apertura de emergencia (hongo rojo), alarma de hombre atrapado, luz de emergencia
      b.box(M.yellow, 0.04, 0.14, 0.14, [X(0) + 0.02, 1.05, -dw / 2 - 0.3]).add(M.red, GEO.hemi, [X(0) + 0.04, 1.05, -dw / 2 - 0.3], [0, 0, -PI / 2], [0.05, 0.035, 0.05]);
      sign(b, 'release', 0.36, 0.15, [X(0) + 0.008, 1.3, -dw / 2 - 0.3], FX);
      b.box(M.yellow, 0.04, 0.16, 0.12, [X(0) + 0.02, 1.0, dw / 2 + 0.95]).cyl(M.red, 0.035, 0.03, [X(0) + 0.05, 1.0, dw / 2 + 0.95], [0, 0, PI / 2], 16);
      sign(b, 'trap', 0.4, 0.2, [X(0) + 0.008, 1.3, dw / 2 + 0.95], FX);
      const ey = Math.min(H - 0.25, dh + 0.3);
      b.box(M.white, 0.08, 0.1, 0.36, [X(0) + 0.04, ey, dw / 2 + 0.8]);
      for (const s of [-1, 1]) b.add(M.whiteLamp, GEO.hemi, [X(0) + 0.1, ey - 0.02, dw / 2 + 0.8 + s * 0.12], [0, 0, -PI / 2], [0.04, 0.04, 0.04]);
      b.flush(hi);
    }
    // Botonera de puerta y señal de salida luminosa (interior)
    const bot = box(0.12, 0.2, 0.06, std(0xd9dee4), [X(0) + 0.08, 1.3, dw / 2 + 0.4], group); bot.rotation.y = PI / 2;
    mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 12), new THREE.MeshBasicMaterial({ color: 0x0ca30c, toneMapped: false }), [X(0) + 0.12, 1.35, dw / 2 + 0.4], group, null, false).rotation.z = PI / 2;
    mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 12), new THREE.MeshBasicMaterial({ color: 0xd03b3b, toneMapped: false }), [X(0) + 0.12, 1.25, dw / 2 + 0.4], group, null, false).rotation.z = PI / 2;
    const exitTex = canvasTex(256, 96, (g, w, h) => {
      g.fillStyle = '#0a7a2a'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff';
      g.beginPath(); g.arc(44, 22, 9, 0, 2 * PI); g.fill(); g.lineWidth = 8; g.lineCap = 'round'; g.strokeStyle = '#fff';
      g.beginPath(); g.moveTo(40, 34); g.lineTo(34, 58); g.lineTo(18, 76); g.moveTo(34, 58); g.lineTo(50, 66); g.lineTo(52, 84); g.moveTo(38, 40); g.lineTo(58, 48); g.moveTo(38, 40); g.lineTo(22, 50); g.stroke();
      g.fillRect(70, 18, 8, 64); txt(g, 'SALIDA', 168, 50, 44);
    });
    const exitY = Math.min(H - 0.3, dh + 0.45);
    const exit = mesh(new THREE.PlaneGeometry(0.6, 0.225), new THREE.MeshBasicMaterial({ map: exitTex, toneMapped: false }), [X(0) + 0.06, exitY, 0], group, null, false); exit.rotation.y = PI / 2;
    o.walls.ceiling.push(exit);
    {
      const eg = new THREE.Group(); hi.add(eg); o.walls.ceiling.push(eg);
      box(0.04, 0.27, 0.66, M.white, [X(0) + 0.035, exitY, 0], eg, null, false);
      const gl = mesh(new THREE.PlaneGeometry(1.3, 0.8), new THREE.MeshBasicMaterial({ map: glowTex, color: 0x2bff6a, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), [X(0) + 0.07, exitY, 0], eg, null, false);
      gl.rotation.y = PI / 2;
    }
    // Estación de EPP y extintor en la fachada lateral (exterior, lado visible)
    {
      const b = bucket(), zw = W / 2 + WT, xb = X(0) + 1.3, parka = M.blue;
      b.box(std(0xd5dbe1, { roughness: 0.6 }), 1.62, 1.2, 0.03, [xb + 0.06, 1.45, zw + 0.03]);
      sign(b, 'ppe', 0.63, 0.42, [xb - 0.4, 1.75, zw + 0.047], FZ);
      for (const dx of [0.2, 0.56]) {
        const x = xb + dx; b.cyl(M.galv, 0.008, 0.08, [x, 1.86, zw + 0.08], [PI / 2, 0, 0], 6);
        b.box(parka, 0.34, 0.62, 0.14, [x, 1.5, zw + 0.12]).box(parka, 0.1, 0.5, 0.11, [x - 0.2, 1.52, zw + 0.12], [0, 0, 0.12]).box(parka, 0.1, 0.5, 0.11, [x + 0.2, 1.52, zw + 0.12], [0, 0, -0.12]);
        b.add(parka, GEO.hemi, [x, 1.8, zw + 0.12], null, [0.11, 0.08, 0.08]).box(M.yellow, 0.34, 0.03, 0.141, [x, 1.35, zw + 0.121]);
      }
      b.box(M.galv, 1.3, 0.03, 0.24, [xb, 0.98, zw + 0.14]);
      for (const dx of [-0.45, -0.15]) b.add(M.white, GEO.hemi, [xb + dx, 0.995, zw + 0.14], null, [0.12, 0.1, 0.13]).box(M.white, 0.26, 0.01, 0.03, [xb + dx, 1.0, zw + 0.26]);
      for (const dx of [0.2, 0.32, 0.44]) b.box(M.rubber, 0.08, 0.04, 0.14, [xb + dx, 1.015, zw + 0.14]);
      const xe = xb + 1.15;
      sign(b, 'ext', 0.24, 0.3, [xe, 1.95, zw + 0.025], FZ);
      b.box(M.dark, 0.1, 0.12, 0.05, [xe, 1.25, zw + 0.03]).cyl(M.red, 0.085, 0.52, [xe, 0.98, zw + 0.12], null, 18).add(M.red, GEO.hemi, [xe, 1.24, zw + 0.12], null, [0.085, 0.05, 0.085]);
      b.cyl(M.dark, 0.03, 0.06, [xe, 1.31, zw + 0.12], null, 10).box(M.dark, 0.14, 0.02, 0.04, [xe + 0.03, 1.36, zw + 0.12]).rod(M.dark, [xe + 0.05, 1.31, zw + 0.12], [xe + 0.1, 0.95, zw + 0.2], 0.012);
      b.box(M.lightConc, 0.5, 0.02, 0.5, [xe, 0.01, zw + 0.3]);
      b.box(M.grey, 0.32, 0.32, 0.12, [X(L) - 1.5, H - 1.0, zw + 0.06]); sign(b, 'louver', 0.28, 0.28, [X(L) - 1.5, H - 1.0, zw + 0.121], FZ); // válvula de compensación de presión
      b.flush(hiRight, { cast: true });
    }

    // ---- Mapa térmico por zonas (caja por zona con arista)
    o.heat = [];
    const hg = new THREE.BoxGeometry(R.dx * 0.94, R.dz * 0.94, R.dy * 0.94), he = new THREE.EdgesGeometry(hg);
    for (let z = 0; z < R.n; z++) {
      const zn = R.zones[z], m = new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.2, depthWrite: false, color: 0x0ca30c, toneMapped: false }));
      m.position.set(X(zn.x), zn.h, Z(zn.y)); m.userData.pick = { kind: 'zone', id: z }; m.renderOrder = 2;
      const e = new THREE.LineSegments(he, new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35, toneMapped: false })); m.add(e); m.userData.edge = e;
      group.add(m); o.heat.push(m);
    }

    // ---- Corte térmico (campo continuo interpolado)
    buildSlice(o);

    // ---- Partículas de flujo y de puerta
    const pts = (n, size) => {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const pp = new THREE.Points(g, new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false })); pp.frustumCulled = false; group.add(pp); return pp;
    };
    o.flow = pts(N_FLOW, 0.09);
    const LA = L - 1.6, LB = H - 1;
    o.loop = { LA, LB, loopLen: 2 * (LA + LB) };
    o.flowP = Array.from({ length: N_FLOW }, (_, i) => ({ j: i % R.ny, s: Math.random() * o.loop.loopLen, lat: Math.random() * 2 - 1, v: Math.random() }));
    o.doorPts = pts(N_DOOR * 2, 0.16);
    o.doorP = Array.from({ length: N_DOOR * 2 }, (_, i) => ({ inflow: i < N_DOOR, life: 0, x: 0, y: 0, h: 0 }));

    // ---- Sensores: caja de sonda ventilada, vaina inoxidable, cable al techo, LED de estado y halo de color
    o.sensors = sensors.map((s) => {
      const zn = R.zones[s.zone];
      // sondas sobre los puntales, del lado del pasillo y fuera del gálibo de los transelevadores (entre pallets)
      const rl = o.rackLayout, f = clamp(Math.round((zn.x - rl.x0) / rl.pitch), 0, rl.nB), side = zn.j > 0 ? -1 : 1;
      let x = rl.x0 + f * rl.pitch, zz = Z(zn.y) + side * (depth / 2 + 0.1), h = s.k ? hU - 0.3 : 1.4;
      if (s.i === 0) { x = rl.x0 - 0.08; zz = Z(zn.y) - depth / 2 + 0.12; }
      if (s.kind === 'supply') { x = L - 1.0; zz = 0; h = H - 0.75; }
      if (s.kind === 'return') { x = L - 0.8; zz = 0; h = 0.6; }
      const pk = { kind: 'sensor', id: s.id }, g = new THREE.Group(); g.position.set(X(x), h, zz); group.add(g);
      const b = bucket(pk);
      b.box(M.white, 0.09, 0.14, 0.05, [0, -0.05, 0]);
      for (const yy of [-0.08, -0.06, -0.04]) b.box(M.dark, 0.06, 0.008, 0.004, [0, yy, 0.026]);
      b.cyl(M.steel, 0.006, 0.12, [0, -0.18, 0], null, 8).cyl(M.rubber, 0.006, H - h - 0.02, [0, 0.02 + (H - h - 0.02) / 2, 0], null, 6);
      b.flush(g);
      const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), haloMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
      mesh(new THREE.SphereGeometry(0.012, 10, 8), ledMat, [0.025, 0.0, 0.027], g, pk, false);
      const halo = mesh(new THREE.SphereGeometry(0.06, 16, 12), haloMat, [0, 0.1, 0], g, pk, false);
      const el = document.createElement('div'); el.className = 'lbl'; labels.appendChild(el);
      return { id: s.id, g, mesh: halo, mats: [ledMat, haloMat], el };
    });

    const selBox = new THREE.Box3Helper(new THREE.Box3(), 0xe6edf3); selBox.visible = false; group.add(selBox); o.selBox = selBox;
    group.traverse((m) => { const k = m.userData.pick?.kind; if (m.isMesh && (k === 'door' || k === 'evap' || k === 'cond')) o.pickStatic.push(m); });
    W3 = o;
    sliceLayout();
    setQuality(S.quality);
    applyVisibility();
    setView(S.view, true);
  }

  // ======================= Corte térmico: campo interpolado + isotermas =======================
  function buildSlice(o) {
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat); m.renderOrder = 5; m.userData.pick = { kind: 'slice', id: 0 }; o.group.add(m);
    const fr = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: 0xe6edf3, transparent: true, opacity: 0.7, toneMapped: false }));
    fr.renderOrder = 6; m.add(fr);
    const pin = new THREE.Group(), pm = new THREE.MeshBasicMaterial({ color: 0xff3b3b, toneMapped: false });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 16), pm); cone.rotation.x = PI; cone.position.y = 0.3; pin.add(cone);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 6, 28), pm); ring.rotation.x = PI / 2; ring.position.y = 0.02; pin.add(ring);
    pin.renderOrder = 7; o.group.add(pin);
    const small = makeCanvas(8, 8), big = makeCanvas(8, 8);
    o.sl = { mesh: m, mat, frame: fr, pin, cone, small, big, sctx: small.getContext('2d'), bctx: big.getContext('2d'), mode: null, nx: 0, ny: 0, vals: null, tmp: null, img: null, acc: 1e9, dirty: true, info: null };
    const p = o.p;
    if (S.slice.h == null || S.slice.h > p.H - 0.3) S.slice.h = Math.min(p.H - 0.3, Math.max(0.3, o.R.dz * 0.5));
    if (S.slice.y == null || S.slice.y > p.W - 0.3) S.slice.y = p.W / 2;
  }
  function sliceLayout() {
    const s = W3.sl, p = W3.p, hor = S.slice.mode === 'h';
    if (s.mode !== S.slice.mode) {
      s.mode = S.slice.mode;
      s.nx = 128; s.ny = Math.round(clamp((128 * (hor ? p.W : p.H)) / p.L, 32, 128));
      s.small.width = s.nx; s.small.height = s.ny; s.big.width = s.nx * 4; s.big.height = s.ny * 4;
      s.vals = new Float32Array(s.nx * s.ny); s.tmp = new Float32Array(s.nx * s.ny); s.img = s.sctx.createImageData(s.nx, s.ny);
      if (s.mat.map) s.mat.map.dispose();
      s.mat.map = new THREE.CanvasTexture(s.big); s.mat.map.colorSpace = SRGB; s.mat.map.anisotropy = 4; s.mat.needsUpdate = true;
    }
    S.slice.h = clamp(S.slice.h, 0.3, p.H - 0.3); S.slice.y = clamp(S.slice.y, 0.3, p.W - 0.3);
    s.mesh.scale.set(p.L, hor ? p.W : p.H, 1);
    if (hor) { s.mesh.rotation.set(-PI / 2, 0, 0); s.mesh.position.set(0, S.slice.h, 0); s.pin.rotation.set(0, 0, 0); }
    else { s.mesh.rotation.set(0, 0, 0); s.mesh.position.set(0, p.H / 2, W3.Z(S.slice.y)); s.pin.rotation.set(PI / 2, 0, 0); }
    s.dirty = true;
  }
  function fieldCtx(st, p) {
    return { R: W3.R, T: st.T, p, Tsup: st.evapOut.Tsup, fan: st.air.fanFrac, defrost: st.evap.defrostLeft > 0, door: st.door.frac * (p.curtain ? 0.3 : 1), open: st.door.frac,
      xe: p.L - 0.85, he: p.H - 0.8, ew: W3.ew, dh: W3.dh, dw: W3.dw, tExt: p.tExt, U: p.U };
  }
  // Temperatura del aire en (x a lo largo, y a lo ancho, h altura) [m]: interpolación trilineal entre centros de zona
  // + chorro de impulsión del evaporador + penacho de la puerta + capa límite junto a la envolvente.
  function airT(c, x, y, h) {
    const R = c.R, T = c.T, nx = R.nx, ny = R.ny, nz = R.nz;
    const fx = clamp(x / R.dx - 0.5, 0, nx - 1), fy = clamp(y / R.dy - 0.5, 0, ny - 1), fz = clamp(h / R.dz - 0.5, 0, nz - 1);
    const i0 = Math.floor(fx), j0 = Math.floor(fy), k0 = Math.floor(fz), i1 = Math.min(i0 + 1, nx - 1), j1 = Math.min(j0 + 1, ny - 1), k1 = Math.min(k0 + 1, nz - 1);
    const tx = fx - i0, ty = fy - j0, tz = fz - k0, nxy = nx * ny;
    const a = (k, j) => T[k * nxy + j * nx + i0] * (1 - tx) + T[k * nxy + j * nx + i1] * tx;
    const b0 = a(k0, j0) * (1 - ty) + a(k0, j1) * ty, b1 = a(k1, j0) * (1 - ty) + a(k1, j1) * ty;
    let t = b0 * (1 - tz) + b1 * tz;
    const p = c.p, lat = Math.max(0, Math.abs(y - p.W / 2) - c.ew / 2), wl = Math.exp(-(lat * lat) / 0.35);
    if (c.fan > 0.02 && wl > 0.01) {
      const ahead = c.xe - x;
      if (ahead > -0.5) {
        const along = ahead < 0 ? 1 : Math.exp(-ahead / (0.32 * p.L)), spread = 0.4 + 0.07 * Math.max(0, ahead), dv = (h - c.he) / spread;
        t += (c.Tsup - t) * 0.75 * c.fan * along * wl * Math.exp(-dv * dv);
      }
    }
    if (c.defrost && wl > 0.01) { const dx = x - (p.L - 0.45), dv = h - c.he; t += 3.5 * wl * Math.exp(-(dx * dx + dv * dv) / 0.5); }
    if (c.door > 0.01 && x < 3.5) {
      const ld = Math.max(0, Math.abs(y - p.W / 2) - c.dw * 0.5 * c.open), wd = Math.exp(-(ld * ld) / 0.25);
      const wv = clamp((h - 0.4 * c.dh) / (0.3 * c.dh), 0, 1) * (h < c.dh + 0.4 ? 1 : Math.exp(-(h - c.dh - 0.4) / 0.6));
      t += (c.tExt - t) * 0.6 * c.door * wd * Math.exp(-x / 1.3) * wv;
    }
    const dW = Math.min(x, p.L - x, y, p.W - y, h, p.H - h);
    t += (c.tExt - t) * c.U * 0.035 * Math.exp(-dW / 0.25);
    return t;
  }
  const PM = 0.4; // alcance de la influencia de un pallet sobre el aire vecino [m]
  function palletBoxes(st, p) {
    const out = [];
    for (const q of st.pallets) {
      if (q.state === 'outside') continue;
      const ps = palletPos(q, W3.R, p);
      out.push({ q, x0: ps.x - 0.5, x1: ps.x + 0.5, y0: ps.y - 0.6, y1: ps.y + 0.6, h0: ps.h + PAL_H, h1: ps.h + PAL_H + STACK_H });
    }
    return out;
  }
  // Dentro de la carga: de la superficie (Ts) al núcleo (Tc); fuera: el aire se acerca a Ts en una capa de 0,4 m.
  function palInfl(b, x, y, h, t) {
    const dx = Math.max(b.x0 - x, 0, x - b.x1), dy = Math.max(b.y0 - y, 0, y - b.y1), dh = Math.max(b.h0 - h, 0, h - b.h1);
    if (dx === 0 && dy === 0 && dh === 0) { const e = Math.min(x - b.x0, b.x1 - x, y - b.y0, b.y1 - y, h - b.h0, b.h1 - h); return b.q.Ts + (b.q.Tc - b.q.Ts) * clamp(e / 0.35, 0, 1); }
    const d = Math.sqrt(dx * dx + dy * dy + dh * dh);
    if (d >= PM) return t;
    const w = 0.6 * (1 - d / PM) ** 2; return t + (b.q.Ts - t) * w;
  }
  function blur(a, tmp, nx, ny, r) {
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) { let s = 0; for (let k = -r; k <= r; k++) s += a[y * nx + clamp(x + k, 0, nx - 1)]; tmp[y * nx + x] = s / (2 * r + 1); }
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) { let s = 0; for (let k = -r; k <= r; k++) s += tmp[clamp(y + k, 0, ny - 1) * nx + x]; a[y * nx + x] = s / (2 * r + 1); }
  }
  function computeSlice(st, p) {
    const s = W3.sl, nx = s.nx, ny = s.ny, v = s.vals, hor = s.mode === 'h', L = p.L, W = p.W, H = p.H, c = fieldCtx(st, p), hs = S.slice.h, ys = S.slice.y;
    for (let r = 0; r < ny; r++) for (let k = 0; k < nx; k++) {
      const x = ((k + 0.5) / nx) * L;
      v[r * nx + k] = hor ? airT(c, x, ((r + 0.5) / ny) * W, hs) : airT(c, x, ys, H - ((r + 0.5) / ny) * H);
    }
    blur(v, s.tmp, nx, ny, 2); blur(v, s.tmp, nx, ny, 2);
    const boxes = palletBoxes(st, p); s.cut = [];
    for (const b of boxes) {
      let k0 = Math.floor(((b.x0 - PM) / L) * nx - 0.5), k1 = Math.ceil(((b.x1 + PM) / L) * nx - 0.5), r0, r1;
      if (hor) { if (hs < b.h0 - PM || hs > b.h1 + PM) continue; r0 = Math.floor(((b.y0 - PM) / W) * ny - 0.5); r1 = Math.ceil(((b.y1 + PM) / W) * ny - 0.5); if (hs >= b.h0 && hs <= b.h1) s.cut.push(b); }
      else { if (ys < b.y0 - PM || ys > b.y1 + PM) continue; r0 = Math.floor(((H - b.h1 - PM) / H) * ny - 0.5); r1 = Math.ceil(((H - b.h0 + PM) / H) * ny - 0.5); }
      k0 = Math.max(0, k0); k1 = Math.min(nx - 1, k1); r0 = Math.max(0, r0); r1 = Math.min(ny - 1, r1);
      for (let r = r0; r <= r1; r++) for (let k = k0; k <= k1; k++) {
        const x = ((k + 0.5) / nx) * L, i = r * nx + k;
        v[i] = hor ? palInfl(b, x, ((r + 0.5) / ny) * W, hs, v[i]) : palInfl(b, x, ys, H - ((r + 0.5) / ny) * H, v[i]);
      }
    }
    blur(v, s.tmp, nx, ny, 1);
    let mn = Infinity, mx = -Infinity, im = 0;
    for (let i = 0; i < v.length; i++) { if (v[i] < mn) mn = v[i]; if (v[i] > mx) { mx = v[i]; im = i; } }
    const kx = im % nx, ry = Math.floor(im / nx), mxX = ((kx + 0.5) / nx) * L, mxA = hor ? ((ry + 0.5) / ny) * W : H - ((ry + 0.5) / ny) * H;
    const range = mx - mn, step = range > 14 ? 2 : range >= 2 ? 1 : 0.5;
    s.info = { mode: s.mode, h: hs, y: ys, min: mn, max: mx, step, maxAt: hor ? { x: mxX, y: mxA, h: hs } : { x: mxX, y: ys, h: mxA }, maxCell: [kx, ry] };
  }
  function drawSlice(p) {
    const s = W3.sl, nx = s.nx, ny = s.ny, v = s.vals, d = s.img.data, sp = p.sp, off = p.alarmOffset, hor = s.mode === 'h', info = s.info;
    for (let i = 0; i < v.length; i++) { const c = heatRGB(v[i], sp, off); d[i * 4] = c[0] * 255; d[i * 4 + 1] = c[1] * 255; d[i * 4 + 2] = c[2] * 255; d[i * 4 + 3] = 255; }
    s.sctx.putImageData(s.img, 0, 0);
    const g = s.bctx, BW = s.big.width, BH = s.big.height, sx = BW / nx, sy = BH / ny, L = p.L, W = p.W;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.clearRect(0, 0, BW, BH); g.drawImage(s.small, 0, 0, BW, BH);
    // Referencias de planta: contorno de racks (discontinuo), pallets cortados, evaporador y puerta
    if (hor) {
      const { x0, nB, pitch, depth } = W3.rackLayout, R = W3.R, U = (x) => (x / L) * BW, V = (y) => (y / W) * BH;
      g.setLineDash([7, 5]); g.lineWidth = 1.2; g.strokeStyle = 'rgba(230,237,243,.45)';
      for (let j = 0; j < R.ny; j++) { const yc = (j + 0.5) * R.dy; g.strokeRect(U(x0), V(yc - depth / 2), U(nB * pitch), V(depth)); }
      g.setLineDash([]);
      if (S.view === 'planta') {
        g.strokeStyle = 'rgba(10,14,20,.55)'; g.lineWidth = 1.5;
        for (const b of s.cut) g.strokeRect(U(b.x0) + 1, V(b.y0) + 1, U(b.x1 - b.x0) - 2, V(b.y1 - b.y0) - 2);
        g.strokeStyle = 'rgba(159,227,255,.8)'; g.setLineDash([4, 3]); g.strokeRect(U(L - 0.825), V(W / 2 - W3.ew / 2), U(0.75), V(W3.ew)); g.setLineDash([]);
        g.fillStyle = 'rgba(230,237,243,.9)'; g.fillRect(0, V(W / 2 - W3.dw / 2), 5, V(W3.dw));
        g.save(); g.font = 'bold 13px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 3; g.strokeStyle = 'rgba(10,14,20,.8)'; g.fillStyle = '#e6edf3';
        g.translate(U(L - 0.45), V(W / 2)); g.rotate(-PI / 2); g.strokeText('EVAPORADOR', 0, 0); g.fillText('EVAPORADOR', 0, 0); g.restore();
        g.save(); g.font = 'bold 13px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 3; g.strokeStyle = 'rgba(10,14,20,.8)'; g.fillStyle = '#e6edf3';
        g.translate(16, V(W / 2)); g.rotate(-PI / 2); g.strokeText('PUERTA', 0, 0); g.fillText('PUERTA', 0, 0); g.restore();
      }
    }
    // Isotermas por marching squares (cada «step» °C; la del límite de alarma, discontinua y blanca)
    const [kx, ry] = info.maxCell, mx = (kx + 0.5) * sx, my = (ry + 0.5) * sy;
    const lim = sp + off, step = info.step, lv0 = Math.ceil(info.min / step) * step, labels = [{ x: mx, y: my }, { x: mx + 70, y: my - 20 }];
    for (let lv = lv0, n = 0; lv <= info.max && n < 40; lv += step, n++) iso(lv, false);
    if (lim > info.min && lim < info.max) iso(lim, true);
    function iso(lv, isLim) {
      g.beginPath();
      let segs = 0; const cand = [];
      const P = (cx, cy) => [(cx + 0.5) * sx, (cy + 0.5) * sy];
      for (let r = 0; r < ny - 1; r++) for (let k = 0; k < nx - 1; k++) {
        const a = v[r * nx + k], b = v[r * nx + k + 1], cc = v[(r + 1) * nx + k + 1], dd = v[(r + 1) * nx + k];
        const idx = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (cc > lv ? 2 : 0) | (dd > lv ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const E = { T: () => P(k + (lv - a) / (b - a), r), R: () => P(k + 1, r + (lv - b) / (cc - b)), B: () => P(k + (lv - dd) / (cc - dd), r + 1), L: () => P(k, r + (lv - a) / (dd - a)) };
        const ctr = (a + b + cc + dd) / 4 > lv;
        const tbl = { 1: ['BL'], 2: ['RB'], 3: ['RL'], 4: ['TR'], 5: ctr ? ['TL', 'RB'] : ['TR', 'BL'], 6: ['TB'], 7: ['TL'], 8: ['TL'], 9: ['TB'], 10: ctr ? ['TR', 'BL'] : ['TL', 'RB'], 11: ['TR'], 12: ['RL'], 13: ['RB'], 14: ['BL'] }[idx];
        for (const e of tbl) {
          const p1 = E[e[0]](), p2 = E[e[1]](); g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); segs++;
          if (segs % 3 === 0) cand.push({ x: (p1[0] + p2[0]) / 2, y: (p1[1] + p2[1]) / 2 });
        }
      }
      if (!segs) return;
      if (isLim) { g.setLineDash([9, 6]); g.lineWidth = 3; g.strokeStyle = 'rgba(10,14,20,.7)'; g.stroke(); g.lineWidth = 1.8; g.strokeStyle = '#ffffff'; g.stroke(); g.setLineDash([]); }
      else { g.lineWidth = 2.4; g.strokeStyle = 'rgba(10,14,20,.38)'; g.stroke(); g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,.62)'; g.stroke(); }
      // Etiqueta en el punto del contorno más alejado de las ya colocadas (y lejos de los bordes)
      let best = null, bd = 0;
      for (const q of cand) {
        if (q.x < 22 || q.x > BW - 22 || q.y < 12 || q.y > BH - 12) continue;
        let d = Infinity; for (const l of labels) d = Math.min(d, Math.hypot(q.x - l.x, q.y - l.y));
        if (d > bd) { bd = d; best = q; }
      }
      if (best && bd > 48) {
        labels.push(best);
        const t = isLim ? `límite ${lv.toFixed(1)}°` : `${Number.isInteger(lv) ? lv.toFixed(0) : lv.toFixed(1)}°`;
        g.font = 'bold 12px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        const w = g.measureText(t).width + 8; g.fillStyle = 'rgba(10,14,20,.72)'; g.fillRect(best.x - w / 2, best.y - 8, w, 16); g.fillStyle = isLim ? '#ffd0d0' : '#ffffff'; g.fillText(t, best.x, best.y);
      }
    }
    // Marcador del máximo
    g.lineWidth = 4; g.strokeStyle = 'rgba(10,14,20,.8)'; g.beginPath(); g.arc(mx, my, 10, 0, 2 * PI); g.stroke();
    g.lineWidth = 2; g.strokeStyle = '#ffffff'; g.beginPath(); g.arc(mx, my, 10, 0, 2 * PI); g.moveTo(mx - 16, my); g.lineTo(mx - 5, my); g.moveTo(mx + 5, my); g.lineTo(mx + 16, my); g.moveTo(mx, my - 16); g.lineTo(mx, my - 5); g.moveTo(mx, my + 5); g.lineTo(mx, my + 16); g.stroke();
    const t = `▲ máx ${info.max.toFixed(1)} °C`; g.font = 'bold 14px sans-serif'; const tw = g.measureText(t).width + 12;
    const lx = clamp(mx + 16, 2, BW - tw - 2), ly = clamp(my - 30, 2, BH - 22);
    g.fillStyle = 'rgba(10,14,20,.85)'; g.fillRect(lx, ly, tw, 20); g.fillStyle = '#ff8a8a'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(t, lx + 6, ly + 10);
    s.mat.map.needsUpdate = true;
    // Marcador 3D sobre el plano
    const a = info.maxAt;
    if (hor) s.pin.position.set(W3.X(a.x), a.h, W3.Z(a.y)); else s.pin.position.set(W3.X(a.x), a.h, W3.Z(a.y));
  }
  function sliceValueAt(u, v) {
    const s = W3.sl; if (!s.vals) return null;
    const fx = clamp(u * s.nx - 0.5, 0, s.nx - 1), fy = clamp((1 - v) * s.ny - 0.5, 0, s.ny - 1), i0 = Math.floor(fx), j0 = Math.floor(fy), i1 = Math.min(i0 + 1, s.nx - 1), j1 = Math.min(j0 + 1, s.ny - 1), tx = fx - i0, ty = fy - j0, a = s.vals, n = s.nx;
    return (a[j0 * n + i0] * (1 - tx) + a[j0 * n + i1] * tx) * (1 - ty) + (a[j1 * n + i0] * (1 - tx) + a[j1 * n + i1] * tx) * ty;
  }
  function zoneAt(x, y, h) { const R = W3.R; return R.zid(clamp(Math.floor(x / R.dx), 0, R.nx - 1), clamp(Math.floor(y / R.dy), 0, R.ny - 1), clamp(Math.floor(h / R.dz), 0, R.nz - 1)); }
  function sliceHit(hit) {
    const p = W3.p, hor = W3.sl.mode === 'h', u = hit.uv.x, v = hit.uv.y;
    const x = u * p.L, y = hor ? (1 - v) * p.W : S.slice.y, h = hor ? S.slice.h : v * p.H;
    return { kind: 'slice', id: 0, T: sliceValueAt(u, v), x, y, h, mode: W3.sl.mode, zone: zoneAt(x, y, h) };
  }
  function sampleT(x, y, h) {
    if (!W3 || !S.lastSt) return null;
    const st = S.lastSt, p = S.lastP;
    let t = airT(fieldCtx(st, p), x, y, h);
    for (const b of palletBoxes(st, p)) t = palInfl(b, x, y, h, t);
    return t;
  }

  // ======================= Vistas, capas y calidad =======================
  function camTarget(view) {
    const { L, W, H } = W3.p;
    if (view === 'planta') return { pos: new THREE.Vector3(0, Math.max(L, W) * 1.9, 0.01), tgt: new THREE.Vector3(0, 0, 0) };
    if (view === 'seccion') return { pos: new THREE.Vector3(0, H * 0.55, W / 2 + L * 1.05), tgt: new THREE.Vector3(0, H * 0.45, 0) };
    return { pos: new THREE.Vector3(-L * 0.95, H * 2.1, W * 1.55), tgt: new THREE.Vector3(L * 0.05, H * 0.3, 0) };
  }
  function setView(v, instant = false) {
    S.view = v;
    if (!W3) return;
    const c = camTarget(v);
    if (instant) { camera.position.copy(c.pos); controls.target.copy(c.tgt); S.tween = null; }
    else S.tween = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: c.pos, t1: c.tgt };
    controls.enableRotate = v === '3d';
    applyVisibility();
  }
  function applyVisibility() {
    if (!W3) return;
    const v = S.view, R = W3.R, jd = R.jd, lay = S.layers, sl = W3.sl, slOn = !!lay.slice;
    W3.walls.ceiling.forEach((m) => (m.visible = v === '3d'));
    W3.walls.right.forEach((m) => (m.visible = v !== 'seccion'));
    W3.edges.visible = v !== 'seccion';
    W3.racks.forEach((set, j) => set.forEach((im) => (im.visible = !(v === 'seccion' && j > jd))));
    W3.cranes.forEach((c) => (c.holder.visible = !(v === 'seccion' && c.z > W3.Z((jd + 0.5) * R.dy))));
    W3.heat.forEach((m, z) => {
      const zn = R.zones[z];
      m.visible = lay.heat && !(v === 'seccion' && zn.j !== jd) && !(v === 'planta' && zn.k !== S.level);
      m.material.opacity = (v === 'seccion' ? 0.45 : v === 'planta' ? 0.4 : 0.14) * (slOn ? 0.3 : 1);
      m.userData.edge.material.opacity = v === '3d' ? 0.22 : 0.4;
    });
    sl.mesh.visible = slOn; sl.pin.visible = slOn;
    const top = v === 'planta' && sl.mode === 'h';
    sl.mat.depthTest = !top; sl.frame.material.depthTest = !top; sl.cone.material.depthTest = !top;
    sl.mat.opacity = top ? 0.94 : v === 'seccion' ? 0.86 : 0.72; sl.dirty = true;
    W3.flow.visible = lay.flow;
    W3.sensors.forEach((s) => { s.g.visible = lay.sensors; s.el.style.display = lay.sensors ? '' : 'none'; });
  }
  function setLayers(l) { Object.assign(S.layers, l); applyVisibility(); }
  function setLevel(k) { S.level = k; applyVisibility(); }
  function setSlice(o) {
    if (o.mode) S.slice.mode = o.mode;
    if (o.h != null) S.slice.h = +o.h;
    if (o.y != null) S.slice.y = +o.y;
    if (W3) { sliceLayout(); applyVisibility(); }
  }
  function setQuality(q) {
    S.quality = q;
    const hi = q === 'high';
    renderer.shadowMap.enabled = hi; sun.castShadow = hi;
    renderer.setPixelRatio(hi ? Math.min(2, window.devicePixelRatio || 1) : 1);
    scene.environmentIntensity = hi ? 0.55 : 0.3;
    scene.traverse((m) => { if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => (x.needsUpdate = true)); });
    if (W3) { W3.hi.visible = hi; W3.hiList.forEach((g) => (g.visible = hi)); W3.wraps.visible = W3.corners.visible = W3.palLabels.visible = hi; W3.crewHi.forEach((g) => (g.visible = hi)); }
    resize();
  }

  // ======================= Interacción =======================
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  let mouseIn = false, mx = 0, my = 0, lastPick = 0, hover = null, downAt = null;
  const el = renderer.domElement;
  el.addEventListener('pointermove', (e) => { const r = el.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; mouse.set((mx / r.width) * 2 - 1, -(my / r.height) * 2 + 1); mouseIn = true; });
  el.addEventListener('pointerleave', () => { mouseIn = false; hover = null; handlers.hover?.(null); });
  el.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  el.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    const hit = pick(); S.sel = hit; handlers.select?.(hit);
  });
  const shown = (o) => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
  function pick() {
    if (!W3) return null;
    ray.setFromCamera(mouse, camera);
    const sl = W3.sl, sh = sl.mesh.visible ? ray.intersectObject(sl.mesh, false)[0] || null : null;
    if (sh && S.view === 'planta' && sl.mode === 'h') return sliceHit(sh); // en planta el corte se dibuja encima de todo
    const groups = [
      W3.sensors.filter((s) => s.g.visible).flatMap((s) => s.g.children),
      S.layers.pallets ? [W3.cartons] : [],
      W3.pickStatic.filter(shown),
    ];
    for (const g of groups) {
      if (!g.length) continue;
      const hit = ray.intersectObjects(g, false)[0];
      if (!hit) continue;
      if (sh && sh.distance < hit.distance) return sliceHit(sh);
      if (hit.object === W3.cartons) { const id = W3.palIds[Math.floor(hit.instanceId / CPP)]; if (id !== undefined) return { kind: 'pallet', id }; continue; }
      return hit.object.userData.pick || null;
    }
    if (sh) return sliceHit(sh);
    const hz = ray.intersectObjects(W3.heat.filter((m) => m.visible), false)[0];
    return hz ? hz.object.userData.pick : null;
  }

  // ======================= Actualización por cuadro =======================
  function palletPos(pal, R, p) {
    const s = pal.slot;
    if (pal.state === 'stored' || pal.progress === undefined) return { x: s.x, y: s.y, h: s.h, dir: 0 };
    const jd = R.jd, aisle = s.j < jd ? (s.j + 1) * R.dy : s.j * R.dy;
    const inside = [[0.2, p.W / 2, 0.15], [0.8, aisle, 0.15], [s.x, aisle, 0.15], [s.x, s.y, s.h]];
    const f = pal.progress;
    if (f < 0.3) return { x: -4 + (f / 0.3) * 4.2, y: p.W / 2, h: 0.15, dir: 0 };
    const g = (f - 0.3) / 0.7, seg = [];
    let tot = 0;
    for (let i = 1; i < inside.length; i++) { const d = Math.hypot(inside[i][0] - inside[i - 1][0], inside[i][1] - inside[i - 1][1]) + Math.abs(inside[i][2] - inside[i - 1][2]); seg.push(d); tot += d; }
    let d = g * tot;
    for (let i = 1; i < inside.length; i++) {
      if (d <= seg[i - 1] || i === inside.length - 1) {
        const t = Math.min(1, d / (seg[i - 1] || 1)), a = inside[i - 1], b = inside[i], dx = b[0] - a[0], dy = b[1] - a[1];
        return { x: a[0] + dx * t, y: a[1] + dy * t, h: a[2] + (b[2] - a[2]) * t, dir: Math.abs(dx) + Math.abs(dy) > 1e-3 ? Math.atan2(dy, dx) : null };
      }
      d -= seg[i - 1];
    }
    return { x: s.x, y: s.y, h: s.h, dir: 0 };
  }
  const setSRGB = (c, rgb) => c.setRGB(rgb[0], rgb[1], rgb[2], SRGB);

  function update(st, p, dtR, playing, speed) {
    if (!W3) return;
    S.t += dtR; S.lastSt = st; S.lastP = p;
    const R = W3.R, { X, Z } = W3, off = p.alarmOffset, sp = p.sp, simK = playing ? Math.min(4, Math.sqrt(speed)) : 0, blink = Math.floor(S.t * 2) % 2 === 0;
    const dtA = playing ? dtR : 0, dtS = playing ? Math.min(dtR * speed, 2.5) : 0, fast = playing && speed >= 20;
    // Logística del ingreso (camión, plataforma, transpaleta, montacargas, transelevadores) y operarios de ronda
    const LS = W3.logi.update(st, p, dtS, fast);
    driveForklift(LS.fkCmd, dtS, dtA, fast);
    W3.cranes.forEach((c, i) => { const s = LS.crane[i]; c.rig.set(s.x, s.y, s.e); c.rig.busy = s.busy; c.rig.update(Math.max(dtA, 1e-4)); c.holder.updateMatrixWorld(true); });
    W3.flagEvap = p.evapFail || st.evap.defrostLeft > 0; W3.flagCond = !!p.condDirty || !p.refrigOn;
    W3.crew.update(dtS, fast);
    // Puerta: perfil de motor sobre la fracción simulada (+ apertura para el paso del montacargas de la reproducción)
    W3.doorSynth = clamp(W3.doorSynth + ((LS.doorDemand ? 1 : -1) * dtS) / 4, 0, 1);
    const fracV = Math.max(st.door.frac, W3.doorSynth), nr = forkliftNear(); W3.doorVis = fracV;
    W3.door.update(Math.min(Math.max(dtS, dtA), 0.25), { frac: fracV, cmd: st.door.cmd || LS.doorDemand, curtain: !!p.curtain, forkliftNear: nr.n, forkliftZ: nr.z, forkliftDir: nr.dir });
    // Evaporador (ventiladores con inercia, escarcha, desescarche con goteo, LED) y unidad condensadora
    W3.evap.update(dtA, { fanFrac: st.air.fanFrac, fail: p.evapFail, failIdx: 1, defrost: st.evap.defrostLeft > 0, frost: Math.min(1, st.evap.frost / 150), run: st.ctrl.on ? st.ctrl.u : 0 });
    W3.cond.update(dtA, { run: p.refrigOn && st.ctrl.on, load: st.ctrl.u });
    // Mapa térmico por zonas
    for (let z = 0; z < R.n; z++) { const c = heatRGB(st.T[z], sp, off); setSRGB(W3.heat[z].material.color, c); setSRGB(W3.heat[z].userData.edge.material.color, c); }
    // Corte térmico: se recalcula unas 4 veces por segundo (2 en calidad Media) o al mover el plano
    const sl = W3.sl;
    if (sl.mesh.visible) {
      sl.acc += dtR;
      if (sl.dirty || sl.acc > (S.quality === 'high' ? 0.25 : 0.5)) { sl.acc = 0; sl.dirty = false; computeSlice(st, p); drawSlice(p); }
      sl.cone.position.y = 0.3 + 0.05 * Math.sin(S.t * 4);
    }
    renderPallets(st, p, LS);
    if (Math.floor(st.t / 5) !== W3.hmiLast) { W3.hmiLast = Math.floor(st.t / 5); drawPanels(st, p); }
    // Flujo de aire y puerta
    if (S.layers.flow) updateFlow(st, p, dtR * simK);
    updateDoorFlow(st, p, dtR * Math.max(simK, playing ? 1 : 0));
    // Sensores
    const rect = el.getBoundingClientRect();
    for (const s of W3.sensors) {
      const sd = st.sensors.find((x) => x.id === s.id);
      const c = heatRGB(sd.T, sp, off); s.mats.forEach((m) => setSRGB(m.color, c));
      if (!S.layers.sensors) continue;
      tmpV.copy(s.g.position).project(camera);
      s.el.style.display = tmpV.z < 1 ? '' : 'none';
      s.el.style.transform = `translate(${((tmpV.x + 1) / 2) * rect.width + 10}px, ${((1 - tmpV.y) / 2) * rect.height - 10}px)`;
      s.el.textContent = `${sd.id} ${sd.T.toFixed(1)}°`;
      s.el.classList.toggle('on', S.sel?.kind === 'sensor' && S.sel.id === s.id);
    }
    updateSelection(st, p);
    if (mouseIn && performance.now() - lastPick > 60) {
      lastPick = performance.now();
      const h = pick();
      if (h?.kind !== hover?.kind || h?.id !== hover?.id || h?.kind === 'slice') hover = h;
      handlers.hover?.(hover, mx, my);
    }
    if (S.tween) {
      const tw = S.tween; tw.t = Math.min(1, tw.t + dtR / 0.7); const e = 1 - Math.pow(1 - tw.t, 3);
      camera.position.lerpVectors(tw.p0, tw.p1, e); controls.target.lerpVectors(tw.t0, tw.t1, e);
      if (tw.t >= 1) S.tween = null;
    }
    controls.update();
    if (S.skipRender) return; // pruebas automatizadas: avanzar la animación sin dibujar
    if (useAO && S.quality === 'high') composer.render(dtR); else renderer.render(scene, camera);
  }

  // Montacargas: el conductor cinemático sigue la consigna (subpasos de ≤ 50 ms); a ×20 o más se posiciona directo.
  function driveForklift(cmd, dtS, dtA, fast) {
    const f = W3.fk; if (!cmd) return;
    if (fast) {
      let x, z, h, lift = cmd.lift ?? FORK.parkLift;
      if (cmd.active) { const P = W3.logi.paths[cmd.leg], q = P.at(clamp(cmd.s, 0, P.length)); x = q.x; z = q.z; h = q.heading; } else { [x, z, h] = cmd.park; lift = FORK.parkLift; }
      f.rig.setPose(x, z, h); f.rig.setLift(lift); f.rig.setTilt(0); f.rig.setLoad(!!cmd.load); f.rig.setBeacon(!!cmd.active); f.rig.update(Math.max(dtA, 1e-4), {});
      f.driver._place(x, z, h); f.driver.key = ''; f.driver.mode = cmd.active ? 'hold' : 'parked'; f.driver.parkT = 99; f.driver.lift = lift; f.driver.track = null;
    } else { let left = dtS; do { const h = Math.min(left, 0.05); f.driver.update(Math.max(h, 1e-4), cmd); left -= h; } while (left > 1e-6); }
    f.group.updateMatrixWorld(true);
  }
  // Cercanía del montacargas al plano de la cortina (para apartar las tiras): 1 si lo atraviesa
  function forkliftNear() {
    const f = W3.fk, g = f.group, h = -g.rotation.y, cx = Math.cos(h), cz = Math.sin(h), xc = W3.X(0) + 0.05, fx = g.position.x, fz = g.position.z;
    const v = f.driver.state?.v ?? 0, dir = Math.sign(v * cx) || 1, t0 = -2.0, t1 = 1.8;
    if (Math.abs(cx) > 0.1) { const t = (xc - fx) / cx; if (t >= t0 && t <= t1) return { n: 1, z: fz + t * cz, dir }; }
    const d = Math.min(Math.abs(fx + t0 * cx - xc), Math.abs(fx + t1 * cx - xc)); return { n: Math.max(0, 1 - d / 0.6), z: fz, dir };
  }
  // Pallets: matriz de la base de cada pallet visible (ubicado, en tránsito según la reproducción, o en el camión)
  const slotM = (s) => tmpM2.makeTranslation(W3.X(s.x), s.h, W3.Z(s.y)).clone();
  const UNDER = new THREE.Matrix4().makeTranslation(0, -PICK.under, 0);
  function placeMatrix(pl) {
    if (pl.m) return pl.m;
    if (pl.fork) return W3.fk.rig.loadAnchor.matrixWorld.clone().multiply(UNDER);
    if (pl.crane !== undefined) return W3.cranes[pl.crane].rig.loadAnchor.matrixWorld.clone();
    return null;
  }
  // Color por cartón: cartón impreso (blanco estucado con leve variación); con «Mapa térmico» se tiñe con fuerza por la
  // temperatura (cartones exteriores = superficie, interiores = núcleo); sin él queda un tinte leve.
  const _rgb = [0, 0, 0];
  function cartonColor(q, T0, c, k, seed, sp, off) {
    const j = 0.92 + 0.08 * hash(seed * 97 + k), T = q ? q.Ts + (q.Tc - q.Ts) * c.d : T0, rgb = heatRGB(T, sp, off), w = S.layers.heat ? 0.8 : 0.1;
    _rgb[0] = j * (1 - w + w * rgb[0]); _rgb[1] = j * 0.985 * (1 - w + w * rgb[1]); _rgb[2] = j * 0.95 * (1 - w + w * rgb[2]);
    return tmpC.setRGB(_rgb[0], _rgb[1], _rgb[2], SRGB);
  }
  function renderPallets(st, p, LS) {
    const o = W3, R = o.R, sp = p.sp, off = p.alarmOffset, pm = o.palMesh, cart = o.cartons, hideCol = S.view === 'seccion' ? R.jd : 99;
    let n = 0; o.palIds.length = 0; o.palMat.clear();
    const put = (m, q, T0, id) => {
      if (n >= pm.instanceMatrix.count) return;
      pm.setMatrixAt(n, m); o.wraps.setMatrixAt(n, m); o.corners.setMatrixAt(n, m); o.palLabels.setMatrixAt(n, m);
      for (let k = 0; k < CPP; k++) { const c = CARTONS[k], i = n * CPP + k; tmpM.makeTranslation(c.x, c.y, c.z).premultiply(m); cart.setMatrixAt(i, tmpM); cart.setColorAt(i, cartonColor(q, T0, c, k, id ?? n + 1000, sp, off)); }
      o.palIds[n] = id ?? undefined; if (id != null) o.palMat.set(id, m); n++;
    };
    const stored = (q) => !(q.slot.j > hideCol) && !(S.view === 'planta' && q.slot.k !== S.level);
    if (S.layers.pallets) {
      const placed = new Map(); for (const pl of LS.places) if (pl.id != null) placed.set(pl.id, pl);
      for (const q of st.pallets) {
        const pl = placed.get(q.id);
        if (pl && !pl.stored) { const m = placeMatrix(pl); if (m) put(m, q, null, q.id); continue; }
        if (q.state === 'stored' || (pl && pl.stored)) { if (stored(q)) put(slotM(q.slot), q, null, q.id); continue; }
        const ps = palletPos(q, R, p); put(tmpM2.makeTranslation(W3.X(ps.x), ps.h, W3.Z(ps.y)).clone(), q, null, q.id); // sin reproducción registrada
      }
      for (const pl of LS.places) if (pl.id == null) { const m = placeMatrix(pl); if (m) put(m, null, pl.T0, null); }
    }
    pm.count = n; cart.count = n * CPP; o.wraps.count = n; o.corners.count = n; o.palLabels.count = n;
    for (const im of [pm, cart, o.wraps, o.corners, o.palLabels]) im.instanceMatrix.needsUpdate = true;
    if (cart.instanceColor) cart.instanceColor.needsUpdate = true;
  }

  // HMI, termómetro de pared y registrador circular: se redibujan cada 5 s simulados
  function drawPanels(st, p) {
    const g = W3.hmiCtx, al = st.alarms.active.length, T = st.kpi.Tavg;
    g.fillStyle = '#071018'; g.fillRect(0, 0, 256, 160);
    g.fillStyle = al ? '#d03b3b' : '#0ca30c'; g.fillRect(0, 0, 256, 22);
    g.fillStyle = '#fff'; g.font = 'bold 14px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(al ? '⚠ ' + st.alarms.active[0].title : 'CÁMARA 01 · NORMAL', 8, 16);
    g.fillStyle = '#9fe3ff'; g.font = 'bold 48px monospace'; g.fillText(T.toFixed(1) + '°', 10, 80);
    g.font = '14px sans-serif'; g.fillStyle = '#c3c2b7'; g.fillText(`SP ${p.sp} °C   HR ${st.kpi.rh.toFixed(0)} %`, 10, 104);
    g.fillText(`Compresor ${st.ctrl.on ? Math.round(st.ctrl.u * 100) + ' %' : 'OFF'}`, 10, 124);
    g.fillText(`Puerta ${st.door.cmd ? 'ABIERTA' : 'cerrada'}`, 10, 144);
    g.strokeStyle = '#3987e5'; g.beginPath(); const h = st.hist.slice(-40); h.forEach((r, i) => { const x = 150 + i * 2.5, y = 110 - (r.Ta - p.sp) * 8; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
    W3.hmiTex.needsUpdate = true;
    // Termómetro digital de pared (interior)
    const t = W3.thermoCtx, crit = T >= p.sp + p.alarmOffset, warm = T > p.sp + 1;
    t.fillStyle = '#050607'; t.fillRect(0, 0, 256, 112);
    t.fillStyle = '#7d8793'; t.font = 'bold 13px sans-serif'; t.textAlign = 'left'; t.textBaseline = 'middle'; t.fillText('T CÁMARA', 10, 14); t.textAlign = 'right'; t.fillText(`HR ${st.kpi.rh.toFixed(0)}%`, 246, 14);
    t.fillStyle = crit ? '#ff4d4d' : warm ? '#ffc23a' : '#4cff8a'; t.font = 'bold 64px monospace'; t.textAlign = 'center'; t.fillText(`${T.toFixed(1)}°C`, 128, 66);
    t.fillStyle = '#7d8793'; t.font = '12px sans-serif'; t.fillText(`SP ${p.sp} °C · alarma ${p.sp + p.alarmOffset} °C`, 128, 100);
    W3.thermoTex.needsUpdate = true;
    // Registrador gráfico circular (24 h por vuelta): papel, escala radial y trazo del aire medio
    const r = W3.recCtx, c = 128;
    r.fillStyle = '#f7f5ee'; r.fillRect(0, 0, 256, 256);
    r.strokeStyle = 'rgba(60,90,140,.35)'; r.lineWidth = 1;
    for (let k = 1; k <= 5; k++) { r.beginPath(); r.arc(c, c, 20 + k * 20, 0, 2 * PI); r.stroke(); }
    for (let k = 0; k < 24; k++) { const a = (k / 24) * 2 * PI; r.beginPath(); r.moveTo(c + 20 * Math.cos(a), c + 20 * Math.sin(a)); r.lineTo(c + 122 * Math.cos(a), c + 122 * Math.sin(a)); r.stroke(); }
    r.fillStyle = '#33475b'; r.font = 'bold 11px sans-serif'; r.textAlign = 'center'; r.textBaseline = 'middle'; r.fillText('TR-01 · °C', c, c - 34);
    const rad = (Tv) => clamp(20 + ((Tv - (p.sp - 4)) / 12) * 100, 20, 122), ang = (tt) => (((tt + 12 * 3600) % 86400) / 86400) * 2 * PI - PI / 2;
    r.strokeStyle = 'rgba(208,59,59,.45)'; r.setLineDash([4, 3]); r.beginPath(); r.arc(c, c, rad(p.sp + p.alarmOffset), 0, 2 * PI); r.stroke(); r.setLineDash([]);
    r.strokeStyle = '#c62828'; r.lineWidth = 1.6; r.beginPath();
    st.hist.slice(-2880).forEach((q, i) => { const a = ang(q.t), rr = rad(q.Ta), x = c + rr * Math.cos(a), y = c + rr * Math.sin(a); i ? r.lineTo(x, y) : r.moveTo(x, y); }); r.stroke();
    r.fillStyle = '#333'; r.beginPath(); r.arc(c, c, 6, 0, 2 * PI); r.fill();
    W3.recTex.needsUpdate = true;
  }

  function updateFlow(st, p, dts) {
    const o = W3, R = o.R, { LA, LB, loopLen } = o.loop, pos = o.flow.geometry.attributes.position.array, col = o.flow.geometry.attributes.color.array;
    const L = p.L, H = p.H, x0 = 0.6, x1 = L - 1.0;
    for (let i = 0; i < N_FLOW; i++) {
      const q = o.flowP[i], vcol = (st.air.col[q.j] / 1.25 / (R.dy * R.dz)) * 3;
      q.s = (q.s + vcol * dts) % loopLen;
      let x, h, s = q.s, zoneT;
      if (s < LA) { x = x1 - s; h = H - 0.5 + q.v * 0.35; }
      else if ((s -= LA) < LB) { x = x0; h = H - 0.5 - s; }
      else if ((s -= LB) < LA) { x = x0 + s; h = 0.3 + q.v * 1.0; }
      else { s -= LA; x = x1 + 0.2; h = 0.5 + s; }
      const y = (q.j + 0.5) * R.dy + q.lat * R.dy * 0.3;
      pos[i * 3] = o.X(x); pos[i * 3 + 1] = h; pos[i * 3 + 2] = o.Z(y);
      if (q.s < 1.2) zoneT = st.evapOut.Tsup;
      else { const zi = Math.min(R.nx - 1, Math.max(0, Math.floor(x / R.dx))); zoneT = st.T[R.zid(zi, q.j, h > H / 2 ? 1 : 0)]; }
      setSRGB(tmpC, heatRGB(zoneT, p.sp, p.alarmOffset));
      col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b;
    }
    o.flow.geometry.attributes.position.needsUpdate = true; o.flow.geometry.attributes.color.needsUpdate = true;
    o.flow.material.opacity = st.air.fanFrac > 0 ? 0.9 : 0.25;
  }

  function updateDoorFlow(st, p, dts) {
    const o = W3, pos = o.doorPts.geometry.attributes.position.array, col = o.doorPts.geometry.attributes.color.array;
    const f = st.door.frac, dw = o.dw * f * 0.95, dh = Math.min(p.doorH, p.H - 0.4), rate = (st.door.mInf / 0.9) * 60;
    const warm = setSRGB(new THREE.Color(), heatRGB(p.tExt, p.sp, p.alarmOffset)), cold = setSRGB(new THREE.Color(), heatRGB(st.T[o.R.doorZone], p.sp, p.alarmOffset));
    let spawn = rate * dts;
    for (let i = 0; i < o.doorP.length; i++) {
      const q = o.doorP[i];
      if (q.life <= 0 && spawn > 0 && f > 0.05 && Math.random() < spawn / 20) {
        spawn -= 1; q.life = 5; q.y = (Math.random() - 0.5) * dw;
        if (q.inflow) { q.x = -0.8 - Math.random() * 0.6; q.h = dh * (0.55 + Math.random() * 0.4); }
        else { q.x = 0.3 + Math.random() * 0.6; q.h = 0.1 + Math.random() * dh * 0.4; }
      }
      if (q.life > 0) {
        q.life -= dts; q.x += (q.inflow ? 1.1 : -1.1) * dts; if (q.inflow) q.h -= 0.12 * dts;
        pos[i * 3] = o.X(q.x); pos[i * 3 + 1] = q.h; pos[i * 3 + 2] = q.y;
        const c = q.inflow ? warm : cold; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      } else pos[i * 3 + 1] = -50;
    }
    o.doorPts.geometry.attributes.position.needsUpdate = true; o.doorPts.geometry.attributes.color.needsUpdate = true;
  }

  function updateSelection(st, p) {
    const b = W3.selBox, sel = S.sel;
    if (!sel) { b.visible = false; return; }
    const bx = b.box;
    if (sel.kind === 'pallet') {
      const m = W3.palMat.get(sel.id);
      if (!m) { b.visible = false; return; }
      tmpV.setFromMatrixPosition(m); const x = tmpV.x, z = tmpV.z, y = tmpV.y;
      bx.min.set(x - 0.64, y, z - 0.64); bx.max.set(x + 0.64, y + PAL_H + STACK_H + 0.08, z + 0.64);
    } else if (sel.kind === 'sensor') { const s = W3.sensors.find((x) => x.id === sel.id); bx.setFromCenterAndSize(s.g.position, tmpV.set(0.5, 0.6, 0.5)); }
    else if (sel.kind === 'evap') bx.setFromObject(W3.evap.group);
    else if (sel.kind === 'door') bx.setFromObject(W3.door.leaf);
    else if (sel.kind === 'cond') bx.setFromObject(W3.cond.group);
    else if (sel.kind === 'zone') bx.setFromObject(W3.heat[sel.id]);
    else if (sel.kind === 'slice') bx.setFromCenterAndSize(tmpV.set(W3.X(sel.x), sel.h, W3.Z(sel.y)), tmpS.set(0.3, 0.3, 0.3));
    b.visible = true;
  }

  function select(sel) { S.sel = sel; }
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
    camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
    composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h);
  }
  new ResizeObserver(resize).observe(container);

  return {
    build, update, setView, setLayers, setLevel, setQuality, select, setSlice, sampleT,
    sliceInfo: () => (W3 && W3.sl.info ? { ...W3.sl.info } : null),
    get view() { return S.view; }, get layers() { return S.layers; }, get slice() { return { ...S.slice }; },
    setAO(on) { useAO = !!on; }, get ao() { return useAO; },
    set skipRender(v) { S.skipRender = !!v; }, get world() { return W3; },
    // conteo de dibujado sin postproceso (draw calls / triángulos de la escena)
    stats() { const a = renderer.info.autoReset; renderer.info.autoReset = false; renderer.info.reset(); renderer.render(scene, camera); const r = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }; renderer.info.autoReset = a; return r; },
    get renderer() { return renderer; }, get camera() { return camera; }, get controls() { return controls; },
  };
}
