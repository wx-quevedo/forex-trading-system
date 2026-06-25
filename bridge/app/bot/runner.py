"""Loop de ejecución del bot: evalúa en cada vela cerrada y opera con seguridad."""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any

from ..mt5_client import MT5Error, client
from ..strategy import evaluate_strategy
from . import executor
from .guards import can_open, daily_limit_hit
from .state import bot_state

_DEFAULT_POLL = 10.0  # segundos entre comprobaciones (la acción es por vela cerrada)


class BotRunner:
    def __init__(self, poll: float = _DEFAULT_POLL) -> None:
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self.poll = poll

    # -- control ----------------------------------------------------------
    def start(self, config: dict[str, Any]) -> None:
        s = bot_state
        with s.lock():
            s.bot_run_id = config.get("bot_run_id")
            s.strategy_type = config["strategy_type"]
            s.params = config.get("params", {})
            # Resolver al símbolo OPERABLE del broker (EURUSD -> EURUSD#) para que
            # velas, precio, posiciones y órdenes usen todos el mismo símbolo real.
            requested = config["symbol"].upper()
            try:
                s.symbol = client.resolve_tradable_symbol(requested)
            except Exception:  # noqa: BLE001 - si falla, usar el solicitado
                s.symbol = requested
            s.timeframe = config["timeframe"]
            s.lot = float(config.get("lot", 0.01))
            s.sl_pips = float(config.get("sl_pips", 20))
            s.tp_pips = float(config.get("tp_pips", 40))
            s.daily_loss_limit = float(config.get("daily_loss_limit", 100))
            s.max_positions = int(config.get("max_positions", 1))
            s.day = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")
            s.realized_pnl_today = 0.0
            s.last_candle_time = None
            s.error = None
            s.stop_reason = None
            s.started_at = datetime.now(tz=timezone.utc).isoformat()
            s.status = "running"
        s.save()
        self._ensure_thread()

    def pause(self) -> None:
        with bot_state.lock():
            if bot_state.status == "running":
                bot_state.status = "paused"
        bot_state.save()

    def resume(self) -> None:
        with bot_state.lock():
            if bot_state.status == "paused":
                bot_state.status = "running"
                bot_state.stop_reason = None
        bot_state.save()
        self._ensure_thread()

    def stop(self) -> None:
        with bot_state.lock():
            bot_state.status = "stopped"
            bot_state.stop_reason = bot_state.stop_reason or "Detenido por el usuario."
        bot_state.save()
        self._stop.set()

    def panic(self) -> dict[str, Any]:
        """Cierra TODAS las posiciones y detiene el bot. Prioridad de seguridad."""
        result = executor.close_all(client)
        with bot_state.lock():
            bot_state.status = "stopped"
            bot_state.stop_reason = "PANIC: todas las posiciones cerradas."
            bot_state.open_tickets = {}
        bot_state.save()
        self._stop.set()
        return result

    # -- estado -----------------------------------------------------------
    def status(self) -> dict[str, Any]:
        positions: list[dict[str, Any]] = []
        floating = 0.0
        try:
            positions = executor.bot_positions(client)
            floating = sum(float(p.get("profit", 0.0)) for p in positions)
        except Exception:  # noqa: BLE001 - status nunca debe romper
            pass
        return bot_state.snapshot(positions, floating)

    # -- loop -------------------------------------------------------------
    def _ensure_thread(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="bot-runner", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                if bot_state.status != "running":
                    self._stop.wait(self.poll)
                    continue

                bot_state.roll_day_if_needed()
                self._reconcile_closed()

                floating, daily = self._pnl()
                if daily_limit_hit(bot_state, daily):
                    with bot_state.lock():
                        bot_state.status = "stopped"
                        bot_state.stop_reason = f"Límite de pérdida diaria alcanzado (PnL {daily:.2f})."
                    bot_state.save()
                    break

                self._evaluate_on_close()
                bot_state.save()
            except MT5Error as exc:
                self._fail(f"MT5: {exc.message}")
                break
            except Exception as exc:  # noqa: BLE001 - fail-safe
                self._fail(str(exc))
                break
            self._stop.wait(self.poll)

    def _fail(self, message: str) -> None:
        with bot_state.lock():
            bot_state.status = "error"
            bot_state.error = message
            bot_state.stop_reason = "Error crítico: el bot se detuvo."
        bot_state.save()

    def _pnl(self) -> tuple[float, float]:
        floating = sum(float(p.get("profit", 0.0)) for p in executor.bot_positions(client))
        return floating, bot_state.realized_pnl_today + floating

    def _reconcile_closed(self) -> None:
        """Detecta posiciones del bot cerradas por SL/TP y registra el trade."""
        current = {int(p["ticket"]): p for p in executor.bot_positions(client)}
        for ticket in list(bot_state.open_tickets):
            if ticket in current:
                continue
            rec = bot_state.open_tickets.pop(ticket, {})
            info = None
            try:
                info = client.closed_position_pnl(ticket)
            except Exception:  # noqa: BLE001
                pass
            bot_state.record_closed_trade(
                {
                    "ticket": ticket,
                    "symbol": rec.get("symbol", bot_state.symbol),
                    "direction": rec.get("direction"),
                    "volume": rec.get("volume"),
                    "open_price": rec.get("open_price"),
                    "close_price": (info or {}).get("close_price"),
                    "sl": rec.get("sl"),
                    "tp": rec.get("tp"),
                    "open_at": rec.get("open_at"),
                    "close_at": datetime.now(tz=timezone.utc).isoformat(),
                    "pnl": (info or {}).get("pnl", 0.0),
                    "exit_reason": "sl_tp",
                }
            )

    def _evaluate_on_close(self) -> None:
        candles = client.candles(bot_state.symbol, bot_state.timeframe, count=300)
        if len(candles) < 30:
            return
        closed = candles[:-1]  # descartar la vela en formación
        ctime = int(closed[-1]["time"])
        if ctime == bot_state.last_candle_time:
            return  # aún no cerró una vela nueva
        bot_state.last_candle_time = ctime

        result = evaluate_strategy(bot_state.strategy_type, bot_state.params, closed)
        signal = result.get("signal", "none")
        reason = result.get("reason", "")
        indicators = result.get("indicators", {})

        executed = False
        exec_reason = reason

        if signal in ("buy", "sell"):
            # Cerrar posiciones del bot en sentido contrario (señal opuesta).
            for p in executor.bot_positions(client, bot_state.symbol):
                ptype = "buy" if p["type"] == 0 else "sell"
                if ptype != signal:
                    try:
                        client.close_position(int(p["ticket"]))
                    except Exception:  # noqa: BLE001
                        pass

            same_symbol = executor.bot_positions(client, bot_state.symbol)
            total_open = len(executor.bot_positions(client))
            _, daily = self._pnl()

            if not same_symbol:  # plano en este símbolo
                ok, why = can_open(bot_state, total_open, daily)
                if ok:
                    try:
                        res = executor.open_market(
                            client, bot_state.symbol, signal,
                            bot_state.lot, bot_state.sl_pips, bot_state.tp_pips,
                        )
                        ticket = int(res.get("ticket") or 0)
                        if ticket:
                            bot_state.open_tickets[ticket] = {
                                "symbol": bot_state.symbol,
                                "direction": signal,
                                "volume": bot_state.lot,
                                "open_price": res.get("entry_price"),
                                "sl": res.get("sl"),
                                "tp": res.get("tp"),
                                "open_at": datetime.now(tz=timezone.utc).isoformat(),
                            }
                        executed = True
                        exec_reason = reason
                    except MT5Error as exc:
                        executed = False
                        exec_reason = f"Orden rechazada: {exc.message}"
                else:
                    executed = False
                    exec_reason = why

        bot_state.add_signal(bot_state.symbol, signal, executed, exec_reason, indicators)


bot_runner = BotRunner()
