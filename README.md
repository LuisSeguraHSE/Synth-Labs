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
shared/sim.js                   Motor: bucle de tiempo fijo, RNG con semilla, UI de parámetros, KPIs y tendencias
shared/style.css                Estilos comunes
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
3. Añadir la tarjeta en `index.html` y un `README.md` local.

## Supuestos generales
- Modelos didácticos, semilla fija (42) ⇒ escenarios comparables al reiniciar.
- No sustituyen un estudio calibrado con datos reales (tiempos, MTBF, perfiles de carga).
