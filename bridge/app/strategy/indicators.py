"""Indicadores técnicos sobre pandas (sin ta-lib para evitar dependencias C).

Todas las funciones reciben una Serie de precios de cierre (o un DataFrame de
velas) y devuelven Series alineadas al índice original.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def sma(close: pd.Series, period: int) -> pd.Series:
    return close.rolling(window=period, min_periods=period).mean()


def ema(close: pd.Series, period: int) -> pd.Series:
    return close.ewm(span=period, adjust=False).mean()


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    """RSI de Wilder."""
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = avg_gain / avg_loss
    out = 100 - (100 / (1 + rs))
    # Si no hay pérdidas, RSI = 100.
    out = out.where(avg_loss != 0, 100.0)
    return out


def macd(
    close: pd.Series,
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Devuelve (macd, signal, histogram)."""
    ema_fast = ema(close, fast)
    ema_slow = ema(close, slow)
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def bollinger(
    close: pd.Series,
    period: int = 20,
    std_dev: float = 2.0,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Devuelve (upper, middle, lower)."""
    middle = sma(close, period)
    std = close.rolling(window=period, min_periods=period).std(ddof=0)
    upper = middle + std_dev * std
    lower = middle - std_dev * std
    return upper, middle, lower


def _true_range(df: pd.DataFrame) -> pd.Series:
    high, low, close = df["high"], df["low"], df["close"]
    prev_close = close.shift(1)
    return pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Average True Range (Wilder/RMA) en unidades de PRECIO.

    True Range = max(high-low, |high-prev_close|, |low-prev_close|); el ATR es su
    media exponencial de Wilder (alpha=1/period). NaN hasta tener `period` velas.
    Mide la volatilidad real reciente; base del SL/TP adaptativo (Fase 1).
    """
    return _true_range(df).ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()


def adx(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Average Directional Index (Wilder). Mide la FUERZA de la tendencia (no la
    dirección): >25 tendencia fuerte, <20 rango. Reutilizable como filtro (Fase 3)."""
    high, low = df["high"], df["low"]
    up = high.diff()
    down = -low.diff()
    plus_dm = ((up > down) & (up > 0)) * up.clip(lower=0)
    minus_dm = ((down > up) & (down > 0)) * down.clip(lower=0)

    tr = _true_range(df)
    a = 1.0 / period
    atr_ = tr.ewm(alpha=a, adjust=False, min_periods=period).mean()
    plus_di = 100.0 * plus_dm.ewm(alpha=a, adjust=False, min_periods=period).mean() / atr_
    minus_di = 100.0 * minus_dm.ewm(alpha=a, adjust=False, min_periods=period).mean() / atr_
    denom = (plus_di + minus_di).replace(0, float("nan"))
    dx = 100.0 * (plus_di - minus_di).abs() / denom
    return dx.ewm(alpha=a, adjust=False, min_periods=period).mean()


def efficiency_ratio(close: pd.Series, period: int = 20) -> pd.Series:
    """Efficiency Ratio de Kaufman: |cambio neto| / Σ|cambios|. Mide qué tan LIMPIO
    es el movimiento: ~1 = tendencia directa, ~0 = ruido/rango."""
    change = close.diff(period).abs()
    volatility = close.diff().abs().rolling(window=period, min_periods=period).sum()
    return change / volatility.replace(0, float("nan"))


# --------------------------------------------------------------------------- #
# Fase 4 — Indicadores de tendencia y momentum
# --------------------------------------------------------------------------- #
def supertrend(df: pd.DataFrame, period: int = 10, multiplier: float = 3.0) -> tuple[pd.Series, pd.Series]:
    """Supertrend (basado en ATR). Devuelve (línea, dirección) donde dirección es
    +1 (tendencia alcista, soporte abajo) o -1 (bajista, resistencia arriba).

    Bandas hl2 ± multiplier×ATR con arrastre (path-dependent → bucle). La señal de
    una estrategia es el VOLTEO de la dirección. NaN hasta tener ATR válido."""
    high, low, close = df["high"].to_numpy(float), df["low"].to_numpy(float), df["close"].to_numpy(float)
    atr_ = atr(df, period).to_numpy(float)
    hl2 = (high + low) / 2.0
    upper = hl2 + multiplier * atr_
    lower = hl2 - multiplier * atr_
    n = len(close)
    st = np.full(n, np.nan)
    direction = np.full(n, np.nan)

    f_upper = f_lower = np.nan
    prev_dir = -1  # arranca como bajista hasta el primer dato válido
    for i in range(n):
        if np.isnan(atr_[i]):
            continue
        if np.isnan(f_upper):  # primera vela válida
            f_upper, f_lower = upper[i], lower[i]
            direction[i] = prev_dir = 1 if close[i] >= f_upper else -1
            st[i] = f_lower if direction[i] == 1 else f_upper
            continue
        # Bandas finales con arrastre.
        f_upper = upper[i] if (upper[i] < f_upper or close[i - 1] > f_upper) else f_upper
        f_lower = lower[i] if (lower[i] > f_lower or close[i - 1] < f_lower) else f_lower
        # Dirección: cruce del cierre sobre la banda contraria.
        if prev_dir == 1:
            d = -1 if close[i] < f_lower else 1
        else:
            d = 1 if close[i] > f_upper else -1
        direction[i] = prev_dir = d
        st[i] = f_lower if d == 1 else f_upper

    idx = df.index
    return pd.Series(st, index=idx), pd.Series(direction, index=idx)


def ichimoku(df: pd.DataFrame, tenkan: int = 9, kijun: int = 26, senkou_b: int = 52,
             displacement: int = 26) -> tuple[pd.Series, pd.Series, pd.Series, pd.Series]:
    """Ichimoku. Devuelve (tenkan, kijun, span_a, span_b) ALINEADOS para evaluar SIN
    lookahead: span_a/span_b en la vela N usan datos de hace `displacement` velas
    (shift hacia ADELANTE), nunca futuros. El Chikou span NO se usa para señales
    (sería mirar al pasado proyectado y suele inducir sesgo)."""
    high, low = df["high"], df["low"]

    def _mid(p: int) -> pd.Series:
        return (high.rolling(p, min_periods=p).max() + low.rolling(p, min_periods=p).min()) / 2.0

    tenkan_s = _mid(tenkan)
    kijun_s = _mid(kijun)
    # Las nubes se proyectan +displacement; shift(+) trae valores PASADOS al índice
    # actual → la nube en N proviene de N-displacement (sin mirar el futuro).
    span_a = ((tenkan_s + kijun_s) / 2.0).shift(displacement)
    span_b = _mid(senkou_b).shift(displacement)
    return tenkan_s, kijun_s, span_a, span_b


def donchian(df: pd.DataFrame, period: int = 20) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Canales de Donchian: (upper, lower, mid) del canal de los N periodos PREVIOS
    (shift(1) → no incluye la vela actual, evita lookahead). Breakout = el cierre
    supera el canal previo."""
    upper = df["high"].rolling(period, min_periods=period).max().shift(1)
    lower = df["low"].rolling(period, min_periods=period).min().shift(1)
    return upper, lower, (upper + lower) / 2.0


def stochastic(df: pd.DataFrame, k_period: int = 14, d_period: int = 3,
               smooth: int = 3) -> tuple[pd.Series, pd.Series]:
    """Oscilador estocástico: (%K, %D). %K = SMA(%K_raw, smooth); %D = SMA(%K, d)."""
    low_min = df["low"].rolling(k_period, min_periods=k_period).min()
    high_max = df["high"].rolling(k_period, min_periods=k_period).max()
    rng = (high_max - low_min).replace(0, float("nan"))
    k_raw = 100.0 * (df["close"] - low_min) / rng
    k = k_raw.rolling(smooth, min_periods=smooth).mean()
    d = k.rolling(d_period, min_periods=d_period).mean()
    return k, d


def cci(df: pd.DataFrame, period: int = 20) -> pd.Series:
    """Commodity Channel Index. (TP − SMA(TP)) / (0.015 × desviación media)."""
    tp = (df["high"] + df["low"] + df["close"]) / 3.0
    sma_tp = tp.rolling(period, min_periods=period).mean()
    mad = tp.rolling(period, min_periods=period).apply(
        lambda x: np.abs(x - x.mean()).mean(), raw=True
    )
    return (tp - sma_tp) / (0.015 * mad.replace(0, float("nan")))


def parabolic_sar(df: pd.DataFrame, af_step: float = 0.02,
                  af_max: float = 0.2) -> tuple[pd.Series, pd.Series]:
    """Parabolic SAR (Wilder). Devuelve (sar, dirección) con dirección +1 (alcista)
    o -1 (bajista). Iterativo/path-dependent; la señal es el VOLTEO del SAR."""
    high, low = df["high"].to_numpy(float), df["low"].to_numpy(float)
    n = len(high)
    sar = np.full(n, np.nan)
    direction = np.full(n, np.nan)
    if n < 2:
        return pd.Series(sar, index=df.index), pd.Series(direction, index=df.index)

    # Inicialización: tendencia por las dos primeras velas.
    up = high[1] >= high[0]
    af = af_step
    ep = high[1] if up else low[1]
    sar_val = low[0] if up else high[0]
    direction[0] = 1 if up else -1
    sar[0] = sar_val

    for i in range(1, n):
        sar_val = sar_val + af * (ep - sar_val)
        if up:
            # El SAR no puede entrar en el rango de las 2 velas previas.
            sar_val = min(sar_val, low[i - 1], low[i - 2] if i >= 2 else low[i - 1])
            if low[i] < sar_val:  # voltea a bajista
                up = False
                sar_val = ep
                ep = low[i]
                af = af_step
            elif high[i] > ep:
                ep = high[i]
                af = min(af + af_step, af_max)
        else:
            sar_val = max(sar_val, high[i - 1], high[i - 2] if i >= 2 else high[i - 1])
            if high[i] > sar_val:  # voltea a alcista
                up = True
                sar_val = ep
                ep = high[i]
                af = af_step
            elif low[i] < ep:
                ep = low[i]
                af = min(af + af_step, af_max)
        sar[i] = sar_val
        direction[i] = 1 if up else -1

    return pd.Series(sar, index=df.index), pd.Series(direction, index=df.index)
