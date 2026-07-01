"""compute_order: núcleo de decisión del ejecutor (= preview). Fidelidad del lote por
riesgo% y SL/TP, y las guardas de seguridad (stops_level, tope de volumen, piso mínimo).
Funciones puras → se prueban sin MT5.
"""

from __future__ import annotations

from app.backtest.sizing import size_for
from app.bot.order import compute_order

# Perfil tipo oro: pip 0.1 (point 0.01 ×10), 1$/pip/lote, lote 0.01/0.01.
GOLD = {"pip": 0.1, "pip_value_per_lot": 1.0, "volume_min": 0.01, "volume_step": 0.01, "point": 0.01}


def _run(**over):
    base = {"sl_mode": "atr", "atr_period": 14, "sl_pips": 2.0, "tp_pips": 3.0,
            "risk_percent": 1.0, "lot": 0.01, "max_lot": 0.0, "below_min": "skip"}
    base.update(over)
    return base


def test_atr_riesgo_pct_abre_con_lote_fiel():
    o = compute_order(_run(), "buy", 2000.0, 10.0, 10000.0, GOLD, digits=2, stops_level=0, volume_max=100.0)
    assert o["ok"] is True
    # SL = entry - N×ATR = 2000 - 2×10 = 1980; TP = 2000 + 3×10 = 2030.
    assert o["sl"] == 1980.0 and o["tp"] == 2030.0
    assert o["sl_dist_pips"] == 200.0
    # Lote = el MISMO que size_for (fidelidad con el backtest).
    expected = size_for(10000.0, 1.0, 2000.0, 1980.0, 0.1, 1.0, 0.01, 0.01, 0.01)
    assert o["volume"] == expected == 0.5


def test_fixed_tambien_dimensiona_por_riesgo_pct():
    fx = {"pip": 0.0001, "pip_value_per_lot": 10.0, "volume_min": 0.01, "volume_step": 0.01, "point": 0.00001}
    o = compute_order(_run(sl_mode="fixed", sl_pips=20, tp_pips=40), "buy", 1.1000, None, 10000.0, fx,
                      digits=5, stops_level=0, volume_max=100.0)
    assert o["ok"] is True
    # 1% de 10000 = 100$; 20 pips × 10$/pip = 200 → 0.5 lotes.
    assert o["volume"] == 0.5
    assert o["sl"] == 1.098 and o["tp"] == 1.104


def test_guarda_stops_level_no_abre():
    # stops_level 5000 puntos × 0.01 = 50 de distancia mínima > 20 del SL → no abrir.
    o = compute_order(_run(), "buy", 2000.0, 10.0, 10000.0, GOLD, digits=2, stops_level=5000, volume_max=100.0)
    assert o["ok"] is False
    assert "mínima del bróker" in o["reason"]
    assert o["sl_ok"] is False


def test_guarda_volume_max_broker_no_abre():
    o = compute_order(_run(), "buy", 2000.0, 10.0, 10000.0, GOLD, digits=2, stops_level=0, volume_max=0.1)
    assert o["ok"] is False and "tope" in o["reason"]


def test_guarda_max_lot_configurable_no_abre():
    o = compute_order(_run(max_lot=0.2), "buy", 2000.0, 10.0, 10000.0, GOLD, digits=2, stops_level=0, volume_max=100.0)
    assert o["ok"] is False and "tope" in o["reason"]
    assert o["volume_cap"] == 0.2


def test_below_min_skip_no_abre_con_razon():
    # balance chico + riesgo% chico → el riesgo% pide < lote mínimo → no abrir (skip).
    o = compute_order(_run(risk_percent=0.1), "buy", 2000.0, 10.0, 100.0, GOLD, digits=2, stops_level=0, volume_max=100.0)
    assert o["ok"] is False
    assert "lote mínimo" in o["reason"]
    assert o.get("risk_below_min") is True


def test_below_min_floor_abre_minimo_con_aviso():
    o = compute_order(_run(risk_percent=0.1, below_min="floor"), "buy", 2000.0, 10.0, 100.0, GOLD,
                      digits=2, stops_level=0, volume_max=100.0)
    assert o["ok"] is True
    assert o["volume"] == 0.01  # lote mínimo
    assert o["warn"] and "mínimo" in o["warn"]


def test_atr_invalido_no_abre():
    o = compute_order(_run(), "buy", 2000.0, float("nan"), 10000.0, GOLD, digits=2, stops_level=0, volume_max=100.0)
    assert o["ok"] is False and "ATR" in o["reason"]


def test_risk_usd_refleja_el_riesgo_real_con_redondeo():
    # GOLD pip_value 10, SL 20 pips → 200 en precio; lote 0.02 redondeado desde 0.0166.
    # riesgo$ = dist_pips × pip_value × lote = (20/... ) — se valida el $ y el % real > nominal.
    prof = {"pip": 0.1, "pip_value_per_lot": 10.0, "volume_min": 0.01, "volume_step": 0.01, "point": 0.01}
    o = compute_order(_run(risk_percent=1.0, sl_pips=1.5, tp_pips=4.0), "sell", 4031.68, 39.22, 9781.0, prof, digits=2, stops_level=0, volume_max=100.0)
    assert o["ok"] is True and o["volume"] == 0.02
    # SL dist = 1.5×39.22 = 58.83 → 588.3 pips; riesgo$ = 588.3 × 10 × 0.02 = 117.66.
    assert o["risk_usd"] == 117.66
    assert o["risk_pct_actual"] > 1.0  # ~1.2%: el redondeo del lote sube el riesgo real
