# ForexBot — Laravel Backend (Fase 2)

Backend y orquestador de la plataforma (Capa de Aplicación). Gestiona estrategias,
backtests, trades, análisis IA y el ciclo del bot, y consume el **bridge Python MT5**
de forma privada (vía Tailscale en producción). Frontend SPA (React + Inertia) llega
en la Fase 3.

> Stack: Laravel 12 · PHP 8.3 · SQLite (local) / MySQL (prod) · Reverb (WebSockets) · Vite.

---

## 1. Requisitos

- PHP **8.3** con extensiones: `pdo_sqlite`, `sqlite3`, `mbstring`, `openssl`, `curl`, `fileinfo`, `zip`
- Composer 2
- Node 18+ / npm

## 2. Puesta en marcha (local)

```bash
cd app
composer install
npm install
cp .env.example .env          # ya viene un .env de desarrollo
php artisan key:generate
php artisan migrate --seed     # crea las tablas y el usuario admin
npm run build                  # o: npm run dev
php artisan serve --port=8080  # el bridge suele usar el 8000
```

### Usuario admin (autenticación básica, un solo usuario)

No hay credenciales por defecto. Antes de `php artisan migrate --seed` (o `db:seed`) define
en `.env`:

- `ADMIN_EMAIL` y `ADMIN_PASSWORD` (obligatorias; el seeder falla con
  "Define ADMIN_EMAIL y ADMIN_PASSWORD en .env antes de correr el seeder." si alguna está vacía).
- `ADMIN_NAME` (opcional, por defecto `ForexBot Admin`).

### Acceso desde la red local (iPhone / Mac / iPad) — ver `FOREXBOT_RED_LOCAL.md`

Comandos de uso diario (3 procesos en la tower):

```bash
# 1. Bridge MT5 — SOLO localhost (ejecuta órdenes reales; nunca expuesto a la red)
cd bridge && ./venv/Scripts/python.exe run.py            # enlaza 127.0.0.1:8000

# 2. Reverb (WebSockets) — escucha en todas las interfaces
cd app && php artisan reverb:start                       # 0.0.0.0:8085

# 3. Laravel — escucha en todas las interfaces
cd app && php artisan serve --host=0.0.0.0 --port=8090
```

Desde otro dispositivo en la **misma WiFi**: `http://<LAN_IP>:8090` (IP de la tower en la red local;
es DHCP, verifícala con `ipconfig` si cambia). `echo.js` deriva el host del WebSocket de
`window.location.hostname`, así que el tiempo real funciona igual desde `localhost` (en la
tower) y desde la IP (desde el iPhone) **sin recompilar**.

**Firewall (primera vez):** al escuchar en `0.0.0.0`, Windows Defender mostrará un popup
para PHP → **Permitir en redes privadas** (no públicas). Si no aparece, abrir los puertos
como administrador (NO el 8000):

```powershell
New-NetFirewallRule -DisplayName "ForexBot Laravel" -Direction Inbound -LocalPort 8090 -Protocol TCP -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "ForexBot Reverb"  -Direction Inbound -LocalPort 8085 -Protocol TCP -Action Allow -Profile Private
```

> Seguridad: el bridge (8000) queda en `127.0.0.1` — verificado que `<LAN_IP>:8000`
> rechaza la conexión desde la red, mientras `127.0.0.1:8000` (Laravel) sí responde.

## 3. Base de datos por entorno

- **local** → SQLite (`database/database.sqlite`, `DB_CONNECTION=sqlite`).
- **production** → MySQL (`DB_CONNECTION=mysql` en el `.env` del VPS).

Migraciones y modelos funcionan igual en ambos motores.

### Modelo de datos (§7 del documento maestro)

`strategies` (versionado self-FK) · `backtests` → strategies · `ai_analyses` → backtests ·
`bot_runs` → strategies · `trades` → bot_runs (nullable) · `signal_logs` → strategies ·
`price_alerts` → users. Los campos JSON (parameters, métricas, trades, equity curve,
indicator_values, signal_data) se castean a `array` en los modelos.

## 4. Bridge Python (Capa de Mercado)

`App\Services\PythonBridgeService` es el cliente HTTP del bridge (`config/forexbot.php`).
Métodos: `health, account, symbols, price, candles, positions, orders, history,
sendOrder, closePosition`. Los errores del bridge se traducen a `App\Services\BridgeException`
(conserva status HTTP y cuerpo).

Probar el enlace con el bridge en marcha:

```bash
php artisan bridge:health            # ping /health del bridge
php artisan bridge:health --account  # además lee la cuenta MT5 (requiere terminal abierto)
```

Variables en `.env`:

