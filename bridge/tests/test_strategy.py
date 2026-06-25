"""Tests del motor de estrategias (sin MT5: usan velas sintéticas)."""

import numpy as np

from app.strategy import STRATEGY_SCHEMAS, build_strategy, evaluate_strategy


def _candles(closes):
    """Construye velas OHLCV mínimas a partir de una lista de cierres."""
    out = []
    t = 1_700_000_000
    for i, c in enumerate(closes):
        out.append(
            {
                "time": t + i * 3600,
                "open": c,
                "high": c + 0.0005,
                "low": c - 0.0005,
                "close": c,
                "tick_volume": 100,
            }
        )
    return out


def test_schemas_cover_all_types():
    for type_ in ["ma_cross", "rsi", "macd", "bollinger", "combined"]:
        assert type_ in STRATEGY_SCHEMAS
        assert STRATEGY_SCHEMAS[type_]["fields"]


def test_build_fills_defaults():
    s = build_strategy("rsi", {})
    assert s.period == 14 and s.oversold == 30 and s.overbought == 70


def test_ma_cross_buy_on_upturn():
    # Caída prolongada (fast por debajo de slow) + salto en la última vela:
    # la media rápida cruza por encima de la lenta justo en el último bar.
    closes = list(np.linspace(1.20, 1.05, 40)) + [1.30]
    result = evaluate_strategy("ma_cross", {"ma_type": "ema", "fast_period": 5, "slow_period": 20}, _candles(closes))
    assert result["signal"] == "buy"
    assert "fast" in result["indicators"]


def test_rsi_returns_valid_signal():
    closes = list(np.linspace(1.10, 1.00, 30)) + list(np.linspace(1.00, 1.06, 15))
    result = evaluate_strategy("rsi", {"period": 14}, _candles(closes))
    assert result["signal"] in {"buy", "sell", "none"}
    assert result["candles_evaluated"] == len(closes)


def test_unknown_type_raises():
    try:
        evaluate_strategy("does_not_exist", {}, _candles([1.1, 1.1, 1.1]))
        assert False, "debería lanzar ValueError"
    except ValueError:
        pass
