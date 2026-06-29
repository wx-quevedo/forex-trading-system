"""Tests del score de PRIORIDAD. Caso clave: la ma_cross que falló en walk-forward
(Sharpe alto pero win 39%, exp +0.19, DD −30%) DEBE quedar penalizada (<40, fuera de
cabeza) frente a una candidata equilibrada."""

from __future__ import annotations

from app.explore.scoring import priority_score, expectancy_r

PERIOD = 540  # ~18 meses


_FAILED_MACROSS = {  # el caso real que colapsó (+74% engañoso)
    "type": "ma_cross", "return_pct": 74.0, "in_return": 74.0, "out_return": 62.0,
    "win_rate": 0.39, "max_drawdown_pct": -30.0, "sharpe": 2.12, "sortino": 2.5,
    "total_trades": 120, "expectancy_r": 0.19, "regime": "RANGO",  # trend strat en rango → MISMATCH
}

_BALANCED = {  # candidata equilibrada con margen de seguridad
    "type": "supertrend", "return_pct": 20.0, "in_return": 15.5, "out_return": 18.1,
    "win_rate": 0.58, "max_drawdown_pct": -15.0, "sharpe": 1.5, "sortino": 2.0,
    "total_trades": 142, "expectancy_r": 0.30, "regime": "TENDENCIA_ALCISTA",  # MATCH
}


def test_failed_macross_is_penalized():
    r = priority_score(_FAILED_MACROSS, PERIOD)
    assert r["score"] < 40, f"debería estar penalizada, score={r['score']}"
    # El drawdown −30% debe aparecer entre las penalizaciones fuertes.
    assert any("Drawdown" in s["label"] for s in r["breakdown"]["sub"])
    assert "frágil" in r["verdict"].lower()


def test_balanced_ranks_clearly_higher():
    failed = priority_score(_FAILED_MACROSS, PERIOD)["score"]
    bal = priority_score(_BALANCED, PERIOD)
    assert bal["score"] >= 60
    assert bal["score"] > failed + 25  # la equilibrada va MUY por encima
    assert any("Consistencia" in a["label"] for a in bal["breakdown"]["add"])


def test_drawdown_penalty_is_nonlinear():
    base = {"type": "rsi", "in_return": 10, "out_return": 10, "win_rate": 0.5,
            "sharpe": 1.0, "sortino": 1.0, "total_trades": 100, "expectancy_r": 0.2,
            "return_pct": 10, "regime": "RANGO"}
    s15 = priority_score({**base, "max_drawdown_pct": -15.0}, PERIOD)["score"]
    s30 = priority_score({**base, "max_drawdown_pct": -30.0}, PERIOD)["score"]
    # Doblar el DD castiga MUCHO más que el doble (no lineal).
    pen15 = next(x["points"] for x in priority_score({**base, "max_drawdown_pct": -15.0}, PERIOD)["breakdown"]["sub"] if x["label"] == "Drawdown")
    pen30 = next(x["points"] for x in priority_score({**base, "max_drawdown_pct": -30.0}, PERIOD)["breakdown"]["sub"] if x["label"] == "Drawdown")
    assert pen30 >= pen15 * 3
    assert s30 < s15


def test_few_trades_penalized():
    r = priority_score({"type": "rsi", "in_return": 12, "out_return": 11, "win_rate": 0.6,
                        "sharpe": 1.5, "sortino": 2.0, "total_trades": 12, "expectancy_r": 0.3,
                        "return_pct": 12, "max_drawdown_pct": -8.0, "regime": "RANGO"}, PERIOD)
    assert any("Pocas operaciones" in s["label"] for s in r["breakdown"]["sub"])


def test_blown_account_low_score():
    r = priority_score({"type": "rsi", "in_return": -100, "out_return": -100, "win_rate": 0.3,
                        "sharpe": -1, "sortino": -1, "total_trades": 50, "expectancy_r": -0.2,
                        "return_pct": -100, "max_drawdown_pct": -100.0, "blown": True, "regime": "RANGO"}, PERIOD)
    assert r["score"] < 15


def test_expectancy_r_helper():
    assert expectancy_r(0.6, 50, 40) == 0.08  # caso USDCAD (R/R<1 pero positivo)
    assert expectancy_r(0.6, 0, 40) is None
