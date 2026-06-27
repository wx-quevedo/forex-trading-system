"""Caché de resultados del Explorador en SQLite (Fase 8E — rendimiento).

El pasado no cambia: un backtest sobre velas históricas da SIEMPRE el mismo
resultado. Cacheamos cada combinación evaluada por una CLAVE que incluye TODO lo
que determina el resultado; una búsqueda futura que repita esa combinación la trae
de la caché (instantáneo) en vez de recalcularla.

Se guarda el resultado PARCIAL de la combinación (métricas + retorno in/out), NO el
veredicto/robustez: el veredicto se recalcula siempre sobre el grupo completo (es
barato y determinista), evitando inconsistencias.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Versión de la LÓGICA de cálculo (backtest/costos/robustez/quiebra). Si cambia la
# forma de calcular, INCREMENTAR esto: invalida la caché vieja (se recalcula con la
# lógica nueva) en vez de servir resultados obsoletos.
ENGINE_VERSION = 3  # v3: pip derivado del punto del símbolo (metales/índices)

_COST_KEYS = ("spread_pips", "commission_per_lot", "swap_long_pts", "swap_short_pts", "point")


def make_cache_key(symbol: str, stype: str, tf: str, params: dict[str, Any],
                   sl: float, tp: float, rp: float, cfg: dict[str, Any],
                   date_from: Any, date_to: Any) -> str:
    """Hash SHA-1 de TODO lo que afecta el resultado (incl. engine_version, capital,
    costos y periodo exacto). Cambiar cualquiera fuerza recálculo."""
    payload = {
        "v": ENGINE_VERSION,
        "symbol": symbol,
        "type": stype,
        "tf": tf,
        "params": {k: params[k] for k in sorted(params)},
        "sl": sl,
        "tp": tp,
        "risk": rp,
        "capital": cfg.get("initial_balance"),
        "costs": {k: cfg.get(k) for k in _COST_KEYS},
        "from": str(date_from),
        "to": str(date_to),
    }
    raw = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


class ExploreCache:
    """Caché por combinación en SQLite. Conexión por operación (thread-safe)."""

    def __init__(self, path: str | Path) -> None:
        self.path = str(path)
        self._init()

    def _conn(self) -> sqlite3.Connection:
        c = sqlite3.connect(self.path, timeout=10)
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=NORMAL")
        return c

    def _init(self) -> None:
        with self._conn() as c:
            c.execute(
                "CREATE TABLE IF NOT EXISTS explore_cache ("
                "key TEXT PRIMARY KEY, result TEXT NOT NULL, symbol TEXT, type TEXT, "
                "timeframe TEXT, engine_version INTEGER, created_at TEXT)"
            )

    def get_many(self, keys: list[str]) -> dict[str, dict[str, Any]]:
        if not keys:
            return {}
        out: dict[str, dict[str, Any]] = {}
        with self._conn() as c:
            chunk = 900  # límite de variables por consulta SQLite
            for i in range(0, len(keys), chunk):
                part = keys[i:i + chunk]
                q = "SELECT key, result FROM explore_cache WHERE key IN (%s)" % ",".join("?" * len(part))
                for k, r in c.execute(q, part):
                    try:
                        out[k] = json.loads(r)
                    except Exception:  # noqa: BLE001 - fila corrupta: se ignora (recalcula)
                        pass
        return out

    def put_many(self, items: list[tuple[str, dict[str, Any]]]) -> None:
        if not items:
            return
        now = datetime.now(timezone.utc).isoformat()
        rows = [
            (key, json.dumps(row), row.get("pair"), row.get("type"), row.get("timeframe"), ENGINE_VERSION, now)
            for key, row in items
        ]
        with self._conn() as c:
            c.executemany(
                "INSERT OR REPLACE INTO explore_cache "
                "(key, result, symbol, type, timeframe, engine_version, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                rows,
            )

    def stats(self) -> dict[str, Any]:
        try:
            with self._conn() as c:
                n = c.execute("SELECT COUNT(*) FROM explore_cache").fetchone()[0]
            size = os.path.getsize(self.path) if os.path.exists(self.path) else 0
        except Exception:  # noqa: BLE001
            n, size = 0, 0
        return {"entries": int(n), "size_bytes": int(size), "size_mb": round(size / 1e6, 2),
                "engine_version": ENGINE_VERSION, "path": self.path}

    def clear(self) -> dict[str, Any]:
        with self._conn() as c:
            c.execute("DELETE FROM explore_cache")
        # VACUUM debe ir FUERA de transacción → conexión en autocommit aparte.
        c2 = self._conn()
        try:
            c2.isolation_level = None
            c2.execute("VACUUM")
        finally:
            c2.close()
        return self.stats()
