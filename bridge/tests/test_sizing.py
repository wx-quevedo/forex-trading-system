"""Fidelidad del módulo compartido sizing.py: el ejecutor en vivo y el backtest usan el
MISMO código → mismas distancias SL/TP y mismo lote por riesgo%. Aquí se prueba el módulo
en aislamiento Y que el backtest reproduce exactamente sus valores sobre las mismas velas.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.backtest.engine import run_backtest
from app.backtest.sizing import round_lot, size_for, sl_tp_distances, sl_tp_prices
from app.strategy.indicators import atr as atr_series
import pandas as pd


# --- Unit puro (valores calculados a mano) ---------------------------------
def test_distancias_fijo_y_atr():
    # Fijo: sl_param/tp_param son pips → distancia = pips × pip.
    assert sl_tp_distances("fixed", 20, 40, 0.0001) == (20 * 0.0001, 40 * 0.0001)
    # ATR: sl_param/tp_param son multiplicadores → distancia = N × ATR.
    assert sl_tp_distances("atr", 2.0, 3.0, 0.0001, atr_value=0.0015) == pytest.approx((0.003, 0.0045))


def test_atr_invalido_no_opera():
    # ATR NaN o ≤0 → None (el caller no abre), igual que el backtest.
    assert sl_tp_distances("atr", 2.0, 3.0, 0.0001, atr_value=float("nan")) is None
    assert sl_tp_distances("atr", 2.0, 3.0, 0.0001, atr_value=0.0) is None
    assert sl_tp_distances("atr", 2.0, 3.0, 0.0001, atr_value=None) is None


def test_precios_sl_tp_por_sentido():
    assert sl_tp_prices("buy", 1.1000, 0.0020, 0.0040) == (1.0980, 1.1040)
    assert sl_tp_prices("sell", 1.1000, 0.0020, 0.0040) == (1.1020, 1.0960)


def test_size_for_riesgo_pct_y_respaldo():
    # 1% de 10000 = 100$; dist 20 pips; pip_value 10$/lote → vol = 100/(20×10) = 0.5.
    vol = size_for(10000, 1.0, 1.1000, 1.0980, 0.0001, 10.0, 0.01, 0.01, 0.01)
    assert vol == 0.5
    # Sin riesgo% (0) → cae al lote por defecto.
    assert size_for(10000, 0.0, 1.1000, 1.0980, 0.0001, 10.0, 0.01, 0.01, 0.07) == 0.07
    # Sin SL → respaldo.
    assert size_for(10000, 1.0, 1.1000, None, 0.0001, 10.0, 0.01, 0.01, 0.03) == 0.03


def test_round_lot_escalon_y_piso():
    assert round_lot(0.527, 0.01, 0.01) == 0.53
    assert round_lot(0.004, 0.01, 0.01) == 0.01  # piso


# --- Integración: el backtest reproduce EXACTAMENTE el módulo -----------------
def _trend_candles(n=400):
    """Velas con tramos alcistas/bajistas marcados → garantizan cruces (ma_cross opera)."""
    base = 1_700_000_000
    seg = n // 4
    closes = np.concatenate([
        np.linspace(1.10, 1.16, seg), np.linspace(1.16, 1.08, seg),
        np.linspace(1.08, 1.18, seg), np.linspace(1.18, 1.10, n - 3 * seg),
    ])
    return [
        {"time": base + i * 3600, "open": float(c), "high": float(c) + 0.0005,
         "low": float(c) - 0.0005, "close": float(c), "tick_volume": 100}
        for i, c in enumerate(closes)
    ]


def test_backtest_reproduce_el_modulo_atr_y_riesgo():
    """La 1ª operación del backtest (modo ATR + riesgo%) debe tener el SL y el lote
    EXACTOS que el módulo compartido recomputa con las mismas entradas."""
    candles = _trend_candles()
    cfg = {"initial_balance": 10000.0, "pip_value_per_lot": 10.0, "point": 0.0001,
           "volume_min": 0.01, "volume_step": 0.01, "default_volume": 0.01}
    risk = {"sl_mode": "atr", "atr_period": 14, "sl_pips": 2.0, "tp_pips": 3.0, "risk_percent": 1.0}
    bt = run_backtest("ma_cross", {"fast": 5, "slow": 20}, candles,
                      symbol="EURUSD#", timeframe="H1", risk=risk, config=cfg)
    trades = bt["trades"]
    assert len(trades) > 0, "el escenario debe producir operaciones"

    df = pd.DataFrame(candles).sort_values("time").reset_index(drop=True)
    pip = 0.0001 * 10  # pip = 10 puntos (como en el motor)
    atr_ser = atr_series(df, 14)
    times = df["time"].to_numpy()

    t = trades[0]
    idx = int((times == t["entry_time"]).argmax())
    atr_at = float(atr_ser.iloc[idx])
    # El backtest calcula el SL desde el CIERRE CRUDO de la vela (luego redondea a 6);
    # recomputamos desde el mismo cierre crudo para comparar fielmente.
    entry_raw = float(df["close"].iloc[idx])
    dists = sl_tp_distances("atr", 2.0, 3.0, pip, atr_at)
    assert dists is not None
    sl2, _tp2 = sl_tp_prices(t["direction"], entry_raw, dists[0], dists[1])
    vol2 = size_for(10000.0, 1.0, entry_raw, sl2, pip, 10.0, 0.01, 0.01, 0.01)

    assert round(sl2, 6) == t["sl"], f"SL difiere: módulo {sl2} vs backtest {t['sl']}"
    assert vol2 == t["volume"], f"lote difiere: módulo {vol2} vs backtest {t['volume']}"
