# Synth-Labs

Simulaciones industriales simplificadas (gemelos digitales ligeros) en HTML/JS puro: sin build ni dependencias.

## ▶ [Abrir el portal de simulaciones](https://luissegurahse.github.io/Synth-Labs/)

Publicado con GitHub Pages desde la rama `main`: cada simulación se abre en el navegador con un clic
(Ctrl/Cmd + clic o clic central para abrirla en otra pestaña). Cada push a `main` se publica solo en 1–2 min.

## Ejecutar en local
```bash
python3 -m http.server 8000   # abrir http://localhost:8000
```
Las simulaciones 2D también abren con doble clic en su `index.html`; la cámara frigorífica 3D necesita servidor (usa módulos JS).

## Publicar en GitHub Pages (una sola vez)
1. En GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
2. **Branch: `main`**, carpeta **`/ (root)`** → **Save**.
3. Esperar 1–2 min: queda en `https://luissegurahse.github.io/Synth-Labs/`. Opcional: en la página del repo, ⚙ junto a **About** → marcar *Use your GitHub Pages website* para que el enlace aparezca arriba a la derecha.

El archivo `.nojekyll` en la raíz evita que GitHub procese los archivos con Jekyll (se sirven tal cual).

## Estructura
```
index.html                      Portal
shared/sim.js                   Motor 2D: bucle de tiempo fijo, RNG con semilla, UI de parámetros, KPIs y tendencias
shared/controls.css · .js       Sistema de controles común (teclas, segmentados, pestañas, faders, interruptores, chips)
shared/style.css                Estilos de las páginas 2D y del portal
shared/vendor/three/            Three.js r168 + OrbitControls + RoomEnvironment (uso sin internet)
<industria>/<simulación>/       index.html autosuficiente + README.md (modelo, supuestos, extensión)
```

