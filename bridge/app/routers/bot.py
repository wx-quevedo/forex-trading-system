"""Endpoints de control del bot en vivo MULTI-ESTRATEGIA (Fase 7 / 8D)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..auth import require_api_key
from ..bot import bot_runner

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
    daily_loss_limit: float = Field(default=100, ge=0)
    max_positions: int = Field(default=1, ge=1, le=20)


class TargetRequest(BaseModel):
    """Acción dirigida a una estrategia (strategy_id) o a todas si es None."""
    strategy_id: int | None = None


@router.post("/bot/start", summary="Añade una estrategia a la ejecución (multi-estrategia)")
async def bot_start(req: StartRequest):
    bot_runner.add(req.model_dump())
    return bot_runner.status()


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
