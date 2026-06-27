# ForexBot — Explorador: Fix riesgo%, paginación, nueva pestaña y advertencia discreta

> Varios fixes sobre el Explorador tras la primera búsqueda grande (19.920 configs, 39 DENTRO del rango, ya rápido con paralelización).

---

## 1. BUG — El riesgo% no afecta el resultado en el Explorador (filas duplicadas)

### Síntoma
En el reporte, aparecen combinaciones idénticas en TODAS las columnas (par, params, SL, TP, capital final, costos, retorno, PnL, win%, etc.) que **solo se diferencian en la columna Riesgo% (0.5, 1, 2)**. Es decir: para el mismo par/tipo/tf/params/SL/TP, las tres variantes de riesgo dan EXACTAMENTE el mismo resultado. El riesgo% no está cambiando nada.

### Diagnóstico (acotado por el usuario)
- En el **Laboratorio**, cambiar el riesgo% SÍ cambia los resultados (el usuario lo probó). → El motor de backtest SÍ sabe usar el riesgo%.
- En el **Explorador**, el riesgo% NO afecta. → El problema está en cómo el **Explorador pasa (o no) el riesgo% a cada backtest** del barrido.

### Causa probable
- El barrido del Explorador genera las combinaciones variando riesgo% en la tabla/etiqueta, pero **NO está pasando ese riesgo% al motor de backtest** (usa un valor fijo o lo ignora), por eso el cálculo es idéntico y solo cambia la etiqueta.
- O el riesgo% se pasa pero el motor en el contexto del Explorador no lo aplica al sizing (mientras que en el Laboratorio sí).

### Solución
- Asegurar que el Explorador **pase el riesgo% de cada combinación al motor de backtest**, igual que lo hace el Laboratorio, y que el motor lo aplique al tamaño de posición / sizing.
- Tras el fix: para una misma combinación, riesgo 0.5 vs 1 vs 2 debe producir **resultados distintos** (distinto tamaño de posición → distinto PnL, capital final, drawdown, etc.).
- Verificar comparando: una combinación concreta con riesgo 0.5, 1 y 2 debe dar 3 resultados diferentes, coherentes con los que daría el Laboratorio para esos mismos valores.

> IMPORTANTE: revisar cómo el Laboratorio aplica el riesgo% y replicar exactamente esa lógica en el barrido del Explorador (misma fuente de verdad, para que coincidan).

---

## 2. Paginación en la tabla de resultados (clásica)

### Problema
La tabla muestra las 19.920 filas de golpe → pesado para el navegador y difícil de navegar.

### Solución
- **Paginación clásica** (páginas 1, 2, 3…) en la tabla de resultados del Explorador.
- Controles: primera/anterior/siguiente/última + número de página + total de páginas.
- Tamaño de página configurable o un default razonable (ej: 50 o 100 filas por página).
- La paginación opera sobre el conjunto YA filtrado y ordenado (si el usuario ordena por una columna o filtra por veredicto/par/tipo, la paginación se aplica al resultado de eso).
- Mostrar "mostrando X–Y de N" para contexto.
- El ordenamiento por columnas y los filtros siguen funcionando junto con la paginación (ordena/filtra el total, luego pagina).
- Export CSV debe exportar TODO el conjunto filtrado (no solo la página visible).

---

## 3. Abrir "Laboratorio" en una pestaña nueva

### Qué se quiere
El botón "Laboratorio" de cada fila del reporte (que carga esa combinación en el Laboratorio para inspeccionarla) debe poder **abrirse en una pestaña nueva del navegador**, para no perder el reporte del Explorador.

### Solución
- Que el botón "Laboratorio" abra el Laboratorio (con esa combinación precargada) en una **pestaña/ventana nueva** (target _blank o equivalente en el router).
- La combinación se pasa por parámetros de URL (tipo, par, tf, params, SL, TP, riesgo, capital, periodo) para que el Laboratorio la cargue al abrir en la nueva pestaña.
- Así el usuario conserva el reporte del Explorador en su pestaña y revisa la candidata en otra.
- Mantener también la opción de "Guardar" como estrategia desde la fila.

---

## 4. Advertencia del azar → icono "i" discreto con tooltip

### Qué se quiere
La advertencia "Cuidado con el azar…" actualmente es un **banner grande** en la parte superior del Explorador. El usuario quiere que sea **pequeña y discreta**: un **icono "i" con tooltip** (al pasar el cursor muestra el texto), en vez del banner que ocupa espacio.

### Solución
- Eliminar el banner grande.
- Poner un **icono "i"** (el `InfoTooltip` ya existente) discreto, junto al título del Explorador o junto al botón Buscar / al encabezado del reporte.
- El tooltip conserva el texto: "Al probar miles de combinaciones, algunas parecerán ganadoras por pura suerte. Fíate de la robustez y del out-of-sample, no del retorno más alto. El reporte ordena por robustez por defecto."
- Mantener el comportamiento de fondo (orden por robustez por defecto) intacto; solo cambia la presentación de la advertencia.

---

## 5. Verificación
- Para una misma combinación, riesgo 0.5 / 1 / 2 dan resultados DISTINTOS (el riesgo% ya afecta); coinciden con lo que daría el Laboratorio.
- Ya no hay filas idénticas que solo difieren en la etiqueta de riesgo.
- La tabla está paginada (páginas 1,2,3…), con "mostrando X–Y de N"; ordenar/filtrar/exportar siguen correctos (export = todo lo filtrado).
- El botón "Laboratorio" de una fila abre el Laboratorio con esa combinación en una pestaña nueva.
- La advertencia del azar es ahora un icono "i" con tooltip, sin banner grande.
- `tsc` 0 · build OK · tests del bridge pasan (si se toca el motor/paso de riesgo) · verificar EN PANTALLA.

---

*Explorador · fix del riesgo% real por combinación + paginación + laboratorio en pestaña nueva + advertencia discreta*