```env
BRIDGE_URL=http://127.0.0.1:8000     # en prod: hostname/IP Tailscale de la tower
BRIDGE_API_KEY=...                   # debe coincidir con la del bridge (header X-API-Key)
BRIDGE_TIMEOUT=15
```

## 5. WebSockets (Reverb + Echo)

- Servidor: `php artisan reverb:start` (config en `config/reverb.php`, credenciales `REVERB_*` en `.env`).
- Broadcasting: `BROADCAST_CONNECTION=reverb`, rutas de canales en `routes/channels.php`.
- Cliente: `resources/js/echo.js` (Echo + pusher-js) usa las `VITE_REVERB_*`. Se importa desde `bootstrap.js`.

## 6. Análisis IA (Anthropic) — Fase 6

`config/forexbot.php` ya expone `anthropic.api_key` y `anthropic.model`
(`claude-sonnet-4-6`). La integración se implementa en la Fase 6.

## 7. Frontend (Fase 3 — React + TypeScript + Inertia + Tailwind v4)

- SPA con **Inertia** + **React 19** + **TypeScript**, entrypoint `resources/js/app.tsx`, vista raíz `resources/views/app.blade.php`.
- **Tailwind v4** con la paleta dark de trading y fuentes (JetBrains Mono / Inter) en `resources/css/app.css`.
- Charts con **TradingView Lightweight Charts v5** (`Components/CandleChart.tsx`): velas + pane de volumen + oscilador seleccionable (RSI / MACD, calculados en `lib/indicators.ts`). KPIs con **Recharts** (pendiente de uso en backtests).
- Páginas: `Pages/Auth/Login.tsx`, `Pages/Dashboard.tsx`. Layout: `Layouts/AppLayout.tsx`.
- Componentes (§6 del doc): `PriceDisplay`, `MetricBadge`, `PositionCard`, `BotStatusIndicator`, `SignalLog`, `CandleChart`, `IndicatorPanel`.
- **Tiempo real:** el dashboard escucha el canal Reverb `trading` (evento `positions.updated`) y refresca posiciones; respaldo por polling. Para emitir posiciones desde MT5:

```bash
php artisan reverb:start                         # servidor WebSocket
php artisan bridge:broadcast-positions --watch   # sondea el bridge y emite por Reverb
```

> Tests: `phpunit.xml` fuerza SQLite en memoria (`:memory:`) para que los tests **no** toquen `database/database.sqlite`.

## 8. Estado de fases

- ✅ **Fase 1** — Bridge Python MT5 (carpeta `../bridge`)
- ✅ **Fase 2** — Backend Laravel: modelos/migraciones, `PythonBridgeService`, auth básica, Reverb + Echo
- ✅ **Fase 3** — Frontend: Dashboard + charts + posiciones en tiempo real
- ✅ **Fase 4** — Módulo de Estrategias: CRUD + versionado + formulario dinámico + motor Python + evaluación manual
- ✅ **Fase 5** — Motor de Backtesting: engine pandas + Job async + métricas + equity/PnL (Recharts) + chart con marcadores
- ✅ **Fase 6** — Análisis IA (Anthropic): chat sobre el backtest + sugerencias → nueva versión de estrategia
- ⏭ **Fase 7** — Bot en Vivo

## 11. Análisis IA (Fase 6)

Chat con Claude sobre un backtest completado en `/backtests/{id}/analysis` (botón
"Analizar con IA" en la vista del backtest). Usa el **SDK oficial `anthropic-ai/sdk`**
(`App\Services\ClaudeService`) contra la Messages API:

- Modelo configurable en `config/forexbot.php` (`ANTHROPIC_MODEL`, por defecto `claude-sonnet-4-6`).
- El contexto del backtest (estrategia, parámetros, métricas, muestra de trades) va en
  `system` con **prompt caching**; los turnos del chat en `messages`. Adaptive thinking activado.
