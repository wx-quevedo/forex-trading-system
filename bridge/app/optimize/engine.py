"""Motor de optimización robusta (anti-overfitting).

Filosofía (NO negociable): NO se busca la combinación que más ganó en el pasado
(eso casi siempre es overfit), sino combinaciones ROBUSTAS — consistentes entre
in-sample (optimización) y out-of-sample (validación que el optimizador no vio).

Guardarraíles:
- Separación train/test (in-sample / out-of-sample).
- Mínimo de operaciones (muestra estadísticamente creíble).
- Métrica de robustez = consistencia in↔out, NO retorno máximo.
- Penalización por "pico aislado" (preferir mesetas: vecinos también buenos).
"""

from __future__ import annotations

from typing import Any

from ..backtest.engine import run_backtest

MIN_TRADES = 30  # mínimo total de operaciones para credibilidad estadística


def _grid(strategy_type: str, base: dict[str, Any]) -> list[dict[str, Any]]:
    """Rangos de barrido razonables por tipo (evita explosión combinatoria)."""
    t = strategy_type
    if t == "ma_cross":
        ma = base.get("ma_type", "ema")
        return [
            {"ma_type": ma, "fast_period": f, "slow_period": s}
            for f in (5, 8, 9, 12, 15, 20)
            for s in (21, 26, 34, 50, 55)
            if f < s
        ]
    if t == "rsi":
        return [
            {"period": p, "oversold": o, "overbought": ob}
            for p in (7, 14, 21)
            for o in (25, 30, 35)
            for ob in (65, 70, 75)
        ]
    if t == "macd":
        return [
            {"fast": f, "slow": s, "signal": 9}
            for f in (8, 12, 16)
            for s in (21, 26, 34)
            if f < s
        ]
    if t == "bollinger":
        return [
            {"period": p, "std_dev": sd}
            for p in (14, 20, 30)
            for sd in (1.5, 2.0, 2.5)
        ]
    if t == "combined":
        ma = base.get("trend_ma_type", "ema")
        return [
            {"trend_ma_type": ma, "trend_period": tp, "rsi_period": 14, "rsi_oversold": 30, "rsi_overbought": 70, "logic": lg}
            for tp in (30, 50, 100, 200)
            for lg in ("and", "or")
        ]
    return [dict(base)]


def _numeric_keys(params: dict[str, Any]) -> list[str]:
    return [k for k, v in params.items() if isinstance(v, (int, float))]


def _neighbor_out(combo: dict[str, Any], by_key: dict[str, float], axes: dict[str, list]) -> float | None:
    """Promedio de out-of-sample de los vecinos de grid (±1 paso en un parámetro).

    Sirve para detectar 'picos aislados' (overfit) frente a 'mesetas' (robusto).
    """
    neighbors: list[float] = []
    for k in _numeric_keys(combo):
        vals = axes.get(k, [])
        if combo[k] not in vals:
            continue
        i = vals.index(combo[k])
        for j in (i - 1, i + 1):
            if 0 <= j < len(vals):
                key = _params_key({**combo, k: vals[j]})
                if key in by_key:
                    neighbors.append(by_key[key])
    return sum(neighbors) / len(neighbors) if neighbors else None


def _params_key(params: dict[str, Any]) -> str:
    return "|".join(f"{k}={params[k]}" for k in sorted(params))


def _verdict(in_ret: float, out_ret: float, total_tr: int, neighbor_out: float | None) -> tuple[float, str, str]:
    """Devuelve (robustez 0..1, veredicto, etiqueta)."""
    if total_tr < MIN_TRADES:
        return 0.0, "outside", f"Muestra pequeña ({total_tr} ops < {MIN_TRADES})"
    if in_ret <= 0:
        return 0.0, "outside", "Sin ventaja ni en in-sample"
    if out_ret <= 0:
        return 0.05, "outside", "Overfit: gana in-sample, pierde out-of-sample"

    consistency = 1 - min(1.0, abs(in_ret - out_ret) / (abs(in_ret) + abs(out_ret)))
    score = consistency
    # Penalizar picos aislados: out muy superior al de sus vecinos.
    if neighbor_out is not None and neighbor_out < out_ret * 0.4:
        score *= 0.6
        spike = True
    else:
        spike = False

    if score >= 0.7 and out_ret >= 0.5 * in_ret and not spike:
        return score, "inside", "Robusta: consistente in↔out"
    if score >= 0.45:
        return score, "edge", "Límite: consistencia moderada"
    return score, "outside", "Inconsistente in vs out"


def optimize(
    strategy_type: str,
    base_params: dict[str, Any] | None,
    candles: list[dict[str, Any]],
    *,
    symbol: str = "EURUSD",
    timeframe: str = "H1",
    risk: dict[str, Any] | None = None,
    split: float = 0.7,
) -> dict[str, Any]:
    n = len(candles)
    if n < 120:
        raise ValueError("Se necesitan al menos 120 velas para optimizar con validación out-of-sample.")

    cut = int(n * split)
    in_candles = candles[:cut]
    out_candles = candles[cut:]
    combos = _grid(strategy_type, base_params or {})

    raw: list[dict[str, Any]] = []
    for params in combos:
        try:
            bt_in = run_backtest(strategy_type, params, in_candles, symbol=symbol, timeframe=timeframe, risk=risk)
            bt_out = run_backtest(strategy_type, params, out_candles, symbol=symbol, timeframe=timeframe, risk=risk)
        except Exception:  # noqa: BLE001 - una combinación inválida no debe abortar todo
            continue
        m_in, m_out = bt_in["metrics"], bt_out["metrics"]
        raw.append({
            "params": params,
            "in_return": round(float(m_in["return_pct"]), 2),
            "out_return": round(float(m_out["return_pct"]), 2),
            "in_trades": int(m_in["total_trades"]),
            "out_trades": int(m_out["total_trades"]),
            "total_trades": int(m_in["total_trades"]) + int(m_out["total_trades"]),
            "profit_factor_out": m_out.get("profit_factor"),
            "max_dd_out": round(float(m_out.get("max_drawdown_pct", 0.0)), 2),
        })

    # Mapa para el cálculo de vecinos (mesetas).
    by_key = {_params_key(r["params"]): r["out_return"] for r in raw}
    axes: dict[str, list] = {}
    for r in raw:
        for k in _numeric_keys(r["params"]):
            axes.setdefault(k, [])
            if r["params"][k] not in axes[k]:
                axes[k].append(r["params"][k])
    for k in axes:
        axes[k].sort()

    for r in raw:
        nb = _neighbor_out(r["params"], by_key, axes)
        score, verdict, label = _verdict(r["in_return"], r["out_return"], r["total_trades"], nb)
        r["robustness"] = round(score, 3)
        r["stars"] = max(0, min(4, round(score * 4)))
        r["verdict"] = verdict
        r["verdict_label"] = label

    # Orden: robustas primero, luego por robustez y por retorno out (NO por in).
    rank = {"inside": 0, "edge": 1, "outside": 2}
    raw.sort(key=lambda r: (rank[r["verdict"]], -r["robustness"], -r["out_return"]))

    def _slice_meta(cs: list[dict[str, Any]]) -> dict[str, Any]:
        return {"candles": len(cs), "from": cs[0]["time"] if cs else None, "to": cs[-1]["time"] if cs else None}

    return {
        "strategy_type": strategy_type,
        "symbol": symbol,
        "timeframe": timeframe,
        "min_trades": MIN_TRADES,
        "in_sample": _slice_meta(in_candles),
        "out_sample": _slice_meta(out_candles),
        "combinations": len(raw),
        "results": raw,
    }
