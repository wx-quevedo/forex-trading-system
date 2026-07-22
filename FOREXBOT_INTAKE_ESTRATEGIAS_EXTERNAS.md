# Intake de estrategias externas — encaje, lotes y estado

**Fecha:** 2026-07-08 · **Alcance:** replicar 10 señales externas (5 académicas + 5
comunitarias) en el motor propio y pasarlas por el pipeline completo (3 tramos, costos
netos en cripto, cross-pair a las supervivientes). Este doc registra la tabla de encaje,
el orden por lotes y el estado de implementación.

## ⛔ BLOQUEANTE ABIERTO (no borrar hasta resolverlo)

El backtester soporta la señal **'close'** (cerrar a plano sin abrir la contraria — Lote 0).
**El `runner.py` del bot en vivo NO la entiende** (solo buy/sell). Antes de armar EN VIVO
cualquier estrategia que la emita (`connors`, `ibs` long-flat, futuras con
salida-por-condición: squeeze momentum, wavetrend, heikin-ashi), **extender el runner con
el mismo significado que el backtest** — o habrá divergencia backtest↔vivo (el vivo
mantendría posiciones que el backtest cierra). También anotado en `FOREXBOT_PROJECT.md`.

## Hechos del framework que gobiernan el encaje

1. Estrategia = clase `evaluate()` + rama vectorizada en `signal_series()` + registry/schemas
   (`strategy/strategies.py`). Alta de estrategia = editar el core COMPARTIDO → forex-first,
   re-copia a cbot byte-idéntica, SHA256, `ENGINE_VERSION` bump, reinicio de ambos bridges.
2. El motor solo actuaba sobre buy/sell (señal contraria = revertir). El **Lote 0** añadió
   `'close'` (cierre a plano, `exit_reason='signal'`); backward-compat verificada.
3. Los vetos son condiciones AND dentro de la señal (patrón `combined`). Multi-timeframe NO
   (una serie por backtest): filtros "D1" corriendo en H4 se aproximan con EMA equivalente.

## Tabla de encaje (resumen; la versión razonada quedó en la sesión del 2026-07-08)

| # | Candidata | Fuente | Indicadores nuevos | Salida propia | Lote |
|--:|---|---|---|---|---|
| 1 | TSM | Moskowitz-Ooi-Pedersen 2012 (JFE) | `roc` | no (reversión nativa) | **1 ✅** |
| 2 | TSM vol-managed | Barroso/Santa-Clara 2015; Moreira/Muir 2017 | — | no (veto binario; el original escala 1/σ² — distorsión documentada) | **1 ✅** |
| 6 | IBS | QuantifiedStrategies / Alvarez; Pagonidis 2013 | `ibs` | symmetric: no · longflat: **'close'** | **1 ✅** |
| 4 | Connors RSI(2) | Connors & Alvarez 2008 | — | **'close'** (RSI2 cruza 50) | **1 ✅** |
| 5 | Squeeze Crabel | Crabel 1990 | bb_width + mín rodante | no | 2 |
| 7 | Squeeze Momentum | LazyBear / TTM | keltner + linreg-momentum | **'close'** | 2 |
| 9 | BinHV45 → H4/D1 | freqtrade-strategies (berlinguyinca); BB(40,2), bbdelta/closedelta/tail, params b7/c17/t25 ÷1000 (clásicos 0.008/0.0175/0.25) | — (compone de bollinger) | no (ROI/stop = nuestro TP/SL) | 2 |
| 8 | WaveTrend | LazyBear (esa/ci/tci 10/21, ±60) | `wavetrend` | **'close'** | 3 |
| 10 | Heikin-Ashi + EMA | receta comunitaria estándar | `heikin_ashi` (recursivo) | **'close'** | 3 |
| 3 | Funding carry | carry clásico aplicado a perps | serie funding como columna del candle (capa cbot; señal compartida degrada a inerte sin columna) | no | 4 / aparcar |

## Estado

