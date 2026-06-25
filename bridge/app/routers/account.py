"""Endpoints de cuenta y símbolos (Módulo 1)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from ..auth import require_api_key
from ..mt5_client import client

router = APIRouter(dependencies=[Depends(require_api_key)])


@router.get("/account", summary="account_info() — balance, equity, margin")
async def get_account():
    return client.account_info()


@router.get("/symbols", summary="symbols_get() — pares disponibles")
async def get_symbols(
    group: str | None = Query(default=None, description="Filtro estilo MT5, p.ej. '*USD*'."),
):
    return client.symbols(group)
