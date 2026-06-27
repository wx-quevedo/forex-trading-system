"""Backtester event-driven sobre pandas.

Simula una estrategia sobre velas históricas: gestiona una posición a la vez,
con SL/TP en pips y sizing por % de riesgo, y produce métricas, lista de trades
y equity curve listas para el frontend (Recharts + marcadores en el chart).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from ..strategy import build_strategy, signal_series

# Barras por año por timeframe (aprox., para anualizar Sharpe/Sortino).
_BARS_PER_YEAR = {
    "M1": 525600, "M5": 105120, "M15": 35040, "M30": 17520,
    "H1": 8760, "H4": 2190, "D1": 365, "W1": 52, "MN1": 12,
}


def pip_size(symbol: str) -> float:
    return 0.01 if symbol.upper().endswith("JPY") else 0.0001


def run_backtest(
    type_: str,
    params: dict[str, Any] | None,
    candles: list[dict[str, Any]],
    *,
    symbol: str = "EURUSD",
    timeframe: str = "H1",
    risk: dict[str, Any] | None = None,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if len(candles) < 30:
        raise ValueError("Se necesitan al menos 30 velas para backtestear.")

    df = pd.DataFrame(candles).sort_values("time").reset_index(drop=True)

    cfg = {
        "initial_balance": 10000.0,
        "pip_value_per_lot": 10.0,   # USD por pip por 1.0 lote (aprox majors USD)
        "spread_pips": 0.0,          # COSTO real del broker (lo pasa el router por símbolo)
        "commission_per_lot": 0.0,   # round-turn, por lote
        "swap_long_pts": 0.0,        # swap overnight en puntos (long), del símbolo
        "swap_short_pts": 0.0,       # swap overnight en puntos (short), del símbolo
        "point": 0.0,                # tamaño del punto del símbolo (para el swap)
        "default_volume": 0.01,
        **(config or {}),
    }
    risk = risk or {}
    sl_pips = _num(risk.get("sl_pips"))
    tp_pips = _num(risk.get("tp_pips"))
    risk_pct = _num(risk.get("risk_percent"))

    pip = pip_size(symbol)
    pip_value = float(cfg["pip_value_per_lot"])
    spread_pips = float(cfg["spread_pips"])
    commission_per_lot = float(cfg["commission_per_lot"])
    initial = float(cfg["initial_balance"])
    # Valor de 1 punto de swap por lote (puntos -> dinero), ratio punto/pip (~0.1).
    point = float(cfg["point"]) or pip / 10.0
    swap_value_per_pt = (point / pip) * pip_value if pip else 0.0
    swap_long_pts = float(cfg["swap_long_pts"])
    swap_short_pts = float(cfg["swap_short_pts"])

    strategy = build_strategy(type_, params)
    signals = signal_series(strategy, df)

    balance = initial
    position: dict[str, Any] | None = None
    trades: list[dict[str, Any]] = []
    equity_curve: list[dict[str, Any]] = []

    closes = df["close"].to_numpy()
    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()
    times = df["time"].to_numpy()
    sig = signals.to_numpy()

    def size_for(entry: float, sl: float | None) -> float:
        if risk_pct and sl is not None and abs(entry - sl) > 0:
            risk_amount = balance * risk_pct / 100.0
            vol = risk_amount / ((abs(entry - sl) / pip) * pip_value)
            return max(0.01, round(vol, 2))
        return float(cfg["default_volume"])

    def close_position(exit_price: float, exit_time: int, reason: str) -> None:
        nonlocal balance, position
        assert position is not None
        direction = position["dir"]
        vol = position["volume"]
        diff = (exit_price - position["entry"]) if direction == "buy" else (position["entry"] - exit_price)
        gross = (diff / pip) * pip_value * vol

        # Costos reales del broker.
        spread_cost = spread_pips * pip_value * vol      # spread pagado en la entrada
        commission_cost = commission_per_lot * vol
        nights = max(0, int(exit_time) // 86400 - int(position["entry_time"]) // 86400)
        swap_pts = swap_long_pts if direction == "buy" else swap_short_pts
        swap = nights * swap_pts * swap_value_per_pt * vol  # signo del broker (suele ser costo)
        costs = spread_cost + commission_cost - swap        # swap puede sumar o restar
        net = gross - costs

        balance += net
        trades.append(
            {
                "entry_time": int(position["entry_time"]),
                "exit_time": int(exit_time),
                "direction": direction,
                "entry_price": round(position["entry"], 6),
                "exit_price": round(exit_price, 6),
                "volume": vol,
                "sl": round(position["sl"], 6) if position["sl"] is not None else None,
                "tp": round(position["tp"], 6) if position["tp"] is not None else None,
                "pnl": round(net, 2),          # NETO (con costos) — el realista
                "pnl_gross": round(gross, 2),  # BRUTO (sin costos)
                "costs": round(costs, 2),
                "nights": nights,
                "exit_reason": reason,
                "balance": round(balance, 2),
            }
        )
        position = None

    def open_position(direction: str, i: int) -> None:
        nonlocal position
        entry = closes[i]  # entrada al precio medio; el spread se cobra como costo al cerrar
        if direction == "buy":
            sl = entry - sl_pips * pip if sl_pips else None
            tp = entry + tp_pips * pip if tp_pips else None
        else:
            sl = entry + sl_pips * pip if sl_pips else None
            tp = entry - tp_pips * pip if tp_pips else None
        position = {
            "dir": direction, "entry": entry, "entry_time": times[i],
            "sl": sl, "tp": tp, "volume": size_for(entry, sl),
        }

    n = len(df)
    for i in range(n):
        # 1) Gestionar SL/TP de la posición abierta dentro de esta vela.
        if position is not None:
            d, sl, tp = position["dir"], position["sl"], position["tp"]
            if d == "buy":
                if sl is not None and lows[i] <= sl:
                    close_position(sl, times[i], "sl")
                elif tp is not None and highs[i] >= tp:
                    close_position(tp, times[i], "tp")
            else:
                if sl is not None and highs[i] >= sl:
                    close_position(sl, times[i], "sl")
                elif tp is not None and lows[i] <= tp:
                    close_position(tp, times[i], "tp")

        # 2) Actuar sobre la señal de esta vela (cerrada).
        s = sig[i]
        if s in ("buy", "sell"):
            if position is not None and position["dir"] != s:
                close_position(closes[i], times[i], "signal")
            if position is None:
                open_position(s, i)

        # 3) Equity mark-to-market.
        equity = balance
        if position is not None:
            d = position["dir"]
            diff = (closes[i] - position["entry"]) if d == "buy" else (position["entry"] - closes[i])
            equity += (diff / pip) * pip_value * position["volume"]
        equity_curve.append({"time": int(times[i]), "equity": round(equity, 2)})

    if position is not None:
        close_position(closes[-1], times[-1], "end")

    metrics = _compute_metrics(trades, equity_curve, initial, timeframe)
    return {
        "metrics": metrics,
        "trades": trades,
        "equity_curve": equity_curve,
        "meta": {
            "symbol": symbol, "timeframe": timeframe, "type": type_,
            "candles": int(n),
            "from": int(times[0]), "to": int(times[-1]),
        },
    }


def _compute_metrics(
    trades: list[dict[str, Any]],
    equity_curve: list[dict[str, Any]],
    initial: float,
    timeframe: str,
) -> dict[str, Any]:
    pnls = np.array([t["pnl"] for t in trades], dtype=float)
    total = len(pnls)
    wins = int((pnls > 0).sum())
    losses = int((pnls <= 0).sum())
    gross_profit = float(pnls[pnls > 0].sum()) if total else 0.0
    gross_loss = float(-pnls[pnls < 0].sum()) if total else 0.0
    net = float(pnls.sum()) if total else 0.0
    gross = float(sum(t.get("pnl_gross", t["pnl"]) for t in trades)) if total else 0.0
    total_costs = round(gross - net, 2)

    eq = np.array([p["equity"] for p in equity_curve], dtype=float)
    peak = np.maximum.accumulate(eq) if len(eq) else np.array([initial])
    dd = eq - peak
    max_dd_abs = float(dd.min()) if len(dd) else 0.0
    dd_pct = np.where(peak > 0, dd / peak, 0.0)
    max_dd_pct = float(dd_pct.min() * 100) if len(dd_pct) else 0.0

    # Sharpe / Sortino anualizados desde retornos por barra del equity.
    rets = np.diff(eq) / eq[:-1] if len(eq) > 1 else np.array([])
    bars_year = _BARS_PER_YEAR.get(timeframe.upper(), 8760)
    sharpe = sortino = 0.0
    if rets.size and rets.std(ddof=0) > 0:
        sharpe = float(rets.mean() / rets.std(ddof=0) * math.sqrt(bars_year))
    if rets.size:
        downside = rets[rets < 0]
        if downside.size and downside.std(ddof=0) > 0:
            sortino = float(rets.mean() / downside.std(ddof=0) * math.sqrt(bars_year))

    # Rachas.
    max_win_streak = max_loss_streak = cur_w = cur_l = 0
    for p in pnls:
        if p > 0:
            cur_w += 1; cur_l = 0
        else:
            cur_l += 1; cur_w = 0
        max_win_streak = max(max_win_streak, cur_w)
        max_loss_streak = max(max_loss_streak, cur_l)

    # PnL por mes (clave YYYY-MM por fecha de salida).
    pnl_by_month: dict[str, float] = {}
    for t in trades:
        month = pd.to_datetime(t["exit_time"], unit="s", utc=True).strftime("%Y-%m")
        pnl_by_month[month] = round(pnl_by_month.get(month, 0.0) + t["pnl"], 2)

    return {
        "total_trades": total,
        "wins": wins,
        "losses": losses,
        "win_rate": round(wins / total, 4) if total else 0.0,
        "profit_factor": round(gross_profit / gross_loss, 3) if gross_loss > 0 else None,
        "net_pnl": round(net, 2),
        "gross_pnl": round(gross, 2),
        "total_costs": total_costs,
        "gross_profit": round(gross_profit, 2),
        "gross_loss": round(gross_loss, 2),
        "return_pct": round(net / initial * 100, 2) if initial else 0.0,
        "return_pct_gross": round(gross / initial * 100, 2) if initial else 0.0,
        "final_balance": round(initial + net, 2),
        "max_drawdown_abs": round(max_dd_abs, 2),
        "max_drawdown_pct": round(max_dd_pct, 2),
        "sharpe": round(sharpe, 3),
        "sortino": round(sortino, 3),
        "max_win_streak": max_win_streak,
        "max_loss_streak": max_loss_streak,
        "avg_win": round(float(pnls[pnls > 0].mean()), 2) if wins else 0.0,
        "avg_loss": round(float(pnls[pnls <= 0].mean()), 2) if losses else 0.0,
        "pnl_by_month": pnl_by_month,
    }


def _num(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None
