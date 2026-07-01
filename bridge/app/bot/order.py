"""compute_order — NÚCLEO ÚNICO de la decisión de orden del bot en vivo.

Lo usan el PREVIEW (Fase 1) y el EJECUTOR real (open_market, Fase 2) → lo que el preview
muestra como COINCIDE es exactamente lo que se enviaría. Calcula SL/TP (ATR o pips) y el
lote por riesgo% con el módulo compartido backtest/sizing.py (fidelidad con el backtest)
y aplica las guardas de seguridad acordadas:

- stops_level: si el SL/TP queda por debajo de la distancia mínima del bróker → NO abrir
  (saltar; recortar cambiaría la estrategia y rompería la fidelidad).
- volume_max: no abrir si el lote supera el máximo del bróker o un tope configurable.
- volume_min: si el riesgo% pide MENOS que el lote mínimo → según `below_min`:
  "skip" (default, conservador: no abrir + aviso) o "floor" (abrir el mínimo + aviso).

Función PURA: sin MT5, sin estado (recibe ya los datos de mercado/cuenta).
"""

from __future__ import annotations

from typing import Any

from ..backtest.sizing import risk_volume, round_lot, size_for, sl_tp_distances, sl_tp_prices


def gather_market(client: Any, symbol: str) -> dict[str, Any]:
    """Perfil del símbolo (pip/pip_value/volúmenes del bróker) + digits/stops_level/
    volume_max. Fuente ÚNICA de los datos de mercado para preview y ejecutor."""
    prof = client.symbol_costs(symbol) or {}
    sinfo = client.symbol_info(symbol) or {}
    point = float(sinfo.get("point") or prof.get("point") or 0.0)
    prof = {**prof, "point": point}
    return {
        "prof": prof,
        "pip": float(prof.get("pip") or (point * 10.0 if point else 0.0001)),
        "digits": int(sinfo.get("digits") or 5),
        "stops_level": int(sinfo.get("trade_stops_level") or 0),
        "volume_max": float(sinfo.get("volume_max") or 0.0),
    }


def current_atr(candles: list[dict[str, Any]], atr_period: int) -> float:
    """ATR ACTUAL (última vela cerrada) — mismo cálculo que el backtest."""
    import pandas as pd
    from ..strategy.indicators import atr as atr_series
    df = pd.DataFrame(candles).sort_values("time").reset_index(drop=True)
    return float(atr_series(df, atr_period).iloc[-1])


def _cfg(run: dict[str, Any]) -> dict[str, Any]:
    return {
        "sl_mode": str(run.get("sl_mode") or "fixed").lower(),
        "atr_period": int(run.get("atr_period") or 14),
        "sl_pips": float(run.get("sl_pips") or 0),
        "tp_pips": float(run.get("tp_pips") or 0),
        "risk_percent": float(run.get("risk_percent") or 0),
        "lot": float(run.get("lot") or 0.01),
        "max_lot": float(run.get("max_lot") or 0),          # 0 = sin tope adicional
        "below_min": str(run.get("below_min") or "skip").lower(),  # "skip" | "floor"
    }


