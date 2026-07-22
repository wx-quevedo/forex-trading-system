"""Tests del motor del bot MULTI-ESTRATEGIA (sin MT5: cliente falso + velas sintéticas)."""

import json

import numpy as np
import pytest

from app.bot.guards import can_open, daily_limit_hit
from app.bot.state import BotState, magic_for, is_bot_magic
from app.bot.runner import bot_state, bot_runner


def _candles(closes):
    out = []
    t = 1_700_000_000
    for i, c in enumerate(closes):
        out.append({"time": t + i * 3600, "open": float(c), "high": float(c) + 0.0005,
                    "low": float(c) - 0.0005, "close": float(c), "tick_volume": 100})
    return out


def _buy_candles():
    closes = list(np.linspace(1.20, 1.05, 40)) + [1.30, 1.30]
    return _candles(closes)


class FakeClient:
    def __init__(self, candles=None, positions=None):
        self._candles = candles or []
        self._positions = positions or []
        self.sent = []
        self.closed = []

    def resolve_tradable_symbol(self, symbol):
        return symbol.upper()

    # Perfil del símbolo (lo consume app/bot/order.py para preview/ejecutor fiel).
    # Valores EURUSD-like coherentes con price(): pip 0.0001, $10/pip/lote.
    def symbol_costs(self, symbol):
        return {"point": 0.00001, "pip": 0.0001, "pip_value_per_lot": 10.0,
                "spread_pips": 1.0, "commission_per_lot": 0.0,
                "swap_long_pts": 0.0, "swap_short_pts": 0.0,
                "volume_min": 0.01, "volume_step": 0.01, "contract_size": 100000.0}

    def symbol_info(self, symbol):
        return {"name": symbol, "point": 0.00001, "digits": 5,
                "trade_stops_level": 0, "volume_max": 100.0, "trade_mode": 4}

    def account_info(self):
        return {"balance": 10000.0, "equity": 10000.0, "currency": "USD",
                "margin_free": 10000.0, "login": 1}

    def candles(self, symbol, timeframe, count=None, **kw):
        return self._candles

    def positions(self, symbol=None):
        return [p for p in self._positions if symbol is None or p["symbol"] == symbol]

    def price(self, symbol):
        return {"symbol": symbol, "bid": 1.10, "ask": 1.1002, "last": 1.10, "time": 1}

    def send_order(self, symbol, order_type, volume, sl=None, tp=None, comment="", magic=0):
        self.sent.append({"symbol": symbol, "type": order_type, "magic": magic, "comment": comment})
        return {"order": 555, "retcode": 10009, "comment": "ok"}

    def close_position(self, ticket):
        self.closed.append(int(ticket))
        return {"order": int(ticket), "retcode": 10009}

    def closed_position_pnl(self, ticket):
        return {"pnl": -5.0, "close_price": 1.099, "close_time": 1}


@pytest.fixture
def env(tmp_path, monkeypatch):
    bot_state._file = tmp_path / "bot_state.json"
    bot_state.reset()
    monkeypatch.setattr(bot_runner, "_ensure_thread", lambda: None)  # sin hilo en tests
    return bot_state


def _add(fake, monkeypatch, **over):
    monkeypatch.setattr("app.bot.runner.client", fake)
    cfg = {"strategy_id": 1, "bot_run_id": 10, "strategy_type": "ma_cross",
           "params": {"ma_type": "ema", "fast_period": 5, "slow_period": 20},
           "symbol": "EURUSD", "timeframe": "H1", "lot": 0.01, "sl_pips": 20, "tp_pips": 40,
           "daily_loss_limit": 100, "max_positions": 1}
    cfg.update(over)
    bot_runner.add(cfg)
    return bot_state.get(cfg["strategy_id"])


# --- magic / guards -------------------------------------------------------
def test_magic_unique_and_in_range():
    assert magic_for(1) == 770001
    assert magic_for(2) == 770002
    assert is_bot_magic(770001) and not is_bot_magic(0) and not is_bot_magic(990001)


def test_guards_pure():
    assert can_open(1, 100, 1, 0.0)[0] is False  # max posiciones
    assert "Máximo" in can_open(1, 100, 1, 0.0)[1]
    assert can_open(2, 100, 0, -150.0)[0] is False  # límite diario
    assert daily_limit_hit(100, -150.0) and not daily_limit_hit(100, -50.0)


# --- panic ----------------------------------------------------------------
def test_panic_closes_all_and_stops_runs(env, monkeypatch):
    fake = FakeClient(positions=[
        {"ticket": 1, "symbol": "EURUSD", "type": 0, "magic": 770001, "profit": 2.0, "volume": 0.01, "price_open": 1.1},
        {"ticket": 2, "symbol": "GBPUSD", "type": 1, "magic": 0, "profit": -1.0, "volume": 0.01, "price_open": 1.2},  # manual
    ])
    _add(fake, monkeypatch)
    result = bot_runner.panic()
    assert set(fake.closed) == {1, 2}  # cierra TODAS (bot + manual)
    assert result["count"] == 2
    assert bot_state.global_status() == "stopped"
    assert all(r["status"] == "stopped" for r in bot_state.runs.values())


# --- evaluación / apertura con magic por estrategia -----------------------
def test_evaluate_opens_with_strategy_magic(env, monkeypatch):
    fake = FakeClient(candles=_buy_candles(), positions=[])
    run = _add(fake, monkeypatch)
    bot_runner._evaluate(run)
    assert len(fake.sent) == 1
    assert fake.sent[0]["type"] == "BUY" and fake.sent[0]["magic"] == 770001
    assert "bot_s1" in fake.sent[0]["comment"]
    last = run["signals"][-1]
    assert last["signal_type"] == "buy" and last["executed"] is True and last["strategy_id"] == 1
    assert 555 in run["open_tickets"]


def test_guard_blocks_when_max_positions_reached(env, monkeypatch):
    fake = FakeClient(candles=_buy_candles(),
                      positions=[{"ticket": 9, "symbol": "GBPUSD", "type": 0, "magic": 770001, "profit": 0.0, "volume": 0.01}])
    run = _add(fake, monkeypatch)
    bot_runner._evaluate(run)
    assert fake.sent == []
    assert run["signals"][-1]["executed"] is False and "Máximo" in run["signals"][-1]["reason"]


def test_no_double_open_same_candle(env, monkeypatch):
    fake = FakeClient(candles=_buy_candles(), positions=[])
    run = _add(fake, monkeypatch)
    bot_runner._evaluate(run)
    bot_runner._evaluate(run)
    assert len(fake.sent) == 1


def test_two_strategies_isolated_magics(env, monkeypatch):
    fake = FakeClient(candles=_buy_candles(), positions=[])
    r1 = _add(fake, monkeypatch, strategy_id=1)
    r2 = _add(fake, monkeypatch, strategy_id=2, symbol="GBPUSD")
    assert r1["magic"] != r2["magic"]
    assert len(bot_state.runs) == 2


# --- fail-safe: arranque PAUSADO tras reinicio ----------------------------
def test_restart_starts_paused(tmp_path):
    f = tmp_path / "bot_state.json"
    f.write_text(json.dumps({"runs": {"1": {"strategy_id": 1, "status": "running", "symbol": "EURUSD",
                 "open_tickets": {}, "pending_reasons": {}}}, "day": "2026-06-25"}), encoding="utf-8")
    s = BotState(state_file=f)
    assert s.get(1)["status"] == "paused"
    assert "Reinicio" in (s.get(1)["stop_reason"] or "")
