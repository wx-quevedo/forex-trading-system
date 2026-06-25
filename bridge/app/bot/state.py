"""Estado del bot, persistido en disco para sobrevivir reinicios del bridge.

Tras un reinicio el bot NUNCA auto-reanuda: si estaba operando, arranca PAUSADO
(fail-safe). El estado se guarda como JSON junto al bridge.
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Magic number que identifica las posiciones abiertas por el bot (≠ órdenes manuales).
BOT_MAGIC = 770007

_STATE_FILE = Path(__file__).resolve().parent.parent.parent / "bot_state.json"
_MAX_SIGNALS = 300


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _today() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")


class BotState:
    """Estado mutable del bot protegido por un lock (un solo thread del runner)."""

    def __init__(self, state_file: Path | None = None) -> None:
        self._lock = threading.RLock()
        self._file = state_file or _STATE_FILE
        self.reset()
        self._load()

    def reset(self) -> None:
        self.status: str = "stopped"  # stopped | running | paused | error
        self.error: str | None = None
        self.stop_reason: str | None = None
        self.bot_run_id: int | None = None
        # Estrategia / config
        self.strategy_type: str = "ma_cross"
        self.params: dict[str, Any] = {}
        self.symbol: str = "EURUSD"
        self.timeframe: str = "H1"
        self.lot: float = 0.01
        self.sl_pips: float = 20.0
        self.tp_pips: float = 40.0
        # Límites de seguridad
        self.daily_loss_limit: float = 100.0
        self.max_positions: int = 1
        # Tracking
        self.day: str = _today()
        self.realized_pnl_today: float = 0.0
        self.started_at: str | None = None
        self.last_candle_time: int | None = None
        self.open_tickets: dict[int, dict[str, Any]] = {}
        self.pending_reasons: dict[int, str] = {}  # ticket -> motivo de cierre forzado
        self.signals: list[dict[str, Any]] = []
        self.closed_trades: list[dict[str, Any]] = []
        self._seq: int = 0

    # -- persistencia ------------------------------------------------------
    def _load(self) -> None:
        if not self._file.exists():
            return
        try:
            data = json.loads(self._file.read_text(encoding="utf-8"))
        except Exception:
            return
        for k, v in data.items():
            if hasattr(self, k) and not k.startswith("_"):
                setattr(self, k, v)
        # open_tickets keys se serializan como str -> volver a int
        self.open_tickets = {int(k): v for k, v in (self.open_tickets or {}).items()}
        # FAIL-SAFE: si estaba operando, arrancar PAUSADO tras el reinicio.
        if self.status == "running":
            self.status = "paused"
            self.stop_reason = "Reinicio del bridge: el bot arrancó PAUSADO por seguridad."

    def save(self) -> None:
        with self._lock:
            data = {
                k: v for k, v in self.__dict__.items()
                if not k.startswith("_") and not callable(v)
            }
        try:
            self._file.write_text(json.dumps(data, default=str, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass

    # -- mutaciones --------------------------------------------------------
    def lock(self) -> threading.RLock:
        return self._lock

    def roll_day_if_needed(self) -> None:
        today = _today()
        if today != self.day:
            self.day = today
            self.realized_pnl_today = 0.0
            self.closed_trades = []

    def add_signal(
        self, symbol: str, signal: str, executed: bool, reason: str,
        indicators: dict[str, Any], candle_time: int | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            self._seq += 1
            entry = {
                "seq": self._seq,
                "evaluated_at": _now_iso(),
                "candle_time": candle_time,  # tiempo de la vela cerrada evaluada (para el chart)
                "symbol": symbol,
                "signal_type": signal,
                "executed": executed,
                "reason": reason,
                "indicator_values": indicators,
            }
            self.signals.append(entry)
            if len(self.signals) > _MAX_SIGNALS:
                self.signals = self.signals[-_MAX_SIGNALS:]
            return entry

    def record_closed_trade(self, trade: dict[str, Any]) -> None:
        with self._lock:
            self.closed_trades.append(trade)
            self.realized_pnl_today += float(trade.get("pnl", 0.0))

    def snapshot(self, positions: list[dict[str, Any]], floating_pnl: float) -> dict[str, Any]:
        with self._lock:
            return {
                "status": self.status,
                "error": self.error,
                "stop_reason": self.stop_reason,
                "bot_run_id": self.bot_run_id,
                "strategy": {
                    "type": self.strategy_type,
                    "params": self.params,
                    "symbol": self.symbol,
                    "timeframe": self.timeframe,
                },
                "config": {
                    "lot": self.lot,
                    "sl_pips": self.sl_pips,
                    "tp_pips": self.tp_pips,
                    "daily_loss_limit": self.daily_loss_limit,
                    "max_positions": self.max_positions,
                },
                "day": self.day,
                "started_at": self.started_at,
                "realized_pnl_today": round(self.realized_pnl_today, 2),
                "floating_pnl": round(floating_pnl, 2),
                "daily_pnl": round(self.realized_pnl_today + floating_pnl, 2),
                "positions": positions,
                "open_positions": len(positions),
                "signals": list(reversed(self.signals[-80:])),
                "closed_trades": list(reversed(self.closed_trades[-100:])),
            }


bot_state = BotState()
