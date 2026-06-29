"""Guardas de seguridad por estrategia: se evalúan ANTES de abrir cualquier orden."""

from __future__ import annotations


def daily_limit_hit(daily_loss_limit: float, daily_pnl: float) -> bool:
    return daily_loss_limit > 0 and daily_pnl <= -abs(daily_loss_limit)


def circuit_breaker_tripped(loss_streak: int, drawdown_pct: float,
                            max_losses: int, max_dd_pct: float) -> tuple[bool, str]:
    """¿Saltó el circuit breaker de una estrategia? (Fase 7, OFF si los límites son 0.)

    - N pérdidas seguidas (`max_losses`): una racha puede señalar cambio de régimen.
    - X% de drawdown (`max_dd_pct`) desde el pico de PnL realizado.
    Pausar y revisar es prudente (un bot no tiene emociones, pero la racha es señal)."""
    if max_losses > 0 and loss_streak >= max_losses:
        return True, f"Circuit breaker: {loss_streak} pérdidas seguidas (límite {max_losses})."
    if max_dd_pct > 0 and drawdown_pct >= max_dd_pct:
        return True, f"Circuit breaker: drawdown {drawdown_pct:.1f}% desde el pico (límite {max_dd_pct:.1f}%)."
    return False, ""


def can_open(max_positions: int, daily_loss_limit: float, open_positions: int, daily_pnl: float) -> tuple[bool, str]:
    """¿Se puede abrir una nueva posición para esta estrategia? (ok, motivo_si_no)."""
    if daily_limit_hit(daily_loss_limit, daily_pnl):
        return False, f"Límite de pérdida diaria alcanzado ({daily_pnl:.2f} <= -{abs(daily_loss_limit):.2f})."
    if open_positions >= max_positions:
        return False, f"Máximo de posiciones simultáneas alcanzado ({open_positions}/{max_positions})."
    return True, ""
