import { Head, useForm, Link } from '@inertiajs/react';
import type { FormEvent } from 'react';
import AppLayout from '@/Layouts/AppLayout';

interface StrategyOption {
    id: number;
    name: string;
    pair: string;
    timeframe: string;
}

interface Props {
    strategies: StrategyOption[];
    selectedStrategyId: number | null;
}

function isoDaysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
}

export default function Create({ strategies, selectedStrategyId }: Props) {
    const { data, setData, post, processing, errors } = useForm({
        strategy_id: selectedStrategyId ?? strategies[0]?.id ?? 0,
        date_from: isoDaysAgo(180),
        date_to: isoDaysAgo(0),
    });

    const selected = strategies.find((s) => s.id === Number(data.strategy_id));

    const submit = (e: FormEvent) => {
        e.preventDefault();
        post('/backtests');
    };

    return (
        <AppLayout title="Nuevo backtest">
            <Head title="Nuevo backtest" />

            {strategies.length === 0 ? (
                <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
                    No hay estrategias. <Link href="/strategies/create" className="underline">Crea una primero</Link>.
                </div>
            ) : (
                <form onSubmit={submit} className="max-w-xl rounded-lg border border-border bg-bg-surface p-6">
                    <label className="mb-4 block">
                        <span className="mb-1 block text-xs uppercase tracking-wide text-text-secondary">Estrategia</span>
                        <select
                            value={data.strategy_id}
                            onChange={(e) => setData('strategy_id', Number(e.target.value))}
                            className="input"
                        >
                            {strategies.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.name} ({s.pair} · {s.timeframe})
                                </option>
                            ))}
                        </select>
                        {errors.strategy_id && <span className="mt-1 block text-xs text-loss">{errors.strategy_id}</span>}
                    </label>

                    {selected && (
                        <p className="mb-4 font-mono text-xs text-text-secondary">
                            Se backtesteará <span className="text-text-primary">{selected.pair}</span> en{' '}
                            <span className="text-text-primary">{selected.timeframe}</span>.
                        </p>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                            <span className="mb-1 block text-xs uppercase tracking-wide text-text-secondary">Desde</span>
                            <input
                                type="date"
                                value={data.date_from}
                                onChange={(e) => setData('date_from', e.target.value)}
                                className="input font-mono"
                            />
                            {errors.date_from && <span className="mt-1 block text-xs text-loss">{errors.date_from}</span>}
                        </label>
                        <label className="block">
                            <span className="mb-1 block text-xs uppercase tracking-wide text-text-secondary">Hasta</span>
                            <input
                                type="date"
                                value={data.date_to}
                                onChange={(e) => setData('date_to', e.target.value)}
                                className="input font-mono"
                            />
                            {errors.date_to && <span className="mt-1 block text-xs text-loss">{errors.date_to}</span>}
                        </label>
                    </div>

                    <div className="mt-6 flex items-center gap-3">
                        <button
                            type="submit"
                            disabled={processing}
                            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                        >
                            {processing ? 'Encolando…' : 'Lanzar backtest'}
                        </button>
                        <Link href="/backtests" className="text-sm text-text-secondary hover:text-text-primary">
                            Cancelar
                        </Link>
                    </div>
                </form>
            )}
        </AppLayout>
    );
}
