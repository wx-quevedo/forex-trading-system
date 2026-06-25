"""Ejecución de órdenes del bot vía MT5 (lote fijo + SL/TP en pips)."""

from __future__ import annotations

from typing import Any

from ..mt5_client import MT5Client
from .state import BOT_MAGIC


def pip_size(symbol: str) -> float:
    return 0.01 if symbol.upper().endswith("JPY") else 0.0001


def bot_positions(client: MT5Client, symbol: str | None = None) -> list[dict[str, Any]]:
    """Posiciones abiertas por el bot (filtradas por el magic number del bot)."""
    return [p for p in client.positions(symbol) if int(p.get("magic", 0)) == BOT_MAGIC]


def open_market(
    client: MT5Client,
    symbol: str,
    direction: str,
    lot: float,
    sl_pips: float,
    tp_pips: float,
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
        comment="forexbot-bot",
        magic=BOT_MAGIC,
    )
    # El ticket de la posición resultante de un DEAL de mercado == result['order'].
    result["ticket"] = int(result.get("order") or 0)
    result["entry_price"] = entry
    result["sl"] = sl
    result["tp"] = tp
    return result


def close_all(client: MT5Client) -> dict[str, Any]:
    """PANIC: cierra TODAS las posiciones abiertas (del bot y manuales)."""
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
