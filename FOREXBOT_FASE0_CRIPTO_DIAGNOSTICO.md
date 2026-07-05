# Fase 0 — Diagnóstico de arquitectura: subproyecto CRIPTO (Bybit)

**Documento fundacional.** Mapa honesto del acoplamiento a MT5 de la plataforma forex y contrato
`BrokerClient` para añadir Bybit **sin tocar ni arriesgar** lo que ya funciona en forex.

- **Regla de oro:** el bridge forex (`D:\mtrad\bridge`, MT5) NO se toca. Cripto vive en un **bridge
  separado** (`D:\cbot`, proceso/puerto propios).
- **Alcance inicial:** solo **BTC**, **testnet** de Bybit para ejecución, datos históricos de
  **mainnet público**.

---

## 0. Confirmaciones de las 3 decisiones

| Decisión | Veredicto |
|---|---|
| **Datos mainnet público / ejecución testnet** | ✅ CORRECTO. Klines, tickers e instruments-info de Bybit son **públicos (sin auth)**; place-order/positions/wallet requieren **HMAC firmado**. El split es limpio. |
| **Bridge separado (`D:\cbot`, puerto propio)** | ✅ CONCUERDO y es lo natural. El bridge ya está escrito contra `client.X` (no contra la lib `mt5`), así que un bridge cripto es "copiar la estructura y cambiar el `client`". Forex intocable. |
| **Solo BTC + testnet** | ✅ Bien. Usar **linear USDT perp (BTCUSDT)**: qty en BTC, PnL en USDT — mapea 1:1 al modelo qty/price/PnL de la plataforma (mejor que inverse/coin-margined). |

---

## 1. Acoplamiento a MT5 — narrow y consistente (hay una interfaz DE FACTO)

Todo el bridge accede al bróker a través de **un único objeto `client`** (singleton `MT5Client`,
`bridge/app/mt5_client.py:648`), importado como `from ..mt5_client import client`. **Fuera de
`mt5_client.py`, NADIE llama a la librería `mt5` directamente.** Ese conjunto de métodos es el contrato.

| Capacidad | Método | Sitios de llamada |
|---|---|---|
| Velas históricas | `candles()` | routers: market, backtest, optimize, strategy · explore/engine · bot/runner · bot/preview |
| Precio en vivo | `price()` | market, stream, bot/executor |
| Perfil/costos del instrumento | `symbol_costs()` | backtest, optimize, explore, bot/order, bot/runner |
| Info de símbolo | `symbol_info()` | market, bot/order |
| Sesión de mercado | `symbol_session()` | market, bot/runner |
| Cuenta | `account_info()` | account, bot/executor, bot/runner |
| Universo de símbolos | `symbols()` | account |
| **Ejecución** | `send_order()`, `close_position()`, `positions()`, `orders()`, `closed_position_pnl()`, `history_deals()`, `resolve_tradable_symbol()`, `status()` | trading, market, bot/executor, bot/runner |

**Conclusión:** no hay ABC, pero el `client` ES la interfaz. → Formalizar `BrokerClient` (§7) y que
`BybitClient` lo cumpla. **Riesgo cero para forex:** al inicio NO se toca `mt5_client.py`; el bridge
cripto define su `BybitClient` con los mismos nombres de método (duck typing).

---

## 2. Motor de backtest — AGNÓSTICO (con un matiz de costos)

- La aritmética de `bridge/app/backtest/engine.py` es genérica: opera sobre **precio** y **ATR** (en
  unidades de precio). El **único forex-ism** es `pip_size()` (JPY→0.01 / resto→0.0001), y **solo se
  usa como fallback si falta `point`** (`engine.py:84-85`). Si el cliente provee `point` (vía
  `symbol_costs`), el heurístico no se toca.
- `pip = point×10` (convención forex) se **anula** con `pip_value_per_lot`: valor monetario =
  `(dist/pip) × pip_value_per_lot × vol`. Es consistente para cualquier bróker si el cliente devuelve
  un `pip_value_per_lot` acorde. BTC linear: `point`=tickSize, `pip_value_per_lot`≈valor del tick en
  USDT → la fórmula da qty en BTC correcta.
- **Un MACD sobre BTC (~60000) corre TAL CUAL:** las estrategias e indicadores (`bridge/app/strategy/`)
  trabajan sobre OHLC puro, sin pips. Cero cambios.
- **`bridge/app/backtest/sizing.py` es PURO y parametrizado** (`pip`, `pip_value_per_lot`,
  `volume_min/step`) — nada forex-específico. **Cero reescritura**: solo alimentarlo con los valores de
  Bybit vía `symbol_costs`.
