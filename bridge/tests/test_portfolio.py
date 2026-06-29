"""Tests de gestión de cartera y circuit breakers (Fase 7): correlación, riesgo de
posición / portfolio heat, disparo de breakers y el ciclo pausa→reanuda→reset."""

from __future__ import annotations

from app.bot.portfolio import (
    correlation_matrix,
    heat_would_exceed,
    pearson,
    portfolio_heat,
    position_risk,
    returns_from_equity,
)
from app.bot.guards import circuit_breaker_tripped
from app.bot.state import BotState, new_run


# --------------------------------------------------------------------------- #
# Correlación
# --------------------------------------------------------------------------- #
def test_pearson_known_cases():
    a = [1.0, 2.0, 3.0, 4.0, 5.0]
    assert abs(pearson(a, a) - 1.0) < 1e-9            # idénticas → +1
    assert abs(pearson(a, [5.0, 4.0, 3.0, 2.0, 1.0]) + 1.0) < 1e-9  # opuestas → -1
    assert pearson(a, [7.0, 7.0, 7.0, 7.0, 7.0]) is None           # varianza cero → None
    assert pearson([1.0, 2.0], [1.0]) is None                       # longitudes distintas


def test_correlation_matrix():
    up = [1.0, 2.0, 3.0, 4.0]
    down = [4.0, 3.0, 2.0, 1.0]
    m = correlation_matrix([up, down])
    assert m[0][0] == 1.0 and m[1][1] == 1.0     # diagonal
    assert m[0][1] == m[1][0] and m[0][1] == -1.0  # simétrica y opuesta


def test_returns_from_equity():
    assert returns_from_equity([100.0, 110.0, 99.0]) == [0.1, -0.1]


# --------------------------------------------------------------------------- #
# Riesgo de posición / portfolio heat
# --------------------------------------------------------------------------- #
def test_position_risk_and_heat():
    # EURUSD: entry 1.1000, SL 1.0950 (50 pips), pip 0.0001, pip_value 10, 1 lote → $500.
    r = position_risk(1.1000, 1.0950, 1.0, 0.0001, 10.0)
    assert round(r, 2) == 500.0
    assert position_risk(1.1, None, 1.0, 0.0001, 10.0) == 0.0  # sin SL → 0
    # Heat: $500 sobre $10000 = 5%.
    assert portfolio_heat([500.0], 10000.0) == 5.0
    assert portfolio_heat([300.0, 300.0], 10000.0) == 6.0


def test_heat_would_exceed():
    # 5% actual + 2% nuevo = 7% > límite 6 → bloquea.
    assert heat_would_exceed(500.0, 200.0, 10000.0, 6.0) is True
    # 5% + 0.5% = 5.5% < 6 → permite.
    assert heat_would_exceed(500.0, 50.0, 10000.0, 6.0) is False
    # límite 0 = desactivado → nunca bloquea.
    assert heat_would_exceed(9999.0, 9999.0, 10000.0, 0.0) is False


# --------------------------------------------------------------------------- #
# Circuit breakers
# --------------------------------------------------------------------------- #
def test_circuit_breaker_triggers():
    assert circuit_breaker_tripped(3, 0.0, 3, 0.0)[0] is True    # N pérdidas
    assert circuit_breaker_tripped(2, 0.0, 3, 0.0)[0] is False   # bajo el umbral
    assert circuit_breaker_tripped(0, 5.0, 0, 4.0)[0] is True    # drawdown %
    assert circuit_breaker_tripped(0, 3.0, 0, 4.0)[0] is False   # DD bajo umbral
    assert circuit_breaker_tripped(99, 99.0, 0, 0.0)[0] is False  # ambos OFF (0)


# --------------------------------------------------------------------------- #
# Ciclo crítico: dispara → pausa → reanuda → contadores limpios (no re-pausa)
# --------------------------------------------------------------------------- #
def test_circuit_breaker_resume_resets_counters(tmp_path):
    st = BotState(tmp_path / "state.json")
    run = new_run({"strategy_id": 1, "strategy_type": "rsi", "symbol": "EURUSD#",
                   "timeframe": "H1", "cb_max_losses": 3}, magic=770001)
    st.upsert(run)

    for _ in range(3):  # 3 pérdidas seguidas → racha 3
        st.record_closed_trade(run, {"pnl": -10.0})
    assert run["loss_streak"] == 3
    assert circuit_breaker_tripped(run["loss_streak"], 0.0, run["cb_max_losses"], 0.0)[0] is True

    run["status"] = "paused"            # el breaker pausa
    st.reset_circuit_counters(run)      # ...y al reanudar se limpian
    assert run["loss_streak"] == 0 and run["peak_pnl"] == run["realized_pnl_today"]
    # Reanudada NO debe re-dispararse de inmediato con la racha vieja:
    assert circuit_breaker_tripped(run["loss_streak"], 0.0, run["cb_max_losses"], 0.0)[0] is False


def test_drawdown_peak_tracking(tmp_path):
    st = BotState(tmp_path / "s.json")
    run = new_run({"strategy_id": 2, "strategy_type": "rsi", "symbol": "EURUSD#",
                   "timeframe": "H1", "cb_max_drawdown_pct": 3.0}, magic=770002)
    st.record_closed_trade(run, {"pnl": 100.0})   # pico de PnL = 100
    st.record_closed_trade(run, {"pnl": -40.0})   # realizado 60 → DD = 40
    assert run["peak_pnl"] == 100.0 and run["realized_pnl_today"] == 60.0
    dd_pct = (run["peak_pnl"] - run["realized_pnl_today"]) / 1000.0 * 100.0  # sobre balance 1000 = 4%
    assert circuit_breaker_tripped(0, dd_pct, 0, run["cb_max_drawdown_pct"])[0] is True
