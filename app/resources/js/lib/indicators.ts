import type { Candle } from '@/types';

export interface LinePoint {
    time: number;
    value: number;
}

/** Media móvil exponencial sobre una serie de valores. */
function ema(values: number[], period: number): number[] {
    const k = 2 / (period + 1);
    const out: number[] = [];
    let prev = values[0];
    values.forEach((v, i) => {
        prev = i === 0 ? v : v * k + prev * (1 - k);
        out.push(prev);
    });
    return out;
}

/**
 * RSI de Wilder. Devuelve puntos desde la vela `period` en adelante.
 */
export function rsi(candles: Candle[], period = 14): LinePoint[] {
    if (candles.length <= period) return [];
    const out: LinePoint[] = [];
    let avgGain = 0;
    let avgLoss = 0;

    for (let i = 1; i <= period; i++) {
        const diff = candles[i].close - candles[i - 1].close;
        if (diff >= 0) avgGain += diff;
        else avgLoss -= diff;
    }
    avgGain /= period;
    avgLoss /= period;

    const push = (i: number) => {
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const value = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
        out.push({ time: candles[i].time, value });
    };
    push(period);

    for (let i = period + 1; i < candles.length; i++) {
        const diff = candles[i].close - candles[i - 1].close;
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        push(i);
    }
    return out;
}

export interface MacdResult {
    macd: LinePoint[];
    signal: LinePoint[];
    histogram: LinePoint[];
}

/** MACD(12,26,9). */
export function macd(candles: Candle[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
    if (candles.length <= slow) return { macd: [], signal: [], histogram: [] };
    const closes = candles.map((c) => c.close);
    const emaFast = ema(closes, fast);
    const emaSlow = ema(closes, slow);

    const macdValues = closes.map((_, i) => emaFast[i] - emaSlow[i]);
    const signalValues = ema(macdValues, signalPeriod);

    const macdLine: LinePoint[] = [];
    const signalLine: LinePoint[] = [];
    const histogram: LinePoint[] = [];

    candles.forEach((c, i) => {
        if (i < slow) return;
        macdLine.push({ time: c.time, value: macdValues[i] });
        signalLine.push({ time: c.time, value: signalValues[i] });
        histogram.push({ time: c.time, value: macdValues[i] - signalValues[i] });
    });

    return { macd: macdLine, signal: signalLine, histogram };
}
