# ForexBot — Fase 9: Bot Histórico (Validación Walk-Forward) + Favoritos + Dashboard Comparativo

> Nueva sección que simula que una o varias estrategias operaron desde una fecha de inicio hasta hoy (periodo SEPARADO del backtest), y compara el desempeño "real-simulado" contra lo que prometió el backtest. Más un sistema de Favoritos para marcar estrategias desde el Explorador y el Laboratorio.

---

## CONCEPTO CENTRAL: validación walk-forward

El problema más importante del trading sistemático: **¿la estrategia se comporta en la realidad como prometió el backtest?** Una estrategia puede verse genial en el periodo donde se optimizó (backtest) y fallar en datos posteriores (degradación / overfit no detectado).

**La idea del usuario (correcta y estándar en la industria):** separar dos periodos.
- **Periodo de backtest/optimización:** ej. 01/01/2025 → 31/12/2025 (donde se eligió la estrategia).
- **Periodo de "operación" (walk-forward):** ej. 01/01/2026 → 27/06/2026 (datos POSTERIORES, que la estrategia nunca "vio").

El Bot Histórico simula la operación en el periodo posterior y **compara**: ¿el retorno, win rate, drawdown, etc. del periodo nuevo se parecen a los del backtest? Si sí → la estrategia es robusta de verdad. Si el desempeño se degrada mucho → era overfit / suerte.

> Esto es DISTINTO del backtest normal y del split in/out del optimizador: aquí el usuario define explícitamente la fecha de corte y ve el desempeño "hacia adelante" como si hubiera operado en vivo desde esa fecha, con dinero, hasta hoy.

---

## PARTE 1 — El Bot Histórico (motor y simulación)

### Entrada
- Una o varias **estrategias** (elegidas de Favoritos, ver Parte 4, o configuradas).
- Cada estrategia con su **capital inicial propio** (configurable por estrategia).
- Una **fecha de inicio de operación** (ej. 01/01/2026). El fin es "hasta hoy" (o una fecha fija configurable).
- (El periodo de backtest de referencia de cada estrategia se conserva para comparar — ver indicadores.)

### Simulación
- Para cada estrategia, simular operaciones desde la fecha de inicio hasta hoy usando el MISMO motor de backtest honesto (costos reales, quiebra de cuenta, etc.).
- Es una simulación sobre datos históricos reales del periodo posterior (no es operar en vivo; es "qué habría pasado si hubiera operado desde esa fecha").
- Respetar la regla de quiebra (capital no negativo), costos, etc.

### Importante (anti-trampa)
- El periodo de operación debe ser POSTERIOR (o al menos distinto) al de backtest, idealmente sin solaparse, para que la comparación sea honesta (walk-forward real).
- Avisar si el periodo de operación se solapa con el de backtest (no sería validación limpia).

---

## PARTE 2 — Indicadores (los del backtest + nuevos walk-forward)

Para cada estrategia, mostrar lado a lado:

### A) Métricas del periodo de OPERACIÓN (walk-forward), las mismas del backtest:
- Retorno neto %, PnL neto, Capital final
- Win rate %, Profit Factor, Max Drawdown %
- Nº de operaciones, Costos totales
- (Todas calculadas sobre el periodo de operación.)

### B) Métricas del BACKTEST de referencia (recordadas de cuando se eligió la estrategia):
- Las mismas, del periodo de backtest, para comparar.

### C) NUEVOS indicadores walk-forward (comparan A vs B) — lo valioso:
- **Degradación de retorno:** (retorno operación − retorno backtest) o ratio. ¿Mantiene, mejora o empeora?
- **Consistencia de win rate:** diferencia entre win rate de operación y de backtest.
- **Consistencia de drawdown:** ¿el DD de operación se mantuvo dentro de lo esperado o se disparó?
- **Ratio de cumplimiento:** % del rendimiento esperado que realmente se logró (ej. backtest prometía +X% anualizado; operación logró +Y% anualizado → Y/X).
- **Anualización:** como los periodos tienen distinta duración (ej. 12 meses backtest vs 6 meses operación), anualizar retornos para comparar manzanas con manzanas (ej. +5% en 6 meses ≈ +10% anualizado).
- **Veredicto de coherencia:** una etiqueta clara — "CUMPLE / SE DEGRADA / FALLA" — según si el desempeño walk-forward respeta lo prometido por el backtest (con umbrales razonables). Esto responde directamente la pregunta del usuario: "¿se está comportando como esperábamos?".
- **Correlación de la curva de equity** (si es factible): ¿la forma de la curva de operación se parece a la del backtest?

> Objetivo: que de un vistazo el usuario sepa si la estrategia que eligió por el backtest está cumpliendo en datos nuevos, o si era un espejismo.

---

## PARTE 3 — Dashboard: por estrategia, comparativo y suma global

### Vista por estrategia
- Tarjeta/panel por cada estrategia con: sus parámetros (par, tipo, tf, SL, TP, riesgo, capital), métricas A (operación), B (backtest) y C (walk-forward), y veredicto de coherencia.
- **Dos gráficas por estrategia:**
  1. **Gráfica de trading:** precio del periodo de operación con las entradas/salidas marcadas (como el chart del laboratorio).
  2. **Gráfica de evolución:** equity / capital y otros indicadores acumulables a lo largo del tiempo (curva de equity, drawdown, PnL acumulado). Poder elegir qué indicadores mostrar en la gráfica.

