# ForexBot — Python MT5 Bridge (Fase 1)

Puente **FastAPI ↔ MetaTrader 5** que expone la cuenta, el mercado y la ejecución
de órdenes vía REST/WebSocket. Es la *Capa de Mercado* del proyecto: corre en la
tower Windows local (y luego en un VPS Windows) y el backend Laravel lo consume
de forma privada a través de Tailscale.

> ⚠ **Solo Windows.** La librería oficial `MetaTrader5` (IPC con el terminal) únicamente
> funciona en Windows. El bridge requiere el terminal **MetaTrader 5** instalado y
> con sesión iniciada en una cuenta (demo durante el desarrollo).

---

## 1. Requisitos

- Windows 10/11
- Python **3.12**
- Terminal **MetaTrader 5** instalado y abierto, logueado en una cuenta **demo**
- Un broker con servidor MT5 (recomendado: IC Markets o Pepperstone)

## 2. Instalación

```bash
cd bridge
py -3.12 -m venv venv
./venv/Scripts/python.exe -m pip install --upgrade pip
./venv/Scripts/python.exe -m pip install -r requirements.txt
```

## 3. Configuración

Copia `.env.example` a `.env` y rellena tus credenciales de la cuenta demo:

```env
MT5_LOGIN=12345678
MT5_PASSWORD=tu_password_demo
MT5_SERVER=ICMarkets-Demo
MT5_PATH=                 # opcional: ruta a terminal64.exe (vacío = autodetección)
BRIDGE_API_KEY=<clave-aleatoria-larga>
BRIDGE_HOST=0.0.0.0
BRIDGE_PORT=8000
```

Genera una API key fuerte:

```bash
./venv/Scripts/python.exe -c "import secrets; print(secrets.token_hex(32))"
```

## 4. Arranque

```bash
# opción A
./venv/Scripts/python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
# opción B
./venv/Scripts/python.exe run.py
```

- Documentación interactiva (Swagger): http://localhost:8000/docs
- Esquema OpenAPI: http://localhost:8000/openapi.json

El bridge levanta **al instante** aunque MT5 esté cerrado: la conexión al terminal
es **perezosa** y se establece (o reconecta) en la primera petición a un endpoint de
mercado. Útil para liveness checks y para que el servicio no caiga fuera de horario.

## 5. Autenticación

Todos los endpoints de datos/trading exigen el header:

```
X-API-Key: <BRIDGE_API_KEY>
```

Los health checks (`/` y `/health`) **no** requieren key. En WebSocket la key se pasa
por query string: `ws://host:8000/stream/EURUSD?api_key=<KEY>`.

## 6. Endpoints (Módulo 1)

| Método | Ruta | Función MT5 | Descripción |
|---|---|---|---|
| GET | `/` | — | Liveness |
| GET | `/health` | `terminal_info()` | Estado del terminal (sin auth) |
| GET | `/account` | `account_info()` | Balance, equity, margin |
| GET | `/symbols?group=*USD*` | `symbols_get()` | Pares disponibles |
| GET | `/price/{symbol}` | `symbol_info_tick()` | Precio actual (bid/ask) |
| GET | `/candles/{symbol}` | `copy_rates_range()` | OHLCV histórico |
| GET | `/positions` | `positions_get()` | Posiciones abiertas |
| GET | `/orders` | `orders_get()` | Órdenes pendientes |
| GET | `/history` | `history_deals_get()` | Historial de deals |
| POST | `/order` | `order_send()` | Ejecutar orden de mercado |
| DELETE | `/position/{ticket}` | `order_send()` (cierre) | Cerrar posición |
| WS | `/stream/{symbol}` | polling de ticks | Stream de precios en vivo |

### Parámetros de `/candles/{symbol}`

- `timeframe`: `M1, M5, M15, M30, H1, H4, D1, W1, MN1` (default `H1`)
- `from`, `to`: ISO 8601 (`2024-01-01T00:00:00`)
- `count`: últimas N velas (alternativa a `from`)

### Ejemplos

```bash
KEY="<tu-bridge-api-key>"

curl http://localhost:8000/account -H "X-API-Key: $KEY"
curl "http://localhost:8000/price/EURUSD" -H "X-API-Key: $KEY"
curl "http://localhost:8000/candles/EURUSD?timeframe=H1&count=200" -H "X-API-Key: $KEY"

# Orden de mercado (cuenta DEMO): comprar 0.01 lotes EURUSD con SL/TP
curl -X POST http://localhost:8000/order -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"EURUSD","type":"BUY","volume":0.01,"sl":1.0500,"tp":1.0700}'

# Cerrar posición por ticket
curl -X DELETE http://localhost:8000/position/123456789 -H "X-API-Key: $KEY"
```

WebSocket (ejemplo en JS):

```js
const ws = new WebSocket("ws://localhost:8000/stream/EURUSD?api_key=<KEY>");
ws.onmessage = (e) => console.log(JSON.parse(e.data)); // { type:"tick", data:{ bid, ask, ... } }
```

## 7. Manejo de errores

Las respuestas de error siguen `{ "error": "...", "mt5_error": [...] }` con códigos:

| Código | Situación |
|---|---|
| 401 | API key inválida/ausente |
| 404 | Símbolo o ticket inexistente |
| 409 | Sin tick / mercado cerrado / sin datos |
| 422 | Orden rechazada por el broker (retcode) |
| 503 | Terminal MT5 no disponible / no inicializado |

El bridge maneja con gracia: terminal cerrado, mercado fuera de horario (fines de
semana), símbolo no seleccionado en Market Watch (lo auto-selecciona) y caídas de
conexión (reconexión perezosa en la siguiente petición).

## 8. Tests

```bash
./venv/Scripts/python.exe -m pytest -q
```

Los tests de humo (`tests/test_smoke.py`) verifican arranque, health y auth **sin
necesitar MT5 conectado**. Las llamadas reales a MT5 se prueban manualmente contra la
demo (sección 6).

## 9. Estructura

```
bridge/
├─ app/
│  ├─ main.py            # FastAPI: routers, CORS, errores, health, lifespan
│  ├─ config.py          # Settings desde .env (pydantic-settings)
│  ├─ auth.py            # Dependencia X-API-Key
│  ├─ mt5_client.py      # Wrapper MT5: conexión, reconexión, serialización
│  ├─ schemas.py         # Modelos Pydantic (OrderRequest, ...)
│  └─ routers/
│     ├─ account.py      # /account, /symbols
│     ├─ market.py       # /price, /candles, /positions, /orders, /history
│     ├─ trading.py      # /order, /position/{ticket}
│     └─ stream.py       # WS /stream/{symbol}
├─ tests/test_smoke.py
├─ requirements.txt
├─ run.py
├─ .env.example
└─ README.md
```

## 10. Seguridad

- El bridge **no** es público: en producción solo accesible vía **Tailscale** desde el VPS.
- Las credenciales del broker viven solo en `.env` (no commitear; ya está en `.gitignore`).
- La `BRIDGE_API_KEY` es una segunda capa de defensa además de la red privada.
- El bot opera **siempre en demo** hasta validar estrategias (ver documento maestro, §9).
