"""Tests de la señal 'close' (Lote 0, intake externas) + estrategias del Lote 1.

Garantías:
1. Semántica de 'close': cierra a PLANO sin abrir la contraria; en plano es no-op.
2. Backward-compat: NINGUNA estrategia previa emite 'close' (identidad garantizada:
   el nuevo elif del engine es código muerto para ellas).
3. Lote 1 cableado: registry/schemas resuelven defaults; connors e ibs-longflat
   emiten 'close'; ibs-symmetric no (reversión pura); tsm emite flips.
"""

import numpy as np
import pandas as pd

from app.backtest import engine as bt_engine
from app.backtest.engine import run_backtest
from app.strategy.strategies import STRATEGY_SCHEMAS, build_strategy, signal_series

OLD_TYPES = ["ma_cross", "rsi", "macd", "bollinger", "combined",
             "supertrend", "ichimoku", "donchian", "stochastic", "cci", "psar"]
NEW_TYPES = ["tsm", "tsm_vol", "ibs", "connors"]


def _flat_candles(n=40, price=100.0):
    base = 1_700_000_000
    return [{"time": base + i * 3600, "open": price, "high": price + 0.5,
             "low": price - 0.5, "close": price, "tick_volume": 100} for i in range(n)]


def _wave_candles(n=400):
    """Onda + ruido con MECHAS ALEATORIAS: el cierre cae en posiciones variadas del
    rango de la vela (imprescindible para que IBS recorra [0,1] — con mechas fijas
    IBS sería 0.5 constante y las aserciones de ibs no probarían nada)."""
    rng = np.random.default_rng(11)
    t = np.arange(n)
    close = 100.0 + 8.0 * np.sin(t / 15.0) + rng.standard_normal(n).cumsum() * 0.3
    up_wick = rng.uniform(0.0, 1.2, n)
    dn_wick = rng.uniform(0.0, 1.2, n)
    base = 1_700_000_000
    out = []
    prev = float(max(close[0], 1.0))
    for i, c in enumerate(close):
        c = float(max(c, 1.0))
        o = prev
        out.append({"time": base + i * 3600, "open": o,
                    "high": max(o, c) + float(up_wick[i]),
                    "low": min(o, c) - float(dn_wick[i]),
                    "close": c, "tick_volume": 100})
        prev = c
    return out


def test_close_cierra_a_plano_sin_abrir_contraria(monkeypatch):
    candles = _flat_candles(40)

    def stub(strategy, df):
        s = pd.Series("none", index=df.index, dtype=object)
        s.iloc[10] = "buy"
        s.iloc[15] = "close"   # cierra el largo → PLANO (no short)
        s.iloc[20] = "close"   # en plano: no-op
        s.iloc[25] = "sell"
        s.iloc[30] = "close"   # cierra el corto
        return s

    monkeypatch.setattr(bt_engine, "signal_series", stub)
    res = run_backtest("ma_cross", {}, candles, symbol="TEST", timeframe="H1", risk={})

    trades = res["trades"]
    assert len(trades) == 2, "close en plano no debe generar trade ni abrir contraria"
    t0, t1 = trades
    assert t0["direction"] == "buy"
    assert t0["exit_time"] == candles[15]["time"]
    assert t0["exit_reason"] == "signal"
    # Entre la vela 15 y la 25 NO hay posición (close NO abrió la contraria).
    assert t1["direction"] == "sell"
    assert t1["entry_time"] == candles[25]["time"]
    assert t1["exit_time"] == candles[30]["time"]


def test_estrategias_previas_jamas_emiten_close():
    candles = _wave_candles(400)
    df = pd.DataFrame(candles)
    for t in OLD_TYPES:
        s = signal_series(build_strategy(t), df)
        assert set(s.unique()) <= {"none", "buy", "sell"}, f"{t} emitió 'close': rompe identidad"


def test_lote1_registrado_con_defaults():
    assert build_strategy("tsm").lookback == 90
    assert build_strategy("tsm_vol").k == 1.5
    assert build_strategy("ibs").mode == "symmetric"
    assert build_strategy("connors").rsi_period == 2
    for t in NEW_TYPES:
        assert t in STRATEGY_SCHEMAS and STRATEGY_SCHEMAS[t]["fields"]


def test_lote1_semantica_de_seniales():
    df = pd.DataFrame(_wave_candles(400))

    # tsm: la onda produce flips de signo en ambos sentidos.
    s = signal_series(build_strategy("tsm", {"lookback": 30}), df)
    assert "buy" in set(s) and "sell" in set(s) and "close" not in set(s)

    # connors: RSI(2) cruza 50 constantemente → emite 'close' además de entradas.
    s = signal_series(build_strategy("connors", {"trend_period": 20}), df)
    assert "close" in set(s)

    # ibs symmetric: reversión pura (sell en IBS alto, jamás 'close').
    s = signal_series(build_strategy("ibs", {"mode": "symmetric"}), df)
    assert "close" not in set(s) and "sell" in set(s)

    # ibs long-flat: IBS alto = salir a plano → 'close' presente y 'sell' ausente.
    s = signal_series(build_strategy("ibs", {"mode": "longflat"}), df)
    assert "close" in set(s) and "sell" not in set(s)


def test_tsm_vol_veta_menos_o_igual_que_tsm():
    df = pd.DataFrame(_wave_candles(400))
    base = signal_series(build_strategy("tsm", {"lookback": 30}), df)
    vetoed = signal_series(build_strategy("tsm_vol", {"lookback": 30, "k": 0.9}), df)
    n_base = int((base != "none").sum())
    n_veto = int((vetoed != "none").sum())
    assert n_veto <= n_base, "el veto de volatilidad solo puede QUITAR señales"
