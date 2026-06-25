import { Head, Link, router } from '@inertiajs/react';
import { useState } from 'react';
import AppLayout from '@/Layouts/AppLayout';
import SignalLog from '@/Components/SignalLog';
import type { EvaluateResult, SignalLogEntry, Strategy } from '@/types';

interface VersionRow {
    id: number;
    name: string;
    version: number;
    is_active: boolean;
    created_at: string;
}

interface Props {
    strategy: Strategy;
    versions: VersionRow[];
    recentSignals: SignalLogEntry[];
}

const SIGNAL_STYLE: Record<string, string> = {
    buy: 'bg-profit/15 text-profit',
    sell: 'bg-loss/15 text-loss',
    none: 'bg-bg-elevated text-text-secondary',
};

export default function Show({ strategy, versions, recentSignals }: Props) {
    const [evaluating, setEvaluating] = useState(false);
    const [result, setResult] = useState<EvaluateResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [signals, setSignals] = useState<SignalLogEntry[]>(recentSignals);

    const params = strategy.parameters;

    const evaluate = async () => {
        setEvaluating(true);
        setError(null);
        try {
            const { data } = await window.axios.post(`/strategies/${strategy.id}/evaluate`);
            setResult(data.result as EvaluateResult);
            setSignals((prev) => [data.signal as SignalLogEntry, ...prev].slice(0, 20));
        } catch (e: unknown) {
            const err = e as { response?: { data?: { error?: string } } };
            setError(err.response?.data?.error ?? 'No se pudo evaluar la estrategia.');
        } finally {
            setEvaluating(false);
        }
    };

    return (
        <AppLayout>
            <Head title={strategy.name} />

            <div className="mb-5 flex items-start justify-between">
                <div>
                    <div className="flex items-center gap-3">
                        <h1 className="text-lg font-semibold tracking-tight">{strategy.name}</h1>
                        <span className="font-mono text-xs text-text-secondary">v{strategy.version}</span>
                        <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                strategy.is_active ? 'bg-profit/15 text-profit' : 'bg-bg-elevated text-text-secondary'
                            }`}
                        >
                            {strategy.is_active ? 'Activa' : 'Inactiva'}
                        </span>
                    </div>
                    {strategy.description && <p className="mt-1 text-sm text-text-secondary">{strategy.description}</p>}
                    <p className="mt-1 font-mono text-xs text-text-secondary">
                        {strategy.pair} · {strategy.timeframe} · {params.type}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Link
                        href={`/strategies/${strategy.id}/edit`}
                        className="rounded-md border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-bg-elevated"
                    >
                        Editar
                    </Link>
                    <button
                        type="button"
                        onClick={evaluate}
                        disabled={evaluating}
                        className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                    >
                        {evaluating ? 'Evaluando…' : 'Evaluar señal ahora'}
                    </button>
                </div>
            </div>

            {error && (
                <div className="mb-5 rounded-lg border border-loss/40 bg-loss/10 px-4 py-3 text-sm text-loss">{error}</div>
            )}

            {result && (
                <div className="mb-6 rounded-lg border border-border bg-bg-surface p-5">
                    <div className="flex items-center gap-3">
                        <span className={`rounded px-2 py-1 text-sm font-bold ${SIGNAL_STYLE[result.signal]}`}>
                            {result.signal.toUpperCase()}
                        </span>
                        <span className="text-sm text-text-primary">{result.reason}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs text-text-secondary">
                        <span>precio: {result.price ?? '—'}</span>
                        <span>velas: {result.candles_evaluated}</span>
                        {Object.entries(result.indicators).map(([k, v]) => (
                            <span key={k}>
                                {k}: {v ?? '—'}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                {/* Parámetros */}
                <section className="rounded-lg border border-border bg-bg-surface p-5">
                    <h2 className="mb-3 text-sm font-semibold">Parámetros</h2>
                    <dl className="space-y-1.5 text-sm">
                        {Object.entries(params.indicators ?? {}).map(([k, v]) => (
                            <div key={k} className="flex justify-between">
                                <dt className="text-text-secondary">{k}</dt>
                                <dd className="font-mono text-text-primary">{String(v)}</dd>
                            </div>
                        ))}
                    </dl>
                    <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                        Riesgo
                    </h3>
                    <dl className="space-y-1.5 text-sm">
                        <Row label="SL (pips)" value={params.risk?.sl_pips} />
                        <Row label="TP (pips)" value={params.risk?.tp_pips} />
                        <Row label="Riesgo %" value={params.risk?.risk_percent} />
                    </dl>
                </section>

                {/* Versiones */}
                <section className="rounded-lg border border-border bg-bg-surface p-5">
                    <h2 className="mb-3 text-sm font-semibold">Historial de versiones</h2>
                    <ul className="space-y-1.5 text-sm">
                        {versions.map((v) => (
                            <li key={v.id} className="flex items-center justify-between">
                                <button
                                    type="button"
                                    onClick={() => router.get(`/strategies/${v.id}`)}
                                    className={`font-mono ${v.id === strategy.id ? 'text-accent' : 'text-text-secondary hover:text-text-primary'}`}
                                >
                                    v{v.version} · {v.name}
                                </button>
                                {v.is_active && <span className="text-[10px] text-profit">activa</span>}
                            </li>
                        ))}
                    </ul>
                </section>

                {/* Señales recientes */}
                <section className="lg:col-span-1">
                    <h2 className="mb-3 text-sm font-semibold">Señales recientes</h2>
                    <SignalLog signals={signals} />
                </section>
            </div>
        </AppLayout>
    );
}

function Row({ label, value }: { label: string; value: number | null | undefined }) {
    return (
        <div className="flex justify-between">
            <dt className="text-text-secondary">{label}</dt>
            <dd className="font-mono text-text-primary">{value ?? '—'}</dd>
        </div>
    );
}
