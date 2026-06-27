"""Tests del buscador de estrategias (Fase 8E) — sin MT5: cliente y velas falsos."""

from __future__ import annotations

import time
from datetime import datetime, timezone

import numpy as np
import pytest

from app.explore import estimate_configs, grid_size
from app.explore.cache import ExploreCache, make_cache_key
from app.explore.engine import STALE_SECONDS, ExploreJob


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
        "inprocess": True,   # tests: cómputo en el hilo, sin spawnear procesos
        "use_cache": False,  # tests aislados de la caché compartida (salvo los de caché)
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


def test_orphan_job_auto_releases_and_allows_new_search():
    """Un job marcado 'running' pero sin latido reciente (huérfano) NO bloquea: se
    considera muerto y una nueva búsqueda puede arrancar (lo supera)."""
    job = ExploreJob()
    with job._lock:  # simular huérfano: running sin latido
        job.status = "running"
        job._last_beat = time.monotonic() - (STALE_SECONDS + 30)
    assert job.is_stale()
    assert not job.is_running()
    assert job.snapshot()["stale"] is True
    # Una búsqueda nueva arranca pese al huérfano previo.
    snap = _run_job(job, _req(), FakeClient(_wave_candles(440)))
    assert snap["status"] == "done"
    assert snap["stale"] is False


def test_fresh_running_job_blocks_new_search():
    """Un job VIVO (con latido reciente) sí bloquea una nueva búsqueda."""
    job = ExploreJob()
    with job._lock:
        job.status = "running"
        job._last_beat = time.monotonic()
    assert job.is_running()
    with pytest.raises(RuntimeError):
        job.start(_req(), FakeClient(_wave_candles(200)))


def test_force_reset_clears_state():
    job = ExploreJob()
    with job._lock:
        job.status = "running"
        job._last_beat = time.monotonic()
    snap = job.force_reset()
    assert snap["status"] == "idle"
    assert not job.is_running()


def test_explorer_path_applies_risk_percent():
    """En el PATH del Explorador (no el motor aislado), con capital suficiente, una
    misma combinación con riesgo 0.5 vs 2.0 da resultados DISTINTOS (sizing por riesgo).
    Capital alto para no toparse con el lote mínimo (0.01)."""
    client = FakeClient(_wave_candles(500))
    snap = _run_job(ExploreJob(), _req(capital=100000.0, risk_choices=[0.5, 2.0]), client)
    assert snap["status"] == "done"
    # Empareja por (params, sl, tp) las dos variantes de riesgo y compara su PnL.
    by_combo: dict = {}
    for r in snap["results"]:
        k = (tuple(sorted(r["params"].items())), r["sl_pips"], r["tp_pips"])
        by_combo.setdefault(k, {})[r["risk_percent"]] = r
    compared = 0
    for variants in by_combo.values():
        if 0.5 in variants and 2.0 in variants and variants[0.5]["total_trades"] > 0:
            lo, hi = variants[0.5], variants[2.0]
            assert lo["net_pnl"] != hi["net_pnl"], "el riesgo% no afectó el PnL en el path del Explorador"
            compared += 1
    assert compared > 0, "no hubo combinaciones con trades para comparar"


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


def test_cache_key_sensitive_to_all_factors():
    base = dict(
        symbol="EURUSD#", stype="rsi", tf="H1",
        params={"period": 14, "oversold": 30, "overbought": 70},
        sl=20, tp=40, rp=1.0,
        cfg={"initial_balance": 10000, "spread_pips": 0.5, "commission_per_lot": 0,
             "swap_long_pts": 0, "swap_short_pts": 0, "point": 1e-5},
        date_from="2025-01-01", date_to="2025-06-01",
    )
    k0 = make_cache_key(**base)
    assert k0 == make_cache_key(**base)  # determinista

    def changed(**over):
        d = dict(base); d.update(over); return make_cache_key(**d)

    assert changed(symbol="GBPUSD#") != k0
    assert changed(stype="macd") != k0
    assert changed(tf="H4") != k0
    assert changed(params={"period": 7, "oversold": 30, "overbought": 70}) != k0
    assert changed(sl=30) != k0
    assert changed(tp=60) != k0
    assert changed(rp=2.0) != k0
    assert changed(cfg={**base["cfg"], "initial_balance": 5000}) != k0
    assert changed(cfg={**base["cfg"], "spread_pips": 1.0}) != k0
    assert changed(date_to="2025-07-01") != k0


def test_cache_hit_skips_recompute(tmp_path):
    cache = ExploreCache(str(tmp_path / "c.db"))
    candles = _wave_candles(440)
    req = _req(use_cache=True)

    # 1ª corrida: todo se calcula y se guarda.
    s1 = _run_job(ExploreJob(cache=cache), req, FakeClient(candles))
    assert s1["status"] == "done"
    assert s1["cache_misses"] == s1["total"]
    assert s1["cache_hits"] == 0

    # 2ª corrida idéntica: TODO viene de caché (0 cálculos).
    s2 = _run_job(ExploreJob(cache=cache), req, FakeClient(candles))
    assert s2["status"] == "done"
    assert s2["cache_hits"] == s2["total"]
    assert s2["cache_misses"] == 0

    # Resultados equivalentes (caché vs cálculo).
    key = lambda r: (tuple(sorted(r["params"].items())), r["sl_pips"], r["tp_pips"], r["risk_percent"])
    m1 = {key(r): r for r in s1["results"]}
    m2 = {key(r): r for r in s2["results"]}
    assert m1.keys() == m2.keys()
    for k in m1:
        assert m1[k]["return_pct"] == m2[k]["return_pct"]
        assert m1[k]["verdict"] == m2[k]["verdict"]
        assert m1[k]["robustness"] == m2[k]["robustness"]


def test_cache_clear_and_stats(tmp_path):
    cache = ExploreCache(str(tmp_path / "c.db"))
    _run_job(ExploreJob(cache=cache), _req(use_cache=True), FakeClient(_wave_candles(440)))
    assert cache.stats()["entries"] > 0
    cache.clear()
    assert cache.stats()["entries"] == 0
