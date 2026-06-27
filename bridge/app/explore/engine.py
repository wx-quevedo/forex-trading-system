"""Motor de BÚSQUEDA de estrategias (Fase 8E) — barrido amplio, multi-núcleo.

Evolución de la optimización (UNA estrategia en UN par) a una BÚSQUEDA a través
de muchas configuraciones: pares × tipos × timeframes × parámetros × SL/TP × riesgo.

Protección anti data-mining (NO negociable): cada configuración se valida
out-of-sample reusando los guardarraíles de la Fase 8 (split in/out, robustez =
consistencia in↔out, mínimo de operaciones, penalización de picos aislados,
veredicto DENTRO/límite/FUERA, costos reales → PnL neto).

Rendimiento (Fase: velocidad):
- Las velas de un (par, timeframe) se descargan UNA vez desde MT5 (proceso
  principal) y se reusan para TODAS las combinaciones de ese par+tf.
- El CÁLCULO (backtests) se reparte entre múltiples núcleos con
  ProcessPoolExecutor: los workers son CPU puro (no tocan MT5), así se aprovecha
  el i9 completo. Con workers=1 el barrido corre en serie (útil para diagnóstico).
- Instrumentación: tiempo en MT5 vs cálculo, nº de descargas de velas, velocidad
  (configs/seg) y ETA — expuestos en el snapshot.
"""

from __future__ import annotations

import os
import threading
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any

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


def default_workers() -> int:
    """Por defecto: núcleos − 2 (deja margen para no congelar la máquina)."""
    return max(1, (os.cpu_count() or 2) - 2)


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
                    sl: float, tp: float, rp: float, cfg: dict[str, Any]) -> list[dict[str, Any]]:
    """Sweep del grid de parámetros para un (par, tipo, tf, sl, tp, riesgo) fijo.

    Función PURA (sin MT5, sin estado compartido) → ejecutable en un proceso worker.
    Reusa las MISMAS velas (full/in/out) para todas las combos del grid y aplica el
    veredicto de robustez de la Fase 8 (penalización de picos por vecinos del grupo)."""
    risk = {"sl_pips": sl, "tp_pips": tp, "risk_percent": rp}
    combos = _grid(stype, {})
    collected: list[dict[str, Any]] = []

    for params in combos:
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


