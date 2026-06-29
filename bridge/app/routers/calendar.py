"""Endpoints del calendario económico (Fase 6, capa defensiva).

/calendar/events    → eventos de alto impacto en un periodo (MARCADO/contexto).
/calendar/upcoming  → próximos eventos del símbolo (defensa en vivo).
Marcar eventos es METADATO: no cambia ningún trade ni la caché del explorador.
"""

from __future__ import annotations

import time
from datetime import datetime

from fastapi import APIRouter, Depends, Query

from ..auth import require_api_key
from ..econcal import events_in, symbol_currencies
from ..econcal.store import load_all, refresh

router = APIRouter(prefix="/calendar", dependencies=[Depends(require_api_key)])


@router.get("/events", summary="Eventos de alto impacto en un periodo (marcado/contexto)")
async def get_events(
    date_from: datetime = Query(..., alias="from"),
    date_to: datetime = Query(..., alias="to"),
    symbol: str | None = Query(default=None),
    impact: str = Query(default="high"),
):
    refresh()  # throttled (1h); acumula el feed sin bloquear si la red falla
    currencies = symbol_currencies(symbol) if symbol else None
    evs = events_in(load_all(), int(date_from.timestamp()), int(date_to.timestamp()), currencies, impact)
    return {"currencies": currencies, "impact": impact, "count": len(evs), "events": evs}


@router.get("/upcoming", summary="Próximos eventos del símbolo (defensa en vivo)")
async def get_upcoming(
    symbol: str | None = Query(default=None),
    hours: int = Query(default=48, ge=1, le=336),
    impact: str = Query(default="high"),
):
    status = refresh()
    now = int(time.time())
    currencies = symbol_currencies(symbol) if symbol else None
    evs = events_in(load_all(), now, now + hours * 3600, currencies, impact)
    return {"now": now, "currencies": currencies, "impact": impact,
            "feed": status, "count": len(evs), "events": evs}
