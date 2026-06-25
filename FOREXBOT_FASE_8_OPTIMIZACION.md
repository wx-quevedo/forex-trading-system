# ForexBot — Fase 8: Optimización Automática (sin Overfitting) + Rediseño UI estilo MT5

> Optimización automática de parámetros con guardarraíles anti-overfitting + detalle visual de trades + reorganización de la página del bot inspirada en MetaTrader 5
> Prerequisito: Fases 1-7B completadas, bot operando en vivo

---

## PARTE A — Optimización Automática sin Overfitting

> La funcionalidad más valiosa y la más peligrosa. El overfitting es la principal causa de que estrategias "perfectas" en backtest pierdan dinero en vivo. Se construye con disciplina anti-overfitting o no se construye.

### A.1 Objetivo

Un botón **"Optimización automática"** que, dada una estrategia, barre automáticamente el espacio de parámetros y devuelve un **ranking de combinaciones ROBUSTAS** — no la que más ganó en el pasado, sino las que funcionan de forma consistente y previsiblemente seguirán funcionando. Totalmente automático: el usuario pulsa y espera el resultado.

### A.2 Filosofía (NO negociable)

El usuario fue explícito: **NO quiere la combinación que más dinero dio en el pasado**, porque eso casi siempre es overfit y falla en el futuro. Quiere robustez. La herramienta debe:
- Marcar claramente qué combinaciones están **"dentro del rango"** (robustas, confiables) vs **"fuera del rango"** (overfit, descartar).
- El usuario elegirá SOLO de las robustas (se comprometió a ello).

### A.3 Guardarraíles Anti-Overfitting (obligatorios)

1. **Separación train/test (in-sample / out-of-sample):**
   - Optimizar SOLO en la primera parte del histórico (in-sample).
   - Validar cada combinación candidata en una parte posterior que el optimizador NUNCA vio (out-of-sample).
   - Si una combinación gana en in-sample pero se desploma en out-of-sample → OVERFIT → marcar "fuera del rango".

2. **Walk-forward (recomendado):**
   - Dividir el histórico en ventanas rodantes; optimizar en ventana N, validar en N+1, avanzar.
   - Mide cómo se comportaría re-optimizando periódicamente en la realidad.

3. **Penalización por complejidad / preferencia por mesetas:**
   - Una buena combinación está rodeada de otras también buenas (meseta), no es un pico aislado.
   - Un óptimo que solo funciona con valores muy específicos (period 37 vuela pero 36 y 38 pierden) es señal de overfit → marcar.
   - Preferir parámetros "redondos"/estables.

4. **Mínimo de trades:**
   - Descartar combinaciones con muestra pequeña (ej: < 30 trades) — no son estadísticamente creíbles.

5. **Métricas de robustez, no solo retorno:**
   - Evaluar estabilidad del rendimiento entre in-sample y out-of-sample (la diferencia debe ser pequeña).
   - Una estrategia que gana consistentemente poco es mejor que una que gana mucho en un periodo y pierde en otro.

### A.4 Salida (lo que ve el usuario)

NO un único "ganador". Un **ranking** tipo:

```
Combinación              In-Sample   Out-Sample   Robustez   Veredicto
EMA 12/26, ...           +9.2%       +7.8%        ★★★★       DENTRO del rango
EMA 14/30, ...           +8.1%       +7.1%        ★★★★       DENTRO del rango
EMA 9/21, ...            +11%        +2%          ★★         límite
EMA 37/53, ...           +24%        -3%          ☆          FUERA del rango (overfit)
```

- Columnas: parámetros, métrica in-sample, métrica out-of-sample, score de robustez, veredicto claro DENTRO/FUERA, nº de trades.
- Ordenar por **robustez** (consistencia in↔out), NO por retorno máximo.
- Marcar visualmente: verde = dentro del rango / robusta; rojo/gris = fuera del rango / overfit.
- Permitir al usuario **cargar una combinación robusta** al workbench / crear versión de estrategia con ella, para validarla él mismo.

### A.5 Implementación

- Motor de optimización en el bridge (Python): grid search sobre los rangos de parámetros de la estrategia, o búsqueda más eficiente (ej: `optuna`) si el espacio es grande.
- Reusar el motor de backtesting existente (Fase 5) para evaluar cada combinación, corriendo in-sample y out-of-sample por separado.
- Asíncrono (puede tardar): lanzar como job, mostrar progreso, no bloquear la UI. Usar la cola de Laravel + estado de progreso, o un endpoint que reporte avance.
- Definir rangos de barrido razonables por tipo de estrategia y parámetro (evitar explosión combinatoria absurda; acotar con pasos sensatos).
- El backtest de cada combinación usa el símbolo operable correcto (consistente con el fix de símbolos).
- La IA (Claude) puede, opcionalmente y a futuro, ayudar a interpretar si un resultado huele a overfit — dejar el gancho, no obligatorio en MVP.

