"""Buscador automático de estrategias (Fase 8E)."""

from .cache import ENGINE_VERSION
from .engine import (
    ATR_SL_CHOICES,
    ATR_TP_CHOICES,
    ATR_PERIOD_CHOICES,
    EXPLORE_TYPES,
    MAX_CONFIGS,
    RISK_CHOICES,
    SL_CHOICES,
    SWEEP_TIMEFRAMES,
    TP_CHOICES,
    WARN_CONFIGS,
    coverage_map,
    default_workers,
    estimate_configs,
    grid_size,
    job,
)

__all__ = [
    "ATR_SL_CHOICES",
    "ATR_TP_CHOICES",
    "ATR_PERIOD_CHOICES",
    "ENGINE_VERSION",
    "EXPLORE_TYPES",
    "MAX_CONFIGS",
    "RISK_CHOICES",
    "SL_CHOICES",
    "SWEEP_TIMEFRAMES",
    "TP_CHOICES",
    "WARN_CONFIGS",
    "coverage_map",
    "default_workers",
    "estimate_configs",
    "grid_size",
    "job",
]
