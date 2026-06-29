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
from pathlib import Path
from typing import Any

from ..backtest.engine import run_backtest
from ..strategy.regime import classify_regime
from ..optimize.engine import (
    MIN_TRADES,
    _grid,
    _neighbor_out,
    _numeric_keys,
    _params_key,
    _verdict,
)
from .cache import ENGINE_VERSION, ExploreCache, make_cache_key, params_key_of

# Caché de resultados por combinación (SQLite, junto al bridge).
_CACHE_PATH = Path(__file__).resolve().parent.parent.parent / "explore_cache.db"
_default_cache = ExploreCache(_CACHE_PATH)

# Conjuntos que el sistema barre (el usuario elige cuáles incluir).
SL_CHOICES = [15, 20, 30, 50]
TP_CHOICES = [30, 40, 60, 100]
RISK_CHOICES = [0.5, 1.0, 2.0]
# Multiplicadores de ATR (modo SL/TP adaptativo, Fase 1): SL=N×ATR, TP=M×ATR.
ATR_SL_CHOICES = [1.5, 2.0, 3.0]
ATR_TP_CHOICES = [2.0, 3.0, 4.0]
SWEEP_TIMEFRAMES = ["M5", "M15", "H1", "H4"]
EXPLORE_TYPES = ["ma_cross", "rsi", "macd", "bollinger", "combined",
                 "supertrend", "ichimoku", "donchian", "stochastic", "cci", "psar"]
MAX_CONFIGS = 200000  # máximo absoluto de seguridad (rechazo por encima)
WARN_CONFIGS = 20000  # a partir de aquí el frontend pide confirmación (no bloquea)
SPLIT = 0.7  # in-sample / out-of-sample
STALE_SECONDS = 180  # sin latido por más de esto → job huérfano (se libera solo)


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


def expectancy_r(win_rate: float, sl: float, tp: float) -> float | None:
    """Expectativa por operación en múltiplos de R (Fase 2).

    win% × (TP/SL) − (1−win%). Clave para juzgar combinaciones con R/R desfavorable
    (TP<SL) pero alto win rate: p.ej. win 60% SL50/TP40 (R/R 0.8) → +0.08 R (positiva
    pese a R/R<1). None si SL es 0 (no hay ratio definido)."""
    if not sl:
        return None
    return round(win_rate * (tp / sl) - (1.0 - win_rate), 3)


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
        "sharpe": full_m.get("sharpe"),       # ya anualizado en _compute_metrics
        "sortino": full_m.get("sortino"),
        "calmar": full_m.get("calmar"),
        "expectancy_r": expectancy_r(full_m["win_rate"], sl, tp),
        "total_trades": full_m["total_trades"],
        "blown": bool(full_m.get("blown", False)),  # cuenta quebrada en el periodo
        "in_return": round(in_ret, 2),
        "out_return": round(out_ret, 2),
        "robustness_trades": total_tr,  # in+out, para el veredicto
    }


def _compute_combo(pair: str, stype: str, tf: str, candles: list[dict[str, Any]],
                   in_c: list[dict[str, Any]], out_c: list[dict[str, Any]],
                   params: dict[str, Any], sl: float, tp: float, rp: float,
                   cfg: dict[str, Any]) -> dict[str, Any] | None:
    """Evalúa UNA combinación (full + in + out). Devuelve la fila PARCIAL (sin
    veredicto) o None si es inválida. Función pura (sin MT5, sin estado)."""
    # sl_mode/atr_period viajan en cfg (constantes de la búsqueda, como el capital).
    risk = {
        "sl_pips": sl, "tp_pips": tp, "risk_percent": rp,
        "sl_mode": cfg.get("sl_mode", "fixed"), "atr_period": int(cfg.get("atr_period", 14)),
    }
    try:
        full = run_backtest(stype, params, candles, symbol=pair, timeframe=tf, risk=risk, config=cfg)
        bt_in = run_backtest(stype, params, in_c, symbol=pair, timeframe=tf, risk=risk, config=cfg)
        bt_out = run_backtest(stype, params, out_c, symbol=pair, timeframe=tf, risk=risk, config=cfg)
    except Exception:  # noqa: BLE001 - una combinación inválida no aborta la búsqueda
        return None
    m_in, m_out = bt_in["metrics"], bt_out["metrics"]
    total_tr = int(m_in["total_trades"]) + int(m_out["total_trades"])
    row = _row(pair, stype, tf, params, sl, tp, rp, full["metrics"],
               float(m_in["return_pct"]), float(m_out["return_pct"]), total_tr)
    row["sl_mode"] = cfg.get("sl_mode", "fixed")
    return row


