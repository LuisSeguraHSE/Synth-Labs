# Fin de línea a pallet (cartón)

**[▶ Abrir simulación](https://luissegurahse.github.io/Synth-Labs/transportadores/a-fin-de-linea-carton/)** · [Portal](https://luissegurahse.github.io/Synth-Labs/) · [Código](./index.html)

**Qué simula:** Fardos/cajas salen de impresora/troquel/pegadora (ciclo 4–8 s) a una banda de 8–12 m con acumulación de 2–3 m y 1 puesto de paletizado. Si la acumulación se llena, la máquina se detiene (luz roja).

**Modelo Hoy vs Propuesto:** Hoy: mesa corta (1.5 m, cap. 2 fardos) + 3 personas en acarreo, paletizado ×1.25 más lento, 2.8 % marcadas / 0.8 % caídas, pallet +90 s por cambio de medida. Propuesto: banda + 1 persona, 0.5 %/0.1 %, +30 s.

**Escenarios/parámetros:** Turno normal vs urgente (cambio de medida cada 20 min: máquina para 60 s).

**KPIs:** Fardos/h máquina vs pallet; minutos de máquina parada; personas en acarreo 3→1; marcadas/caídas.

**Hardware que se vende:** Recta + curva opcional + mesa de acumulación + parada de emergencia. Sin sorter.

**Gancho:** "No le vamos a automatizar la corrugadora. Le quitamos las 3 personas que hoy son el tapón de una máquina que ya pagó."

**Cierre:** Piloto de un solo tramo en un fin de semana; ROI en horas extra y menos reclamos de cartón golpeado.

**Objeción típica:** "Eso lo hace un montacargas." → No saca al ritmo de la pegadora; la banda sí.

**Extender:** agregar datos reales (tiempos de ciclo, layout, turnos), costos (USD/h extra, reclamos) y un KPI de ROI en `kpis()`.
