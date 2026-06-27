# ForexBot — Lote de Fixes y Mejoras (horario, UTC-5, tooltips, costos, rediseño laboratorio)

> Seis mejoras agrupadas. Ejecutar en una pasada (o por partes si el agente lo prefiere; todas están especificadas aquí).
> Prerequisito: Fase 8 / 8C / 8D completadas.

---

## 1. Horario de mercado por símbolo (desde MT5)

### Qué se quiere
Mostrar, para el símbolo seleccionado, si el **mercado está abierto o cerrado** ahora mismo, y la **próxima apertura/cierre**. Informativo (NO bloquea al bot por ahora).

### Detalle
- Usar el **horario real de cada símbolo desde MT5** (no un horario genérico). Forex, cripto e índices tienen sesiones distintas; MT5 las conoce.
- MT5 expone las sesiones de trading por símbolo: `symbol_info_session_quote()` / `symbol_info_session_trade()` dan las sesiones por día de la semana, y `SYMBOL_TRADE_MODE` / el estado del símbolo indican si está operable. El bridge debe leer estas sesiones y calcular: estado actual (abierto/cerrado) + próximo cambio (cuándo abre si está cerrado, cuándo cierra si está abierto).
- Exponer en un endpoint del bridge (ej: `GET /symbol/{symbol}/session` o ampliar el `/symbol/{symbol}` existente) los datos de sesión.
- Mostrar en la UI (laboratorio y/o página del bot) cerca del selector de símbolo: un indicador "Mercado: Abierto / Cerrado" + "Abre/Cierra: <fecha-hora en UTC-5>".
- Las horas mostradas en UTC-5 (ver punto 2).

