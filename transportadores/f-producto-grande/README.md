# Producto grande (colchón, rollo, panel)

**[▶ Abrir simulación](https://luissegurahse.github.io/Synth-Labs/transportadores/f-producto-grande/)** · [Portal](https://luissegurahse.github.io/Synth-Labs/) · [Código](./index.html)

**Qué simula:** Pieza de 1.5–2 m y 15–40 kg. Turno desde las 07:00; el traslado manual (2 personas, 20 m) se degrada con la fatiga: factor = 1 + 0.0045·(kg/25)·h^1.8.

**Modelo Hoy vs Propuesto:** Hoy: 1 equipo de 2 personas, ida y vuelta, piezas al piso (3 %×fatiga). Propuesto: transportador de listones (0.3 m/s, espaciado 2.4 m), giro 90° lento, mesa de empaque.

**Escenarios/parámetros:** Producción 30–75 pzas/h; peso; largo; distancia.

**KPIs:** Unidades/h primera vs última hora; personas por traslado; m² de pasillo; piezas al piso.

**Hardware que se vende:** Transportador de listones o banda ancha + mesa de empaque/roll-pack. No sorter.

**Gancho:** "Su cuello no es la resortera; es mover el colchón terminado sin matar a la gente a las 4 de la tarde."

**Cierre:** Un tramo de salida a empaque, no la planta completa.

**Objeción típica:** "Es muy custom." → Módulo estándar de 12 m; se personaliza el ancho, no el software.

**Extender:** agregar datos reales (tiempos de ciclo, layout, turnos), costos (USD/h extra, reclamos) y un KPI de ROI en `kpis()`.
