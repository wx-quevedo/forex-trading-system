import { Head, Link, router } from '@inertiajs/react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import AppLayout from '@/Layouts/AppLayout';
import SymbolCombobox from '@/Components/SymbolCombobox';
import ProgressModal from '@/Components/ProgressModal';
import SystemStatsCard from '@/Components/SystemStatsCard';
import InfoTooltip from '@/Components/InfoTooltip';
import { fmtMoney, fmtNumber } from '@/lib/format';
import { REGIME_META, matchVerdict, regimeLabel } from '@/lib/regime';

const AZAR_HELP = 'Al probar miles de combinaciones, algunas parecerán ganadoras por pura suerte. Fíate de la robustez y del out-of-sample, no del retorno más alto. El reporte ordena por robustez por defecto.';
const CAPITAL_HELP = 'Capital inicial del backtest. OJO: con capital bajo, el tamaño calculado por riesgo% cae al lote mínimo (0.01) y entonces 0.5/1/2% dan el MISMO resultado (no se distinguen). Usa un capital realista (p.ej. ≥ 2000) para que el riesgo% afecte de verdad.';
const RISK_HELP = 'Riesgo por operación: define el tamaño de la posición (mayor riesgo → posición mayor → PnL y drawdown mayores). Si el capital es bajo, el tamaño se topa en el lote mínimo (0.01) y el riesgo% deja de diferenciar.';
const INOUT_HELP = 'Retorno % del tramo. In-sample = tramo de entrenamiento (70%); Out-of-sample = tramo de validación que el barrido NO usó para elegir (30%). Lo bueno es que In y Out se PAREZCAN (consistencia). Si In es alto y Out bajo, la combinación está sobreajustada (overfit). La robustez mide justo esa consistencia.';
const ATR_HELP = 'SL/TP por volatilidad real (ATR). Fijo: SL/TP en pips constantes. ATR: SL=N×ATR y TP=M×ATR, así el stop se adapta a la volatilidad de cada momento (más ancho cuando el mercado se mueve más). El riesgo en $ se mantiene constante (el tamaño se ajusta a la distancia del stop). Útil donde los stops fijos saltan por retrocesos violentos (p.ej. el oro).';
import type { ExploreMeta, ExploreResultRow, ExploreStatus, SavedSearch, StrategySchemas } from '@/types';

const fmtEta = (s: number | null): string => {
    if (s == null) return '—';
    if (s < 60) return `${Math.round(s)}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${Math.round(s % 60)}s`;
};

interface Props {
    schemas: StrategySchemas;
    symbols: string[];
    timeframes: string[];
    types: string[];
    meta: ExploreMeta;
    context: { date_from: string; date_to: string; capital: number };
    savedSearches: SavedSearch[];
}

const VERDICT: Record<string, { label: string; cls: string }> = {
    inside: { label: 'DENTRO del rango', cls: 'bg-profit/15 text-profit' },
    edge: { label: 'límite', cls: 'bg-warning/15 text-warning' },
    outside: { label: 'FUERA del rango', cls: 'bg-loss/15 text-loss' },
};

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(4 - n);
const paramsLabel = (p: Record<string, number | string>) =>
    Object.entries(p).map(([k, v]) => `${k.replace(/_/g, ' ')}=${v}`).join(', ');

const _row_key = (r: ExploreResultRow) =>
    `${r.pair}|${r.type}|${r.timeframe}|${r.sl_pips}|${r.tp_pips}|${r.risk_percent}|${paramsLabel(r.params)}`;

type SortKey =
    | 'pair' | 'type' | 'timeframe' | 'sl_pips' | 'tp_pips' | 'risk_percent'
    | 'capital_final' | 'costs' | 'return_pct' | 'net_pnl' | 'win_rate'
    | 'profit_factor' | 'max_drawdown_pct' | 'sharpe' | 'sortino' | 'calmar' | 'expectancy'
    | 'total_trades' | 'in_return' | 'out_return' | 'robustness' | 'regime' | 'priority' | 'id';

// Fila con ID estable + métricas derivadas (Calmar/Expectativa R) del frontend.
type AugRow = ExploreResultRow & { id: number; calmar: number | null; expectancy: number | null };

const PRIORITY_HELP = 'Pauta de PRIORIZACIÓN para validar (0-100), NO un veredicto de rentabilidad. Combina todas las métricas normalizadas por riesgo (no premia el retorno absoluto) y penaliza la fragilidad (drawdown alto no-lineal, expectativa delgada, overfit, mismatch de régimen). "Prioridad #1" = valídala primero en walk-forward; la validación sigue siendo obligatoria. Clic en el número para ver el desglose.';

