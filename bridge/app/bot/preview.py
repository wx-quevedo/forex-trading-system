"""Preview de fidelidad del ejecutor en vivo (Fase 1: calcula, NO opera).

Para cada estrategia activa calcula lo que el ejecutor en vivo HARÍA usando el MISMO
módulo compartido que el backtest (backtest/sizing.py): SL/TP (ATR o pips), redondeo a
dígitos del símbolo, validación contra la distancia mínima del bróker (stops_level) y
lote por riesgo% (con el balance real) vs el lote fijo de hoy.

Además compara contra el backtest sobre las MISMAS velas recientes: corre el backtest y
recomputa, con el módulo compartido, el SL/TP/lote de su última operación → confirma
que ejecutor-vivo y backtest dan lo mismo (la prueba viva de fidelidad). No envía órdenes.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from ..backtest.engine import run_backtest
from ..backtest.sizing import size_for, sl_tp_distances, sl_tp_prices
from ..strategy.indicators import atr as atr_series
from .order import compute_order, gather_market

_MIN_CANDLES = 60


def _backtest_match(run: dict[str, Any], closed: list[dict[str, Any]], df: pd.DataFrame,
                    m: dict[str, Any], balance: float) -> dict[str, Any]:
    """Corre el backtest sobre las MISMAS velas y recomputa con el módulo compartido el
    SL/lote de su última operación → debe COINCIDIR (mismo código, mismas entradas)."""
    sl_mode = run["sl_mode"]; atr_period = run["atr_period"]
    sl_p = run["sl_pips"]; tp_p = run["tp_pips"]; risk_pct = run["risk_percent"]
    prof = m["prof"]; pip = m["pip"]; pip_value = float(prof.get("pip_value_per_lot") or 10.0)
    vmin = float(prof.get("volume_min") or 0.01); vstep = float(prof.get("volume_step") or 0.01)
    digits = m["digits"]
    try:
        bt = run_backtest(
            run["strategy_type"], run["params"], closed,
            symbol=run["symbol"], timeframe=run["timeframe"],
            risk={"sl_mode": sl_mode, "atr_period": atr_period, "sl_pips": sl_p,
                  "tp_pips": tp_p, "risk_percent": risk_pct},
            config={**prof, "initial_balance": balance, "default_volume": run["lot"]},
        )
        trades = bt.get("trades", [])
        if not trades:
            return {"available": False, "reason": "El backtest no produjo operaciones en la ventana reciente."}
        last = trades[-1]
        times = df["time"].to_numpy()
        idx = int((times == last["entry_time"]).argmax())
        atr_at = float(atr_series(df, atr_period).iloc[idx]) if sl_mode == "atr" else None
        dists = sl_tp_distances(sl_mode, sl_p, tp_p, pip, atr_at)
        if dists is None:
            return {"available": False, "reason": "ATR no definido en la vela de la operación."}
        sl2, _tp2 = sl_tp_prices(last["direction"], last["entry_price"], dists[0], dists[1])
        pre_balance = float(trades[-2]["balance"]) if len(trades) >= 2 else balance
        vol2 = size_for(pre_balance, risk_pct, last["entry_price"], sl2, pip, pip_value, vmin, vstep, run["lot"])
        sl_match = (last["sl"] is not None) and (round(sl2, digits) == round(last["sl"], digits))
        vol_match = abs(vol2 - float(last["volume"])) < 1e-9
        return {
            "available": True,
            "match": bool(sl_match and vol_match),
            "live": {"sl": round(sl2, digits), "volume": vol2},
            "backtest": {"sl": round(float(last["sl"]), digits) if last["sl"] is not None else None,
                         "volume": float(last["volume"]), "entry": last["entry_price"],
                         "direction": last["direction"]},
        }
    except Exception as e:  # noqa: BLE001 - el preview no debe fallar por la comparación
        return {"available": False, "reason": f"No se pudo comparar con el backtest: {e}"}


def preview_run(client: Any, run: dict[str, Any]) -> dict[str, Any]:
    """Calcula (sin operar) lo que el ejecutor haría para UNA estrategia activa."""
    # Tolerar runs PERSISTIDOS antes de añadir estos campos (sin sl_mode/atr_period/
    # risk_percent): se asumen los defaults (fijo, sin riesgo%), como operaban entonces.
    run = {
        **run,
        "sl_mode": str(run.get("sl_mode") or "fixed").lower(),
        "atr_period": int(run.get("atr_period") or 14),
        "risk_percent": float(run.get("risk_percent") or 0),
        "lot": float(run.get("lot") or 0.01),
    }
    symbol = run["symbol"]; tf = run["timeframe"]
    atr_period = run["atr_period"]
    base = {
        # `favorite_id` se devuelve para que el diálogo de confirmar (preview ad-hoc)
        # pueda emparejar cada resultado con su favorito.
        "favorite_id": run.get("favorite_id"),
        "strategy_id": run.get("strategy_id"), "symbol": symbol, "timeframe": tf,
        "strategy_type": run.get("strategy_type"), "sl_mode": run["sl_mode"],
        "atr_period": atr_period, "risk_percent": run["risk_percent"], "fixed_lot": run["lot"],
    }
    try:
        count = max(300, atr_period + _MIN_CANDLES)
        candles = client.candles(symbol, tf, count=count)
        closed = candles[:-1] if len(candles) > 1 else candles
        if len(closed) < max(atr_period + 2, 30):
            return {**base, "ok": False, "reason": f"Velas insuficientes ({len(closed)}) para el preview."}
        df = pd.DataFrame(closed).sort_values("time").reset_index(drop=True)
        m = gather_market(client, symbol)
        balance = float(client.account_info().get("balance") or 0.0)
        entry = float(df["close"].iloc[-1])  # entrada de referencia = último cierre (como el backtest)
        atr_value = float(atr_series(df, atr_period).iloc[-1]) if run["sl_mode"] == "atr" else None

        # MISMA función que el ejecutor (open_market) → preview == lo que se enviaría.
        order = compute_order(run, "buy", entry, atr_value, balance, m["prof"],
                              m["digits"], m["stops_level"], m["volume_max"])
        return {
            **base, "balance": round(balance, 2), "entry_ref": round(entry, m["digits"]),
            "sl_price": order.get("sl"), "tp_price": order.get("tp"),
            "atr_value": order.get("atr_value"),
            "sl_dist_pips": order.get("sl_dist_pips"), "tp_dist_pips": order.get("tp_dist_pips"),
            "risk_lot": order.get("risk_lot"), "would_lot": order.get("volume"),
            "risk_usd": order.get("risk_usd"), "risk_pct_actual": order.get("risk_pct_actual"),
            "min_stop_pips": order.get("min_stop_pips"), "sl_ok": order.get("sl_ok"),
            "tp_ok": order.get("tp_ok"), "volume_cap": order.get("volume_cap"),
            "would_open": bool(order.get("ok")), "block_reason": order.get("reason"),
            "warn": order.get("warn"), "ok": True,
            "backtest_match": _backtest_match(run, closed, df, m, balance),
        }
    except Exception as e:  # noqa: BLE001 - un símbolo problemático no debe tumbar el preview
        return {**base, "ok": False, "reason": f"No disponible: {e}"}


def preview_all(client: Any, runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [preview_run(client, r) for r in runs]
