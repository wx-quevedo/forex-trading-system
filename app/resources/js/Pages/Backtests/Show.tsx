import { Head, Link, router } from '@inertiajs/react';
import { useEffect, useMemo, useState } from 'react';
import {
    AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import AppLayout from '@/Layouts/AppLayout';
import MetricBadge from '@/Components/MetricBadge';
import BacktestChart from '@/Components/BacktestChart';
import { fmtMoney, fmtNumber, pnlColor } from '@/lib/format';
import type { Backtest, BacktestTrade, Candle } from '@/types';

const C = { up: '#26a69a', down: '#ef5350', accent: '#2962ff', grid: '#2a2d36', text: '#8b8fa8' };

const STATUS_STYLE: Record<string, string> = {
    pending: 'bg-bg-elevated text-text-secondary',
    running: 'bg-accent/15 text-accent',
    completed: 'bg-profit/15 text-profit',
    failed: 'bg-loss/15 text-loss',
};

function downsample<T>(arr: T[], max = 400): T[] {
    if (arr.length <= max) return arr;
    const step = Math.ceil(arr.length / max);
    return arr.filter((_, i) => i % step === 0);
}

export default function Show({ backtest, candles }: { backtest: Backtest; candles: Candle[] }) {
    const m = backtest.result_metrics;
    const trades = backtest.result_trades ?? [];
    const [filter, setFilter] = useState<'all' | 'buy' | 'sell' | 'win' | 'loss'>('all');

    // Actualización en vivo: cuando el job termina, recarga la página.
    useEffect(() => {
        if (backtest.status === 'completed' || backtest.status === 'failed') return;
        const ch = window.Echo?.channel('backtests');
        ch?.listen('.backtest.completed', (e: { id: number }) => {
            if (e.id === backtest.id) router.reload();
        });
        // Respaldo: poll cada 4s por si el WebSocket no está disponible.
        const poll = window.setInterval(() => router.reload({ only: ['backtest', 'candles'] }), 4000);
        return () => {
            ch?.stopListening('.backtest.completed');
            window.Echo?.leave('backtests');
            window.clearInterval(poll);
        };
    }, [backtest.status, backtest.id]);

    const equityData = useMemo(
        () => downsample(backtest.result_equity_curve ?? []).map((p) => ({ x: p.time, equity: p.equity })),
        [backtest.result_equity_curve],
    );
    const monthData = useMemo(
        () => Object.entries(m?.pnl_by_month ?? {}).map(([month, pnl]) => ({ month, pnl })),
        [m],
    );
    const tradePnlData = useMemo(() => trades.map((t, i) => ({ i: i + 1, pnl: t.pnl })), [trades]);

    const filteredTrades = useMemo(() => {
        return trades.filter((t) => {
            if (filter === 'buy' || filter === 'sell') return t.direction === filter;
            if (filter === 'win') return t.pnl > 0;
            if (filter === 'loss') return t.pnl <= 0;
            return true;
        });
    }, [trades, filter]);

    return (
        <AppLayout>
            <Head title={`Backtest #${backtest.id}`} />

            <div className="mb-5 flex items-start justify-between">
                <div>
                    <div className="flex items-center gap-3">
                        <h1 className="text-lg font-semibold tracking-tight">
                            {backtest.strategy?.name ?? `Backtest #${backtest.id}`}
                        </h1>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[backtest.status]}`}>
                            {backtest.status}
                        </span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-text-secondary">
                        {backtest.strategy?.pair} · {backtest.strategy?.timeframe} ·{' '}
                        {backtest.date_from.slice(0, 10)} → {backtest.date_to.slice(0, 10)}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {backtest.status === 'completed' && (
                        <>
                            <Link
                                href={`/backtests/${backtest.id}/workbench`}
                                className="rounded-md border border-accent bg-accent/10 px-3 py-1.5 text-sm font-semibold text-accent hover:bg-accent/20"
                            >
                                Abrir workbench
                            </Link>
                            <Link
                                href={`/backtests/${backtest.id}/analysis`}
                                className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
                            >
                                Analizar con IA
                            </Link>
                        </>
                    )}
                    <Link href="/backtests" className="text-sm text-text-secondary hover:text-text-primary">
                        ← Backtests
                    </Link>
                </div>
            </div>

            {(backtest.status === 'pending' || backtest.status === 'running') && (
                <div className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-6 text-center text-sm text-accent">
                    Procesando backtest… los resultados aparecerán aquí automáticamente.
                </div>
            )}

            {backtest.status === 'failed' && (
                <div className="rounded-lg border border-loss/40 bg-loss/10 px-4 py-3 text-sm text-loss">
                    Falló: {backtest.error}
                </div>
            )}

            {backtest.status === 'completed' && m && (
                <>
                    {/* Métricas */}
                    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
                        <MetricBadge label="PnL neto" value={fmtMoney(m.net_pnl)} valueClass={pnlColor(m.net_pnl)} />
                        <MetricBadge label="Retorno" value={`${fmtNumber(m.return_pct)}%`} valueClass={pnlColor(m.return_pct)} />
                        <MetricBadge label="Win rate" value={`${fmtNumber(m.win_rate * 100)}%`} />
                        <MetricBadge label="Profit factor" value={m.profit_factor != null ? fmtNumber(m.profit_factor) : '—'} />
                        <MetricBadge label="Sharpe" value={fmtNumber(m.sharpe)} valueClass={pnlColor(m.sharpe)} />
                        <MetricBadge label="Sortino" value={fmtNumber(m.sortino)} valueClass={pnlColor(m.sortino)} />
                        <MetricBadge label="Max DD" value={`${fmtNumber(m.max_drawdown_pct)}%`} valueClass="text-loss" />
                        <MetricBadge label="Trades" value={String(m.total_trades)} />
                        <MetricBadge label="Wins / Losses" value={`${m.wins} / ${m.losses}`} />
                        <MetricBadge label="Balance final" value={fmtMoney(m.final_balance)} />
                        <MetricBadge label="Racha W" value={String(m.max_win_streak)} valueClass="text-profit" />
                        <MetricBadge label="Racha L" value={String(m.max_loss_streak)} valueClass="text-loss" />
                    </div>

                    {/* Equity curve + PnL por mes */}
                    <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
                        <div className="rounded-lg border border-border bg-bg-surface p-4 xl:col-span-2">
                            <h2 className="mb-3 text-sm font-semibold">Equity curve</h2>
                            <ResponsiveContainer width="100%" height={240}>
                                <AreaChart data={equityData}>
                                    <defs>
                                        <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor={C.accent} stopOpacity={0.4} />
                                            <stop offset="100%" stopColor={C.accent} stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
                                    <XAxis dataKey="x" tick={false} stroke={C.grid} />
                                    <YAxis stroke={C.grid} tick={{ fill: C.text, fontSize: 11 }} domain={['auto', 'auto']} width={60} />
                                    <Tooltip
                                        contentStyle={{ background: '#141519', border: '1px solid #2a2d36', borderRadius: 8 }}
                                        labelFormatter={(v) => new Date((v as number) * 1000).toLocaleDateString()}
                                        formatter={(v) => [fmtMoney(Number(v)), 'Equity']}
                                    />
                                    <Area type="monotone" dataKey="equity" stroke={C.accent} fill="url(#eq)" strokeWidth={2} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>

                        <div className="rounded-lg border border-border bg-bg-surface p-4">
                            <h2 className="mb-3 text-sm font-semibold">PnL por mes</h2>
                            <ResponsiveContainer width="100%" height={240}>
                                <BarChart data={monthData}>
                                    <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
                                    <XAxis dataKey="month" tick={{ fill: C.text, fontSize: 10 }} stroke={C.grid} />
                                    <YAxis stroke={C.grid} tick={{ fill: C.text, fontSize: 11 }} width={50} />
                                    <Tooltip
                                        contentStyle={{ background: '#141519', border: '1px solid #2a2d36', borderRadius: 8 }}
                                        formatter={(v) => [fmtMoney(Number(v)), 'PnL']}
                                    />
                                    <Bar dataKey="pnl">
                                        {monthData.map((d, i) => (
                                            <Cell key={i} fill={d.pnl >= 0 ? C.up : C.down} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Chart de velas con marcadores de trades */}
                    {candles.length > 0 && (
                        <div className="mb-6 rounded-lg border border-border bg-bg-surface p-2">
                            <BacktestChart candles={candles} trades={trades} />
                        </div>
                    )}

                    {/* Distribución de PnL por trade */}
                    <div className="mb-6 rounded-lg border border-border bg-bg-surface p-4">
                        <h2 className="mb-3 text-sm font-semibold">Distribución de PnL por trade</h2>
                        <ResponsiveContainer width="100%" height={180}>
                            <BarChart data={tradePnlData}>
                                <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
                                <XAxis dataKey="i" tick={false} stroke={C.grid} />
                                <YAxis stroke={C.grid} tick={{ fill: C.text, fontSize: 11 }} width={50} />
                                <Tooltip
                                    contentStyle={{ background: '#141519', border: '1px solid #2a2d36', borderRadius: 8 }}
                                    formatter={(v) => [fmtMoney(Number(v)), 'PnL']}
                                />
                                <Bar dataKey="pnl">
                                    {tradePnlData.map((d, i) => (
                                        <Cell key={i} fill={d.pnl >= 0 ? C.up : C.down} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    {/* Tabla de trades */}
                    <TradesTable trades={filteredTrades} filter={filter} setFilter={setFilter} total={trades.length} />
                </>
            )}
        </AppLayout>
    );
}

function TradesTable({
    trades, filter, setFilter, total,
}: {
    trades: BacktestTrade[];
    filter: string;
    setFilter: (f: 'all' | 'buy' | 'sell' | 'win' | 'loss') => void;
    total: number;
}) {
    const FILTERS: { key: 'all' | 'buy' | 'sell' | 'win' | 'loss'; label: string }[] = [
        { key: 'all', label: 'Todos' },
        { key: 'buy', label: 'Compras' },
        { key: 'sell', label: 'Ventas' },
        { key: 'win', label: 'Ganadores' },
        { key: 'loss', label: 'Perdedores' },
    ];

    return (
        <div>
            <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Trades ({trades.length}/{total})</h2>
                <div className="inline-flex rounded-lg border border-border bg-bg-surface p-0.5">
                    {FILTERS.map((f) => (
                        <button
                            key={f.key}
                            type="button"
                            onClick={() => setFilter(f.key)}
                            className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                                filter === f.key ? 'bg-bg-elevated text-text-primary' : 'text-text-secondary hover:text-text-primary'
                            }`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="max-h-[480px] overflow-auto rounded-lg border border-border bg-bg-surface">
                <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-bg-surface">
                        <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
                            <th className="px-3 py-2 font-medium">Dir</th>
                            <th className="px-3 py-2 font-medium">Entrada</th>
                            <th className="px-3 py-2 font-medium">Salida</th>
                            <th className="px-3 py-2 font-medium text-right">Vol</th>
                            <th className="px-3 py-2 font-medium">Motivo</th>
                            <th className="px-3 py-2 font-medium text-right">PnL</th>
                        </tr>
                    </thead>
                    <tbody>
                        {trades.map((t, i) => (
                            <tr key={i} className="border-b border-border/40 last:border-0">
                                <td className="px-3 py-1.5">
                                    <span className={`font-mono text-xs font-semibold ${t.direction === 'buy' ? 'text-profit' : 'text-loss'}`}>
                                        {t.direction === 'buy' ? '↑' : '↓'}
                                    </span>
                                </td>
                                <td className="px-3 py-1.5 font-mono text-xs text-text-secondary">
                                    {new Date(t.entry_time * 1000).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                    <span className="ml-1 text-text-primary">{t.entry_price}</span>
                                </td>
                                <td className="px-3 py-1.5 font-mono text-xs text-text-secondary">
                                    {new Date(t.exit_time * 1000).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                    <span className="ml-1 text-text-primary">{t.exit_price}</span>
                                </td>
                                <td className="px-3 py-1.5 text-right font-mono text-xs text-text-secondary">{t.volume}</td>
                                <td className="px-3 py-1.5">
                                    <span className="rounded bg-bg-elevated px-1.5 py-0.5 font-mono text-[10px] uppercase text-text-secondary">
                                        {t.exit_reason}
                                    </span>
                                </td>
                                <td className={`px-3 py-1.5 text-right font-mono text-xs ${t.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                                    {fmtMoney(t.pnl)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
