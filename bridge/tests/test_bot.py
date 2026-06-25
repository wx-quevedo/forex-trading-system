"""Tests del motor del bot (sin MT5: cliente falso + velas sintéticas)."""

import json

import numpy as np
import pytest

from app.bot.guards import can_open, daily_limit_hit
from app.bot.state import BOT_MAGIC, BotState
from app.bot.runner import bot_state, bot_runner


def _candles(closes):
    out = []
    t = 1_700_000_000
    for i, c in enumerate(closes):
        out.append({"time": t + i * 3600, "open": float(c), "high": float(c) + 0.0005,
                    "low": float(c) - 0.0005, "close": float(c), "tick_volume": 100})
    return out


def _buy_candles():
    # Caída larga + salto en la penúltima vela (la última es la "en formación").
    closes = list(np.linspace(1.20, 1.05, 40)) + [1.30, 1.30]
    return _candles(closes)


class FakeClient:
    def __init__(self, candles=None, positions=None):
        self._candles = candles or []
        self._positions = positions or []
        self.sent = []
        self.closed = []

    def candles(self, symbol, timeframe, count=None, **kw):
        return self._candles

    def positions(self, symbol=None):
        return [p for p in self._positions if symbol is None or p["symbol"] == symbol]

    def price(self, symbol):
        return {"symbol": symbol, "bid": 1.10, "ask": 1.1002, "last": 1.10, "time": 1}

    def send_order(self, symbol, order_type, volume, sl=None, tp=None, comment="", magic=0):
        self.sent.append({"symbol": symbol, "type": order_type, "volume": volume, "sl": sl, "tp": tp, "magic": magic})
        return {"order": 555, "retcode": 10009, "comment": "ok"}

    def close_position(self, ticket):
        self.closed.append(int(ticket))
        return {"order": int(ticket), "retcode": 10009}

    def closed_position_pnl(self, ticket):
        return {"pnl": -5.0, "close_price": 1.099, "close_time": 1}


@pytest.fixture
def fresh_state(tmp_path, monkeypatch):
    bot_state._file = tmp_path / "bot_state.json"
    bot_state.reset()
    bot_state.strategy_type = "ma_cross"
    bot_state.params = {"ma_type": "ema", "fast_period": 5, "slow_period": 20}
    bot_state.symbol = "EURUSD"
    bot_state.timeframe = "H1"
    bot_state.lot = 0.01
    bot_state.sl_pips = 20
    bot_state.tp_pips = 40
    bot_state.max_positions = 1
    bot_state.daily_loss_limit = 100
    bot_state.status = "running"
    return bot_state


# --- guards (puro) --------------------------------------------------------
def test_guard_blocks_max_positions(fresh_state):
    ok, reason = can_open(fresh_state, open_positions=1, daily_pnl=0.0)
    assert not ok and "Máximo" in reason


def test_guard_blocks_daily_loss(fresh_state):
    fresh_state.daily_loss_limit = 100
    ok, reason = can_open(fresh_state, open_positions=0, daily_pnl=-150.0)
    assert not ok and "pérdida diaria" in reason
    assert daily_limit_hit(fresh_state, -150.0)
    assert not daily_limit_hit(fresh_state, -50.0)


# --- panic ----------------------------------------------------------------
def test_panic_closes_all_positions_and_stops(fresh_state, monkeypatch):
    fake = FakeClient(positions=[
        {"ticket": 1, "symbol": "EURUSD", "type": 0, "magic": BOT_MAGIC, "profit": 2.0},
        {"ticket": 2, "symbol": "GBPUSD", "type": 1, "magic": 0, "profit": -1.0},  # manual
    ])
    monkeypatch.setattr("app.bot.runner.client", fake)
    result = bot_runner.panic()
    assert set(fake.closed) == {1, 2}  # cierra TODAS (bot + manual)
    assert result["count"] == 2
    assert bot_state.status == "stopped"
    assert "PANIC" in bot_state.stop_reason


# --- evaluación / apertura -------------------------------------------------
def test_evaluate_opens_on_buy_signal(fresh_state, monkeypatch):
    fake = FakeClient(candles=_buy_candles(), positions=[])
    monkeypatch.setattr("app.bot.runner.client", fake)
    bot_runner._evaluate_on_close()
    assert len(fake.sent) == 1
    assert fake.sent[0]["type"] == "BUY" and fake.sent[0]["magic"] == BOT_MAGIC
    last = bot_state.signals[-1]
    assert last["signal_type"] == "buy" and last["executed"] is True
    assert 555 in bot_state.open_tickets


def test_guard_blocks_open_when_max_positions_reached(fresh_state, monkeypatch):
    # Ya hay una posición del bot en OTRO símbolo y max=1 -> no abre en EURUSD.
    fake = FakeClient(
        candles=_buy_candles(),
        positions=[{"ticket": 9, "symbol": "GBPUSD", "type": 0, "magic": BOT_MAGIC, "profit": 0.0}],
    )
    monkeypatch.setattr("app.bot.runner.client", fake)
    bot_runner._evaluate_on_close()
    assert fake.sent == []  # no abrió
    last = bot_state.signals[-1]
    assert last["executed"] is False and "Máximo" in last["reason"]


def test_no_double_open_same_candle(fresh_state, monkeypatch):
    fake = FakeClient(candles=_buy_candles(), positions=[])
    monkeypatch.setattr("app.bot.runner.client", fake)
    bot_runner._evaluate_on_close()
    bot_runner._evaluate_on_close()  # misma vela cerrada -> idempotente
    assert len(fake.sent) == 1


# --- fail-safe: arranque PAUSADO tras reinicio ----------------------------
def test_restart_starts_paused(tmp_path):
    f = tmp_path / "bot_state.json"
    f.write_text(json.dumps({"status": "running", "symbol": "EURUSD"}), encoding="utf-8")
    s = BotState(state_file=f)
    assert s.status == "paused"
    assert "Reinicio" in (s.stop_reason or "")
