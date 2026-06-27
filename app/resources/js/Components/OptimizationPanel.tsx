import { useMemo, useState } from 'react';
import type { Optimization, OptimizationResult } from '@/types';

type OptSortKey = 'in_return' | 'out_return' | 'total_trades' | 'robustness';

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

function OptTh({ k, label, right, sort, onSort }: { k: OptSortKey; label: string; right?: boolean; sort: { key: OptSortKey; dir: 'asc' | 'desc' } | null; onSort: (k: OptSortKey) => void }) {
    return (
        <th className={`px-3 py-2 font-medium ${right ? 'text-right' : ''}`}>
            <button type="button" onClick={() => onSort(k)} className={`inline-flex items-center gap-1 hover:text-text-primary ${right ? 'flex-row-reverse' : ''}`}>
                {label}
                <span className="text-[8px] leading-none text-accent">{sort?.key === k ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
            </button>
        </th>
    );
}

/**
 * Panel presentacional del ranking de optimización. La ejecución la dispara el
 * botón "Optimizar" del sidebar del laboratorio (no hay botón aquí).
 */
export default function OptimizationPanel({ data, onLoad }: { data: Optimization | null; onLoad: (params: Record<string, number | string>) => void }) {
    const [sort, setSort] = useState<{ key: OptSortKey; dir: 'asc' | 'desc' } | null>(null);
    const toggleSort = (key: OptSortKey) => setSort((p) => (p && p.key === key ? { key, dir: p.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
    const sortedResults = useMemo(() => {
        if (!data) return [];
        if (!sort) return data.results; // por defecto: orden de robustez del backend
        const { key, dir } = sort;
        return [...data.results].sort((a, b) => (dir === 'asc' ? a[key] - b[key] : b[key] - a[key]));
    }, [data, sort]);

    return (
        <div>
            <p className="mb-3 text-xs text-text-secondary">
                Barre combinaciones y las valida en un tramo que el optimizador NO vio (out-of-sample).
                Ordena por <span className="text-text-primary">robustez</span> (consistencia in↔out), no por retorno máximo.
                Elige solo las marcadas <span className="text-profit">DENTRO del rango</span>. Pulsa <span className="text-text-primary">Optimizar</span> en el panel izquierdo para ejecutar.
            </p>

            {!data ? (
                <p className="p-8 text-center text-sm text-text-secondary">Pulsa «Optimizar» para barrer combinaciones de parámetros.</p>
            ) : (
                <div>
                    <div className="mb-2 font-mono text-[11px] text-text-secondary">
                        {data.combinations} combinaciones · in-sample {data.in_sample.candles} velas · out-of-sample {data.out_sample.candles} velas · mín {data.min_trades} ops
                    </div>
                    <div className="max-h-[420px] overflow-auto rounded-md border border-border">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-bg-elevated">
                                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
                                    <th className="px-3 py-2 font-medium">Combinación</th>
                                    <OptTh k="in_return" label="In-sample" right sort={sort} onSort={toggleSort} />
                                    <OptTh k="out_return" label="Out-sample" right sort={sort} onSort={toggleSort} />
                                    <OptTh k="total_trades" label="Ops" right sort={sort} onSort={toggleSort} />
                                    <OptTh k="robustness" label="Robustez" sort={sort} onSort={toggleSort} />
                                    <th className="px-3 py-2 font-medium">Veredicto</th>
                                    <th className="px-3 py-2" />
                                </tr>
                            </thead>
                            <tbody>
                                {sortedResults.map((r: OptimizationResult, i) => {
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
    );
}
