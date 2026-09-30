# Synth-Labs

Simulaciones industriales simplificadas (gemelos digitales ligeros) en HTML/JS puro: sin build ni dependencias.

## Ejecutar
```bash
python3 -m http.server 8000   # abrir http://localhost:8000
```
(también funciona abriendo cada `index.html` directamente).

## Estructura
```
index.html                      Portal
shared/sim.js                   Motor: bucle de tiempo fijo, RNG con semilla, UI de parámetros, KPIs y tendencias
shared/style.css                Estilos comunes
<industria>/<simulación>/       index.html autosuficiente + README.md (modelo, supuestos, extensión)
```

| Industria | Simulación | Pregunta que responde |
|---|---|---|
| Minería | `mineria/acarreo-camiones` | ¿Cuántos camiones satura pala/chancador? |
| Manufactura | `manufactura/linea-produccion` | ¿Dónde está el cuello de botella y cuánto buffer se necesita? |
| Logística | `logistica/picking-almacen` | ¿Cuántos pickers cumplen el SLA en hora punta? |
| Energía | `energia/microrred` | ¿Qué PV/batería reduce diésel sin perder servicio? |
| Mantenimiento | `mantenimiento/estrategia-mantenimiento` | ¿Qué umbral preventivo minimiza el costo total? |
| Agua/Automatización | `agua/control-nivel-pid` | ¿Qué sintonía PID rechaza la perturbación de demanda? |

## Demos comerciales de transportadores
Ver `transportadores/README.md` (8 demos A–H, escenario Hoy vs Propuesto).

## Agregar una simulación
1. Crear `<industria>/<nombre>/index.html` copiando una existente.
2. Definir `params`, `init`, `step(s,dt,p,rng)`, `draw`, `kpis`, `series` en `SL.app({...})`.
3. Añadir la tarjeta en `index.html` y un `README.md` local.

## Supuestos generales
- Modelos didácticos, semilla fija (42) ⇒ escenarios comparables al reiniciar.
- No sustituyen un estudio calibrado con datos reales (tiempos, MTBF, perfiles de carga).
