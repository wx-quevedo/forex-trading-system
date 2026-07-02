"""ForexBot — Python MT5 Bridge.

FastAPI que expone MetaTrader5 vía REST/WebSocket para que el backend Laravel
(en el VPS, vía Tailscale) consuma datos de mercado y ejecute órdenes.

Arranque:
    uvicorn app.main:app --host 0.0.0.0 --port 8000
o simplemente:
    python -m app.main
"""

from __future__ import annotations

import math
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .config import settings
from .mt5_client import MT5Error, client
from .routers import account, backtest, bot, calendar, explore, market, optimize, portfolio, strategy, stream, system, trading


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Registra ESTE arranque (ts + uptime del SO) para el auto-reanudar seguro: el
    # historial persistente permite detectar un crash-loop (muchos arranques seguidos).
    from .bot import lifecycle
    lifecycle.record_boot()
    # Conexión PEREZOSA a propósito: el bridge levanta al instante y se conecta
    # a MT5 en la primera petición real (ensure_connected). Así un terminal
    # cerrado, credenciales pendientes o el mercado fuera de horario no impiden
    # que el servicio arranque ni que /health responda para supervisión.
    print("[bridge] Listo. La conexión a MT5 se establecerá en la primera petición.")
    yield
    client.shutdown()


def _sanitize_nonfinite(o: Any) -> Any:
    """Reemplaza NaN/Inf por None recursivamente.

    Starlette serializa con json.dumps(allow_nan=False): un solo float no finito
    (sharpe con varianza 0, calmar/profit_factor con denominador 0 — habituales en
    barridos grandes de muchos tipos de estrategia) hace 500 al serializar la respuesta.
    None es JSON válido y el frontend ya lo muestra como "—". Aplica a CUALQUIER endpoint
    y también a filas ya cacheadas con NaN."""
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {k: _sanitize_nonfinite(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_sanitize_nonfinite(v) for v in o]
    return o


class SafeJSONResponse(JSONResponse):
    """JSONResponse que neutraliza NaN/Inf antes de serializar (evita 500 por allow_nan)."""

    def render(self, content: Any) -> bytes:
        return super().render(_sanitize_nonfinite(content))


app = FastAPI(
    title="ForexBot MT5 Bridge",
    version=__version__,
    description="Puente FastAPI ↔ MetaTrader5 (Módulo 1).",
    lifespan=lifespan,
    default_response_class=SafeJSONResponse,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Manejo gracioso de errores de dominio --------------------------------- #
@app.exception_handler(MT5Error)
async def mt5_error_handler(request: Request, exc: MT5Error):
    return JSONResponse(
        status_code=exc.code,
        content={"error": exc.message, "mt5_error": exc.mt5_error},
    )


# --- Health / estado (sin auth, para liveness checks) ---------------------- #
@app.get("/", tags=["health"])
async def root():
    return {"service": "forexbot-mt5-bridge", "version": __version__, "status": "up"}


@app.get("/health", tags=["health"])
async def health():
    """Estado del terminal MT5 sin lanzar excepciones (para supervisión)."""
    return client.status()


# --- Routers del Módulo 1 -------------------------------------------------- #
app.include_router(account.router, tags=["account"])
app.include_router(market.router, tags=["market"])
app.include_router(trading.router, tags=["trading"])
app.include_router(strategy.router, tags=["strategy"])
app.include_router(backtest.router, tags=["backtest"])
app.include_router(bot.router, tags=["bot"])
app.include_router(optimize.router, tags=["optimize"])
app.include_router(explore.router, tags=["explore"])
app.include_router(calendar.router, tags=["calendar"])
app.include_router(portfolio.router, tags=["portfolio"])
app.include_router(system.router, tags=["system"])
app.include_router(stream.router, tags=["stream"])


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.bridge_host,
        port=settings.bridge_port,
        reload=True,
    )
