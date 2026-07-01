"""Loop de ejecución MULTI-ESTRATEGIA del bot.

Itera sobre todas las estrategias activas, evaluando cada una en su par/timeframe
con su propio magic, guards y PnL. Trazabilidad total: cada orden lleva el magic
y comment de su estrategia. El panic cierra TODO.
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any

from ..mt5_client import MT5Error, client
from ..strategy import evaluate_strategy
from . import executor, journal
from .guards import can_open, circuit_breaker_tripped, daily_limit_hit
from .portfolio import heat_would_exceed, position_risk
from .state import bot_state, magic_for

_DEFAULT_POLL = 10.0


def _now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _hours_since(iso: str | None) -> float:
    """Horas transcurridas desde un timestamp ISO. Sin timestamp → 0 (recién armada)."""
    if not iso:
        return 0.0
    try:
        t = datetime.fromisoformat(iso)
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return (datetime.now(tz=timezone.utc) - t).total_seconds() / 3600.0
    except Exception:  # noqa: BLE001
        return 0.0


def _infer_close_reason(rec: dict[str, Any], close_price: float | None) -> str:
    sl = rec.get("sl")
    tp = rec.get("tp")
    if close_price is None:
        return "manual"
    pip = executor.pip_size(rec.get("symbol", "EURUSD"))
    tol = 5 * pip
    if tp and abs(close_price - float(tp)) <= tol:
        return "take_profit"
    if sl and abs(close_price - float(sl)) <= tol:
        return "stop_loss"
    return "manual"


class BotRunner:
    def __init__(self, poll: float = _DEFAULT_POLL) -> None:
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self.poll = poll

    # -- control ----------------------------------------------------------
    def add(self, config: dict[str, Any]) -> None:
        """Añade (o reemplaza) una estrategia activa con su config propia."""
        sid = int(config["strategy_id"])
        symbol = config["symbol"].upper()
        try:
            symbol = client.resolve_tradable_symbol(symbol)
        except Exception:  # noqa: BLE001
            pass
        config = {**config, "symbol": symbol}
        # Portfolio heat es un límite GLOBAL de la cartera (Fase 7): el último arranque
        # lo fija para todo el bot.
        if "portfolio_heat_pct" in config:
            bot_state.set_portfolio_heat(config.get("portfolio_heat_pct") or 0)
        from .state import new_run
        run = new_run(config, magic_for(sid))
        bot_state.upsert(run)
        bot_state.save()
        self._ensure_thread()

    def _apply(self, strategy_id: int | None, fn) -> None:
        with bot_state.lock():
            runs = bot_state.runs.values() if strategy_id is None else [r for r in [bot_state.get(strategy_id)] if r]
            for run in runs:
                fn(run)
        bot_state.save()

    def pause(self, strategy_id: int | None = None) -> None:
        self._apply(strategy_id, lambda r: r.update(status="paused") if r["status"] == "running" else None)

    def resume(self, strategy_id: int | None = None) -> None:
        def _r(run):
            if run["status"] in ("paused", "stopped"):
                run["status"] = "running"
                run["stop_reason"] = None
                run["error"] = None
                run["last_activity"] = _now()  # re-armada ahora → reinicia la caducidad (C)
                # Reanudar limpia los contadores del circuit breaker: si no, una
                # estrategia pausada por racha se volvería a pausar al instante.
                bot_state.reset_circuit_counters(run)
        self._apply(strategy_id, _r)
        self._ensure_thread()

    def stop(self, strategy_id: int | None = None) -> None:
        def _s(run):
            run["status"] = "stopped"
            run["stop_reason"] = run.get("stop_reason") or "Detenida por el usuario."
        self._apply(strategy_id, _s)

    def remove(self, strategy_id: int) -> None:
        bot_state.remove(strategy_id)
        bot_state.save()

    def panic(self) -> dict[str, Any]:
        """Cierra TODAS las posiciones y detiene todas las estrategias."""
        result = executor.close_all(client)
        with bot_state.lock():
            for run in bot_state.runs.values():
                open_before = dict(run.get("open_tickets", {}))
                for ticket, rec in open_before.items():
                    info = None
                    try:
                        info = client.closed_position_pnl(ticket)
                    except Exception:  # noqa: BLE001
                        pass
                    bot_state.record_closed_trade(run, {
                        "ticket": ticket, "symbol": rec.get("symbol", run["symbol"]),
                        "direction": rec.get("direction"), "volume": rec.get("volume"),
                        "open_price": rec.get("open_price"), "close_price": (info or {}).get("close_price"),
                        "sl": rec.get("sl"), "tp": rec.get("tp"), "open_at": rec.get("open_at"),
                        "close_at": _now(), "pnl": (info or {}).get("pnl", 0.0), "close_reason": "panic",
                        "open_reason": rec.get("open_reason"), "open_indicators": rec.get("open_indicators"),
                    })
                run["status"] = "stopped"
                run["stop_reason"] = "PANIC: todas las posiciones cerradas."
                run["open_tickets"] = {}
                run["pending_reasons"] = {}
        bot_state.save()
        self._stop.set()
        return result

    # -- estado -----------------------------------------------------------
    def status(self) -> dict[str, Any]:
        positions_by_magic: dict[int, list[dict[str, Any]]] = {}
        floating_by_magic: dict[int, float] = {}
        try:
            for run in bot_state.runs.values():
                magic = run["magic"]
                pos = executor.bot_positions(client, magic=magic)
                positions_by_magic[magic] = pos
                floating_by_magic[magic] = sum(float(p.get("profit", 0.0)) for p in pos)
        except Exception:  # noqa: BLE001 - status nunca debe romper
            pass
        snap = bot_state.snapshot(positions_by_magic, floating_by_magic)
        # Heat actual = riesgo agregado de todas las posiciones bot / equity.
        try:
            equity = self._account_balance()
            risk = 0.0
            for positions in positions_by_magic.values():
                for p in positions:
                    prof = self._profile(p.get("symbol", ""))
                    risk += position_risk(p.get("price_open"), p.get("sl"), p.get("volume", 0),
                                          float(prof.get("pip", 0) or 0), float(prof.get("pip_value_per_lot", 0) or 0))
            snap["portfolio_heat_used_pct"] = round(risk / equity * 100.0, 2) if equity > 0 else 0.0
            snap["portfolio_risk_usd"] = round(risk, 2)
        except Exception:  # noqa: BLE001
            snap["portfolio_heat_used_pct"] = 0.0
        return snap

    # -- loop -------------------------------------------------------------
    def _ensure_thread(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="bot-runner", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        while not self._stop.is_set():
            if not bot_state.runs:
                break  # nada que gestionar
            for run in bot_state.active_runs():
                try:
                    self._process_run(run)
                except MT5Error as exc:
                    self._fail(run, f"MT5: {exc.message}")
                except Exception as exc:  # noqa: BLE001 - fail-safe por estrategia
                    self._fail(run, str(exc))
            bot_state.save()
            self._stop.wait(self.poll)

    def _fail(self, run: dict[str, Any], message: str) -> None:
        run["status"] = "error"
        run["error"] = message
        run["stop_reason"] = "Error crítico: estrategia detenida."

    def _process_run(self, run: dict[str, Any]) -> None:
        bot_state.roll_day_if_needed(run)
        self._reconcile(run)
        # Caducidad del arme (C): si lleva ARMADA sin abrir ninguna posición más de
        # arm_expiry_hours, se auto-pausa (evita quedar armada indefinidamente sin recordarlo).
        exp_h = float(run.get("arm_expiry_hours", 0) or 0)
        if exp_h > 0 and not run.get("open_tickets") and _hours_since(run.get("last_activity")) >= exp_h:
            run["status"] = "paused"
            run["stop_reason"] = (f"Arme caducado: {exp_h:.0f}h sin señal. Pausada por seguridad; "
                                  "reanúdala cuando quieras volver a armarla.")
            journal.append("arm_expired", run, {"hours": exp_h})
            return
        floating, daily = self._pnl(run)
        if daily_limit_hit(run["daily_loss_limit"], daily):
            run["status"] = "stopped"
            run["stop_reason"] = f"Límite de pérdida diaria alcanzado (PnL {daily:.2f})."
            return
        # Circuit breakers (Fase 7): racha de pérdidas / drawdown desde el pico → PAUSA
        # (no stop) para que el usuario revise y reanude (al reanudar se limpian).
        max_losses = int(run.get("cb_max_losses", 0) or 0)
        max_dd = float(run.get("cb_max_drawdown_pct", 0) or 0)
        if max_losses or max_dd:
            dd_pct = 0.0
            if max_dd:
                drop = float(run.get("peak_pnl", 0.0)) - float(run["realized_pnl_today"])
                bal = self._account_balance()
                dd_pct = (drop / bal * 100.0) if (bal > 0 and drop > 0) else 0.0
            tripped, why = circuit_breaker_tripped(int(run.get("loss_streak", 0)), dd_pct, max_losses, max_dd)
            if tripped:
                run["status"] = "paused"
                run["stop_reason"] = why
                return
        self._evaluate(run)

    def _account_balance(self) -> float:
        try:
            return float(client.account().get("balance", 0.0))
        except Exception:  # noqa: BLE001
            return 0.0

    def _profile(self, symbol: str) -> dict[str, Any]:
        cache = getattr(self, "_profile_cache", None)
        if cache is None:
            cache = self._profile_cache = {}
        if symbol not in cache:
            try:
                cache[symbol] = client.symbol_costs(symbol) or {}
            except Exception:  # noqa: BLE001
                cache[symbol] = {}
        return cache[symbol]

    def _heat_block(self, run: dict[str, Any]) -> tuple[bool, str]:
        """¿Abrir superaría el límite GLOBAL de portfolio heat? Ante fallo del cálculo
        NO bloquea (la gestión de riesgo no debe tumbar el bot)."""
        try:
            equity = self._account_balance()
            if equity <= 0:
                return False, ""
            current = 0.0
            for p in executor.bot_positions(client, magic=None):
                prof = self._profile(p.get("symbol", ""))
                current += position_risk(p.get("price_open"), p.get("sl"), p.get("volume", 0),
                                         float(prof.get("pip", 0) or 0), float(prof.get("pip_value_per_lot", 0) or 0))
            prof = self._profile(run["symbol"])
            new_risk = float(run["sl_pips"]) * float(prof.get("pip_value_per_lot", 0) or 0) * float(run["lot"])
            if heat_would_exceed(current, new_risk, equity, bot_state.portfolio_heat_pct):
                used = (current + new_risk) / equity * 100.0
                return True, f"Portfolio heat {used:.1f}% > límite {bot_state.portfolio_heat_pct:.1f}% — no se abre."
            return False, ""
        except Exception:  # noqa: BLE001
            return False, ""

    def _pnl(self, run: dict[str, Any]) -> tuple[float, float]:
        floating = sum(float(p.get("profit", 0.0)) for p in executor.bot_positions(client, magic=run["magic"]))
        return floating, run["realized_pnl_today"] + floating

    def _reconcile(self, run: dict[str, Any]) -> None:
        current = {int(p["ticket"]): p for p in executor.bot_positions(client, magic=run["magic"])}
        for ticket in list(run["open_tickets"]):
            if ticket in current:
                continue
            rec = run["open_tickets"].pop(ticket, {})
            info = None
            try:
                info = client.closed_position_pnl(ticket)
            except Exception:  # noqa: BLE001
                pass
            close_price = (info or {}).get("close_price")
            forced = run["pending_reasons"].pop(ticket, None)
            reason = forced or _infer_close_reason(rec, close_price)
            pnl = (info or {}).get("pnl", 0.0)
            bot_state.record_closed_trade(run, {
                "ticket": ticket, "symbol": rec.get("symbol", run["symbol"]),
                "direction": rec.get("direction"), "volume": rec.get("volume"),
                "open_price": rec.get("open_price"), "close_price": close_price,
                "sl": rec.get("sl"), "tp": rec.get("tp"), "open_at": rec.get("open_at"),
                "close_at": _now(), "pnl": pnl, "close_reason": reason,
                "open_reason": rec.get("open_reason"), "open_indicators": rec.get("open_indicators"),
            })
            run["last_activity"] = _now()  # actividad reciente (renueva la caducidad del arme)
            journal.append("close", run, {  # journal PERSISTENTE del cierre
                "ticket": ticket, "direction": rec.get("direction"), "volume": rec.get("volume"),
                "open_price": rec.get("open_price"), "close_price": close_price,
                "sl": rec.get("sl"), "tp": rec.get("tp"), "pnl": pnl, "close_reason": reason,
            })

    def _evaluate(self, run: dict[str, Any]) -> None:
        candles = client.candles(run["symbol"], run["timeframe"], count=300)
        if len(candles) < 30:
            return
        closed = candles[:-1]
        ctime = int(closed[-1]["time"])
        if ctime == run["last_candle_time"]:
            return
        run["last_candle_time"] = ctime

        result = evaluate_strategy(run["strategy_type"], run["params"], closed)
        signal = result.get("signal", "none")
        reason = result.get("reason", "")
        indicators = result.get("indicators", {})

        executed = False
        exec_reason = reason

        if signal in ("buy", "sell"):
            # Cerrar SOLO las posiciones de ESTA estrategia en sentido contrario.
            for p in executor.bot_positions(client, magic=run["magic"], symbol=run["symbol"]):
                ptype = "buy" if p["type"] == 0 else "sell"
                if ptype != signal:
                    try:
                        run["pending_reasons"][int(p["ticket"])] = "signal"
                        client.close_position(int(p["ticket"]))
                    except Exception:  # noqa: BLE001
                        run["pending_reasons"].pop(int(p["ticket"]), None)

            same = executor.bot_positions(client, magic=run["magic"], symbol=run["symbol"])
            total_open = len(executor.bot_positions(client, magic=run["magic"]))
            _, daily = self._pnl(run)

            if not same:
                ok, why = can_open(run["max_positions"], run["daily_loss_limit"], total_open, daily)
                # Capa defensiva (Fase 6, OPCIONAL): no abrir en ventana de noticia de
                # alto impacto (spreads se ensanchan, stops teóricos). Gestión de riesgo.
                if ok and run.get("news_filter"):
                    active, ev = self._news_block(run)
                    if active:
                        ok = False
                        why = f"Ventana de noticia de alto impacto ({ev.get('title', 'evento')}) — pausa defensiva."
                # Portfolio heat (Fase 7): no abrir si el riesgo agregado de TODAS las
                # estrategias superaría el límite global.
                if ok and bot_state.portfolio_heat_pct > 0:
                    over, why_heat = self._heat_block(run)
                    if over:
                        ok = False
                        why = why_heat
                if ok:
                    try:
                        # Fidelidad: SL/TP ATR + lote por riesgo% vía el módulo compartido.
                        # Pasa las velas ya descargadas (para el ATR) + el run completo.
                        res = executor.open_market(client, run, signal, closed)
                        if not res.get("opened"):
                            # Una guarda lo impidió (ATR/stops/riesgo%<mínimo/tope). No es un
                            # error: es una protección. Se registra como razón de no-ejecución.
                            executed = False
                            exec_reason = res.get("reason") or "No se abrió (protección de sizing)."
                            journal.append("blocked", run, {"direction": signal, "reason": exec_reason})
                        else:
                            ticket = int(res.get("ticket") or 0)
                            fid = res.get("fidelity") or {}
                            if ticket:
                                run["open_tickets"][ticket] = {
                                    "symbol": run["symbol"], "direction": signal, "volume": res.get("volume"),
                                    "open_price": res.get("entry_price"), "sl": res.get("sl"), "tp": res.get("tp"),
                                    "open_at": _now(), "open_reason": reason, "open_indicators": indicators,
                                    "fidelity": fid,
                                }
                            # Arme "usado": abrió una posición → renueva la actividad (caducidad C).
                            run["last_activity"] = _now()
                            # Journal PERSISTENTE de la apertura (sobrevive reinicios/corte de día).
                            journal.append("open", run, {
                                "ticket": ticket, "direction": signal, "volume": res.get("volume"),
                                "entry": res.get("entry_price"), "sl": res.get("sl"), "tp": res.get("tp"),
                                **fid, "warn": res.get("warn"),
                            })
                            executed = True
                            exec_reason = (res.get("warn") + " ") if res.get("warn") else ""
                            exec_reason += reason
                    except MT5Error as exc:
                        executed = False
                        exec_reason = f"Orden rechazada: {exc.message}"
                else:
                    executed = False
                    exec_reason = why

        bot_state.add_signal(run, signal, executed, exec_reason, indicators, candle_time=ctime)

    def _news_block(self, run: dict[str, Any]) -> tuple[bool, dict[str, Any] | None]:
        """¿Estamos en ventana de noticia de alto impacto para el símbolo? Nunca debe
        tumbar el bot: ante cualquier fallo del calendario, NO bloquea (devuelve False)."""
        try:
            import time

            from ..econcal import news_window_active, symbol_currencies
            from ..econcal.store import load_all, refresh
            refresh()  # throttled (1h)
            return news_window_active(
                int(time.time()), load_all(), symbol_currencies(run["symbol"]),
                int(run.get("news_window_min", 15) or 15),
            )
        except Exception:  # noqa: BLE001
            return False, None


bot_runner = BotRunner()
