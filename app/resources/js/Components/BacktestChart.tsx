import { useEffect, useRef } from 'react';
import {
    createChart,
    CandlestickSeries,
    createSeriesMarkers,
    ColorType,
    type SeriesMarker,
    type UTCTimestamp,
} from 'lightweight-charts';
import type { BacktestTrade, Candle } from '@/types';

interface Props {
    candles: Candle[];
    trades: BacktestTrade[];
    height?: number;
}

const C = {
    bg: '#0d0e11',
    text: '#8b8fa8',
    grid: '#1c1e24',
    border: '#2a2d36',
    up: '#26a69a',
    down: '#ef5350',
};

const t = (time: number) => time as UTCTimestamp;

/** Velas del backtest con marcadores de entrada/salida de cada trade. */
export default function BacktestChart({ candles, trades, height = 420 }: Props) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = ref.current;
        if (!container || candles.length === 0) return;

        const chart = createChart(container, {
            width: container.clientWidth,
            height,
            layout: {
                background: { type: ColorType.Solid, color: C.bg },
                textColor: C.text,
                fontFamily: "'JetBrains Mono', monospace",
            },
            grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
            rightPriceScale: { borderColor: C.border },
            timeScale: { borderColor: C.border, timeVisible: true, secondsVisible: false },
            crosshair: { mode: 1 },
        });

        const series = chart.addSeries(CandlestickSeries, {
            upColor: C.up,
            downColor: C.down,
            borderVisible: false,
            wickUpColor: C.up,
            wickDownColor: C.down,
        });
        series.setData(
            candles.map((c) => ({ time: t(c.time), open: c.open, high: c.high, low: c.low, close: c.close })),
        );

        // Marcadores: entrada (flecha) + salida (círculo coloreado por PnL).
        const markers: SeriesMarker<UTCTimestamp>[] = [];
        for (const tr of trades) {
            const isBuy = tr.direction === 'buy';
            markers.push({
                time: t(tr.entry_time),
                position: isBuy ? 'belowBar' : 'aboveBar',
                color: isBuy ? C.up : C.down,
                shape: isBuy ? 'arrowUp' : 'arrowDown',
                text: isBuy ? 'B' : 'S',
            });
            markers.push({
                time: t(tr.exit_time),
                position: isBuy ? 'aboveBar' : 'belowBar',
                color: tr.pnl >= 0 ? C.up : C.down,
                shape: 'circle',
            });
        }
        markers.sort((a, b) => (a.time as number) - (b.time as number));
        createSeriesMarkers(series, markers);

        chart.timeScale().fitContent();

        const ro = new ResizeObserver((entries) => {
            for (const e of entries) chart.applyOptions({ width: e.contentRect.width });
        });
        ro.observe(container);

        return () => {
            ro.disconnect();
            chart.remove();
        };
    }, [candles, trades, height]);

    return <div ref={ref} className="w-full" />;
}
