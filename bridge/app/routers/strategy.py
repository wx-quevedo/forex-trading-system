"""Endpoints del motor de estrategias (Módulo 2 / Fase 4)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..auth import require_api_key
from ..mt5_client import MT5Error, client
from ..strategy import STRATEGY_SCHEMAS, evaluate_strategy

router = APIRouter(dependencies=[Depends(require_api_key)])


class EvaluateRequest(BaseModel):
    type: str = Field(..., examples=["ma_cross"])
    params: dict[str, Any] = Field(default_factory=dict)
    symbol: str = Field(..., examples=["EURUSD"])
    timeframe: str = Field(default="H1")
    count: int = Field(default=300, ge=30, le=5000)


@router.get("/strategy/types", summary="Tipos de estrategia y sus parámetros configurables")
async def strategy_types():
    return STRATEGY_SCHEMAS


@router.post("/strategy/evaluate", summary="Evalúa una estrategia sobre datos actuales de MT5")
async def strategy_evaluate(req: EvaluateRequest):
    # Obtiene las velas desde MT5 y evalúa la estrategia sobre ellas.
    candles = client.candles(req.symbol, req.timeframe, count=req.count)
    try:
        result = evaluate_strategy(req.type, req.params, candles)
    except ValueError as exc:
        raise MT5Error(str(exc), code=422) from exc

    result["symbol"] = req.symbol
    result["timeframe"] = req.timeframe
    return result
