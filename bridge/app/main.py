"""ForexBot — Python MT5 Bridge.

FastAPI que expone MetaTrader5 vía REST/WebSocket para que el backend Laravel
(en el VPS, vía Tailscale) consuma datos de mercado y ejecute órdenes.

Arranque:
    uvicorn app.main:app --host 0.0.0.0 --port 8000
o simplemente:
    python -m app.main
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .config import settings
from .mt5_client import MT5Error, client
from .routers import account, backtest, bot, calendar, explore, market, optimize, portfolio, strategy, stream, system, trading


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Conexión PEREZOSA a propósito: el bridge levanta al instante y se conecta
    # a MT5 en la primera petición real (ensure_connected). Así un terminal
    # cerrado, credenciales pendientes o el mercado fuera de horario no impiden
    # que el servicio arranque ni que /health responda para supervisión.
    print("[bridge] Listo. La conexión a MT5 se establecerá en la primera petición.")
    yield
    client.shutdown()


app = FastAPI(
    title="ForexBot MT5 Bridge",
    version=__version__,
    description="Puente FastAPI ↔ MetaTrader5 (Módulo 1).",
    lifespan=lifespan,
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
