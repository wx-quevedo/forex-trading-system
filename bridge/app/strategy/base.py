"""Interfaz base de una estrategia y tipo de señal."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Literal

import pandas as pd

SignalType = Literal["buy", "sell", "none"]


@dataclass
class Signal:
    """Resultado de evaluar una estrategia sobre la última vela cerrada."""

    signal: SignalType = "none"
    reason: str = ""
    indicators: dict[str, Any] = field(default_factory=dict)
    price: float | None = None
    time: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "signal": self.signal,
            "reason": self.reason,
            "indicators": self.indicators,
            "price": self.price,
            "time": self.time,
        }


class Strategy(ABC):
    """Contrato común. Cada estrategia se construye desde un dict de parámetros."""

    type: str = "base"

    @abstractmethod
    def evaluate(self, df: pd.DataFrame) -> Signal:
        """Evalúa sobre un DataFrame de velas (columnas: open, high, low, close, time)."""
        raise NotImplementedError

    # -- utilidades de cruce ------------------------------------------------
    @staticmethod
    def crossed_up(a: pd.Series, b: pd.Series) -> bool:
        """True si la serie `a` cruzó por encima de `b` en la última vela cerrada."""
        if len(a) < 2 or len(b) < 2:
            return False
        prev = a.iloc[-2] - b.iloc[-2]
        curr = a.iloc[-1] - b.iloc[-1]
        return bool(prev <= 0 < curr)

    @staticmethod
    def crossed_down(a: pd.Series, b: pd.Series) -> bool:
        if len(a) < 2 or len(b) < 2:
            return False
        prev = a.iloc[-2] - b.iloc[-2]
        curr = a.iloc[-1] - b.iloc[-1]
        return bool(prev >= 0 > curr)
