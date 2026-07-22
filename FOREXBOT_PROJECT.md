# ForexBot — Plataforma de Trading Algorítmico con MetaTrader 5
> Documento de planificación y arquitectura del proyecto · Versión 1.0

---

## 1. Visión del Proyecto

Plataforma web propia que conecta con MetaTrader 5 para diseñar, backtestear, ajustar y operar estrategias forex de manera automatizada. El diferencial clave es que todos los resultados del bot quedan almacenados en la plataforma y son consumibles directamente por Claude AI para análisis, ajuste y optimización de estrategias, eliminando el flujo manual de copiar/pegar datos.

**Objetivo principal:** ciclo completo cerrado — estrategia → backtest → análisis IA → ajuste → live trading → análisis IA → ajuste.

---

## 2. Stack Tecnológico

### 2.1 Capa de Mercado (Local — Tower Windows)
| Componente | Tecnología | Rol |
|---|---|---|
| Terminal de mercado | MetaTrader 5 | Conexión al broker, datos reales |
| Bridge API | Python 3.12 + FastAPI | Expone MT5 vía REST/WebSocket |
| Librería MT5 | `MetaTrader5` (PyPI oficial) | IPC con el terminal |
| Análisis / indicadores | `pandas`, `numpy`, `ta-lib` | Cálculo de indicadores |
| Backtesting | `vectorbt` o `backtesting.py` | Motor de pruebas históricas |
| Tunnel al VPS | Tailscale | Exposición segura al servidor |

> **Restricción crítica:** La librería oficial `MetaTrader5` solo funciona en Windows. MT5 y Python FastAPI corren en la tower local durante desarrollo. En producción, migran a un VPS Windows dedicado (~$20/mes).

### 2.2 Capa de Aplicación (VPS Linux — <VPS_IP>)
| Componente | Tecnología | Rol |
|---|---|---|
| Backend / orquestador | Laravel 12 | Estrategias, historial, usuarios, configuración |
| Frontend | React 18 + TypeScript + Inertia.js | Dashboard SPA |
| Estilos | Tailwind CSS v4 | Sistema de diseño |
| WebSockets | Laravel Reverb | Push en tiempo real al dashboard |
| Colas | Laravel Horizon + Redis | Jobs de backtesting async |
| Base de datos (local) | SQLite | Desarrollo local — zero config, archivo único |
| Base de datos (servidor) | MySQL 8 | Producción en VPS |
| Cache | Redis | Sesiones, cache de precios, queues |
| Proceso supervisor | Supervisor | Workers Horizon + Reverb persistentes |

> **DB por entorno:** Laravel detecta el entorno vía `APP_ENV`. En `local` usa SQLite (`database/database.sqlite`). En `production` usa MySQL. El `.env` de cada entorno define `DB_CONNECTION=sqlite` o `DB_CONNECTION=mysql` respectivamente. Las migraciones y seeders funcionan igual en ambos motores.

### 2.3 Capa de Gráficos (Frontend — React)

#### Librería principal: TradingView Lightweight Charts v5
Elegida porque es la única librería que tiene candlesticks, volumen, overlays y series adicionales como ciudadanos de primera clase, sin compromisos. Es open-source, solo 45KB gzipped, y construida sobre Canvas (no SVG), lo que le da rendimiento real con miles de puntos en tiempo real.

```
npm install lightweight-charts
```

**Capacidades utilizadas:**
- Candlestick series (OHLCV)
- Líneas de indicadores superpuestas (MA, EMA, Bollinger Bands)
- Histograma de volumen en pane inferior
- Marcadores de señal buy/sell sobre las velas
- `series.update()` para actualizaciones tick a tick en vivo
- Sincronización de crosshair entre múltiples charts

**Indicadores técnicos (librería complementaria):**
`lightweight-charts-indicators` (70+ indicadores listos para v5):
- Moving Averages: SMA, EMA, WMA, HMA, DEMA, TEMA, VWMA
- Oscillators: RSI, Stochastic RSI, CCI, Williams %R
- Momentum: MACD, ROC, Elder Force Index
- Trend: ADX/DMI, Ichimoku Cloud, Supertrend, Parabolic SAR
- Volume: OBV, MFI, Chaikin MF

#### Librería secundaria: Recharts
Para métricas del backtest y KPIs del bot (equity curve, drawdown, win rate histórico, PnL acumulado). Se complementa con Lightweight Charts sin solaparse.

```
npm install recharts
```