### A.6 Regla de Oro

**Ningún parámetro optimizado va a operar en vivo sin pasar validación out-of-sample.** La herramienta existe para encontrar robustez, no para maximizar el retorno histórico.

---

## PARTE B — Detalle Visual de un Trade (al hacer clic)

### B.1 Objetivo

Al hacer clic en un registro del **log de señales** o del **historial de trades del bot**, mostrar una **gráfica enfocada (zoom) a esa operación concreta**: dónde entró y por qué, dónde salió y por qué.

### B.2 Qué muestra la gráfica enfocada

- **Zoom temporal** al tramo de esa operación (desde un poco antes de la entrada hasta un poco después de la salida).
- **Marcador de entrada** en su vela, con dirección (BUY/SELL) y precio.
- **Marcador de salida** en su vela, con precio y PnL.
- **Zonas TP/SL** (verde/roja) de esa operación.
- Las **líneas de la estrategia** (medias, bandas, etc.) en ese tramo.
- **Por qué entró:** la señal que disparó la entrada (condiciones que se cumplieron, valores de indicadores en ese momento).
- **Por qué salió:** el MOTIVO DE CIERRE (ver B.3).
- Precios con los decimales correctos del símbolo (campo `digits`).

### B.3 Registrar el MOTIVO DE CIERRE (requisito de datos)

> Para poder decir "por qué salió", el bot DEBE registrar el motivo de cierre de cada trade. Verificar si ya se guarda; si no, AÑADIRLO.

Motivos posibles a distinguir y registrar en un campo `close_reason`:
- **Take Profit** alcanzado
- **Stop Loss** alcanzado
- **Señal contraria** (el bot detectó señal opuesta y cerró)
- **Cierre manual / Panic**
- **Límite de pérdida diaria** (auto-stop)

El bridge/runner debe determinar el motivo al cerrar (comparar precio de cierre con SL/TP, o si fue por señal/panic/límite) y persistirlo vía Laravel en cada trade.

### B.4 Presentación

- La gráfica enfocada se abre en un panel/modal al hacer clic en el trade (o reusa el chart haciendo zoom a esa operación).
- Junto a la gráfica, un resumen textual: entrada (hora con ms, precio, lote, dirección, señal que la disparó), salida (hora con ms, precio, PnL, motivo de cierre), duración.

---

## PARTE C — Historial de Trades Enriquecido

Mejorar la tabla del historial de trades del bot para que muestre, bien organizado y legible (inspirado en las columnas del History de MT5: Time, Type, Volume, Symbol, Price, S/L, T/P, Profit):

- **Par** (símbolo)
- **Dirección** (BUY/SELL)
- **Lote** (volumen)
- **Precio de entrada** y **precio de salida** (con los decimales correctos del símbolo)
- **Hora de entrada** y **hora de salida** (con milisegundos)
- **SL** y **TP**
- **PnL** (en dólares)
- **Motivo de cierre** (de B.3)
- **Duración** de la operación

Organizar las columnas de forma clara: alinear números a la derecha, formato consistente, colores PnL (verde/rojo), que se lea de un vistazo. Cada fila clicable → abre el detalle visual (Parte B). Columnas ordenables si es viable.

---

## PARTE D — Rediseño de la Página del Bot (estructura estilo MetaTrader 5)

> Inspirado en cómo MT5 organiza el trading algorítmico: el chart manda arriba, siempre visible, y abajo un "Toolbox" multifunción donde conviven posiciones, historial y logs. Elimina las pestañas Visualización/Log actuales.

### D.1 Estructura general (zonas fijas, sin ocultar el chart)

```
┌──────────────────────────────────────────────────────────────────┐
│  HEADER: estado del bot · reloj con ms · botón PANIC               │
├───────────────┬──────────────────────────────────────────────────┤
│  PANEL IZQ     │   CHART (zona central protagonista, siempre       │
│  (sidebar):    │   visible)                                        │
│   - Config:    │   - velas + líneas de estrategia                  │
│     estrategia │   - zonas TP/SL verde/roja                        │
│     lote, TF,  │   - marcadores de entrada/salida                  │
│     límites    │   - franja de indicador abajo (RSI/MACD/volumen)  │
│   - Start/Pause│                                                   │
│     /Resume/   │                                                   │
│     Stop       │                                                   │
│   - PnL del día├──────────────────────────────────────────────────┤
│   - Telegram   │   TOOLBOX (panel inferior multifunción, estilo    │
│                │   MT5, con sub-tabs — el chart NUNCA se oculta):   │
│                │   [Posiciones] [Historial] [Log señales] [Journal]│
└───────────────┴──────────────────────────────────────────────────┘
```

