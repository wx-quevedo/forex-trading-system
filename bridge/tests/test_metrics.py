"""Tests de las métricas de riesgo profesionales (Fase 2): Calmar, expectativa
(monetaria y en R), Sharpe — contra casos conocidos y división por cero."""

from __future__ import annotations

from app.backtest.engine import _compute_metrics
from app.explore.engine import expectancy_r


def _eq(values):
    return [{"equity": float(v)} for v in values]


def _trades(pnls, t0=1_700_000_000):
    return [{"pnl": float(p), "pnl_gross": float(p), "exit_time": t0 + i * 3600}
            for i, p in enumerate(pnls)]


def test_calmar_value_and_sign_positive():
    # return 10% (net 100 sobre 1000), maxDD -5% (1100→1045), H1 (8760 barras/año),
    # 4 puntos de equity → calmar = (10 × 8760/4) / 5 = 4380.
    m = _compute_metrics(_trades([100]), _eq([1000, 1100, 1045, 1100]), 1000, "H1")
    assert m["max_drawdown_pct"] == -5.0
    assert m["return_pct"] == 10.0
    assert m["calmar"] == round(10.0 * 8760 / 4 / 5.0, 3) == 4380.0
    assert m["calmar"] > 0


def test_calmar_none_when_no_drawdown():
    # Equity monótona creciente → DD = 0 → calmar None (división por cero evitada).
    m = _compute_metrics(_trades([50]), _eq([1000, 1010, 1020, 1050]), 1000, "H1")
    assert m["max_drawdown_pct"] == 0.0
    assert m["calmar"] is None


def test_calmar_negative_on_losing():
    m = _compute_metrics(_trades([-100]), _eq([1000, 1000, 950, 900]), 1000, "H1")
    assert m["return_pct"] < 0
    assert m["calmar"] is not None and m["calmar"] < 0


def test_expectancy_monetary_is_avg_pnl():
    # PnL medio por trade: (10 - 5 + 15) / 3 = 6.67.
    m = _compute_metrics(_trades([10, -5, 15]), _eq([1000, 1010, 1005, 1020]), 1000, "H1")
    assert m["expectancy"] == round(20 / 3, 2) == 6.67


def test_sharpe_positive_on_rising_equity():
    m = _compute_metrics(_trades([5, 5, 5, 5]), _eq([1000, 1005, 1010, 1015, 1020]), 1000, "H1")
    assert m["sharpe"] > 0
    assert m["sortino"] >= 0  # sin tramos negativos, sortino 0 o positivo


def test_expectancy_r_usdcad_positive_despite_bad_rr():
    # Caso USDCAD: win 60%, SL50/TP40 (R/R 0.8 < 1) → +0.08 R (positiva).
    assert expectancy_r(0.6, 50, 40) == 0.08
    # R/R favorable: win 60%, R/R 2 → +0.8 R.
    assert expectancy_r(0.6, 50, 100) == 0.8
    # Win bajo con R/R desfavorable → negativa.
    assert expectancy_r(0.4, 50, 40) < 0


def test_expectancy_r_none_when_sl_zero():
    assert expectancy_r(0.6, 0, 40) is None
