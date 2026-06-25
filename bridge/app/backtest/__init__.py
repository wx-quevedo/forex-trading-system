"""Motor de backtesting del ForexBot (Módulo 3 / Fase 5).

Backtester event-driven sobre pandas (no vectorbt: evita el peso de numba en
Windows y da control total sobre métricas y marcadores de trades). Reutiliza el
mismo motor de señales que las estrategias en vivo (Fase 4).
"""

from .engine import run_backtest

__all__ = ["run_backtest"]