def compute_order(
    run: dict[str, Any],
    direction: str,
    entry: float,
    atr_value: float | None,
    balance: float,
    prof: dict[str, Any],
    digits: int,
    stops_level: int,
    volume_max: float,
) -> dict[str, Any]:
    """Decide la orden (SL/TP/lote) y si se debe abrir. Devuelve un dict unificado que
    consumen tanto el preview como el ejecutor. `ok=False` con `reason` = NO abrir."""
    c = _cfg(run)
    pip = float(prof.get("pip") or 0.0)
    pip_value = float(prof.get("pip_value_per_lot") or 10.0)
    vmin = float(prof.get("volume_min") or 0.01)
    vstep = float(prof.get("volume_step") or 0.01)
    point = float(prof.get("point") or 0.0)

    res: dict[str, Any] = {
        "ok": False, "reason": None, "warn": None, "direction": direction,
        "sl_mode": c["sl_mode"], "atr_period": c["atr_period"], "risk_percent": c["risk_percent"],
        "entry": round(entry, digits), "atr_value": round(atr_value, digits) if atr_value is not None else None,
        "fixed_lot": c["lot"], "digits": digits,
    }

    # 1) Distancias SL/TP (ATR o pips). ATR no definido → no operar (como el backtest).
    dists = sl_tp_distances(c["sl_mode"], c["sl_pips"], c["tp_pips"], pip, atr_value)
    if dists is None:
        res["reason"] = "ATR aún sin definir (volatilidad/velas insuficientes) — no se abre."
        return res
    sl_dist, tp_dist = dists
    sl, tp = sl_tp_prices(direction, entry, sl_dist, tp_dist)
    res["sl"] = round(sl, digits) if sl is not None else None
    res["tp"] = round(tp, digits) if tp is not None else None
    res["sl_dist_pips"] = round(sl_dist / pip, 1) if sl_dist else None
    res["tp_dist_pips"] = round(tp_dist / pip, 1) if tp_dist else None

    # 2) Distancia mínima del bróker (stops_level). Por debajo → NO abrir (no recortar).
    min_dist_price = stops_level * point
    res["min_stop_pips"] = round((min_dist_price / pip), 1) if pip else 0.0
    sl_ok = sl_dist is None or min_dist_price <= 0 or sl_dist >= min_dist_price
    tp_ok = tp_dist is None or min_dist_price <= 0 or tp_dist >= min_dist_price
    res["sl_ok"], res["tp_ok"] = bool(sl_ok), bool(tp_ok)

    # 3) Lote por riesgo% (lote fijo solo si no hay riesgo%). Detecta el piso volume_min.
    raw = risk_volume(balance, c["risk_percent"], entry, sl, pip, pip_value)
    if raw is None:
        volume = c["lot"]            # respaldo: sin riesgo% → lote configurado
        res["risk_lot"] = None
    else:
        res["risk_lot"] = round_lot(raw, vmin, vstep)
        stepped = round(raw / vstep) * vstep if vstep else raw  # redondeo a escalón SIN piso
        below_min = stepped < vmin - 1e-12
        if below_min and c["below_min"] == "skip":
            res["risk_below_min"] = True
            res["reason"] = (f"El riesgo% pide {stepped:.4f} lotes (< lote mínimo {vmin}). "
                             "Esta estrategia necesita más capital o menos riesgo% para operarse "
                             "fielmente. No se abre (protección configurable: below_min=skip).")
            return res
        volume = size_for(balance, c["risk_percent"], entry, sl, pip, pip_value, vmin, vstep, c["lot"])
        if below_min:  # below_min == "floor": abre el mínimo, con aviso
            res["warn"] = f"Riesgo% pedía {stepped:.4f} < mínimo {vmin}: se abre el lote mínimo (riesgo real > {c['risk_percent']}%)."

    # $ en riesgo REAL de la operación (con el lote ya redondeado) = distancia SL en
    # pips × valor del pip × lote. El % real puede exceder al nominal por el redondeo
    # del lote al escalón mínimo (p.ej. 0.0166→0.02 ≈ 1.2% en vez de 1%).
    if sl_dist and volume and pip:
        res["risk_usd"] = round((sl_dist / pip) * pip_value * volume, 2)
        res["risk_pct_actual"] = round((res["risk_usd"] / balance * 100.0), 3) if balance > 0 else None
    else:
        res["risk_usd"] = None
        res["risk_pct_actual"] = None

    # 4) Tope de volumen: máximo del bróker y/o cap configurable (defensa en profundidad).
    eff_max = volume_max if volume_max and volume_max > 0 else float("inf")
    if c["max_lot"] > 0:
        eff_max = min(eff_max, c["max_lot"])
    res["volume_cap"] = None if eff_max == float("inf") else round(eff_max, 2)
    if volume > eff_max + 1e-12:
        res["volume"] = volume
        res["reason"] = (f"El lote calculado {volume} supera el tope ({eff_max}). No se abre "
                         "(protección de volumen).")
        return res

    # 5) Guarda final de stops (tras tener números): por debajo del mínimo → no abrir.
    if not (sl_ok and tp_ok):
        res["volume"] = volume
        res["reason"] = (f"SL/TP por debajo de la distancia mínima del bróker ({res['min_stop_pips']} pips). "
                         "No se abre (recortar el stop rompería la estrategia validada).")
        return res

    res["ok"] = True
    res["volume"] = volume
    return res
