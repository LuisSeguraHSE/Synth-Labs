// Configuración del simulador: catálogos, parámetros por defecto y escenarios.
// Todo lo editable vive aquí para que la lógica no tenga números mágicos.

export const GRID = { nx: 4, ny: 3, nz: 2 }; // zonas: largo (puerta→evaporador) × ancho × nivel
export const SLOT = { lane: 1.5, back: 1.2, pitch: 1.15, palletW: 1.0, palletD: 1.2, palletH: 1.6, rackDepth: 1.2 };

export const INSULATION = {
  bajo: { U: 0.45, label: 'Bajo' },
  medio: { U: 0.25, label: 'Medio' },
  alto: { U: 0.15, label: 'Alto' },
};

// cp [J/kgK], kg por pallet, calor de respiración a 0 °C [W/kg], objetivo y máximo de núcleo [°C],
// transpiración [kg/(s·kg·Pa) de déficit de presión de vapor], rango de HR óptimo [%].
export const PRODUCTS = {
  arandano: { name: 'Arándano', cp: 3600, kg: 480, resp: 0.03, tObj: 1, tMax: 5, tr: 1.0e-9, rh: [88, 95] },
  uva: { name: 'Uva de mesa', cp: 3600, kg: 850, resp: 0.012, tObj: 0, tMax: 4, tr: 6e-10, rh: [88, 95] },
  palta: { name: 'Palta', cp: 3010, kg: 900, resp: 0.045, tObj: 6, tMax: 9, tr: 4e-10, rh: [85, 92] },
  esparrago: { name: 'Espárrago', cp: 3940, kg: 600, resp: 0.1, tObj: 2, tMax: 5, tr: 2e-9, rh: [92, 98] },
  lacteos: { name: 'Lácteos', cp: 3800, kg: 700, resp: 0, tObj: 3, tMax: 6, tr: 0, rh: [70, 90] },
  carne: { name: 'Carne refrigerada', cp: 3500, kg: 800, resp: 0, tObj: 1, tMax: 4, tr: 2e-10, rh: [85, 92] },
};

// PID: u = Kp·e + Ki·∫e dt + Kd·de/dt  (e en °C, tiempo en minutos, u en 0..1)
export const PID_PRESETS = {
  suave: { Kp: 0.6, Ki: 0.08, Kd: 0, label: 'Suave' },
  normal: { Kp: 1.4, Ki: 0.3, Kd: 0.05, label: 'Normal' },
  agresiva: { Kp: 3.0, Ki: 0.8, Kd: 0.1, label: 'Agresiva' },
};

export const DEFAULTS = {
  // Geometría [m] y envolvente
  L: 12, W: 8, H: 6, insulation: 'medio', U: 0.25, tExt: 30, rhExt: 65,
  // Control
  sp: 2, alarmOffset: 3, hyst: 1, control: 'onoff', pidPreset: 'normal', Kp: 1.4, Ki: 0.3, Kd: 0.05,
  ctrlMode: 'auto', uMan: 60, spRamp: 0, minOn: 120, minOff: 180, uMin: 25, // manual/auto, rampa de SP [°C/min, 0 = escalón], anti-ciclo [s], carga mínima [%]
  condApproach: 10, condDirty: false,                                       // T cond = T ext + aproximación (+8 K si el condensador está sucio)
  // Sistema frigorífico equivalente
  refrigOn: true, capNom: 30, capAvail: 100, eta: 0.55, UAcoil: 5.8, evapFail: false,
  fan: 70, fanFlow: 9, fanPow: 1.8,
  defrostEvery: 6, defrostDur: 20, defrostKW: 6,
  // Puerta
  doorW: 2.5, doorH: 3, doorCd: 0.2, curtain: false,
  // Otros
  lights: 0.6, forkliftKW: 3, tariff: 0.64, currency: 'S/', hAfac: 1, hAref: 300, Ksc: 450,
};

// Escenarios preconfigurados: parámetros, stock inicial y eventos programados (t en s desde 12:00).
export const SCENARIOS = {
  normal: {
    name: 'Operación normal',
    desc: '36 pallets estabilizados y aperturas cortas de puerta cada ~45 min.',
    params: {}, stock: { product: 'arandano', n: 36, dist: 'distribuida' },
    events: [{ t: 600, type: 'doorCycle', every: 2700, dur: 60 }],
  },
  ingreso: {
    name: 'Ingreso masivo de producto',
    desc: '30 pallets en stock; a los 5 min ingresan 16 pallets de arándano a 15 °C.',
    params: {}, stock: { product: 'arandano', n: 30, dist: 'distribuida' },
    events: [{ t: 300, type: 'ingress', product: 'arandano', n: 16, T0: 15, dist: 'distribuida', keepDoor: true }],
  },
  puerta: {
    name: 'Puerta abierta',
    desc: 'La puerta queda abierta 8 min a los 5 min de iniciar.',
    params: {}, stock: { product: 'arandano', n: 36, dist: 'distribuida' },
    events: [{ t: 300, type: 'door', open: true }, { t: 780, type: 'door', open: false }],
  },
  falla: {
    name: 'Falla de evaporador',
    desc: 'A los 10 min falla un ventilador y el serpentín pierde capacidad.',
    params: {}, stock: { product: 'arandano', n: 36, dist: 'distribuida' },
    events: [{ t: 600, type: 'fail', on: true }, { t: 1800, type: 'door', open: true }, { t: 1920, type: 'door', open: false }],
  },
  malDistribuida: {
    name: 'Carga mal distribuida',
    desc: 'Stock concentrado que bloquea el flujo; 12 pallets calientes van a la zona bloqueada.',
    params: {}, stock: { product: 'arandano', n: 30, dist: 'concentrada' },
    events: [{ t: 300, type: 'ingress', product: 'arandano', n: 12, T0: 14, dist: 'concentrada', keepDoor: true }],
  },
  caluroso: {
    name: 'Día extremadamente caliente',
    desc: 'Exterior a 38 °C y 75 % HR, con aperturas de puerta de 90 s cada ~30 min.',
    params: { tExt: 38, rhExt: 75 }, stock: { product: 'arandano', n: 36, dist: 'distribuida' },
    events: [{ t: 600, type: 'doorCycle', every: 1800, dur: 90 }],
  },
};

// Colores: semántica de estado (fija) y series de gráficos (paleta validada para fondo oscuro).
export const COLORS = {
  cold: '#3987e5', ok: '#0ca30c', warn: '#fab219', crit: '#d03b3b', idle: '#6b7280', model: '#9085e9',
  sAir: '#3987e5', sCore: '#d95926', sSurf: '#199e70', sLoad: '#d55181', sCool: '#9085e9', sElec: '#c98500',
};

export const SPEEDS = [1, 5, 20, 100];
export const START_CLOCK = 12 * 3600; // la simulación arranca a las 12:00
