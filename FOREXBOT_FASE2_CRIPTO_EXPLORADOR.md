# ForexBot — Subproyecto CRIPTO · Fase 2: modelo de costos + Explorador net/OOS/holdout

**Fecha:** 2026-07-05 · **Continúa:** `FOREXBOT_FASE0_CRIPTO_DIAGNOSTICO.md` (arquitectura y contrato BrokerClient) y la Fase 1 (bridge `<crypto bridge path>` :8001, BybitClient datos públicos, core forkeado byte-idéntico).
**Estado: FASE 2 COMPLETA** (2a costos · 2b-i explorador bridge · verificación holdout · 2b-ii routing web · **2b-iii cross-pair ETHUSDT** · **2b-v multi-timeframe** · **2b-vi doble cross-pair SOL + combined**). Cripto sigue siendo **solo lectura** — la ejecución (testnet) es Fase 4.

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

## 4. Cross-pair ETHUSDT (2b-iii) — COMPLETO. ¿Estructura o peculiaridad de BTC?

`cbot: scripts/verify_crosspair_eth.py + docs/FASE2B_CROSSPAIR_ETH.md` (commit `7fb99de`).
9 configs **CONGELADAS** (cero re-optimización) sobre ETHUSDT H4 2022-01→2026-07, costos
completos con funding real de ETH (4.939 eventos verificados, 79 % positivos).

- **Datos ETH verificados antes de correr**: tickSize 0.01 → point 0.01/pip 0.1/pip_value 0.1/
  contract 1 (invariante monetaria OK); 9.877 velas H4 con cobertura completa desde 2022-01-01.
- **Bug cazado**: `funding_history` truncaba rangos >3,7 años (max_pages=20 → faltaban ~10 meses
  de funding en 2022). Arreglado (40 págs) + `ENGINE_VERSION=5` (caché invalidada). El re-sweep de
  BTC con funding completo reproduce los MISMOS 6 finales de §3 con números casi idénticos.
- **Resultado (criterio VIAJA: PF neto ETH >1.0 con y sin funding)**:

  | Candidata | PF holdout BTC | PF BTC mismo rango | **PF ETH** | sin funding | Veredicto |
  |---|--:|--:|--:|--:|---|
  | **ichimoku 12/52/104 sin SL** | 1.492 | 1.329 | **1.150** | 1.148 | ✅ VIAJA |
  | **ichimoku 12/52/104 ATR3/4** | 1.414 | 1.572 | **1.168** | 1.164 | ✅ VIAJA |
  | **ichimoku 12/52/104 ATR3/3** | 1.670 | 1.593 | **1.096** | 1.091 | ✅ VIAJA |
  | rsi 14/30/75 sin SL | 1.287 | 1.294 | **0.729** | 0.717 | ❌ |
  | rsi 14/25/75 sin SL | 1.127 | 1.306 | **0.602** | 0.578 | ❌ |
  | rsi 21/30/70 ATR3/4 | 1.226 | 1.146 | **0.906** | 0.897 | ❌ |
  | ma_cross ema20/50 (×3 variantes) | 1.085-1.172 | 1.207-1.323 | **0.915-0.992** | ídem | ❌ |

  La columna "BTC mismo rango" (todas >1) descarta el efecto ventana: el desplome en ETH es del PAR.
- **Sweep nativo de ETH** (pregunta separada, mismo protocolo): sus 10 inside finales son OTRAS
  familias — supertrend 14/2.0 (PF hold 1.287), bollinger 30/2.5 (1.59), donchian, cci, a 34-88
  trd/año — **exactamente lo que murió en BTC**. (Estatus: descubrimientos de UN par, pendientes de
  su propia validación cruzada, como lo estaban las candidatas BTC antes de esta sección.)

**VEREDICTO**: solo **ichimoku 12/52/104 viaja — en sus TRES variantes** (PF ETH 1.10-1.17,
modesto pero positivo y sin depender del funding). Las RSI de reversión son **par-específicas de
BTC** (0.60-0.91 en ETH). **La familia "reversión de baja rotación" NO es estructura de cripto-H4**;
cada par tiene carácter propio. Lo único con rasgos de estructura cross-pair: **ichimoku 12/52/104
a rotación baja** — único superviviente de la cadena OOS → holdout virgen → sin funding →
cross-pair. El activo transferible del subproyecto es el **pipeline de verificación**, no una
familia de estrategias.

## 5. Multi-timeframe BTCUSDT (2b-v) — COMPLETO. El peaje manda

`cbot: docs/FASE2B_MULTITF_BTC.md + scripts/multitf_btc_summary.json` (commit `6103719`).
Mismo protocolo E2E (472 configs, net + 3 tramos) por timeframe. Hipótesis del mecanismo
(costo por trade ~constante → bajar de TF multiplica el peaje relativo) **CONFIRMADA**:

