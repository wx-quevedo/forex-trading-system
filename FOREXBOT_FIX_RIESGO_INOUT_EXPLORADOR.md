# ForexBot — Explorador: Fix riesgo% (filas aún idénticas) + claridad columnas In/Out

> Tras el reporte anterior: las combinaciones que solo difieren en riesgo% (0.5/1/2) SIGUEN mostrando resultados idénticos en pantalla, pese a que se reportó como resuelto. Además, aclarar qué miden las columnas In/Out.

---

## 1. BUG (persiste) — Riesgo% no cambia el resultado en el reporte del Explorador

### Evidencia en pantalla (reporte real del usuario)
Tres filas consecutivas, idénticas en TODO salvo la columna Riesgo%:
```
RSI EURUSD# H4  period=7 oversold=25 overbought=65  SL50 TP60  riesgo 0.5  → Cap.final $191.40  Costos $52.82  Ret +91.4%  PnL $91.40  ... (★★★★ DENTRO)
RSI EURUSD# H4  period=7 oversold=25 overbought=65  SL50 TP60  riesgo 2    → Cap.final $191.40  Costos $52.82  Ret +91.4%  PnL $91.40  ... (idéntico)
RSI EURUSD# H4  period=7 oversold=25 overbought=65  SL50 TP60  riesgo 1    → Cap.final $191.40  Costos $52.82  Ret +91.4%  PnL $91.40  ... (idéntico)
```
Capital final, costos, retorno, PnL, win%, drawdown, ops → TODO idéntico. Solo cambia la etiqueta de riesgo. **El riesgo% NO está afectando el cálculo en el Explorador.**

### Contradicción a resolver
- Se reportó que el riesgo% "ya funcionaba" y se verificó e2e contra el bridge (riesgo 0.5/1/2 → net −141/−275/−677 en RSI EURUSD# H1).
- PERO en el reporte EN PANTALLA (RSI EURUSD# H4) las filas salen idénticas.
- Posibles explicaciones a investigar:
  1. El barrido del Explorador genera las 3 variantes de riesgo pero **pasa siempre el mismo riesgo al motor** (o un default), aunque etiquete distinto. (El test e2e quizás llamó al motor directamente, no a través del path del barrido del Explorador.)
  2. El backtest de este tipo/símbolo no usa el riesgo% para el sizing en el contexto del barrido (mientras que en el Laboratorio sí).
  3. El resultado del barrido se está deduplicando/cacheando por una clave que IGNORA el riesgo%, devolviendo el mismo resultado para las 3.

### Lo que hay que hacer
- **Reproducir el caso EXACTO en pantalla**: correr el Explorador (no el motor aislado) con RSI EURUSD# H4, SL50/TP60, riesgo [0.5, 1, 2], y confirmar si las 3 filas salen idénticas.
- Rastrear el flujo COMPLETO del riesgo% en el path del Explorador: desde que se genera la combinación → cómo se pasa al worker → cómo el worker llama al backtest → si el backtest aplica el riesgo al sizing.
- Identificar en cuál de esos pasos se pierde/iguala el riesgo.
- Si hay **caché/dedupe por clave** que no incluye el riesgo%, añadir el riesgo% a la clave.
- Verificar que el sizing del backtest DEPENDE del riesgo% (riesgo mayor → posición mayor → PnL y drawdown mayores en valor absoluto).

### Verificación (en pantalla, no solo e2e del motor)
- En el REPORTE del Explorador, para una misma combinación, las filas de riesgo 0.5 / 1 / 2 muestran **capital final, PnL, costos y drawdown DISTINTOS**.
- Coinciden con lo que da el Laboratorio para esos mismos valores de riesgo.
- Confirmar abriendo una de esas filas en el Laboratorio (pestaña nueva) con cada riesgo y comparar.

> Nota: si el riesgo% NO debe afectar a ciertos tipos por cómo está modelado el sizing, decirlo explícitamente; pero dado que el Laboratorio sí muestra diferencias, el Explorador debe igualar ese comportamiento.

---

## 2. Aclarar qué miden las columnas In / Out (y etiquetarlas bien)

### Problema
Las columnas "In" y "Out" muestran valores (ej: 42.42% / 42.3%) cuyo significado exacto NO está claro para el usuario. No se sabe si es retorno por tramo, win rate por tramo, o score de robustez por tramo.

### Solución
- **Definir y documentar** qué métrica representan exactamente In-sample y Out-of-sample en estas columnas (revisar el código del motor: qué valor se pone ahí).
- **Etiquetar las columnas claramente** (ej: "Ret. In-sample" / "Ret. Out-sample" si son retornos, o lo que sean) y añadir un **icono "i" con tooltip** explicando:
  - Qué mide cada una (in = tramo de entrenamiento; out = tramo de validación no visto).
  - **Cómo leerlas:** "Lo bueno es que In y Out se PAREZCAN (consistencia). Si In es alto y Out bajo, la combinación está sobreajustada (overfit). La robustez mide justo esa consistencia."
- Asegurar que la unidad sea coherente y se muestre (%, etc.).
- Esto ayuda al usuario a interpretar el reporte correctamente sin adivinar.

---

## 3. Verificación general
- Las filas que solo difieren en riesgo% ahora muestran resultados distintos (riesgo aplicado de verdad en el path del Explorador).
- Las columnas In/Out están bien etiquetadas, con tooltip que explica qué miden y cómo leerlas.
- `tsc` 0 · build OK · test que cubra el path del Explorador (no solo el motor aislado) con distintos riesgos → resultados distintos · verificar EN PANTALLA con el caso real.

---

*Explorador · arreglar de verdad el riesgo% en el path del barrido (verificado en pantalla) + columnas In/Out claras*
