import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
    createChart,
    CandlestickSeries,
    HistogramSeries,
    LineSeries,
    createSeriesMarkers,
    ColorType,
    LineStyle,
    type IChartApi,
    type IPriceLine,
    type ISeriesApi,
    type ISeriesMarkersPluginApi,
    type SeriesMarker,
    type Time,
    type UTCTimestamp,
} from 'lightweight-charts';
import type { BotClosedTrade, BotPosition, BotSignal, Candle } from '@/types';
import { movingAverage, bollinger, rsi, macd, cci, donchian } from '@/lib/indicators';
import { fmtTimeMs } from '@/lib/format';
import { DISPLAY_TZ_OFFSET_SECONDS as TZ } from '@/lib/tz';
import { PositionZones, type PositionZone } from '@/lib/positionZones';

interface Props {
    candles: Candle[];
    digits?: number;
    strategyType: string;
    params: Record<string, number | string>;
    signals: BotSignal[];
    positions: BotPosition[];
    closedTrades: BotClosedTrade[];
    onSelectSignal: (s: BotSignal | null) => void;
    height?: number;
    fill?: boolean; // si true, la altura la marca el contenedor (crece con el layout) en vez de `height` fijo
    savedView?: { from: number; to: number } | null; // vista guardada por-estrategia (rango temporal, ya desplazado por TZ) a restaurar
    focus?: { from: number; to: number }; // zoom inicial a una operación (Parte B)
    showClosedZones?: boolean; // dibujar zonas TP/SL de los trades cerrados
}

/** API imperativa para "Guardar/Reset vista": leer el rango visible actual y volver a la default. */
export interface BotLiveChartHandle {
    getVisibleRange: () => { from: number; to: number } | null;
    fitDefault: () => void;
}

const C = {
    bg: '#0d0e11', text: '#8b8fa8', grid: '#1c1e24', border: '#2a2d36',
    up: '#26a69a', down: '#ef5350', fast: '#2962ff', slow: '#f59e0b', band: '#7c83a3', neutral: '#8b8fa8',
};

const t = (time: number) => (time + TZ) as UTCTimestamp; // desplaza a hora local (UTC-5)
const num = (v: number | string | undefined, d: number) => (v == null || v === '' ? d : Number(v));
const oscillatorFor = (type: string): 'rsi' | 'macd' | 'cci' | 'volume' =>
    type === 'rsi' || type === 'combined' ? 'rsi' : type === 'macd' ? 'macd' : type === 'cci' ? 'cci' : 'volume';

function nearestCandleTime(candles: Candle[], ts: number): number | null {
    let best: number | null = null;
    for (const c of candles) {
        if (c.time <= ts) best = c.time;
        else break;
    }
    return best;
}

// Detalle asociado a una vela, para el tooltip al hover.
type Info =
    | { kind: 'eval'; signal: BotSignal }
    | { kind: 'entry'; pos: BotPosition }
    | { kind: 'entryTrade'; trade: BotClosedTrade }
    | { kind: 'exit'; trade: BotClosedTrade };

interface Bundle {
    chart: IChartApi;
    candle: ISeriesApi<'Candlestick'>;
    lines: ISeriesApi<'Line'>[];
    osc: { kind: 'rsi' | 'macd' | 'cci' | 'volume'; rsi?: ISeriesApi<'Line'>; cci?: ISeriesApi<'Line'>; macdLine?: ISeriesApi<'Line'>; macdSignal?: ISeriesApi<'Line'>; macdHist?: ISeriesApi<'Histogram'>; volume?: ISeriesApi<'Histogram'> };
    markers: ISeriesMarkersPluginApi<Time>;
    zones: PositionZones;
    priceLines: IPriceLine[];
}

/**
 * Chart en vivo del bot. Crea las series una vez y las actualiza con setData
 * (preserva scroll/zoom). Decimales según `digits` del símbolo. Marcador de
 * entrada prominente en la vela de ejecución (desde la posición/trade real),
 * zonas TP/SL estilo TradingView, tooltip con detalle de la orden.
 */
