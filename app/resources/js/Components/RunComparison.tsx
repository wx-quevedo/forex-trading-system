import type { BacktestMetrics, WorkbenchRun } from '@/types';
import { fmtMoney, fmtNumber } from '@/lib/format';

interface MetricDef {
    key: keyof BacktestMetrics;
    label: string;
    fmt: (v: number) => string;
    higherBetter: boolean | null; // null = neutro (sin flecha)
}

// En max_drawdown_pct los valores son negativos: -10 es mejor que -14, es decir
// "mayor" numéricamente → higherBetter true funciona correctamente.
const METRICS: MetricDef[] = [
    { key: 'win_rate', label: 'Win rate', fmt: (v) => `${fmtNumber(v * 100)}%`, higherBetter: true },
    { key: 'profit_factor', label: 'Profit factor', fmt: (v) => fmtNumber(v), higherBetter: true },
    { key: 'net_pnl', label: 'PnL neto', fmt: (v) => fmtMoney(v), higherBetter: true },
    { key: 'return_pct', label: 'Retorno', fmt: (v) => `${fmtNumber(v)}%`, higherBetter: true },
    { key: 'max_drawdown_pct', label: 'Max DD', fmt: (v) => `${fmtNumber(v)}%`, higherBetter: true },
    { key: 'sharpe', label: 'Sharpe', fmt: (v) => fmtNumber(v), higherBetter: true },
    { key: 'total_trades', label: 'Trades', fmt: (v) => String(v), higherBetter: null },
];

function val(run: WorkbenchRun | null, key: keyof BacktestMetrics): number | null {
    const v = run?.metrics?.[key];
    return typeof v === 'number' ? v : null;
}

function Arrow({ cur, prev, higherBetter }: { cur: number | null; prev: number | null; higherBetter: boolean | null }) {
    if (higherBetter === null || cur === null || prev === null) return null;
    const diff = cur - prev;
    if (Math.abs(diff) < 1e-9) return <span className="text-text-secondary"> =</span>;
    const better = higherBetter ? diff > 0 : diff < 0;
    return <span className={better ? 'text-profit' : 'text-loss'}> {better ? '▲' : '▼'}</span>;
}

export default function RunComparison({
    initial,
    previous,
    current,
    onPinInitial,
}: {
    initial: WorkbenchRun;
    previous: WorkbenchRun | null;
    current: WorkbenchRun;
    onPinInitial: () => void;
}) {
    return (
        <div className="rounded-lg border border-border bg-bg-surface p-4">
            <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Comparación de corridas</h2>
                <button
                    type="button"
                    onClick={onPinInitial}
                    className="rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:text-text-primary"
                >
                    Fijar Actual como Inicial
                </button>
            </div>
            <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-border text-[11px] uppercase tracking-wide text-text-secondary">
                            <th className="px-3 py-2 text-left font-medium">Métrica</th>
                            <th className="bg-bg-elevated px-3 py-2 text-right font-medium">Inicial</th>
                            <th className="bg-bg-elevated px-3 py-2 text-right font-medium">Anterior</th>
                            <th className="border-l border-accent bg-bg-elevated px-3 py-2 text-right font-medium text-accent">
                                Actual
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {METRICS.map((mt) => {
                            const ci = val(initial, mt.key);
                            const cp = val(previous, mt.key);
                            const cc = val(current, mt.key);
                            return (
                                <tr key={mt.key} className="border-b border-border/40 last:border-0">
                                    <td className="px-3 py-1.5 text-text-secondary">{mt.label}</td>
                                    <td className="px-3 py-1.5 text-right font-mono text-xs text-text-secondary">
                                        {ci !== null ? mt.fmt(ci) : '—'}
                                    </td>
                                    <td className="px-3 py-1.5 text-right font-mono text-xs text-text-secondary">
                                        {cp !== null ? mt.fmt(cp) : '—'}
                                    </td>
                                    <td className="border-l border-accent/40 px-3 py-1.5 text-right font-mono text-xs text-text-primary">
                                        {cc !== null ? mt.fmt(cc) : '—'}
                                        <Arrow cur={cc} prev={cp} higherBetter={mt.higherBetter} />
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
