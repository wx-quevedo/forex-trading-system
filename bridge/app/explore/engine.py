"""Motor de BÚSQUEDA de estrategias (Fase 8E) — barrido amplio.

Evolución de la optimización (UNA estrategia en UN par) a una BÚSQUEDA a través
de muchas configuraciones: pares × tipos × timeframes × parámetros × SL/TP × riesgo.

Protección anti data-mining (NO negociable): cada configuración se valida
out-of-sample reusando los guardarraíles de la Fase 8 (split in/out, robustez =
consistencia in↔out, mínimo de operaciones, penalización de picos aislados,
veredicto DENTRO/límite/FUERA, costos reales → PnL neto).

Eficiencia: las velas de un (par, timeframe) se descargan UNA vez y se reusan para
TODAS las combinaciones de tipo/parámetros/SL/TP/riesgo de ese par+timeframe, en
vez de re-pedirlas a MT5 cada vez.
"""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable

from ..backtest.engine import run_backtest
from ..optimize.engine import (
    MIN_TRADES,
    _grid,
    _neighbor_out,
    _numeric_keys,
    _params_key,
    _verdict,
)

# Conjuntos que el sistema barre (el usuario elige cuáles incluir).
SL_CHOICES = [15, 20, 30, 50]
TP_CHOICES = [30, 40, 60, 100]
RISK_CHOICES = [0.5, 1.0, 2.0]
SWEEP_TIMEFRAMES = ["M5", "M15", "H1", "H4"]
MAX_CONFIGS = 60000  # tope de seguridad: nº de configuraciones por búsqueda
SPLIT = 0.7  # in-sample / out-of-sample


def grid_size(strategy_type: str) -> int:
    return len(_grid(strategy_type, {}))


def estimate_configs(pairs: list[str], types: list[str], timeframes: list[str],
                     sls: list, tps: list, risks: list) -> int:
    """Nº total de configuraciones (cada una = un set de backtests in/out/full)."""
    per_group = sum(grid_size(t) for t in types)
    return len(pairs) * len(timeframes) * len(sls) * len(tps) * len(risks) * per_group


def _row(pair: str, stype: str, tf: str, params: dict[str, Any], sl: float, tp: float,
         rp: float, full_m: dict[str, Any], in_ret: float, out_ret: float,
         total_tr: int) -> dict[str, Any]:
    return {
        "pair": pair,
        "type": stype,
        "timeframe": tf,
        "params": params,
        "sl_pips": sl,
        "tp_pips": tp,
        "risk_percent": rp,
        "capital_final": full_m["final_balance"],
        "costs": full_m.get("total_costs", 0.0),
        "return_pct": full_m["return_pct"],
        "net_pnl": full_m["net_pnl"],
        "win_rate": full_m["win_rate"],  # FRACCIÓN (0..1); el frontend multiplica ×100
        "profit_factor": full_m.get("profit_factor"),
        "max_drawdown_pct": full_m.get("max_drawdown_pct", 0.0),
        "total_trades": full_m["total_trades"],
        "in_return": round(in_ret, 2),
        "out_return": round(out_ret, 2),
        "robustness_trades": total_tr,  # in+out, para el veredicto
    }


def _evaluate_group(pair: str, stype: str, tf: str, candles: list[dict[str, Any]],
                    in_c: list[dict[str, Any]], out_c: list[dict[str, Any]],
                    sl: float, tp: float, rp: float, cfg: dict[str, Any],
                    on_tick: Callable[[], None], should_cancel: Callable[[], bool]) -> list[dict[str, Any]]:
    """Sweep del grid de parámetros para un (par, tipo, tf, sl, tp, riesgo) fijo.

    Reusa las MISMAS velas (full/in/out) para todas las combinaciones del grid y
    aplica el veredicto de robustez de la Fase 8 (con penalización de picos por
    vecinos dentro de este grupo)."""
    risk = {"sl_pips": sl, "tp_pips": tp, "risk_percent": rp}
    combos = _grid(stype, {})
    collected: list[dict[str, Any]] = []

    for params in combos:
        on_tick()
        if should_cancel():
            break
        try:
            full = run_backtest(stype, params, candles, symbol=pair, timeframe=tf, risk=risk, config=cfg)
            bt_in = run_backtest(stype, params, in_c, symbol=pair, timeframe=tf, risk=risk, config=cfg)
            bt_out = run_backtest(stype, params, out_c, symbol=pair, timeframe=tf, risk=risk, config=cfg)
        except Exception:  # noqa: BLE001 - una combinación inválida no aborta la búsqueda
            continue
        m_in, m_out = bt_in["metrics"], bt_out["metrics"]
        total_tr = int(m_in["total_trades"]) + int(m_out["total_trades"])
        collected.append(_row(pair, stype, tf, params, sl, tp, rp, full["metrics"],
                              float(m_in["return_pct"]), float(m_out["return_pct"]), total_tr))

    # Penalización de picos aislados (mesetas) entre vecinos de grid del MISMO grupo.
    by_key = {_params_key(r["params"]): r["out_return"] for r in collected}
    axes: dict[str, list] = {}
    for r in collected:
        for k in _numeric_keys(r["params"]):
            axes.setdefault(k, [])
            if r["params"][k] not in axes[k]:
                axes[k].append(r["params"][k])
    for k in axes:
        axes[k].sort()

    for r in collected:
        nb = _neighbor_out(r["params"], by_key, axes)
        score, verdict, label = _verdict(r["in_return"], r["out_return"], r.pop("robustness_trades"), nb)
        r["robustness"] = round(score, 3)
        r["stars"] = max(0, min(4, round(score * 4)))
        r["verdict"] = verdict
        r["verdict_label"] = label
    return collected


