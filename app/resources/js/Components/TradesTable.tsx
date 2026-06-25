import { useMemo, useState } from 'react';
import { fmtMoney } from '@/lib/format';
import type { BacktestTrade } from '@/types';

type Filter = 'all' | 'buy' | 'sell' | 'win' | 'loss';

const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'Todos' },
    { key: 'buy', label: 'Compras' },
    { key: 'sell', label: 'Ventas' },
    { key: 'win', label: 'Ganadores' },
    { key: 'loss', label: 'Perdedores' },
];

const t = (sec: number) =>
    new Date(sec * 1000).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function TradesTable({ trades }: { trades: BacktestTrade[] }) {
    const [filter, setFilter] = useState<Filter>('all');
    const rows = useMemo(
        () =>
            trades.filter((tr) => {
                if (filter === 'buy' || filter === 'sell') return tr.direction === filter;
                if (filter === 'win') return tr.pnl > 0;
                if (filter === 'loss') return tr.pnl <= 0;
                return true;
            }),
        [trades, filter],
    );

    return (
        <div>
            <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold">
                    Trades ({rows.length}/{trades.length})
                </h2>
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
            <div className="max-h-[420px] overflow-auto rounded-lg border border-border bg-bg-surface">
                <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-bg-surface">
                        <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
                            <th className="px-3 py-2 font-medium">Dir</th>
                            <th className="px-3 py-2 font-medium">Entrada</th>
                            <th className="px-3 py-2 font-medium">Salida</th>
                            <th className="px-3 py-2 font-medium">Motivo</th>
                            <th className="px-3 py-2 font-medium text-right">PnL</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((tr, i) => (
                            <tr key={i} className="border-b border-border/40 last:border-0">
                                <td className="px-3 py-1.5">
                                    <span className={`font-mono text-xs font-semibold ${tr.direction === 'buy' ? 'text-profit' : 'text-loss'}`}>
                                        {tr.direction === 'buy' ? '↑' : '↓'}
                                    </span>
                                </td>
                                <td className="px-3 py-1.5 font-mono text-xs text-text-secondary">
                                    {t(tr.entry_time)} <span className="text-text-primary">{tr.entry_price}</span>
                                </td>
                                <td className="px-3 py-1.5 font-mono text-xs text-text-secondary">
                                    {t(tr.exit_time)} <span className="text-text-primary">{tr.exit_price}</span>
                                </td>
                                <td className="px-3 py-1.5">
                                    <span className="rounded bg-bg-elevated px-1.5 py-0.5 font-mono text-[10px] uppercase text-text-secondary">
                                        {tr.exit_reason}
                                    </span>
                                </td>
                                <td className={`px-3 py-1.5 text-right font-mono text-xs ${tr.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                                    {fmtMoney(tr.pnl)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