- **Lote 0 — HECHO (2026-07-08, sin commit aún):** `SignalType` + `elif 'close'` en el engine.
  Identidad verificada doble: (a) 4 backtests forex bridge-VIVO (código viejo) vs código
  nuevo en-proceso, mismas velas/costos → métricas IDÉNTICAS campo a campo; (b) re-sweep
  cripto BTC H4+D1 de las 11 familias previas vs baseline v5 commiteada → conteos y 6+6
  finals idénticos, 0 diferencias. Tests: `tests/test_close_signal.py` (5) — suite bridge
  145 passed + 3 fallos PREEXISTENTES de `test_bot` (FakeClient sin `symbol_costs`, del
  commit 501aade — no relacionados).
- **Lote 1 — HECHO (sin commit):** `tsm`, `tsm_vol`, `ibs` (2 modos), `connors` con fuentes
  en docstring; `roc`+`ibs` en indicators; grids optimize (forex y fork cbot); KNOWN_TYPES/
  EXPLORE_TYPES/StrategyRequest/labels UI. cbot re-forkeado (7/7 SHA256, nueva línea base),
  `ENGINE_VERSION 6`, bridge 8001 reiniciado. **Forex NO reiniciado** (código listo en
  disco; cargará en la ventana del finde con el protocolo de siempre).
- **Sweep cripto Lote 1 (BTCUSDT, net + 3 tramos):**
  - **H4 = cementerio total: 140/140 outside FINAL** (mediana comido 238 %). Tal como
    predijo el mecanismo — incluso TSM churnea en H4 (108-112 trd/año, holdout 0.684).
  - **D1: 4 inside FINALES** — `connors 100/2/15` (ATR 2/3 y 2/4: PF full 1.609, 21.7 %
    comido, 22.7 trd/año, holdout 1.10 con retH +0.18 % — aguanta por poco y con magnitud
    mínima) e `ibs symmetric 0.25/0.8` y `0.25/0.75` (85-98 trd/año, holdout 1.20/1.10) —
    la sorpresa: alta rotación que sobrevive en D1.
  - **TSM D1: OOS espectacular (PF 5.4) pero NO llega a final** — inconsistencia in↔out /
    holdout plano (tsm_vol quedó edge con holdout 1.033). La promesa era del tramo de
    selección, el pipeline la degradó — working as intended.
- **Cross-pair de las supervivientes D1 (2b-viii, HECHO 2026-07-08): 0/6 — NINGUNA viaja.**
  Congeladas a ETHUSDT y SOLUSDT D1 (control BTC-mismo-rango >1 en las tres): ibs 0.25/0.8
  → 0.855 ETH / 0.871 SOL; ibs 0.25/0.75 → 0.881 / 0.798; connors 100/2/15 → 0.674 / 0.581.
  Todas pierden incluso en BRUTO en los pares cruzados (con/sin funding indistinto).
  **Par-específicas de BTC** — coherente con el holdout raspado de connors (+0.18 %).
  Ninguna entra a Favoritos. El Lote 1 completo queda: réplicas correctas, edge NO portable.
- **Refinamiento de la ley de costos (lo que IBS demostró):** la ley no es "baja rotación"
  a secas — es **captura-por-trade vs peaje-por-trade**. El peaje por trade es ~constante
  (fee % del notional); lo que decide es cuánto captura el trade típico del timeframe.
  IBS-D1 rota 86-98 veces/año (más que supertrend-H4, que murió) y aun así pasó su holdout
  BTC con 36 % de peaje, porque la captura media de una vela D1 es ~4× la de H4. D1 soporta
  rotaciones que H4 no. Corolario para los Lotes 2-4: la rotación estimada hay que leerla
  SIEMPRE junto al timeframe, no como número absoluto.
- **Pendiente:** Lotes 2-4; reinicio forex del finde (+ `Cache::forget('forexbot.
  strategy_schemas')` tras reiniciar para que la UI cargue los schemas nuevos); sweep del
  Lote 1 en FOREX tras ese reinicio (la otra mitad de la validación).
