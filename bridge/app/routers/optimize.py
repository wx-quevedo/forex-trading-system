"""Endpoint de optimización automática robusta (Fase 8A)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..auth import require_api_key
from ..mt5_client import MT5Error, client
from ..optimize import optimize

router = APIRouter(dependencies=[Depends(require_api_key)])


class OptimizeRequest(BaseModel):
    type: str = Field(..., examples=["ma_cross"])
    params: dict[str, Any] = Field(default_factory=dict)
    symbol: str = Field(..., examples=["EURUSD"])
    timeframe: str = Field(default="H1")
    date_from: datetime = Field(..., alias="from")
    date_to: datetime = Field(..., alias="to")
    risk: dict[str, Any] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)
    split: float = Field(default=0.7, ge=0.5, le=0.85)

    model_config = {"populate_by_name": True}


@router.post("/optimize", summary="Barrido de parámetros con validación out-of-sample (anti-overfit)")
async def optimize_run(req: OptimizeRequest):
    candles = client.candles(req.symbol, req.timeframe, date_from=req.date_from, date_to=req.date_to)
    try:
        return optimize(
            req.type,
            req.params,
            candles,
            symbol=req.symbol,
            timeframe=req.timeframe,
            risk=req.risk,
            split=req.split,
            # costos reales + config del usuario (p.ej. capital inicial). Veredictos sobre PnL neto.
            config={**client.symbol_costs(req.symbol), **(req.config or {})},
        )
    except ValueError as exc:
        raise MT5Error(str(exc), code=422) from exc