### Verificación
- Forex muestra abierto en semana, cerrado fin de semana, con próxima apertura el domingo.
- Cripto (BTCUSD#) muestra su horario propio (suele ser casi 24/7).
- Un índice muestra el horario de su sesión.

---

## 2. Fechas/horas en UTC-5 (Ecuador) en gráficas y posiciones

### Qué se quiere
- El **eje de tiempo de las gráficas de trading** debe mostrar las velas en **UTC-5** (hora de Ecuador del usuario), no en la hora del servidor del broker ni UTC.
- Las **posiciones** (y donde se muestren fechas/horas de operaciones) deben mostrar fecha y hora en **UTC-5**.

### Contexto técnico
- MT5 / el broker entregan los tiempos de las velas en la hora del **servidor del broker** (XM suele ser GMT+2 / GMT+3 según horario de verano). Por eso ahora el eje puede mostrar una hora desfasada de la del usuario.
- Hay que convertir de la hora del servidor (o del timestamp que entregue el bridge) a **UTC-5** para mostrar.
- IMPORTANTE: el agente debe **verificar en qué huso vienen los timestamps** del bridge/MT5 actualmente (pueden venir en hora de servidor o en UTC) y hacer la conversión correcta a UTC-5. No asumir; comprobar con un dato real (comparar la hora de una vela reciente con la hora real conocida).

### Detalle
- Aplicar a: eje de tiempo del chart del bot, chart del laboratorio, chart de backtest, tooltips de velas, y las horas de entrada/salida en posiciones e historial.
- Lightweight Charts: configurar el formato de tiempo para mostrar en UTC-5 (el chart trabaja con timestamps; ajustar el offset al renderizar etiquetas/tooltip, o convertir los timestamps a la zona del usuario de forma consistente).
- Mantener coherencia: si el reloj de la cabecera ya está en UTC-5 (LiveClock), que TODO el resto coincida.
- Dejar el offset (-5) en un lugar configurable por si en el futuro se quiere otra zona.

### Verificación
- Una vela cuya hora real de Ecuador es 09:00 se ve a las 09:00 en el eje (no a las 16:00 del servidor).
- Las posiciones muestran su hora de apertura en UTC-5.
- El reloj de la cabecera y el eje del chart son coherentes.

---

## 3. Icono "i" informativo en cada parámetro (tooltip explicativo)

### Qué se quiere
Junto a CADA parámetro (en el laboratorio, formulario de estrategia, config del bot), un **icono "i" dentro de un círculo** que al pasar el cursor (o tocar) muestre un **tooltip** explicando:
- **Qué es** el parámetro.
- **Cómo afecta** al comportamiento (la parte que da valor real para decidir cómo ajustarlo).

### Ejemplos de contenido del tooltip
- **Fast Period (MA):** "Periodo de la media móvil rápida. Valores más bajos = más sensible a cambios de precio: más señales pero más ruido (falsas). Valores más altos = más suave, menos señales pero más confiables."
- **Slow Period (MA):** "Periodo de la media lenta, marca la tendencia de fondo. Cuanto mayor, más lenta la reacción y menos operaciones."
- **RSI Period:** "Nº de velas para calcular el RSI. Más corto = más reactivo y más señales; más largo = más estable."
- **Oversold / Overbought:** "Umbrales del RSI. Oversold (ej. 30): por debajo se considera sobrevendido (posible compra). Overbought (ej. 70): por encima, sobrecomprado (posible venta). Umbrales más extremos (20/80) = menos señales pero más fiables."
- **Bollinger Deviation:** "Nº de desviaciones estándar para las bandas. Mayor = bandas más anchas, menos toques/señales."
- **SL (pips):** "Stop Loss en pips. Distancia a la que se cierra en pérdida. Más ajustado = menos pérdida por trade pero más probabilidad de que salte."
- **TP (pips):** "Take Profit en pips. Distancia a la que se toma ganancia."
- **Riesgo %:** "Porcentaje del capital arriesgado por operación (para sizing futuro)."

> El agente debe redactar textos claros y correctos para todos los parámetros de todos los tipos de estrategia (ma_cross, rsi, macd, bollinger, combined), con el patrón "qué es + cómo afecta".

### Detalle
- Componente reutilizable (ej: `InfoTooltip`) con el icono "i" en círculo, accesible (aria-label), que muestra el tooltip al hover y al focus/touch.
- Sin emojis (coherente con la política del proyecto). El icono puede ser un SVG/ícono de lucide-react (`Info`).
- Posicionar el tooltip de forma que no se corte en los bordes.

---

## 4. Gráfica embebida al hacer clic en un trade del laboratorio

### Qué se quiere
En el laboratorio, en la **tarjeta/lista de trades del backtest**, al hacer clic en una entrada (una fila de trade), que se despliegue **una gráfica de trading embebida EN la fila** mostrando el momento en que se hizo esa entrada en el pasado: ver dónde y cómo entró (y salió).

### Detalle
- Es similar al detalle visual de trade del bot (Fase 8 Parte B), PERO:
  - Es para los **trades del backtest** del laboratorio (no del bot en vivo).
  - Va **embebida en la fila** (expandible inline), NO en un modal aparte.
- Al hacer clic en una fila de trade, se expande mostrando un mini-chart enfocado (zoom) al tramo de esa operación:
  - Velas de ese tramo (un poco antes de la entrada hasta un poco después de la salida).
  - Marcador de entrada (precio, dirección) y de salida (precio, PnL).
  - Zonas/líneas TP-SL.
  - Líneas de la estrategia en ese tramo.
- Volver a hacer clic colapsa la fila. Permitir solo una expandida a la vez o varias (a criterio, lo que sea más limpio).
- Reusar el componente de chart existente (BotLiveChart / BacktestChart) en modo "enfocado a un trade".
- Decimales del símbolo correctos; horas en UTC-5.

---

## 5. Costos del broker en el backtest (spread/comisión/swap) + bruto y neto

### Qué se quiere
Que el backtest **incluya los costos reales del broker** para que el PnL sea realista, y que muestre **PnL bruto y neto lado a lado** (sin costos vs con costos).

> Pregunta del usuario que origina esto: "¿el valor de la card de trades ya incluye la comisión/costos del broker?" — hay que verificar y, si no, añadirlo.

### PASO 0 — Verificar qué hace el backtest actual (OBLIGATORIO antes de cambiar)
- El agente debe **revisar el motor de backtesting actual** y determinar si ya descuenta algún costo (spread, comisión, swap) o si calcula el PnL "limpio" (sin costos).
- Reportar qué encontró antes/junto con el cambio.

### Qué añadir
- **Spread:** el más importante. Cada operación paga el spread (diferencia bid/ask) en la entrada. Usar el **spread REAL de cada símbolo** desde MT5 (`symbol_info`: `spread` en puntos, o derivado de bid/ask). NO un spread fijo: varía por símbolo (EURUSD# distinto de GBPUSD#, cripto mucho mayor).
- **Comisión:** si la cuenta/símbolo cobra comisión por lote, incluirla (algunos símbolos de XM la tienen; verificar `symbol_info` campos de comisión si están disponibles, o permitir configurarla).
- **Swap:** costo de mantener posición overnight. MT5 expone `swap_long` / `swap_short` por símbolo. Aplicarlo a operaciones que cruzan el cierre diario (según nº de noches abiertas).
- Calcular **PnL bruto** (como ahora, sin costos) y **PnL neto** (descontando spread + comisión + swap).

### Presentación
- Mostrar **bruto y neto lado a lado** en:
  - El resumen del backtest (retorno total bruto vs neto).
  - Idealmente por trade en la lista (PnL bruto / neto de cada operación).
- Que se vea claramente cuánto se comen los costos (la diferencia bruto-neto).
- En la optimización (Fase 8): la robustez y los veredictos deberían basarse en el **PnL NETO** (el realista), no en el bruto. Ajustar para que el optimizador use el neto.

### Por qué importa (contexto)
- Un backtest sin costos es optimista y engañoso; estrategias que operan mucho pagan muchos spreads. El neto es lo que de verdad se obtendría. Esto protege al usuario de validar una estrategia que solo gana "en papel".

### Verificación
- El backtest muestra PnL bruto y neto; el neto es menor (por los costos).
- El spread usado es el real por símbolo (distinto entre EURUSD# y GBPUSD#).
- La optimización usa el neto para sus veredictos.

---

## 6. Rediseño visual del Laboratorio (estilo MT5, sin scroll)

### Problema
El laboratorio actual no es usable: hay que hacer scroll para cosas que deberían estar a la vista. La configuración en columna larga obliga a desplazarse.

### Inspiración (MT5 Strategy Tester)
- Configuración compacta; **los parámetros irrelevantes se ocultan** según el contexto (si eliges RSI, no se muestran los de Bollinger).
- Chart protagonista, siempre visible.
- Resultados en **tabs abajo** que se llenan al ejecutar (antes de ejecutar no ocupan espacio).
- Workspace organizado, paneles redimensionables.

### Estructura PRINCIPAL (opción A — barra horizontal arriba)

```
┌────────────────────────────────────────────────────────────────┐
│  BARRA SUPERIOR compacta (horizontal):                          │
│  [Tipo ▾] [Par ▾ (2 grupos)] [Timeframe ▾] [params del tipo] [▶ Ejecutar backtest] [Optimizar] [Guardar como estrategia] │
│  + estado de mercado (abierto/cerrado) del símbolo               │
├────────────────────────────────────────────────────────────────┤
│   CHART (protagonista, ocupa el grueso del alto)                │
│   velas + líneas de estrategia + entradas/salidas del backtest  │
├────────────────────────────────────────────────────────────────┤
│  TABS DE RESULTADOS (abajo, se llenan al ejecutar):             │
│  [Resumen] [Trades] [Optimización] [Equity/Balance]             │
│   - Resumen: métricas (incl. bruto vs neto)                     │
│   - Trades: lista con gráfica embebida al clic (punto 4)        │
│   - Optimización: ranking robusto (Fase 8)                      │
│   - Equity: curva de balance                                    │
└────────────────────────────────────────────────────────────────┘
```

- **Solo se muestran los parámetros del tipo de estrategia elegido** (ocultar los que no aplican).
- El icono "i" (punto 3) acompaña cada parámetro en la barra.
- Par con los dos grupos (Más usados / Todos A-Z) ya implementados.
- Horas en UTC-5; estado de mercado visible.
- Antes de ejecutar, las tabs de abajo pueden mostrarse vacías/placeholder ("Ejecuta un backtest para ver resultados").

### SELECTOR EN VIVO entre las dos estructuras (A/B testing en uso real)

> El usuario quiere PROBAR ambas estructuras en vivo y luego quedarse con una sola.

- Implementar un **selector visible en el laboratorio** (un toggle/segmented control, ej: "Disposición: [Barra arriba] [Sidebar]") que conmute **en vivo** entre la opción A (barra horizontal) y la opción B (sidebar), sin recargar, conservando el estado actual (tipo/par/TF/params y resultados ya cargados).
- El objetivo es que el usuario use ambas con datos reales y decida cuál es más útil.
- La preferencia elegida se recuerda (localStorage) entre sesiones.
- **FASE DE DESCARTE (posterior):** una vez el usuario elija la ganadora, en una iteración futura se ELIMINA la perdedora y se deja solo la estructura ganadora como definitiva (código limpio, sin el toggle). Dejar el código organizado para que quitar una de las dos sea sencillo (componentes separados por disposición, no entremezclados).

### Estructura ALTERNATIVA (opción B — sidebar estrecho a la izquierda)

```
┌──────────────┬─────────────────────────────────────────────────┐
│ SIDEBAR      │   CHART (protagonista)                          │
│ estrecho:    │                                                 │
│  Tipo        ├─────────────────────────────────────────────────┤
│  Par         │   TABS DE RESULTADOS abajo:                     │
│  Timeframe   │   [Resumen][Trades][Optimización][Equity]       │
│  params      │                                                 │
│  [Ejecutar]  │                                                 │
│  [Optimizar] │                                                 │
│  [Guardar]   │                                                 │
└──────────────┴─────────────────────────────────────────────────┘
```

- El usuario decidió: dejar ambas estructuras con un **selector en vivo** para conmutar y comparar en uso real; luego se descarta la perdedora y se queda solo la ganadora.
- Priorizar que el conmutar sea fluido (en vivo, sin perder el estado). Mantener los componentes de cada disposición bien separados para que eliminar uno después sea trivial.

### Verificación
- El laboratorio se usa SIN scroll para la configuración y la ejecución básica.
- Solo se ven los parámetros del tipo elegido.
- El chart está siempre visible; los resultados aparecen en tabs abajo al ejecutar.
- Hay un **selector en vivo** que conmuta entre la disposición A (barra arriba) y B (sidebar) sin recargar ni perder el estado; la preferencia se recuerda.
- (Posterior) Quitar la perdedora deja el laboratorio limpio con solo la ganadora.
- Todo lo demás del laboratorio (backtest efímero, optimización, guardar como estrategia) sigue funcionando.

---

## Verificación general
- `tsc` 0 · build OK · tests del bridge y Laravel pasan.
- Verificar EN PANTALLA cada punto (no solo que compile).
- Sin emojis en la UI.

---

*Lote de fixes · horario de mercado + UTC-5 + tooltips informativos + gráfica embebida en trades + costos reales del broker + rediseño usable del laboratorio*
