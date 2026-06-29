"""Fuente EN VIVO: feed semanal gratuito de ForexFactory (vía faireconomy).

Gratis, sin API key. Cubre ~3 semanas (lastweek/thisweek/nextweek). Se usa para la
defensa en vivo (eventos próximos) y para ACUMULAR histórico hacia adelante.
`parse_feed` es pura (testeable con JSON mockeado)."""

from __future__ import annotations

import datetime as dt
from typing import Any

import httpx

_URL = "https://nfs.faireconomy.media/ff_calendar_{}.json"
_WEEKS = ("lastweek", "thisweek", "nextweek")


def parse_feed(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normaliza el JSON de ForexFactory a eventos del calendario."""
    out: list[dict[str, Any]] = []
    for e in raw or []:
        date = (e.get("date") or "").strip()
        if not date:
            continue
        try:
            t = dt.datetime.fromisoformat(date.replace("Z", "+00:00"))
        except ValueError:
            continue
        if t.tzinfo is None:
            t = t.replace(tzinfo=dt.timezone.utc)
        out.append({
            "time": int(t.timestamp()),
            "currency": str(e.get("country") or "").strip().upper(),
            "impact": str(e.get("impact") or "").strip().title(),
            "title": str(e.get("title") or "").strip(),
            "source": "feed",
            "status": "confirmed",
        })
    return out


def fetch_feed(timeout: float = 15.0) -> list[dict[str, Any]]:
    """Descarga y normaliza el feed. TOLERANTE por semana: si una URL falla (p.ej.
    'lastweek' a veces da 404), las demás siguen. Lanza solo si NINGUNA funcionó."""
    headers = {"User-Agent": "forexbot/1.0 (+local defensive calendar)"}
    events: list[dict[str, Any]] = []
    errors: list[str] = []
    with httpx.Client(timeout=timeout, headers=headers, follow_redirects=True) as cli:
        for wk in _WEEKS:
            try:
                r = cli.get(_URL.format(wk))
                r.raise_for_status()
                events.extend(parse_feed(r.json()))
            except Exception as exc:  # noqa: BLE001 - una semana que falle no aborta
                errors.append(f"{wk}: {exc}")
    if not events and errors:
        raise RuntimeError("; ".join(errors))
    return events
