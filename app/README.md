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

### Usuario por defecto (autenticación básica, un solo usuario)

- email: `admin@forexbot.local`  ·  password: `password`
- Configurable vía `.env`: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`.

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
- ⏭ **Fase 5** — Motor de Backtesting

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
