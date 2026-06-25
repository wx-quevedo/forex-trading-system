"""Endpoints de mercado: precio actual, velas, historial (Módulo 1)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query

from ..auth import require_api_key
from ..mt5_client import client

router = APIRouter(dependencies=[Depends(require_api_key)])


@router.get("/price/{symbol}", summary="symbol_info_tick() — precio actual (bid/ask)")
async def get_price(symbol: str):
    return client.price(symbol)


@router.get("/candles/{symbol}", summary="copy_rates_range() — OHLCV histórico")
async def get_candles(
    symbol: str,
    timeframe: str = Query("H1", description="M1, M5, M15, M30, H1, H4, D1, W1, MN1"),
    date_from: datetime | None = Query(
        default=None, alias="from", description="ISO 8601, p.ej. 2024-01-01T00:00:00"
    ),
    date_to: datetime | None = Query(default=None, alias="to", description="ISO 8601"),
    count: int | None = Query(default=None, ge=1, le=50000, description="Últimas N velas (alt. a 'from')."),
):
    return client.candles(symbol, timeframe, date_from, date_to, count)


@router.get("/symbol/{symbol}", summary="symbol_info() — info del símbolo (digits, etc.)")
async def get_symbol(symbol: str):
    return client.symbol_info(symbol)


@router.get("/positions", summary="positions_get() — posiciones abiertas")
async def get_positions(symbol: str | None = Query(default=None)):
    return client.positions(symbol)


@router.get("/orders", summary="orders_get() — órdenes pendientes")
async def get_orders(symbol: str | None = Query(default=None)):
    return client.orders(symbol)


@router.get("/history", summary="history_deals_get() — historial de deals")
async def get_history(
    date_from: datetime | None = Query(default=None, alias="from", description="ISO 8601"),
    date_to: datetime | None = Query(default=None, alias="to", description="ISO 8601"),
):
    now = datetime.now(tz=timezone.utc)
    df = date_from or (now - timedelta(days=30))
    dt = date_to or now
    return client.history_deals(df, dt)
