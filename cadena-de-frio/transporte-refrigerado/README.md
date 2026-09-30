# Transporte refrigerado (última milla)

**[▶ Abrir simulación](https://luissegurahse.github.io/Synth-Labs/cadena-de-frio/transporte-refrigerado/)** · [Portal](https://luissegurahse.github.io/Synth-Labs/) · [Código](./index.html)

**Modelo:** Ruta con N paradas (tramo + descarga); en cada parada la puerta abierta deja entrar aire ambiente. Producto con τ = 60 min.

**Hoy vs Propuesto:** Hoy: sin prefrío (aire +6 °C, producto +2 °C al salir) ni cortina. Propuesto: prefrío, cortina de tiras (×0.4), monitoreo.

**KPIs:** Pico de producto, minutos sobre umbral, alarmas, energía del equipo.

**Parámetros:** Paradas, tramo, descarga, setpoint, umbral, ambiente, capacidad del equipo.

**Supuestos:** modelos de parámetros concentrados (1 nodo aire + 1 nodo producto), sin humedad, sin carga de producto variable.

**Extender:** perfil de ambiente horario real, data loggers (CSV), costo por merma/reclamo, mapa de calor por pallet.
