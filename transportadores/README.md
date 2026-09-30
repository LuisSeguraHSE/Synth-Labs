# Transportadores · demos comerciales

**[▶ Abrir el portal de simulaciones](https://luissegurahse.github.io/Synth-Labs/)**

Cada demo compara **Hoy** vs **Propuesto** (selector "Escenario"), con semilla fija para comparar. Parámetros, KPIs y supuestos editables; los valores por defecto son supuestos didácticos que deben calibrarse con datos del cliente.

| | Demo | Carpeta | Gancho |
|---|---|---|---|
| [▶ Abrir](https://luissegurahse.github.io/Synth-Labs/transportadores/a-fin-de-linea-carton/) | Fin de línea a pallet (cartón) | `a-fin-de-linea-carton/` | "No le vamos a automatizar la corrugadora. Le quitamos las 3 personas que hoy son el tapón de una máquina que ya pagó." |
| [▶ Abrir](https://luissegurahse.github.io/Synth-Labs/transportadores/b-llenado-envasado/) | Llenadora → tapa → etiqueta → caja | `b-llenado-envasado/` | "Cada vez que la llenadora espera a que alguien cargue un balde, está pagando sueldo de máquina parada." |
| [▶ Abrir](https://luissegurahse.github.io/Synth-Labs/transportadores/c-packing-ecommerce/) | Packing e-commerce / courier | `c-packing-ecommerce/` | "El camión no espera. Si el packing no rinde a las 7 pm, el pedido viaja mañana y el cliente se queja." |
| [▶ Abrir](https://luissegurahse.github.io/Synth-Labs/transportadores/d-jabas-tienda/) | Jabas a tienda | `d-jabas-tienda/` | "No es un CD robotizado; es no mandar a alguien con 20 kg por la rampa." |
| [▶ Abrir](https://luissegurahse.github.io/Synth-Labs/transportadores/e-clasificador-compacto/) | Clasificador chico (4–6 destinos) | `e-clasificador-compacto/` | "No es el sorter de 150 mil unidades. Es el de 1.500–4.000 bultos/hora que les quita la fila de las 6 pm." |
| [▶ Abrir](https://luissegurahse.github.io/Synth-Labs/transportadores/f-producto-grande/) | Producto grande (colchón, rollo, panel) | `f-producto-grande/` | "Su cuello no es la resortera; es mover el colchón terminado sin matar a la gente a las 4 de la tarde." |
| [▶ Abrir](https://luissegurahse.github.io/Synth-Labs/transportadores/g-recepcion-chequeo/) | Recepción y chequeo | `g-recepcion-chequeo/` | "El inventario no se pierde en el rack; se pierde en la rampa." |
| [▶ Abrir](https://luissegurahse.github.io/Synth-Labs/transportadores/h-celdas-ensamble/) | Celdas de ensamble (poca banda) | `h-celdas-ensamble/` | "No le vendemos un almacén automático. Le hacemos visible dónde se esconde el pedido del cliente." |

Ejecutar: `python3 -m http.server 8000` en la raíz del repo y abrir `/transportadores/<demo>/`.