def _finalize_group(partials: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Pasa el veredicto de robustez (Fase 8) sobre el grupo COMPLETO (cacheados +
    calculados). Determinista; barato (sin backtests). Penaliza picos por vecinos."""
    by_key = {_params_key(r["params"]): r["out_return"] for r in partials}
    axes: dict[str, list] = {}
    for r in partials:
        for k in _numeric_keys(r["params"]):
            axes.setdefault(k, [])
            if r["params"][k] not in axes[k]:
                axes[k].append(r["params"][k])
    for k in axes:
        axes[k].sort()

    for r in partials:
        nb = _neighbor_out(r["params"], by_key, axes)
        total_tr = r.pop("robustness_trades", r.get("total_trades", 0))
        score, verdict, label = _verdict(r["in_return"], r["out_return"], total_tr, nb)
        r["robustness"] = round(score, 3)
        r["stars"] = max(0, min(4, round(score * 4)))
        r["verdict"] = verdict
        r["verdict_label"] = label
    return partials


def _missing_worker(task: tuple) -> tuple[list[dict[str, Any]], float]:
    """Worker (proceso aparte): calcula SOLO las combinaciones faltantes (las que no
    estaban en caché) de un grupo. Devuelve filas parciales + tiempo de cálculo."""
    pair, stype, tf, candles, sl, tp, rp, cfg, split, missing_params = task
    t0 = time.perf_counter()
    n = len(candles)
    cut = int(n * split)
    in_c, out_c = candles[:cut], candles[cut:]
    rows = []
    for params in missing_params:
        row = _compute_combo(pair, stype, tf, candles, in_c, out_c, params, sl, tp, rp, cfg)
        if row is not None:
            rows.append(row)
    # El gc periódico para evitar el access violation de pandas/numpy en Windows
    # vive en run_backtest (cubre todos los llamadores de forma uniforme).
    return rows, time.perf_counter() - t0


class ExploreJob:
    """Estado de una búsqueda en curso, protegido por un lock. Una a la vez.

    Auto-liberación de huérfanos: el job late (`_last_beat`) mientras avanza; si está
    marcado 'running' pero sin latido reciente (> STALE_SECONDS) se considera MUERTO
    y deja de bloquear nuevas búsquedas. El estado vive SOLO en memoria, así que un
    reinicio del bridge arranca limpio (sin job fantasma). Cada arranque incrementa
    `_run_id`: un hilo viejo superado no puede corromper el estado del run nuevo."""

    def __init__(self, cache: ExploreCache | None = None) -> None:
        self._lock = threading.RLock()
        self._thread: threading.Thread | None = None
        self._run_id = 0
        self._executor: ProcessPoolExecutor | None = None
        self._cache = cache if cache is not None else _default_cache
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
        self._executor = None
        # Instrumentación / diagnóstico.
        self._t_start = 0.0
        self._t_end = 0.0
        self._last_beat = 0.0     # último avance (monotonic); base del heartbeat
        self.t_mt5 = 0.0          # segundos descargando velas de MT5 (wall, proceso principal)
        self.t_compute = 0.0      # segundos-CPU de cálculo (suma de todos los workers)
        self.candle_fetches = 0   # nº de descargas de velas (debe ≈ pares×timeframes únicos)
        self.cache_hits = 0       # combinaciones traídas de la caché (no recalculadas)
        self.cache_misses = 0     # combinaciones calculadas (y guardadas en caché)
        self._use_cache = True
        self._cancel = False

    # -- control / salud --------------------------------------------------
    def _beat(self) -> None:
        self._last_beat = time.monotonic()

    def _beat_age(self) -> float | None:
        if self.status != "running" or not self._last_beat:
            return None
        return time.monotonic() - self._last_beat

    def is_stale(self) -> bool:
        """¿Marcado 'running' pero sin avance reciente? (huérfano/zombi)."""
        with self._lock:
            age = self._beat_age()
            return age is not None and age > STALE_SECONDS

    def is_running(self) -> bool:
        """Vivo de verdad: 'running' Y con latido reciente. Un huérfano NO cuenta."""
        with self._lock:
            if self.status != "running":
                return False
            age = self._beat_age()
            return age is None or age <= STALE_SECONDS

    def cancel(self) -> None:
        with self._lock:
            if self.status == "running":
                self._cancel = True

    def force_reset(self) -> dict[str, Any]:
        """Libera el job a la fuerza (huérfano o en curso): cancela, apaga el pool
        y deja el estado limpio para nuevas búsquedas. Supera cualquier hilo viejo."""
        with self._lock:
            ex = self._executor
            self._cancel = True
            self._run_id += 1  # invalida el run anterior (sus writes se ignorarán)
        if ex is not None:
            try:
                ex.shutdown(wait=False, cancel_futures=True)
            except Exception:  # noqa: BLE001
                pass
        with self._lock:
            self.reset()
            return self.snapshot()

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
            age = self._beat_age()
            stale = age is not None and age > STALE_SECONDS
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
                # Salud / auto-liberación.
                "stale": stale,
                "stale_after_seconds": STALE_SECONDS,
                "last_beat_age": round(age, 1) if age is not None else None,
                # Diagnóstico de cuello de botella.
                "t_mt5_seconds": round(self.t_mt5, 2),
                "t_compute_seconds": round(self.t_compute, 2),
                "candle_fetches": self.candle_fetches,
                # Caché de resultados.
                "cache_hits": self.cache_hits,
                "cache_misses": self.cache_misses,
            }
            if include_results:
                data["results"] = list(self.results)
            return data

    # -- ejecución --------------------------------------------------------
    def start(self, req: dict[str, Any], client: Any) -> dict[str, Any]:
        with self._lock:
            # Solo bloquea si hay un job VIVO de verdad (con latido reciente).
            if self.status == "running":
                age = self._beat_age()
                if age is None or age <= STALE_SECONDS:
                    raise RuntimeError("Ya hay una búsqueda en curso.")
                # Huérfano: lo superamos (su hilo viejo no podrá escribir el nuevo run).
                stale_ex = self._executor
            else:
                stale_ex = None
        if stale_ex is not None:
            try:
                stale_ex.shutdown(wait=False, cancel_futures=True)
            except Exception:  # noqa: BLE001
                pass
        with self._lock:
            self.reset()
            self._run_id += 1
            run_id = self._run_id
            self.status = "running"
            self.request = req
            self.workers = int(req.get("workers") or default_workers())
            self.started_at = datetime.now(timezone.utc).isoformat()
            self._t_start = time.monotonic()
            self._beat()
            self.total = estimate_configs(
                req["pairs"], req["types"], req["timeframes"],
                req["sl_choices"], req["tp_choices"], req["risk_choices"],
            )
        # `sync` (solo tests): corre en el hilo del llamador → pandas en el hilo
        # principal (numpy/pandas en hilos secundarios es inestable en Windows).
        if req.get("sync"):
            self._thread = None
            self._run(req, client, run_id)
        else:
            self._thread = threading.Thread(target=self._run, args=(req, client, run_id), daemon=True)
            self._thread.start()
        return self.snapshot()

    def _is_current(self, run_id: int) -> bool:
        return self._run_id == run_id

    def _add_done(self, run_id: int, k: int) -> None:
        with self._lock:
            if not self._is_current(run_id):
                return
            self.done += k
            self._beat()

    def _set_current(self, run_id: int, label: str) -> None:
        with self._lock:
            if not self._is_current(run_id):
                return
            self.current = label
            self._beat()

    def _run(self, req: dict[str, Any], client: Any, run_id: int) -> None:
        try:
            self._search(req, client, run_id)
            with self._lock:
                if self._is_current(run_id):
                    self.status = "cancelled" if self._cancel else "done"
                    self._t_end = time.monotonic()
                    self.finished_at = datetime.now(timezone.utc).isoformat()
                    self.current = None
        except Exception as exc:  # noqa: BLE001 - cualquier fallo deja el job en error
            with self._lock:
                if self._is_current(run_id):
                    self.status = "error"
                    self.error = str(exc)
                    self._t_end = time.monotonic()
                    self.finished_at = datetime.now(timezone.utc).isoformat()

    def _fetch_all_candles(self, pairs: list[str], tfs: list[str], date_from, date_to,
                           client: Any, run_id: int) -> tuple[dict[tuple[str, str], list], dict[str, dict]]:
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
                self._set_current(run_id, f"{pair} · {tf} · descargando velas")
                try:
                    candle_cache[(pair, tf)] = client.candles(pair, tf, date_from=date_from, date_to=date_to)
                except Exception:  # noqa: BLE001 - sin velas: grupo vacío
                    candle_cache[(pair, tf)] = []
                with self._lock:
                    self.candle_fetches += 1
            self.t_mt5 += time.perf_counter() - t0
        return candle_cache, costs_cache

    def _search(self, req: dict[str, Any], client: Any, run_id: int) -> None:
        pairs: list[str] = req["pairs"]
        types: list[str] = req["types"]
        tfs: list[str] = req["timeframes"]
        sls = req["sl_choices"]
        tps = req["tp_choices"]
        risks = req["risk_choices"]
        capital = float(req.get("capital", 10000.0))
        sl_mode = str(req.get("sl_mode") or "fixed").lower()
        atr_period = int(req.get("atr_period") or 14)

        # 1) MT5 SOLO aquí: descargar todas las velas necesarias una vez (reuso).
        candle_cache, costs_cache = self._fetch_all_candles(pairs, tfs, req["date_from"], req["date_to"], client, run_id)
        if self._should_cancel():
            return

        # 2) Planificar por grupo (par, tipo, tf, sl, tp, riesgo). Para cada grupo se
        #    consulta la CACHÉ (en este proceso, único escritor → sin contención): lo
        #    cacheado es instantáneo; solo lo faltante se manda a calcular a workers.
        self._use_cache = bool(req.get("use_cache", True)) and self._cache is not None
        date_from, date_to = req["date_from"], req["date_to"]
        configs_per_group_set = sum(grid_size(t) for t in types) * len(sls) * len(tps) * len(risks)

        regime_cache: dict[tuple[str, str], dict[str, Any]] = {}
        plans: list[dict[str, Any]] = []
        for pair in pairs:
            cfg_base = {**costs_cache.get(pair, {}), "initial_balance": capital,
                        "sl_mode": sl_mode, "atr_period": atr_period}
            for tf in tfs:
                candles = candle_cache.get((pair, tf), [])
                if len(candles) < 120:  # grupo inviable → avanzar el progreso igual
                    self._add_done(run_id, configs_per_group_set)
                    continue
                # Régimen del periodo: una vez por (par, tf), metadato para las filas.
                if (pair, tf) not in regime_cache:
                    try:
                        regime_cache[(pair, tf)] = classify_regime(candles)
                    except Exception:  # noqa: BLE001 - el régimen no debe abortar la búsqueda
                        regime_cache[(pair, tf)] = {"regime": None, "confidence": 0.0}
                for stype in types:
                    combos = _grid(stype, {})
                    for sl in sls:
                        for tp in tps:
                            for rp in risks:
                                cached, missing = [], list(combos)
                                if self._use_cache:
                                    keys = [make_cache_key(pair, stype, tf, p, sl, tp, rp, cfg_base, date_from, date_to, sl_mode, atr_period) for p in combos]
                                    hit_map = self._cache.get_many(keys)
                                    cached, missing = [], []
                                    for p, k in zip(combos, keys):
                                        hit = hit_map.get(k)
                                        (cached if hit is not None else missing).append(hit if hit is not None else p)
                                plans.append({
                                    "ctx": (pair, stype, tf, sl, tp, rp),
                                    "candles": candles, "cfg": cfg_base,
                                    "from": date_from, "to": date_to,
                                    "cached": cached, "missing": missing,
                                    "grid": len(combos), "hits": len(cached), "misses": len(missing),
                                    "regime": regime_cache.get((pair, tf), {}),
                                })

        if not plans:
            return

        # 3) Ejecutar: lo totalmente cacheado se finaliza inline (instantáneo); el
        #    resto va a PROCESOS (aprovecha la CPU y no retiene el GIL del servidor).
        #    `inprocess` (solo tests) corre en el hilo, sin spawnear procesos.
        self._run_plans(plans, run_id, inprocess=bool(req.get("inprocess")))

    def _task_of(self, plan: dict[str, Any]) -> tuple:
        pair, stype, tf, sl, tp, rp = plan["ctx"]
        return (pair, stype, tf, plan["candles"], sl, tp, rp, plan["cfg"], SPLIT, plan["missing"])

    def _finalize_and_consume(self, run_id: int, plan: dict[str, Any],
                              computed: list[dict[str, Any]], compute_s: float) -> None:
        # Guardar en caché lo recién calculado (parciales, sin veredicto).
        if self._use_cache and computed:
            pair, stype, tf, sl, tp, rp = plan["ctx"]
            capital = plan["cfg"].get("initial_balance")
            sl_mode = plan["cfg"].get("sl_mode", "fixed")
            atr_period = int(plan["cfg"].get("atr_period", 14))
            items = [
                (make_cache_key(pair, stype, tf, p["params"], sl, tp, rp, plan["cfg"], plan["from"], plan["to"], sl_mode, atr_period),
                 p, capital, plan["from"], plan["to"])
                for p in computed
            ]
            try:
                self._cache.put_many(items)
            except Exception:  # noqa: BLE001 - un fallo de caché no debe abortar la búsqueda
                pass
        rows = _finalize_group(plan["cached"] + computed)
        # Estampa el régimen del periodo (metadato por par/tf) en cada fila —
        # cacheadas y nuevas por igual; no se guarda en caché (es del periodo).
        reg = plan.get("regime") or {}
        for r in rows:
            r["regime"] = reg.get("regime")
            r["regime_confidence"] = reg.get("confidence")
        pair, stype, tf = plan["ctx"][0], plan["ctx"][1], plan["ctx"][2]
        self._consume(run_id, rows, compute_s, plan["grid"], f"{pair} · {tf} · {stype}", plan["hits"], plan["misses"])

    def _consume(self, run_id: int, rows: list[dict[str, Any]], compute_s: float, grid: int,
                 label: str, hits: int = 0, misses: int = 0) -> None:
        with self._lock:
            if not self._is_current(run_id):
                return
            self.results.extend(rows)
            self.done += grid
            self.t_compute += compute_s
            self.cache_hits += hits
            self.cache_misses += misses
            self.current = label
            self._beat()

    def _run_plans(self, plans: list[dict[str, Any]], run_id: int, inprocess: bool) -> None:
        # 1) Grupos totalmente cacheados → finalizar inline (sin backtests).
        pending: list[dict[str, Any]] = []
        for plan in plans:
            if self._should_cancel() or not self._is_current(run_id):
                return
            if not plan["missing"]:
                self._finalize_and_consume(run_id, plan, [], 0.0)
            else:
                pending.append(plan)
        if not pending:
            return

        # 2) Grupos con combinaciones faltantes → cálculo (paralelo o en hilo en tests).
        if inprocess:
            for plan in pending:
                if self._should_cancel() or not self._is_current(run_id):
                    return
                computed, compute_s = _missing_worker(self._task_of(plan))
                self._finalize_and_consume(run_id, plan, computed, compute_s)
            return

        ex = ProcessPoolExecutor(max_workers=self.workers)
        with self._lock:
            self._executor = ex
        try:
            futures = {ex.submit(_missing_worker, self._task_of(p)): p for p in pending}
            for fut in as_completed(futures):
                if self._should_cancel() or not self._is_current(run_id):
                    ex.shutdown(wait=False, cancel_futures=True)
                    return
                plan = futures[fut]
                try:
                    computed, compute_s = fut.result()
                except Exception:  # noqa: BLE001 - un grupo que falle no aborta el resto
                    computed, compute_s = [], 0.0
                self._finalize_and_consume(run_id, plan, computed, compute_s)
        finally:
            ex.shutdown(wait=False, cancel_futures=True)
            with self._lock:
                if self._executor is ex:
                    self._executor = None


def _cell(name: str, explored: int, total: int, **extra: Any) -> dict[str, Any]:
    explored = min(explored, total)  # por si la caché tuviera de más (no debería)
    pct = round(explored / total * 100, 1) if total else 0.0
    return {"name": name, "explored": explored, "total": total, "pct": pct, **extra}


def coverage_map(cache: ExploreCache, date_from: Any, date_to: Any, capital: float,
                 path: list[str], pairs: list[str]) -> dict[str, Any]:
    """Mapa de cobertura jerárquico para el periodo+capital dados. `path` define el
    nodo actual: []=pares, [par]=tipos, [par,tipo]=timeframes, [par,tipo,tf]=params.
    Cada celda lleva explored/total/pct contra el UNIVERSO estándar (rangos del
    Explorador por defecto). Las celdas vírgenes (0%) también aparecen."""
    risk_combos = len(SL_CHOICES) * len(TP_CHOICES) * len(RISK_CHOICES)
    tfs = SWEEP_TIMEFRAMES
    depth = len(path)
    symbol = path[0] if depth >= 1 else None
    stype = path[1] if depth >= 2 else None
    tf = path[2] if depth >= 3 else None
    counts = cache.coverage_children(date_from, date_to, capital, symbol, stype, tf)

    cells: list[dict[str, Any]] = []
    if depth == 0:
        level = "pairs"
        per_pair = sum(grid_size(t) for t in EXPLORE_TYPES) * len(tfs) * risk_combos
        names = sorted(set(p.upper() for p in pairs) | set(cache.distinct_pairs(date_from, date_to, capital)))
        cells = [_cell(n, counts.get(n, 0), per_pair) for n in names]
    elif depth == 1:
        level = "types"
        cells = [_cell(t, counts.get(t, 0), grid_size(t) * len(tfs) * risk_combos) for t in EXPLORE_TYPES]
    elif depth == 2:
        level = "timeframes"
        per_tf = grid_size(stype) * risk_combos
        cells = [_cell(t, counts.get(t, 0), per_tf) for t in tfs]
    else:
        level = "params"
        for params in _grid(stype, {}):
            pk = params_key_of(params)
            cells.append(_cell(pk, counts.get(pk, 0), risk_combos, params=params))

    total = sum(c["total"] for c in cells)
    explored = sum(c["explored"] for c in cells)
    return {
        "path": path,
        "level": level,
        "explorable": depth <= 2,   # pares/tipos/timeframes lanzan exploración; params no
        "cells": cells,
        "explored": explored,
        "total": total,
        "pct": round(explored / total * 100, 1) if total else 0.0,
        "context": {"date_from": str(date_from), "date_to": str(date_to), "capital": capital},
    }


job = ExploreJob()