const BotLiveChart = forwardRef<BotLiveChartHandle, Props>(function BotLiveChart({ candles, digits = 5, strategyType, params, signals, positions, closedTrades, onSelectSignal, height = 480, fill, savedView, focus, showClosedZones }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const b = useRef<Bundle | null>(null);

    // API imperativa para los botones "Guardar vista" / "Reset vista" (viven en el header del padre).
    useImperativeHandle(ref, () => ({
        getVisibleRange: () => {
            const r = b.current?.chart.timeScale().getVisibleRange();
            return r ? { from: r.from as number, to: r.to as number } : null;
        },
        fitDefault: () => { b.current?.chart.timeScale().fitContent(); },
    }), []);
    const infoByTime = useRef<Map<number, Info>>(new Map());
    const onSelectRef = useRef(onSelectSignal);
    onSelectRef.current = onSelectSignal;
    const digitsRef = useRef(digits);
    digitsRef.current = digits;
    const follow = useRef(true);

    const structureKey = `${strategyType}|${digits}|${num(params.oversold, 30)}|${num(params.overbought, 70)}|${num(params.rsi_oversold, 30)}|${num(params.rsi_overbought, 70)}|${num(params.threshold, 100)}|${height}`;

    // --- Efecto A: construir chart + series (estructura) ---
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const chart = createChart(container, {
            width: container.clientWidth,
            height: fill ? (container.clientHeight || 440) : height,
            layout: { background: { type: ColorType.Solid, color: C.bg }, textColor: C.text, fontFamily: "'JetBrains Mono', monospace", panes: { separatorColor: C.border, separatorHoverColor: C.border } },
            grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
            rightPriceScale: { borderColor: C.border },
            timeScale: { borderColor: C.border, timeVisible: true, secondsVisible: false },
            crosshair: { mode: 1 },
        });

        const candle = chart.addSeries(CandlestickSeries, {
            upColor: C.up, downColor: C.down, borderVisible: false, wickUpColor: C.up, wickDownColor: C.down,
            priceFormat: { type: 'price', precision: digits, minMove: 1 / 10 ** digits },
        });

        const lines: ISeriesApi<'Line'>[] = [];
        const mkLine = (color: string, width: 1 | 2 = 2) => {
            const s = chart.addSeries(LineSeries, { color, lineWidth: width, priceLineVisible: false, lastValueVisible: false });
            lines.push(s);
            return s;
        };
        if (strategyType === 'ma_cross') {
            mkLine(C.fast);
            mkLine(C.slow);
        } else if (strategyType === 'bollinger') {
            mkLine(C.band, 1);
            mkLine(C.slow, 1);
            mkLine(C.band, 1);
        } else if (strategyType === 'combined') {
            mkLine(C.slow);
        } else if (strategyType === 'donchian') {
            mkLine(C.band, 1);   // upper
            mkLine(C.slow, 1);   // mid
            mkLine(C.band, 1);   // lower
        }

        const kind = oscillatorFor(strategyType);
        const osc: Bundle['osc'] = { kind };
        if (kind === 'rsi') {
            osc.rsi = chart.addSeries(LineSeries, { color: C.fast, lineWidth: 2 }, 2);
            const over = num(strategyType === 'combined' ? params.rsi_oversold : params.oversold, 30);
            const under = num(strategyType === 'combined' ? params.rsi_overbought : params.overbought, 70);
            [over, under].forEach((lvl) => osc.rsi!.createPriceLine({ price: lvl, color: C.border, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: String(lvl) }));
        } else if (kind === 'macd') {
            osc.macdHist = chart.addSeries(HistogramSeries, { priceScaleId: 'macd' }, 2);
            osc.macdLine = chart.addSeries(LineSeries, { color: C.fast, lineWidth: 2, priceScaleId: 'macd' }, 2);
            osc.macdSignal = chart.addSeries(LineSeries, { color: C.slow, lineWidth: 2, priceScaleId: 'macd' }, 2);
        } else if (kind === 'cci') {
            osc.cci = chart.addSeries(LineSeries, { color: C.fast, lineWidth: 2 }, 2);
            const th = num(params.threshold, 100);
            [th, -th].forEach((lvl) => osc.cci!.createPriceLine({ price: lvl, color: C.border, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: String(lvl) }));
            osc.cci.createPriceLine({ price: 0, color: C.border, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
        } else {
            osc.volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '' }, 1);
        }

        const markers = createSeriesMarkers(candle, []);
        const zones = new PositionZones();
        candle.attachPrimitive(zones);

        b.current = { chart, candle, lines, osc, markers, zones, priceLines: [] };

        chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
            follow.current = chart.timeScale().scrollPosition() >= -1;
        });

        // Tooltip al hover: evaluación / entrada / salida según la vela.
        const tooltip = tooltipRef.current;
        const px = (v: number | null | undefined) => (v == null ? '—' : Number(v).toFixed(digitsRef.current));
        chart.subscribeCrosshairMove((param) => {
            if (!tooltip) return;
            const time = param.time as number | undefined;
            const info = time != null ? infoByTime.current.get(time) : undefined;
            if (!info || !param.point) {
                tooltip.style.display = 'none';
                return;
            }
            let html = '';
            if (info.kind === 'eval') {
                const s = info.signal;
                const inds = Object.entries(s.indicator_values || {}).map(([k, v]) => `${k} ${v == null ? '—' : Number(v).toFixed(digitsRef.current)}`).join(' / ');
                const verb = s.signal_type === 'none' ? 'No entró' : `Señal ${s.signal_type.toUpperCase()} no ejecutada`;
                html = `<div class="font-semibold">${fmtTimeMs(s.evaluated_at)} · ${verb}</div><div class="text-text-secondary">${s.reason}</div><div class="text-text-secondary">${inds}</div>`;
            } else if (info.kind === 'entry') {
                const p = info.pos;
                const dir = p.type === 0 ? 'BUY' : 'SELL';
                html = `<div class="font-semibold">ENTRADA ${dir} · ${p.volume} lotes</div><div class="text-text-secondary">@ ${px(p.price_open)}${p.time ? ' · ' + fmtTimeMs(p.time * 1000) : ''}</div><div class="text-text-secondary">SL ${px(p.sl)} · TP ${px(p.tp)}</div>`;
            } else if (info.kind === 'entryTrade') {
                const tr = info.trade;
                html = `<div class="font-semibold">ENTRADA ${(tr.direction ?? '').toUpperCase()} · ${tr.volume ?? '—'} lotes</div><div class="text-text-secondary">@ ${px(tr.open_price)}</div><div class="text-text-secondary">SL ${px(tr.sl as number)} · TP ${px(tr.tp as number)}</div>`;
            } else {
                const tr = info.trade;
                const sign = tr.pnl >= 0 ? '+' : '';
                html = `<div class="font-semibold">SALIDA · PnL ${sign}${tr.pnl.toFixed(2)}</div><div class="text-text-secondary">@ ${px(tr.close_price)}${tr.close_at ? ' · ' + fmtTimeMs(tr.close_at) : ''}</div>`;
            }
            tooltip.innerHTML = html;
            tooltip.style.display = 'block';
            tooltip.style.left = `${Math.max(8, Math.min(param.point.x + 14, container.clientWidth - 230))}px`;
            tooltip.style.top = `${param.point.y + 12}px`;
        });
        chart.subscribeClick((param) => {
            const time = param.time as number | undefined;
            const info = time != null ? infoByTime.current.get(time) : undefined;
            if (info?.kind === 'eval') onSelectRef.current(info.signal);
        });

        const panes = chart.panes();
        if (panes[0]) panes[0].setStretchFactor(3);
        if (panes[1]) panes[1].setStretchFactor(1.2);

        const ro = new ResizeObserver((entries) => {
            for (const e of entries) {
                chart.applyOptions(fill
                    ? { width: e.contentRect.width, height: Math.max(1, Math.floor(e.contentRect.height)) }
                    : { width: e.contentRect.width });
            }
        });
        ro.observe(container);

        return () => {
            ro.disconnect();
            chart.remove();
            b.current = null;
        };
    }, [structureKey]); // eslint-disable-line react-hooks/exhaustive-deps

    // --- Efecto B: datos de velas + overlays + oscilador ---
    useEffect(() => {
        const bundle = b.current;
        if (!bundle || candles.length === 0) return;
        const wasFirst = bundle.candle.data().length === 0;

        bundle.candle.setData(candles.map((c) => ({ time: t(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));

        const setLine = (s: ISeriesApi<'Line'> | undefined, data: { time: number; value: number }[]) =>
            s?.setData(data.map((p) => ({ time: t(p.time), value: p.value })));

        if (strategyType === 'ma_cross') {
            const maType = (params.ma_type as 'sma' | 'ema') ?? 'ema';
            setLine(bundle.lines[0], movingAverage(candles, num(params.fast_period, 9), maType));
            setLine(bundle.lines[1], movingAverage(candles, num(params.slow_period, 21), maType));
        } else if (strategyType === 'bollinger') {
            const bb = bollinger(candles, num(params.period, 20), num(params.std_dev, 2));
            setLine(bundle.lines[0], bb.upper);
            setLine(bundle.lines[1], bb.middle);
            setLine(bundle.lines[2], bb.lower);
        } else if (strategyType === 'combined') {
            const maType = (params.trend_ma_type as 'sma' | 'ema') ?? 'ema';
            setLine(bundle.lines[0], movingAverage(candles, num(params.trend_period, 50), maType));
        } else if (strategyType === 'donchian') {
            const d = donchian(candles, num(params.period, 20));
            setLine(bundle.lines[0], d.upper);
            setLine(bundle.lines[1], d.mid);
            setLine(bundle.lines[2], d.lower);
        }

        const { osc } = bundle;
        if (osc.kind === 'rsi' && osc.rsi) {
            const period = num(strategyType === 'combined' ? params.rsi_period : params.period, 14);
            setLine(osc.rsi, rsi(candles, period));
        } else if (osc.kind === 'macd') {
            const m = macd(candles, num(params.fast, 12), num(params.slow, 26), num(params.signal, 9));
            osc.macdHist?.setData(m.histogram.map((p) => ({ time: t(p.time), value: p.value, color: p.value >= 0 ? `${C.up}80` : `${C.down}80` })));
            setLine(osc.macdLine, m.macd);
            setLine(osc.macdSignal, m.signal);
        } else if (osc.kind === 'cci' && osc.cci) {
            setLine(osc.cci, cci(candles, num(params.period, 20)));
        } else if (osc.volume) {
            osc.volume.setData(candles.map((c) => ({ time: t(c.time), value: c.tick_volume, color: c.close >= c.open ? `${C.up}80` : `${C.down}80` })));
        }

        if (wasFirst) {
            // Vista inicial: focus (TradeDetail) > vista guardada por-estrategia > fitContent (default).
            // La vista guardada se descarta si no solapa con las velas actuales (símbolo cambiado /
            // rango corrupto) → cae limpio a fitContent, nunca deja el chart en blanco.
            const first = t(candles[0].time);
            const last = t(candles[candles.length - 1].time);
            const savedValid = savedView
                && Number.isFinite(savedView.from) && Number.isFinite(savedView.to)
                && savedView.from < savedView.to
                && savedView.to > first && savedView.from < last;
            if (focus) {
                bundle.chart.timeScale().setVisibleRange({ from: t(focus.from), to: t(focus.to) });
            } else if (savedValid) {
                try {
                    bundle.chart.timeScale().setVisibleRange({ from: savedView!.from as UTCTimestamp, to: savedView!.to as UTCTimestamp });
                } catch {
                    bundle.chart.timeScale().fitContent();
                }
            } else {
                bundle.chart.timeScale().fitContent();
            }
        } else if (follow.current && !focus) {
            bundle.chart.timeScale().scrollToRealTime();
        }
    }, [candles, strategyType, params]); // eslint-disable-line react-hooks/exhaustive-deps

    // --- Efecto C: marcadores (evaluaciones + entradas/salidas reales) ---
    useEffect(() => {
        const bundle = b.current;
        if (!bundle) return;
        const info = new Map<number, Info>();
        const markers: SeriesMarker<Time>[] = [];

        // Evaluaciones: círculo gris (sin entrada) o flecha tenue (señal no ejecutada).
        // Las EJECUTADAS no llevan marcador aquí: lo pone el marcador de entrada real.
        for (const s of signals) {
            const ct = s.candle_time;
            if (!ct) continue;
            if (s.signal_type === 'none') {
                markers.push({ time: t(ct), position: 'belowBar', color: `${C.neutral}99`, shape: 'circle' });
                if (!info.has(ct + TZ)) info.set(ct + TZ, { kind: 'eval', signal: s });
            } else if (!s.executed) {
                const buy = s.signal_type === 'buy';
                markers.push({ time: t(ct), position: buy ? 'belowBar' : 'aboveBar', color: `${buy ? C.up : C.down}99`, shape: buy ? 'arrowUp' : 'arrowDown', size: 1 });
                if (!info.has(ct + TZ)) info.set(ct + TZ, { kind: 'eval', signal: s });
            }
        }

        // Entradas REALES de posiciones abiertas (flecha prominente en la vela de ejecución).
        for (const p of positions) {
            const ct = p.time ? nearestCandleTime(candles, p.time) : null;
            if (!ct) continue;
            const buy = p.type === 0;
            markers.push({ time: t(ct), position: buy ? 'belowBar' : 'aboveBar', color: buy ? C.up : C.down, shape: buy ? 'arrowUp' : 'arrowDown', text: buy ? 'BUY' : 'SELL', size: 2 });
            info.set(ct + TZ, { kind: 'entry', pos: p });
        }

        // Trades cerrados: entrada + salida con PnL.
        for (const tr of closedTrades) {
            if (tr.open_at) {
                const ct = nearestCandleTime(candles, Math.floor(new Date(tr.open_at).getTime() / 1000));
                if (ct) {
                    const buy = (tr.direction ?? '').toLowerCase() === 'buy';
                    markers.push({ time: t(ct), position: buy ? 'belowBar' : 'aboveBar', color: buy ? C.up : C.down, shape: buy ? 'arrowUp' : 'arrowDown', text: buy ? 'BUY' : 'SELL', size: 2 });
                    if (!info.has(ct + TZ)) info.set(ct + TZ, { kind: 'entryTrade', trade: tr });
                }
            }
            if (tr.close_at) {
                const ct = nearestCandleTime(candles, Math.floor(new Date(tr.close_at).getTime() / 1000));
                if (ct) {
                    markers.push({ time: t(ct), position: 'aboveBar', shape: 'square', color: tr.pnl >= 0 ? C.up : C.down, text: `${tr.pnl >= 0 ? '+' : ''}${tr.pnl.toFixed(2)}` });
                    info.set(ct + TZ, { kind: 'exit', trade: tr });
                }
            }
        }

        markers.sort((a, z) => (a.time as number) - (z.time as number));
        bundle.markers.setMarkers(markers);
        infoByTime.current = info;
    }, [signals, closedTrades, positions, candles, strategyType]);

    // --- Efecto D: zonas TP/SL + líneas de posiciones abiertas ---
    useEffect(() => {
        const bundle = b.current;
        if (!bundle) return;
        for (const pl of bundle.priceLines) bundle.candle.removePriceLine(pl);
        bundle.priceLines = [];

        const firstTime = candles[0]?.time ?? 0;
        // Las zonas usan el eje de tiempo del chart (desplazado a hora local).
        const zones: PositionZone[] = positions.map((p) => ({ from: (p.time ?? firstTime) + TZ, to: null, entry: p.price_open, tp: p.tp || null, sl: p.sl || null }));
        if (showClosedZones) {
            for (const tr of closedTrades) {
                if (tr.open_price == null) continue;
                const from = (tr.open_at ? Math.floor(new Date(tr.open_at).getTime() / 1000) : firstTime) + TZ;
                const to = tr.close_at ? Math.floor(new Date(tr.close_at).getTime() / 1000) + TZ : null;
                zones.push({ from, to, entry: tr.open_price, tp: tr.tp ?? null, sl: tr.sl ?? null });
            }
        }
        bundle.zones.setZones(zones);

        for (const p of positions) {
            if (p.tp) bundle.priceLines.push(bundle.candle.createPriceLine({ price: p.tp, color: C.up, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'TP' }));
            if (p.sl) bundle.priceLines.push(bundle.candle.createPriceLine({ price: p.sl, color: C.down, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'SL' }));
            bundle.priceLines.push(bundle.candle.createPriceLine({ price: p.price_open, color: C.text, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: 'Entry' }));
        }
    }, [positions, candles, strategyType, closedTrades, showClosedZones]);

    return (
        <div className={fill ? 'absolute inset-0' : 'relative'}>
            <div ref={containerRef} className={`w-full ${fill ? 'h-full' : ''}`} />
            <div
                ref={tooltipRef}
                className="pointer-events-none absolute z-20 hidden max-w-[220px] rounded-md border border-border bg-bg-elevated px-2.5 py-1.5 text-[11px] leading-snug shadow-lg"
                style={{ display: 'none' }}
            />
        </div>
    );
});

export default BotLiveChart;
