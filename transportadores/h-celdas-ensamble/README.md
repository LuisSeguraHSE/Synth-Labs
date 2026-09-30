# Celdas de ensamble (poca banda)

**[▶ Abrir simulación](https://luissegurahse.github.io/Synth-Labs/transportadores/h-celdas-ensamble/)** · [Portal](https://luissegurahse.github.io/Synth-Labs/) · [Código](./index.html)

**Qué simula:** Corte → costura/canto → armado → QC. Órdenes de N piezas; una orden urgente salta la cola (con setup de 3 min por cambio de orden).

**Modelo Hoy vs Propuesto:** Hoy: el lote se mueve completo a la siguiente celda, 2 % de piezas perdidas (retrabajo). Propuesto: FIFO pieza a pieza con tope entre celdas, 0.4 % de pérdida.

**Escenarios/parámetros:** Orden urgente cada 0–180 min; plazo prometido; tiempos por celda.

**KPIs:** Lead time (normal vs urgente); WIP; OTIF; retrabajos.

**Hardware que se vende:** Tramos de 4–8 m o roller entre celdas; el valor es el flujo, no el motor.

**Gancho:** "No le vendemos un almacén automático. Le hacemos visible dónde se esconde el pedido del cliente."

**Cierre:** Estudio de layout (software) + 1 tramo si el WIP está entre dos máquinas concretas.

**Objeción típica:** Usa el costo de la orden urgente para abrir la conversación.

**Extender:** agregar datos reales (tiempos de ciclo, layout, turnos), costos (USD/h extra, reclamos) y un KPI de ROI en `kpis()`.
