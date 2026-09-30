# Clasificador chico (4–6 destinos)

**[▶ Abrir simulación](https://luissegurahse.github.io/Synth-Labs/transportadores/e-clasificador-compacto/)** · [Portal](https://luissegurahse.github.io/Synth-Labs/) · [Código](./index.html)

**Qué simula:** Lazo de 30 m con inducción, lectura (3 % sin lectura → rechazo), desviadores a chutes (Lima, Norte, Sur, Aéreo, Sierra, Selva) y recirculación si el chute está lleno (máx. 3 vueltas). Mix: bolsa, caja, irregular.

**Modelo Hoy vs Propuesto:** Hoy: 6 personas llevan cada bulto (250 bultos/h/persona, error 3 %). Propuesto: 2 personas (inducción + excepciones), error 0.4 %.

**Escenarios/parámetros:** Volumen 300–4000 bultos/h; destinos 4–6; capacidad y retiro de chute.

**KPIs:** Bultos/h; % bien clasificado; % recirculado; personas 6→2; payback (inversión y costo por persona editables).

**Hardware que se vende:** Banda + desviadores + chutes + sensor. Presupuesto mediano.

**Gancho:** "No es el sorter de 150 mil unidades. Es el de 1.500–4.000 bultos/hora que les quita la fila de las 6 pm."

**Cierre:** 4 destinos reales de su red; el quinto se agrega después.

**Objeción típica:** "Muy caro para el volumen." → Baja el volumen y mira el payback: debajo del punto de equilibrio, no insistas.

**Extender:** agregar datos reales (tiempos de ciclo, layout, turnos), costos (USD/h extra, reclamos) y un KPI de ROI en `kpis()`.