| | Industria | Simulación | Pregunta que responde |
|---|---|---|---|
| [▶ Abrir](https://luissegurahse.github.io/Synth-Labs/mineria/acarreo-camiones/) | Minería | `mineria/acarreo-camiones` | ¿Cuántos camiones satura pala/chancador? |
| [▶ Abrir](https://luissegurahse.github.io/Synth-Labs/manufactura/linea-produccion/) | Manufactura | `manufactura/linea-produccion` | ¿Dónde está el cuello de botella y cuánto buffer se necesita? |
| [▶ Abrir](https://luissegurahse.github.io/Synth-Labs/logistica/picking-almacen/) | Logística | `logistica/picking-almacen` | ¿Cuántos pickers cumplen el SLA en hora punta? |
| [▶ Abrir](https://luissegurahse.github.io/Synth-Labs/energia/microrred/) | Energía | `energia/microrred` | ¿Qué PV/batería reduce diésel sin perder servicio? |
| [▶ Abrir](https://luissegurahse.github.io/Synth-Labs/mantenimiento/estrategia-mantenimiento/) | Mantenimiento | `mantenimiento/estrategia-mantenimiento` | ¿Qué umbral preventivo minimiza el costo total? |
| [▶ Abrir](https://luissegurahse.github.io/Synth-Labs/agua/control-nivel-pid/) | Agua/Automatización | `agua/control-nivel-pid` | ¿Qué sintonía PID rechaza la perturbación de demanda? |

## Demos comerciales de transportadores
Ver [`transportadores/`](transportadores/) (8 demos A–H, escenario Hoy vs Propuesto) · [▶ Abrir demo A](https://luissegurahse.github.io/Synth-Labs/transportadores/a-fin-de-linea-carton/)

## Cadena de frío
Ver [`cadena-de-frio/`](cadena-de-frio/) · [▶ Abrir cámara frigorífica 3D](https://luissegurahse.github.io/Synth-Labs/cadena-de-frio/camara-frigorifica/). La **cámara frigorífica 3D** (`cadena-de-frio/camara-frigorifica/`) es un simulador modular con Three.js (incluido en `shared/vendor/three/`, funciona sin internet); en local requiere servidor.

## Agregar una simulación
1. Crear `<industria>/<nombre>/index.html` copiando una existente.
2. Definir `params`, `init`, `step(s,dt,p,rng)`, `draw`, `kpis`, `series` en `SL.app({...})`.
   Opcional (interactividad, ver `agua/control-nivel-pid` como referencia):
   - `vars(s,p) → { fis:[fila], ctl:[fila] }` con `fila = [nombre, valor, unidad, barra0..1, color]`: pestañas **Físicas** y **Control**.
   - `actions: [{ label, kind:'warn'|'crit', on(s,p), run(s,p,rng,api) }]`: botones de perturbación/operación en vivo.
   - `SL.hot(id,x,y,w,h)` dentro de `draw` + `inspect(s,p,id) → { title, sub, fis, ctl, actions }`: tooltip al pasar el cursor e inspector al hacer clic.
   - `SL.log(s, texto, nivel)`: bitácora y marcador en las tendencias. `sec:'…'` en un parámetro agrupa los sliders.
   - `heat: [{ id, label, unit, max, mode:'max'|'sum', fn(s,p) → [[x, y, valor, radio_px], …] }]`: capas de **mapa de calor**
     (selector sobre el lienzo, modo instantáneo o promedio en el tiempo, isolíneas al 25/50/75 %, marcador del pico,
     lectura bajo el cursor). Rampa secuencial naranja de un solo tono: transparente en cero, más claro = mayor valor.
3. Añadir la tarjeta en `index.html` y un `README.md` local.

## Interactividad común (2D)
Todas las simulaciones 2D: clic sobre equipos para inspeccionar sus variables físicas y de control (con acciones propias: forzar falla, reparar, priorizar…), botones de **acciones en vivo**, pestañas KPIs / Físicas / Control, bitácora de eventos con marcadores en el gráfico, leyenda conmutable y cursor con lectura en tendencias, valor exacto al hacer clic en la lectura LCD de cada slider, y atajos **Espacio** (pausa), **R** (reiniciar), **Esc** (cerrar inspector).

## Mapa de calor y nivel de detalle
Cada simulación 2D tiene capas de mapa de calor con variables físicas reales (congestión, utilización, potencia, temperatura, esfuerzo físico, riesgo…), instantáneas o promediadas en el tiempo. El kit `shared/gfx.js` dibuja con volumen y animación: sombras de contacto, metal cepillado, gabinetes con HMI y baliza andon, operarios con EPP completo, cajas con tapa y etiqueta, tarimas, ruedas con llantas que giran, bandas con tacos en movimiento y tambores, tuberías con bridas, tanques con oleaje y escalera, instrumentos de aguja, ventiladores, señalética, demarcación de piso y luminarias.

## Sistema de controles
`shared/controls.css` + `shared/controls.js`: teclas con profundidad y LED, segmentados, pestañas con indicador, faders con escala y relleno, interruptores, chips de capa y lecturas LCD. Lo usan las 2D y la cámara 3D.

El kit `shared/gfx.js` dibuja equipos industriales con detalle (máquinas con panel y LED, operarios con casco, cajas, tarimas, jabas, baldes, colchones, camiones mineros y de reparto, montacargas, pala, chancador, tanque, bomba, tuberías con flechas de flujo, paneles solares, batería, grupo electrógeno, naves, estanterías, chutes y tiendas). El motor 2D (`shared/sim.js`) dibuja en alta densidad (nítido en pantallas retina), sobre un fondo de plano técnico con retícula, con sombras suaves y transportadores con bastidor, guías y rodillos (`SL.belt`).

## Supuestos generales
- Modelos didácticos, semilla fija (42) ⇒ escenarios comparables al reiniciar.
- No sustituyen un estudio calibrado con datos reales (tiempos, MTBF, perfiles de carga).
