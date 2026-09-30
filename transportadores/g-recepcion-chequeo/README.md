# Recepción y chequeo

**[▶ Abrir simulación](https://luissegurahse.github.io/Synth-Labs/transportadores/g-recepcion-chequeo/)** · [Portal](https://luissegurahse.github.io/Synth-Labs/) · [Código](./index.html)

**Qué simula:** Camiones → descarga → puesto de control (conteo/foto/sello) → desviador ok / no conforme → slot o picking.

**Modelo Hoy vs Propuesto:** Hoy: descarga a piso (25 bultos), 3 personas recuentan (14 s/bulto), el camión sale al terminar el recuento, detección 72 %. Propuesto: banda (12 bultos), 1 puesto (3.6 s/bulto), camión sale al terminar de descargar, detección 96 %.

**Escenarios/parámetros:** Camión cada 6–40 min; bultos por camión; % no conformes.

**KPIs:** Bultos/h; tiempo de camión en muelle; espera en patio; diferencias de inventario; personas 3→1.

**Hardware que se vende:** 6–10 m + puesto + desviador binario.

**Gancho:** "El inventario no se pierde en el rack; se pierde en la rampa."

**Cierre:** Ticket chico, decisión del jefe de almacén: PRODISA, droguerías, 3PL, mayoristas.

**Objeción típica:** "Es un ticket chico." → Sí, y por eso decide el jefe de almacén sin comité.

**Extender:** agregar datos reales (tiempos de ciclo, layout, turnos), costos (USD/h extra, reclamos) y un KPI de ROI en `kpis()`.
