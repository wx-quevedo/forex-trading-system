# ForexBot — FIX: Decimales del Chart y Marcador de Entrada Faltante

> Dos bugs de la visualización del bot (Fase 7B), confirmados en pantalla con una posición abierta real.

---

## Contexto positivo (lo que SÍ funciona)

Verificado en pantalla: el bot tiene una posición REAL abierta (Posiciones 1/1, PnL flotante -$0.74), y las zonas TP/SL verde/roja estilo TradingView se dibujan correctamente. Estos dos fixes son sobre detalles de esa visualización.

---

## 1. BUG — El chart muestra solo 2 decimales (debe usar los del símbolo)

**Problema:** las etiquetas de precio del chart (TP, SL, precio actual, eje de precios) muestran solo **2 decimales** (ej: TP `1.14`, SL `1.14`, precio `1.14`). Para EURUSD, que cotiza con **5 decimales** (1.13847), esto es inservible: el TP y el SL se ven idénticos ("1.14") cuando en realidad están separados por decenas de pips.

**Causa:** el formato de precios del chart está fijo a 2 decimales en vez de usar la precisión real del símbolo.

**Solución:**
- Usar el campo **`digits`** del símbolo (viene en `/symbols` del bridge: EURUSD=5, USDJPY=3, GOLD=2, etc.) para formatear TODOS los precios del chart.
- Aplicar a:
  - El **eje de precios** (price scale) del chart.
  - Las etiquetas de las **líneas/zonas TP, SL y Entry**.
  - El **tooltip** de precios.
  - Cualquier valor de precio mostrado en el panel de decisión / indicadores que sea un precio del par.
- En Lightweight Charts: configurar `priceFormat: { type: 'price', precision: digits, minMove: 1/10^digits }` en la serie de velas, con `digits` del símbolo operado.
- El bridge debe exponer el `digits` del símbolo (ya está en `symbol_info` / el JSON de `/symbols`); el frontend lo usa para el formato. Si el endpoint de velas no lo trae, añadirlo o derivarlo del símbolo.
- Para símbolos con distinta precisión (JPY=3, oro=2, cripto variable), respetar su `digits` propio, no asumir 5.

---

## 2. BUG — No aparece marcador en el momento de la orden

**Problema:** cuando el bot ejecuta una entrada (hay una posición abierta confirmada), NO aparece ningún marcador en el chart que indique el momento/vela exacto en que se hizo la transacción. El usuario quiere ver un punto/flecha sobre la vela donde se ejecutó la orden.

**Causa probable:** los marcadores de entrada/salida no se están generando o no se renderizan para las posiciones/trades reales (quizás el marcador depende de datos de señal que no se enlazan con la posición abierta, o el `candle_time` de la ejecución no se está usando para colocar el marcador).

**Solución:**
- Dibujar un **marcador claro en la vela donde se abrió la posición**: una flecha (verde hacia arriba para BUY, roja hacia abajo para SELL) o un punto prominente, colocado en el `candle_time`/timestamp de la ejecución y al precio de entrada.
- Igualmente, al cerrarse, un **marcador de salida** (cuadrado/punto) con el PnL, en la vela del cierre.
- El marcador debe aparecer tanto para:
  - **Posiciones abiertas actualmente** (entrada visible aunque aún no haya cierre).
  - **Trades del historial** (entrada + salida).
- Asegurar que el dato de la posición/trade incluya el timestamp de ejecución y el precio para poder ubicar el marcador. Si el bridge no expone el tiempo de apertura de la posición, añadirlo (`positions` de MT5 traen `time` de apertura).
- El marcador debe ser visualmente distinto y prominente (no confundirse con los círculos grises de "evaluación sin entrada").
- Al hacer clic/hover en el marcador de entrada, mostrar el detalle de esa orden (precio, lote, SL, TP, hora con ms).

---

## 3. Verificación (en pantalla, con la posición abierta real)

1. Con el bot teniendo una posición abierta en EURUSD#:
   - El TP, SL y precio en el chart muestran **5 decimales** (ej: 1.13847), no 1.14.
   - El eje de precios muestra la precisión correcta.
2. Aparece un **marcador de entrada** sobre la vela exacta donde el bot abrió la posición (flecha/punto), al precio de entrada.
3. Al cerrar (o en trades del historial), aparece el marcador de salida con PnL.
4. Probar con un símbolo de distinta precisión si es posible (ej: USDJPY# = 3 decimales) y confirmar que respeta su `digits`.
5. `tsc` 0 · build OK.

> Verificar EN PANTALLA con la posición real, no solo que compile.

---

*Fix de visualización · Decimales correctos por símbolo + marcador de ejecución visible*
