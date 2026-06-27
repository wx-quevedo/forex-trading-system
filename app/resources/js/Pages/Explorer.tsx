import { Head, router } from '@inertiajs/react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import AppLayout from '@/Layouts/AppLayout';
import SymbolCombobox from '@/Components/SymbolCombobox';
import ProgressModal from '@/Components/ProgressModal';
import { fmtMoney, fmtNumber } from '@/lib/format';
import type { ExploreMeta, ExploreResultRow, ExploreStatus, StrategySchemas } from '@/types';

interface Props {
    schemas: StrategySchemas;
    symbols: string[];
    timeframes: string[];
    types: string[];
    meta: ExploreMeta;
    defaultPeriod: { date_from: string; date_to: string };
}

const VERDICT: Record<string, { label: string; cls: string }> = {
    inside: { label: 'DENTRO del rango', cls: 'bg-profit/15 text-profit' },
    edge: { label: 'límite', cls: 'bg-warning/15 text-warning' },
    outside: { label: 'FUERA del rango', cls: 'bg-loss/15 text-loss' },
};

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(4 - n);
const paramsLabel = (p: Record<string, number | string>) =>
    Object.entries(p).map(([k, v]) => `${k.replace(/_/g, ' ')}=${v}`).join(', ');

type SortKey =
    | 'pair' | 'type' | 'timeframe' | 'sl_pips' | 'tp_pips' | 'risk_percent'
    | 'capital_final' | 'costs' | 'return_pct' | 'net_pnl' | 'win_rate'
    | 'profit_factor' | 'max_drawdown_pct' | 'total_trades' | 'in_return'
    | 'out_return' | 'robustness';

