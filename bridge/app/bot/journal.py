"""Journal PERSISTENTE del bot (append-only JSONL).

Registra cada APERTURA (con el detalle de fidelidad: ATR, lote, SL/TP, riesgo$, COINCIDE)
y cada CIERRE (pnl, motivo). A diferencia de `run["closed_trades"]` —que vive en memoria
y se limpia en el corte de día—, esto se APENDA a disco y NUNCA se borra, así que sobrevive
reinicios del bridge y cambios de día. Es la trazabilidad real de qué operó el bot.
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_JOURNAL_FILE = Path(__file__).resolve().parent.parent.parent / "bot_journal.jsonl"
_lock = threading.Lock()


def append(kind: str, run: dict[str, Any], data: dict[str, Any]) -> None:
    """Añade una entrada al journal. `kind`: 'open' | 'close' | 'blocked'. Nunca lanza."""
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "kind": kind,
        "strategy_id": run.get("strategy_id"),
        "symbol": run.get("symbol"),
        "timeframe": run.get("timeframe"),
        "strategy_type": run.get("strategy_type"),
        "magic": run.get("magic"),
        **data,
    }
    try:
        with _lock, _JOURNAL_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, default=str, ensure_ascii=False) + "\n")
    except Exception:  # noqa: BLE001 - el journal nunca debe tumbar el trading
        pass


def tail(n: int = 200) -> list[dict[str, Any]]:
    """Últimas `n` entradas (más recientes al final). Lee de forma tolerante a líneas rotas."""
    if not _JOURNAL_FILE.exists():
        return []
    try:
        with _lock, _JOURNAL_FILE.open("r", encoding="utf-8") as f:
            lines = f.readlines()[-n:]
    except Exception:  # noqa: BLE001
        return []
    out: list[dict[str, Any]] = []
    for ln in lines:
        ln = ln.strip()
        if not ln:
            continue
        try:
            out.append(json.loads(ln))
        except Exception:  # noqa: BLE001 - línea corrupta: se ignora
            pass
    return out