class ExploreJob:
    """Estado de una búsqueda en curso, protegido por un lock. Una a la vez."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._thread: threading.Thread | None = None
        self.reset()

    def reset(self) -> None:
        self.status = "idle"  # idle | running | done | cancelled | error
        self.total = 0
        self.done = 0
        self.results: list[dict[str, Any]] = []
        self.error: str | None = None
        self.request: dict[str, Any] | None = None
        self.started_at: str | None = None
        self.finished_at: str | None = None
        self.current: str | None = None  # "EURUSD# · H1 · ma_cross"
        self._cancel = False

    # -- control ----------------------------------------------------------
    def is_running(self) -> bool:
        with self._lock:
            return self.status == "running"

    def cancel(self) -> None:
        with self._lock:
            if self.status == "running":
                self._cancel = True

    def _should_cancel(self) -> bool:
        with self._lock:
            return self._cancel

    def snapshot(self, include_results: bool = False) -> dict[str, Any]:
        with self._lock:
            inside = sum(1 for r in self.results if r.get("verdict") == "inside")
            data = {
                "status": self.status,
                "total": self.total,
                "done": self.done,
                "results_count": len(self.results),
                "inside_count": inside,
                "current": self.current,
                "error": self.error,
                "started_at": self.started_at,
                "finished_at": self.finished_at,
                "request": self.request,
            }
            if include_results:
                data["results"] = list(self.results)
            return data

    # -- ejecución --------------------------------------------------------
    def start(self, req: dict[str, Any], client: Any) -> dict[str, Any]:
        with self._lock:
            if self.status == "running":
                raise RuntimeError("Ya hay una búsqueda en curso.")
            self.reset()
            self.status = "running"
            self.request = req
            self.started_at = datetime.now(timezone.utc).isoformat()
            self.total = estimate_configs(
                req["pairs"], req["types"], req["timeframes"],
                req["sl_choices"], req["tp_choices"], req["risk_choices"],
            )
        self._thread = threading.Thread(target=self._run, args=(req, client), daemon=True)
        self._thread.start()
        return self.snapshot()

    def _tick(self) -> None:
        with self._lock:
            self.done += 1

    def _skip(self, k: int, why: str) -> None:
        with self._lock:
            self.done += k
            self.current = why

    def _set_current(self, label: str) -> None:
        with self._lock:
            self.current = label

    def _run(self, req: dict[str, Any], client: Any) -> None:
        try:
            self._search(req, client)
            with self._lock:
                if self._cancel:
                    self.status = "cancelled"
                else:
                    self.status = "done"
                self.finished_at = datetime.now(timezone.utc).isoformat()
                self.current = None
        except Exception as exc:  # noqa: BLE001 - cualquier fallo deja el job en error
            with self._lock:
                self.status = "error"
                self.error = str(exc)
                self.finished_at = datetime.now(timezone.utc).isoformat()

    def _search(self, req: dict[str, Any], client: Any) -> None:
        pairs: list[str] = req["pairs"]
        types: list[str] = req["types"]
        tfs: list[str] = req["timeframes"]
        sls = req["sl_choices"]
        tps = req["tp_choices"]
        risks = req["risk_choices"]
        date_from = req["date_from"]
        date_to = req["date_to"]
        capital = float(req.get("capital", 10000.0))

        # configuraciones por (par, tf): para avanzar el progreso si se salta el grupo.
        per_group = sum(grid_size(t) for t in types)
        configs_per_pair_tf = per_group * len(sls) * len(tps) * len(risks)

        for pair in pairs:
            if self._should_cancel():
                return
            try:
                costs = client.symbol_costs(pair) or {}
            except Exception:  # noqa: BLE001
                costs = {}
            cfg_base = {**costs, "initial_balance": capital}

            for tf in tfs:
                if self._should_cancel():
                    return
                self._set_current(f"{pair} · {tf} · descargando velas")
                try:
                    candles = client.candles(pair, tf, date_from=date_from, date_to=date_to)
                except Exception:  # noqa: BLE001 - sin velas saltamos el grupo entero
                    self._skip(configs_per_pair_tf, f"{pair} · {tf}: sin velas")
                    continue

                n = len(candles)
                if n < 120:
                    self._skip(configs_per_pair_tf, f"{pair} · {tf}: insuficientes velas ({n})")
                    continue

                cut = int(n * SPLIT)
                in_c, out_c = candles[:cut], candles[cut:]

                for stype in types:
                    for sl in sls:
                        for tp in tps:
                            for rp in risks:
                                if self._should_cancel():
                                    return
                                self._set_current(f"{pair} · {tf} · {stype} · SL{sl}/TP{tp} · {rp}%")
                                rows = _evaluate_group(
                                    pair, stype, tf, candles, in_c, out_c, sl, tp, rp,
                                    cfg_base, self._tick, self._should_cancel,
                                )
                                with self._lock:
                                    self.results.extend(rows)


job = ExploreJob()
