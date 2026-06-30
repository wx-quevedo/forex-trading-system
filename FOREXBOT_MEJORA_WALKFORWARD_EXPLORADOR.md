# ForexBot — Mejora: Validación Walk-Forward Automática del Top-N en el Explorador

> Surge de usar la plataforma: hoy el flujo es Explorador (Prioridad) → Laboratorio (corroborar) → Favoritos → Bot Histórico (validar en otro rango) → decidir. Es manual y lento, fila por fila. Esta mejora AUTOMATIZA el paso de validación walk-forward para las mejores candidatas, directamente en el Explorador, para ir directo a las que funcionan en backtest Y se sostienen en datos nuevos.

---

## CONTEXTO Y MOTIVACIÓN

El usuario ya tiene el flujo completo funcionando y entiende la lógica: el backtest siempre se ve mejor que la realidad (está optimizado sobre datos conocidos), y el walk-forward (validar en un rango que el optimizador NO vio) revela si el edge es real. Observó correctamente que las estrategias "se degradan pero a veces siguen rentables" — eso es normal y esperado en una estrategia honesta; lo que hay que detectar es cuándo se degrada a PÉRDIDA (como la ma_cross que pasó de +74% backtest a −76% walk-forward).

**Objetivo:** que el Explorador, para las mejores candidatas (top-N por Prioridad), corra automáticamente el walk-forward y muestre indicadores comparativos backtest-vs-operación, para filtrar directo a las que cumplen en ambos.

---

## DECISIONES YA TOMADAS (con el usuario)

1. **Alcance del cómputo: solo el TOP-N por Prioridad.** NO correr walk-forward para todas las filas (sería carísimo: el walk-forward es mucho más costoso que un backtest, y hay decenas de miles de combinaciones). Solo las N mejores por Prioridad — que son las únicas que interesan. N configurable (sugerencia: default 20, ajustable).

2. **Tres indicadores comparativos** (los tres, no uno):
   - **Ratio de cumplimiento** (%): qué tan fiel es la operación (walk-forward) al backtest. Ej: backtest +20%, walk-forward +18% → ~90% cumplimiento. Si backtest +74% y walk-forward −76% → cumplimiento negativo/muy bajo.
   - **Veredicto CUMPLE / SE DEGRADA / FALLA**: igual que el Bot Histórico ya calcula. Reusar esa misma lógica.
   - **Capital final del walk-forward** mostrado al lado del capital final del backtest, para comparación directa visual.

---

## DISEÑO DE LA FUNCIÓN

### Flujo propuesto
1. El usuario corre una exploración normal (genera las miles de filas con su Prioridad).
2. Tras calcular la Prioridad, el sistema toma las **top-N filas por Prioridad** y, para cada una, corre el walk-forward (reusando la MISMA lógica/motor que el Bot Histórico ya usa — `/backtests/ephemeral` o lo que corresponda).
3. Esas N filas se enriquecen con las 3 columnas nuevas (ratio cumplimiento, veredicto, capital final WF).
4. El usuario puede ordenar/filtrar por estas columnas → va directo a las que cumplen en backtest Y walk-forward.

### El punto MÁS DELICADO: ¿qué rango usa el walk-forward?
Esto es conceptualmente crítico y hay que resolverlo bien. El walk-forward debe validar en datos que el optimizador NO vio. Opciones:
- **El Bot Histórico hoy** usa un rango de OPERACIÓN distinto al del backtest (el usuario lo pone manualmente). 
- **Para automatizar**, el sistema necesita definir ese rango automáticamente. Propuesta: dividir el periodo del contexto en dos — una parte para el backtest/optimización (in-sample) y otra POSTERIOR para el walk-forward (out-of-sample), que el optimizador no tocó. O usar un rango posterior al contexto si hay datos disponibles.
- **IMPORTANTE:** el optimizador anti-overfit YA hace un split in/out-sample internamente (lo vemos en las columnas InSample%/OutSample%). Hay que clarificar: ¿este walk-forward automático es lo mismo que ya hace el optimizador, o es una validación ADICIONAL en un rango aún más nuevo? 
  - Si es lo mismo → quizá ya tenemos la info y solo hay que exponerla mejor (más barato).
  - Si es adicional (un tercer tramo, posterior, totalmente fresco) → es más valioso pero requiere correr el walk-forward de verdad.
