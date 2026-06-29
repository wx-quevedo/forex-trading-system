"""Gestión de cartera (Fase 7): correlación entre estrategias, riesgo por posición
y portfolio heat (riesgo agregado). Lógica PURA, testeable sin MT5/red.

Nota de diseño: heat y correlación son complementarios (heat = cuánto riesgo total;
correlación = si está concentrado o diversificado). Hoy son independientes; en el
futuro podría haber un "heat ajustado por correlación" — estas funciones quedan
separadas y componibles para no cerrar esa puerta."""

from __future__ import annotations

import math
from typing import Any


# --------------------------------------------------------------------------- #
# Correlación entre estrategias (análisis del Bot Histórico)
# --------------------------------------------------------------------------- #
def pearson(a: list[float], b: list[float]) -> float | None:
    """Correlación de Pearson entre dos series alineadas. None si no es calculable
    (longitudes distintas, <2 puntos o varianza cero en alguna)."""
    n = len(a)
    if n != len(b) or n < 2:
        return None
    ma = sum(a) / n
    mb = sum(b) / n
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((x - mb) ** 2 for x in b)
    if va <= 0 or vb <= 0:
        return None
    cov = sum((a[i] - ma) * (b[i] - mb) for i in range(n))
    return cov / math.sqrt(va * vb)


def correlation_matrix(series: list[list[float]]) -> list[list[float | None]]:
    """Matriz NxN de correlaciones. Diagonal = 1.0; fuera de diagonal = Pearson
    (None si no calculable)."""
    n = len(series)
    out: list[list[float | None]] = [[None] * n for _ in range(n)]
    for i in range(n):
        out[i][i] = 1.0
        for j in range(i + 1, n):
            r = pearson(series[i], series[j])
            r = round(r, 3) if r is not None else None
            out[i][j] = out[j][i] = r
    return out


def returns_from_equity(equity: list[float]) -> list[float]:
    """Retornos simples por paso desde una curva de equity alineada."""
    out: list[float] = []
    for i in range(1, len(equity)):
        prev = equity[i - 1]
        out.append((equity[i] - prev) / prev if prev else 0.0)
    return out


# --------------------------------------------------------------------------- #
# Portfolio heat (riesgo agregado del bot en vivo)
# --------------------------------------------------------------------------- #
def position_risk(price_open: float | None, sl: float | None, volume: float,
                  pip: float, pip_value: float) -> float:
    """Riesgo en dinero de una posición si salta su SL: (distancia/pip)·pip_value·vol.
    0 si no hay SL definido (no se puede acotar el riesgo por esta vía)."""
    if not sl or not price_open or pip <= 0:
        return 0.0
    risk_pips = abs(float(price_open) - float(sl)) / pip
    return risk_pips * pip_value * float(volume)


def portfolio_heat(risks: list[float], equity: float) -> float:
    """% del capital en riesgo agregado = Σ riesgos / equity × 100."""
    if equity <= 0:
        return 0.0
    return sum(risks) / equity * 100.0


def heat_would_exceed(current_risk: float, new_risk: float, equity: float, limit_pct: float) -> bool:
    """¿Abrir una posición con `new_risk` superaría el límite global de heat?
    limit_pct <= 0 desactiva el control (nunca bloquea)."""
    if limit_pct <= 0 or equity <= 0:
        return False
    return ((current_risk + new_risk) / equity * 100.0) > limit_pct
