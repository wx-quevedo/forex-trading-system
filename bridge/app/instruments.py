"""Perfil de instrumento (Fase 5).

Formaliza la aritmética de pip/tick y costos por TIPO de instrumento (forex, metal,
índice, energía, cripto). En lugar de hardcodear tamaños de contrato por símbolo,
deriva el valor real del pip desde los datos del broker (`trade_tick_value` /
`trade_tick_size`), evitando los errores que distorsionan un backtest (p.ej. un
índice como US500 tiene pip_value ~0.1, NO 10 como un forex).

Lógica PURA (sin MT5) para poder testearla con valores reales mockeados.
"""

from __future__ import annotations

from typing import Any

FOREX = "forex"
METAL = "metal"
INDEX = "index"
ENERGY = "energy"
CRYPTO = "crypto"
OTHER = "other"


def classify_instrument(path: str | None, symbol: str | None = None) -> str:
    """Clasifica el tipo de instrumento por el `path` del símbolo en MT5."""
    p = (path or "").lower()
    if "metal" in p:
        return METAL
    if "indices" in p or "index" in p:
        return INDEX
    if "energ" in p:  # Energies / Energía
        return ENERGY
    if "crypto" in p or "cripto" in p:
        return CRYPTO
    if "forex" in p:
        return FOREX
    # Heurística de respaldo por nombre (cuando no hay path fiable).
    s = (symbol or "").upper()
    if any(k in s for k in ("GOLD", "XAU", "XAG", "SILVER")):
        return METAL
    if any(k in s for k in ("OIL", "WTI", "BRENT")):
        return ENERGY
    return OTHER


def pip_for(point: float, symbol: str) -> float:
    """Tamaño del pip = 10 puntos del símbolo (coherente con todo el motor:
    forex 5/3 dígitos, metales, índices). Sin punto, heurística por nombre."""
    if point and point > 0:
        return point * 10.0
    return 0.01 if symbol.upper().endswith("JPY") else 0.0001


def build_profile(
    *,
    symbol: str,
    path: str | None,
    point: float,
    spread: float,
    swap_long: float,
    swap_short: float,
    tick_value: float | None,
    tick_size: float | None,
    contract_size: float | None,
    volume_min: float | None,
    volume_step: float | None,
) -> dict[str, Any]:
    """Construye el perfil de costos/aritmética para el motor de backtest.

    `pip_value_per_lot` se deriva del valor REAL del tick del broker:
        pip_value = tick_value × (pip / tick_size)
    Si faltan los datos del tick, cae a 10.0 (default forex majors USD)."""
    pip = pip_for(point, symbol)
    spread_pips = (spread * point) / pip if (pip and point) else 0.0

    if tick_value and tick_size and tick_size > 0:
        pip_value_per_lot = float(tick_value) * (pip / float(tick_size))
    else:
        pip_value_per_lot = 10.0  # respaldo: forex majors en USD

    return {
        "instrument_type": classify_instrument(path, symbol),
        "spread_pips": round(spread_pips, 3),
        "swap_long_pts": float(swap_long),
        "swap_short_pts": float(swap_short),
        "point": float(point),
        "pip": pip,
        "pip_value_per_lot": round(pip_value_per_lot, 6),
        "contract_size": float(contract_size) if contract_size else None,
        "tick_value": float(tick_value) if tick_value else None,
        "tick_size": float(tick_size) if tick_size else None,
        "volume_min": float(volume_min) if volume_min else 0.01,
        "volume_step": float(volume_step) if volume_step else 0.01,
    }