- **Matiz real (costos):** el engine modela swap como `nights × swap_pts` (overnight). Cripto usa
  **funding cada 8h (3×/día)**, no per-night. → ajuste MENOR del modelo de costos para cripto
  (no bloquea; el backtest corre, solo el coste de mantener se aproxima distinto). Ver §5.

---

## 3. Formato de datos — traducción trivial

**Vela que consume todo el sistema** (`mt5_client.py:626-644`, normalizada a UTC real en `candles()`):

```
{ "time": int (epoch UTC SEGUNDOS), "datetime": str (ISO),
  "open": float, "high": float, "low": float, "close": float,
  "tick_volume": int, "spread": int|None, "real_volume": int|None }
```

El engine usa `time`/OHLC; los indicadores usan `tick_volume`. Orden ascendente por `time`.

- **Bybit kline** `[start_ms, o, h, l, c, volume, turnover]` → `{time: start_ms//1000, OHLC: float,
  tick_volume: int(volume), spread: None, real_volume: None}`. Traducción de ~5 líneas.
- **Timeframes:** la plataforma pasa strings `"M1/M5/M15/M30/H1/H4/D1/W1"`; MT5 los mapea internamente.
  Bybit usa `"1/5/15/30/60/240/D/W"`. → tabla de mapeo **dentro de `BybitClient`** (H4→240, H1→60,
  M15→15, D1→D…). **La plataforma no cambia.**

---

## 4. Frontend — enrutar 2 bridges (poco invasivo)

- **El frontend NUNCA habla con el bridge directo.** React → Laravel (MarketController, BotController,
  Explorer/Backtest/Strategy controllers) → **`PythonBridgeService`** (base URL de
  `config('forexbot.bridge.url')` = `127.0.0.1:8000`). **Un solo punto de inyección.**
- **Punto más limpio:** parametrizar `PythonBridgeService` por mercado — un factory
  `PythonBridgeService::forMarket('crypto')` que elija la base URL (forex→8000, cripto→8001). Los
  controladores eligen el bridge según el `market` de la petición/estrategia.
- **Concepto "mercado":** columna `market` (`forex`|`crypto`) en `strategies`/`favorites`/`backtests`/
  `bot_runs` + un **selector global de mercado** en el layout (al estilo del Contexto). Los 7 módulos
  React son agnósticos (renderizan velas/métricas) → solo pasan qué mercado piden.
- **Invasividad: baja.** Con `market` default `forex`, las vistas actuales no cambian; solo se AÑADE el
  selector + el filtro. No rompe forex.

---

## 5. Diferencias de cripto — LOS DOS PUNTOS CAROS

### 🟢 24/7 (fácil, limpio)
`BybitClient.symbol_session()` devuelve **siempre** `{open: True, next_change: None, note: "Cripto:
24/7"}`. La caducidad A-1 entonces cuenta wall-clock (correcto: siempre abierto). La franja de mercado
muestra "Abierto · 24/7". **Nada que cambiar en runner/engine** — el cliente reporta always-open.

### 🔴 PUNTO CARO 1 — NETTING (una posición neta por símbolo)
> **Bybit linear one-way tiene UNA posición neta por símbolo.** NO hay N posiciones independientes por
> símbolo como los `magic` de MT5.

- **Backtest (módulos 1-3, 5): NO afecta** — el motor simula 1 posición de todas formas.
- **Bot en vivo (módulo 6): límite estructural.** No puedes correr 3 estrategias BTC con posiciones
  separadas sobre el mismo símbolo. Opciones a decidir en el diseño del bot en vivo:
  1. **1 estrategia por símbolo** (lo más simple; con "solo BTC" implica 1 estrategia BTC en vivo).
  2. **Hedge mode** (long + short = 2 posiciones).
  3. **Tracking "virtual"** de sub-posiciones en el bridge (complejo; reparte la posición neta).

### 🔴 PUNTO CARO 2 — EJECUCIÓN FIRMADA (magic → orderLinkId, SL/TP, HMAC, funding)
- **Auth:** endpoints privados (order/position/wallet) con **HMAC SHA256** (key/secret/timestamp/
  recv_window). Datos públicos (klines/tickers/instruments) sin auth.
- **Atribución magic → orderLinkId:** MT5 atribuye posición↔estrategia por `magic` (`executor.py:61`;
  `bot_positions` filtra por magic). Bybit no tiene magic → encodear `strategy_id` en **`orderLinkId`**
  y que `BybitClient.positions()` **sintetice** un campo `magic`. Contenible en el cliente.
