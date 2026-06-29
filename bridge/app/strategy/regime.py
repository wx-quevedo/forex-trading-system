"""Clasificador de RÉGIMEN de mercado (Fase 3).

Sobre una ventana de velas, combina (voto compuesto) ADX, Efficiency Ratio,
MA200 y ATR para etiquetar el régimen del periodo: TENDENCIA (alcista/bajista),
RANGO o VOLÁTIL, con un nivel de confianza. Es CONTEXTO: explica por qué una
estrategia de reversión fracasa en tendencia (el oro) o triunfa en rango (USDCAD).

No predice el futuro ni cambia la lógica de trades: es metadato del (símbolo, tf,
periodo) para guiar el MATCH/MISMATCH estrategia↔régimen.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from . import indicators as ind

TREND_UP = "TENDENCIA_ALCISTA"
TREND_DOWN = "TENDENCIA_BAJISTA"
RANGE = "RANGO"
VOLATILE = "VOLATIL"

# Umbrales (calibrables) sobre AGREGADOS del periodo. Señal principal:
# DIRECCIONALIDAD = |cambio neto| / (máx-mín) → ~1 tendencia limpia, ~0 rango.
# (El Efficiency Ratio de Kaufman a 1 año en intradía es minúsculo por el ruido;
#  la direccionalidad sobre el rango del periodo separa mucho mejor.)
_DIR_TREND, _DIR_RANGE = 0.45, 0.25
_ADX_TREND, _ADX_RANGE = 25.0, 18.0
_VOL_RATIO = 1.8


def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def _last(series: pd.Series) -> float | None:
    s = series.dropna()
    return float(s.iloc[-1]) if len(s) else None


def classify_regime(candles: list[dict[str, Any]], adx_period: int = 14, er_period: int = 20) -> dict[str, Any]:
    """Devuelve {regime, confidence, adx, efficiency_ratio, atr_pct, ma200_side, ...}.

    regime es None si no hay datos suficientes (<30 velas)."""
    empty = {
        "regime": None, "confidence": 0.0, "adx": None, "efficiency_ratio": None,
        "atr_pct": None, "ma200_side": None, "ma_period": None, "candles": len(candles or []),
    }
    if not candles or len(candles) < 30:
        return empty

    df = pd.DataFrame(candles).sort_values("time").reset_index(drop=True)
    n = len(df)
    close = df["close"]
    first, last = float(close.iloc[0]), float(close.iloc[-1])

    # Agregados del PERIODO (no del último instante):
    adx_ser = ind.adx(df, adx_period).dropna()
    adx_mean = float(adx_ser.mean()) if len(adx_ser) else None     # fuerza media de tendencia
    diffs = float(close.diff().abs().sum())                         # recorrido total
    period_er = (abs(last - first) / diffs) if diffs > 0 else None  # ER de Kaufman (diagnóstico)
    net_change_pct = ((last - first) / first * 100.0) if first else 0.0
    # Direccionalidad: cuánto del rango total se convirtió en movimiento neto.
    price_range = float(close.max() - close.min())
    directionality = (abs(last - first) / price_range) if price_range > 0 else None

    atr_ser = ind.atr(df, adx_period)
    atr_now = _last(atr_ser)
    atr_med = float(atr_ser.dropna().median()) if atr_ser.notna().any() else None
    atr_pct = (atr_now / last * 100.0) if (atr_now and last) else None
    vol_ratio = (atr_now / atr_med) if (atr_now and atr_med) else None

    # MA200 (o la mayor posible si hay <200 velas); sesgo de dirección macro.
    ma_period = 200 if n >= 200 else max(50, n // 2)
    ma_v = _last(ind.sma(close, ma_period))
    ma200_side = None if ma_v is None else ("above" if last >= ma_v else "below")

    # Votos tendencia vs rango sobre los agregados (direccionalidad + ADX medio).
    votes_trend = votes_range = 0
    if directionality is not None:
        votes_trend += directionality >= _DIR_TREND
        votes_range += directionality <= _DIR_RANGE
    if adx_mean is not None:
        votes_trend += adx_mean >= _ADX_TREND
        votes_range += adx_mean <= _ADX_RANGE

    # Scores normalizados (0..1) para la confianza (la direccionalidad manda).
    dir_norm = _clamp(((directionality or 0) - 0.20) / 0.40)   # 0.20→0, 0.60→1
    adx_norm = _clamp(((adx_mean or 0) - 18.0) / 14.0)         # 18→0, 32→1
    trend_score = 0.7 * dir_norm + 0.3 * adx_norm

    volatile = bool(vol_ratio is not None and vol_ratio >= _VOL_RATIO and (directionality is None or directionality < _DIR_TREND))

    if volatile:
        regime = VOLATILE
        confidence = _clamp((vol_ratio - 1.0) / 1.0)
    elif votes_trend > votes_range or (votes_trend == votes_range and trend_score >= 0.5):
        regime = TREND_UP if net_change_pct >= 0 else TREND_DOWN
        confidence = trend_score
    else:
        regime = RANGE
        confidence = 1.0 - trend_score

    return {
        "regime": regime,
        "confidence": round(float(confidence), 2),
        "adx": round(adx_mean, 1) if adx_mean is not None else None,
        "efficiency_ratio": round(period_er, 3) if period_er is not None else None,
        "directionality": round(directionality, 3) if directionality is not None else None,
        "net_change_pct": round(net_change_pct, 2),
        "atr_pct": round(atr_pct, 3) if atr_pct is not None else None,
        "vol_ratio": round(vol_ratio, 2) if vol_ratio is not None else None,
        "ma200_side": ma200_side,
        "ma_period": ma_period,
        "candles": n,
    }
