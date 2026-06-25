import { useEffect, useRef } from 'react';
import {
    createChart,
    CandlestickSeries,
    HistogramSeries,
    LineSeries,
    ColorType,
    LineStyle,
    type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '@/types';
import { rsi, macd } from '@/lib/indicators';

export type Oscillator = 'none' | 'rsi' | 'macd';

interface Props {
    candles: Candle[];
    oscillator: Oscillator;
    height?: number;
}

const COLORS = {
    bg: '#0d0e11',
    text: '#8b8fa8',
    grid: '#1c1e24',
    border: '#2a2d36',
    up: '#26a69a',
    down: '#ef5350',
    accent: '#2962ff',
    warning: '#f59e0b',
};

const t = (time: number) => time as UTCTimestamp;

/**
 * Gráfico de velas (TradingView Lightweight Charts v5) con:
 *  - pane 0: candlesticks
 *  - pane 1: histograma de volumen
 *  - pane 2: oscilador seleccionable (RSI o MACD)
 */
export default function CandleChart({ candles, oscillator, height = 460 }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const chart = createChart(container, {
            width: container.clientWidth,
            height,
            layout: {
                background: { type: ColorType.Solid, color: COLORS.bg },
                textColor: COLORS.text,
                fontFamily: "'JetBrains Mono', monospace",
                panes: { separatorColor: COLORS.border, separatorHoverColor: COLORS.border },
            },
            grid: {
                vertLines: { color: COLORS.grid },
                horzLines: { color: COLORS.grid },
            },
            rightPriceScale: { borderColor: COLORS.border },
            timeScale: { borderColor: COLORS.border, timeVisible: true, secondsVisible: false },
            crosshair: { mode: 1 },
        });

        // --- Pane 0: velas ---
        const candleSeries = chart.addSeries(CandlestickSeries, {
            upColor: COLORS.up,
            downColor: COLORS.down,
            borderVisible: false,
            wickUpColor: COLORS.up,
            wickDownColor: COLORS.down,
        });
        candleSeries.setData(
            candles.map((c) => ({ time: t(c.time), open: c.open, high: c.high, low: c.low, close: c.close })),
        );

        // --- Pane 1: volumen ---
        const volumeSeries = chart.addSeries(
            HistogramSeries,
            { priceFormat: { type: 'volume' }, priceScaleId: '' },
            1,
        );
        volumeSeries.setData(
            candles.map((c) => ({
                time: t(c.time),
                value: c.tick_volume,
                color: c.close >= c.open ? `${COLORS.up}80` : `${COLORS.down}80`,
            })),
        );

        // --- Pane 2: oscilador ---
        if (oscillator === 'rsi') {
            const rsiSeries = chart.addSeries(LineSeries, { color: COLORS.accent, lineWidth: 2 }, 2);
            rsiSeries.setData(rsi(candles).map((p) => ({ time: t(p.time), value: p.value })));
            [30, 70].forEach((lvl) =>
                rsiSeries.createPriceLine({
                    price: lvl,
                    color: COLORS.border,
                    lineWidth: 1,
                    lineStyle: LineStyle.Dashed,
                    axisLabelVisible: true,
                    title: String(lvl),
                }),
            );
        } else if (oscillator === 'macd') {
            const { macd: macdLine, signal, histogram } = macd(candles);
            const histSeries = chart.addSeries(HistogramSeries, { priceScaleId: 'macd' }, 2);
            histSeries.setData(
                histogram.map((p) => ({
                    time: t(p.time),
                    value: p.value,
                    color: p.value >= 0 ? `${COLORS.up}80` : `${COLORS.down}80`,
                })),
            );
            const macdSeries = chart.addSeries(LineSeries, { color: COLORS.accent, lineWidth: 2, priceScaleId: 'macd' }, 2);
            macdSeries.setData(macdLine.map((p) => ({ time: t(p.time), value: p.value })));
            const signalSeries = chart.addSeries(LineSeries, { color: COLORS.warning, lineWidth: 2, priceScaleId: 'macd' }, 2);
            signalSeries.setData(signal.map((p) => ({ time: t(p.time), value: p.value })));
        }

        // Reparto de altura entre panes.
        const panes = chart.panes();
        if (panes[0]) panes[0].setStretchFactor(3);
        if (panes[1]) panes[1].setStretchFactor(1);
        if (panes[2]) panes[2].setStretchFactor(1.4);

        chart.timeScale().fitContent();

        const ro = new ResizeObserver((entries) => {
            for (const e of entries) chart.applyOptions({ width: e.contentRect.width });
        });
        ro.observe(container);

        return () => {
            ro.disconnect();
            chart.remove();
        };
    }, [candles, oscillator, height]);

    return <div ref={containerRef} className="w-full" />;
}
