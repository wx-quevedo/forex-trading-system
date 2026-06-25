"""Endpoint del motor de backtesting (Módulo 3 / Fase 5)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..auth import require_api_key
from ..backtest import run_backtest
from ..mt5_client import MT5Error, client

router = APIRouter(dependencies=[Depends(require_api_key)])


class BacktestRequest(BaseModel):
    type: str = Field(..., examples=["ma_cross"])
    params: dict[str, Any] = Field(default_factory=dict)
    symbol: str = Field(..., examples=["EURUSD"])
    timeframe: str = Field(default="H1")
    date_from: datetime = Field(..., alias="from")
    date_to: datetime = Field(..., alias="to")
    risk: dict[str, Any] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


@router.post("/backtest/run", summary="Ejecuta un backtest sobre datos históricos de MT5")
async def backtest_run(req: BacktestRequest):
    # Obtiene las velas históricas del rango y corre el backtester.
    candles = client.candles(req.symbol, req.timeframe, date_from=req.date_from, date_to=req.date_to)
    try:
        result = run_backtest(
            req.type,
            req.params,
            candles,
            symbol=req.symbol,
            timeframe=req.timeframe,
            risk=req.risk,
            config=req.config,
        )
    except ValueError as exc:
        raise MT5Error(str(exc), code=422) from exc
    return result
