"""Estado del bot MULTI-ESTRATEGIA, persistido en disco.

El bot ejecuta una LISTA de estrategias a la vez, cada una con su propia config,
magic number, guards y PnL (riesgo independiente). Trazabilidad total: cada orden
lleva el magic de su estrategia.

Tras un reinicio el bot NUNCA auto-reanuda: las estrategias que estaban operando
arrancan PAUSADAS (fail-safe). El estado se guarda como JSON junto al bridge.
"""

from __future__ import annotations

import json
import os
import shutil
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

# Marcador único del fail-safe de reinicio: al arrancar, todo run que estaba `running`
# queda `paused` con este motivo. El auto-reanudar (Laravel) SOLO reanuda runs con este
# marcador exacto → nunca toca lo que el usuario pausó/detuvo a mano.
RESTART_PAUSE_REASON = "Reinicio del bridge: la estrategia arrancó PAUSADA por seguridad."


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
        # Fidelidad con el backtest (ATR en vivo): modo SL/TP + periodo ATR + riesgo%.
        # En modo ATR, sl_pips/tp_pips se interpretan como multiplicadores N/M.
        "sl_mode": str(config.get("sl_mode") or "fixed").lower(),
        "atr_period": int(config.get("atr_period", 14) or 14),
        "risk_percent": float(config.get("risk_percent", 0) or 0),
        # Guardas de sizing (Fase 2).
        "max_lot": float(config.get("max_lot", 0) or 0),
        "below_min": str(config.get("below_min") or "skip").lower(),
        # Caducidad del arme (C): auto-pausa si lleva N horas ARMADA sin abrir (0 = off).
        "arm_expiry_hours": float(config.get("arm_expiry_hours", 24) or 0),
        "last_activity": _now_iso(),  # armada ahora; se renueva al abrir/cerrar/reanudar
        "daily_loss_limit": float(config.get("daily_loss_limit", 100)),
        "max_positions": int(config.get("max_positions", 1)),
        # Capa defensiva (Fase 6): pausar en ventana de noticia de alto impacto.
        "news_filter": bool(config.get("news_filter", False)),
        "news_window_min": int(config.get("news_window_min", 15)),
        # Circuit breakers (Fase 7, OFF por defecto): pausar tras N pérdidas seguidas
        # o X% de drawdown (desde el pico de PnL realizado). 0 = desactivado.
        "cb_max_losses": int(config.get("cb_max_losses", 0)),
        "cb_max_drawdown_pct": float(config.get("cb_max_drawdown_pct", 0)),
        "loss_streak": 0,
        "peak_pnl": 0.0,
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
        self.portfolio_heat_pct: float = 0.0  # límite global de riesgo agregado (0 = off)

    def set_portfolio_heat(self, pct: float) -> None:
        with self._lock:
            self.portfolio_heat_pct = max(0.0, float(pct))

    def reset_circuit_counters(self, run: dict[str, Any]) -> None:
        """Reinicia los contadores del circuit breaker (al reanudar/arrancar) para que
        una estrategia reanudada NO se vuelva a pausar de inmediato con la racha vieja."""
        run["loss_streak"] = 0
        run["peak_pnl"] = run.get("realized_pnl_today", 0.0)

    # -- persistencia ------------------------------------------------------
    def _read_state_file(self) -> dict[str, Any] | None:
        """Lee el JSON de estado; si el principal está corrupto (p.ej. corte de luz
        a mitad de escritura) cae al .bak del último estado bueno. None = sin estado."""
        for path in (self._file, self._file.with_suffix(self._file.suffix + ".bak")):
            if not path.exists():
                continue
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                continue  # corrupto → intenta el siguiente (.bak)
        return None

    def _load(self) -> None:
        data = self._read_state_file()
        if data is None:
            return
        runs = data.get("runs", {})
        self.runs = {int(k): v for k, v in runs.items()}
        self.day = data.get("day", _today())
        self.portfolio_heat_pct = float(data.get("portfolio_heat_pct", 0.0))
        # Normalizar claves int en dicts anidados + FAIL-SAFE arranque PAUSADO.
        for run in self.runs.values():
            run["open_tickets"] = {int(k): v for k, v in (run.get("open_tickets") or {}).items()}
            run["pending_reasons"] = {int(k): v for k, v in (run.get("pending_reasons") or {}).items()}
            if run.get("status") == "running":
                run["status"] = "paused"
                run["stop_reason"] = RESTART_PAUSE_REASON

    def save(self) -> None:
        with self._lock:
            data = {"runs": self.runs, "day": self.day, "portfolio_heat_pct": self.portfolio_heat_pct}
        payload = json.dumps(data, default=str, ensure_ascii=False)
        try:
            # Escritura ATÓMICA: escribe a un temporal y os.replace() (atómico en el mismo
            # volumen). Un corte de luz nunca deja el JSON a medias. Antes de reemplazar,
            # conserva el estado bueno anterior como .bak (red de seguridad extra).
            tmp = self._file.with_suffix(self._file.suffix + ".tmp")
            tmp.write_text(payload, encoding="utf-8")
            if self._file.exists():
                try:  # .bak = copia del último bueno; el primario sigue presente hasta el replace
                    shutil.copyfile(self._file, self._file.with_suffix(self._file.suffix + ".bak"))
                except Exception:
                    pass
            os.replace(tmp, self._file)
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
            run["loss_streak"] = 0      # día nuevo → contadores del breaker a cero
            run["peak_pnl"] = 0.0

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
            pnl = float(trade.get("pnl", 0.0))
            run["realized_pnl_today"] += pnl
            # Circuit breaker (Fase 7): racha de pérdidas + pico de PnL para el DD.
            run["loss_streak"] = (run.get("loss_streak", 0) + 1) if pnl <= 0 else 0
            run["peak_pnl"] = max(run.get("peak_pnl", 0.0), run["realized_pnl_today"])

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
                    "config": {"lot": run["lot"], "sl_pips": run["sl_pips"], "tp_pips": run["tp_pips"], "sl_mode": run.get("sl_mode", "fixed"), "atr_period": run.get("atr_period", 14), "risk_percent": run.get("risk_percent", 0), "max_lot": run.get("max_lot", 0), "below_min": run.get("below_min", "skip"), "arm_expiry_hours": run.get("arm_expiry_hours", 0), "daily_loss_limit": run["daily_loss_limit"], "max_positions": run["max_positions"], "news_filter": run.get("news_filter", False), "news_window_min": run.get("news_window_min", 15), "cb_max_losses": run.get("cb_max_losses", 0), "cb_max_drawdown_pct": run.get("cb_max_drawdown_pct", 0)},
                    "realized_pnl_today": round(realized, 2),
                    "floating_pnl": round(floating, 2),
                    "daily_pnl": round(realized + floating, 2),
                    "open_positions": len(pos),
                    "loss_streak": run.get("loss_streak", 0),
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
                "portfolio_heat_pct": self.portfolio_heat_pct,  # límite global (riesgo en uso lo añade el runner)
            }


bot_state = BotState()