const SHARPE_HELP = 'Sharpe ratio (anualizado): retorno por unidad de volatilidad TOTAL de la equity. >1 bueno, >2 excelente. Penaliza la inestabilidad. "—" en filas ya cacheadas hasta re-explorar.';
const SORTINO_HELP = 'Sortino ratio (anualizado): como Sharpe pero solo penaliza la volatilidad a la BAJA (downside). Más justo para estrategias con subidas bruscas. "—" en filas cacheadas hasta re-explorar.';
const CALMAR_HELP = 'Calmar = retorno ANUALIZADO / |máximo drawdown|. Mide retorno por unidad de “dolor” máximo. >1 sólido. Se calcula sobre el periodo del contexto; vacío si DD=0 o cuenta quebrada.';
const EXPECTANCY_HELP = 'Expectativa en R = win% × (TP/SL) − (1−win%). Valor esperado por operación en múltiplos de riesgo. Puede ser POSITIVA con R/R<1 si el win rate es alto (p.ej. USDCAD SL50/TP40 al 60% → +0.08 R).';
const REGIME_HELP = 'Régimen de mercado del periodo analizado (común a todas las combinaciones de ese par/timeframe): TENDENCIA (alcista/bajista), RANGO o VOLÁTIL. Es contexto, no cambia los trades.';
const MATCH_HELP = 'Idoneidad estrategia↔régimen. Reversión (RSI, Bollinger) encaja en RANGO; tendencia (MA cross, MACD) encaja en TENDENCIA. Un MISMATCH explica por qué una estrategia "buena" falló (p.ej. reversión sobre el oro en tendencia).';