- **El agente debe aclarar esta distinción en su plan** y proponer el enfoque más correcto y honesto. La pregunta clave: ¿qué aporta este walk-forward automático que las columnas In/Out-sample del optimizador no aporten ya?

### Cómputo y rendimiento
- Walk-forward solo para top-N (default 20). Estimar el costo: N walk-forwards adicionales por corrida.
- ¿Se corre automáticamente al terminar la exploración, o bajo un botón "validar top-N" que el usuario dispara cuando quiere? (Sugerencia: botón, para no encarecer cada exploración; el usuario decide cuándo validar.)
- Cachear los resultados del walk-forward (como se cachean los backtests) para no recalcular.

### Veredicto y ratio: definiciones
- Reutilizar la lógica de veredicto del Bot Histórico (CUMPLE/SE DEGRADA/FALLA) — NO reinventarla, para consistencia.
- Ratio de cumplimiento: definir con cuidado. Sugerencia: (retorno_walkforward_anualizado / retorno_backtest_anualizado) × 100, acotado. Considerar casos: si el backtest es positivo y el WF negativo → cumplimiento ≤ 0 (FALLA). El agente propone la fórmula exacta y la justifica.

---

## INTEGRACIÓN CON LO EXISTENTE
- Reusar el motor de walk-forward del Bot Histórico (no duplicar lógica).
- Respetar el modo ATR y el periodo ATR de cada fila (que ya viajan correctamente tras los fixes recientes).
- Las 3 columnas nuevas deben entrar en el CSV exportado.
- Considerar la interacción con la columna Prioridad: ¿la Prioridad debería incorporar el resultado del walk-forward cuando esté disponible? (Probablemente NO en primera versión — mantener Prioridad como score de backtest, y las columnas WF como validación separada. Pero anotarlo como posible evolución: una "Prioridad ajustada por walk-forward".)

---

## PREGUNTAS PARA EL AGENTE (a resolver en el plan)
1. ¿El walk-forward automático es distinto del split in/out que el optimizador ya hace? ¿Qué aporta de nuevo? (Crítico — si es redundante, replantear.)
2. ¿Qué rango usa para el walk-forward, definido automáticamente? Propón el enfoque más honesto (sin data leakage: el WF nunca debe tocar datos que el optimizador usó).
3. ¿Automático al terminar la exploración o bajo botón "validar top-N"? (Por costo, probablemente botón.)
4. Costo de cómputo estimado para N=20. ¿Aceptable?
5. Caché de los walk-forwards.
6. Decisión de ENGINE_VERSION (probablemente sin cambios — es validación/análisis, no cambia la lógica de trades del backtest base).

---

## PRINCIPIO RECTOR
El objetivo es ir DIRECTO a las candidatas que cumplen en backtest Y se sostienen en datos nuevos, ahorrando el ciclo manual Explorador→Lab→Favoritos→BotHistorico. Pero sin sacrificar el rigor: el walk-forward debe ser honesto (sin data leakage), y la degradación normal (sigue rentable) debe distinguirse de la degradación grave (cae a pérdida). Una estrategia que "se degrada pero sigue rentable" es ACEPTABLE; una que "se degrada a pérdida" se DESCARTA.

---

*Mejora · walk-forward automático del top-N en el Explorador · 3 indicadores (ratio cumplimiento + veredicto CUMPLE/SE DEGRADA/FALLA + capital final WF) · ahorra el ciclo manual de validación · el punto delicado es el rango del WF sin data leakage*
