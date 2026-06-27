# ForexBot — Fase 8E: Buscador Automático de Estrategias (Explorador)

> Una página dedicada que barre automáticamente múltiples pares, timeframes, tipos, parámetros, SL/TP y riesgo, evalúa cada combinación con validación out-of-sample, y entrega un reporte ordenable de las mejores.
> Es la evolución de la optimización (que era de UNA estrategia en UN par) a una BÚSQUEDA a través de muchas configuraciones.
> Prerequisito: Fase 8 (optimización con in/out-of-sample, costos reales) ya construida — se REUSA su motor.

---

## ADVERTENCIA CENTRAL — Data Mining / Overfitting masivo (no omitir)

> Esta funcionalidad multiplica el riesgo de overfitting y DEBE diseñarse para protegerse de él.

Cuando se prueban miles de combinaciones, **algunas se verán espectaculares por puro azar** — no porque sean buenas, sino porque con suficientes intentos algo acierta de chiripa (como tirar 10,000 monedas y quedarse con las que dieron 10 caras seguidas). 

Implicaciones obligatorias del diseño:
1. **La validación out-of-sample es MÁS crítica que nunca.** Cada combinación se evalúa en datos que el barrido no usó para "elegirla".
2. **El reporte NO debe inducir a elegir por retorno máximo.** Debe destacar la robustez (consistencia in↔out) y marcar claramente lo que pasó out-of-sample.
3. **Advertir al usuario en la propia UI**: "Con muchas combinaciones, algunas parecen ganadoras por azar. Fíate de la robustez y del out-of-sample, no del retorno más alto."
4. Reusar TODOS los guardarraíles de la Fase 8: mín. de trades, penalización de picos aislados vs mesetas, veredicto DENTRO/FUERA, costos reales (PnL neto).

---

## 1. Página nueva: "Explorador" (o "Buscador de estrategias")

- Nueva entrada en el nav: **"Explorador"**.
- Página dedicada (no una tab del laboratorio), porque el flujo y el reporte son extensos.

---

## 2. Lo que el USUARIO define (fijo para la búsqueda)

- **Pares a incluir:** el usuario selecciona uno o varios de los pares disponibles (multi-select, con los dos grupos: comunes / A-Z). Solo símbolos disponibles.
- **Tipos de estrategia a incluir:** el usuario marca cuáles de los 5 tipos (ma_cross, rsi, macd, bollinger, combined) entran en la búsqueda (multi-select).
- **Periodo:** fechas Desde / Hasta (el usuario las ingresa).
- **Capital inicial:** monto en USD.
- (Opcional) límites del barrido para acotar cómputo: ver punto 4.

---

## 3. Lo que el SISTEMA varía automáticamente

Para cada combinación de (par × tipo seleccionados), el sistema barre:
- **Timeframe:** un conjunto definido (ej: M5, M15, H1, H4 — configurable; idealmente el usuario puede marcar cuáles incluir).
- **Parámetros del tipo de estrategia:** los rangos de cada parámetro (como ya hace el optimizador de la Fase 8, por tipo).
- **SL / TP (pips):** varía en rangos razonables (ej: SL 15/20/30/50, TP 30/40/60/100, o pasos definidos).
- **Riesgo %:** varía en un conjunto (ej: 0.5, 1, 2) — afecta el sizing/resultado.

> El espacio total = pares × tipos × timeframes × combinaciones de parámetros × SL/TP × riesgo. Puede ser ENORME. Ver acotación (punto 4).

---

## 4. Control de la explosión combinatoria (cómputo)

- Mostrar al usuario, ANTES de ejecutar, una **estimación del nº de combinaciones** y una advertencia si es muy grande ("Esto ejecutará ~12,400 backtests, puede tardar ~X min").
- Permitir **acotar**: elegir qué timeframes incluir, pasos de SL/TP más gruesos, rangos de parámetros, etc.
- Ejecutar de forma **asíncrona** con **progreso real** (combinación N de Total) — reusar/extender el modal de progreso; aquí el progreso real importa mucho porque puede tardar.
- Permitir **cancelar** una búsqueda larga.
- Considerar límites de seguridad (un máximo de combinaciones por búsqueda, configurable) para no colgar el sistema.
- El cómputo corre en el bridge (Python); aprovechar que el motor de backtest ya existe. Si es viable, paralelizar (la tower tiene CPU potente — i9-13900K), pero sin bloquear; con cuidado de no saturar MT5 (las peticiones de velas a MT5 deben gestionarse; idealmente cachear las velas por par/timeframe una vez y reusarlas para todas las combinaciones de parámetros de ese par/timeframe, en vez de re-pedirlas cada vez).

