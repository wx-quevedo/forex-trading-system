"""Tests del motor de optimización robusta (sin MT5: velas sintéticas)."""

import numpy as np
import pytest

from app.optimize import optimize


def _wave_candles(n=400):
    """Onda senoidal + ruido → genera cruces de medias (trades en in y out)."""
    rng = np.random.default_rng(7)
    t = np.arange(n)
    close = 1.10 + 0.02 * np.sin(t / 12.0) + 0.002 * rng.standard_normal(n).cumsum() / 10
    out = []
    base = 1_700_000_000
    for i, c in enumerate(close):
        out.append({"time": base + i * 3600, "open": float(c), "high": float(c) + 0.001,
                    "low": float(c) - 0.001, "close": float(c), "tick_volume": 100})
    return out


def test_optimize_returns_ranked_results():
    candles = _wave_candles(420)
    res = optimize("ma_cross", {"ma_type": "ema"}, candles,
                   symbol="EURUSD", timeframe="H1", risk={"sl_pips": 20, "tp_pips": 40})
    assert res["combinations"] >= 1
    assert res["min_trades"] == 30
    assert res["in_sample"]["candles"] > res["out_sample"]["candles"]  # split 0.7
    for r in res["results"]:
        assert r["verdict"] in {"inside", "edge", "outside"}
        assert "in_return" in r and "out_return" in r and "total_trades" in r
        assert 0 <= r["stars"] <= 4
    # Orden: las robustas (inside) antes que las descartadas (outside).
    verdict_rank = {"inside": 0, "edge": 1, "outside": 2}
    ranks = [verdict_rank[r["verdict"]] for r in res["results"]]
    assert ranks == sorted(ranks)


def test_optimize_marks_small_sample_outside():
    candles = _wave_candles(150)  # poca muestra → muchas combinaciones < 30 trades
    res = optimize("rsi", {}, candles, symbol="EURUSD", timeframe="H1", risk={"sl_pips": 20, "tp_pips": 40})
    small = [r for r in res["results"] if r["total_trades"] < 30]
    assert all(r["verdict"] == "outside" for r in small)


def test_optimize_requires_minimum_candles():
    with pytest.raises(ValueError):
        optimize("ma_cross", {}, _wave_candles(100), symbol="EURUSD", timeframe="H1")
