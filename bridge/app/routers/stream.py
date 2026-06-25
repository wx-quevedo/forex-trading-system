"""WebSocket de precios en tiempo real (Módulo 1): WS /stream/{symbol}.

Hace polling del último tick cada `interval` segundos y lo empuja al cliente.
La autenticación en WebSocket se hace por query param `?api_key=...` (los
clientes WS no permiten headers personalizados de forma estándar).
"""

from __future__ import annotations

import asyncio
import secrets

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from ..config import settings
from ..mt5_client import MT5Error, client

router = APIRouter()


def _valid_key(api_key: str | None) -> bool:
    expected = settings.bridge_api_key
    return bool(expected) and bool(api_key) and secrets.compare_digest(api_key, expected)


@router.websocket("/stream/{symbol}")
async def stream_prices(
    websocket: WebSocket,
    symbol: str,
    api_key: str | None = Query(default=None),
    interval: float = Query(default=1.0, ge=0.2, le=10.0),
):
    if not _valid_key(api_key):
        await websocket.close(code=4401)  # 4401 = Unauthorized (convención app)
        return

    await websocket.accept()
    last_time = None
    try:
        while True:
            try:
                tick = client.price(symbol)
                if tick.get("time") != last_time:
                    last_time = tick.get("time")
                    await websocket.send_json({"type": "tick", "data": tick})
            except MT5Error as exc:
                await websocket.send_json(
                    {"type": "error", "code": exc.code, "message": exc.message}
                )
            await asyncio.sleep(interval)
    except WebSocketDisconnect:
        return
    except Exception as exc:  # noqa: BLE001
        try:
            await websocket.send_json({"type": "error", "message": str(exc)})
            await websocket.close()
        except Exception:  # noqa: BLE001
            pass
