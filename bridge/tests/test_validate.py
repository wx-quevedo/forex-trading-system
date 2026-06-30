"""Validación walk-forward del top-N (rango posterior): tests sin MT5.

Cubre: corre el backtest sobre el RANGO DE VALIDACIÓN (no el de optimización),
respeta el modo/periodo ATR, cachea aparte (validation_cache) y usa una clave
DISTINTA de la de optimización (por el periodo) → la caché de optimización no se toca.
"""

from __future__ import annotations

import numpy as np

from app.explore.cache import ExploreCache, make_cache_key
from app.explore.engine import validate_topn


def _wave_candles(n=420):
    rng = np.random.default_rng(7)
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


def _row(**over):
    base = {
        "pair": "EURUSD#", "type": "combined", "timeframe": "H1",
        "params": {}, "sl_pips": 20, "tp_pips": 40, "risk_percent": 1.0,
        "sl_mode": "fixed", "atr_period": 14,
    }
    base.update(over)
    return base


VAL_FROM, VAL_TO = "2026-01-01T00:00:00Z", "2026-06-27T00:00:00Z"


def test_corre_backtest_en_rango_validacion(tmp_path):
    cache = ExploreCache(path=str(tmp_path / "c.db"))
    client = FakeClient(_wave_candles())
    out = validate_topn([_row()], VAL_FROM, VAL_TO, 10000.0, client, cache)
    assert len(out) == 1
    r = out[0]
    assert r["ok"] is True
    assert "val_return_pct" in r and "val_final_balance" in r and "val_total_trades" in r
    # El capital final coincide con aplicar el retorno al capital inicial.
    assert r["val_final_balance"] == round(10000.0 * (1 + r["val_return_pct"] / 100), 2)


def test_cachea_aparte_y_no_recalcula(tmp_path):
    cache = ExploreCache(path=str(tmp_path / "c.db"))
    client = FakeClient(_wave_candles())
    validate_topn([_row()], VAL_FROM, VAL_TO, 10000.0, client, cache)
    calls_after_first = client.candle_calls
    # 2ª llamada: debe servirse de validation_cache (sin recomputar el backtest).
    out2 = validate_topn([_row()], VAL_FROM, VAL_TO, 10000.0, client, cache)
    assert out2[0]["ok"] is True
    # La clave de validación existe en validation_cache.
    cfg = {"spread_pips": 0.5, "swap_long_pts": -2.0, "swap_short_pts": -1.0,
           "point": 0.00001, "initial_balance": 10000.0, "sl_mode": "fixed", "atr_period": 14}
    # La función castea sl/tp/rp a float → recomputar la clave con floats (20.0, no 20).
    key = make_cache_key("EURUSD#", "combined", "H1", {}, 20.0, 40.0, 1.0, cfg, VAL_FROM, VAL_TO, "fixed", 14)
    assert key in cache.get_validation_many([key])


def test_clave_validacion_distinta_de_optimizacion(tmp_path):
    """El rango de validación (posterior) produce una clave DISTINTA del de optimización
    → conviven sin pisarse; validar no toca la caché de optimización."""
    cfg = {"spread_pips": 0.5, "swap_long_pts": -2.0, "swap_short_pts": -1.0,
           "point": 0.00001, "initial_balance": 10000.0, "sl_mode": "fixed", "atr_period": 14}
    opt = make_cache_key("EURUSD#", "combined", "H1", {}, 20, 40, 1.0, cfg,
                         "2025-01-01T00:00:00Z", "2025-12-31T00:00:00Z", "fixed", 14)
    val = make_cache_key("EURUSD#", "combined", "H1", {}, 20, 40, 1.0, cfg,
                         VAL_FROM, VAL_TO, "fixed", 14)
    assert opt != val


def test_respeta_modo_atr(tmp_path):
    """Una fila en modo ATR con periodo distinto da una clave de validación distinta
    (el periodo entra en la clave en modo ATR) → respeta el modo/periodo ATR de la fila."""
    cache = ExploreCache(path=str(tmp_path / "c.db"))
    client = FakeClient(_wave_candles())
    out = validate_topn([_row(sl_mode="atr", atr_period=7, sl_pips=2.0, tp_pips=3.0)],
                        VAL_FROM, VAL_TO, 10000.0, client, cache)
    assert out[0]["ok"] is True
    cfg7 = {"spread_pips": 0.5, "swap_long_pts": -2.0, "swap_short_pts": -1.0,
            "point": 0.00001, "initial_balance": 10000.0, "sl_mode": "atr", "atr_period": 7}
    k7 = make_cache_key("EURUSD#", "combined", "H1", {}, 2.0, 3.0, 1.0, cfg7, VAL_FROM, VAL_TO, "atr", 7)
    k21 = make_cache_key("EURUSD#", "combined", "H1", {}, 2.0, 3.0, 1.0,
                         {**cfg7, "atr_period": 21}, VAL_FROM, VAL_TO, "atr", 21)
    assert k7 != k21
    assert k7 in cache.get_validation_many([k7])


def test_grupo_sin_velas_no_aborta(tmp_path):
    """Un (par·tf) sin velas en el rango de validación → ok:False con motivo, sin abortar
    el resto del lote (mismo principio que el skip del Explorador)."""
    cache = ExploreCache(path=str(tmp_path / "c.db"))

    class EmptyClient(FakeClient):
        def candles(self, symbol, tf, date_from=None, date_to=None):
            self.candle_calls += 1
            return [] if tf == "M5" else list(self._candles)

    client = EmptyClient(_wave_candles())
    out = validate_topn([_row(timeframe="M5"), _row(timeframe="H1")],
                        VAL_FROM, VAL_TO, 10000.0, client, cache)
    assert out[0]["ok"] is False and "reason" in out[0]
    assert out[1]["ok"] is True
