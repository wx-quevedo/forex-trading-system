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
        "workers": 1,
        "inprocess": True,  # tests: cómputo en el hilo, sin spawnear procesos
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


def _row_key(r):
    return (r["pair"], r["type"], r["timeframe"], r["sl_pips"], r["tp_pips"],
            r["risk_percent"], tuple(sorted(r["params"].items())))


def test_parallel_path_matches_sequential(monkeypatch):
    """El camino paralelo (orquestación) produce EXACTAMENTE los mismos resultados
    que el secuencial. Se inyecta un executor síncrono para no spawnear procesos
    dentro de pytest (la lógica de agregado/progreso es la que se valida)."""
    import app.explore.engine as eng

    class _SyncFuture:
        def __init__(self, fn, *a):
            self._fn, self._a = fn, a
        def result(self):
            return self._fn(*self._a)

    class _SyncExecutor:
        def __init__(self, max_workers=None):
            pass
        def submit(self, fn, *a):
            return _SyncFuture(fn, *a)
        def shutdown(self, **k):
            pass

    candles = _wave_candles(440)
    req = _req(sl_choices=[20, 30], tp_choices=[40, 60], risk_choices=[1.0])

    seq = _run_job(ExploreJob(), {**req, "workers": 1, "inprocess": True}, FakeClient(candles))

    # Camino paralelo (orquestación real) con executor síncrono inyectado.
    monkeypatch.setattr(eng, "ProcessPoolExecutor", _SyncExecutor)
    monkeypatch.setattr(eng, "as_completed", lambda fs: list(fs))
    par = _run_job(ExploreJob(), {**req, "workers": 8, "inprocess": False}, FakeClient(candles))

    assert par["status"] == "done"
    assert par["done"] == seq["done"] == par["total"]
    assert par["workers"] == 8
    # Mismos resultados (orden puede variar → comparar como conjunto por clave de config).
    seq_map = {_row_key(r): r for r in seq["results"]}
    par_map = {_row_key(r): r for r in par["results"]}
    assert seq_map.keys() == par_map.keys()
    for k, r in seq_map.items():
        assert r["return_pct"] == par_map[k]["return_pct"]
        assert r["robustness"] == par_map[k]["robustness"]
        assert r["verdict"] == par_map[k]["verdict"]


def test_snapshot_reports_speed_and_workers():
    client = FakeClient(_wave_candles(440))
    snap = _run_job(ExploreJob(), _req(), client)
    assert snap["workers"] == 1
    assert snap["candle_fetches"] == 1
    assert snap["elapsed_seconds"] >= 0
    assert snap["t_compute_seconds"] >= 0
    assert "speed_per_sec" in snap and "eta_seconds" in snap