### 2.4 Capa de IA
| Componente | Tecnología | Rol |
|---|---|---|
| Análisis de estrategias | Anthropic API (claude-sonnet-4-6) | Analiza resultados, sugiere parámetros |
| Integración | `axios` desde React o job Laravel | Envía JSON de resultados a Claude |

---

## 3. Arquitectura del Sistema

```
┌─────────────────────────────────────────────┐
│           TOWER LOCAL (Windows)              │
│                                             │
│  ┌──────────────┐    IPC     ┌───────────┐  │
│  │  MT5 Terminal │ ◄──────► │  Python   │  │
│  │  (broker)    │           │  FastAPI  │  │
│  └──────────────┘           │  :8000    │  │
│                             └─────┬─────┘  │
│                                   │        │
│                              Tailscale     │
└───────────────────────────────────┼────────┘
                                    │ HTTPS/WS
┌───────────────────────────────────┼────────┐
│           VPS LINUX (<VPS_IP>)│        │
│                                   ▼        │
│  ┌──────────────────────────────────────┐  │
│  │         Laravel 12 Backend           │  │
│  │  Routes · Controllers · Models       │  │
│  │  Jobs (Backtesting) · Events         │  │
│  └──────────────┬───────────────────────┘  │
│                 │ Inertia                  │
│  ┌──────────────▼───────────────────────┐  │
│  │         React 18 Frontend            │  │
│  │  TradingView LW Charts               │  │
│  │  Recharts (KPIs)                     │  │
│  │  Dashboard · Estrategias · Backtest  │  │
│  └──────────────────────────────────────┘  │
│                 │                          │
│  ┌──────────────▼───────────────────────┐  │
│  │      Laravel Reverb (WebSockets)     │  │
│  │  Precios en vivo · Señales bot       │  │
│  │  Trades ejecutados · Alertas         │  │
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
                    │
        ┌───────────▼──────────┐
        │   Anthropic API      │
        │   claude-sonnet-4-6  │
        │   Análisis IA        │
        └──────────────────────┘
```

---

## 4. Módulos de la Aplicación

### Módulo 1 — Conexión y Cuenta (Bridge Python)
Funciones MT5 expuestas vía FastAPI:
- `GET /account` → `mt5.account_info()` — balance, equity, margin
- `GET /symbols` → `mt5.symbols_get()` — pares disponibles
- `GET /price/{symbol}` → `mt5.symbol_info_tick()` — precio actual
- `GET /candles/{symbol}` → `mt5.copy_rates_range()` — datos históricos OHLCV
- `GET /positions` → `mt5.positions_get()` — posiciones abiertas
- `GET /orders` → `mt5.orders_get()` — órdenes pendientes
- `GET /history` → `mt5.history_deals_get()` — historial de deals
- `POST /order` → `mt5.order_send()` — ejecutar orden
- `DELETE /position/{ticket}` → cerrar posición
- `WS /stream/{symbol}` → stream de precios en tiempo real

### Módulo 2 — Estrategias
- CRUD de estrategias (nombre, descripción, parámetros configurables)
- Cada estrategia define: par, timeframe, indicadores con sus parámetros, condiciones de entrada/salida, SL/TP fijo o en pips, gestión de riesgo (% de balance por trade)
- Tipos de estrategia iniciales:
  - Cruce de medias móviles (SMA/EMA cross)
  - RSI oversold/overbought
  - MACD crossover
  - Bollinger Bands breakout
  - Estrategia combinada (configurable)
- Versionado: cada ajuste crea una versión nueva, manteniendo el historial de parámetros

### Módulo 3 — Backtesting
- Selección de estrategia + rango de fechas + par + timeframe
- Obtención de datos históricos desde MT5 via Python bridge
- Ejecución asíncrona del backtest (Laravel Queue + Horizon)
- Métricas calculadas:
  - Total trades · Win rate · Profit factor
  - Sharpe Ratio · Sortino Ratio
  - Max Drawdown (absoluto y porcentual)
  - PnL neto · PnL por mes
  - Racha ganadora/perdedora máxima
  - Equity curve
- Visualización:
  - Gráfico de velas con señales de entrada/salida marcadas (Lightweight Charts)
  - Equity curve (Recharts)
  - Distribución de PnL por trade (Recharts bar chart)
  - Tabla de todos los trades con filtros

### Módulo 4 — Análisis IA (Ciclo de Mejora)
El corazón del proyecto. Permite enviar los resultados del backtest a Claude y recibir análisis estructurado:

**Input a Claude:**
```json
{
  "estrategia": { "nombre": "...", "parametros": {...} },
  "backtest": {
    "periodo": "2024-01-01 / 2024-12-31",
    "par": "EURUSD",
    "timeframe": "H1",
    "metricas": { "win_rate": 0.52, "sharpe": 1.2, "max_drawdown": 0.18, ... },
    "trades": [...],
    "equity_curve": [...]
  },
  "pregunta": "¿Qué parámetros ajustarías para reducir el drawdown?"
}
```

**Output de Claude:**
- Diagnóstico de la estrategia
- Parámetros específicos a ajustar (con valores sugeridos)
- Riesgos identificados
- Próximos pasos de validación

**UX:** Chat integrado en el dashboard de backtest. El usuario puede conversar iterativamente, y al aceptar sugerencias se crea automáticamente una nueva versión de la estrategia.

### Módulo 5 — Bot en Vivo
- Activación/desactivación por estrategia
- El bot corre como un proceso Python separado (loop cada N segundos configurables)
- Evaluación de condiciones en cada tick/vela cerrada
- Ejecución de órdenes via `mt5.order_send()`
- Log en tiempo real de:
  - Señales evaluadas (incluso las que no ejecutaron)
  - Trades abiertos/cerrados
  - Errores del broker
- Dashboard en vivo con:
  - Precio actual (WebSocket vía Reverb)
  - Posiciones abiertas con PnL flotante
  - Historial de trades del día
  - Estado del bot (activo / pausado / error)
- Controles: Pause · Resume · Cerrar todas las posiciones (panic button)

### Módulo 6 — Dashboard General
- Overview de todas las estrategias y su estado
- KPIs consolidados (balance, equity, PnL total, win rate global)
- Gráfico de balance histórico (Recharts)
- Alertas configurables (Reverb → notificación en UI)
- Comparativa de estrategias backtesting side-by-side

---

## 5. Skills del Proyecto

El desarrollo se realizará usando el sistema de skills para garantizar calidad profesional en cada área:

### 5.1 Skills Públicas del Sistema (disponibles en /mnt/skills/public/)
| Skill | Aplicación en el proyecto |
|---|---|
| `frontend-design` | Diseño visual del dashboard: paleta dark mode trading, tipografía, componentes |
| `xlsx` | Exportación de resultados de backtest a Excel |
| `pdf` | Reportes de rendimiento descargables |
| `docx` | Documentación de estrategias exportable |

### 5.2 Skills a Crear (vía skill-creator)
Skills custom que Claude Code leerá antes de cada fase relevante:

#### `trading-charts` skill
Guía de implementación de TradingView Lightweight Charts v5 en este proyecto:
- Setup del chart en componente React con TypeScript
- Patrón de actualización en tiempo real via WebSocket
- Cómo superponer indicadores calculados desde Python
- Configuración de tema dark mode consistente con el diseño
- Marcadores de señal buy/sell
- Sincronización de múltiples panes (precio + volumen + oscilador)

#### `python-mt5-bridge` skill
Patrones de implementación del bridge FastAPI:
- Estructura de endpoints y tipos de respuesta
- Manejo de errores MT5 (desconexión, broker offline, horarios de mercado)
- Serialización de datos MT5 a JSON (timestamps, decimales)
- Autenticación del bridge (API key simple)
- Reconexión automática

#### `strategy-engine` skill
Patrones para el motor de estrategias en Python:
- Estructura base de una estrategia (interfaz)
- Cómo calcular indicadores con `ta-lib` / `pandas-ta`
- Evaluación de señales sobre una vela cerrada
- Gestión de posición (SL dinámico, trailing stop)
- Formato de log de señales

#### `backtest-engine` skill
Motor de backtesting:
- Estructura del backtester sobre datos pandas DataFrame
- Cálculo correcto de métricas (Sharpe, Sortino, Drawdown)
- Simulación de spread y comisiones
- Formato de output para el frontend y para Claude

---

## 6. Diseño Visual — Dashboard Trading

### Principios
Inspirado en terminales profesionales (Bloomberg-lite): fondo oscuro casi negro, datos densos pero legibles, color con significado (verde = ganancia / rojo = pérdida), mínima decoración.

### Paleta (Dark Mode nativo)
```
background-primary:   #0D0E11   (fondo página)
background-surface:   #141519   (cards, paneles)
background-elevated:  #1C1E24   (inputs, hover)
border:               #2A2D36   (separadores)
text-primary:         #E8E9ED   (contenido principal)
text-secondary:       #8B8FA8   (labels, fechas)
green-profit:         #26A69A   (ganancia, compra, positivo)
red-loss:             #EF5350   (pérdida, venta, negativo)
accent-blue:          #2962FF   (acciones, links, botones CTA)
amber-warning:        #F59E0B   (alertas, neutral)
```