| TF | inside OOS → FINAL | Supervivencia holdout | Mejor PF holdout | Mediana % comido (pool) |
|---|---|---|--:|--:|
| **D1** | 7 → **6** | **86 %** | **1.870** | **22.5 %** |
| H4 | 32 → 6 | 19 % | 1.670 | 59.0 % |
| **H1** | **0 → 0** | — | — | **715.8 %** |

- **H1 = cementerio perfecto (472/472 outside)**: ni una candidata; incluso ichimoku 12/52/104
  queda 0.909 con 177 % comido a 110 trd/año. Las fees ejecutan todo, como predice el mecanismo.
- **D1 = el TF más fértil del proyecto**: menos candidatas pero mucho más sólidas (86 % sobrevive
  el holdout), y el mejor PF holdout hasta hoy: **combined EMA100+RSI (OR), ATR 2/4 → 1.870
  (+4.48 %)**. Los 6 finales D1 son todos de la familia `combined` — que en H4 nunca llegó a
  finales. Cautela: combined-D1 tiene estatus de UN par (como las RSI antes del cross-pair).
- H1 verificado contra la guardia anti-truncado: 39.505 velas < tope 60k → rango completo, sin
  ajuste. `SWEEP_TIMEFRAMES` cripto gana el chip **D1** en /crypto/explorer.
- Mapa de fertilidad BTC: **D1 > H4 ≫ H1** (M5/M15 ni se intentan: el peaje solo puede ser peor).
  En cripto, **el timeframe es una decisión de costos antes que de señal**.

## 6. Doble cross-pair (2b-vi) — COMPLETO. Ichimoku es ESTRUCTURA; combined viaja fino

`cbot: scripts/verify_crosspair.py (genérico) + docs/FASE2B_CROSSPAIR2_SOL_COMBINED.md`
(commit `d9945e4`). Configs CONGELADAS, criterio VIAJA = PF target >1 con y sin funding.

**SOLUSDT H4 — ichimoku 12/52/104 (el tercer par): 3/3 VIAJAN, y más fuerte que en ETH.**
Datos verificados: H4 completo desde 2022-01; funding 5.299 eventos con régimen DISTINTO
(rate medio −0.0031 %, 69.5 % positivos → los cortos muchas veces pagan).

| Variante | PF hold BTC | **PF SOL** | SOL sin funding | % comido |
|---|--:|--:|--:|--:|
| sin SL | 1.492 | **1.903** | **2.011** | 10.4 |
| ATR3/3 | 1.670 | **1.435** | 1.450 | 12.8 |
| ATR3/4 | 1.414 | **1.401** | 1.423 | 13.1 |

En SOL el funding le jugó EN CONTRA (~55-66 % corto con rate medio negativo) y aun así 1.903.
**VEREDICTO: ESTRUCTURA FIRME** — positiva en BTC (holdout), ETH y SOL, bajo tres regímenes de
funding, sin subsidio. Evidencia de los 3 favoritos ichimoku actualizada (label `viaja-sol` +
clave SOLUSDT en el cross).

**ETHUSDT D1 — combined EMA+RSI (OR), los 6 finales de 2b-v: 6/6 pasan, con margen FINO**
(PF 1.004–1.099 con funding, 1.029–1.140 sin él; 46-95 % comido; la mejor es justo la #1 del
holdout, EMA100 ATR2/4 → 1.099/1.140). **VEREDICTO: viaja con margen fino** — signo consistente
(no par-específico como las RSI, que daban 0.60-0.91) pero la magnitud es de BTC-D1. No
descartada, no consagrada: si entra a Favoritos, con su evidencia completa y sin reclamar
estructura al nivel de ichimoku.

Patrón general del subproyecto: **la magnitud casi nunca viaja; el SIGNO sí o no — esa es la
frontera entre estructura y ajuste al carácter de un par.**

## 7. Siguiente paso (pendiente)

1. **Favoritos cripto** (columna `market` en `favorites`/`explore_searches`): entra validada
   cross-pair SOLO ichimoku 12/52/104; las RSI, si entran, etiquetadas "solo BTC".
2. (Opcional) tercer par (SOLUSDT u otro linear USDT líquido) para re-testear a ichimoku:
   2 pares es evidencia, 3 sería estructura firme. Y validación cruzada inversa de los nativos de
   ETH (supertrend/bollinger) sobre BTC — ya sabemos que mueren allí: refuerza el carácter por par.
3. (Opcional) selector global de mercado encima de la ruta separada; más TFs/rangos si el tope de
   paginación lo permite.
4. Fase 4 (lejana): ejecución testnet (auth firmada HMAC, orderLinkId, netting) — stubs 501 listos.

**Reglas vigentes**: forex (<project path>, :8000) intocable; métricas de decisión SIEMPRE netas;
cripto solo demo/testnet cuando llegue la ejecución; commits locales (push manual del usuario).
