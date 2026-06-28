import { Head, Link } from '@inertiajs/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import AppLayout from '@/Layouts/AppLayout';
import SymbolCombobox from '@/Components/SymbolCombobox';
import ProgressModal from '@/Components/ProgressModal';
import InfoTooltip from '@/Components/InfoTooltip';
import type { CoverageCell, CoverageMapData, ExploreMeta, ExploreStatus, StrategySchemas } from '@/types';

interface Props {
    schemas: StrategySchemas;
    symbols: string[];
    meta: ExploreMeta;
    context: { date_from: string; date_to: string; capital: number };
}

const DEFAULT_PAIRS = ['EURUSD#', 'GBPUSD#', 'USDJPY#', 'AUDUSD#', 'USDCAD#', 'GOLD#', 'BTCUSD#', 'US500Cash#'];

const COVERAGE_HELP = 'Verde = explorado (en caché para este periodo y capital), blanco = virgen. El % es la fracción del universo estándar (los mismos rangos que el Explorador por defecto) ya calculada bajo esa celda. Guía DÓNDE explorar; NO mide robustez ni resultados.';

const fmtEta = (s: number | null): string => (s == null ? '—' : s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`);
const paramsLabel = (p: Record<string, number | string>) => Object.entries(p).map(([k, v]) => `${k.replace(/_/g, ' ')}=${v}`).join(', ');

export default function CoverageMap({ schemas, symbols, meta, context }: Props) {
    // Periodo y capital = MARCA GLOBAL fija (Ajustes › Contexto). Solo lectura aquí.
    const period = { date_from: context.date_from, date_to: context.date_to };
    const capital = context.capital;
    const [pairs, setPairs] = useState<string[]>(() => DEFAULT_PAIRS.filter((p) => symbols.length === 0 || symbols.includes(p)));

    const [path, setPath] = useState<string[]>([]);
    const [data, setData] = useState<CoverageMapData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const [exploring, setExploring] = useState<ExploreStatus | null>(null);
    const pollRef = useRef<number | null>(null);

    const typeLabel = (t: string) => schemas[t]?.label ?? t;
    const labelFor = (level: string, c: CoverageCell) =>
        level === 'types' ? typeLabel(c.name) : level === 'params' && c.params ? paramsLabel(c.params) : c.name;

    const loadCoverage = useCallback(async (p: string[]) => {
        setLoading(true);
        setError(null);
        try {
            const { data } = await window.axios.get('/explorer/coverage', {
                params: {
                    date_from: period.date_from, date_to: period.date_to, capital,
                    path: p.join('/'), pairs: pairs.join(','),
                },
            });
            setData(data as CoverageMapData);
        } catch (e: unknown) {
            const err = e as { response?: { data?: { error?: string } } };
            setError(err.response?.data?.error ?? 'No se pudo cargar el mapa (¿bridge apagado?).');
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [period.date_from, period.date_to, capital, pairs]);

    // Recargar al cambiar contexto o navegar.
    useEffect(() => { loadCoverage(path); }, [loadCoverage, path]);
    useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current); }, []);

    const drill = (cell: CoverageCell) => {
        if (!data || data.level === 'params') return;
        setPath([...path, cell.name]);
    };
    const goTo = (depth: number) => setPath(path.slice(0, depth));

    // --- Explorar esta zona: lanza en el Explorador solo lo faltante de esa celda ---
    const exploreZone = async (cell: CoverageCell) => {
        if (!data || !data.explorable) return;
        // El path de la celda define las dimensiones fijas; el resto = universo estándar.
        const cellPath = [...path, cell.name];
        const [pair, type, tf] = cellPath;
        const payload = {
            pairs: [pair],
            types: type ? [type] : Object.keys(meta.grid_sizes),
            timeframes: tf ? [tf] : meta.sweep_timeframes,
            date_from: period.date_from, date_to: period.date_to, capital,
            sl_choices: meta.sl_choices, tp_choices: meta.tp_choices, risk_choices: meta.risk_choices,
        };
        setError(null);
        try {
            const { data: snap } = await window.axios.post('/explorer/start', payload);
            setExploring(snap as ExploreStatus);
            pollRef.current = window.setInterval(async () => {
                try {
                    const { data: s } = await window.axios.get('/explorer/status');
                    setExploring(s as ExploreStatus);
                    if (s.status !== 'running') {
                        if (pollRef.current) window.clearInterval(pollRef.current);
                        setExploring(null);
                        loadCoverage(path);
                    }
                } catch { /* reintenta */ }
            }, 1000);
        } catch (e: unknown) {
            const err = e as { response?: { data?: { error?: string } } };
            setError(err.response?.data?.error ?? 'No se pudo lanzar la exploración (¿hay otra búsqueda en curso?).');
        }
    };

    const cancel = async () => { try { await window.axios.post('/explorer/cancel'); } catch { /* noop */ } };

    const levelTitle = { pairs: 'Pares', types: 'Tipos de estrategia', timeframes: 'Timeframes', params: 'Parámetros' }[data?.level ?? 'pairs'];

    return (
        <AppLayout title="Mapa de cobertura" wide>
            <Head title="Mapa de cobertura" />

            {/* Contexto */}
            <section className="mb-4 rounded-lg border border-border bg-bg-surface p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <h2 className="text-sm font-semibold">Contexto (fijo)</h2>
                        <InfoTooltip text={COVERAGE_HELP} />
                        <span className="font-mono text-sm text-text-primary">
                            {context.date_from} → {context.date_to} · ${Number(context.capital).toLocaleString()}
                        </span>
                    </div>
                    <Link href="/settings/analysis-context" className="text-xs text-accent hover:underline">Editar contexto</Link>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Añadir par (nivel 1)"><SymbolCombobox value="" symbols={symbols} placeholder="Añadir par…" onChange={(s) => setPairs((p) => (p.includes(s) ? p : [...p, s]))} /></Field>
                </div>
                {path.length === 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {pairs.map((p) => (
                            <span key={p} className="inline-flex items-center gap-1 rounded bg-bg-elevated px-2 py-0.5 font-mono text-xs">
                                {p}
                                <button type="button" onClick={() => setPairs((prev) => prev.filter((x) => x !== p))} className="text-text-secondary hover:text-loss">×</button>
                            </span>
                        ))}
                    </div>
                )}
            </section>

            {/* Breadcrumb + resumen */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1 text-sm">
                    <button type="button" onClick={() => goTo(0)} className={`hover:text-text-primary ${path.length === 0 ? 'font-semibold text-text-primary' : 'text-accent'}`}>Pares</button>
                    {path.map((seg, i) => (
                        <span key={i} className="flex items-center gap-1">
                            <span className="text-text-secondary">›</span>
                            <button type="button" onClick={() => goTo(i + 1)} className={`font-mono hover:text-text-primary ${i === path.length - 1 ? 'font-semibold text-text-primary' : 'text-accent'}`}>
                                {i === 1 ? typeLabel(seg) : seg}
                            </button>
                        </span>
                    ))}
                </div>
                {data && (
                    <div className="font-mono text-xs text-text-secondary">
                        {levelTitle} · cobertura del nodo: <span className="text-text-primary">{data.pct}%</span> ({data.explored.toLocaleString()}/{data.total.toLocaleString()})
                    </div>
                )}
            </div>

            {error && <div className="mb-3 rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">{error}</div>}

            {/* Grilla de celdas */}
            {data && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                    {data.cells.map((c) => {
                        const drillable = data.level !== 'params';
                        return (
                            <div
                                key={c.name}
                                onClick={() => drill(c)}
                                className={`rounded-lg border border-border p-3 ${drillable ? 'cursor-pointer hover:border-accent' : ''}`}
                                style={{ backgroundColor: `rgba(38, 166, 154, ${(c.pct / 100) * 0.85})` }}
                                title={`${c.explored}/${c.total} combinaciones exploradas`}
                            >
                                <div className="truncate font-mono text-xs font-semibold text-text-primary" title={labelFor(data.level, c)}>
                                    {labelFor(data.level, c)}
                                </div>
                                <div className="mt-1 flex items-baseline justify-between">
                                    <span className="font-mono text-lg font-bold text-text-primary">{c.pct}%</span>
                                    <span className="font-mono text-[10px] text-text-secondary">{c.explored}/{c.total}</span>
                                </div>
                                {data.explorable && c.pct < 100 && (
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); exploreZone(c); }}
                                        className="mt-2 w-full rounded border border-accent/60 bg-bg-surface/60 px-2 py-1 text-[11px] text-accent hover:bg-accent/10"
                                    >
                                        Explorar esta zona
                                    </button>
                                )}
                            </div>
                        );
                    })}
                    {data.cells.length === 0 && <p className="col-span-full text-sm text-text-secondary">Sin celdas para este nodo.</p>}
                </div>
            )}
            {loading && !data && <p className="text-sm text-text-secondary">Cargando mapa…</p>}

            {exploring && (
                <ProgressModal
                    title="Explorando esta zona…"
                    detail={`${exploring.current ?? 'Preparando…'}\n${exploring.cache_hits.toLocaleString()} de caché · ${exploring.cache_misses.toLocaleString()} calculadas · faltan ${fmtEta(exploring.eta_seconds)}`}
                    value={exploring.done}
                    max={exploring.total}
                    onCancel={cancel}
                    cancelLabel="Cancelar"
                />
            )}
        </AppLayout>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return <label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-text-secondary">{label}</span>{children}</label>;
}
