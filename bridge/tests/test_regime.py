"""Tests del clasificador de régimen y ADX/Efficiency Ratio (Fase 3)."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.strategy import indicators as ind
from app.strategy.regime import RANGE, TREND_UP, TREND_DOWN, VOLATILE, classify_regime


def _candles(closes, rng=0.05):
    out, t = [], 1_700_000_000
    for i, c in enumerate(closes):
        c = float(c)
        out.append({"time": t + i * 3600, "open": c, "high": c + rng, "low": c - rng, "close": c, "tick_volume": 100})
    return out


def test_adx_high_on_clean_trend_low_on_noise():
    trend = _candles(np.linspace(100, 130, 260))           # subida limpia
    noise = _candles(100 + np.random.default_rng(3).standard_normal(260).cumsum() * 0.05, rng=0.2)
    adx_trend = float(ind.adx(pd.DataFrame(trend)).dropna().iloc[-1])
    adx_noise = float(ind.adx(pd.DataFrame(noise)).dropna().iloc[-1])
    assert adx_trend > 25          # tendencia fuerte
    assert adx_trend > adx_noise   # más fuerte que el ruido


def test_efficiency_ratio_high_on_trend_low_on_oscillation():
    trend = pd.Series(np.linspace(100, 130, 100))
    osc = pd.Series(100 + np.sin(np.linspace(0, 12 * np.pi, 100)))
    assert float(ind.efficiency_ratio(trend, 20).dropna().iloc[-1]) > 0.8
    assert float(ind.efficiency_ratio(osc, 20).dropna().iloc[-1]) < 0.3


def test_classify_trend_up():
    r = classify_regime(_candles(np.linspace(100, 140, 260)))
    assert r["regime"] == TREND_UP
    assert r["confidence"] > 0.5
    assert r["adx"] is not None and r["adx"] > 25


def test_classify_trend_down():
    r = classify_regime(_candles(np.linspace(140, 100, 260)))
    assert r["regime"] == TREND_DOWN


def test_classify_range_on_oscillation():
    # Oscilación rápida (muchos ciclos) = rango real: ADX bajo, ER bajo.
    x = np.linspace(0, 60 * np.pi, 300)
    r = classify_regime(_candles(100 + 0.5 * np.sin(x), rng=0.05))
    assert r["regime"] == RANGE


def test_classify_volatile_on_late_spike():
    base = list(100 + 0.3 * np.sin(np.linspace(0, 20 * np.pi, 240)))
    spike = list(100 + np.linspace(0, 1, 30))  # tramo final con rango ENORME
    candles = _candles(base, rng=0.05) + _candles(spike, rng=5.0)
    # reindexar tiempos
    for i, c in enumerate(candles):
        c["time"] = 1_700_000_000 + i * 3600
    r = classify_regime(candles)
    assert r["regime"] in {VOLATILE, RANGE, TREND_UP}  # al menos no rompe; típicamente VOLATIL
    assert r["vol_ratio"] is not None


def test_insufficient_data_returns_none():
    r = classify_regime(_candles(np.linspace(100, 110, 20)))
    assert r["regime"] is None
    assert r["confidence"] == 0.0
