"""Registro de ARRANQUES del bridge (para el auto-reanudar seguro de Laravel).

Cada vez que el proceso del bridge arranca, anexa un registro {ts, os_uptime_s} a un
archivo persistente (capado). El orquestador (comando Laravel `bot:autoresume`) lee esto
por `GET /bot/lifecycle` para:

  * Detectar un CRASH-LOOP: muchos arranques del bridge en pocos minutos → NO reanudar.
  * Distinguir reboot de máquina (uptime del SO bajo) de un reinicio del bridge con el SO
    llevando horas arriba (informativo para el mensaje).

Persistente a propósito: un crash-loop mata y relanza el proceso, así que el historial en
memoria se perdería en cada muerte. El archivo sobrevive entre procesos.
"""

from __future__ import annotations

import ctypes
import json
from datetime import datetime, timezone
from pathlib import Path

_BOOTS_FILE = Path(__file__).resolve().parent.parent.parent / "bridge_boots.json"
_MAX_BOOTS = 50  # historial suficiente para cualquier ventana de detección de crash-loop


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def os_uptime_s() -> float | None:
    """Segundos que lleva encendido el SO. Windows: GetTickCount64 (sin dependencias).
    En otros SO (o si falla) devuelve None → el auto-reanudar lo trata como 'desconocido'
    (no gatea sobre esto; es solo informativo)."""
    try:
        return ctypes.windll.kernel32.GetTickCount64() / 1000.0  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001 - no-Windows o sin kernel32
        return None


def _read() -> list[dict]:
    if not _BOOTS_FILE.exists():
        return []
    try:
        data = json.loads(_BOOTS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:  # noqa: BLE001 - corrupto → empezamos limpio
        return []


def record_boot() -> dict:
    """Anexa un registro de este arranque y devuelve el registro creado."""
    boots = _read()
    entry = {"ts": _now_iso(), "os_uptime_s": os_uptime_s()}
    boots.append(entry)
    boots = boots[-_MAX_BOOTS:]
    try:
        tmp = _BOOTS_FILE.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(boots, ensure_ascii=False), encoding="utf-8")
        tmp.replace(_BOOTS_FILE)  # atómico
    except Exception:  # noqa: BLE001 - registrar el boot nunca debe tumbar el arranque
        pass
    return entry


def recent_boots() -> list[dict]:
    """Todos los arranques registrados (el caller filtra por ventana temporal)."""
    return _read()
