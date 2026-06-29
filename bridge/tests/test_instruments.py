"""Tests del perfil de instrumento (Fase 5): clasificación por path, pip_value real
por tipo, regresión (forex/oro idénticos al default) y anti-piso en índices.

Los valores de tick/contrato son los REALES verificados en XM en vivo."""

from __future__ import annotations

import numpy as np

from app.instruments import build_profile, classify_instrument, FOREX, METAL, INDEX, ENERGY
from app.backtest import run_backtest


def _profile(symbol, path, point, spread, tv, ts, vmin, vstep, contract):
    return build_profile(symbol=symbol, path=path, point=point, spread=spread,
                         swap_long=0.0, swap_short=0.0, tick_value=tv, tick_size=ts,
                         contract_size=contract, volume_min=vmin, volume_step=vstep)


# --------------------------------------------------------------------------- #
# Clasificación por path
# --------------------------------------------------------------------------- #
def test_classify_by_path():
    assert classify_instrument("Forex\\Standard Ultra Low\\EURUSD#") == FOREX
    assert classify_instrument("Derivatives\\Cash Ultra Low\\Indices\\US500Cash#") == INDEX
    assert classify_instrument("Derivatives\\Cash Ultra Low\\Energies\\OILCash#") == ENERGY
    assert classify_instrument("Spot Metals\\GOLD#") == METAL
    assert classify_instrument("", "GOLD#") == METAL       # respaldo por nombre
    assert classify_instrument("", "USOIL") == ENERGY


# --------------------------------------------------------------------------- #
# pip_value REAL por tipo (valores reales de XM)
# --------------------------------------------------------------------------- #
def test_pip_value_forex_and_gold_equal_default_10():
    eur = _profile("EURUSD#", "Forex\\x", 1e-5, 11, 1.0, 1e-5, 0.01, 0.01, 100000.0)
    gold = _profile("GOLD#", "Spot Metals\\x", 0.01, 31, 1.0, 0.01, 0.01, 0.01, 100.0)
    assert eur["pip_value_per_lot"] == 10.0 and eur["volume_min"] == 0.01
    assert gold["pip_value_per_lot"] == 10.0 and gold["volume_min"] == 0.01
    assert eur["instrument_type"] == FOREX and gold["instrument_type"] == METAL


def test_pip_value_index_is_small_and_oil_is_ten():
    us500 = _profile("US500Cash#", "Derivatives\\Indices\\x", 0.01, 0, 0.01, 0.01, 0.1, 0.1, 1.0)
    oil = _profile("OILCash#", "Derivatives\\Energies\\x", 0.01, 0, 1.0, 0.01, 0.01, 0.01, 100.0)
    # US500: pip=0.1, tick_value 0.01/tick 0.01 → pip_value 0.1 (NO 10) y vol_min 0.1.
    assert us500["pip_value_per_lot"] == 0.1
    assert us500["volume_min"] == 0.1 and us500["volume_step"] == 0.1
    assert us500["instrument_type"] == INDEX
    # Crudo: contrato 100, tick_value 1.0 → pip_value 10 (= default), vol_min 0.01.
    assert oil["pip_value_per_lot"] == 10.0 and oil["volume_min"] == 0.01
    assert oil["instrument_type"] == ENERGY


def test_pip_value_falls_back_to_10_without_tick_data():
    p = _profile("XXXUSD", "Forex\\x", 1e-5, 0, None, None, None, None, None)
    assert p["pip_value_per_lot"] == 10.0 and p["volume_min"] == 0.01


# --------------------------------------------------------------------------- #
# Regresión: el perfil forex/oro reproduce EXACTAMENTE el camino por defecto
# --------------------------------------------------------------------------- #
def _wave(n=400, base=1.10, amp=0.02):
    t = np.arange(n)
    close = base + amp * np.sin(t / 12.0)
    return [{"time": 1_700_000_000 + i * 3600, "open": float(c), "high": float(c) + amp * 0.05,
             "low": float(c) - amp * 0.05, "close": float(c), "tick_volume": 100} for i, c in enumerate(close)]


def test_regression_profile_matches_default_for_forex():
    candles = _wave()
    risk = {"sl_pips": 20, "tp_pips": 40, "risk_percent": 1.0}
    base = run_backtest("ma_cross", {}, candles, symbol="EURUSD#", timeframe="H1",
                        risk=risk, config={"spread_pips": 0.5, "point": 1e-5})
    # Mismo spread/punto pero con los campos del perfil (pip_value 10, vol 0.01/0.01).
    prof = run_backtest("ma_cross", {}, candles, symbol="EURUSD#", timeframe="H1", risk=risk,
                        config={"spread_pips": 0.5, "point": 1e-5, "pip_value_per_lot": 10.0,
                                "volume_min": 0.01, "volume_step": 0.01})
    assert base["metrics"]["net_pnl"] == prof["metrics"]["net_pnl"]
    assert base["metrics"]["return_pct"] == prof["metrics"]["return_pct"]
    assert base["metrics"]["total_trades"] == prof["metrics"]["total_trades"]


# --------------------------------------------------------------------------- #
# Anti-piso: con el perfil de índice correcto, el riesgo% ESCALA el tamaño
# (no queda clavado en el lote mínimo).
# --------------------------------------------------------------------------- #
def _index_wave(n=400):
    t = np.arange(n)
    close = 5000 + 120 * np.sin(t / 12.0)
    return [{"time": 1_700_000_000 + i * 3600, "open": float(c), "high": float(c) + 6,
             "low": float(c) - 6, "close": float(c), "tick_volume": 100} for i, c in enumerate(close)]


def test_index_profile_risk_scales_size():
    candles = _index_wave()
    cfg = {"point": 0.01, "pip_value_per_lot": 0.1, "volume_min": 0.1, "volume_step": 0.1, "spread_pips": 0.0}
    lo = run_backtest("ma_cross", {}, candles, symbol="US500Cash#", timeframe="H1",
                      risk={"sl_pips": 50, "tp_pips": 100, "risk_percent": 0.5}, config=cfg)
    hi = run_backtest("ma_cross", {}, candles, symbol="US500Cash#", timeframe="H1",
                      risk={"sl_pips": 50, "tp_pips": 100, "risk_percent": 2.0}, config=cfg)
    # Si el tamaño escalara mal (clavado en el piso), ambos retornos serían iguales.
    assert lo["metrics"]["total_trades"] == hi["metrics"]["total_trades"]
    assert abs(hi["metrics"]["return_pct"]) > abs(lo["metrics"]["return_pct"]) * 1.5
