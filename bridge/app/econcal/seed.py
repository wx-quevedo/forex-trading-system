"""Semilla de eventos históricos (Fase 6).

- NFP: REGLA determinista (primer viernes de cada mes, 13:30 UTC). Es cálculo, no
  invención → status 'confirmed'.
- FOMC / CPI: NO son derivables por regla. Se cargan de `seed_events.csv` con status
  'por_verificar' hasta que el usuario coteje contra fuentes oficiales (Federal
  Reserve para FOMC, BLS para CPI). NUNCA se tratan como confirmadas sin su OK.
"""

from __future__ import annotations

import csv
import datetime as dt
from pathlib import Path
from typing import Any

_SEED_CSV = Path(__file__).parent / "seed_events.csv"


def _first_friday(year: int, month: int) -> dt.date:
    d = dt.date(year, month, 1)
    return d + dt.timedelta(days=(4 - d.weekday()) % 7)  # weekday(): viernes = 4


def nfp_events(start_year: int = 2023, end_year: int = 2027) -> list[dict[str, Any]]:
    """Non-Farm Payrolls por regla: primer viernes del mes, 13:30 UTC (8:30 ET).
    (En horario de verano EE.UU. el real puede ser 12:30 UTC; el usuario fijó 13:30
    UTC como convención determinista.)"""
    out: list[dict[str, Any]] = []
    for y in range(start_year, end_year + 1):
        for m in range(1, 13):
            ff = _first_friday(y, m)
            t = dt.datetime(ff.year, ff.month, ff.day, 13, 30, tzinfo=dt.timezone.utc)
            out.append({
                "time": int(t.timestamp()), "currency": "USD", "impact": "High",
                "title": "Non-Farm Payrolls", "source": "nfp", "status": "confirmed",
            })
    return out


def load_csv_seed() -> list[dict[str, Any]]:
    """Carga FOMC/CPI del CSV semilla. Respeta su `status` (por_verificar por defecto)."""
    if not _SEED_CSV.exists():
        return []
    out: list[dict[str, Any]] = []
    with open(_SEED_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            raw = (row.get("date_utc") or "").strip()
            if not raw:
                continue
            try:
                t = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
            except ValueError:
                continue
            if t.tzinfo is None:
                t = t.replace(tzinfo=dt.timezone.utc)
            out.append({
                "time": int(t.timestamp()),
                "currency": (row.get("currency") or "USD").strip().upper(),
                "impact": (row.get("impact") or "High").strip().title(),
                "title": (row.get("title") or "").strip(),
                "source": "seed",
                "status": (row.get("status") or "por_verificar").strip().lower(),
            })
    return out