### Tipografía
- Display/números: `JetBrains Mono` — para precios, tickers, métricas (monoespaciado crítico para alineación de columnas)
- UI/Labels: `Inter` — para navegación, labels, textos
- Tamaños: escala 11/12/13/14/16/20/24/32px

### Componentes clave
- **PriceDisplay:** precio con dígito de pip resaltado, bid/ask separados
- **CandleChart:** Lightweight Charts con pane de volumen y un oscilador seleccionable
- **PositionCard:** ticket, símbolo, dirección (↑/↓), PnL flotante coloreado
- **MetricBadge:** valor grande + label pequeño + delta (↑ 2.3%)
- **SignalLog:** tabla de señales con timestamp, tipo, precio, resultado
- **BotStatusIndicator:** pulso animado (verde activo / gris pausado / rojo error)

---

## 7. Modelo de Datos (SQLite local / MySQL producción)

```
strategies
  id, name, description, pair, timeframe, parameters (JSON),
  version, parent_id (FK self), is_active, created_at

backtests
  id, strategy_id (FK), date_from, date_to, status,
  result_metrics (JSON), result_trades (JSON),
  result_equity_curve (JSON), created_at

ai_analyses
  id, backtest_id (FK), prompt, response, created_at

bot_runs
  id, strategy_id (FK), started_at, stopped_at, status,
  total_trades, total_pnl

trades
  id, bot_run_id (FK nullable), ticket (MT5), symbol, direction,
  open_price, close_price, volume, sl, tp, open_at, close_at,
  pnl, commission, swap, signal_data (JSON)

signal_logs
  id, strategy_id (FK), evaluated_at, symbol, signal_type,
  executed (bool), reason, indicator_values (JSON)

price_alerts
  id, user_id, symbol, condition, value, triggered_at
```

---

## 8. Plan de Fases de Desarrollo

### Fase 1 — Python Bridge + MT5 (Base)
- Instalación MT5 + cuenta demo del broker
- FastAPI con todos los endpoints de lectura
- Endpoint de envío de órdenes con validaciones
- WebSocket de precios en tiempo real
- Autenticación básica del bridge
- Tests: conexión, datos, órdenes en demo

### Fase 2 — Laravel Backend Base
- Setup proyecto Laravel 12 en VPS
- Modelos y migraciones (strategies, backtests, trades, etc.)
- Servicio `PythonBridgeService` (cliente HTTP al bridge local vía Tailscale)
- Autenticación básica (un solo usuario por ahora)
- Reverb configurado + Echo en el frontend

### Fase 3 — Frontend: Dashboard + Charts
- Setup React + TypeScript + Inertia + Tailwind
- Instalación y configuración Lightweight Charts v5
- `CandleChart` component con tema dark mode
- `VolumePane` sincronizado
- `IndicatorPanel` (RSI o MACD seleccionable)
- Dashboard overview con métricas de cuenta MT5
- Posiciones abiertas en tiempo real (Reverb)

### Fase 4 — Módulo de Estrategias
- CRUD de estrategias con formulario dinámico de parámetros
- Motor de estrategias en Python (clases base + implementaciones)
- Evaluación manual de señal para una estrategia sobre datos actuales

### Fase 5 — Motor de Backtesting
- Engine Python con vectorbt
- Job Laravel async para lanzar backtest
- Resultados persistidos en DB
- Vista de resultados: metrics + trades table + equity curve (Recharts)
- Chart de velas con marcadores de trades ejecutados

### Fase 6 — Análisis IA
- Integración Anthropic API desde Laravel
- Vista de análisis: envío de backtest + chat con Claude
- Sugerencia de ajuste → creación de versión nueva de estrategia automática

### Fase 7 — Bot en Vivo
- Loop Python de ejecución automática
- Log de señales en tiempo real via Reverb
- Panel de control del bot (pause/resume/kill)
- Historial de trades del bot en la web
- Panic button (cierra todas las posiciones abiertas)

### Fase 8 — Refinamiento y Producción
- Migración de MT5 + Python a VPS Windows dedicado
- Alertas por email/telegram cuando el bot ejecuta trades
- Exportación de reportes (PDF/Excel)
- Comparativa de estrategias
- Optimización de parámetros asistida por IA

---

## 9. Consideraciones Importantes

