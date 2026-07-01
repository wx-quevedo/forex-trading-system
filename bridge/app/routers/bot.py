"""Endpoints de control del bot en vivo MULTI-ESTRATEGIA (Fase 7 / 8D)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..auth import require_api_key
from ..bot import bot_runner, journal as bot_journal
from ..bot.preview import preview_all
from ..bot.state import bot_state
from ..mt5_client import client

router = APIRouter(dependencies=[Depends(require_api_key)])


class StartRequest(BaseModel):
    strategy_id: int
    bot_run_id: int | None = None
    strategy_type: str = Field(..., examples=["ma_cross"])
    params: dict[str, Any] = Field(default_factory=dict)
    symbol: str = Field(..., examples=["EURUSD"])
    timeframe: str = Field(default="H1")
    lot: float = Field(default=0.01, gt=0)
    sl_pips: float = Field(default=20, ge=0)
    tp_pips: float = Field(default=40, ge=0)
    # Fidelidad con el backtest: modo SL/TP (fijo pips o N×ATR), periodo ATR y riesgo%
    # para dimensionar por riesgo (no lote fijo). El lote queda como respaldo.
    sl_mode: str = Field(default="fixed")
    atr_period: int = Field(default=14, ge=2, le=200)
    risk_percent: float = Field(default=0.0, ge=0, le=100)
    # Guardas de sizing (Fase 2): tope de lote configurable (0 = solo el del bróker) y
    # política si el riesgo% pide menos que el lote mínimo ("skip" no abre / "floor" mínimo).
    max_lot: float = Field(default=0.0, ge=0)
    below_min: str = Field(default="skip")
    arm_expiry_hours: float = Field(default=24.0, ge=0, le=168)  # auto-pausa si no abre (0 = off)
    daily_loss_limit: float = Field(default=100, ge=0)
    max_positions: int = Field(default=1, ge=1, le=20)
    # Protecciones de CARTERA (Fase 7). ANTES no se declaraban aquí → Pydantic las
    # descartaba en model_dump() → NUNCA llegaban al ejecutor (circuit breakers, heat y
    # filtro de noticias quedaban en 0). Declararlas cierra ese hueco de seguridad.
    portfolio_heat_pct: float = Field(default=0.0, ge=0, le=100)   # riesgo agregado máximo (global)
    cb_max_losses: int = Field(default=0, ge=0, le=50)             # pausa tras N pérdidas seguidas
    cb_max_drawdown_pct: float = Field(default=0.0, ge=0, le=100)  # pausa si el PnL cae X% del pico
    news_filter: bool = Field(default=False)                       # no abrir en ventana de noticia alta
    news_window_min: int = Field(default=15, ge=1, le=120)


class TargetRequest(BaseModel):
    """Acción dirigida a una estrategia (strategy_id) o a todas si es None."""
    strategy_id: int | None = None


@router.post("/bot/start", summary="Añade una estrategia a la ejecución (multi-estrategia)")
async def bot_start(req: StartRequest):
    bot_runner.add(req.model_dump())
    return bot_runner.status()


@router.get("/bot/preview", summary="Preview de fidelidad (Fase 1): SL/TP/lote que el ejecutor usaría, SIN operar")
def bot_preview():
    # `def` (no async): hace IO MT5 + backtests → FastAPI lo corre en threadpool.
    # Copia los runs bajo lock y suelta el lock antes del IO pesado.
    with bot_state.lock():
        runs = [dict(r) for r in bot_state.runs.values()]
    return {"previews": preview_all(client, runs)}


class PreviewSpecRequest(BaseModel):
    """Preview AD-HOC (estrategias aún no iniciadas, p.ej. el diálogo de confirmar)."""
    rows: list[dict[str, Any]] = Field(default_factory=list, max_length=50)


@router.post("/bot/preview", summary="Preview de fidelidad de specs ad-hoc (antes de iniciar), SIN operar")
def bot_preview_spec(req: PreviewSpecRequest):
    return {"previews": preview_all(client, req.rows)}


@router.get("/bot/journal", summary="Journal PERSISTENTE del bot (aperturas/cierres) — sobrevive reinicios y corte de día")
def bot_journal_read(limit: int = 200):
    return {"entries": bot_journal.tail(max(1, min(1000, limit)))}


@router.post("/bot/pause", summary="Pausa una estrategia (o todas)")
async def bot_pause(req: TargetRequest = TargetRequest()):
    bot_runner.pause(req.strategy_id)
    return bot_runner.status()


@router.post("/bot/resume", summary="Reanuda una estrategia (o todas)")
async def bot_resume(req: TargetRequest = TargetRequest()):
    bot_runner.resume(req.strategy_id)
    return bot_runner.status()


@router.post("/bot/stop", summary="Detiene una estrategia (o todas)")
async def bot_stop(req: TargetRequest = TargetRequest()):
    bot_runner.stop(req.strategy_id)
    return bot_runner.status()


@router.post("/bot/remove", summary="Quita una estrategia de la lista del bot")
async def bot_remove(req: TargetRequest):
    if req.strategy_id is not None:
        bot_runner.remove(req.strategy_id)
    return bot_runner.status()


@router.post("/bot/panic", summary="PANIC: cierra TODAS las posiciones y detiene todo")
async def bot_panic():
    result = bot_runner.panic()
    return {"panic": result, "status": bot_runner.status()}


@router.get("/bot/status", summary="Estado agregado + por estrategia")
async def bot_status():
    return bot_runner.status()
