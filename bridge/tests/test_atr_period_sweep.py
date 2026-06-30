"""Tests del barrido del PERIODO ATR en el Explorador (mejora post-fase).

Verifica: distinto periodo ATR → clave de caché distinta (coexistencia, sin invalidar
la vieja de periodo 14); estimate cuenta ×len(periodos) en ATR; distinto periodo →
distinto resultado del motor; las filas del explorador llevan atr_period."""

from __future__ import annotations

import time

import numpy as np

from app.explore import estimate_configs
from app.explore.cache import ExploreCache, make_cache_key
from app.explore.engine import ExploreJob
from app.backtest import run_backtest


def _wave(n=420):
    t = np.arange(n)
    close = 1.10 + 0.02 * np.sin(t / 12.0)
    base = 1_700_000_000
    return [{"time": base + i * 3600, "open": float(c), "high": float(c) + 0.0015,
             "low": float(c) - 0.0015, "close": float(c), "tick_volume": 100} for i, c in enumerate(close)]


# --------------------------------------------------------------------------- #
# 1) Distinto periodo ATR → clave SHA-1 distinta (coexistencia con caché vieja)
# --------------------------------------------------------------------------- #
def test_atr_period_changes_cache_key():
    cfg = {"initial_balance": 10000.0, "sl_mode": "atr"}
    args = ("EURUSD#", "supertrend", "H1", {"period": 10, "multiplier": 3}, 2.0, 3.0, 1.0, cfg, "2025-01-01", "2026-01-01")
    k7 = make_cache_key(*args, sl_mode="atr", atr_period=7)
    k14 = make_cache_key(*args, sl_mode="atr", atr_period=14)
    k21 = make_cache_key(*args, sl_mode="atr", atr_period=21)
    assert len({k7, k14, k21}) == 3  # tres claves distintas → coexisten, no se pisan
    # En modo FIJO el periodo es irrelevante → misma clave (no infla la caché).
    kf7 = make_cache_key(*args, sl_mode="fixed", atr_period=7)
    kf21 = make_cache_key(*args, sl_mode="fixed", atr_period=21)
    assert kf7 == kf21


# --------------------------------------------------------------------------- #
# 2) estimate_configs cuenta el factor del periodo ATR (solo en modo ATR)
# --------------------------------------------------------------------------- #
def test_estimate_multiplies_by_atr_periods():
    base = dict(pairs=["EURUSD#"], types=["rsi"], timeframes=["H1"], sls=[2], tps=[3], risks=[1.0])
    one = estimate_configs(**base, atr_periods=[14], sl_mode="atr")
    three = estimate_configs(**base, atr_periods=[7, 14, 21], sl_mode="atr")
    assert three == one * 3
    # En modo fijo, los periodos NO multiplican.
    assert estimate_configs(**base, atr_periods=[7, 14, 21], sl_mode="fixed") == one


# --------------------------------------------------------------------------- #
# 3) Distinto periodo ATR → distinto resultado del motor (cambia los trades)
# --------------------------------------------------------------------------- #
def test_atr_period_changes_engine_result():
    candles = _wave(500)
    def run(ap):
        return run_backtest("supertrend", {"period": 10, "multiplier": 3}, candles, symbol="EURUSD#",
                            timeframe="H1", risk={"sl_pips": 2, "tp_pips": 3, "risk_percent": 1,
                                                  "sl_mode": "atr", "atr_period": ap})["metrics"]
    m7, m21 = run(7), run(21)
    # El periodo cambia el ATR → cambia SL/TP → cambian las métricas.
    assert (m7["max_drawdown_pct"], m7["return_pct"]) != (m21["max_drawdown_pct"], m21["return_pct"])


# --------------------------------------------------------------------------- #
# 4) El barrido produce filas con su atr_period (2 periodos → cada combo ×2)
# --------------------------------------------------------------------------- #
def test_sweep_rows_carry_atr_period(tmp_path):
    job = ExploreJob(cache=ExploreCache(tmp_path / "c.db"))
    req = {
        "pairs": ["EURUSD#"], "types": ["combined"], "timeframes": ["H1"],
        "date_from": "2025-01-01T00:00:00Z", "date_to": "2026-01-01T00:00:00Z",
        "sl_choices": [2.0], "tp_choices": [3.0], "risk_choices": [1.0],
        "sl_mode": "atr", "atr_periods": [7, 14], "use_cache": True,
        "sync": True, "inprocess": True, "workers": 1,
    }

    class FakeClient:
        def symbol_costs(self, s): return {"spread_pips": 0.5, "point": 0.00001}
        def candles(self, s, tf, date_from=None, date_to=None): return _wave(420)

    job.start(req, FakeClient())
    if job._thread is not None:
        job._thread.join(timeout=30)
    snap = job.snapshot(include_results=True)
    rows = snap["results"]
    periods = {r.get("atr_period") for r in rows}
    assert periods == {7, 14}                          # ambos periodos presentes en las filas
    assert all(r.get("atr_period") in (7, 14) for r in rows)
    # Cada combinación del grid aparece una vez por periodo.
    from app.explore.engine import grid_size
    assert len(rows) == grid_size("combined") * 2
