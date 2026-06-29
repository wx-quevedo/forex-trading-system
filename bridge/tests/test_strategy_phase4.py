"""Tests de las estrategias de la Fase 4: señales contra casos conocidos,
anti-lookahead (especialmente Ichimoku) y paso por el optimizador anti-overfit."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.strategy.strategies import build_strategy, signal_series
from app.optimize import optimize

NEW_TYPES = ["supertrend", "ichimoku", "donchian", "stochastic", "cci", "psar"]


def _ohlc(closes, s=0.05):
    rows, t = [], 1_700_000_000
    closes = list(closes)
    for i, c in enumerate(closes):
        c = float(c)
        hi = max(c, closes[i - 1] if i else c) + s
        lo = min(c, closes[i - 1] if i else c) - s
        rows.append({"time": t + i * 3600, "open": float(closes[i - 1] if i else c),
                     "high": hi, "low": lo, "close": c, "tick_volume": 100})
    return pd.DataFrame(rows)


def _signals(stype, params, df):
    return signal_series(build_strategy(stype, params), df)


def _down_then_up(down=100, n_down=40, n_up=60):
    a = np.linspace(120, down, n_down)
    b = np.linspace(down, down + 40, n_up)
    return list(a) + list(b)


# --------------------------------------------------------------------------- #
# Señales contra casos conocidos
# --------------------------------------------------------------------------- #
def test_supertrend_flips_to_buy_on_reversal():
    sig = _signals("supertrend", {"period": 10, "multiplier": 3.0}, _ohlc(_down_then_up()))
    assert "buy" in set(sig) and "sell" not in set(sig.iloc[45:])  # voltea alcista, no vende en la subida


def test_psar_flips_to_buy_on_reversal():
    sig = _signals("psar", {"af_step": 0.02, "af_max": 0.2}, _ohlc(_down_then_up()))
    assert "buy" in set(sig)


def test_donchian_breakout_buy():
    closes = [100.0] * 30 + [106.0] + [106.5] * 5   # rompe el canal plano
    sig = _signals("donchian", {"period": 20, "atr_buffer": 0.0, "atr_period": 14}, _ohlc(closes))
    assert "buy" in set(sig)


def test_cci_buy_on_exit_from_oversold():
    sig = _signals("cci", {"period": 20, "threshold": 100}, _ohlc(_down_then_up(n_down=40, n_up=40)))
    assert "buy" in set(sig)


def test_stochastic_buy_on_recovery_from_oversold():
    # Caída prolongada (lleva %K a sobreventa) y rebote → cruce %K/%D en zona baja.
    closes = list(np.linspace(120, 100, 50)) + list(np.linspace(100, 112, 30))
    sig = _signals("stochastic", {"k_period": 14, "d_period": 3, "smooth": 3, "oversold": 20, "overbought": 80}, _ohlc(closes))
    assert "buy" in set(sig)


def test_ichimoku_buy_after_cloud_established():
    # Caída y luego subida: el cruce Tenkan/Kijun ocurre con la nube YA formada
    # (>senkou_b+desplazamiento) y el precio sobre ella → compra confirmada.
    closes = list(np.linspace(110, 100, 95)) + list(np.linspace(100, 150, 80))
    sig = _signals("ichimoku", {"tenkan": 9, "kijun": 26, "senkou_b": 52}, _ohlc(closes))
    assert "buy" in set(sig)


# --------------------------------------------------------------------------- #
# Anti-lookahead: la señal en N usa SOLO datos hasta N (clave para Ichimoku)
# --------------------------------------------------------------------------- #
def _wave(n=240):
    rng = np.random.default_rng(11)
    t = np.arange(n)
    close = 100 + 6 * np.sin(t / 15.0) + rng.standard_normal(n).cumsum() * 0.05
    return _ohlc(close)


@pytest.mark.parametrize("stype", NEW_TYPES)
def test_no_lookahead(stype):
    """Truncar las velas futuras NO debe cambiar la señal de una vela pasada."""
    df = _wave(240)
    full = _signals(stype, {}, df)
    for k in (150, 180, 210):
        truncated = _signals(stype, {}, df.iloc[: k + 1])
        assert truncated.iloc[-1] == full.iloc[k], f"{stype}: lookahead en k={k}"


def test_ichimoku_signal_independent_of_future_candles():
    """Refuerzo explícito Ichimoku: alterar velas posteriores a N no toca la señal en N."""
    df = _wave(220)
    full = _signals("ichimoku", {}, df)
    k = 170
    tampered = df.copy()
    tampered.loc[k + 1:, ["open", "high", "low", "close"]] *= 1.5  # destroza el futuro
    after = _signals("ichimoku", {}, tampered)
    assert (after.iloc[: k + 1].to_numpy() == full.iloc[: k + 1].to_numpy()).all()


# --------------------------------------------------------------------------- #
# Cada tipo nuevo pasa por el optimizador anti-overfit (in/out + vecinos)
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("stype", NEW_TYPES)
def test_new_type_runs_through_optimizer(stype):
    df = _wave(460)
    candles = df.to_dict("records")
    res = optimize(stype, {}, candles, symbol="EURUSD", timeframe="H1",
                   risk={"sl_pips": 20, "tp_pips": 40})
    assert res["combinations"] >= 1
    assert res["in_sample"]["candles"] > res["out_sample"]["candles"]
    for r in res["results"]:
        assert r["verdict"] in {"inside", "edge", "outside"}
        assert 0 <= r["stars"] <= 4
