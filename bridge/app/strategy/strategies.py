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
}

_MA_OPTIONS = [{"value": "sma", "label": "SMA"}, {"value": "ema", "label": "EMA"}]
_LOGIC_OPTIONS = [{"value": "and", "label": "AND (ambas)"}, {"value": "or", "label": "OR (cualquiera)"}]


STRATEGY_SCHEMAS: dict[str, dict[str, Any]] = {
    "ma_cross": {
        "label": "Cruce de Medias Móviles",
        "description": "Compra cuando la media rápida cruza por encima de la lenta; vende al contrario.",
        "fields": [
            {"name": "ma_type", "label": "Tipo de media", "type": "select", "default": "ema", "options": _MA_OPTIONS},
            {"name": "fast_period", "label": "Periodo rápido", "type": "number", "default": 9, "min": 1, "max": 200, "step": 1},
            {"name": "slow_period", "label": "Periodo lento", "type": "number", "default": 21, "min": 2, "max": 400, "step": 1},
        ],
    },
    "rsi": {
        "label": "RSI Sobreventa/Sobrecompra",
        "description": "Compra cuando el RSI sale de sobreventa; vende cuando sale de sobrecompra.",
        "fields": [
            {"name": "period", "label": "Periodo RSI", "type": "number", "default": 14, "min": 2, "max": 100, "step": 1},
            {"name": "oversold", "label": "Nivel sobreventa", "type": "number", "default": 30, "min": 1, "max": 49, "step": 1},
            {"name": "overbought", "label": "Nivel sobrecompra", "type": "number", "default": 70, "min": 51, "max": 99, "step": 1},
        ],
    },
    "macd": {
        "label": "Cruce MACD",
        "description": "Compra cuando el MACD cruza por encima de su línea de señal; vende al contrario.",
        "fields": [
            {"name": "fast", "label": "EMA rápida", "type": "number", "default": 12, "min": 2, "max": 100, "step": 1},
            {"name": "slow", "label": "EMA lenta", "type": "number", "default": 26, "min": 3, "max": 200, "step": 1},
            {"name": "signal", "label": "EMA señal", "type": "number", "default": 9, "min": 2, "max": 100, "step": 1},
        ],
    },
    "bollinger": {
        "label": "Ruptura de Bandas de Bollinger",
        "description": "Compra cuando el precio rompe la banda superior; vende cuando rompe la inferior.",
        "fields": [
            {"name": "period", "label": "Periodo", "type": "number", "default": 20, "min": 2, "max": 200, "step": 1},
            {"name": "std_dev", "label": "Desviaciones estándar", "type": "number", "default": 2.0, "min": 0.5, "max": 4, "step": 0.1},
        ],
    },
    "combined": {
        "label": "Combinada (Tendencia + RSI)",
        "description": "Filtro de tendencia por media móvil combinado con confirmación del RSI (AND/OR).",
        "fields": [
            {"name": "trend_ma_type", "label": "MA de tendencia", "type": "select", "default": "ema", "options": _MA_OPTIONS},
            {"name": "trend_period", "label": "Periodo tendencia", "type": "number", "default": 50, "min": 2, "max": 400, "step": 1},
            {"name": "rsi_period", "label": "Periodo RSI", "type": "number", "default": 14, "min": 2, "max": 100, "step": 1},
            {"name": "rsi_oversold", "label": "RSI sobreventa", "type": "number", "default": 30, "min": 1, "max": 49, "step": 1},
            {"name": "rsi_overbought", "label": "RSI sobrecompra", "type": "number", "default": 70, "min": 51, "max": 99, "step": 1},
            {"name": "logic", "label": "Lógica", "type": "select", "default": "and", "options": _LOGIC_OPTIONS},
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
