"""Lógica PURA del calendario (sin red ni disco): mapeo símbolo→divisas, filtrado
por ventana/impacto y detección de ventana de noticia. Todo testeable en aislado.

Un evento normalizado es un dict:
    {"time": int (epoch UTC), "currency": "USD", "impact": "High"|"Medium"|"Low",
     "title": str, "source": "feed"|"nfp"|"seed", "status": "confirmed"|"por_verificar"}
"""

from __future__ import annotations

from typing import Any

# Divisas con eventos macro relevantes (las que cubre el feed).
CURRENCIES = {"USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "CNY"}

IMPACT_RANK = {"high": 3, "medium": 2, "low": 1}


def impact_rank(impact: str | None) -> int:
    return IMPACT_RANK.get(str(impact or "").strip().lower(), 0)


def symbol_currencies(symbol: str) -> list[str]:
    """Divisas que afectan a un símbolo. Forex → sus dos divisas; metales/índices/
    energía/cripto → USD (su driver macro principal). Ignora sufijos (#, .m, etc.)."""
    letters = "".join(ch for ch in (symbol or "").upper() if ch.isalpha())
    if len(letters) >= 6:
        a, b = letters[:3], letters[3:6]
        if a in CURRENCIES and b in CURRENCIES:
            return [a, b]
    return ["USD"]


def events_in(
    events: list[dict[str, Any]],
    frm: int,
    to: int,
    currencies: list[str] | None = None,
    min_impact: str = "high",
) -> list[dict[str, Any]]:
    """Eventos dentro de [frm, to] (epoch UTC), de las divisas dadas y con impacto
    ≥ min_impact. Ordenados por tiempo. Es METADATO (no altera ningún trade)."""
    cset = {c.upper() for c in currencies} if currencies else None
    floor = impact_rank(min_impact)
    out = [
        e for e in events
        if frm <= int(e["time"]) <= to
        and impact_rank(e.get("impact")) >= floor
        and (cset is None or str(e.get("currency", "")).upper() in cset)
    ]
    return sorted(out, key=lambda e: int(e["time"]))


def news_window_active(
    now_ts: int,
    events: list[dict[str, Any]],
    currencies: list[str] | None = None,
    window_min: int = 15,
    min_impact: str = "high",
) -> tuple[bool, dict[str, Any] | None]:
    """¿`now_ts` cae dentro de ±window_min de un evento de alto impacto de esas
    divisas? Devuelve (activo, evento_más_cercano). Base de la pausa defensiva."""
    cset = {c.upper() for c in currencies} if currencies else None
    floor = impact_rank(min_impact)
    win = window_min * 60
    best: dict[str, Any] | None = None
    best_d = win + 1
    for e in events:
        if impact_rank(e.get("impact")) < floor:
            continue
        if cset is not None and str(e.get("currency", "")).upper() not in cset:
            continue
        d = abs(now_ts - int(e["time"]))
        if d <= win and d < best_d:
            best, best_d = e, d
    return (best is not None), best
