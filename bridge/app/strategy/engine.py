"""Punto de entrada del motor: evalúa una estrategia sobre una lista de velas."""

from __future__ import annotations

from typing import Any

import pandas as pd

from .strategies import build_strategy


def evaluate_strategy(
    type_: str,
    params: dict[str, Any] | None,
    candles: list[dict[str, Any]],
) -> dict[str, Any]:
    """Construye la estrategia y la evalúa sobre las velas (OHLCV).

    `candles` es la lista que devuelve el bridge (claves: time, open, high, low,
    close, tick_volume). Devuelve el dict de la señal.
    """
    if not candles:
        raise ValueError("No hay velas para evaluar.")

    df = pd.DataFrame(candles)
    required = {"open", "high", "low", "close"}
    if not required.issubset(df.columns):
        raise ValueError(f"Velas incompletas; faltan columnas {required - set(df.columns)}.")

    df = df.sort_values("time").reset_index(drop=True)

    strategy = build_strategy(type_, params)
    signal = strategy.evaluate(df)

    result = signal.to_dict()
    result["type"] = type_
    result["candles_evaluated"] = len(df)
    return result
