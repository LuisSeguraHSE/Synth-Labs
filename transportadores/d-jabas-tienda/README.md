# Jabas a tienda

**[▶ Abrir simulación](https://luissegurahse.github.io/Synth-Labs/transportadores/d-jabas-tienda/)** · [Portal](https://luissegurahse.github.io/Synth-Labs/) · [Código](./index.html)

**Qué simula:** Flujo de jabas llenas hacia muelle/tienda y vacías de retorno; torres de 4–6 jabas con peso real; caso "segundo piso".

**Modelo Hoy vs Propuesto:** Hoy: 3 personas con torres (viaje 150 s), la jaba toca el piso, riesgo de caída ∝ (kg/20)². Propuesto: banda modular + elevador (cadencia 3–10 s/jaba), retorno de vacías en banda inferior, sin contacto con piso.

**Escenarios/parámetros:** Volumen 200–900 jabas/h.

**KPIs:** Jabas/h; viajes de personal con torre; tiempo de surtido; incidentes; jabas al piso.

**Hardware que se vende:** Banda modular plástica lavable, elevador, curvas de radio amplio.

**Gancho:** "No es un CD robotizado; es no mandar a alguien con 20 kg por la rampa."

**Cierre:** Piloto de un solo eje (llenas o vacías).

**Objeción típica:** "Es solo para Falabella." → Es el caso grande; el módulo cabe en un CD regional o un mayorista.

**Extender:** agregar datos reales (tiempos de ciclo, layout, turnos), costos (USD/h extra, reclamos) y un KPI de ROI en `kpis()`.
