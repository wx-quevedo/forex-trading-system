# ForexBot — Subproyecto CRIPTO · Fase 2: modelo de costos + Explorador net/OOS/holdout

**Fecha:** 2026-07-05 · **Continúa:** `FOREXBOT_FASE0_CRIPTO_DIAGNOSTICO.md` (arquitectura y contrato BrokerClient) y la Fase 1 (bridge `D:\cbot` :8001, BybitClient datos públicos, core forkeado byte-idéntico).
**Estado: FASE 2 COMPLETA** (2a costos · 2b-i explorador bridge · verificación holdout · 2b-ii routing web). Cripto sigue siendo **solo lectura** — la ejecución (testnet) es Fase 4.

---

## 1. Modelo de costos (2a) — COMPLETO

`cbot: app/crypto_costs.py` + `app/crypto_backtest.py` (commits cbot `75b8c95`, `1772807`, `55c1dc6`).

- **Post-proceso**: el engine byte-idéntico corre BRUTO; después se ajusta cada trade con
  **fees taker 0.055 %/lado** (%-del-notional, imposible en el modelo fijo-por-lote del engine),
  **funding 8h con rates REALES de Bybit** (signo por dirección: el largo paga rate positivo, el
  corto lo cobra) y **slippage 0.02 %/lado**. Métricas netas recalculadas con el
  `_compute_metrics` del propio engine (import, no edición) → SHA256 del core intacto.
- `crypto_backtest.run_backtest` = **drop-in NETO** del engine (misma firma/shape, `metrics_gross`
  al lado; funding/tasas viajan por `config`). Es el ÚNICO punto de repoint para reutilizar el
  walk-forward del forex.
- Lección que motivó todo: MACD H4 BTC pasó de PF bruto 1.211 (+788 USD) a **neto 1.041 (+167)**
  — los costos comieron el 78.8 % del bruto. El backtest bruto MIENTE en cripto.

## 2. Explorador cripto en el bridge (2b-i) + verificación — COMPLETO

`cbot: app/optimize/ (fork), app/routers/sweep.py` (commit `55c1dc6`) y
`scripts/verify_holdout.py + docs/FASE2B_VERIFICACION_HOLDOUT.md` (commit `e727daa`).

- Walk-forward del forex reutilizado con **repoint de 1 línea** a `crypto_backtest` → ranking por
  **out-of-sample NETO** (nunca in-sample, nunca bruto), con columnas del mecanismo (PF bruto vs
  neto, % comido, trades/año, % tiempo corto).
- **Verificación con holdout virgen** (2025-07→2026-07, año que ninguna decisión vio; params
  congelados): **5 de 8 top se cayeron** — incluida la #1 del ranking (cci 40/150: OOS 1.401 →
  holdout **0.751**) y la de PF más alto (rsi 14/30/65: 1.630 → 0.802). El PF brillante en el tramo
  de selección NO predice; la persistencia sí.
- **Candidatas REALES (sobreviven holdout Y funding=0)** — sin SL/TP, H4 BTCUSDT:

  | Candidata | PF holdout | PF sin funding | trd/año | Nota |
  |---|--:|--:|--:|---|
  | **ichimoku 12/52/104** | **1.492** | 1.470 | ~10 | La más fuerte; mejoró vs OOS |
  | **rsi 14/30/75** | **1.287** | 1.322 | ~12 | Gana incluso PAGANDO funding |
  | **rsi 14/25/75** | **1.127** | 1.094 | ~10 | Real pero margen fino |

- Hipótesis de baja frecuencia, forma final: **rotación mínima REAL (10-30 trd/año) + edge bruto
  genuino**, medida por trades/año, no por familia (supertrend/macd/psar en H4 churnean 82-168
  trd/año y mueren por fees; el funding cobrado por cortos es subsidio regime-dependiente, no edge).

## 3. Explorador web con TERCER TRAMO integrado (2b-ii) — COMPLETO

`cbot: app/explore/ (fork) + routers/explore.py` (commit `b82fd39`) ·
`mtrad: routing Laravel/React` (commit `e94eeef`).

- **Bridge**: fork del motor grande (jobs, caché SQLite, 30 workers) en NETO, con
  **holdout SIEMPRE integrado**: cada barrido reserva el 15 % final del rango
  (`holdout_split`, configurable; split efectivo ~60/25/15), rankea por OOS, y re-corre los top-N
  **CONGELADOS** en el holdout → veredicto FINAL (≥1.05 aguanta · 0.98-1.05 degrada · <0.98
  outside). **Todas las inside se examinan siempre.** Clave de caché extendida con las tasas;
  guardia anti-histórico-truncado (tope de paginación Bybit en M5/M15 largos → grupo saltado con
  motivo, nunca un rango silenciosamente incompleto).
- **Web**: `/crypto/explorer` = la MISMA página React del forex con prop `market='crypto'`
  (default `'forex'` → forex intocado; tests 71/71). `PythonBridgeService::forMarket('crypto')` →
  :8001. En cripto: modo ATR por defecto, columnas netas + holdout + FINAL; favoritos/guardar/
  "Validar top-N" ocultos (el holdout integrado sustituye la validación manual).
- **E2E real** (BTCUSDT H4 2022-01→2026-07, 472 configs, 11 familias, ~15 s):
  32 inside por OOS → **6 inside FINALES** tras el holdout:

  | Config (SL/TP ×ATR) | trd/año | PF neto | % comido | PF OOS | PF holdout | ret hold |
  |---|--:|--:|--:|--:|--:|--:|
  | ichimoku 12/52/104 (3/3) | 23 | 1.529 | 16.5 | 1.774 | **1.670** | +3.49 % |
  | ichimoku 12/52/104 (3/4) | 22 | 1.535 | 16.5 | 1.899 | **1.414** | +2.24 % |
  | rsi 21/30/70 (3/4) | 24 | 1.159 | 15.6 | 1.328 | **1.226** | +1.46 % |
  | ma_cross ema 20/50 (2/4) | 39 | 1.302 | 25.3 | 1.611 | **1.172** | +2.91 % |
  | ma_cross ema 20/50 (3/4) | 39 | 1.218 | 29.1 | 1.333 | **1.118** | +1.51 % |
  | ma_cross ema 20/50 (2/3) | 39 | 1.422 | 21.0 | 1.865 | **1.085** | +1.37 % |

  `ichimoku 12/52/104` domina también con SL/TP por ATR — consistente con la verificación manual.
  `ma_cross ema 20/50` es descubrimiento nuevo del Explorador (solo el holdout lo separó de la paja).

## 4. Siguiente paso (pendiente)

1. **Cross-pair: validar las candidatas en ETHUSDT** (y luego más pares linear USDT) — mismas
   configs congeladas, net+holdout. Un edge que solo existe en BTC es sospechoso; uno que se repite
   en ETH es estructura. **Esto va ANTES de Favoritos cripto.**
2. Favoritos/búsquedas guardadas cripto: columna `market` en `favorites`/`explore_searches`
   (diferida a propósito en 2b-ii).
3. (Opcional) selector global de mercado encima de la ruta separada; más TFs/rangos si el tope de
   paginación lo permite.
4. Fase 4 (lejana): ejecución testnet (auth firmada HMAC, orderLinkId, netting) — stubs 501 listos.

**Reglas vigentes**: forex (D:\mtrad, :8000) intocable; métricas de decisión SIEMPRE netas;
cripto solo demo/testnet cuando llegue la ejecución; commits locales (push manual del usuario).
