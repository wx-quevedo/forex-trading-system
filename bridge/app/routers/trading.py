"""Endpoints de trading: enviar orden, cerrar posición (Módulo 1)."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import require_api_key
from ..mt5_client import client
from ..schemas import OrderRequest

router = APIRouter(dependencies=[Depends(require_api_key)])


@router.post("/order", summary="order_send() — ejecutar orden de mercado")
async def post_order(order: OrderRequest):
    return client.send_order(
        symbol=order.symbol,
        order_type=order.type,
        volume=order.volume,
        price=order.price,
        sl=order.sl,
        tp=order.tp,
        deviation=order.deviation,
        comment=order.comment,
        magic=order.magic,
    )


@router.delete("/position/{ticket}", summary="Cerrar posición por ticket")
async def delete_position(ticket: int):
    return client.close_position(ticket)
