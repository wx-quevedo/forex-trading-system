"""Aritmética de SL/TP y tamaño de posición — FUENTE ÚNICA del backtest y del bot en vivo.

Extraído de backtest/engine.py para que el ejecutor en vivo opere EXACTAMENTE como el
backtest (misma distancia de stop ATR/fija, mismo sizing por riesgo%). Mismo código →
imposible que diverjan. Funciones PURAS: sin MT5, sin estado, sin pandas.

Convención de SL/TP (igual que el backtest):
- modo "fixed": sl_param/tp_param son PIPS → distancia = pips × pip.
- modo "atr":   sl_param/tp_param son MULTIPLICADORES (N, M) → distancia = N × ATR.
"""

from __future__ import annotations


def sl_tp_distances(
    sl_mode: str,
    sl_param: float,
    tp_param: float,
    pip: float,
    atr_value: float | None = None,
) -> tuple[float | None, float | None] | None:
    """Distancias SL/TP en PRECIO. Devuelve (sl_dist, tp_dist), o None si el modo es
    ATR y el ATR no está definido aún (NaN/≤0) → en ese caso NO se debe operar (igual
    que el backtest, que se salta la apertura)."""
    if sl_mode == "atr":
        a = atr_value
        if a is None or not (a == a) or a <= 0:  # NaN o no positivo → no operar
            return None
        sl_dist = sl_param * a if sl_param else None  # sl_param = multiplicador N
        tp_dist = tp_param * a if tp_param else None  # tp_param = multiplicador M
    else:
        sl_dist = sl_param * pip if sl_param else None
        tp_dist = tp_param * pip if tp_param else None
    return (sl_dist, tp_dist)


def sl_tp_prices(
    direction: str,
    entry: float,
    sl_dist: float | None,
    tp_dist: float | None,
) -> tuple[float | None, float | None]:
    """Precios de SL/TP desde la entrada y las distancias, según el sentido."""
    if direction == "buy":
        sl = entry - sl_dist if sl_dist else None
        tp = entry + tp_dist if tp_dist else None
    else:
        sl = entry + sl_dist if sl_dist else None
        tp = entry - tp_dist if tp_dist else None
    return (sl, tp)


def round_lot(vol: float, volume_min: float, volume_step: float) -> float:
    """Redondea el volumen al escalón del símbolo y aplica el piso (lote mínimo)."""
    steps = round(vol / volume_step) if volume_step else vol
    return max(volume_min, round(steps * volume_step, 8))


def risk_volume(
    balance: float,
    risk_pct: float,
    entry: float,
    sl: float | None,
    pip: float,
    pip_value_per_lot: float,
) -> float | None:
    """Volumen CRUDO por riesgo% (sin redondear ni pisar al lote mínimo). None si no
    aplica (sin riesgo% o sin SL). Separado para que el ejecutor en vivo pueda detectar
    si el riesgo% pediría MENOS que el lote mínimo (y decidir según su política)."""
    if risk_pct and sl is not None and abs(entry - sl) > 0:
        risk_amount = balance * risk_pct / 100.0
        return risk_amount / ((abs(entry - sl) / pip) * pip_value_per_lot)
    return None


def size_for(
    balance: float,
    risk_pct: float,
    entry: float,
    sl: float | None,
    pip: float,
    pip_value_per_lot: float,
    volume_min: float,
    volume_step: float,
    default_volume: float,
) -> float:
    """Tamaño de posición por riesgo%: arriesga `balance × risk% / 100` repartido en la
    distancia del stop. Si falta riesgo% o SL (o distancia 0), cae al lote por defecto.

        vol = risk_amount / (dist_en_pips × pip_value_per_lot)

    Es el MISMO cálculo del backtest, de modo que el $ en riesgo por operación sea
    constante. `balance` es el realizado (no incluye flotante)."""
    raw = risk_volume(balance, risk_pct, entry, sl, pip, pip_value_per_lot)
    if raw is None:
        return float(default_volume)
    return round_lot(raw, volume_min, volume_step)
