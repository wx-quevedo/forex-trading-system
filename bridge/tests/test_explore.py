"""Tests del buscador de estrategias (Fase 8E) — sin MT5: cliente y velas falsos."""

from __future__ import annotations

import time
from datetime import datetime, timezone

import numpy as np

from app.explore import estimate_configs, grid_size
from app.explore.engine import ExploreJob


def _wave_candles(n=420):
    rng = np.random.default_rng(11)
    t = np.arange(n)
    close = 1.10 + 0.02 * np.sin(t / 12.0) + 0.002 * rng.standard_normal(n).cumsum() / 10
    base = 1_700_000_000
    return [
        {"time": base + i * 3600, "open": float(c), "high": float(c) + 0.001,
         "low": float(c) - 0.001, "close": float(c), "tick_volume": 100}
        for i, c in enumerate(close)
    ]


class FakeClient:
    def __init__(self, candles):
        self._candles = candles
        self.candle_calls = 0

    def symbol_costs(self, symbol):
        return {"spread_pips": 0.5, "swap_long_pts": -2.0, "swap_short_pts": -1.0, "point": 0.00001}

    def candles(self, symbol, tf, date_from=None, date_to=None):
        self.candle_calls += 1
        return list(self._candles)


def _run_job(job, req, client, timeout=30.0):
    job.start(req, client)
    t0 = time.time()
    while job.is_running() and time.time() - t0 < timeout:
        time.sleep(0.05)
    return job.snapshot(include_results=True)


def _req(**over):
    base = {
        "pairs": ["EURUSD#"],
        "types": ["ma_cross"],
        "timeframes": ["H1"],
        "date_from": datetime(2024, 1, 1, tzinfo=timezone.utc),
        "date_to": datetime(2024, 3, 1, tzinfo=timezone.utc),
        "capital": 5000.0,
        "sl_choices": [20],
        "tp_choices": [40],
        "risk_choices": [1.0],
    }
    base.update(over)
    return base


def test_estimate_configs_math():
    # 2 pares × 2 tf × 1 sl × 1 tp × 1 riesgo × grid(ma_cross)
    expected = 2 * 2 * 1 * 1 * 1 * grid_size("ma_cross")
    got = estimate_configs(["A", "B"], ["ma_cross"], ["H1", "H4"], [20], [40], [1.0])
    assert got == expected
    assert grid_size("ma_cross") > 0


def test_search_produces_report_rows():
    client = FakeClient(_wave_candles(440))
    job = ExploreJob()
    snap = _run_job(job, _req(), client)
    assert snap["status"] == "done"
    assert snap["done"] == snap["total"] == grid_size("ma_cross")
    assert snap["results_count"] >= 1
    for r in snap["results"]:
        for key in ("pair", "type", "timeframe", "params", "sl_pips", "tp_pips",
                    "risk_percent", "capital_final", "costs", "return_pct", "net_pnl",
                    "win_rate", "max_drawdown_pct", "total_trades", "in_return",
                    "out_return", "robustness", "stars", "verdict"):
            assert key in r, f"falta {key}"
        assert r["verdict"] in {"inside", "edge", "outside"}
        assert 0.0 <= r["win_rate"] <= 1.0  # fracción
        assert 0 <= r["stars"] <= 4
    # capital final coherente con capital inicial + pnl neto
    r0 = snap["results"][0]
    assert abs(r0["capital_final"] - (5000.0 + r0["net_pnl"])) < 0.5


def test_candles_fetched_once_per_pair_timeframe():
    """Eficiencia: una sola descarga de velas por (par, tf) aunque haya muchos grupos."""
    client = FakeClient(_wave_candles(440))
    job = ExploreJob()
    _run_job(job, _req(types=["ma_cross"], sl_choices=[20, 30], tp_choices=[40, 60], risk_choices=[1.0]), client)
    assert client.candle_calls == 1  # 1 par × 1 tf → 1 sola descarga reusada


def test_skips_groups_with_insufficient_candles():
    client = FakeClient(_wave_candles(80))  # < 120 → se salta, pero el progreso llega al total
    job = ExploreJob()
    snap = _run_job(job, _req(), client)
    assert snap["status"] == "done"
    assert snap["done"] == snap["total"]
    assert snap["results_count"] == 0