def _group_worker(task: tuple) -> tuple[list[dict[str, Any]], float, int]:
    """Ejecutado en un proceso worker: evalúa un grupo y reporta su tiempo de cálculo."""
    pair, stype, tf, candles, sl, tp, rp, cfg, split = task
    t0 = time.perf_counter()
    n = len(candles)
    cut = int(n * split)
    rows = _evaluate_group(pair, stype, tf, candles, candles[:cut], candles[cut:], sl, tp, rp, cfg)
    return rows, time.perf_counter() - t0, grid_size(stype)


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
        self.current: str | None = None
        self.workers = 1
        # Instrumentación / diagnóstico.
        self._t_start = 0.0
        self._t_end = 0.0
        self.t_mt5 = 0.0          # segundos descargando velas de MT5 (wall, proceso principal)
        self.t_compute = 0.0      # segundos-CPU de cálculo (suma de todos los workers)
        self.candle_fetches = 0   # nº de descargas de velas (debe ≈ pares×timeframes únicos)
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

    def _elapsed(self) -> float:
        if not self._t_start:
            return 0.0
        end = self._t_end or time.monotonic()
        return max(0.0, end - self._t_start)

    def snapshot(self, include_results: bool = False) -> dict[str, Any]:
        with self._lock:
            inside = sum(1 for r in self.results if r.get("verdict") == "inside")
            elapsed = self._elapsed()
            speed = (self.done / elapsed) if elapsed > 0 and self.done else 0.0
            remaining = max(0, self.total - self.done)
            eta = (remaining / speed) if speed > 0 else None
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
                # Velocidad / monitoreo.
                "workers": self.workers,
                "elapsed_seconds": round(elapsed, 2),
                "speed_per_sec": round(speed, 2),
                "speed_per_min": round(speed * 60, 1),
                "eta_seconds": round(eta, 1) if eta is not None else None,
                # Diagnóstico de cuello de botella.
                "t_mt5_seconds": round(self.t_mt5, 2),
                "t_compute_seconds": round(self.t_compute, 2),
                "candle_fetches": self.candle_fetches,
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
            self.workers = int(req.get("workers") or default_workers())
            self.started_at = datetime.now(timezone.utc).isoformat()
            self._t_start = time.monotonic()
            self.total = estimate_configs(
                req["pairs"], req["types"], req["timeframes"],
                req["sl_choices"], req["tp_choices"], req["risk_choices"],
            )
        self._thread = threading.Thread(target=self._run, args=(req, client), daemon=True)
        self._thread.start()
        return self.snapshot()

    def _add_done(self, k: int) -> None:
        with self._lock:
            self.done += k

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
                self._t_end = time.monotonic()
                self.finished_at = datetime.now(timezone.utc).isoformat()
                self.current = None
        except Exception as exc:  # noqa: BLE001 - cualquier fallo deja el job en error
            with self._lock:
                self.status = "error"
                self.error = str(exc)
                self._t_end = time.monotonic()
                self.finished_at = datetime.now(timezone.utc).isoformat()

    def _fetch_all_candles(self, pairs: list[str], tfs: list[str], date_from, date_to,
                           client: Any) -> tuple[dict[tuple[str, str], list], dict[str, dict]]:
        """Descarga UNA vez las velas de cada (par, tf) y los costos de cada par (MT5)."""
        candle_cache: dict[tuple[str, str], list] = {}
        costs_cache: dict[str, dict] = {}
        for pair in pairs:
            if self._should_cancel():
                break
            t0 = time.perf_counter()
            try:
                costs_cache[pair] = client.symbol_costs(pair) or {}
            except Exception:  # noqa: BLE001
                costs_cache[pair] = {}
            for tf in tfs:
                if self._should_cancel():
                    break
                self._set_current(f"{pair} · {tf} · descargando velas")
                try:
                    candle_cache[(pair, tf)] = client.candles(pair, tf, date_from=date_from, date_to=date_to)
                except Exception:  # noqa: BLE001 - sin velas: grupo vacío
                    candle_cache[(pair, tf)] = []
                with self._lock:
                    self.candle_fetches += 1
            self.t_mt5 += time.perf_counter() - t0
        return candle_cache, costs_cache

    def _search(self, req: dict[str, Any], client: Any) -> None:
        pairs: list[str] = req["pairs"]
        types: list[str] = req["types"]
        tfs: list[str] = req["timeframes"]
        sls = req["sl_choices"]
        tps = req["tp_choices"]
        risks = req["risk_choices"]
        capital = float(req.get("capital", 10000.0))

        # 1) MT5 SOLO aquí: descargar todas las velas necesarias una vez (reuso).
        candle_cache, costs_cache = self._fetch_all_candles(pairs, tfs, req["date_from"], req["date_to"], client)
        if self._should_cancel():
            return

        # 2) Construir la lista de tareas de CÁLCULO (sin MT5). Cada tarea = un grupo
        #    (par, tipo, tf, sl, tp, riesgo) cuyo worker barre el grid de parámetros.
        configs_per_group_set = sum(grid_size(t) for t in types) * len(sls) * len(tps) * len(risks)
        tasks: list[tuple] = []
        for pair in pairs:
            cfg_base = {**costs_cache.get(pair, {}), "initial_balance": capital}
            for tf in tfs:
                candles = candle_cache.get((pair, tf), [])
                if len(candles) < 120:  # grupo inviable → avanzar el progreso igual
                    self._add_done(configs_per_group_set)
                    continue
                for stype in types:
                    for sl in sls:
                        for tp in tps:
                            for rp in risks:
                                tasks.append((pair, stype, tf, candles, sl, tp, rp, cfg_base, SPLIT))

        if not tasks:
            return

        # 3) Ejecutar el cálculo en PROCESOS (incluso con 1 worker), para que el
        #    cómputo CPU-bound nunca retenga el GIL del proceso del servidor y el
        #    bridge siga respondiendo (/status, /cancel) durante el barrido.
        #    `inprocess` (solo tests) corre en el hilo, sin spawnear procesos.
        if req.get("inprocess"):
            self._run_sequential(tasks)
        else:
            self._run_parallel(tasks)

    def _consume(self, rows: list[dict[str, Any]], compute_s: float, grid: int, label: str) -> None:
        with self._lock:
            self.results.extend(rows)
            self.done += grid
            self.t_compute += compute_s
            self.current = label

    def _run_sequential(self, tasks: list[tuple]) -> None:
        for task in tasks:
            if self._should_cancel():
                return
            pair, stype, tf = task[0], task[1], task[2]
            self._set_current(f"{pair} · {tf} · {stype}")
            rows, compute_s, grid = _group_worker(task)
            self._consume(rows, compute_s, grid, f"{pair} · {tf} · {stype}")

    def _run_parallel(self, tasks: list[tuple]) -> None:
        ex = ProcessPoolExecutor(max_workers=self.workers)
        try:
            futures = {ex.submit(_group_worker, t): (t[0], t[1], t[2]) for t in tasks}
            for fut in as_completed(futures):
                if self._should_cancel():
                    ex.shutdown(wait=False, cancel_futures=True)
                    return
                pair, stype, tf = futures[fut]
                try:
                    rows, compute_s, grid = fut.result()
                except Exception:  # noqa: BLE001 - un grupo que falle no aborta el resto
                    rows, compute_s, grid = [], 0.0, grid_size(stype)
                self._consume(rows, compute_s, grid, f"{pair} · {tf} · {stype}")
        finally:
            ex.shutdown(wait=False, cancel_futures=True)


job = ExploreJob()
