"""Estado del bot MULTI-ESTRATEGIA, persistido en disco.

El bot ejecuta una LISTA de estrategias a la vez, cada una con su propia config,
magic number, guards y PnL (riesgo independiente). Trazabilidad total: cada orden
lleva el magic de su estrategia.

Tras un reinicio el bot NUNCA auto-reanuda: las estrategias que estaban operando
arrancan PAUSADAS (fail-safe). El estado se guarda como JSON junto al bridge.
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Rango de magic numbers del bot. Cada estrategia activa recibe uno único:
#   magic = BOT_MAGIC_BASE + (strategy_id % 100000)
BOT_MAGIC_BASE = 770000
BOT_MAGIC_SPAN = 100000
BOT_MAGIC = BOT_MAGIC_BASE  # compat: magic genérico para órdenes sin estrategia

_STATE_FILE = Path(__file__).resolve().parent.parent.parent / "bot_state.json"
_MAX_SIGNALS = 200


def magic_for(strategy_id: int) -> int:
    return BOT_MAGIC_BASE + (int(strategy_id) % BOT_MAGIC_SPAN)


def is_bot_magic(magic: int) -> bool:
    return BOT_MAGIC_BASE <= int(magic) < BOT_MAGIC_BASE + BOT_MAGIC_SPAN


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _today() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")


def new_run(config: dict[str, Any], magic: int) -> dict[str, Any]:
    """Crea un 'run' (estrategia activa) con su config y tracking propios."""
    return {
        "strategy_id": int(config["strategy_id"]),
        "bot_run_id": config.get("bot_run_id"),
        "strategy_type": config["strategy_type"],
        "params": config.get("params", {}),
        "symbol": config["symbol"],
        "timeframe": config["timeframe"],
        "lot": float(config.get("lot", 0.01)),
        "sl_pips": float(config.get("sl_pips", 20)),
        "tp_pips": float(config.get("tp_pips", 40)),
        "daily_loss_limit": float(config.get("daily_loss_limit", 100)),
        "max_positions": int(config.get("max_positions", 1)),
        "magic": int(magic),
        "comment": f"bot_s{config['strategy_id']}_{config['symbol']}_{config['timeframe']}"[:31],
        "status": "running",
        "error": None,
        "stop_reason": None,
        "started_at": _now_iso(),
        "day": _today(),
        "realized_pnl_today": 0.0,
        "last_candle_time": None,
        "open_tickets": {},
        "pending_reasons": {},
        "signals": [],
        "closed_trades": [],
        "seq": 0,
    }


class BotState:
    """Contenedor de runs (estrategias activas) protegido por un lock."""

    def __init__(self, state_file: Path | None = None) -> None:
        self._lock = threading.RLock()
        self._file = state_file or _STATE_FILE
        self.reset()
        self._load()

    def reset(self) -> None:
        self.runs: dict[int, dict[str, Any]] = {}  # strategy_id -> run
        self.day: str = _today()

    # -- persistencia ------------------------------------------------------
    def _load(self) -> None:
        if not self._file.exists():
            return
        try:
            data = json.loads(self._file.read_text(encoding="utf-8"))
        except Exception:
            return
        runs = data.get("runs", {})
        self.runs = {int(k): v for k, v in runs.items()}
        self.day = data.get("day", _today())
        # Normalizar claves int en dicts anidados + FAIL-SAFE arranque PAUSADO.
        for run in self.runs.values():
            run["open_tickets"] = {int(k): v for k, v in (run.get("open_tickets") or {}).items()}
            run["pending_reasons"] = {int(k): v for k, v in (run.get("pending_reasons") or {}).items()}
            if run.get("status") == "running":
                run["status"] = "paused"
                run["stop_reason"] = "Reinicio del bridge: la estrategia arrancó PAUSADA por seguridad."

    def save(self) -> None:
        with self._lock:
            data = {"runs": self.runs, "day": self.day}
        try:
            self._file.write_text(json.dumps(data, default=str, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass

    # -- acceso ------------------------------------------------------------
    def lock(self) -> threading.RLock:
        return self._lock

    def get(self, strategy_id: int) -> dict[str, Any] | None:
        return self.runs.get(int(strategy_id))

    def upsert(self, run: dict[str, Any]) -> None:
        with self._lock:
            self.runs[int(run["strategy_id"])] = run

    def remove(self, strategy_id: int) -> dict[str, Any] | None:
        with self._lock:
            return self.runs.pop(int(strategy_id), None)

    def active_runs(self) -> list[dict[str, Any]]:
        return [r for r in self.runs.values() if r["status"] == "running"]

    def roll_day_if_needed(self, run: dict[str, Any]) -> None:
        today = _today()
        if run.get("day") != today:
            run["day"] = today
            run["realized_pnl_today"] = 0.0
            run["closed_trades"] = []

    def global_status(self) -> str:
        statuses = [r["status"] for r in self.runs.values()]
        if not statuses:
            return "stopped"
        if "error" in statuses:
            return "error"
        if "running" in statuses:
            return "running"
        if "paused" in statuses:
            return "paused"
        return "stopped"

    # -- mutaciones de un run ---------------------------------------------
    def add_signal(self, run: dict[str, Any], signal: str, executed: bool, reason: str,
                   indicators: dict[str, Any], candle_time: int | None = None) -> dict[str, Any]:
        with self._lock:
            run["seq"] += 1
            entry = {
                "seq": run["seq"],
                "strategy_id": run["strategy_id"],
                "evaluated_at": _now_iso(),
                "candle_time": candle_time,
                "symbol": run["symbol"],
                "signal_type": signal,
                "executed": executed,
                "reason": reason,
                "indicator_values": indicators,
            }
            run["signals"].append(entry)
            if len(run["signals"]) > _MAX_SIGNALS:
                run["signals"] = run["signals"][-_MAX_SIGNALS:]
            return entry

    def record_closed_trade(self, run: dict[str, Any], trade: dict[str, Any]) -> None:
        with self._lock:
            trade["strategy_id"] = run["strategy_id"]
            trade["magic"] = run["magic"]
            run["closed_trades"].append(trade)
            run["realized_pnl_today"] += float(trade.get("pnl", 0.0))

    # -- snapshot ----------------------------------------------------------
    def snapshot(self, positions_by_magic: dict[int, list[dict[str, Any]]], floating_by_magic: dict[int, float]) -> dict[str, Any]:
        """Estado agregado + por estrategia. `positions_by_magic`: magic -> posiciones."""
        with self._lock:
            run_summaries = []
            all_positions: list[dict[str, Any]] = []
            all_signals: list[dict[str, Any]] = []
            all_closed: list[dict[str, Any]] = []
            agg_realized = 0.0
            agg_floating = 0.0
            exposure: dict[str, dict[str, float]] = {}

            for run in self.runs.values():
                magic = run["magic"]
                pos = positions_by_magic.get(magic, [])
                floating = floating_by_magic.get(magic, 0.0)
                realized = float(run["realized_pnl_today"])
                agg_realized += realized
                agg_floating += floating

                for p in pos:
                    tagged = {**p, "strategy_id": run["strategy_id"]}
                    all_positions.append(tagged)
                    ex = exposure.setdefault(p["symbol"], {"buy": 0.0, "sell": 0.0, "count": 0})
                    if p.get("type") == 0:
                        ex["buy"] += float(p.get("volume", 0))
                    else:
                        ex["sell"] += float(p.get("volume", 0))
                    ex["count"] += 1

                all_signals.extend(run["signals"][-60:])
                all_closed.extend(run["closed_trades"][-60:])

                run_summaries.append({
                    "strategy_id": run["strategy_id"],
                    "bot_run_id": run.get("bot_run_id"),
                    "status": run["status"],
                    "error": run.get("error"),
                    "stop_reason": run.get("stop_reason"),
                    "started_at": run.get("started_at"),
                    "magic": magic,
                    "strategy": {"type": run["strategy_type"], "params": run["params"], "symbol": run["symbol"], "timeframe": run["timeframe"]},
                    "config": {"lot": run["lot"], "sl_pips": run["sl_pips"], "tp_pips": run["tp_pips"], "daily_loss_limit": run["daily_loss_limit"], "max_positions": run["max_positions"]},
                    "realized_pnl_today": round(realized, 2),
                    "floating_pnl": round(floating, 2),
                    "daily_pnl": round(realized + floating, 2),
                    "open_positions": len(pos),
                })

            all_signals.sort(key=lambda s: s.get("evaluated_at", ""), reverse=True)
            all_closed.sort(key=lambda t: t.get("close_at", ""), reverse=True)

            return {
                "status": self.global_status(),
                "day": self.day,
                "runs": run_summaries,
                "positions": all_positions,
                "signals": all_signals[:120],
                "closed_trades": all_closed[:120],
                "realized_pnl_today": round(agg_realized, 2),
                "floating_pnl": round(agg_floating, 2),
                "daily_pnl": round(agg_realized + agg_floating, 2),
                "exposure": exposure,
            }


bot_state = BotState()
