"""Ejecución de órdenes del bot vía MT5 (lote fijo + SL/TP en pips, magic por estrategia)."""

from __future__ import annotations

from typing import Any

from ..mt5_client import MT5Client
from .order import compute_order, current_atr, gather_market
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
    run: dict[str, Any],
    direction: str,
    candles: list[dict[str, Any]],
) -> dict[str, Any]:
    """Abre una posición de mercado con FIDELIDAD al backtest: SL/TP por ATR (o pips) y
    lote por riesgo%, vía el módulo compartido `compute_order` (el MISMO que el preview).

    Si una guarda lo impide (ATR sin definir, stops por debajo del mínimo del bróker,
    riesgo% < lote mínimo, o lote sobre el tope), devuelve {opened: False, reason} y NO
    envía orden. Si abre, devuelve los datos de la orden enviada."""
    symbol = run["symbol"]
    tick = client.price(symbol)
    entry = tick["ask"] if direction == "buy" else tick["bid"]
    m = gather_market(client, symbol)
    atr_value = current_atr(candles, int(run.get("atr_period") or 14)) if str(run.get("sl_mode") or "fixed").lower() == "atr" else None
    balance = float(client.account_info().get("balance") or 0.0)

    order = compute_order(run, direction, entry, atr_value, balance, m["prof"],
                          m["digits"], m["stops_level"], m["volume_max"])
    if not order.get("ok"):
        return {"opened": False, "reason": order.get("reason"), "order": order}

    result = client.send_order(
        symbol=symbol,
        order_type=direction.upper(),
        volume=order["volume"],
        sl=order["sl"],
        tp=order["tp"],
        comment=run.get("comment", "forexbot-bot"),
        magic=int(run.get("magic", BOT_MAGIC)),
    )
    result["opened"] = True
    result["ticket"] = int(result.get("order") or 0)
    result["entry_price"] = entry
    result["sl"] = order["sl"]
    result["tp"] = order["tp"]
    result["volume"] = order["volume"]
    result["warn"] = order.get("warn")
    # Detalle de fidelidad para el journal persistente (qué calculó el ejecutor).
    result["fidelity"] = {
        "sl_mode": order.get("sl_mode"), "atr_period": order.get("atr_period"),
        "atr_value": order.get("atr_value"), "sl_dist_pips": order.get("sl_dist_pips"),
        "tp_dist_pips": order.get("tp_dist_pips"), "risk_lot": order.get("risk_lot"),
        "risk_usd": order.get("risk_usd"), "risk_pct_actual": order.get("risk_pct_actual"),
        "risk_percent_nominal": order.get("risk_percent"),
    }
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
