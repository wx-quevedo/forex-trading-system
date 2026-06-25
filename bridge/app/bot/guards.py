"""Guardas de seguridad: se evalúan ANTES de abrir cualquier orden."""

from __future__ import annotations

from .state import BotState


def can_open(state: BotState, open_positions: int, daily_pnl: float) -> tuple[bool, str]:
    """¿Se puede abrir una nueva posición? Devuelve (ok, motivo_si_no)."""
    if state.daily_loss_limit > 0 and daily_pnl <= -abs(state.daily_loss_limit):
        return False, f"Límite de pérdida diaria alcanzado ({daily_pnl:.2f} <= -{abs(state.daily_loss_limit):.2f})."
    if open_positions >= state.max_positions:
        return False, f"Máximo de posiciones simultáneas alcanzado ({open_positions}/{state.max_positions})."
    return True, ""


def daily_limit_hit(state: BotState, daily_pnl: float) -> bool:
    return state.daily_loss_limit > 0 and daily_pnl <= -abs(state.daily_loss_limit)
