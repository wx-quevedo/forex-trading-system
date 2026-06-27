"""Tests del motor de backtesting (velas sintéticas, sin MT5)."""

import numpy as np

from app.backtest import run_backtest


def _candles(closes, spread=0.0005):
    out = []
    t = 1_700_000_000
    for i, c in enumerate(closes):
        out.append(
            {
                "time": t + i * 3600,
                "open": float(c),
                "high": float(c) + spread,
                "low": float(c) - spread,
                "close": float(c),
                "tick_volume": 100,
            }
        )
    return out


def _trend_then_reversal(n=200):
    # Serie con varias ondas para generar cruces de medias.
    x = np.linspace(0, 6 * np.pi, n)
    return list(1.10 + 0.02 * np.sin(x))


def test_runs_and_returns_structure():
    candles = _candles(_trend_then_reversal())
    res = run_backtest(
        "ma_cross",
        {"ma_type": "ema", "fast_period": 5, "slow_period": 20},
        candles,
        symbol="EURUSD",
        timeframe="H1",
        risk={"sl_pips": 20, "tp_pips": 40, "risk_percent": 1},
    )
    assert set(res) == {"metrics", "trades", "equity_curve", "meta"}
    m = res["metrics"]
    for key in ["total_trades", "win_rate", "net_pnl", "max_drawdown_pct", "sharpe", "sortino"]:
        assert key in m
    assert len(res["equity_curve"]) == len(candles)
    assert res["meta"]["candles"] == len(candles)


def test_generates_trades_with_oscillating_series():
    candles = _candles(_trend_then_reversal(300))
    res = run_backtest(
        "ma_cross",
        {"ma_type": "ema", "fast_period": 5, "slow_period": 20},
        candles,
        risk={"sl_pips": 30, "tp_pips": 30},
    )
    assert res["metrics"]["total_trades"] > 0
    for tr in res["trades"]:
        assert tr["direction"] in {"buy", "sell"}
        assert tr["exit_reason"] in {"sl", "tp", "signal", "end"}
        assert "pnl" in tr


def test_too_few_candles_raises():
    try:
        run_backtest("rsi", {}, _candles([1.1] * 10))
        assert False, "debería lanzar ValueError"
    except ValueError:
        pass


def test_jpy_pip_size():
    from app.backtest.engine import pip_size

    assert pip_size("USDJPY") == 0.01
    assert pip_size("EURUSD") == 0.0001


def test_account_blowup_caps_at_zero():
    """Una pérdida mayor al capital quiebra la cuenta: capital final 0 (no negativo),
    retorno y drawdown −100%, no se opera tras la quiebra."""
    # Subida sostenida (abre largo) y luego desplome enorme que dispara el SL con una
    # pérdida muy superior al capital. SL gigante para que una sola operación arruine.
    rising = list(np.linspace(1.10, 1.30, 45))
    crash = [0.80] * 15
    candles = _candles(rising + crash, spread=0.0001)

    res = run_backtest(
        "ma_cross",
        {"ma_type": "ema", "fast_period": 3, "slow_period": 6},
        candles,
        symbol="EURUSD",
        timeframe="H1",
        risk={"sl_pips": 2000, "tp_pips": 4000, "risk_percent": 0},
        config={"initial_balance": 100.0, "spread_pips": 0.0},
    )
    m = res["metrics"]
    assert m["blown"] is True
    assert m["final_balance"] == 0.0
    assert m["return_pct"] == -100.0
    assert m["max_drawdown_pct"] == -100.0
    # La última operación es la de quiebra y no hay nada después.
    assert res["trades"][-1]["exit_reason"] == "blown"
    assert m["blown_at"] is not None
    assert all(t["exit_time"] <= m["blown_at"] for t in res["trades"])
    # El capital nunca queda negativo en ningún registro.
    assert all(t["balance"] >= 0 for t in res["trades"])


def test_metal_pip_derived_from_point():
    """Para el oro (point 0.01) el pip es 0.1 (10 puntos), no el 0.0001 de forex:
    la distancia del SL en precio = sl_pips × pip = sl_pips × 0.1."""
    closes = list(np.linspace(4000, 4100, 60))  # tendencia alcista → abre largo
    res = run_backtest(
        "ma_cross",
        {"ma_type": "ema", "fast_period": 3, "slow_period": 6},
        _candles(closes, spread=0.5),
        symbol="GOLD#",
        timeframe="H1",
        risk={"sl_pips": 10, "tp_pips": 20, "risk_percent": 0},
        config={"initial_balance": 10000, "point": 0.01},
    )
    trades = res["trades"]
    assert trades, "debe abrir al menos una operación"
    t0 = trades[0]
    assert t0["sl"] is not None
    # pip = point × 10 = 0.1 → distancia SL = 10 × 0.1 = 1.0 (no 0.001 con pip de forex)
    assert abs(abs(t0["entry_price"] - t0["sl"]) - 1.0) < 1e-6


def test_no_blowup_normal_run():
    """Sin quiebra: blown=False y capital final positivo en una corrida normal."""
    res = run_backtest(
        "ma_cross",
        {"ma_type": "ema", "fast_period": 5, "slow_period": 20},
        _candles(_trend_then_reversal(300)),
        risk={"sl_pips": 30, "tp_pips": 30, "risk_percent": 1},
        config={"initial_balance": 10000.0},
    )
    assert res["metrics"]["blown"] is False
    assert res["metrics"]["final_balance"] > 0
