"""Endpoints de control del bot en vivo (Fase 7)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..auth import require_api_key
from ..bot import bot_runner

router = APIRouter(dependencies=[Depends(require_api_key)])


class StartRequest(BaseModel):
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


@router.post("/bot/start", summary="Arranca el bot con una estrategia y límites")
async def bot_start(req: StartRequest):
    bot_runner.start(req.model_dump())
    return bot_runner.status()


@router.post("/bot/pause", summary="Pausa la evaluación (mantiene posiciones)")
async def bot_pause():
    bot_runner.pause()
    return bot_runner.status()


@router.post("/bot/resume", summary="Reanuda la evaluación")
async def bot_resume():
    bot_runner.resume()
    return bot_runner.status()


@router.post("/bot/stop", summary="Detiene el bot (deja de evaluar)")
async def bot_stop():
    bot_runner.stop()
    return bot_runner.status()


@router.post("/bot/panic", summary="PANIC: cierra TODAS las posiciones y detiene el bot")
async def bot_panic():
    result = bot_runner.panic()
    return {"panic": result, "status": bot_runner.status()}


@router.get("/bot/status", summary="Estado del bot + posiciones + PnL del día")
async def bot_status():
    return bot_runner.status()