### Seguridad
- El bridge Python NO es público. Solo accesible vía Tailscale desde el VPS
- Las credenciales del broker NUNCA pasan por el frontend
- La API key del bridge se guarda en `.env` de Laravel
- Anthropic API key solo en backend Laravel

### Horarios de Mercado
- El bridge debe manejar errores de "mercado cerrado" graciosamente
- Fines de semana: MT5 no tiene datos en tiempo real
- El backtesting puede correr en cualquier momento (usa datos históricos)

### Gestión de Riesgo (Importante)
- El bot SIEMPRE opera con cuenta demo hasta validar la estrategia extensamente
- Límite de pérdida diaria configurable (el bot se auto-detiene)
- Máximo de posiciones abiertas simultáneas configurable
- El panic button es prioridad en el desarrollo del bot en vivo

### Broker Recomendado para Desarrollo
- **IC Markets** o **Pepperstone** — spreads bajos, servidores MT5 estables, demo ilimitada
- Cualquier broker con servidor MT5 (no MT4) funciona con la librería Python

---

## 10. Herramientas de Desarrollo

| Herramienta | Uso |
|---|---|
| Claude.ai (web) | Diseño de specs, planificación, análisis |
| Claude Code (VSCode) | Ejecución de fases, código real |
| Tailscale | Tunnel seguro tower → VPS durante desarrollo |
| TablePlus | Inspección de DB SQLite (local) y MySQL (VPS) |
| Postman / Bruno | Test de endpoints del bridge Python |
| MT5 Demo Account | Trading en entorno real sin riesgo |

---

## 11. Prompt de Inicio para Claude Code

Este es el prompt exacto a pegar en Claude Code al abrir `D:\mtrad` por primera vez. Está diseñado para ser autosuficiente — el agente no necesita instrucciones adicionales.

```
Lee FOREXBOT_PROJECT.md en la raíz. Es el documento maestro del proyecto,
contiene la arquitectura completa, stack, módulos, fases y decisiones técnicas.
Úsalo como fuente de verdad para TODO lo que construyas.

PASO 1 — Instalar skills
Ejecuta en la raíz del proyecto:
  npx autoskills

Acepta todos los skills detectados. Nuestro stack incluye:
Laravel, React, TypeScript, Tailwind, FastAPI, Python, Pandas, NumPy, Pydantic, Bash.
Los skills de autoskills.sh guían al agente sobre patrones y mejores prácticas
de cada tecnología. No omitas este paso.

PASO 2 — Estructura de carpetas
Crea esta estructura en D:\mtrad:
  bridge/   ← Python FastAPI + MT5 (Fase 1)
  app/      ← Laravel 12 (Fase 2 en adelante)

PASO 3 — Ejecutar Fase 1 (bridge Python)
Construye bridge/ según la sección "Fase 1" y "Módulo 1" del documento.
Requisitos:
- Entorno virtual Python 3.12 en bridge/venv
- requirements.txt con: fastapi, uvicorn, MetaTrader5, pandas, numpy, python-dotenv
- Todos los endpoints GET/POST/DELETE/WS del Módulo 1
- .env con: MT5_LOGIN, MT5_PASSWORD, MT5_SERVER, BRIDGE_API_KEY
- Manejo gracioso de errores cuando MT5 está offline o mercado cerrado
- README.md en bridge/ con instrucciones de arranque

No avances a Fase 2 hasta recibir confirmación.
```

> **Nota de uso:** Copia este prompt tal cual. Cuando el agente termine la Fase 1 y confirmes que el bridge responde correctamente con MT5 conectado, dile simplemente: *"Fase 1 confirmada, avanza a Fase 2"* y continuará con Laravel.

---

*Documento creado durante sesión de planificación · Actualizar al inicio de cada fase*

---

## BLOQUEANTE ABIERTO — señal 'close' y el runner en vivo (intake externas, 2026-07-08)

El backtester soporta la señal **'close'** (cerrar a plano SIN abrir la contraria —
`backtest/engine.py`, Lote 0 del intake de estrategias externas). **El `runner.py` del bot
en vivo NO la entiende**: solo actúa sobre buy/sell.

**Regla imborrable:** antes de ARMAR EN VIVO cualquier estrategia que emita 'close'
(`connors`, `ibs` en modo long-flat, y las futuras del intake con salida-por-condición),
extender el runner con el mismo significado que el backtest (cerrar la posición del run a
plano). Si no, habrá divergencia backtest↔vivo: el vivo mantendría posiciones que el
backtest ya cerró. Las estrategias sin 'close' (todas las previas + tsm/tsm_vol/ibs-symmetric)
no están afectadas.
