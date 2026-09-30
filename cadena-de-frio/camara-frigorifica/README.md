# Cold Room Simulator · cámara frigorífica

**[▶ Abrir simulación](https://luissegurahse.github.io/Synth-Labs/cadena-de-frio/camara-frigorifica/)** · [Portal](https://luissegurahse.github.io/Synth-Labs/) · [Código](./index.html)

Simulador didáctico de una cámara frigorífica en el navegador (Three.js + Canvas, sin build).
Responde visualmente: qué pasa si ingresa producto caliente, si se abre la puerta, si cambian los
ventiladores o el setpoint; cómo responde el control ON/OFF o PID; cuánto consume; cuánto tarda en
recuperarse; qué zonas están más calientes y cuándo aparece una alarma.

**Clasificación:** *simulador* (reglas + modelo físico de parámetros concentrados). Los sensores son virtuales;
la arquitectura permite sustituirlos por datos reales (ver *Extender*).

## Ejecutar

Usa módulos JavaScript: necesita un servidor local (no funciona con doble clic en `file://`).

```bash
# desde la raíz del repositorio
python3 -m http.server 8000
# abrir http://localhost:8000/cadena-de-frio/camara-frigorifica/
```

Three.js r168 está incluido en `shared/vendor/three/`, así que funciona sin internet (útil en planta o con un cliente).

## Estructura

```
camara-frigorifica/
├── index.html          5 zonas: controles · escena 3D · KPIs · gráfico temporal · eventos/alarmas/balance
├── css/app.css         tema oscuro, semántica de color, modos Operación/Ingeniería/Simulación
└── js/
    ├── config.js       catálogos (productos, aislamiento, PID), parámetros por defecto, escenarios, colores
    ├── thermal.js      MOTOR TÉRMICO: 24 zonas de aire, paredes, puerta, producto superficie/núcleo, humedad
    ├── refrigeration.js MOTOR DE REFRIGERACIÓN: ventiladores, evaporador ε-NTU, COP, energía, escarcha
    ├── control.js      MOTOR DE CONTROL: ON/OFF con histéresis y PID con anti-windup
    ├── events.js       MOTOR DE EVENTOS: agenda, puerta, ingreso de pallets, fallas, recuperación, pull-down
    ├── alarms.js       alarmas por reglas con retardo, causa probable, impacto y acción sugerida
    ├── explain.js      «¿Qué está pasando?», causa dominante y consecuencias de cada cambio
    ├── sim.js          orquestador de paso fijo (1 s) + corrida sin interfaz para A/B
    ├── scene3d.js      MOTOR VISUAL 3D: sala, puerta, evaporador, racks, pallets, montacargas, mapa térmico, flujo, sensores
    ├── charts.js       gráfico temporal (temperaturas y potencias), cursor compartido, marcadores de eventos
    ├── heat.js         escala térmica semántica única (azul frío · verde normal · amarillo caliente · rojo crítico)
    ├── lessons.js      laboratorio guiado paso a paso
    ├── ui.js           enlace de controles, KPIs, balance, modales, A/B
    └── main.js         arranque y relojes (render separado del reloj de simulación)
```

## Modelo físico (resumen)

| Subsistema | Modelo |
|---|---|
| Aire | 4×3×2 zonas (largo × ancho × nivel). Lazo de aire por rack: techo (evaporador → puerta), baja en la puerta, piso (puerta → evaporador). Mezcla turbulenta ∝ ventilador. Capacidad = aire × 2,5 (estructura). |
| Paredes | Q = U·A·(T_ext − T_zona) por zona expuesta. U: bajo 0,45 · medio 0,25 · alto 0,15 W/m²K. |
| Puerta | Intercambio por diferencia de densidad: V = Cd·(W·H/3)·√(g·H·ΔT/T), Cd = 0,2 (cortina ×0,25). Calor sensible a las zonas de la puerta; humedad al nodo de HR. |
| Producto | Dos nodos por pallet: superficie (12 % de la masa) y núcleo. m·cp·dT/dt = hA·(T_aire − T_s); hA crece con la velocidad del aire (ventilador, bloqueo del rack). Respiración ∝ e^(0,07·T). |
| Humedad | Nodo único: infiltración + transpiración (∝ déficit de presión de vapor) − condensación en el serpentín. Riesgo de condensación = punto de rocío local vs superficie más fría junto a la puerta. |
| Evaporador | ε-NTU con UA ∝ √ventilador y reducido por escarcha. Q = min(capacidad del compresor × u, límite por aire). Parte latente/sensible. |
| Compresor | Capacidad equivalente Q_cool (sin ciclo de refrigerante). T_evap = T_retorno − (3 + 7u). COP = η·T_evap/(T_cond − T_evap), η = 0,55, T_cond = T_ext + 10. |
| Control | Variable: aire de retorno. ON/OFF ±histéresis, mín. 2 min encendido / 3 min apagado. PID: u = Kp·e + Ki·∫e + Kd·de/dt (min), velocidad mínima 25 %. |
| Desescarche | Cada 6 h, 20 min: compresor y ventiladores detenidos, resistencias de 6 kW (35 % al aire). |

Referencias de calibración (escenarios por defecto, 30 kW, 12 × 8 × 6 m, 36–46 pallets de arándano):
- ON/OFF cicla cada ~45 min con ±0,9 °C; PID mantiene ±0,1–0,35 °C con 3–12 % menos energía (mejor COP a carga parcial).
- Puerta abierta 8 min (sin cortina): ~50 kW de carga, zona de la puerta a ~7 °C, recuperación en ~6 min, +1,1 kWh.
- Ingreso de 16 pallets a 15 °C: el compresor se satura por ~4 h; el pull-down del núcleo a 3 °C tarda del orden de 10–13 h,
  que es lo esperable para enfriamiento en cámara (un túnel de aire forzado tarda 2–6 h). Se ajusta con `hA producto`.

Son **supuestos didácticos**: para un proyecto real calibrar U, Cd de puerta, hA del embalaje, curva del compresor
y perfiles de uso con datos de sensores.

## Interfaz

- **Modos:** Operación (temperatura, estado, alarmas, potencia) · Ingeniería (+ carga térmica, balance, refrigeración,
  recuperación, pull-down, condensación, control) · Simulación (+ escenarios, parámetros avanzados, fallas, A/B, +10 min).
- **Escena 3D:** vistas 3D / planta (por nivel) / sección (gradiente vertical). Capas: mapa térmico, flujo de aire
  (partículas cuya velocidad sigue al ventilador), sensores, pallets. Hover técnico y clic para el detalle.
- **Nivel de detalle:** paneles con juntas y zócalo sanitario, piso de concreto con señalización, luminarias LED;
  racks selectivos con bastidores perforados, arriostres, largueros y protecciones; pallets con tarima de 17 piezas,
  36 cartones y film (los cartones exteriores muestran la temperatura de superficie y los interiores la de núcleo);
  puerta con marco, riel, hoja, cortina de tiras y baliza; evaporador con rejillas, 5 aspas por ventilador, bandeja,
  drenaje y LED de estado; unidad condensadora exterior cuyo ventilador gira con el compresor; montacargas con mástil,
  horquillas que elevan el pallet, ruedas y baliza. Todo lo repetido va en `InstancedMesh`.
- **Calidad gráfica:** *Alta* (sombras suaves, reflejos de entorno, film de pallets) o *Media* para equipos modestos.
- **Causa → efecto:** banner de puerta (kW, tiempo, kWh), «¿Por qué cambió la temperatura?», diagrama de balance,
  consecuencias al mover un control, «¿Qué está pasando?» por reglas, controles bloqueados según el contexto.
- **Gráfico temporal:** aire / superficie / núcleo con setpoint y límite de alarma, y un segundo panel de
  potencias (carga, refrigeración, eléctrica) en el mismo eje de tiempo; marcadores de eventos, tabla y CSV.
- **Faceplate TIC-01 (variables de control):** SP operador y SP efectivo (rampa), PV de retorno, error, aportes
  P / I / D, salida calculada y saturación, salida comandada y carga aplicada (MV), estado y tiempo del compresor,
  bloqueo anti-ciclo restante y motivo de retención, arranques/h. Modo **AUTO/MANUAL** con transferencia sin salto,
  **rampa de setpoint**, tiempos mínimos ON/OFF y carga mínima configurables.
- **Variables físicas** (pestañas): *Ciclo* (Q sensible/latente, SHR, T evaporación, ε-NTU, UA con escarcha,
  condensado, presiones de succión/descarga R-404A aprox., relación de compresión, T condensación, lift, COP Carnot/real,
  calor rechazado) · *Aire* (caudal, renovaciones, reparto por pasillo, psicrometría, estratificación) · *Envolvente*
  (conducción, infiltración de puerta sensible/latente, aperturas) · *Producto* (masa, T superficie/núcleo, calor por retirar,
  respiración, pallet más caliente).
- **Perturbaciones rápidas:** corte de energía de 10 min, pulso de puerta de 60 s, condensador sucio (+8 K de condensación)
  y aproximación de condensación ajustable; alarmas nuevas de corte de energía, alta presión de condensación y lazo en manual.
- **Comparación A/B:** dos corridas completas del mismo escenario con la misma semilla (ON/OFF vs PID, ventilador,
  cortina, aislamiento) con tabla de KPI y curvas lado a lado.

## Extender

- **Nuevo escenario:** agregar una entrada en `SCENARIOS` (`config.js`) con parámetros, stock y eventos
  (`door`, `doorCycle`, `ingress`, `fail`).
- **Nuevo producto:** agregar a `PRODUCTS` (cp, kg/pallet, respiración, objetivo, máximo, transpiración, HR óptima).
- **Sensores reales:** reemplazar `sensorsUpdate()` en `sim.js` por un adaptador (MQTT/WebSocket/REST) que escriba
  `T` y `rh` con marca de tiempo y calidad; la escena y los KPI ya leen `st.sensors`.
- **Ciclo frigorífico completo:** sustituir `evaporator()` en `refrigeration.js` por un modelo de compresor +
  condensador + válvula que devuelva los mismos campos (`Q`, `Qs`, `Qlat`, `Tevap`, `Tsup`, `cop`).
- **Más zonas:** `GRID` en `config.js` (la advección asume 2 niveles).

Fuera de alcance del MVP: CFD, psicrometría avanzada, refrigerante, mantenimiento predictivo, MPC, múltiples cámaras e IoT real.
