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
