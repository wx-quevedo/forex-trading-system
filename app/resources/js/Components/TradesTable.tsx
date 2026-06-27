import { Fragment, useMemo, useState } from 'react';
import { fmtMoney } from '@/lib/format';
import EmbeddedTradeChart, { type TradeChartContext } from '@/Components/EmbeddedTradeChart';
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

type SortKey = 'direction' | 'entry_time' | 'exit_time' | 'exit_reason' | 'pnl_gross' | 'pnl';

export default function TradesTable({ trades, chartContext }: { trades: BacktestTrade[]; chartContext?: TradeChartContext }) {
    const [filter, setFilter] = useState<Filter>('all');
    const [expanded, setExpanded] = useState<number | null>(null);
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);

    const toggleSort = (key: SortKey) =>
        setSort((p) => (p && p.key === key ? { key, dir: p.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

    const rows = useMemo(() => {
        const filtered = trades.filter((tr) => {
            if (filter === 'buy' || filter === 'sell') return tr.direction === filter;
            if (filter === 'win') return tr.pnl > 0;
            if (filter === 'loss') return tr.pnl <= 0;
            return true;
        });
        if (!sort) return filtered;
        const { key, dir } = sort;
        return [...filtered].sort((a, b) => {
            const av = a[key] ?? (key === 'pnl_gross' ? a.pnl : 0);
            const bv = b[key] ?? (key === 'pnl_gross' ? b.pnl : 0);
            if (av < bv) return dir === 'asc' ? -1 : 1;
            if (av > bv) return dir === 'asc' ? 1 : -1;
            return 0;
        });
    }, [trades, filter, sort]);

    const Th = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => (
        <th className={`px-3 py-2 font-medium ${right ? 'text-right' : ''}`}>
            <button type="button" onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 hover:text-text-primary ${right ? 'flex-row-reverse' : ''}`}>
                {label}
                <span className="text-[8px] leading-none text-accent">{sort?.key === k ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
            </button>
        </th>
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
                            <Th k="direction" label="Dir" />
                            <Th k="entry_time" label="Entrada" />
                            <Th k="exit_time" label="Salida" />
                            <Th k="exit_reason" label="Motivo" />
                            <Th k="pnl_gross" label="PnL bruto" right />
                            <Th k="pnl" label="PnL neto" right />
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((tr, i) => {
                            const id = tr.entry_time;
                            const isOpen = chartContext != null && expanded === id;
                            return (
                                <Fragment key={`${id}-${i}`}>
                                    <tr
                                        onClick={() => chartContext && setExpanded(isOpen ? null : id)}
                                        className={`border-b border-border/40 last:border-0 ${chartContext ? 'cursor-pointer hover:bg-bg-elevated' : ''} ${isOpen ? 'bg-bg-elevated' : ''}`}
                                    >
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
                                        <td className="px-3 py-1.5 text-right font-mono text-xs text-text-secondary">
                                            {fmtMoney(tr.pnl_gross ?? tr.pnl)}
                                        </td>
                                        <td className={`px-3 py-1.5 text-right font-mono text-xs ${tr.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                                            {fmtMoney(tr.pnl)}
                                        </td>
                                    </tr>
                                    {isOpen && chartContext && (
                                        <tr>
                                            <td colSpan={6} className="p-0">
                                                <EmbeddedTradeChart trade={tr} ctx={chartContext} />
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
