import { Head, Link, router } from '@inertiajs/react';
import AppLayout from '@/Layouts/AppLayout';
import { fmtMoney } from '@/lib/format';
import type { Backtest } from '@/types';

const STATUS_STYLE: Record<string, string> = {
    pending: 'bg-bg-elevated text-text-secondary',
    running: 'bg-accent/15 text-accent',
    completed: 'bg-profit/15 text-profit',
    failed: 'bg-loss/15 text-loss',
};

export default function Index({ backtests }: { backtests: Backtest[] }) {
    return (
        <AppLayout title="Backtests">
            <Head title="Backtests" />

            <div className="mb-4 flex items-center justify-between">
                <p className="text-sm text-text-secondary">{backtests.length} backtest(s)</p>
                <Link
                    href="/backtests/create"
                    className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
                >
                    + Nuevo backtest
                </Link>
            </div>

            {backtests.length === 0 ? (
                <div className="rounded-lg border border-border bg-bg-surface p-10 text-center text-sm text-text-secondary">
                    Sin backtests. Crea uno seleccionando una estrategia y un rango de fechas.
                </div>
            ) : (
                <div className="overflow-hidden rounded-lg border border-border bg-bg-surface">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
                                <th className="px-4 py-2.5 font-medium">Estrategia</th>
                                <th className="px-4 py-2.5 font-medium">Rango</th>
                                <th className="px-4 py-2.5 font-medium">Estado</th>
                                <th className="px-4 py-2.5 font-medium text-right">Trades</th>
                                <th className="px-4 py-2.5 font-medium text-right">Win%</th>
                                <th className="px-4 py-2.5 font-medium text-right">PnL neto</th>
                                <th className="px-4 py-2.5"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {backtests.map((b) => {
                                const m = b.result_metrics;
                                return (
                                    <tr key={b.id} className="border-b border-border/50 last:border-0 hover:bg-bg-elevated/40">
                                        <td className="px-4 py-3">
                                            <Link href={`/backtests/${b.id}`} className="font-medium text-text-primary hover:text-accent">
                                                {b.strategy?.name ?? `#${b.strategy_id}`}
                                            </Link>
                                            <div className="font-mono text-xs text-text-secondary">
                                                {b.strategy?.pair} · {b.strategy?.timeframe}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                                            {b.date_from.slice(0, 10)} → {b.date_to.slice(0, 10)}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[b.status]}`}>
                                                {b.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-text-secondary">{m?.total_trades ?? '—'}</td>
                                        <td className="px-4 py-3 text-right font-mono text-text-secondary">
                                            {m ? `${(m.win_rate * 100).toFixed(1)}%` : '—'}
                                        </td>
                                        <td className={`px-4 py-3 text-right font-mono ${m && m.net_pnl >= 0 ? 'text-profit' : m ? 'text-loss' : 'text-text-secondary'}`}>
                                            {m ? fmtMoney(m.net_pnl) : '—'}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (confirm('¿Eliminar este backtest?')) router.delete(`/backtests/${b.id}`);
                                                }}
                                                className="text-xs text-text-secondary hover:text-loss"
                                            >
                                                Eliminar
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </AppLayout>
    );
}