### D.2 Reglas del rediseño

- **Eliminar** las pestañas actuales "Visualización" / "Log de señales" que ocultaban el chart.
- El **chart queda SIEMPRE visible** arriba (es el protagonista, como en MT5).
- Debajo del chart, un **Toolbox** con sub-tabs (este sí con tabs, pero son vistas del panel inferior — el chart se mantiene visible arriba en todo momento). Sub-tabs:
  - **Posiciones:** posiciones abiertas del bot en tiempo real (símbolo, dirección, lote, precio entrada, precio actual, SL, TP, PnL flotante).
  - **Historial:** la tabla enriquecida de la Parte C (trades cerrados).
  - **Log de señales:** las evaluaciones del bot vela a vela (entró / no entró + motivo + indicadores) — lo que hoy es el "Log de señales".
  - **Journal:** eventos del bot (inicio, pausa, resume, stop, panic, errores, límite diario alcanzado, conexión) — separado del log de señales, como MT5 separa "Experts" de "Journal".
- El **panel de detalle de evaluación** (al hacer clic en una señal) y el **detalle visual del trade** (Parte B) se integran de forma coherente con este layout.
- Diseño limpio, dark, profesional; aprovechar el espacio sin saturar. Desktop (responsive móvil va aparte).
- El sub-tab activo del Toolbox debe persistir / ser recordado razonablemente (no resetear molesto al refrescar).

### D.3 Separación Log de señales vs Journal (detalle)

- **Log de señales (evaluaciones):** cada vez que el bot evalúa una vela — qué vio (indicadores), si entró o no, y por qué. Es el flujo de decisiones de trading.
- **Journal (eventos del bot):** el ciclo de vida y la salud del bot — "bot iniciado", "pausado por usuario", "límite diario alcanzado, auto-stop", "error de conexión con MT5", "panic ejecutado", "orden rechazada", etc. Es el registro operativo/diagnóstico.
- Cada entrada con timestamp (con ms) y, en el Journal, un tipo/severidad (info / warning / error) como hace MT5.

---

## PARTE E — BUG: Timeframe por defecto incorrecto

### E.1 Problema
Al cargar la página del bot, el selector de timeframe muestra **H1 por defecto**, aunque el usuario había dejado **M1**. No respeta la última selección.

### E.2 Solución
- El selector de timeframe debe **recordar y respetar la última selección del usuario**, no resetear a H1. (MT5 recuerda los arreglos del usuario entre sesiones; replicar ese comportamiento.)
- Si hay un bot corriendo, mostrar el timeframe con el que está corriendo.
- Si no, recordar la última elección (persistir en estado/preferencia local) en vez de un default fijo H1.

---

## Verificación

**Parte A (optimización):**
- El botón corre el barrido y devuelve un ranking con columnas in-sample / out-of-sample / robustez / veredicto / nº trades.
- Las combinaciones overfit (buenas in-sample, malas out-of-sample) se marcan "fuera del rango".
- Se puede cargar una combinación robusta al workbench/estrategia.
- Descarta combinaciones con < mínimo de trades.

**Parte B/C (trade detail + historial):**
- Clic en un trade del historial o log abre la gráfica enfocada (zoom) a esa operación.
- Se ve entrada (con señal/por qué) y salida (con motivo de cierre).
- El historial muestra par, dirección, lote, entrada/salida (precio + hora ms), SL, TP, PnL, motivo de cierre, duración.
- El `close_reason` se registra correctamente para TP/SL/señal/panic/límite.

**Parte D (UI estilo MT5):**
- Ya no hay pestañas que oculten el chart; el chart está siempre visible arriba.
- Abajo, Toolbox con sub-tabs Posiciones / Historial / Log de señales / Journal.
- Log de señales y Journal están separados.

**Parte E (timeframe):**
- Al cargar el bot, el timeframe respeta la última selección (no fuerza H1).

- `tsc` 0 · build OK · tests del bridge y Laravel pasan.
- Verificar EN PANTALLA, no solo que compile.

---

*Fase 8 · Optimización robusta + visualización profunda de trades + UI command-center estilo MT5*