- **SL/TP:** MT5 los adjunta a la posición. Bybit los pone vía `takeProfit`/`stopLoss` del place-order
  o `set-trading-stop`. `BybitClient.send_order` mapea `sl`/`tp` internamente.
- **Funding vs swap:** funding cada 8h (3×/día) en lugar de swap overnight (ver §2). Ajuste de costos.
- **Ticket:** MT5 usa `ticket` (int). Bybit usa `orderId`/`positionIdx` (strings). El cliente mapea a
  un "ticket" para conservar la interfaz.

### Otros (menores)
- **WS vs polling:** la plataforma **pollea** (velas cada 15s, `/price`). Bybit REST cubre todo → **WS
  no es necesario** para paridad (optimización futura).

---

## 6. Veredicto por módulo (los 7)

| # | Módulo | Veredicto | Motivo |
|---|---|---|---|
| 1 | **Explorador** | 🟢 reuso + routing | Motor backtest agnóstico + `explore/engine.py` (candles/symbol_costs vía BybitClient). Cambios: routing por market. |
| 2 | **Laboratorio** | 🟢 reuso + routing | backtest + optimize efímeros, mismo motor. |
| 3 | **Mapa (coverage)** | 🟢 reuso + routing | Opera sobre resultados del explorador. |
| 4 | **Favoritos** | 🟡 menor | DB: columna `market` + filtro. |
| 5 | **Bot Histórico** | 🟢 reuso + routing | Reusa `/backtests/ephemeral` (mismo motor honesto). |
| 6 | **Bot en vivo** | 🔴 **trabajo nuevo real** | `BybitClient` de ejecución (send_order firmado, positions, close, SL/TP) + atribución magic→orderLinkId + **límite de NETTING**. El módulo caro. |
| 7 | **Contexto/Configuraciones** | 🟡 menor | Awareness de `market` en los settings globales. |

**Transversal:** `BybitClient` completo (§7) + plumbing Laravel/React de "market". El ~80% analítico
(engine/strategies/sizing/indicators/guards + routers de datos/backtest) se reutiliza sin tocar.

---

## 7. Contrato `BrokerClient` (shape, no implementación)

Formaliza el contrato de facto que `MT5Client` ya cumple. `BybitClient` deberá cumplirlo. Firmas en
Python (el bridge es Python). **Cada método marcado `[F1]` (Fase 1, datos, sin auth) o `[F4]`
(Fase 4, ejecución, requiere auth firmada).**

> **Estrategia de fases:** en **Fase 1** se implementan de verdad SOLO los métodos `[F1]`; los `[F4]`
> se dejan como **stubs** `raise NotImplementedError("Fase 4: ejecución cripto pendiente")`. Así el
> bridge cripto sirve datos + backtest + Explorador sin tocar la ejecución.

### DATOS — Fase 1

```python
# [F1] Velas OHLCV. time en epoch UTC SEGUNDOS, orden ascendente.
def candles(symbol: str, timeframe: str,
            date_from: datetime | None = None,
            date_to: datetime | None = None,
            count: int | None = None) -> list[dict]:
    # -> [ {time:int, datetime:str, open:float, high:float, low:float,
    #       close:float, tick_volume:int, spread:int|None, real_volume:int|None}, ... ]

# [F1] Precio actual (ticker). time en epoch UTC segundos.
def price(symbol: str) -> dict:
    # -> {bid:float, ask:float, last:float, time:int, symbol:str, ...}

# [F1] Info de símbolo (precisión + volúmenes + stops mínimos).
def symbol_info(symbol: str) -> dict:
    # -> {name:str, description:str, path:str, digits:int, point:float, spread:int,
    #     swap_long:float, swap_short:float, trade_mode:int, visible:bool,
    #     trade_stops_level:int, volume_max:float, volume_min:float, volume_step:float}

# [F1] Perfil de costos/aritmética que CONSUMEN el motor de backtest y sizing.py.
#      ES EL MÁS CRÍTICO de Fase 1: de él dependen sizing y PnL.
def symbol_costs(symbol: str) -> dict:
    # -> {point:float, pip:float, pip_value_per_lot:float, spread_pips:float,
    #     commission_per_lot:float, swap_long_pts:float, swap_short_pts:float,
    #     volume_min:float, volume_step:float, contract_size:float, type:str}
    #  BTC linear: point=tickSize, pip_value_per_lot≈valor tick USDT, volume_min/step=0.001,
    #  commission_per_lot=fee taker, swap_*=aprox de funding (o 0 y modelar aparte).

# [F1] Universo de símbolos operables.
def symbols(group: str | None = None) -> list[dict]:
    # -> [ {name:str, description:str, path:str, digits:int, spread:int,
    #       trade_mode:int, visible:bool, bid:float, ask:float}, ... ]

# [F1] Estado de mercado. CRIPTO: siempre {open:True, next_change:None, note:"24/7"}.
def symbol_session(symbol: str) -> dict:
    # -> {symbol:str, open:bool, last_tick_age_seconds:int|None,
    #     next_change:int|None, next_change_type:'open'|'close'|None, note:str}

# [F1] Normaliza un símbolo base al operable real. CRIPTO: identidad o map (BTCUSD->BTCUSDT).
def resolve_tradable_symbol(base: str) -> str:  # -> str

# [F1] Conectividad/estado del bróker (para /health). CRIPTO: testnet alcanzable.
def status() -> dict:
    # -> {connected:bool, ...}  (forex añade terminal/account_login/server)
```

