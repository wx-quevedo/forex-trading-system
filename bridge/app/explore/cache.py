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
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Versión de la LÓGICA de cálculo (backtest/costos/robustez/quiebra). Si cambia la
# forma de calcular, INCREMENTAR esto: invalida la caché vieja (se recalcula con la
# lógica nueva) en vez de servir resultados obsoletos.
ENGINE_VERSION = 3  # v3: pip derivado del punto del símbolo (metales/índices)

_COST_KEYS = ("spread_pips", "commission_per_lot", "swap_long_pts", "swap_short_pts", "point")


def params_key_of(params: dict[str, Any]) -> str:
    """Clave canónica de los parámetros (orden estable) para conteo/cobertura."""
    return "|".join(f"{k}={params[k]}" for k in sorted(params))


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

    @contextmanager
    def _connect(self):
        """Conexión que COMMITEA y CIERRA al salir (evita fugas; permite que WAL
        haga checkpoint al cerrar la última conexión → durabilidad real)."""
        c = self._conn()
        try:
            yield c
            c.commit()
        finally:
            c.close()

    # Columnas más allá de (key, result). Las migraciones AÑADEN las que falten,
    # NUNCA recrean la tabla → los resultados ya calculados PERSISTEN entre arranques.
    _EXTRA_COLUMNS = [
        ("symbol", "TEXT"), ("type", "TEXT"), ("timeframe", "TEXT"),
        ("capital", "REAL"), ("date_from", "TEXT"), ("date_to", "TEXT"),
        ("sl", "REAL"), ("tp", "REAL"), ("risk", "REAL"), ("params_key", "TEXT"),
        ("engine_version", "INTEGER"), ("created_at", "TEXT"),
    ]

    def _init(self) -> None:
        with self._connect() as c:
            # CREATE IF NOT EXISTS: nunca borra una tabla existente.
            c.execute("CREATE TABLE IF NOT EXISTS explore_cache (key TEXT PRIMARY KEY, result TEXT NOT NULL)")
            existing = {row[1] for row in c.execute("PRAGMA table_info(explore_cache)")}
            # Migración no destructiva: añade columnas faltantes preservando las filas.
            for name, sqltype in self._EXTRA_COLUMNS:
                if name not in existing:
                    c.execute(f"ALTER TABLE explore_cache ADD COLUMN {name} {sqltype}")
            c.execute("CREATE INDEX IF NOT EXISTS idx_cov ON explore_cache "
                      "(date_from, date_to, capital, symbol, type, timeframe)")

    def get_many(self, keys: list[str]) -> dict[str, dict[str, Any]]:
        if not keys:
            return {}
        out: dict[str, dict[str, Any]] = {}
        with self._connect() as c:
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

    def put_many(self, items: list[tuple[str, dict[str, Any], float, Any, Any]]) -> None:
        """items: (key, row, capital, date_from, date_to). Guarda columnas de
        cobertura (capital/periodo/sl/tp/riesgo/params) además del resultado."""
        if not items:
            return
        now = datetime.now(timezone.utc).isoformat()
        rows = [
            (key, json.dumps(row), row.get("pair"), row.get("type"), row.get("timeframe"),
             float(capital), str(date_from), str(date_to),
             float(row.get("sl_pips", 0)), float(row.get("tp_pips", 0)), float(row.get("risk_percent", 0)),
             params_key_of(row.get("params", {})), ENGINE_VERSION, now)
            for key, row, capital, date_from, date_to in items
        ]
        with self._connect() as c:
            c.executemany(
                "INSERT OR REPLACE INTO explore_cache "
                "(key, result, symbol, type, timeframe, capital, date_from, date_to, "
                "sl, tp, risk, params_key, engine_version, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                rows,
            )

    # -- cobertura (Fase 8F) ----------------------------------------------
    @staticmethod
    def _distinct_expr(cols: list[str]) -> str:
        return "||'|'||".join(cols)

    def coverage_children(self, date_from: Any, date_to: Any, capital: float,
                          symbol: str | None = None, stype: str | None = None,
                          tf: str | None = None) -> dict[str, int]:
        """Combinaciones LÓGICAS distintas en caché agrupadas por la siguiente
        dimensión no fijada (par→tipo→tf→params), para el periodo+capital dados.
        DISTINCT sobre la tupla lógica → no doble-cuenta variantes de costos."""
        where = ["date_from=?", "date_to=?", "capital=?"]
        args: list[Any] = [str(date_from), str(date_to), float(capital)]
        if symbol is not None:
            where.append("symbol=?"); args.append(symbol)
        if stype is not None:
            where.append("type=?"); args.append(stype)
        if tf is not None:
            where.append("timeframe=?"); args.append(tf)

        if symbol is None:
            group, distinct = "symbol", ["type", "timeframe", "params_key", "sl", "tp", "risk"]
        elif stype is None:
            group, distinct = "type", ["timeframe", "params_key", "sl", "tp", "risk"]
        elif tf is None:
            group, distinct = "timeframe", ["params_key", "sl", "tp", "risk"]
        else:
            group, distinct = "params_key", ["sl", "tp", "risk"]

        q = (f"SELECT {group}, COUNT(DISTINCT {self._distinct_expr(distinct)}) "
             f"FROM explore_cache WHERE {' AND '.join(where)} GROUP BY {group}")
        out: dict[str, int] = {}
        with self._connect() as c:
            for name, cnt in c.execute(q, args):
                if name is not None:
                    out[str(name)] = int(cnt)
        return out

    def distinct_pairs(self, date_from: Any, date_to: Any, capital: float) -> list[str]:
        with self._connect() as c:
            rows = c.execute(
                "SELECT DISTINCT symbol FROM explore_cache WHERE date_from=? AND date_to=? AND capital=?",
                [str(date_from), str(date_to), float(capital)],
            ).fetchall()
        return sorted(r[0] for r in rows if r[0])

    def stats(self) -> dict[str, Any]:
        try:
            with self._connect() as c:
                n = c.execute("SELECT COUNT(*) FROM explore_cache").fetchone()[0]
            size = os.path.getsize(self.path) if os.path.exists(self.path) else 0
        except Exception:  # noqa: BLE001
            n, size = 0, 0
        return {"entries": int(n), "size_bytes": int(size), "size_mb": round(size / 1e6, 2),
                "engine_version": ENGINE_VERSION, "path": self.path}

    def clear(self) -> dict[str, Any]:
        with self._connect() as c:
            c.execute("DELETE FROM explore_cache")
        # VACUUM debe ir FUERA de transacción → conexión en autocommit aparte.
        c2 = self._conn()
        try:
            c2.isolation_level = None
            c2.execute("VACUUM")
        finally:
            c2.close()
        return self.stats()