export default function Explorer({ schemas, symbols, timeframes, types, meta, context, savedSearches }: Props) {
    // --- Selección del usuario ---
    const [pairs, setPairs] = useState<string[]>([]);
    const [selTypes, setSelTypes] = useState<string[]>(types);
    const sweepTfs = useMemo(() => meta.sweep_timeframes.filter((t) => timeframes.includes(t)), [meta.sweep_timeframes, timeframes]);
    const [selTfs, setSelTfs] = useState<string[]>(sweepTfs);
    const [sls, setSls] = useState<number[]>(meta.sl_choices);
    const [tps, setTps] = useState<number[]>(meta.tp_choices);
    const [risks, setRisks] = useState<number[]>(meta.risk_choices);
    // Modo SL/TP (Fase 1): fijo (pips) o adaptativo por ATR (multiplicadores).
    const [slMode, setSlMode] = useState<'fixed' | 'atr'>('fixed');
    const [atrPeriod, setAtrPeriod] = useState<number>(meta.atr_period_default || 14);
    const slChoices = slMode === 'atr' ? meta.atr_sl_choices : meta.sl_choices;
    const tpChoices = slMode === 'atr' ? meta.atr_tp_choices : meta.tp_choices;
    const changeMode = (m: 'fixed' | 'atr') => {
        setSlMode(m);
        setSls(m === 'atr' ? meta.atr_sl_choices : meta.sl_choices);
        setTps(m === 'atr' ? meta.atr_tp_choices : meta.tp_choices);
    };
    // Periodo y capital vienen de la MARCA GLOBAL (Ajustes › Contexto): fijos aquí.
    const period = { date_from: context.date_from, date_to: context.date_to };
    const capital = context.capital;
    const [workers, setWorkers] = useState<number>(meta.default_workers || 4);

    // --- Estado de la búsqueda ---
    const [status, setStatus] = useState<ExploreStatus | null>(null);
    const [results, setResults] = useState<ExploreResultRow[]>([]);
    const [error, setError] = useState<string | null>(null);
    const pollRef = useRef<number | null>(null);

    // --- Reporte: filtros, orden, guardar ---
    // Por defecto se ven TODAS las combinaciones probadas (incl. FUERA del rango),
    // ordenadas por robustez. El filtro "solo DENTRO" es opcional, no el default.
    const [fVerdict, setFVerdict] = useState<'all' | 'inside' | 'edge' | 'outside'>('all');
    const [fPair, setFPair] = useState('all');
    const [fType, setFType] = useState('all');
    const [fMatch, setFMatch] = useState<'all' | 'MATCH' | 'MISMATCH'>('all');
    const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'priority', dir: 'desc' });
    const [saveRow, setSaveRow] = useState<ExploreResultRow | null>(null);
    const [scoreRow, setScoreRow] = useState<AugRow | null>(null);
    const [favAdded, setFavAdded] = useState<Set<string>>(new Set());
    const [pageSize, setPageSize] = useState(50);
    const [page, setPage] = useState(1);

    // --- Búsquedas guardadas (Parte 2) ---
    const [saved, setSaved] = useState<SavedSearch[]>(savedSearches);
    const [savedName, setSavedName] = useState('');

    const running = status?.status === 'running';

    // Estimación de combinaciones (cliente, con los grids del bridge).
    const gridSum = useMemo(() => selTypes.reduce((a, t) => a + (meta.grid_sizes[t] ?? 0), 0), [selTypes, meta.grid_sizes]);
    const configs = pairs.length * selTfs.length * sls.length * tps.length * risks.length * gridSum;
    const overLimit = configs > meta.max_configs;       // tope absoluto: bloquea
    const needsConfirm = configs > meta.warn_configs;   // grande: pide confirmación
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
        // Tope flexible: por encima del umbral de aviso se confirma, no se bloquea.
        if (needsConfirm && !window.confirm(
            `Esto evaluará ~${configs.toLocaleString()} configuraciones (~${(configs * 3).toLocaleString()} backtests).\n\n` +
            `Con caché previo puede ser rápido, pero una búsqueda nueva de este tamaño puede tardar y mantener la CPU alta.\n\n¿Continuar?`,
        )) return;
        setError(null);
        setResults([]);
        try {
            const { data } = await window.axios.post('/explorer/start', {
                pairs, types: selTypes, timeframes: selTfs,
                date_from: period.date_from, date_to: period.date_to, capital,
                sl_choices: sls, tp_choices: tps, risk_choices: risks, workers,
                sl_mode: slMode, atr_period: atrPeriod,
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

    // Días del periodo del contexto (para anualizar Calmar).
    const periodDays = useMemo(
        () => Math.max(1, Math.round((+new Date(context.date_to) - +new Date(context.date_from)) / 86400000)),
        [context.date_from, context.date_to],
    );

    // Aumenta cada fila con Calmar y Expectativa R DERIVADAS (presentes incluso en
    // filas cacheadas que no las traen del motor). Sharpe/Sortino vienen del motor.
    const view = useMemo(() => {
        const aug = (r: ExploreResultRow, i: number): AugRow => {
            const dd = Math.abs(r.max_drawdown_pct);
            const calmar = (r.blown || dd === 0) ? null : (r.return_pct * 365 / periodDays) / dd;
            const expectancy = r.expectancy_r ?? (r.sl_pips > 0 ? r.win_rate * (r.tp_pips / r.sl_pips) - (1 - r.win_rate) : null);
            // ID estable por corrida: orden de cómputo (results es append-only durante la corrida).
            return { ...r, id: i + 1, calmar, expectancy };
        };
        let rows = results.map(aug);
        if (fVerdict !== 'all') rows = rows.filter((r) => r.verdict === fVerdict);
        if (fPair !== 'all') rows = rows.filter((r) => r.pair === fPair);
        if (fType !== 'all') rows = rows.filter((r) => r.type === fType);
        if (fMatch !== 'all') rows = rows.filter((r) => matchVerdict(r.type, r.regime).verdict === fMatch);
        const { key, dir } = sort;
        const num = (v: number | null | undefined) => (v == null ? -Infinity : v);
        return [...rows].sort((a, b) => {
            const av = a[key]; const bv = b[key];
            let cmp: number;
            if (typeof av === 'string' || typeof bv === 'string') cmp = String(av).localeCompare(String(bv));
            else cmp = num(av as number) - num(bv as number);
            return dir === 'asc' ? cmp : -cmp;
        });
    }, [results, fVerdict, fPair, fType, fMatch, sort, periodDays]);

    // Paginación: opera sobre el conjunto YA filtrado y ordenado (view).
    const pageCount = Math.max(1, Math.ceil(view.length / pageSize));
    const safePage = Math.min(page, pageCount);
    const pageStart = (safePage - 1) * pageSize;
    const pageRows = view.slice(pageStart, pageStart + pageSize);
    useEffect(() => { setPage(1); }, [fVerdict, fPair, fType, fMatch, sort, pageSize, results]);

    const toggleSort = (key: SortKey) =>
        setSort((p) => (p.key === key ? { key, dir: p.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));

    // Añade una combinación a Favoritos (con el contexto = backtest de referencia).
    const addFavorite = async (r: AugRow) => {
        try {
            await window.axios.post('/favorites', {
                name: `${schemas[r.type]?.label ?? r.type} ${r.pair} ${r.timeframe}`,
                source: 'explorer',
                pair: r.pair, type: r.type, timeframe: r.timeframe, params: r.params,
                sl_pips: r.sl_pips, tp_pips: r.tp_pips, risk_percent: r.risk_percent, capital,
                sl_mode: r.sl_mode ?? slMode, atr_period: atrPeriod,
                backtest_from: context.date_from, backtest_to: context.date_to,
                backtest_metrics: {
                    return_pct: r.return_pct, net_pnl: r.net_pnl, win_rate: r.win_rate,
                    profit_factor: r.profit_factor, max_drawdown_pct: r.max_drawdown_pct,
                    total_trades: r.total_trades, total_costs: r.costs, final_balance: r.capital_final,
                    sharpe: r.sharpe ?? null, sortino: r.sortino ?? null, calmar: r.calmar ?? null,
                },
                regime: r.regime ?? null, regime_confidence: r.regime_confidence ?? null,
            });
            setFavAdded((prev) => new Set(prev).add(_row_key(r)));
        } catch {
            setError('No se pudo añadir a favoritos.');
        }
    };

    // Abre el Laboratorio con la combinación precargada en una PESTAÑA NUEVA
    // (combo en la URL), para no perder el reporte del Explorador.
    const loadToLab = (r: ExploreResultRow) => {
        const combo = {
            type: r.type, pair: r.pair, timeframe: r.timeframe, indicators: r.params,
            risk: { sl_pips: r.sl_pips, tp_pips: r.tp_pips, risk_percent: r.risk_percent },
            capital, period,
        };
        window.open(`/laboratory?combo=${encodeURIComponent(JSON.stringify(combo))}`, '_blank', 'noopener');
    };

    const exportCsv = () => {
        const cols: [string, (r: AugRow) => string | number][] = [
            ['ID', (r) => r.id], ['Prioridad', (r) => r.priority ?? ''],
            ['Par', (r) => r.pair], ['Tipo', (r) => r.type], ['Timeframe', (r) => r.timeframe],
            ['Parametros', (r) => paramsLabel(r.params)], ['SL', (r) => r.sl_pips], ['TP', (r) => r.tp_pips],
            ['Riesgo%', (r) => r.risk_percent], ['CapitalFinal', (r) => r.capital_final], ['Costos', (r) => r.costs],
            ['RetornoNeto%', (r) => r.return_pct], ['PnLNeto', (r) => r.net_pnl], ['WinRate%', (r) => (r.win_rate * 100).toFixed(1)],
            ['ProfitFactor', (r) => r.profit_factor ?? ''], ['MaxDD%', (r) => r.max_drawdown_pct],
            ['Sharpe', (r) => r.sharpe ?? ''], ['Sortino', (r) => r.sortino ?? ''],
            ['Calmar', (r) => (r.calmar != null ? r.calmar.toFixed(2) : '')], ['ExpectativaR', (r) => (r.expectancy != null ? r.expectancy.toFixed(3) : '')],
            ['Trades', (r) => r.total_trades],
            ['InSample%', (r) => r.in_return], ['OutSample%', (r) => r.out_return], ['Robustez', (r) => r.robustness],
            ['Regimen', (r) => regimeLabel(r.regime)], ['Idoneidad', (r) => matchVerdict(r.type, r.regime).label],
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

    // --- Búsquedas guardadas (Parte 2) ---
    const saveSearch = async () => {
        const name = savedName.trim() || `Búsqueda ${new Date().toLocaleString()}`;
        try {
            const { data } = await window.axios.post('/explorer/searches', {
                name,
                config: { pairs, types: selTypes, timeframes: selTfs, period, capital, sls, tps, risks },
                results,
                total: results.length,
                inside: results.filter((r) => r.verdict === 'inside').length,
            });
            setSaved((prev) => [data as SavedSearch, ...prev]);
            setSavedName('');
        } catch {
            setError('No se pudo guardar la búsqueda.');
        }
    };

    const openSaved = async (id: number) => {
        try {
            const { data } = await window.axios.get(`/explorer/searches/${id}`);
            stopPoll();
            setStatus(null);
            setResults((data.results ?? []) as ExploreResultRow[]);
            const c = data.config ?? {};
            if (Array.isArray(c.pairs)) setPairs(c.pairs);
            if (Array.isArray(c.types)) setSelTypes(c.types);
            if (Array.isArray(c.timeframes)) setSelTfs(c.timeframes);
            // Periodo y capital son la marca global fija → no se sobrescriben al reabrir.
            if (Array.isArray(c.sls)) setSls(c.sls);
            if (Array.isArray(c.tps)) setTps(c.tps);
            if (Array.isArray(c.risks)) setRisks(c.risks);
        } catch {
            setError('No se pudo abrir la búsqueda guardada.');
        }
    };

    const deleteSaved = async (id: number) => {
        if (!window.confirm('¿Borrar esta búsqueda guardada?')) return;
        try {
            await window.axios.delete(`/explorer/searches/${id}`);
            setSaved((prev) => prev.filter((s) => s.id !== id));
        } catch { /* noop */ }
    };

    return (
        <AppLayout title="Explorador de estrategias" wide>
            <Head title="Explorador" />

            <div className="mb-4"><SystemStatsCard /></div>

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

                    {/* Contexto global (fijo) + workers */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <ContextBanner context={context} />
                        <Field label={`Núcleos (máx ${meta.cpu_count})`}><input type="number" min={1} max={meta.cpu_count} value={workers} onChange={(e) => setWorkers(Math.max(1, Math.min(meta.cpu_count, Number(e.target.value))))} className="input font-mono" /></Field>
                    </div>
                </div>

                {/* Modo SL/TP: fijo (pips) o adaptativo por ATR (Fase 1) */}
                <div className="flex flex-wrap items-center gap-3">
                    <SectionLabel>Modo SL/TP <InfoTooltip text={ATR_HELP} /></SectionLabel>
                    <div className="flex gap-1.5">
                        {(['fixed', 'atr'] as const).map((m) => (
                            <button key={m} type="button" onClick={() => changeMode(m)}
                                className={`rounded-md border px-3 py-1 text-xs ${slMode === m ? 'border-accent bg-accent/15 text-text-primary' : 'border-border text-text-secondary hover:text-text-primary'}`}>
                                {m === 'fixed' ? 'Fijo (pips)' : 'ATR (volatilidad)'}
                            </button>
                        ))}
                    </div>
                    {slMode === 'atr' && (
                        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                            Periodo ATR
                            <input type="number" min={2} max={200} value={atrPeriod} onChange={(e) => setAtrPeriod(Math.max(2, Number(e.target.value)))} className="w-20 rounded-md border border-border bg-bg-elevated px-2 py-1 font-mono text-xs text-text-primary" />
                        </label>
                    )}
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div><SectionLabel>{slMode === 'atr' ? 'SL (×ATR)' : 'SL (pips)'}</SectionLabel><ChipToggle options={slChoices.map((v) => ({ value: v, label: String(v) }))} selected={sls} onToggle={(v) => toggle(sls, setSls, v as number)} /></div>
                    <div><SectionLabel>{slMode === 'atr' ? 'TP (×ATR)' : 'TP (pips)'}</SectionLabel><ChipToggle options={tpChoices.map((v) => ({ value: v, label: String(v) }))} selected={tps} onToggle={(v) => toggle(tps, setTps, v as number)} /></div>
                    <div><SectionLabel>Riesgo % <InfoTooltip text={RISK_HELP} /></SectionLabel><ChipToggle options={meta.risk_choices.map((v) => ({ value: v, label: String(v) }))} selected={risks} onToggle={(v) => toggle(risks, setRisks, v as number)} /></div>
                </div>

                {/* Estimación + acción */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                    <div className="text-sm">
                        <span className="text-text-secondary">Estimación: </span>
                        <span className={`font-mono font-semibold ${overLimit ? 'text-loss' : 'text-text-primary'}`}>{configs.toLocaleString()}</span>
                        <span className="text-text-secondary"> configuraciones (~{(configs * 3).toLocaleString()} backtests).</span>
                        {overLimit && <span className="ml-2 text-loss">Supera el máximo de {meta.max_configs.toLocaleString()} — acota la selección.</span>}
                        {needsConfirm && !overLimit && <span className="ml-2 text-warning">Es grande; se pedirá confirmación (con caché puede ir rápido).</span>}
                        <span className="ml-2 text-text-secondary">Caché: {meta.cache.entries.toLocaleString()} resultados ({meta.cache.size_mb} MB).</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
                            Cuidado con el azar <InfoTooltip text={AZAR_HELP} />
                        </span>
                        <button type="button" onClick={search} disabled={!canSearch} className="rounded-md bg-accent px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                            {running ? 'Buscando…' : 'Buscar'}
                        </button>
                    </div>
                </div>
                {error && <div className="rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">{error}</div>}
            </section>

            {/* --- Búsquedas guardadas --- */}
            {saved.length > 0 && (
                <section className="mt-4 rounded-lg border border-border bg-bg-surface p-3">
                    <h2 className="mb-2 text-sm font-semibold">Búsquedas guardadas</h2>
                    <div className="flex flex-col gap-1.5">
                        {saved.map((s) => (
                            <div key={s.id} className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-1.5">
                                <div className="min-w-0 text-sm">
                                    <span className="text-text-primary">{s.name}</span>
                                    <span className="ml-2 font-mono text-[11px] text-text-secondary">
                                        {s.total.toLocaleString()} combos · <span className="text-profit">{s.inside} DENTRO</span> · {new Date(s.created_at).toLocaleString()}
                                    </span>
                                </div>
                                <div className="flex shrink-0 gap-1">
                                    <button type="button" onClick={() => openSaved(s.id)} className="rounded border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10">Reabrir</button>
                                    <button type="button" onClick={() => deleteSaved(s.id)} className="rounded border border-loss/50 px-2 py-1 text-[11px] text-loss hover:bg-loss/10">Borrar</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* --- Reporte --- */}
            {results.length > 0 && (
                <section className="mt-5 rounded-lg border border-border bg-bg-surface">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
                        <div className="text-sm text-text-secondary">
                            <div>
                                <span className="font-semibold text-text-primary">{results.length.toLocaleString()}</span> configuraciones probadas ·
                                <span className="font-semibold text-profit"> {results.filter((r) => r.verdict === 'inside').length}</span> DENTRO del rango ·
                                mostrando <span className="font-semibold text-text-primary">{view.length.toLocaleString()}</span>
                            </div>
                            {status && status.elapsed_seconds > 0 && (
                                <div className="mt-0.5 font-mono text-[11px]">
                                    {status.elapsed_seconds}s · {status.speed_per_sec}/s · {status.workers} núcleos ·
                                    <span className="text-profit"> {status.cache_hits.toLocaleString()} de caché</span> · {status.cache_misses.toLocaleString()} calculadas ·
                                    MT5 {status.t_mt5_seconds}s vs cálculo {status.t_compute_seconds}s · {status.candle_fetches} descargas
                                </div>
                            )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <FilterSelect label="Veredicto" value={fVerdict} onChange={(v) => setFVerdict(v as typeof fVerdict)} options={[['all', 'Todos'], ['inside', 'DENTRO'], ['edge', 'Límite'], ['outside', 'FUERA']]} />
                            <FilterSelect label="Par" value={fPair} onChange={setFPair} options={[['all', 'Todos'], ...uniquePairs.map((p) => [p, p] as [string, string])]} />
                            <FilterSelect label="Tipo" value={fType} onChange={setFType} options={[['all', 'Todos'], ...uniqueTypes.map((t) => [t, schemas[t]?.label ?? t] as [string, string])]} />
                            <FilterSelect label="Idoneidad" value={fMatch} onChange={(v) => setFMatch(v as typeof fMatch)} options={[['all', 'Todas'], ['MATCH', 'Solo MATCH'], ['MISMATCH', 'Solo MISMATCH']]} />
                            <input value={savedName} onChange={(e) => setSavedName(e.target.value)} placeholder="Nombre…"
                                className="w-36 rounded-md border border-border bg-bg-elevated px-2 py-1.5 text-sm text-text-primary" />
                            <button type="button" onClick={saveSearch} className="rounded-md border border-accent px-3 py-1.5 text-sm text-accent hover:bg-accent/10">Guardar esta búsqueda</button>
                            <button type="button" onClick={exportCsv} className="rounded-md border border-border px-3 py-1.5 text-sm text-text-primary hover:bg-bg-elevated">Exportar CSV</button>
                        </div>
                    </div>

                    {results.every((r) => r.verdict !== 'inside') && (
                        <div className="border-b border-border bg-bg-elevated/50 px-3 py-2.5 text-xs text-text-secondary">
                            Ninguna combinación resultó robusta (DENTRO del rango) en esta búsqueda. Se muestran todas las probadas, ordenadas por
                            robustez. Esto suele significar que este par/timeframe/periodo no ofrece una ventaja estable con estos parámetros —
                            prueba otro par, timeframe o tipo de estrategia.
                        </div>
                    )}

                    <div className="max-h-[60vh] overflow-auto">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-bg-elevated">
                                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
                                    <Th k="id" label="#" right s={sort} on={toggleSort} />
                                    <Th k="priority" label="Prioridad" right s={sort} on={toggleSort} help={PRIORITY_HELP} />
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
                                    <Th k="sharpe" label="Sharpe" right s={sort} on={toggleSort} help={SHARPE_HELP} />
                                    <Th k="sortino" label="Sortino" right s={sort} on={toggleSort} help={SORTINO_HELP} />
                                    <Th k="calmar" label="Calmar" right s={sort} on={toggleSort} help={CALMAR_HELP} />
                                    <Th k="expectancy" label="Exp. R" right s={sort} on={toggleSort} help={EXPECTANCY_HELP} />
                                    <Th k="total_trades" label="Ops" right s={sort} on={toggleSort} />
                                    <Th k="in_return" label="Ret. In" right s={sort} on={toggleSort} help={INOUT_HELP} />
                                    <Th k="out_return" label="Ret. Out" right s={sort} on={toggleSort} help={INOUT_HELP} />
                                    <Th k="robustness" label="Robustez" s={sort} on={toggleSort} />
                                    <Th k="regime" label="Régimen" s={sort} on={toggleSort} help={REGIME_HELP} />
                                    <th className="px-3 py-2 font-medium"><span className="inline-flex items-center gap-1">Idoneidad<InfoTooltip text={MATCH_HELP} /></span></th>
                                    <th className="px-3 py-2 font-medium">Veredicto</th>
                                    <th className="px-3 py-2" />
                                </tr>
                            </thead>
                            <tbody>
                                {pageRows.map((r, i) => {
                                    const v = VERDICT[r.verdict];
                                    const tone = r.verdict === 'inside' ? 'bg-profit/[0.04]' : r.verdict === 'outside' ? 'opacity-70' : '';
                                    const pColor = r.priority == null ? 'text-text-secondary' : r.priority >= 65 ? 'text-profit' : r.priority >= 40 ? 'text-warning' : 'text-loss';
                                    return (
                                        <tr key={r.id} className={`border-b border-border/40 last:border-0 ${tone}`}>
                                            <td className="px-3 py-1.5 text-right font-mono text-xs text-text-secondary">{r.id}</td>
                                            <td className="px-3 py-1.5 text-right">
                                                {r.priority != null
                                                    ? <button type="button" onClick={() => setScoreRow(r)} className={`font-mono text-xs font-bold ${pColor} hover:underline`} title="Ver desglose del score">{r.priority}</button>
                                                    : <span className="font-mono text-xs text-text-secondary">—</span>}
                                            </td>
                                            <td className="px-3 py-1.5 font-mono text-xs text-text-primary">{r.pair}</td>
                                            <td className="px-3 py-1.5 text-xs text-text-secondary">{schemas[r.type]?.label ?? r.type}</td>
                                            <td className="px-3 py-1.5 font-mono text-xs">{r.timeframe}</td>
                                            <td className="px-3 py-1.5 font-mono text-[11px] text-text-secondary" title={paramsLabel(r.params)}>{paramsLabel(r.params)}</td>
                                            <td className="px-3 py-1.5 text-right font-mono text-xs">{r.sl_pips}</td>
                                            <td className="px-3 py-1.5 text-right font-mono text-xs">{r.tp_pips}</td>
                                            <td className="px-3 py-1.5 text-right font-mono text-xs">{r.risk_percent}</td>
                                            <td className={`px-3 py-1.5 text-right font-mono text-xs ${r.blown ? 'text-loss' : ''}`}>{fmtMoney(r.capital_final)}</td>
                                            <td className="px-3 py-1.5 text-right font-mono text-xs text-warning">{fmtMoney(r.costs)}</td>
                                            <td className={`px-3 py-1.5 text-right font-mono text-xs ${r.return_pct >= 0 ? 'text-profit' : 'text-loss'}`}>{r.return_pct >= 0 ? '+' : ''}{r.return_pct}%</td>
                                            <td className={`px-3 py-1.5 text-right font-mono text-xs ${r.net_pnl >= 0 ? 'text-profit' : 'text-loss'}`}>{fmtMoney(r.net_pnl)}</td>
                                            <td className="px-3 py-1.5 text-right font-mono text-xs">{(r.win_rate * 100).toFixed(1)}%</td>
                                            <td className="px-3 py-1.5 text-right font-mono text-xs">{r.profit_factor != null ? fmtNumber(r.profit_factor) : '—'}</td>
                                            <td className="px-3 py-1.5 text-right font-mono text-xs text-loss">{r.max_drawdown_pct}%</td>
                                            <td className="px-3 py-1.5 text-right font-mono text-xs">{r.sharpe != null ? fmtNumber(r.sharpe) : '—'}</td>
                                            <td className="px-3 py-1.5 text-right font-mono text-xs">{r.sortino != null ? fmtNumber(r.sortino) : '—'}</td>
                                            <td className="px-3 py-1.5 text-right font-mono text-xs">{r.calmar != null ? r.calmar.toFixed(2) : '—'}</td>
                                            <td className={`px-3 py-1.5 text-right font-mono text-xs ${r.expectancy == null ? '' : r.expectancy >= 0 ? 'text-profit' : 'text-loss'}`}>{r.expectancy != null ? `${r.expectancy >= 0 ? '+' : ''}${r.expectancy.toFixed(2)}` : '—'}</td>
                                            <td className="px-3 py-1.5 text-right font-mono text-xs text-text-secondary">{r.total_trades}</td>
                                            <td className={`px-3 py-1.5 text-right font-mono text-xs ${r.in_return >= 0 ? 'text-profit' : 'text-loss'}`}>{r.in_return}%</td>
                                            <td className={`px-3 py-1.5 text-right font-mono text-xs ${r.out_return >= 0 ? 'text-profit' : 'text-loss'}`}>{r.out_return}%</td>
                                            <td className="px-3 py-1.5 font-mono text-xs text-warning" title={`robustez ${r.robustness}`}>{stars(r.stars)}</td>
                                            <td className="px-3 py-1.5">
                                                {r.regime
                                                    ? <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${REGIME_META[r.regime].badge}`} title={`${REGIME_META[r.regime].help}${r.regime_confidence != null ? ` (confianza ${(r.regime_confidence * 100).toFixed(0)}%)` : ''}`}>{REGIME_META[r.regime].label}</span>
                                                    : <span className="text-[10px] text-text-secondary">—</span>}
                                            </td>
                                            <td className="px-3 py-1.5">
                                                {(() => { const m = matchVerdict(r.type, r.regime); return m.verdict
                                                    ? <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${m.badge}`} title={m.help}>{m.label}</span>
                                                    : <span className="text-[10px] text-text-secondary">—</span>; })()}
                                            </td>
                                            <td className="px-3 py-1.5">
                                                {r.blown
                                                    ? <span className="rounded bg-loss/20 px-1.5 py-0.5 text-[10px] font-semibold text-loss" title="La cuenta perdió todo el capital (quiebra). No es operable.">Cuenta quebrada</span>
                                                    : <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${v.cls}`} title={r.verdict_label}>{v.label}</span>}
                                            </td>
                                            <td className="px-3 py-1.5">
                                                <div className="flex items-center gap-1">
                                                    <button type="button" onClick={() => addFavorite(r)} className={`rounded border px-1.5 py-1 text-[13px] leading-none ${favAdded.has(_row_key(r)) ? 'border-warning text-warning' : 'border-border text-text-secondary hover:text-warning'}`} title="Añadir a favoritos">
                                                        {favAdded.has(_row_key(r)) ? '★' : '☆'}
                                                    </button>
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

                    {/* Paginación clásica sobre el conjunto filtrado + ordenado */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-3 text-xs text-text-secondary">
                        <div>
                            mostrando <span className="font-mono text-text-primary">{view.length === 0 ? 0 : pageStart + 1}–{Math.min(pageStart + pageSize, view.length)}</span> de{' '}
                            <span className="font-mono text-text-primary">{view.length.toLocaleString()}</span>
                            <label className="ml-3">
                                Filas/pág
                                <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="ml-1.5 rounded-md border border-border bg-bg-elevated px-2 py-1 text-xs text-text-primary">
                                    {[50, 100, 200, 500].map((n) => <option key={n} value={n}>{n}</option>)}
                                </select>
                            </label>
                        </div>
                        <div className="flex items-center gap-1">
                            <PageBtn onClick={() => setPage(1)} disabled={safePage <= 1}>«</PageBtn>
                            <PageBtn onClick={() => setPage(safePage - 1)} disabled={safePage <= 1}>‹</PageBtn>
                            <span className="px-2 font-mono text-text-primary">{safePage} / {pageCount}</span>
                            <PageBtn onClick={() => setPage(safePage + 1)} disabled={safePage >= pageCount}>›</PageBtn>
                            <PageBtn onClick={() => setPage(pageCount)} disabled={safePage >= pageCount}>»</PageBtn>
                        </div>
                    </div>
                </section>
            )}

            {status && status.status !== 'running' && results.length === 0 && status.total > 0 && (
                <div className="mt-5 text-center text-sm text-text-secondary">
                    {status.status === 'cancelled' ? 'Búsqueda cancelada.'
                        : status.status === 'error' ? `Error: ${status.error}`
                        : status.skipped && status.skipped.length > 0
                            ? 'No hay resultados: ningún (par · timeframe) tenía velas suficientes en este rango.'
                            : 'No se evaluó ninguna combinación en el periodo.'}
                </div>
            )}

            {/* Aviso de grupos saltados por falta de velas (B5): motivo claro por par/tf */}
            {status && status.skipped && status.skipped.length > 0 && (
                <div className="mt-3 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-text-secondary">
                    <div className="mb-1 font-semibold text-warning">Grupos sin datos suficientes ({status.skipped.length}):</div>
                    {status.skipped.slice(0, 12).map((s, i) => (
                        <div key={i} className="font-mono">{s.pair} · {s.timeframe} — {s.candles} velas. {s.reason}</div>
                    ))}
                    {status.skipped.length > 12 && <div>… y {status.skipped.length - 12} más.</div>}
                </div>
            )}

            {/* Modal de progreso real, cancelable, con velocidad y ETA */}
            {running && status && (
                <ProgressModal
                    title="Buscando estrategias…"
                    detail={`${status.current ?? 'Preparando…'}\n${status.workers} núcleos · ${status.speed_per_sec}/s (${status.speed_per_min}/min) · faltan ${fmtEta(status.eta_seconds)} · ${status.elapsed_seconds}s transcurridos`}
                    value={status.done}
                    max={status.total}
                    onCancel={cancel}
                    cancelLabel="Cancelar búsqueda"
                />
            )}

            {/* Modal: guardar una combinación como estrategia */}
            {saveRow && <SaveModal row={saveRow} schemas={schemas} onClose={() => setSaveRow(null)} />}
            {scoreRow && <ScoreModal row={scoreRow} schemas={schemas} onClose={() => setScoreRow(null)} />}
        </AppLayout>
    );
}

// --- Sub-componentes -------------------------------------------------------
function toggle<T>(arr: T[], set: (v: T[]) => void, v: T) {
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
}

function PageBtn({ onClick, disabled, children }: { onClick: () => void; disabled: boolean; children: React.ReactNode }) {
    return (
        <button type="button" onClick={onClick} disabled={disabled}
            className="rounded-md border border-border px-2.5 py-1 font-mono text-text-primary hover:bg-bg-elevated disabled:opacity-40">
            {children}
        </button>
    );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">{children}</div>;
}

function ContextBanner({ context }: { context: { date_from: string; date_to: string; capital: number } }) {
    return (
        <div className="rounded-md border border-border bg-bg-elevated px-3 py-2">
            <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-text-secondary">
                    Contexto (fijo) <InfoTooltip text={CAPITAL_HELP} />
                </span>
                <Link href="/settings/analysis-context" className="text-[11px] text-accent hover:underline">Editar contexto</Link>
            </div>
            <div className="mt-0.5 font-mono text-sm text-text-primary">
                {context.date_from} → {context.date_to} · ${Number(context.capital).toLocaleString()}
            </div>
        </div>
    );
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wide text-text-secondary">
                {label}{help && <InfoTooltip text={help} />}
            </span>
            {children}
        </label>
    );
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

function Th({ k, label, right, s, on, help }: { k: SortKey; label: string; right?: boolean; s: { key: SortKey; dir: 'asc' | 'desc' }; on: (k: SortKey) => void; help?: string }) {
    return (
        <th className={`px-3 py-2 font-medium ${right ? 'text-right' : ''}`}>
            <span className={`inline-flex items-center gap-1 ${right ? 'flex-row-reverse' : ''}`}>
                <button type="button" onClick={() => on(k)} className={`inline-flex items-center gap-1 hover:text-text-primary ${right ? 'flex-row-reverse' : ''}`}>
                    {label}
                    <span className="text-[8px] leading-none text-accent">{s.key === k ? (s.dir === 'asc' ? '▲' : '▼') : ''}</span>
                </button>
                {help && <InfoTooltip text={help} />}
            </span>
        </th>
    );
}

function ScoreModal({ row, schemas, onClose }: { row: AugRow; schemas: StrategySchemas; onClose: () => void }) {
    const bd = row.priority_breakdown;
    const color = row.priority == null ? 'text-text-secondary' : row.priority >= 65 ? 'text-profit' : row.priority >= 40 ? 'text-warning' : 'text-loss';
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
            <div onClick={(e) => e.stopPropagation()} className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-lg border border-border bg-bg-surface p-5 shadow-2xl">
                <div className="mb-1 flex items-baseline justify-between">
                    <h2 className="text-sm font-semibold">Estrategia #{row.id} — {schemas[row.type]?.label ?? row.type} {row.pair} {row.timeframe}</h2>
                    <span className={`font-mono text-lg font-bold ${color}`}>{row.priority ?? '—'}/100</span>
                </div>
                <p className="mb-3 font-mono text-[11px] text-text-secondary">{paramsLabel(row.params)} · SL{row.sl_pips}/TP{row.tp_pips} · {row.risk_percent}%</p>

                {bd && (
                    <>
                        <div className="mb-2">
                            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-profit">Sumaron</div>
                            {bd.add.length === 0 ? <div className="text-xs text-text-secondary">—</div> : bd.add.map((f, i) => (
                                <div key={i} className="flex justify-between text-xs"><span className="text-text-secondary">{f.label} <span className="text-text-secondary/70">({f.detail})</span></span><span className="font-mono text-profit">+{f.points}</span></div>
                            ))}
                        </div>
                        <div className="mb-3">
                            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-loss">Restaron</div>
                            {bd.sub.length === 0 ? <div className="text-xs text-text-secondary">—</div> : bd.sub.map((f, i) => (
                                <div key={i} className="flex justify-between text-xs"><span className="text-text-secondary">{f.label} <span className="text-text-secondary/70">({f.detail})</span></span><span className="font-mono text-loss">−{f.points}</span></div>
                            ))}
                        </div>
                    </>
                )}
                {row.priority_verdict && <div className="mb-3 rounded-md border border-border bg-bg-elevated p-2.5 text-xs text-text-primary">{row.priority_verdict}</div>}
                <p className="mb-3 text-[11px] text-text-secondary">La Prioridad es una pauta para decidir QUÉ validar primero, no un veredicto de rentabilidad. Valida siempre en walk-forward (Bot Histórico) antes de operar.</p>
                <button type="button" onClick={onClose} className="w-full rounded-md border border-border px-3 py-2 text-sm text-text-primary hover:bg-bg-elevated">Cerrar</button>
            </div>
        </div>
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
