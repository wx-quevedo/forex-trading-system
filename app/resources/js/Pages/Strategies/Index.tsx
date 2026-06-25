import { Head, Link, router } from '@inertiajs/react';
import AppLayout from '@/Layouts/AppLayout';
import type { Strategy } from '@/types';

const TYPE_LABELS: Record<string, string> = {
    ma_cross: 'Moving Average Cross',
    rsi: 'RSI',
    macd: 'MACD',
    bollinger: 'Bollinger Bands',
    combined: 'Combined',
};

export default function Index({ strategies }: { strategies: Strategy[] }) {
    return (
        <AppLayout title="Estrategias">
            <Head title="Estrategias" />

            <div className="mb-4 flex items-center justify-between">
                <p className="text-sm text-text-secondary">{strategies.length} estrategia(s)</p>
                <Link
                    href="/strategies/create"
                    className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
                >
                    + Nueva estrategia
                </Link>
            </div>

            {strategies.length === 0 ? (
                <div className="rounded-lg border border-border bg-bg-surface p-10 text-center text-sm text-text-secondary">
                    Aún no hay estrategias. Crea la primera para empezar a backtestear.
                </div>
            ) : (
                <div className="overflow-hidden rounded-lg border border-border bg-bg-surface">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
                                <th className="px-4 py-2.5 font-medium">Nombre</th>
                                <th className="px-4 py-2.5 font-medium">Tipo</th>
                                <th className="px-4 py-2.5 font-medium">Par</th>
                                <th className="px-4 py-2.5 font-medium">TF</th>
                                <th className="px-4 py-2.5 font-medium">Versión</th>
                                <th className="px-4 py-2.5 font-medium">Estado</th>
                                <th className="px-4 py-2.5"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {strategies.map((s) => (
                                <tr key={s.id} className="border-b border-border/50 last:border-0 hover:bg-bg-elevated/40">
                                    <td className="px-4 py-3">
                                        <Link href={`/strategies/${s.id}`} className="font-medium text-text-primary hover:text-accent">
                                            {s.name}
                                        </Link>
                                        {s.description && (
                                            <div className="text-xs text-text-secondary">{s.description}</div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-text-secondary">
                                        {TYPE_LABELS[s.parameters?.type] ?? s.parameters?.type ?? '—'}
                                    </td>
                                    <td className="px-4 py-3 font-mono text-text-primary">{s.pair}</td>
                                    <td className="px-4 py-3 font-mono text-text-secondary">{s.timeframe}</td>
                                    <td className="px-4 py-3 font-mono text-text-secondary">v{s.version}</td>
                                    <td className="px-4 py-3">
                                        <span
                                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                                s.is_active ? 'bg-profit/15 text-profit' : 'bg-bg-elevated text-text-secondary'
                                            }`}
                                        >
                                            {s.is_active ? 'Activa' : 'Inactiva'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (confirm(`¿Eliminar "${s.name}"?`)) {
                                                    router.delete(`/strategies/${s.id}`);
                                                }
                                            }}
                                            className="text-xs text-text-secondary hover:text-loss"
                                        >
                                            Eliminar
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </AppLayout>
    );
}