### EJECUCIÓN — Fase 4 (stubs en Fase 1)

```python
# [F4] Balance/equity de la cuenta (REQUIERE AUTH). El backtest NO lo usa (initial_balance fijo);
#      lo usa el ejecutor/preview en vivo. En F1 puede ser stub o devolver balance testnet fijo.
def account_info() -> dict:
    # -> {balance:float, equity:float, currency:str, ...}

# [F4] Envía orden de mercado. order_type: "BUY"|"SELL". Devuelve el resultado del bróker;
#      LANZA excepción si la rechaza. CRIPTO: sl/tp->stopLoss/takeProfit, magic->orderLinkId.
def send_order(symbol: str, order_type: str, volume: float,
               sl: float | None = None, tp: float | None = None,
               comment: str = "", magic: int = 0, deviation: int = 20) -> dict:
    # -> {retcode:int, order:int(ticket), deal:int, volume:float, price:float, comment:str, ...}

# [F4] Cierra una posición por ticket. CRIPTO: reduce-only / set size 0.
def close_position(ticket: int, deviation: int = 20) -> dict:  # -> {retcode, order, ...}

# [F4] Posiciones abiertas. type:0=buy/1=sell, time UTC segundos, magic identifica la estrategia.
#      CRIPTO: <=1 posición NETA por símbolo (netting); magic sintetizado de orderLinkId.
def positions(symbol: str | None = None) -> list[dict]:
    # -> [ {ticket:int, time:int, type:int, magic:int, volume:float, price_open:float,
    #       sl:float, tp:float, price_current:float, swap:float, profit:float,
    #       symbol:str, comment:str}, ... ]

# [F4] Órdenes pendientes.
def orders(symbol: str | None = None) -> list[dict]:  # -> [ {...}, ... ]

# [F4] PnL realizado de una posición cerrada (para reconciliar cierres por SL/TP).
def closed_position_pnl(ticket: int) -> dict | None:
    # -> {pnl:float, close_price:float, close_time:int} | None
```

**Resumen del split:**

| Fase | Métodos | Auth | Para qué |
|---|---|---|---|
| **Fase 1 (datos)** | `candles`, `price`, `symbol_info`, `symbol_costs`, `symbols`, `symbol_session`, `resolve_tradable_symbol`, `status` | Público (sin auth) | Datos + backtest + Explorador/Lab/Mapa/Histórico |
| **Fase 4 (ejecución)** | `account_info`, `send_order`, `close_position`, `positions`, `orders`, `closed_position_pnl` | HMAC firmado (testnet) | Bot en vivo cripto |

En Fase 1, los `[F4]` son `raise NotImplementedError`. El bot en vivo cripto (rutas `/bot/*`) queda
deshabilitado/erroneo con gracia hasta Fase 4; los módulos de análisis funcionan.

---

## 8. Tamaño real del subproyecto

- **Barato / reuso (Fases 1-3):** el motor de análisis (5 de 7 módulos) es agnóstico → casi gratis.
  Requiere: `BybitClient` mitad-datos (8 métodos `[F1]`), routing Laravel por market, columna `market`,
  selector de mercado en React.
- **Caro / nuevo (Fase 4):** `BybitClient` mitad-ejecución (6 métodos `[F4]`) + adaptar el bot en vivo
  al **netting** y a la **atribución magic→orderLinkId** + SL/TP firmado + modelo de funding.
- **Riesgo a forex: mínimo** — bridge separado + duck-typing; no se toca `mt5_client.py` ni el bridge forex.

**Plan de fases sugerido:** F1 datos+Explorador (stubs de ejecución) · F2 Lab/Mapa/Favoritos/Histórico ·
F3 plumbing "market" en UI · F4 bot en vivo cripto (ejecución firmada + netting).
