# Packing e-commerce / courier

**Qué simula:** Olas de 40–80 pedidos a 4–8 puestos; packing 45/65/90 s (sobre/caja/frágil); salida a 3 chutes (Lima/Norte/Sur). Pico 17:00–20:00 (ola cada 15 min vs 40 min).

**Modelo Hoy vs Propuesto:** Hoy: cola en el piso, +14 s de caminata por pedido, estorbo 7 % por puesto sobre 4, error 1.2 %. Propuesto: cola en banda (30 pedidos), +3 s, sin estorbo, error 0.4 %.

**Escenarios/parámetros:** Cutoff del courier 18–21 h; mix de frágiles.

**KPIs:** Pedidos/h por persona; salidas post-cutoff; m² de pasillo con WIP; error de ítem.

**Hardware que se vende:** Banda + uniones + mesas + opcional desviador a 3 destinos. No un sorter de 40 destinos.

**Gancho:** "El camión no espera. Si el packing no rinde a las 7 pm, el pedido viaja mañana y el cliente se queja."

**Cierre:** 4 puestos de prueba; si no sube pedidos/hora, no se amplía.

**Objeción típica:** "Con más gente se resuelve." → Sube puestos en "Hoy": se estorban; el límite es el layout.

**Extender:** agregar datos reales (tiempos de ciclo, layout, turnos), costos (USD/h extra, reclamos) y un KPI de ROI en `kpis()`.
