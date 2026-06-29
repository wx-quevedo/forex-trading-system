"""Calendario económico como capa DEFENSIVA (Fase 6).

Principio (P4): usar las noticias para saber cuándo NO operar y para CONTEXTUALIZAR
resultados anómalos — nunca para predecir dirección. "Trade the divergence, not the
headline." Marcar eventos es metadato (no cambia trades); pausar en vivo es runtime.
"""

from .service import (
    IMPACT_RANK,
    events_in,
    impact_rank,
    news_window_active,
    symbol_currencies,
)

__all__ = [
    "IMPACT_RANK",
    "events_in",
    "impact_rank",
    "news_window_active",
    "symbol_currencies",
]
