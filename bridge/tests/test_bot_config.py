"""Blindaje del patrón "config que se guarda pero se pierde camino al ejecutor".

2º caso del bug (el 1º fue sl_mode): StartRequest no declaraba las protecciones de
cartera (portfolio_heat_pct/cb_max_losses/cb_max_drawdown_pct/news_filter/news_window_min)
→ Pydantic las descartaba en model_dump() → nunca llegaban al runner (quedaban en 0).
Este test verifica que TODA la config del bot sobrevive StartRequest y llega a new_run.
"""

from __future__ import annotations

from app.bot.state import new_run
from app.routers.bot import StartRequest


def test_startrequest_no_descarta_protecciones_de_cartera():
    payload = {
        "strategy_id": 1, "strategy_type": "macd", "symbol": "GOLD#", "timeframe": "H4",
        "portfolio_heat_pct": 6, "cb_max_losses": 4, "cb_max_drawdown_pct": 8,
        "news_filter": True, "news_window_min": 30,
    }
    d = StartRequest(**payload).model_dump()
    # 1) No se descartan en la frontera Pydantic.
    assert d["portfolio_heat_pct"] == 6
    assert d["cb_max_losses"] == 4
    assert d["cb_max_drawdown_pct"] == 8
    assert d["news_filter"] is True
    assert d["news_window_min"] == 30
    # 2) new_run los guarda en el run (llegan al runner que los consume).
    run = new_run(d, 770001)
    assert run["cb_max_losses"] == 4
    assert run["cb_max_drawdown_pct"] == 8
    assert run["news_filter"] is True
    assert run["news_window_min"] == 30


def test_toda_la_config_de_laravel_existe_en_startrequest():
    """Anti-regresión del patrón: cada campo que Laravel manda en botStart debe existir
    en StartRequest (si no, Pydantic lo descarta silenciosamente)."""
    laravel_fields = {
        "strategy_id", "bot_run_id", "strategy_type", "params", "symbol", "timeframe",
        "lot", "sl_pips", "tp_pips", "sl_mode", "atr_period", "risk_percent",
        "max_lot", "below_min", "arm_expiry_hours", "daily_loss_limit", "max_positions",
        "portfolio_heat_pct", "cb_max_losses", "cb_max_drawdown_pct", "news_filter", "news_window_min",
    }
    start_fields = set(StartRequest.model_fields.keys())
    faltan = laravel_fields - start_fields
    assert not faltan, f"StartRequest NO declara (se perderían): {faltan}"
