"""Ejecución de órdenes del bot vía MT5 (lote fijo + SL/TP en pips, magic por estrategia)."""

from __future__ import annotations

from typing import Any

from ..mt5_client import MT5Client
from .state import BOT_MAGIC, is_bot_magic


def pip_size(symbol: str) -> float:
    return 0.01 if symbol.upper().endswith("JPY") else 0.0001


def bot_positions(client: MT5Client, magic: int | None = None, symbol: str | None = None) -> list[dict[str, Any]]:
    """Posiciones del bot. Si `magic` se indica, solo esa estrategia; si no, todas
    las del rango de magic del bot (cualquier estrategia)."""
    out = []
    for p in client.positions(symbol):
        m = int(p.get("magic", 0))
        if magic is not None:
            if m == magic:
                out.append(p)
        elif is_bot_magic(m):
            out.append(p)
    return out


def open_market(
    client: MT5Client,
    symbol: str,
    direction: str,
    lot: float,
    sl_pips: float,
    tp_pips: float,
    magic: int = BOT_MAGIC,
    comment: str = "forexbot-bot",
) -> dict[str, Any]:
    """Abre una posición de mercado con SL/TP calculados desde pips."""
    tick = client.price(symbol)
    pip = pip_size(symbol)
    if direction == "buy":
        entry = tick["ask"]
        sl = entry - sl_pips * pip if sl_pips else None
        tp = entry + tp_pips * pip if tp_pips else None
    else:
        entry = tick["bid"]
        sl = entry + sl_pips * pip if sl_pips else None
        tp = entry - tp_pips * pip if tp_pips else None

    result = client.send_order(
        symbol=symbol,
        order_type=direction.upper(),
        volume=lot,
        sl=sl,
        tp=tp,
        comment=comment,
        magic=magic,
    )
    result["ticket"] = int(result.get("order") or 0)
    result["entry_price"] = entry
    result["sl"] = sl
    result["tp"] = tp
    return result


def close_all(client: MT5Client) -> dict[str, Any]:
    """PANIC: cierra TODAS las posiciones abiertas (de todas las estrategias y manuales)."""
    closed: list[dict[str, Any]] = []
    errors: list[str] = []
    for pos in client.positions():
        ticket = int(pos["ticket"])
        try:
            client.close_position(ticket)
            closed.append({"ticket": ticket, "symbol": pos.get("symbol")})
        except Exception as exc:  # noqa: BLE001 - panic debe intentar cerrar todas
            errors.append(f"ticket {ticket}: {exc}")
    return {"closed": closed, "errors": errors, "count": len(closed)}


def close_ticket(client: MT5Client, ticket: int) -> dict[str, Any]:
    return client.close_position(ticket)
