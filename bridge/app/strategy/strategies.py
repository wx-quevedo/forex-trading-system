"""Implementaciones de estrategias + registry + schemas de parámetros.

Los `STRATEGY_SCHEMAS` describen los campos configurables de cada tipo y se
exponen al frontend (`GET /strategy/types`) para renderizar el formulario
dinámico de la Fase 4.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from . import indicators as ind
from .base import Signal, Strategy


# --------------------------------------------------------------------------- #
# Implementaciones
# --------------------------------------------------------------------------- #
class MaCrossStrategy(Strategy):
    type = "ma_cross"

    def __init__(self, ma_type: str = "ema", fast_period: int = 9, slow_period: int = 21):
        self.ma_type = ma_type
        self.fast_period = int(fast_period)
        self.slow_period = int(slow_period)

    def evaluate(self, df: pd.DataFrame) -> Signal:
        fn = ind.ema if self.ma_type == "ema" else ind.sma
        fast = fn(df["close"], self.fast_period)
        slow = fn(df["close"], self.slow_period)
        snap = {"fast": _last(fast), "slow": _last(slow)}

        if self.crossed_up(fast, slow):
            return _sig("buy", f"{self.ma_type.upper()} rápida cruzó por encima de la lenta", snap, df)
        if self.crossed_down(fast, slow):
            return _sig("sell", f"{self.ma_type.upper()} rápida cruzó por debajo de la lenta", snap, df)
        return _sig("none", "Sin cruce de medias", snap, df)


class RsiStrategy(Strategy):
    type = "rsi"

    def __init__(self, period: int = 14, oversold: float = 30, overbought: float = 70):
        self.period = int(period)
        self.oversold = float(oversold)
        self.overbought = float(overbought)

    def evaluate(self, df: pd.DataFrame) -> Signal:
        r = ind.rsi(df["close"], self.period)
        snap = {"rsi": _last(r)}
        if len(r.dropna()) < 2:
            return _sig("none", "Datos insuficientes para RSI", snap, df)
        prev, curr = r.iloc[-2], r.iloc[-1]
        if prev <= self.oversold < curr:
            return _sig("buy", f"RSI salió de sobreventa ({self.oversold:g})", snap, df)
        if prev >= self.overbought > curr:
            return _sig("sell", f"RSI salió de sobrecompra ({self.overbought:g})", snap, df)
        return _sig("none", "RSI en zona neutra", snap, df)


class MacdStrategy(Strategy):
    type = "macd"

    def __init__(self, fast: int = 12, slow: int = 26, signal: int = 9):
        self.fast = int(fast)
        self.slow = int(slow)
        self.signal = int(signal)

    def evaluate(self, df: pd.DataFrame) -> Signal:
        macd_line, signal_line, hist = ind.macd(df["close"], self.fast, self.slow, self.signal)
        snap = {"macd": _last(macd_line), "signal": _last(signal_line), "histogram": _last(hist)}
        if self.crossed_up(macd_line, signal_line):
            return _sig("buy", "MACD cruzó por encima de su señal", snap, df)
        if self.crossed_down(macd_line, signal_line):
            return _sig("sell", "MACD cruzó por debajo de su señal", snap, df)
        return _sig("none", "Sin cruce MACD/señal", snap, df)


class BollingerStrategy(Strategy):
    type = "bollinger"

    def __init__(self, period: int = 20, std_dev: float = 2.0):
        self.period = int(period)
        self.std_dev = float(std_dev)

    def evaluate(self, df: pd.DataFrame) -> Signal:
        upper, middle, lower = ind.bollinger(df["close"], self.period, self.std_dev)
        snap = {"upper": _last(upper), "middle": _last(middle), "lower": _last(lower), "close": _last(df["close"])}
        if self.crossed_up(df["close"], upper):
            return _sig("buy", "Precio rompió la banda superior (breakout alcista)", snap, df)
        if self.crossed_down(df["close"], lower):
            return _sig("sell", "Precio rompió la banda inferior (breakout bajista)", snap, df)
        return _sig("none", "Precio dentro de las bandas", snap, df)


class CombinedStrategy(Strategy):
    """Filtro de tendencia (MA) + confirmación por RSI, combinables con AND/OR."""

    type = "combined"

    def __init__(
        self,
        trend_ma_type: str = "ema",
        trend_period: int = 50,
        rsi_period: int = 14,
        rsi_oversold: float = 30,
        rsi_overbought: float = 70,
        logic: str = "and",
    ):
        self.trend_ma_type = trend_ma_type
        self.trend_period = int(trend_period)
        self.rsi_period = int(rsi_period)
        self.rsi_oversold = float(rsi_oversold)
        self.rsi_overbought = float(rsi_overbought)
        self.logic = logic

    def evaluate(self, df: pd.DataFrame) -> Signal:
        fn = ind.ema if self.trend_ma_type == "ema" else ind.sma
        trend = fn(df["close"], self.trend_period)
        r = ind.rsi(df["close"], self.rsi_period)
        snap = {"trend_ma": _last(trend), "rsi": _last(r), "close": _last(df["close"])}

        if len(r.dropna()) < 2 or len(trend.dropna()) < 1:
            return _sig("none", "Datos insuficientes", snap, df)

        close = df["close"].iloc[-1]
        prev_r, curr_r = r.iloc[-2], r.iloc[-1]

        trend_up = close > trend.iloc[-1]
        trend_down = close < trend.iloc[-1]
        rsi_buy = prev_r <= self.rsi_oversold < curr_r
        rsi_sell = prev_r >= self.rsi_overbought > curr_r

        combine = (lambda a, b: a and b) if self.logic == "and" else (lambda a, b: a or b)
        if combine(trend_up, rsi_buy):
            return _sig("buy", f"Tendencia alcista {self.logic.upper()} RSI saliendo de sobreventa", snap, df)
        if combine(trend_down, rsi_sell):
            return _sig("sell", f"Tendencia bajista {self.logic.upper()} RSI saliendo de sobrecompra", snap, df)
        return _sig("none", "Condiciones combinadas no cumplidas", snap, df)


# --------------------------------------------------------------------------- #
# Fase 4 — Tendencia
# --------------------------------------------------------------------------- #
class SupertrendStrategy(Strategy):
    """Tendencia por Supertrend (ATR). Señal al VOLTEAR la dirección."""

    type = "supertrend"

    def __init__(self, period: int = 10, multiplier: float = 3.0):
        self.period = int(period)
        self.multiplier = float(multiplier)

    def evaluate(self, df: pd.DataFrame) -> Signal:
        line, direction = ind.supertrend(df, self.period, self.multiplier)
        snap = {"supertrend": _last(line), "direction": _last(direction)}
        d = direction.dropna()
        if len(d) < 2:
            return _sig("none", "Datos insuficientes para Supertrend", snap, df)
        prev, curr = d.iloc[-2], d.iloc[-1]
        if prev == -1 and curr == 1:
            return _sig("buy", "Supertrend volteó a alcista", snap, df)
        if prev == 1 and curr == -1:
            return _sig("sell", "Supertrend volteó a bajista", snap, df)
        return _sig("none", "Supertrend sin cambio de dirección", snap, df)


class IchimokuStrategy(Strategy):
    """Ichimoku: cruce Tenkan/Kijun CONFIRMADO por el precio sobre/bajo la nube.

    La nube usada en cada vela proviene de datos pasados (sin lookahead)."""

    type = "ichimoku"

    def __init__(self, tenkan: int = 9, kijun: int = 26, senkou_b: int = 52):
        self.tenkan = int(tenkan)
        self.kijun = int(kijun)
        self.senkou_b = int(senkou_b)

    def evaluate(self, df: pd.DataFrame) -> Signal:
        tenkan, kijun, span_a, span_b = ind.ichimoku(df, self.tenkan, self.kijun, self.senkou_b)
        snap = {"tenkan": _last(tenkan), "kijun": _last(kijun),
                "span_a": _last(span_a), "span_b": _last(span_b), "close": _last(df["close"])}
        if len(tenkan.dropna()) < 2 or pd.isna(span_a.iloc[-1]) or pd.isna(span_b.iloc[-1]):
            return _sig("none", "Datos insuficientes para Ichimoku", snap, df)
        close = float(df["close"].iloc[-1])
        cloud_top = max(span_a.iloc[-1], span_b.iloc[-1])
        cloud_bot = min(span_a.iloc[-1], span_b.iloc[-1])
        tk_up = tenkan.iloc[-2] <= kijun.iloc[-2] and tenkan.iloc[-1] > kijun.iloc[-1]
        tk_down = tenkan.iloc[-2] >= kijun.iloc[-2] and tenkan.iloc[-1] < kijun.iloc[-1]
        if tk_up and close > cloud_top:
            return _sig("buy", "Tenkan cruzó al alza con precio sobre la nube", snap, df)
        if tk_down and close < cloud_bot:
            return _sig("sell", "Tenkan cruzó a la baja con precio bajo la nube", snap, df)
        return _sig("none", "Sin cruce confirmado por la nube", snap, df)


class DonchianStrategy(Strategy):
    """Breakout del canal de Donchian de N periodos, con buffer ATR antifalsos."""

    type = "donchian"

    def __init__(self, period: int = 20, atr_buffer: float = 0.5, atr_period: int = 14):
        self.period = int(period)
        self.atr_buffer = float(atr_buffer)
        self.atr_period = int(atr_period)

    def _bands(self, df: pd.DataFrame):
        upper, lower, mid = ind.donchian(df, self.period)
        if self.atr_buffer:
            buf = ind.atr(df, self.atr_period) * self.atr_buffer
            upper, lower = upper + buf, lower - buf
        return upper, lower, mid

    def evaluate(self, df: pd.DataFrame) -> Signal:
        upper, lower, mid = self._bands(df)
        close = df["close"]
        snap = {"upper": _last(upper), "lower": _last(lower), "close": _last(close)}
        if len(upper.dropna()) < 2:
            return _sig("none", "Datos insuficientes para Donchian", snap, df)
        if close.iloc[-2] <= upper.iloc[-2] and close.iloc[-1] > upper.iloc[-1]:
            return _sig("buy", "Ruptura alcista del canal de Donchian", snap, df)
        if close.iloc[-2] >= lower.iloc[-2] and close.iloc[-1] < lower.iloc[-1]:
            return _sig("sell", "Ruptura bajista del canal de Donchian", snap, df)
        return _sig("none", "Precio dentro del canal", snap, df)


# --------------------------------------------------------------------------- #
# Fase 4 — Momentum
# --------------------------------------------------------------------------- #
class StochasticStrategy(Strategy):
    """Estocástico: cruce %K/%D dentro de zona de sobreventa/sobrecompra."""

    type = "stochastic"

    def __init__(self, k_period: int = 14, d_period: int = 3, smooth: int = 3,
                 oversold: float = 20, overbought: float = 80):
        self.k_period = int(k_period)
        self.d_period = int(d_period)
        self.smooth = int(smooth)
        self.oversold = float(oversold)
        self.overbought = float(overbought)

    def evaluate(self, df: pd.DataFrame) -> Signal:
        k, d = ind.stochastic(df, self.k_period, self.d_period, self.smooth)
        snap = {"k": _last(k), "d": _last(d)}
        if len(k.dropna()) < 2 or len(d.dropna()) < 2:
            return _sig("none", "Datos insuficientes para el estocástico", snap, df)
        if k.iloc[-2] <= d.iloc[-2] and k.iloc[-1] > d.iloc[-1] and k.iloc[-2] < self.oversold:
            return _sig("buy", f"%K cruzó %D en sobreventa (<{self.oversold:g})", snap, df)
        if k.iloc[-2] >= d.iloc[-2] and k.iloc[-1] < d.iloc[-1] and k.iloc[-2] > self.overbought:
            return _sig("sell", f"%K cruzó %D en sobrecompra (>{self.overbought:g})", snap, df)
        return _sig("none", "Sin cruce estocástico en zona", snap, df)


class CciStrategy(Strategy):
    """CCI: salida de zonas extremas (cruce de ±umbral)."""

    type = "cci"

    def __init__(self, period: int = 20, threshold: float = 100):
        self.period = int(period)
        self.threshold = float(threshold)

    def evaluate(self, df: pd.DataFrame) -> Signal:
        c = ind.cci(df, self.period)
        snap = {"cci": _last(c)}
        if len(c.dropna()) < 2:
            return _sig("none", "Datos insuficientes para CCI", snap, df)
        prev, curr = c.iloc[-2], c.iloc[-1]
        if prev <= -self.threshold < curr:
            return _sig("buy", f"CCI salió de sobreventa (−{self.threshold:g})", snap, df)
        if prev >= self.threshold > curr:
            return _sig("sell", f"CCI salió de sobrecompra (+{self.threshold:g})", snap, df)
        return _sig("none", "CCI en zona neutra", snap, df)


class PsarStrategy(Strategy):
    """Parabolic SAR: señal al VOLTEAR el SAR de lado."""

    type = "psar"

    def __init__(self, af_step: float = 0.02, af_max: float = 0.2):
        self.af_step = float(af_step)
        self.af_max = float(af_max)

    def evaluate(self, df: pd.DataFrame) -> Signal:
        sar, direction = ind.parabolic_sar(df, self.af_step, self.af_max)
        snap = {"sar": _last(sar), "direction": _last(direction)}
        d = direction.dropna()
        if len(d) < 2:
            return _sig("none", "Datos insuficientes para Parabolic SAR", snap, df)
        prev, curr = d.iloc[-2], d.iloc[-1]
        if prev == -1 and curr == 1:
            return _sig("buy", "Parabolic SAR volteó a alcista", snap, df)
        if prev == 1 and curr == -1:
            return _sig("sell", "Parabolic SAR volteó a bajista", snap, df)
        return _sig("none", "Parabolic SAR sin volteo", snap, df)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _last(series: pd.Series) -> float | None:
    val = series.iloc[-1] if len(series) else None
    if val is None or pd.isna(val):
        return None
    return round(float(val), 6)


def _sig(signal: str, reason: str, indicators: dict[str, Any], df: pd.DataFrame) -> Signal:
    last = df.iloc[-1]
    return Signal(
        signal=signal,  # type: ignore[arg-type]
        reason=reason,
        indicators=indicators,
        price=round(float(last["close"]), 6),
        time=int(last["time"]) if "time" in df.columns else None,
    )


# --------------------------------------------------------------------------- #
# Registry + schemas
# --------------------------------------------------------------------------- #
_REGISTRY: dict[str, type[Strategy]] = {
    "ma_cross": MaCrossStrategy,
    "rsi": RsiStrategy,
    "macd": MacdStrategy,
    "bollinger": BollingerStrategy,
    "combined": CombinedStrategy,
    # Fase 4
    "supertrend": SupertrendStrategy,
    "ichimoku": IchimokuStrategy,
    "donchian": DonchianStrategy,
    "stochastic": StochasticStrategy,
    "cci": CciStrategy,
    "psar": PsarStrategy,
}

_MA_OPTIONS = [{"value": "sma", "label": "SMA"}, {"value": "ema", "label": "EMA"}]
_LOGIC_OPTIONS = [{"value": "and", "label": "AND (ambas)"}, {"value": "or", "label": "OR (cualquiera)"}]


STRATEGY_SCHEMAS: dict[str, dict[str, Any]] = {
    "ma_cross": {
        "label": "Moving Average Cross",
        "description": "Compra cuando la media rápida cruza por encima de la lenta; vende al contrario.",
        "fields": [
            {"name": "ma_type", "label": "MA Type", "type": "select", "default": "ema", "options": _MA_OPTIONS},
            {"name": "fast_period", "label": "Fast Period", "type": "number", "default": 9, "min": 1, "max": 200, "step": 1},
            {"name": "slow_period", "label": "Slow Period", "type": "number", "default": 21, "min": 2, "max": 400, "step": 1},
        ],
    },
    "rsi": {
        "label": "RSI",
        "description": "Compra cuando el RSI sale de sobreventa; vende cuando sale de sobrecompra.",
        "fields": [
            {"name": "period", "label": "RSI Period", "type": "number", "default": 14, "min": 2, "max": 100, "step": 1},
            {"name": "oversold", "label": "Oversold Level", "type": "number", "default": 30, "min": 1, "max": 49, "step": 1},
            {"name": "overbought", "label": "Overbought Level", "type": "number", "default": 70, "min": 51, "max": 99, "step": 1},
        ],
    },
    "macd": {
        "label": "MACD",
        "description": "Compra cuando el MACD cruza por encima de su línea de señal; vende al contrario.",
        "fields": [
            {"name": "fast", "label": "Fast", "type": "number", "default": 12, "min": 2, "max": 100, "step": 1},
            {"name": "slow", "label": "Slow", "type": "number", "default": 26, "min": 3, "max": 200, "step": 1},
            {"name": "signal", "label": "Signal", "type": "number", "default": 9, "min": 2, "max": 100, "step": 1},
        ],
    },
    "bollinger": {
        "label": "Bollinger Bands",
        "description": "Compra cuando el precio rompe la banda superior; vende cuando rompe la inferior.",
        "fields": [
            {"name": "period", "label": "Period", "type": "number", "default": 20, "min": 2, "max": 200, "step": 1},
            {"name": "std_dev", "label": "Deviation", "type": "number", "default": 2.0, "min": 0.5, "max": 4, "step": 0.1},
        ],
    },
    "combined": {
        "label": "Combined",
        "description": "Filtro de tendencia por media móvil combinado con confirmación del RSI (AND/OR).",
        "fields": [
            {"name": "trend_ma_type", "label": "Trend MA Type", "type": "select", "default": "ema", "options": _MA_OPTIONS},
            {"name": "trend_period", "label": "Trend Period", "type": "number", "default": 50, "min": 2, "max": 400, "step": 1},
            {"name": "rsi_period", "label": "RSI Period", "type": "number", "default": 14, "min": 2, "max": 100, "step": 1},
            {"name": "rsi_oversold", "label": "Oversold Level", "type": "number", "default": 30, "min": 1, "max": 49, "step": 1},
            {"name": "rsi_overbought", "label": "Overbought Level", "type": "number", "default": 70, "min": 51, "max": 99, "step": 1},
            {"name": "logic", "label": "Logic", "type": "select", "default": "and", "options": _LOGIC_OPTIONS},
        ],
    },
    "supertrend": {
        "label": "Supertrend",
        "description": "Sigue la tendencia con bandas basadas en ATR; entra cuando la tendencia voltea.",
        "fields": [
            {"name": "period", "label": "ATR Period", "type": "number", "default": 10, "min": 2, "max": 100, "step": 1},
            {"name": "multiplier", "label": "ATR Multiplier", "type": "number", "default": 3.0, "min": 0.5, "max": 10, "step": 0.5},
        ],
    },
    "ichimoku": {
        "label": "Ichimoku Cloud",
        "description": "Cruce Tenkan/Kijun confirmado por la posición del precio respecto a la nube.",
        "fields": [
            {"name": "tenkan", "label": "Tenkan Period", "type": "number", "default": 9, "min": 2, "max": 60, "step": 1},
            {"name": "kijun", "label": "Kijun Period", "type": "number", "default": 26, "min": 5, "max": 120, "step": 1},
            {"name": "senkou_b", "label": "Senkou B Period", "type": "number", "default": 52, "min": 10, "max": 240, "step": 1},
        ],
    },
    "donchian": {
        "label": "Donchian Channels",
        "description": "Breakout del canal de N periodos, con buffer ATR para filtrar falsas rupturas.",
        "fields": [
            {"name": "period", "label": "Channel Period", "type": "number", "default": 20, "min": 5, "max": 200, "step": 1},
            {"name": "atr_buffer", "label": "ATR Buffer", "type": "number", "default": 0.5, "min": 0, "max": 3, "step": 0.1},
            {"name": "atr_period", "label": "ATR Period", "type": "number", "default": 14, "min": 2, "max": 100, "step": 1},
        ],
    },
    "stochastic": {
        "label": "Stochastic Oscillator",
        "description": "Cruce de %K y %D dentro de zonas de sobreventa/sobrecompra.",
        "fields": [
            {"name": "k_period", "label": "%K Period", "type": "number", "default": 14, "min": 2, "max": 100, "step": 1},
            {"name": "d_period", "label": "%D Period", "type": "number", "default": 3, "min": 1, "max": 50, "step": 1},
            {"name": "smooth", "label": "Smooth", "type": "number", "default": 3, "min": 1, "max": 50, "step": 1},
            {"name": "oversold", "label": "Oversold Level", "type": "number", "default": 20, "min": 1, "max": 49, "step": 1},
            {"name": "overbought", "label": "Overbought Level", "type": "number", "default": 80, "min": 51, "max": 99, "step": 1},
        ],
    },
    "cci": {
        "label": "CCI",
        "description": "Commodity Channel Index: entra al salir de zonas extremas (±umbral).",
        "fields": [
            {"name": "period", "label": "CCI Period", "type": "number", "default": 20, "min": 2, "max": 100, "step": 1},
            {"name": "threshold", "label": "Threshold", "type": "number", "default": 100, "min": 50, "max": 300, "step": 10},
        ],
    },
    "psar": {
        "label": "Parabolic SAR",
        "description": "Sigue la tendencia; entra cuando el SAR voltea de lado.",
        "fields": [
            {"name": "af_step", "label": "AF Step", "type": "number", "default": 0.02, "min": 0.005, "max": 0.1, "step": 0.005},
            {"name": "af_max", "label": "AF Max", "type": "number", "default": 0.2, "min": 0.05, "max": 0.5, "step": 0.05},
        ],
    },
}


def signal_series(strategy: Strategy, df: pd.DataFrame) -> pd.Series:
    """Serie vectorizada de señales ('buy'/'sell'/'none') por vela.

    Usada por el backtester (Fase 5). Refleja la misma lógica que `evaluate()`
    pero sobre toda la serie en lugar de solo la última vela.
    """
    close = df["close"]
    buy = pd.Series(False, index=df.index)
    sell = pd.Series(False, index=df.index)
    t = strategy.type

    if t == "ma_cross":
        fn = ind.ema if strategy.ma_type == "ema" else ind.sma  # type: ignore[attr-defined]
        fast = fn(close, strategy.fast_period)  # type: ignore[attr-defined]
        slow = fn(close, strategy.slow_period)  # type: ignore[attr-defined]
        buy = (fast.shift(1) <= slow.shift(1)) & (fast > slow)
        sell = (fast.shift(1) >= slow.shift(1)) & (fast < slow)
    elif t == "rsi":
        r = ind.rsi(close, strategy.period)  # type: ignore[attr-defined]
        buy = (r.shift(1) <= strategy.oversold) & (r > strategy.oversold)  # type: ignore[attr-defined]
        sell = (r.shift(1) >= strategy.overbought) & (r < strategy.overbought)  # type: ignore[attr-defined]
    elif t == "macd":
        macd_line, signal_line, _ = ind.macd(close, strategy.fast, strategy.slow, strategy.signal)  # type: ignore[attr-defined]
        buy = (macd_line.shift(1) <= signal_line.shift(1)) & (macd_line > signal_line)
        sell = (macd_line.shift(1) >= signal_line.shift(1)) & (macd_line < signal_line)
    elif t == "bollinger":
        upper, _, lower = ind.bollinger(close, strategy.period, strategy.std_dev)  # type: ignore[attr-defined]
        buy = (close.shift(1) <= upper.shift(1)) & (close > upper)
        sell = (close.shift(1) >= lower.shift(1)) & (close < lower)
    elif t == "combined":
        fn = ind.ema if strategy.trend_ma_type == "ema" else ind.sma  # type: ignore[attr-defined]
        trend = fn(close, strategy.trend_period)  # type: ignore[attr-defined]
        r = ind.rsi(close, strategy.rsi_period)  # type: ignore[attr-defined]
        trend_up = close > trend
        trend_down = close < trend
        rsi_buy = (r.shift(1) <= strategy.rsi_oversold) & (r > strategy.rsi_oversold)  # type: ignore[attr-defined]
        rsi_sell = (r.shift(1) >= strategy.rsi_overbought) & (r < strategy.rsi_overbought)  # type: ignore[attr-defined]
        if strategy.logic == "and":  # type: ignore[attr-defined]
            buy, sell = trend_up & rsi_buy, trend_down & rsi_sell
        else:
            buy, sell = trend_up | rsi_buy, trend_down | rsi_sell
    elif t == "supertrend":
        _, direction = ind.supertrend(df, strategy.period, strategy.multiplier)  # type: ignore[attr-defined]
        buy = (direction.shift(1) == -1) & (direction == 1)
        sell = (direction.shift(1) == 1) & (direction == -1)
    elif t == "ichimoku":
        tenkan, kijun, span_a, span_b = ind.ichimoku(df, strategy.tenkan, strategy.kijun, strategy.senkou_b)  # type: ignore[attr-defined]
        cloud_top = pd.concat([span_a, span_b], axis=1).max(axis=1)
        cloud_bot = pd.concat([span_a, span_b], axis=1).min(axis=1)
        tk_up = (tenkan.shift(1) <= kijun.shift(1)) & (tenkan > kijun)
        tk_down = (tenkan.shift(1) >= kijun.shift(1)) & (tenkan < kijun)
        buy = tk_up & (close > cloud_top)
        sell = tk_down & (close < cloud_bot)
    elif t == "donchian":
        upper, lower, _ = ind.donchian(df, strategy.period)  # type: ignore[attr-defined]
        if strategy.atr_buffer:  # type: ignore[attr-defined]
            buf = ind.atr(df, strategy.atr_period) * strategy.atr_buffer  # type: ignore[attr-defined]
            upper, lower = upper + buf, lower - buf
        buy = (close.shift(1) <= upper.shift(1)) & (close > upper)
        sell = (close.shift(1) >= lower.shift(1)) & (close < lower)
    elif t == "stochastic":
        k, d = ind.stochastic(df, strategy.k_period, strategy.d_period, strategy.smooth)  # type: ignore[attr-defined]
        buy = (k.shift(1) <= d.shift(1)) & (k > d) & (k.shift(1) < strategy.oversold)  # type: ignore[attr-defined]
        sell = (k.shift(1) >= d.shift(1)) & (k < d) & (k.shift(1) > strategy.overbought)  # type: ignore[attr-defined]
    elif t == "cci":
        c = ind.cci(df, strategy.period)  # type: ignore[attr-defined]
        th = strategy.threshold  # type: ignore[attr-defined]
        buy = (c.shift(1) <= -th) & (c > -th)
        sell = (c.shift(1) >= th) & (c < th)
    elif t == "psar":
        _, direction = ind.parabolic_sar(df, strategy.af_step, strategy.af_max)  # type: ignore[attr-defined]
        buy = (direction.shift(1) == -1) & (direction == 1)
        sell = (direction.shift(1) == 1) & (direction == -1)

    out = pd.Series("none", index=df.index, dtype=object)
    out[buy.fillna(False)] = "buy"
    out[sell.fillna(False) & ~buy.fillna(False)] = "sell"
    return out


def build_strategy(type_: str, params: dict[str, Any] | None = None) -> Strategy:
    """Instancia una estrategia rellenando los parámetros faltantes con sus defaults."""
    if type_ not in _REGISTRY:
        raise ValueError(f"Tipo de estrategia desconocido: '{type_}'. Válidos: {', '.join(_REGISTRY)}")

    schema = STRATEGY_SCHEMAS[type_]
    resolved: dict[str, Any] = {f["name"]: f["default"] for f in schema["fields"]}
    for key, value in (params or {}).items():
        if key in resolved and value is not None and value != "":
            resolved[key] = value
    return _REGISTRY[type_](**resolved)
