"""Guardas de seguridad por estrategia: se evalúan ANTES de abrir cualquier orden."""

from __future__ import annotations


def daily_limit_hit(daily_loss_limit: float, daily_pnl: float) -> bool:
    return daily_loss_limit > 0 and daily_pnl <= -abs(daily_loss_limit)


def can_open(max_positions: int, daily_loss_limit: float, open_positions: int, daily_pnl: float) -> tuple[bool, str]:
    """¿Se puede abrir una nueva posición para esta estrategia? (ok, motivo_si_no)."""
    if daily_limit_hit(daily_loss_limit, daily_pnl):
        return False, f"Límite de pérdida diaria alcanzado ({daily_pnl:.2f} <= -{abs(daily_loss_limit):.2f})."
    if open_positions >= max_positions:
        return False, f"Máximo de posiciones simultáneas alcanzado ({open_positions}/{max_positions})."
    return True, ""
