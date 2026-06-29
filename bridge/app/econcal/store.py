"""Almacén local del calendario: ACUMULA el feed semana a semana (construye
histórico hacia adelante) y lo combina con la semilla (NFP por regla + FOMC/CPI del
CSV). Archivo JSON en bridge/economic_calendar.json (runtime, gitignored)."""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any

from .seed import load_csv_seed, nfp_events
from .sources import fetch_feed

_STORE = Path(__file__).resolve().parent.parent.parent / "economic_calendar.json"
_lock = threading.Lock()
_last_refresh = 0.0
_REFRESH_EVERY = 3600.0  # 1h


def _key(e: dict[str, Any]) -> tuple[int, str, str]:
    # Dedup por minuto + divisa + título (tolera segundos distintos entre fetches).
    return (int(e["time"]) // 60, str(e.get("currency", "")).upper(), str(e.get("title", "")).strip().lower())


def _read_store() -> list[dict[str, Any]]:
    if not _STORE.exists():
        return []
    try:
        return json.loads(_STORE.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return []


def merge_feed(events: list[dict[str, Any]]) -> int:
    """Funde eventos del feed en el almacén (dedup). Devuelve nº de nuevos."""
    with _lock:
        stored = _read_store()
        index = {_key(e) for e in stored}
        added = 0
        for e in events:
            if _key(e) not in index:
                stored.append(e)
                index.add(_key(e))
                added += 1
        if added:
            stored.sort(key=lambda e: int(e["time"]))
            _STORE.write_text(json.dumps(stored, ensure_ascii=False), encoding="utf-8")
        return added


def refresh(force: bool = False) -> dict[str, Any]:
    """Refresca el feed en el almacén, throttled a 1h. Degrada sin romper si la red
    falla (devuelve ok=False y se sigue usando lo acumulado + la semilla)."""
    global _last_refresh
    now = time.time()
    if not force and (now - _last_refresh) < _REFRESH_EVERY:
        return {"ok": True, "refreshed": False}
    try:
        events = fetch_feed()
    except Exception as exc:  # noqa: BLE001 - la red no debe tumbar el endpoint
        return {"ok": False, "refreshed": False, "error": str(exc)}
    added = merge_feed(events)
    _last_refresh = now
    return {"ok": True, "refreshed": True, "fetched": len(events), "added": added}


def load_all() -> list[dict[str, Any]]:
    """Todos los eventos conocidos: NFP (regla) + CSV semilla (FOMC/CPI por_verificar)
    + feed acumulado. Dedup; el feed (confirmado) prevalece sobre la semilla."""
    merged: dict[tuple[int, str, str], dict[str, Any]] = {}
    # Orden de prioridad: nfp, seed, luego feed (sobrescribe → status confirmado real).
    for src in (nfp_events(), load_csv_seed(), _read_store()):
        for e in src:
            merged[_key(e)] = e
    return sorted(merged.values(), key=lambda e: int(e["time"]))