> NOTA de eficiencia importante: las velas de un (par, timeframe) se descargan UNA vez y se reusan para todas las combinaciones de parámetros/SL/TP/riesgo de ese par+timeframe. Así se evita machacar MT5 y se acelera muchísimo.

---

## 5. Evaluación de cada combinación

Cada combinación se evalúa como en la Fase 8:
- Backtest con **costos reales** (PnL neto).
- Split **in-sample / out-of-sample** (70/30 o walk-forward).
- Score de **robustez** (consistencia in↔out).
- Guardarraíles: mín. de trades, descartar overfit, penalizar picos aislados.
- Veredicto: DENTRO / límite / FUERA del rango.

---

## 6. Reporte final (ordenable)

Una tabla con TODAS las combinaciones evaluadas (o las que pasan un filtro mínimo), con columnas:
- **Par**
- **Tipo** de estrategia
- **Timeframe**
- **Parámetros** (resumen)
- **SL / TP**
- **Riesgo %**
- **Capital final**
- **Costos broker**
- **Retorno neto** (%)
- **PnL neto**
- **Win rate**
- **Profit factor**
- **Max drawdown**
- **Trades (ops)**
- **In-sample / Out-of-sample**
- **Robustez** (estrellas)
- **Veredicto** (DENTRO / límite / FUERA)

Requisitos del reporte:
- **Ordenable por cualquier columna** (clic en encabezado, asc/desc) — el usuario pidió poder reordenar.
- **Mostrar robustez Y retorno** (el usuario los quiere ambos), pero por **defecto ordenar por robustez** (lo más seguro), con aviso visible de por qué.
- **Filtros**: poder filtrar por veredicto (ej: ver solo DENTRO del rango), por par, por tipo.
- **Resaltar** las DENTRO del rango (verde) vs FUERA (rojo/gris).
- **Cargar** una combinación al Laboratorio (para inspeccionarla en detalle con su chart, trades, equity) y/o **Guardar como estrategia** directamente.
- Idealmente, **exportar** el reporte (CSV) para análisis externo.
- Mostrar resumen: cuántas combinaciones se probaron, cuántas salieron DENTRO del rango.

---

## 7. Flujo de uso

1. Usuario entra a "Explorador".
2. Selecciona pares, tipos, timeframes a incluir; ingresa periodo y capital.
3. Ve la estimación de combinaciones; ajusta si es mucho.
4. Pulsa "Buscar" → modal de progreso real (N de Total), cancelable.
5. Al terminar, ve el reporte ordenable, filtra por DENTRO del rango, ordena por robustez.
6. Inspecciona las candidatas robustas cargándolas al Laboratorio (chart, trades, equity).
7. Guarda como estrategia las que de verdad convenzan (robustas + operables).

---

## 8. Lo que NO debe hacer (seguridad de criterio)

- NO presentar un único "ganador" automático ni recomendar "la mejor" — presenta candidatas robustas; la decisión final es del usuario tras inspeccionar.
- NO ordenar por defecto por retorno (induce a elegir suerte).
- NO ocultar el out-of-sample ni los costos.
- NADA de esto opera en vivo automáticamente; es solo búsqueda/análisis. Llevar una estrategia al bot sigue siendo decisión manual y explícita del usuario.

---

## 9. Verificación

- La página Explorador permite elegir pares + tipos + timeframes + periodo + capital.
- Estima el nº de combinaciones y advierte si es grande.
- Ejecuta con progreso real y se puede cancelar.
- Reutiliza el motor de backtest con costos reales y split in/out-of-sample.
- Las velas por (par, timeframe) se descargan una vez y se reusan (eficiencia).
- El reporte es ordenable por cualquier columna, filtra por veredicto/par/tipo, resalta DENTRO del rango.
- Muestra robustez y retorno; ordena por robustez por defecto con aviso.
- Se puede cargar una combinación al Laboratorio y guardar como estrategia.
- `tsc` 0 · build OK · tests del bridge (nuevo motor de búsqueda) y Laravel pasan · verificar EN PANTALLA.

---

## Nota de orden
Esta es una funcionalidad grande. Se puede entregar por fases:
1. Motor de búsqueda en el bridge (barrido + reuso de velas + evaluación in/out) con un endpoint y progreso.
2. Página Explorador con selección y modal de progreso.
3. Reporte ordenable + filtros + cargar/guardar.
Si el agente prefiere, que entregue el motor + un reporte básico primero, y luego pula filtros/exportación.

---

*Fase 8E · Buscador automático de estrategias · barrido amplio + validación out-of-sample + reporte ordenable · protegido contra data mining*