### Vista comparativa (varias estrategias)
- Tabla/panel comparando todas las estrategias seleccionadas (sus métricas lado a lado), para ver cuál cumple mejor su backtest.
- Gráfica con las curvas de equity de todas las estrategias superpuestas (comparar evolución).

### Panel de SUMA GLOBAL (agregado de todas)
- Cada estrategia tiene su capital propio; el panel global calcula los agregados con la terminología adecuada:
  - **Capital inicial global** = suma de capitales iniciales de las estrategias.
  - **Capital actual global** = suma de capitales finales.
  - **Ganancia global / Pérdida global** = suma de PnL positivos / negativos (y PnL neto global).
  - **Retorno global %** = (capital actual global − inicial global) / inicial global.
  - **Drawdown global** = drawdown de la curva de equity agregada (sumando las equity de todas en el tiempo) — NO la suma de drawdowns individuales (eso sería incorrecto; el DD global se calcula sobre la curva combinada).
  - **Nº total de operaciones, costos totales, win rate global ponderado**, etc.
  - Resumen tipo "si todas estas estrategias hubieran operado desde la fecha de inicio, hoy tendrías: capital $X, ganancia $Y, retorno Z%".
- **Gráfica de equity global:** la suma de las curvas de todas las estrategias en el tiempo (el "cómo iría tu cuenta total"). Más la opción de ver indicadores agregados.

> Aclarar bien los términos: capital inicial vs actual, ganancia bruta vs neta, PnL realizado, drawdown sobre curva agregada. Usar nombres correctos para que el panel sea educativo y preciso.

---

## PARTE 4 — Favoritos (marcar y reutilizar estrategias)

### Marcar favoritos
- **Desde el Explorador:** en cada fila del reporte, un botón/ícono "Añadir a favoritos" (estrella) que guarda esa combinación (par, tipo, tf, params, SL, TP, riesgo, capital, periodo de backtest, y sus métricas de backtest).
- **Desde el Laboratorio:** cuando se optimiza/prueba una estrategia, un botón "Añadir a favoritos" que la guarda igual.
- Guardar en la BD (persistente, sobrevive reinicios).

### Panel de Favoritos
- Una sección/página "Favoritos" que lista todas las estrategias marcadas, con sus parámetros y métricas de backtest guardadas.
- Poder quitar de favoritos, y ver/abrir cada una (ej. abrir en el Laboratorio).

### Uso en el Bot Histórico
- En el Bot Histórico, poder **elegir estrategias desde Favoritos** (en vez de configurarlas a mano) para simular su operación walk-forward.
- Así el flujo completo es: explorar → marcar favoritas las candidatas buenas → en el Bot Histórico, seleccionarlas, ponerles fecha de inicio de operación → ver cómo se comportan en datos nuevos y comparar con su backtest.

---

## Página / ubicación
- Nueva sección en el nav: "Bot Histórico" (o "Walk-Forward").
- Favoritos: sección propia o accesible desde el nav.
- Reusar el motor de backtest honesto y los componentes de gráficas existentes (chart de trading del laboratorio, curvas de equity).

---

## Verificación
- **Bot Histórico:** elegir una estrategia (de favoritos), darle fecha de inicio de operación (posterior al backtest), simular → muestra métricas del periodo de operación.
- **Comparación walk-forward:** muestra las métricas del backtest, las de operación, y los indicadores de degradación/cumplimiento + veredicto de coherencia (CUMPLE/SE DEGRADA/FALLA). Anualización correcta cuando los periodos difieren en duración.
- **Multi-estrategia:** varias estrategias a la vez, cada una con su panel; tabla comparativa; curvas de equity superpuestas.
- **Suma global:** capital inicial/actual global, ganancia/pérdida global, retorno global, DD sobre curva agregada (no suma de DDs), totales de ops/costos, todo con términos correctos; gráfica de equity global.
- **Dos gráficas** por estrategia (trading + evolución de indicadores) y agregadas; poder elegir indicadores en la gráfica.
- **Favoritos:** marcar desde Explorador y Laboratorio; panel de favoritos; quitar; elegir favoritos en el Bot Histórico. Persistente.
- `tsc` 0 · build OK · bridge/Laravel tests · verificar EN PANTALLA.

---

## Nota de orden (entrega por partes)
1. **Favoritos** (marcar desde Explorador/Laboratorio + panel) — base para lo demás.
2. **Bot Histórico** mono-estrategia (simulación walk-forward + métricas A/B/C + veredicto + 2 gráficas).
3. **Multi-estrategia + dashboard comparativo + suma global**.

---

## PENDIENTE DE INVESTIGAR (NO implementar aún)
- **Integración de noticias:** correlacionar movimientos del mercado con noticias que pudieron influir, y evaluar si influyeron o no. El usuario quiere investigarlo primero (fuentes de noticias, cómo fechar/cuantificar impacto, si añade valor real al trading algorítmico o introduce ruido). Documentar aparte tras investigar.

---

*Fase 9 · Bot Histórico (walk-forward) + Favoritos + dashboard comparativo y suma global · responde "¿la estrategia cumple en datos nuevos lo que prometió el backtest?"*
