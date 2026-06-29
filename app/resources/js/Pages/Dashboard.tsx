import { Head, router } from '@inertiajs/react';
import { useEffect, useState, useCallback } from 'react';
import AppLayout from '@/Layouts/AppLayout';
import MetricBadge from '@/Components/MetricBadge';
import PriceDisplay from '@/Components/PriceDisplay';
import PositionCard from '@/Components/PositionCard';
import SignalLog from '@/Components/SignalLog';
import CandleChart, { type Oscillator } from '@/Components/CandleChart';
import IndicatorPanel from '@/Components/IndicatorPanel';
import { fmtMoney, fmtNumber, pnlColor } from '@/lib/format';
import type { AccountInfo, Candle, Position, Tick } from '@/types';

interface Props {
    account: AccountInfo | null;
    positions: Position[];
    candles: Candle[];
    symbols: string[];
    symbol: string;
    timeframe: string;
    bridgeError: string | null;
}

const TIMEFRAMES = ['M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

export default function Dashboard({ account, positions, candles, symbols, symbol, timeframe, bridgeError }: Props) {
    const [oscillator, setOscillator] = useState<Oscillator>('rsi');
    const [livePositions, setLivePositions] = useState<Position[]>(positions);
    const [tick, setTick] = useState<Tick | null>(null);

    // Mantener posiciones sincronizadas si cambia la prop (navegación Inertia).
    useEffect(() => setLivePositions(positions), [positions]);

    // Posiciones en tiempo real: WebSocket Reverb + polling de respaldo.
    const refreshPositions = useCallback(async () => {
        try {
            const { data } = await window.axios.get('/api/market/positions');
            if (Array.isArray(data.data)) setLivePositions(data.data);
        } catch {
            /* el bridge puede estar caído; se reintenta en el próximo tick */
        }
    }, []);

    useEffect(() => {
        const echo = window.Echo;
        const channel = echo?.channel('trading');
        channel?.listen('.positions.updated', (e: { positions: Position[] }) => {
            if (Array.isArray(e.positions)) setLivePositions(e.positions);
        });
        const poll = window.setInterval(refreshPositions, 6000);
        return () => {
            channel?.stopListening('.positions.updated');
            echo?.leave('trading');
            window.clearInterval(poll);
        };
    }, [refreshPositions]);

    // Precio en vivo del símbolo seleccionado.
    useEffect(() => {
        let active = true;
        const fetchPrice = async () => {
            try {
                const { data } = await window.axios.get(`/api/market/price/${encodeURIComponent(symbol)}`);
                if (active && data.data) setTick(data.data as Tick);
            } catch {
                /* ignore */
            }
        };
        fetchPrice();
        const id = window.setInterval(fetchPrice, 2000);
        return () => {
            active = false;
            window.clearInterval(id);
        };
    }, [symbol]);

    const reloadChart = (next: { symbol?: string; timeframe?: string }) => {
        router.get(
            '/dashboard',
            { symbol: next.symbol ?? symbol, timeframe: next.timeframe ?? timeframe },
            { preserveState: true, preserveScroll: true, only: ['candles', 'symbol', 'timeframe'] },
        );
    };

    const floatingPnl = livePositions.reduce((sum, p) => sum + p.profit, 0);
    const currency = account?.currency ?? 'USD';

    return (
        <AppLayout>
            <Head title="Dashboard" />

            {bridgeError && (
                <div className="mb-5 rounded-lg border border-loss/40 bg-loss/10 px-4 py-3 text-sm text-loss">
                    Bridge MT5: {bridgeError}
                </div>
            )}

            {/* KPIs de cuenta */}
            <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
                <MetricBadge label="Balance" value={fmtMoney(account?.balance, currency)} />
                <MetricBadge label="Equity" value={fmtMoney(account?.equity, currency)} />
                <MetricBadge
                    label="PnL flotante"
                    value={fmtMoney(floatingPnl, currency)}
                    valueClass={pnlColor(floatingPnl)}
                />
                <MetricBadge label="Margen libre" value={fmtMoney(account?.margin_free, currency)} />
                <MetricBadge
                    label="Nivel de margen"
                    value={account?.margin_level ? `${fmtNumber(account.margin_level)}%` : '—'}
                />
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                {/* Chart + controles */}
                <div className="xl:col-span-2">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <select
                                value={symbol}
                                onChange={(e) => reloadChart({ symbol: e.target.value })}
                                className="rounded-md border border-border bg-bg-surface px-3 py-1.5 font-mono text-sm text-text-primary outline-none focus:border-accent"
                            >
                                {(symbols.length ? symbols : [symbol]).map((s) => (
                                    <option key={s} value={s}>
                                        {s}
                                    </option>
                                ))}
                            </select>
                            <div className="inline-flex rounded-lg border border-border bg-bg-surface p-0.5">
                                {TIMEFRAMES.map((tf) => (
                                    <button
                                        key={tf}
                                        type="button"
                                        onClick={() => reloadChart({ timeframe: tf })}
                                        className={`rounded-md px-2.5 py-1 font-mono text-xs transition-colors ${
                                            tf === timeframe
                                                ? 'bg-bg-elevated text-text-primary'
                                                : 'text-text-secondary hover:text-text-primary'
                                        }`}
                                    >
                                        {tf}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <IndicatorPanel value={oscillator} onChange={setOscillator} />
                    </div>

                    <div className="rounded-lg border border-border bg-bg-surface p-2">
                        {candles.length > 0 ? (
                            <CandleChart candles={candles} oscillator={oscillator} />
                        ) : (
                            <div className="flex h-[460px] items-center justify-center text-sm text-text-secondary">
                                Sin datos de velas (¿bridge desconectado o mercado cerrado?).
                            </div>
                        )}
                    </div>
                </div>

                {/* Precio + posiciones */}
                <div className="flex flex-col gap-4">
                    <PriceDisplay symbol={symbol} tick={tick} />

                    <div>
                        <div className="mb-2 flex items-center justify-between">
                            <h2 className="text-sm font-semibold">Posiciones abiertas</h2>
                            <span className="font-mono text-xs text-text-secondary">{livePositions.length}</span>
                        </div>
                        <div className="flex flex-col gap-2">
                            {livePositions.length > 0 ? (
                                livePositions.map((p) => <PositionCard key={p.ticket} position={p} />)
                            ) : (
                                <div className="rounded-lg border border-border bg-bg-surface p-6 text-center text-sm text-text-secondary">
                                    Sin posiciones abiertas.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Log de señales (se poblará en la Fase 7) */}
            <div className="mt-8">
                <h2 className="mb-2 text-sm font-semibold">Señales recientes</h2>
                <SignalLog signals={[]} />
            </div>
        </AppLayout>
    );
}
