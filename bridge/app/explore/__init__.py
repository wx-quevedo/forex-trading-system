"""Buscador automático de estrategias (Fase 8E)."""

from .cache import ENGINE_VERSION
from .engine import (
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
