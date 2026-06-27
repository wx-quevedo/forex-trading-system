# ForexBot — FIX: Explorador muestra 0 resultados (oculta las FUERA del rango)

> El usuario corre búsquedas y el reporte muestra "0 resultados" aunque se probaron cientos de combinaciones.

---

## El Problema (diagnosticado)

Resumen real que ve el usuario tras una búsqueda:
> **"432 configuraciones probadas · 0 dentro del rango · mostrando 0"**

- El barrido SÍ funciona: probó las 432 combinaciones, llegó al 100%.
- PERO el reporte **solo muestra las combinaciones DENTRO del rango**. Como ninguna calificó como robusta, muestra 0 filas.
- Las 432 combinaciones evaluadas (la mayoría FUERA del rango / malas) **existen pero están ocultas**.

El usuario quiere ver TODAS las combinaciones probadas — incluidas las malas (en rojo / FUERA del rango) — no solo las DENTRO del rango. Cita textual: "ni siquiera resultados negativos o en rojo".

> Esto NO es un fallo del cálculo (el barrido evalúa bien). Es que el reporte filtra por defecto a solo DENTRO del rango y esconde el resto, dejando la pantalla vacía cuando nada es robusto.

Caso del usuario: RSI en EURUSD# H1, todas las opciones de SL/TP, riesgo 1%, 27/12/2025–27/06/2026. Es plausible que ninguna combinación sea robusta en ese par/timeframe/periodo (ya pasó antes: "todas FUERA del rango"). El sistema es honesto al no marcar ninguna DENTRO; el bug es que entonces no muestra NADA.

---

## La Solución

### 1. Mostrar TODAS las combinaciones evaluadas por defecto
- El reporte debe mostrar **todas las combinaciones que se probaron** (las 432), no solo las DENTRO del rango.
- Ordenadas por **robustez** por defecto (las mejores arriba, aunque sean "límite" o "FUERA"), para que el usuario vea el panorama completo.
- Las FUERA del rango se muestran resaltadas en rojo/atenuado, las DENTRO en verde, las límite en su color — pero TODAS visibles.

### 2. El filtro "solo DENTRO del rango" es OPCIONAL, no el estado por defecto
- Que exista un filtro para ver solo las DENTRO del rango (útil cuando SÍ hay robustas), pero **NO debe estar activado por defecto**.
- Por defecto: ver todo. El usuario activa el filtro si quiere acotar.

### 3. Resumen claro y honesto
- El encabezado del reporte debe decir algo como: **"432 combinaciones probadas · 0 DENTRO del rango · 432 mostradas"**.
- Si 0 están DENTRO del rango, mostrar un mensaje informativo (no alarmante): "Ninguna combinación resultó robusta (DENTRO del rango) en esta búsqueda. Se muestran todas las probadas ordenadas por robustez. Esto suele significar que este par/timeframe/periodo no ofrece una ventaja estable con estos parámetros — prueba otro par, timeframe o tipo de estrategia."
- Así el usuario entiende que el sistema funcionó y por qué no hay robustas, en vez de ver un "0" confuso.

### 4. Verificar que los datos de las FUERA del rango llegan al frontend
- Confirmar que el bridge devuelve TODAS las combinaciones evaluadas (con sus métricas), no solo las que pasan el veredicto DENTRO.
- Si el bridge ya las devuelve todas (probable) y el filtrado a 0 ocurre en el frontend, el fix es de frontend (no filtrar por defecto).
- Si el bridge solo devuelve las DENTRO, ampliarlo para que devuelva todas (con su veredicto), y que el frontend muestre todas.

---

## Comportamiento esperado tras el fix

- Tras una búsqueda, el usuario ve las 432 filas (todas), ordenadas por robustez, la mayoría en rojo (FUERA del rango) si no hay robustas.
- Puede ordenar por cualquier columna (retorno, win rate, etc.) para explorar.
- Puede activar el filtro "solo DENTRO del rango" si quiere ver solo robustas (y si no hay, el filtro mostraría 0 con su mensaje, pero eso sería elección del usuario).
- El mensaje explica por qué no hay robustas cuando es el caso.

---

## Verificación
- Correr la misma búsqueda del usuario (RSI EURUSD# H1, SL/TP todas, riesgo 1%, ese periodo) → el reporte muestra las ~432 combinaciones (no 0), ordenadas por robustez, con las FUERA en rojo.
- El resumen indica cuántas se probaron, cuántas DENTRO, cuántas mostradas.
- Si 0 están DENTRO del rango, hay un mensaje informativo claro.
- El filtro "solo DENTRO" existe pero NO está activo por defecto.
- `tsc` 0 · build OK · verificar EN PANTALLA.

---

*Fix Explorador · mostrar todas las combinaciones probadas por defecto, no solo las DENTRO del rango · resumen honesto*
