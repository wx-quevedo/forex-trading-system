# ForexBot — Documento Maestro de Implementación

> Consolidación de las "Propuestas de implementación" de los 6 puntos de investigación (P1-P6), organizadas por PRIORIDAD y SINERGIA (no por número de punto). Este es el documento que el agente Claude Code ejecuta, fase por fase, tras la ronda de investigación completa.
>
> **Fuentes:** `FOREXBOT_INVESTIGACION_P1..P6_*.md` (todas en este mismo directorio).
> **Metodología:** cada fase es autocontenida, verificable en pantalla, y con tests. No avanzar a la siguiente fase sin verificar la anterior.

---

## PRINCIPIO RECTOR DE TODA LA IMPLEMENTACIÓN

Lo aprendido en la investigación, en una frase: **el valor no está en predecir el futuro ni en acumular indicadores, sino en gestionar el riesgo, filtrar por contexto (régimen/volatilidad), y adaptar a la volatilidad real.** Todo lo que sigue sirve a ese principio. Cada estrategia o métrica nueva DEBE pasar por el rigor anti-overfit que ya existe (in/out sample, walk-forward del Bot Histórico).

---

## EL HALLAZGO CONVERGENTE (máxima prioridad)

**El SL/TP adaptativo por ATR apareció como propuesta #1 en TRES investigaciones independientes (P1, P3, P6).** Es la señal más fuerte de toda la ronda. Por eso es la Fase 1. Razones convergentes:
- **P1:** los indicadores solos rinden 35-45%; la gestión de salida por ATR mejora todo el conjunto.
- **P3:** la adaptación por volatilidad (ATR) es la ÚNICA adaptación robusta que no intenta predecir el futuro.
- **P6:** el sizing y los stops basados en volatilidad son el estándar profesional de gestión de riesgo.
- **Caso de prueba:** el oro (GOLD#) fue un páramo destructivo con SL/TP fijos porque sus retrocesos violentos saltaban los stops. Con SL/TP por ATR, podría dejar de serlo. Es la hipótesis a validar.

---

# FASE 1 — SL/TP ADAPTATIVO POR ATR ⭐ (máxima prioridad, 3× convergente)

**Objetivo:** permitir que el stop loss y el take profit se definan como múltiplos de ATR (volatilidad real) además de pips fijos.

**Alcance:**
1. Añadir el cálculo de ATR (Average True Range) al motor de backtest/exploración. Período configurable (default 14).
2. En el Explorador/Laboratorio, permitir definir SL y TP en DOS modos:
   - **Modo fijo (actual):** SL/TP en pips. No romper lo existente.
   - **Modo ATR (nuevo):** SL = N × ATR, TP = M × ATR (ej. SL=2×ATR, TP=3×ATR). N y M configurables en el grid.
3. El sizing de posición debe seguir respetando la regla de riesgo: el tamaño se calcula desde la distancia real al stop (que ahora puede ser variable por ATR), manteniendo el riesgo en $ constante (riesgo% × capital / distancia_al_SL). **Verificar que el motor ya hace esto correctamente** (era una pregunta abierta de P6).
4. Registrar en los resultados qué modo se usó (fijo vs ATR) para poder comparar.

**Validación / caso de prueba:**
- Re-correr el oro (GOLD#) con SL/TP por ATR y comparar contra el resultado catastrófico con SL/TP fijo. ¿Mejora? Documentar el hallazgo.
- Verificar en pantalla que el sizing mantiene el riesgo en $ constante aunque el SL varíe.

**Tests:** cálculo de ATR correcto; sizing con SL variable; no romper modo fijo; persistencia en caché (el modo y params deben ser parte de la clave SHA-1).

---

# FASE 2 — MÉTRICAS DE RIESGO PROFESIONALES (P6)

**Objetivo:** evaluar las estrategias por calidad ajustada por riesgo, no solo por retorno.

**Alcance:**
1. Añadir al reporte del Explorador y del Bot Histórico:
   - **Sharpe ratio** (retorno excedente / volatilidad).
   - **Sortino ratio** (penaliza solo volatilidad a la baja).
   - **Calmar ratio** (retorno anualizado / máx drawdown). NOTA: ya tenemos "Retorno/DD" que es esencialmente esto — formalizarlo/renombrarlo como Calmar.
   - **Expectativa matemática:** columna que combine win% × R/R (donde R/R = TP/SL). Para ver si la expectativa es positiva, no mirar el retorno aislado. CLAVE para juzgar candidatas con R/R desfavorable pero win alto (como USDCAD SL50/TP40).
2. Estas métricas deben poder usarse para ORDENAR/filtrar en el Explorador (ej. "ordenar por Sharpe").
3. Tooltips explicando cada métrica (consistente con los tooltips del Bot Histórico).

**Tests:** cálculo correcto de cada ratio contra casos conocidos; manejo de división por cero (DD=0); ordenamiento.

---

# FASE 3 — CLASIFICADOR DE RÉGIMEN DE MERCADO (P2) + ADX (P1)

**Objetivo:** detectar si el mercado está en tendencia, rango o alta volatilidad, y usarlo como contexto. Esto explica retroactivamente el desastre del oro (reversión aplicada a una tendencia) y el éxito de USDCAD (reversión en rangos aprovechables).

**Alcance:**
1. Implementar un **clasificador de régimen** sobre una ventana de datos, combinando (voto compuesto):
   - **ADX** (>25 = tendencia fuerte; <20 = rango). ADX también queda disponible como indicador/filtro reutilizable.
   - **Efficiency Ratio** (Kaufman): qué tan "limpio" es el movimiento.
   - **MA200**: precio sobre/bajo = sesgo de tendencia macro.
   - **ATR** (ya de Fase 1): nivel de volatilidad.
   - Salida: etiqueta de régimen (TENDENCIA_ALCISTA / TENDENCIA_BAJISTA / RANGO / VOLÁTIL) + confianza.
2. Mostrar el régimen detectado del periodo analizado en el Explorador, Favoritos y Bot Histórico.
3. **Indicador MATCH / MISMATCH:** etiquetar cada tipo de estrategia con su régimen idóneo (reversión→rango; tendencia→tendencia) y mostrar si la estrategia COINCIDE con el régimen del periodo. Un MISMATCH explica por qué una estrategia "buena" falló (como el oro).

**Validación:** verificar que el oro en su periodo se clasifica como TENDENCIA (lo que explica por qué las estrategias de reversión fallaron), y USDCAD como RANGO/mixto.

**Tests:** cada componente del clasificador; voto compuesto; etiquetado MATCH/MISMATCH.

---

# FASE 4 — NUEVAS ESTRATEGIAS DE TENDENCIA Y MOMENTUM (P1)

**Objetivo:** ampliar el arsenal, sobre todo en TENDENCIA (donde solo teníamos ma_cross), para tener herramientas en regímenes tendenciales donde RSI/Bollinger fallan.

**Alcance (cada una con sus parámetros en el grid del Explorador, y compatible con SL/TP fijo y ATR):**

*Tendencia (prioridad alta — es lo que más falta):*
1. **Supertrend** (basado en ATR; SL/TP ATR ya incorporado naturalmente).
2. **Ichimoku Cloud** (sistema completo; también útil como contexto de tendencia/régimen).
3. **Donchian Channels** (breakout de canal N periodos; con buffer ATR para evitar falsos breakouts).

*Momentum (confirmación/alternativas a RSI):*
4. **Stochastic Oscillator**.
5. **CCI** (Commodity Channel Index).

*Opcional / menor prioridad:*
6. Parabolic SAR (útil como trailing stop más que entrada).

**IMPORTANTE:** cada estrategia nueva pasa por el MISMO rigor anti-overfit (meseta vs pico, walk-forward). Añadir variedad ≠ añadir picos afortunados. El optimizador existente es la defensa.

**Tests:** señales correctas de cada estrategia contra casos conocidos; integración con caché (nuevos tipos en la clave); integración con el grid del Explorador.

---

# FASE 5 — EXPLORAR NUEVOS INSTRUMENTOS YA DISPONIBLES EN XM (P5)

**Objetivo:** explorar los CFDs de índices y energía que XM ya ofrece — son los mismos subyacentes que los micro futuros profesionales, y la teoría de régimen (P2) predice que los de driver claro (crudo, índices) podrían dar mesetas como USDCAD.

**Alcance:**
1. Añadir a la rotación de exploración (verificar símbolos exactos en XM, suelen llevar `#`):
   - **Índices US:** US500 (S&P 500), US100 (Nasdaq), US30 (Dow). Drivers macro claros.
   - **Energía:** crudo WTI (USOIL / OIL#) — driver clarísimo, mismo "ADN" que USDCAD (petróleo). **Candidato más prometedor.**
2. **Perfil de instrumento en el motor:** parametrizar el cálculo de costos y el valor del tick/pip por TIPO de instrumento (forex, índice, metal, energía). Ya existe algo (costos por símbolo y el fix de GOLD); formalizarlo para que añadir instrumentos no requiera reescribir. Esto deja el sistema listo para futuros si algún día se migra.
3. Aplicar a estos instrumentos TODO lo anterior (ATR, régimen, métricas, estrategias de tendencia).

**Validación:** explorar crudo WTI con Bollinger/estrategias de tendencia y ver si aparece una meseta (la teoría lo predice). Documentar.

**Tests:** perfil de instrumento correcto (valor de tick, costos); exploración funcional sobre índices/crudo.

---

# FASE 6 — CALENDARIO ECONÓMICO COMO CAPA DEFENSIVA (P4)

**Objetivo:** usar las noticias DEFENSIVAMENTE (saber cuándo NO operar y contextualizar resultados), nunca para predecir. El 80% del valor con el 20% del riesgo.

**Alcance:**
1. Integrar un calendario de eventos de alto impacto (NFP, decisiones de tasas, CPI, FOMC) para las divisas/instrumentos operados. Verificar fuente de datos con API/descarga (Forex Factory, Investing.com, u otra).
2. **En backtest y Bot Histórico:** marcar las fechas de eventos de alto impacto, para ver si pérdidas/ganancias anómalas (outliers) coinciden con noticias. Contextualiza, no predice.
3. **En el bot en vivo (cuando opere):** opción de pausar/reducir tamaño en ventanas de alto impacto (ej. no abrir posiciones 15 min antes/después de NFP). Esto es gestión de riesgo pura (conecta con P6) — durante noticias los spreads se ensanchan brutalmente y los stops se vuelven teóricos.
4. **Overlay opcional** de eventos sobre las gráficas del laboratorio/bot histórico.

**Tests:** ingestión del calendario; marcado correcto de eventos en periodos; lógica de pausa por ventana temporal.

---

# FASE 7 — GESTIÓN DE CARTERA Y CIRCUIT BREAKERS (P6) [para multi-estrategia / bot en vivo]

**Objetivo:** gestionar el riesgo AGREGADO cuando el bot opere varias estrategias a la vez, y protegerse de rachas.

**Alcance:**
1. **Correlación entre estrategias** en el Bot Histórico multi-estrategia: medir y mostrar qué estrategias están correlacionadas (diversificación real vs falsa). Recordatorio: el DD global se calcula sobre la curva de equity AGREGADA, no sumando DDs — esto ya se hizo; aquí se añade la correlación explícita.
2. **Portfolio heat:** límite configurable de riesgo agregado (suma del riesgo de posiciones abiertas ≤ X% del capital, ej. 6-10%). Para cuando el bot opere varias estrategias simultáneas.
3. **Circuit breakers opcionales** para el bot en vivo: pausar una estrategia tras N pérdidas seguidas o X% de drawdown. Protección sistémica (un bot no tiene emociones, pero una racha puede señalar cambio de régimen → pausar y revisar es prudente).

**Tests:** cálculo de correlación; suma de portfolio heat; disparo de circuit breakers.

---

# FASE 8 — CARGAR FAVORITOS AL BOT QUE OPERA (puente Explorador → operación real)

**Objetivo:** cerrar el círculo del flujo de trabajo. Hoy descubrimos y guardamos candidatas en **Favoritos** (desde el Explorador, con su par/tipo/timeframe/parámetros/SL/TP). Esta fase permite **seleccionar uno o varios Favoritos y cargarlos directamente en el bot que opera** (en vivo o demo), sin reconfigurar todo a mano. Es lo que convierte el análisis en operación real con un par de clics.

**Por qué importa:** todo el sistema (Explorador, optimizador, Bot Histórico, métricas, régimen) sirve para ENCONTRAR configuraciones robustas. Pero sin este puente, pasar una candidata validada al bot real es manual y propenso a errores (re-teclear parámetros). Esta fase elimina esa fricción y reduce el riesgo de equivocarse al transcribir.

**Alcance:**
1. **Selector de Favoritos en la pantalla del bot:** en la configuración del bot que opera, añadir la opción de "Cargar desde Favoritos" — una lista de los favoritos guardados (con su par, tipo, timeframe, parámetros, SL/TP, y métricas/verdicto si las tiene).
2. **Carga de uno o varios:** poder seleccionar un favorito (bot simple) o varios (multi-estrategia, conecta con Fase 7). Al cargarlos, el bot pre-rellena toda la configuración de esa(s) estrategia(s): símbolo, tipo de estrategia, timeframe, parámetros, modo y valores de SL/TP (fijo o ATR según Fase 1).
3. **Trazabilidad:** el bot debe recordar de qué favorito viene cada estrategia cargada (referencia al favorito original), para poder volver a verlo o re-validarlo. Mostrar un enlace/etiqueta "viene del Favorito X".
4. **Validación previa a operar (recomendado):** antes de activar el bot con un favorito, mostrar un resumen claro de lo que se va a operar (par, riesgo%, SL/TP, capital, régimen idóneo vs actual si está la Fase 3) y pedir confirmación. Coherente con la filosofía de "verificar antes de operar real".
5. **Coherencia de contexto:** respetar el contexto global de análisis (fechas/capital de Settings) donde aplique, y advertir si un favorito fue validado en condiciones distintas a las actuales (ej. otro periodo, antes de un cambio de ENGINE_VERSION).

**Sinergias:**
- Con **Fase 1 (ATR):** si el favorito usa SL/TP por ATR, el bot debe cargar ese modo correctamente.
- Con **Fase 3 (Régimen):** al cargar un favorito, mostrar si el régimen actual del mercado COINCIDE con el régimen idóneo de esa estrategia (aviso MATCH/MISMATCH antes de operar).
- Con **Fase 7 (Cartera):** cargar varios favoritos a la vez es justo el caso multi-estrategia; mostrar su correlación y portfolio heat antes de activar.

**Tests:** listar favoritos en el selector; cargar un favorito pre-rellena toda la config correctamente (incluido modo ATR); cargar varios; trazabilidad al favorito origen; resumen de confirmación; advertencia de contexto distinto.

**Nota de prioridad:** esta fase puede hacerse en cuanto exista el bot operativo y los Favoritos (ambos ya existen). No depende técnicamente de las fases 1-7, pero gana valor con ellas (ATR, régimen, cartera). Puede adelantarse si el objetivo inmediato es empezar a operar una candidata validada (ej. USDCAD Bollinger) sin fricción.

---

# FASES FUTURAS (documentadas, NO implementar ahora)

De la investigación, explícitamente diferido por complejidad/riesgo:
- **Regime switching automático** (P2/P3): que el sistema cambie de estrategia según régimen. Empezar como AVISO (MATCH/MISMATCH de Fase 3) antes que como switch automático.
- **Walk-Forward Optimization en el Explorador** (P3): re-optimización por ventanas móviles que reporte estabilidad de parámetros. Trabajo grande; el Bot Histórico ya da validación walk-forward básica.
- **Multi-timeframe** (P1): usar la tendencia de un TF mayor como filtro.
- **Sentiment como filtro** (P4): score de sentiment como filtro (no señal), solo tras validación rigurosa. Riesgo alto de ruido.
- **Machine Learning** (P3/P4): LSTM/Transformers para predicción de régimen/sentiment. Sobre-ingeniería para esta etapa.
- **Migración a futuros** (P5): documentada como ruta estratégica; verificar brokers de futuros que acepten Ecuador. El sistema es agnóstico al instrumento, así que nada se desperdicia.

---

## ORDEN DE EJECUCIÓN RECOMENDADO Y SINERGIAS

```
FASE 1 (ATR SL/TP) ─┬─→ habilita FASE 3 (ATR es input del clasificador)
                    ├─→ habilita FASE 4 (Supertrend/Donchian usan ATR)
                    └─→ desbloquea prueba del ORO
FASE 2 (Métricas) ──→ mejora la evaluación de TODO lo demás
FASE 3 (Régimen) ───→ da contexto a FASE 4 y FASE 5
FASE 4 (Estrategias)─→ arsenal para regímenes tendenciales
FASE 5 (Instrumentos)→ aplica todo lo anterior a crudo/índices
FASE 6 (Calendario) ─→ capa defensiva, independiente
FASE 7 (Cartera) ────→ cuando haya multi-estrategia en vivo
FASE 8 (Favoritos→Bot)→ puente análisis→operación; puede adelantarse para operar ya
```

**Recomendación:** Fases 1-2 primero (fundamentos transversales que mejoran todo). Luego 3-4-5 (el núcleo: contexto + arsenal + nuevos mercados). Luego 6-7 (defensa y cartera). **La Fase 8 (Favoritos→Bot) puede adelantarse en cualquier momento** si el objetivo es empezar a operar una candidata ya validada (como USDCAD Bollinger) sin fricción — no depende de las otras fases, solo gana valor con ellas. Las fases futuras, después de validar lo anterior en operación real.

**Sugerencia práctica:** cada fase se entrega al agente como su propio documento de fase detallado (como se hizo con las fases de infraestructura previas: objetivo, archivos a tocar, lógica, tests, verificación en pantalla). Este documento es el índice maestro; de aquí salen los docs por fase a medida que se ejecutan.

---

*Documento maestro de implementación · consolida P1-P6 · prioriza por convergencia y sinergia · el ATR SL/TP es la prioridad #1 (3× convergente) · todo pasa por el rigor anti-overfit existente · principio rector: gestionar riesgo y filtrar por contexto, no predecir el futuro*