export default function Explorer({ schemas, symbols, timeframes, types, meta, defaultPeriod }: Props) {
    // --- Selección del usuario ---
    const [pairs, setPairs] = useState<string[]>([]);
    const [selTypes, setSelTypes] = useState<string[]>(types);
    const sweepTfs = useMemo(() => meta.sweep_timeframes.filter((t) => timeframes.includes(t)), [meta.sweep_timeframes, timeframes]);
    const [selTfs, setSelTfs] = useState<string[]>(sweepTfs);
    const [sls, setSls] = useState<number[]>(meta.sl_choices);
    const [tps, setTps] = useState<number[]>(meta.tp_choices);
    const [risks, setRisks] = useState<number[]>(meta.risk_choices);
    const [period, setPeriod] = useState(defaultPeriod);
    const [capital, setCapital] = useState<number>(() => Number(localStorage.getItem('forexbot.lab_capital')) || 10000);

    // --- Estado de la búsqueda ---
    const [status, setStatus] = useState<ExploreStatus | null>(null);
    const [results, setResults] = useState<ExploreResultRow[]>([]);
    const [error, setError] = useState<string | null>(null);
    const pollRef = useRef<number | null>(null);

    // --- Reporte: filtros, orden, guardar ---
    const [fVerdict, setFVerdict] = useState<'all' | 'inside' | 'edge' | 'outside'>('inside');
    const [fPair, setFPair] = useState('all');
    const [fType, setFType] = useState('all');
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'robustness', dir: 'desc' });
    const [saveRow, setSaveRow] = useState<ExploreResultRow | null>(null);

    const running = status?.status === 'running';

    // Estimación de combinaciones (cliente, con los grids del bridge).
    const gridSum = useMemo(() => selTypes.reduce((a, t) => a + (meta.grid_sizes[t] ?? 0), 0), [selTypes, meta.grid_sizes]);
    const configs = pairs.length * selTfs.length * sls.length * tps.length * risks.length * gridSum;
    const overLimit = configs > meta.max_configs;
    const canSearch = configs > 0 && !overLimit && !running;

    const stopPoll = useCallback(() => {
        if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
    }, []);

    const fetchResults = useCallback(async () => {
        try {
            const { data } = await window.axios.get('/explorer/results');
            setResults((data.results ?? []) as ExploreResultRow[]);
        } catch { /* deja el reporte previo */ }
    }, []);

    const poll = useCallback(async () => {
        try {
            const { data } = await window.axios.get('/explorer/status');
            setStatus(data as ExploreStatus);
            if (data.status !== 'running') {
                stopPoll();
                if (data.results_count > 0) fetchResults();
            }
        } catch { /* reintenta en el siguiente tick */ }
    }, [stopPoll, fetchResults]);

    const startPoll = useCallback(() => {
        stopPoll();
        pollRef.current = window.setInterval(poll, 1000);
    }, [poll, stopPoll]);

    // Al montar: si ya hay una búsqueda corriendo (o un reporte reciente), reengánchalo.
    useEffect(() => {
        (async () => {
            try {
                const { data } = await window.axios.get('/explorer/status');
                setStatus(data as ExploreStatus);
                if (data.status === 'running') startPoll();
                else if (data.results_count > 0) fetchResults();
            } catch { /* bridge caído: la página sigue usable */ }
        })();
        return stopPoll;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const search = async () => {
        setError(null);
        setResults([]);
        try {
            const { data } = await window.axios.post('/explorer/start', {
                pairs, types: selTypes, timeframes: selTfs,
                date_from: period.date_from, date_to: period.date_to, capital,
                sl_choices: sls, tp_choices: tps, risk_choices: risks,
            });
            setStatus(data as ExploreStatus);
            startPoll();
        } catch (e: unknown) {
            const err = e as { response?: { data?: { error?: string } } };
            setError(err.response?.data?.error ?? 'No se pudo iniciar la búsqueda.');
        }
    };

    const cancel = async () => {
        try { await window.axios.post('/explorer/cancel'); } catch { /* noop */ }
    };

    // --- Reporte derivado: filtrar + ordenar ---
    const uniquePairs = useMemo(() => [...new Set(results.map((r) => r.pair))].sort(), [results]);
    const uniqueTypes = useMemo(() => [...new Set(results.map((r) => r.type))].sort(), [results]);

    const view = useMemo(() => {
        let rows = results;
        if (fVerdict !== 'all') rows = rows.filter((r) => r.verdict === fVerdict);
        if (fPair !== 'all') rows = rows.filter((r) => r.pair === fPair);
        if (fType !== 'all') rows = rows.filter((r) => r.type === fType);
        const { key, dir } = sort;
        const num = (v: number | null) => (v == null ? -Infinity : v);
        return [...rows].sort((a, b) => {
            const av = a[key]; const bv = b[key];
            let cmp: number;
            if (typeof av === 'string' || typeof bv === 'string') cmp = String(av).localeCompare(String(bv));
            else cmp = num(av as number) - num(bv as number);
            return dir === 'asc' ? cmp : -cmp;
        });
    }, [results, fVerdict, fPair, fType, sort]);

    const toggleSort = (key: SortKey) =>
        setSort((p) => (p.key === key ? { key, dir: p.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));

    const loadToLab = (r: ExploreResultRow) => {
        sessionStorage.setItem('forexbot.lab_combo', JSON.stringify({
            type: r.type, pair: r.pair, timeframe: r.timeframe, indicators: r.params,
            risk: { sl_pips: r.sl_pips, tp_pips: r.tp_pips, risk_percent: r.risk_percent }, capital,
        }));
        router.visit('/laboratory');
    };

    const exportCsv = () => {
        const cols: [string, (r: ExploreResultRow) => string | number][] = [
            ['Par', (r) => r.pair], ['Tipo', (r) => r.type], ['Timeframe', (r) => r.timeframe],
            ['Parametros', (r) => paramsLabel(r.params)], ['SL', (r) => r.sl_pips], ['TP', (r) => r.tp_pips],
            ['Riesgo%', (r) => r.risk_percent], ['CapitalFinal', (r) => r.capital_final], ['Costos', (r) => r.costs],
            ['RetornoNeto%', (r) => r.return_pct], ['PnLNeto', (r) => r.net_pnl], ['WinRate%', (r) => (r.win_rate * 100).toFixed(1)],
            ['ProfitFactor', (r) => r.profit_factor ?? ''], ['MaxDD%', (r) => r.max_drawdown_pct], ['Trades', (r) => r.total_trades],
            ['InSample%', (r) => r.in_return], ['OutSample%', (r) => r.out_return], ['Robustez', (r) => r.robustness],
            ['Veredicto', (r) => r.verdict],
        ];
        const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
        const csv = [cols.map((c) => esc(c[0])).join(','), ...view.map((r) => cols.map((c) => esc(c[1](r))).join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `explorador_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click(); URL.revokeObjectURL(url);
    };

    return (
        <AppLayout title="Explorador de estrategias" wide>
            <Head title="Explorador" />

            <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
                <span className="font-semibold">Cuidado con el azar.</span> Al probar miles de combinaciones, algunas parecerán
                ganadoras por pura suerte. Fíate de la <span className="font-semibold">robustez</span> y del
                <span className="font-semibold"> out-of-sample</span>, no del retorno más alto. El reporte ordena por robustez por defecto.
            </div>

            {/* --- Configuración de la búsqueda --- */}
            <section className="space-y-4 rounded-lg border border-border bg-bg-surface p-4">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {/* Pares */}
                    <div>
                        <SectionLabel>Pares a incluir</SectionLabel>
                        <SymbolCombobox value="" symbols={symbols} placeholder="Añadir par…" onChange={(s) => setPairs((p) => (p.includes(s) ? p : [...p, s]))} />
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {pairs.length === 0 && <span className="text-xs text-text-secondary">Ninguno aún — añade al menos uno.</span>}
                            {pairs.map((p) => (
                                <span key={p} className="inline-flex items-center gap-1 rounded bg-bg-elevated px-2 py-0.5 font-mono text-xs">
                                    {p}
                                    <button type="button" onClick={() => setPairs((prev) => prev.filter((x) => x !== p))} className="text-text-secondary hover:text-loss">×</button>
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* Tipos */}
                    <div>
                        <SectionLabel>Tipos de estrategia</SectionLabel>
                        <ChipToggle options={types.map((t) => ({ value: t, label: schemas[t]?.label ?? t }))} selected={selTypes} onToggle={(v) => toggle(selTypes, setSelTypes, v as string)} />
                    </div>

                    {/* Timeframes */}
                    <div>
                        <SectionLabel>Timeframes</SectionLabel>
                        <ChipToggle options={timeframes.map((t) => ({ value: t, label: t }))} selected={selTfs} onToggle={(v) => toggle(selTfs, setSelTfs, v as string)} />
                    </div>

                    {/* Periodo + capital */}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <Field label="Desde"><input type="date" value={period.date_from} onChange={(e) => setPeriod((p) => ({ ...p, date_from: e.target.value }))} className="input font-mono" /></Field>
                        <Field label="Hasta"><input type="date" value={period.date_to} onChange={(e) => setPeriod((p) => ({ ...p, date_to: e.target.value }))} className="input font-mono" /></Field>
                        <Field label="Capital (USD)"><input type="number" min={1} step={100} value={capital} onChange={(e) => setCapital(Number(e.target.value))} className="input font-mono" /></Field>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div><SectionLabel>SL (pips)</SectionLabel><ChipToggle options={meta.sl_choices.map((v) => ({ value: v, label: String(v) }))} selected={sls} onToggle={(v) => toggle(sls, setSls, v as number)} /></div>
                    <div><SectionLabel>TP (pips)</SectionLabel><ChipToggle options={meta.tp_choices.map((v) => ({ value: v, label: String(v) }))} selected={tps} onToggle={(v) => toggle(tps, setTps, v as number)} /></div>
                    <div><SectionLabel>Riesgo %</SectionLabel><ChipToggle options={meta.risk_choices.map((v) => ({ value: v, label: String(v) }))} selected={risks} onToggle={(v) => toggle(risks, setRisks, v as number)} /></div>
                </div>

                {/* Estimación + acción */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                    <div className="text-sm">
                        <span className="text-text-secondary">Estimación: </span>
                        <span className={`font-mono font-semibold ${overLimit ? 'text-loss' : 'text-text-primary'}`}>{configs.toLocaleString()}</span>
                        <span className="text-text-secondary"> configuraciones (~{(configs * 3).toLocaleString()} backtests).</span>
                        {overLimit && <span className="ml-2 text-loss">Supera el tope de {meta.max_configs.toLocaleString()} — acota la selección.</span>}
                        {configs > 2000 && !overLimit && <span className="ml-2 text-warning">Es grande; puede tardar varios minutos.</span>}
                    </div>
                    <button type="button" onClick={search} disabled={!canSearch} className="rounded-md bg-accent px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                        {running ? 'Buscando…' : 'Buscar'}
                    </button>
                </div>
                {error && <div className="rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">{error}</div>}
            </section>

            {/* --- Reporte --- */}
            {results.length > 0 && (
                <section className="mt-5 rounded-lg border border-border bg-bg-surface">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
                        <div className="text-sm text-text-secondary">
                            <span className="font-semibold text-text-primary">{results.length.toLocaleString()}</span> configuraciones probadas ·
                            <span className="font-semibold text-profit"> {results.filter((r) => r.verdict === 'inside').length}</span> DENTRO del rango ·
                            mostrando <span className="font-semibold text-text-primary">{view.length.toLocaleString()}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <FilterSelect label="Veredicto" value={fVerdict} onChange={(v) => setFVerdict(v as typeof fVerdict)} options={[['all', 'Todos'], ['inside', 'DENTRO'], ['edge', 'Límite'], ['outside', 'FUERA']]} />
                            <FilterSelect label="Par" value={fPair} onChange={setFPair} options={[['all', 'Todos'], ...uniquePairs.map((p) => [p, p] as [string, string])]} />
                            <FilterSelect label="Tipo" value={fType} onChange={setFType} options={[['all', 'Todos'], ...uniqueTypes.map((t) => [t, schemas[t]?.label ?? t] as [string, string])]} />
                            <button type="button" onClick={exportCsv} className="rounded-md border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-bg-elevated">Exportar CSV</button>
                        </div>
                    </div>

                    <div className="max-h-[60vh] overflow-auto">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-bg-elevated">
                                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
                                    <Th k="pair" label="Par" s={sort} on={toggleSort} />
                                    <Th k="type" label="Tipo" s={sort} on={toggleSort} />
                                    <Th k="timeframe" label="TF" s={sort} on={toggleSort} />
                                    <th className="px-3 py-2 font-medium">Parámetros</th>
                                    <Th k="sl_pips" label="SL" right s={sort} on={toggleSort} />
                                    <Th k="tp_pips" label="TP" right s={sort} on={toggleSort} />
                                    <Th k="risk_percent" label="Riesgo%" right s={sort} on={toggleSort} />
                                    <Th k="capital_final" label="Cap. final" right s={sort} on={toggleSort} />
                                    <Th k="costs" label="Costos" right s={sort} on={toggleSort} />
                                    <Th k="return_pct" label="Ret. neto" right s={sort} on={toggleSort} />
                                    <Th k="net_pnl" label="PnL neto" right s={sort} on={toggleSort} />
                                    <Th k="win_rate" label="Win%" right s={sort} on={toggleSort} />
                                    <Th k="profit_factor" label="PF" right s={sort} on={toggleSort} />
                                    <Th k="max_drawdown_pct" label="Max DD" right s={sort} on={toggleSort} />
                                    <Th k="total_trades" label="Ops" right s={sort} on={toggleSort} />
                                    <Th k="in_return" label="In" right s={sort} on={toggleSort} />
                                    <Th k="out_return" label="Out" right s={sort} on={toggleSort} />
                                    <Th k="robustness" label="Robustez" s={sort} on={toggleSort} />
                                    <th className="px-3 py-2 font-medium">Veredicto</th>
                                    <th className="px-3 py-2" />
                                </tr>
                            </thead>
                            <tbody>
                                {view.map((r, i) => {
                                    const v = VERDICT[r.verdict];
                                    const tone = r.verdict === 'inside' ? 'bg-profit/[0.04]' : r.verdict === 'outside' ? 'opacity-70' : '';
                                    return (
                                        <tr key={i} className={`border-b border-border/40 last:border-0 ${tone}`}>
                                            <td className="px-3 py-1.5 font-mono text-xs text-text-primary">{r.pair}</td>
                                            <td className="px-3 py-1.5 text-xs text-text-secondary">{schemas[r.type]?.label ?? r.type}</td>
                                            <td className="px-3 py-1.5 font-mono text-xs">{r.timeframe}</td>
                                            <td className="px-3 py-1.5 font-mono text-[11px] text-text-secondary" title={paramsLabel(r.params)}>{paramsLabel(r.params)}</td>
                                            <td className="px-3 py-1.5 text-right font-mono text-xs">{r.sl_pips}</td>
                                            <td className="px-3 py-1.5 text-right font-mono text-xs">{r.tp_pips}</td>
                                            <td className="px-3 py-1.5 text-right font-mono text-xs">{r.risk_percent}</td>
                                            <td className="px-3 py-1.5 text-right font-mono text-xs">{fmtMoney(r.capital_final)}</td>
                                            <td className="px-3 py-1.5 text-right font-mono text-xs text-warning">{fmtMoney(r.costs)}</td>
                                            <td className={`px-3 py-1.5 text-right font-mono text-xs ${r.return_pct >= 0 ? 'text-profit' : 'text-loss'}`}>{r.return_pct >= 0 ? '+' : ''}{r.return_pct}%</td>
                                            <td className={`px-3 py-1.5 text-right font-mono text-xs ${r.net_pnl >= 0 ? 'text-profit' : 'text-loss'}`}>{fmtMoney(r.net_pnl)}</td>
                                            <td className="px-3 py-1.5 text-right font-mono text-xs">{(r.win_rate * 100).toFixed(1)}%</td>
                                            <td className="px-3 py-1.5 text-right font-mono text-xs">{r.profit_factor != null ? fmtNumber(r.profit_factor) : '—'}</td>
                                            <td className="px-3 py-1.5 text-right font-mono text-xs text-loss">{r.max_drawdown_pct}%</td>
                                            <td className="px-3 py-1.5 text-right font-mono text-xs text-text-secondary">{r.total_trades}</td>
                                            <td className={`px-3 py-1.5 text-right font-mono text-xs ${r.in_return >= 0 ? 'text-profit' : 'text-loss'}`}>{r.in_return}%</td>
                                            <td className={`px-3 py-1.5 text-right font-mono text-xs ${r.out_return >= 0 ? 'text-profit' : 'text-loss'}`}>{r.out_return}%</td>
                                            <td className="px-3 py-1.5 font-mono text-xs text-warning" title={`robustez ${r.robustness}`}>{stars(r.stars)}</td>
                                            <td className="px-3 py-1.5"><span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${v.cls}`} title={r.verdict_label}>{v.label}</span></td>
                                            <td className="px-3 py-1.5">
                                                <div className="flex gap-1">
                                                    <button type="button" onClick={() => loadToLab(r)} className="rounded border border-border px-2 py-1 text-[11px] text-text-primary hover:bg-bg-elevated" title="Inspeccionar en el Laboratorio">Laboratorio</button>
                                                    <button type="button" onClick={() => setSaveRow(r)} className="rounded border border-profit/50 px-2 py-1 text-[11px] text-profit hover:bg-profit/10" title="Guardar como estrategia">Guardar</button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            {status && status.status !== 'running' && results.length === 0 && status.total > 0 && (
                <p className="mt-5 text-center text-sm text-text-secondary">
                    {status.status === 'cancelled' ? 'Búsqueda cancelada.' : status.status === 'error' ? `Error: ${status.error}` : 'Ninguna configuración pasó el filtro.'}
                </p>
            )}

            {/* Modal de progreso real, cancelable */}
            {running && status && (
                <ProgressModal
                    title="Buscando estrategias…"
                    detail={status.current ?? 'Preparando…'}
                    value={status.done}
                    max={status.total}
                    onCancel={cancel}
                    cancelLabel="Cancelar búsqueda"
                />
            )}

            {/* Modal: guardar una combinación como estrategia */}
            {saveRow && <SaveModal row={saveRow} schemas={schemas} onClose={() => setSaveRow(null)} />}
        </AppLayout>
    );
}

// --- Sub-componentes -------------------------------------------------------
function toggle<T>(arr: T[], set: (v: T[]) => void, v: T) {
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return <label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-text-secondary">{label}</span>{children}</label>;
}

function ChipToggle<T extends string | number>({ options, selected, onToggle }: { options: { value: T; label: string }[]; selected: T[]; onToggle: (v: T) => void }) {
    return (
        <div className="flex flex-wrap gap-1.5">
            {options.map((o) => {
                const on = selected.includes(o.value);
                return (
                    <button key={String(o.value)} type="button" onClick={() => onToggle(o.value)}
                        className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${on ? 'border-accent bg-accent/15 text-text-primary' : 'border-border text-text-secondary hover:text-text-primary'}`}>
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
    return (
        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
            {label}
            <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-xs text-text-primary">
                {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
        </label>
    );
}

function Th({ k, label, right, s, on }: { k: SortKey; label: string; right?: boolean; s: { key: SortKey; dir: 'asc' | 'desc' }; on: (k: SortKey) => void }) {
    return (
        <th className={`px-3 py-2 font-medium ${right ? 'text-right' : ''}`}>
            <button type="button" onClick={() => on(k)} className={`inline-flex items-center gap-1 hover:text-text-primary ${right ? 'flex-row-reverse' : ''}`}>
                {label}
                <span className="text-[8px] leading-none text-accent">{s.key === k ? (s.dir === 'asc' ? '▲' : '▼') : ''}</span>
            </button>
        </th>
    );
}

function SaveModal({ row, schemas, onClose }: { row: ExploreResultRow; schemas: StrategySchemas; onClose: () => void }) {
    const [name, setName] = useState(`${schemas[row.type]?.label ?? row.type} ${row.pair} ${row.timeframe}`);
    const [description, setDescription] = useState(`Hallada en el explorador · robustez ${row.robustness} · out ${row.out_return}%`);

    const submit = (e: FormEvent) => {
        e.preventDefault();
        router.post('/laboratory', {
            name, description, type: row.type, pair: row.pair, timeframe: row.timeframe,
            indicators: row.params, risk: { sl_pips: row.sl_pips, tp_pips: row.tp_pips, risk_percent: row.risk_percent },
            from_strategy_id: null,
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
            <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-md rounded-lg border border-border bg-bg-surface p-5 shadow-2xl">
                <h2 className="mb-1 text-sm font-semibold">Guardar como estrategia</h2>
                <p className="mb-3 font-mono text-[11px] text-text-secondary">{paramsLabel(row.params)} · SL{row.sl_pips}/TP{row.tp_pips} · {row.risk_percent}%</p>
                <Field label="Nombre"><input value={name} onChange={(e) => setName(e.target.value)} required className="input" /></Field>
                <div className="mt-2"><Field label="Descripción"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input" /></Field></div>
                <div className="mt-4 flex justify-end gap-2">
                    <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary">Cancelar</button>
                    <button type="submit" className="rounded-md bg-profit px-4 py-1.5 text-sm font-bold text-white hover:opacity-90">Guardar</button>
                </div>
            </form>
        </div>
    );
}
