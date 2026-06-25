import { useState } from 'react';
import type { Optimization, OptimizationResult } from '@/types';

interface Props {
    strategyType: string;
    pair: string;
    timeframe: string;
    period: { date_from: string; date_to: string };
    indicators: Record<string, number | string>;
    risk: Record<string, number>;
    onLoad: (params: Record<string, number | string>) => void;
}

const VERDICT: Record<string, { label: string; cls: string }> = {
    inside: { label: 'DENTRO del rango', cls: 'bg-profit/15 text-profit' },
    edge: { label: 'límite', cls: 'bg-warning/15 text-warning' },
    outside: { label: 'FUERA del rango', cls: 'bg-loss/15 text-loss' },
};

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(4 - n);
const paramsLabel = (p: Record<string, number | string>) =>
    Object.entries(p)
        .map(([k, v]) => `${k.replace(/_/g, ' ')}=${v}`)
        .join(', ');

export default function OptimizationPanel({ strategyType, pair, timeframe, period, indicators, risk, onLoad }: Props) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<Optimization | null>(null);

    const run = async () => {
        setLoading(true);
        setError(null);
        try {
            const { data: res } = await window.axios.post('/backtests/optimize', {
                strategy_type: strategyType,
                pair,
                timeframe,
                date_from: period.date_from,
                date_to: period.date_to,
                indicators,
                risk,
            });
            setData(res as Optimization);
        } catch (e: unknown) {
            const err = e as { response?: { data?: { error?: string } } };
            setError(err.response?.data?.error ?? 'No se pudo optimizar.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <section className="rounded-lg border border-border bg-bg-surface">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
                <span className="text-sm font-semibold">Optimización automática (robusta, anti-overfitting)</span>
                <span className="text-text-secondary">{open ? '−' : '+'}</span>
            </button>

            {open && (
                <div className="border-t border-border p-4">
                    <p className="mb-3 text-xs text-text-secondary">
                        Barre combinaciones y las valida en un tramo que el optimizador NO vio (out-of-sample).
                        Ordena por <span className="text-text-primary">robustez</span> (consistencia in↔out), no por retorno máximo.
                        Elige solo las marcadas <span className="text-profit">DENTRO del rango</span>.
                    </p>

                    <button
                        type="button"
                        onClick={run}
                        disabled={loading}
                        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                    >
                        {loading ? 'Optimizando… (puede tardar)' : 'Ejecutar optimización'}
                    </button>

                    {error && <div className="mt-3 rounded border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">{error}</div>}

                    {data && (
                        <div className="mt-4">
                            <div className="mb-2 font-mono text-[11px] text-text-secondary">
                                {data.combinations} combinaciones · in-sample {data.in_sample.candles} velas · out-of-sample {data.out_sample.candles} velas · mín {data.min_trades} ops
                            </div>
                            <div className="max-h-[420px] overflow-auto rounded-md border border-border">
                                <table className="w-full text-sm">
                                    <thead className="sticky top-0 bg-bg-elevated">
                                        <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
                                            <th className="px-3 py-2 font-medium">Combinación</th>
                                            <th className="px-3 py-2 font-medium text-right">In-sample</th>
                                            <th className="px-3 py-2 font-medium text-right">Out-sample</th>
                                            <th className="px-3 py-2 font-medium text-right">Ops</th>
                                            <th className="px-3 py-2 font-medium">Robustez</th>
                                            <th className="px-3 py-2 font-medium">Veredicto</th>
                                            <th className="px-3 py-2" />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.results.map((r: OptimizationResult, i) => {
                                            const v = VERDICT[r.verdict];
                                            return (
                                                <tr key={i} className="border-b border-border/40 last:border-0">
                                                    <td className="px-3 py-1.5 font-mono text-xs text-text-primary">{paramsLabel(r.params)}</td>
                                                    <td className={`px-3 py-1.5 text-right font-mono text-xs ${r.in_return >= 0 ? 'text-profit' : 'text-loss'}`}>{r.in_return >= 0 ? '+' : ''}{r.in_return}%</td>
                                                    <td className={`px-3 py-1.5 text-right font-mono text-xs ${r.out_return >= 0 ? 'text-profit' : 'text-loss'}`}>{r.out_return >= 0 ? '+' : ''}{r.out_return}%</td>
                                                    <td className="px-3 py-1.5 text-right font-mono text-xs text-text-secondary">{r.total_trades}</td>
                                                    <td className="px-3 py-1.5 font-mono text-xs text-warning" title={`robustez ${r.robustness}`}>{stars(r.stars)}</td>
                                                    <td className="px-3 py-1.5">
                                                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${v.cls}`} title={r.verdict_label}>{v.label}</span>
                                                    </td>
                                                    <td className="px-3 py-1.5 text-right">
                                                        <button
                                                            type="button"
                                                            onClick={() => onLoad(r.params)}
                                                            disabled={r.verdict === 'outside'}
                                                            className="rounded border border-border px-2 py-1 text-[11px] text-text-primary hover:bg-bg-elevated disabled:opacity-40"
                                                            title={r.verdict === 'outside' ? 'Descartada (overfit / muestra pequeña)' : 'Cargar al panel'}
                                                        >
                                                            Cargar
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
