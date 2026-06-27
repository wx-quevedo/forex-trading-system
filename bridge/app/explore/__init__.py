"""Buscador automático de estrategias (Fase 8E)."""

from .engine import (
    MAX_CONFIGS,
    RISK_CHOICES,
    SL_CHOICES,
    SWEEP_TIMEFRAMES,
    TP_CHOICES,
    estimate_configs,
    grid_size,
    job,
)

__all__ = [
    "MAX_CONFIGS",
    "RISK_CHOICES",
    "SL_CHOICES",
    "SWEEP_TIMEFRAMES",
    "TP_CHOICES",
    "estimate_configs",
    "grid_size",
    "job",
]