- Claude puede devolver un bloque ```json con `suggested_parameters`; el botón
  **"Aplicar como nueva versión"** crea una versión nueva de la estrategia con esos
  parámetros (mismo versionado de la Fase 4). Cada intercambio se guarda en `ai_analyses`.

Requiere la clave en el `.env` del backend:

```env
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6
ANTHROPIC_PRICE_INPUT=3.0    # USD/1M tokens (para estimar coste)
ANTHROPIC_PRICE_OUTPUT=15.0
```

> Nota: el SDK no aplica su `timeout` al cliente PSR-18, y el análisis puede tardar
> >30s. El controlador usa `set_time_limit(180)` y `ClaudeService` fija un transporter
> Guzzle con `timeout: 180`. En Windows hace falta un CA bundle en `php.ini`
> (`curl.cainfo`/`openssl.cafile`) para las llamadas HTTPS salientes.

## 12. Modo manual de afinamiento (Fase 6B — copy-paste, sin coste de API)

Segundo modo en la vista de análisis, elegible con un **selector** (persistido en
`localStorage`, por defecto **Manual**):

- **Paso 1** — "Generar prompt": la plataforma arma un bloque de texto con la estrategia,
  sus parámetros, el **esquema de parámetros válidos** (`STRATEGY_SCHEMAS` del bridge) y
  las métricas del backtest. El usuario lo copia y lo pega en su **Claude.ai**.
- **Paso 2** — el usuario pega la respuesta JSON de Claude. El backend la **valida**
  robustamente (`App\Services\ManualTuningService`): extracción tolerante a ruido,
  parámetros del mismo tipo de estrategia, rangos del esquema, y límites de riesgo
  (`risk_percent ≤ 5`, sl/tp > 0). Muestra un **diff** antes/después y, al confirmar,
  crea una **nueva versión** de la estrategia (sin coste de API).

**Tracking de coste:** cada análisis por API guarda `input_tokens`/`output_tokens` y
`estimated_cost_usd`; el modo manual guarda coste `0`. La vista muestra el **coste API
acumulado del mes**. Endpoints: `GET /backtests/{id}/manual-prompt`,
`POST /backtests/{id}/manual/preview`, `POST /backtests/{id}/manual/apply`.

## 13. Workbench de afinamiento (Fase 6C — vista unificada)

`/backtests/{id}/workbench` (botón "Abrir workbench" en la vista del backtest) unifica
**estrategia + backtest + IA** en una pantalla para iterar sin cambiar de pestaña:

- **Panel de parámetros (sticky)** editable en vivo (formulario dinámico por tipo + riesgo + periodo).
- **Re-correr backtest** → corrida **efímera** síncrona contra el bridge
  (`POST /backtests/ephemeral`) que **NO persiste** nada (feedback inmediato, sin cola).
- **Comparación de 3 corridas** (`Components/RunComparison.tsx`): Inicial · Anterior · Actual,
  con flechas ▲/▼ por métrica (drawdown invertido correctamente) + "Fijar Actual como Inicial".
- **Equity curve** con overlay opcional de la corrida Anterior; chart de velas con marcadores
  de trades; tabla de trades con filtros.
- **Panel IA** (Manual/API, reutiliza Fase 6/6B): su botón **"Aplicar al panel"** rellena los
  campos editables (con un **highlight** azul) en lugar de crear una versión.
- **"Guardar como nueva versión"** (header): crea la versión con los parámetros del panel
  (`POST /strategies/{id}/save-version-from-workbench`) y, opcionalmente, persiste la corrida
  Actual como un `backtest` real ligado a la nueva versión.

## 10. Módulo de Backtesting (Fase 5)

Crear backtest en `/backtests`: estrategia + rango de fechas. Se crea una fila
`backtests` en estado `pending` y se despacha el Job **asíncrono** `App\Jobs\RunBacktest`
(Queue + Horizon en producción), que pide al bridge correr la simulación sobre datos
históricos de MT5 y persiste métricas/trades/equity. Al terminar emite el evento Reverb
`BacktestCompleted` y la vista de resultados se actualiza sola.

Procesar la cola en local (la conexión es `database`):

```bash
php artisan queue:work        # o queue:listen; en prod: Horizon
```

La vista de resultados (`Pages/Backtests/Show.tsx`) muestra: métricas (win rate, profit
factor, Sharpe, Sortino, max drawdown, rachas), **equity curve** y **PnL por mes**
(Recharts), **distribución de PnL por trade**, **chart de velas con marcadores** de cada
trade (`Components/BacktestChart.tsx`) y tabla de trades con filtros.

> Motor: backtester event-driven en pandas (`bridge/app/backtest/`), no vectorbt —
> evita el peso de numba en Windows y da control total sobre métricas y marcadores.

## 9. Módulo de Estrategias (Fase 4)

CRUD completo en `/strategies` con **formulario dinámico**: el tipo de estrategia
(`ma_cross`, `rsi`, `macd`, `bollinger`, `combined`) define qué parámetros se
renderizan, leídos del bridge (`GET /strategy/types`). Versionado: cada ajuste puede
guardarse como **nueva versión** (hijo con `parent_id` a la raíz, `version` incremental).

**Evaluación manual de señal** (botón en la página de la estrategia): llama al motor
Python (`POST /strategy/evaluate`) con los parámetros y el par/timeframe, evalúa sobre
los datos actuales de MT5 y registra una entrada en `signal_logs`.

- `App\Http\Controllers\StrategyController` · `App\Http\Requests\StrategyRequest`
- `PythonBridgeService::strategyTypes()` / `evaluateStrategy()`
- Frontend: `Pages/Strategies/{Index,Form,Show}.tsx`
- Motor Python: `bridge/app/strategy/` (indicadores pandas + estrategias + registry)
