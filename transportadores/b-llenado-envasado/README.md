# Llenadora → tapa → etiqueta → caja

**[▶ Abrir simulación](https://luissegurahse.github.io/Synth-Labs/transportadores/b-llenado-envasado/)** · [Portal](https://luissegurahse.github.io/Synth-Labs/) · [Código](./index.html)

**Qué simula:** Tres estaciones en serie (6/3/4 s), buffer de 1–2 m, desvío de rechazo a vía corta, encajado de 4 baldes o 6 galones y cambio de lote con 8 min de setup.

**Modelo Hoy vs Propuesto:** Hoy: buffer de 1 pieza, espera humana para cargar la llenadora (0–3 s), derrames al piso, y al cambiar de lote el producto en buffers queda en el piso (retrabajo). Propuesto: buffer configurable, bandeja de derrame (contiene), la banda se vacía en orden.

**Escenarios/parámetros:** Rechazo 0–10 %; lote cada 10–60 min.

**KPIs:** Envases/min efectivos vs teóricos; tiempo de llenadora detenida; derrames/retrabajos; personas 4→2.

**Hardware que se vende:** Banda industrial, guías laterales, bandeja de derrame, motor tapado, desviador simple.

**Gancho:** "Cada vez que la llenadora espera a que alguien cargue un balde, está pagando sueldo de máquina parada."

**Cierre:** Módulo de 10–15 m compatible con su llenadora; no se toca el proceso químico.

**Objeción típica:** "Hay solventes." → Bandeja, motor tapado y paradas visibles; no es una banda de courier.

**Extender:** agregar datos reales (tiempos de ciclo, layout, turnos), costos (USD/h extra, reclamos) y un KPI de ROI en `kpis()`.
