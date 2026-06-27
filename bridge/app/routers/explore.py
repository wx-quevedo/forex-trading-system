"""Endpoints del buscador automático de estrategias (Fase 8E).

Ejecuta el barrido en un hilo de fondo: /explore/start arranca y devuelve al
instante; /explore/status reporta progreso REAL (done/total); /explore/results
entrega el reporte; /explore/cancel aborta una búsqueda larga.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

import os

from ..auth import require_api_key
from ..explore import (
    MAX_CONFIGS,
    RISK_CHOICES,
    SL_CHOICES,
    SWEEP_TIMEFRAMES,
    TP_CHOICES,
    default_workers,
    estimate_configs,
    grid_size,
    job,
)
from ..mt5_client import MT5Error, client

router = APIRouter(dependencies=[Depends(require_api_key)])

KNOWN_TYPES = ["ma_cross", "rsi", "macd", "bollinger", "combined"]


class ExploreRequest(BaseModel):
    pairs: list[str] = Field(..., min_length=1)
    types: list[str] = Field(..., min_length=1)
    timeframes: list[str] = Field(..., min_length=1)
    date_from: datetime = Field(..., alias="from")
    date_to: datetime = Field(..., alias="to")
    capital: float = Field(default=10000.0, gt=0)
    sl_choices: list[float] = Field(default_factory=lambda: list(SL_CHOICES), min_length=1)
    tp_choices: list[float] = Field(default_factory=lambda: list(TP_CHOICES), min_length=1)
    risk_choices: list[float] = Field(default_factory=lambda: list(RISK_CHOICES), min_length=1)
    workers: int | None = Field(default=None, ge=1, le=64)

    model_config = {"populate_by_name": True}


class EstimateRequest(BaseModel):
    pairs: list[str] = Field(default_factory=list)
    types: list[str] = Field(default_factory=list)
    timeframes: list[str] = Field(default_factory=list)
    sl_choices: list[float] = Field(default_factory=list)
    tp_choices: list[float] = Field(default_factory=list)
    risk_choices: list[float] = Field(default_factory=list)


@router.get("/explore/meta", summary="Opciones del buscador (grids por tipo, choices, tope)")
async def explore_meta():
    return {
        "grid_sizes": {t: grid_size(t) for t in KNOWN_TYPES},
        "sl_choices": SL_CHOICES,
        "tp_choices": TP_CHOICES,
        "risk_choices": RISK_CHOICES,
        "sweep_timeframes": SWEEP_TIMEFRAMES,
        "max_configs": MAX_CONFIGS,
        "cpu_count": os.cpu_count(),
        "default_workers": default_workers(),
    }


@router.post("/explore/estimate", summary="Estima el nº de configuraciones de una búsqueda")
async def explore_estimate(req: EstimateRequest):
    configs = estimate_configs(req.pairs, req.types, req.timeframes,
                               req.sl_choices, req.tp_choices, req.risk_choices)
    return {"configs": configs, "max_configs": MAX_CONFIGS, "over_limit": configs > MAX_CONFIGS}


@router.post("/explore/start", summary="Inicia un barrido de estrategias en segundo plano")
async def explore_start(req: ExploreRequest):
    bad = [t for t in req.types if t not in KNOWN_TYPES]
    if bad:
        raise MT5Error(f"Tipos desconocidos: {', '.join(bad)}", code=422)
    if job.is_running():
        raise MT5Error("Ya hay una búsqueda en curso. Cancélala antes de iniciar otra.", code=409)

    configs = estimate_configs(req.pairs, req.types, req.timeframes,
                               req.sl_choices, req.tp_choices, req.risk_choices)
    if configs == 0:
        raise MT5Error("La selección no produce ninguna configuración.", code=422)
    if configs > MAX_CONFIGS:
        raise MT5Error(
            f"Demasiadas configuraciones ({configs:,} > {MAX_CONFIGS:,}). Acota pares, timeframes o pasos.",
            code=422,
        )

    payload: dict[str, Any] = {
        "pairs": [p.upper() for p in req.pairs],
        "types": req.types,
        "timeframes": req.timeframes,
        "date_from": req.date_from,
        "date_to": req.date_to,
        "capital": req.capital,
        "sl_choices": req.sl_choices,
        "tp_choices": req.tp_choices,
        "risk_choices": req.risk_choices,
        "workers": req.workers,
    }
    return job.start(payload, client)


@router.get("/explore/status", summary="Progreso de la búsqueda en curso (sin resultados)")
async def explore_status():
    return job.snapshot(include_results=False)


@router.get("/explore/results", summary="Reporte completo de la última búsqueda")
async def explore_results():
    return job.snapshot(include_results=True)


@router.post("/explore/cancel", summary="Cancela la búsqueda en curso")
async def explore_cancel():
    job.cancel()
    return job.snapshot(include_results=False)
