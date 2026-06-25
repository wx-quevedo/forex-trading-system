"""Motor de estrategias del ForexBot (Módulo 2 / Fase 4).

Calcula indicadores sobre velas OHLCV y evalúa señales de entrada/salida sobre
la última vela cerrada. Diseñado para reutilizarse desde el backtester (Fase 5)
y el bot en vivo (Fase 7).
"""

from .engine import evaluate_strategy
from .strategies import STRATEGY_SCHEMAS, build_strategy, signal_series

__all__ = ["evaluate_strategy", "STRATEGY_SCHEMAS", "build_strategy", "signal_series"]
