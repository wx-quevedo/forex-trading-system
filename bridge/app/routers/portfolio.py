"""Endpoints de cartera (Fase 7). De momento: correlación entre estrategias para el
Bot Histórico (análisis sobre series de retornos ya calculadas en el frontend).

Es ANÁLISIS: no toca trades ni caché. El portfolio heat y los circuit breakers viven
en el runtime del bot (runner/state), no aquí."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..auth import require_api_key
from ..bot.portfolio import correlation_matrix

router = APIRouter(prefix="/portfolio", dependencies=[Depends(require_api_key)])


class CorrelationRequest(BaseModel):
    labels: list[str] = Field(default_factory=list)
    series: list[list[float]] = Field(..., description="Series de retornos alineadas por estrategia")


@router.post("/correlation", summary="Matriz de correlación entre estrategias (diversificación real vs falsa)")
async def correlation(req: CorrelationRequest) -> dict[str, Any]:
    return {"labels": req.labels, "matrix": correlation_matrix(req.series)}
