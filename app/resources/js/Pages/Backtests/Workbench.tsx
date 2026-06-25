import { Head, Link, router } from '@inertiajs/react';
import { useMemo, useState, type FormEvent } from 'react';
import {
    AreaChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import AppLayout from '@/Layouts/AppLayout';
import RunComparison from '@/Components/RunComparison';
import TradesTable from '@/Components/TradesTable';
import BacktestChart from '@/Components/BacktestChart';
import OptimizationPanel from '@/Components/OptimizationPanel';
import { fmtMoney } from '@/lib/format';
import type {
    AiAnalysis, Backtest, Candle, SchemaField, Strategy, StrategySchemas, WorkbenchRun,
} from '@/types';

interface Props {
    backtest: Backtest;
    strategy: Strategy;
    schemas: StrategySchemas;
    timeframes: string[];
    candles: Candle[];
    aiConfigured: boolean;
    manualPrompt: string;
}

const RISK_FIELDS: { key: string; label: string }[] = [
    { key: 'sl_pips', label: 'SL (pips)' },
    { key: 'tp_pips', label: 'TP (pips)' },
    { key: 'risk_percent', label: 'Riesgo %' },
];

function emptyRun(b: Backtest): WorkbenchRun {
    return { metrics: b.result_metrics, trades: b.result_trades ?? [], equity: b.result_equity_curve ?? [] };
}

export default function Workbench({ backtest, strategy, schemas, timeframes, candles, aiConfigured, manualPrompt }: Props) {
    const type = strategy.parameters.type;
    const fields: SchemaField[] = schemas[type]?.fields ?? [];

    const [indicators, setIndicators] = useState<Record<string, number | string>>(strategy.parameters.indicators ?? {});
    const [risk, setRisk] = useState<Record<string, number>>({
        sl_pips: Number(strategy.parameters.risk?.sl_pips ?? 20),
        tp_pips: Number(strategy.parameters.risk?.tp_pips ?? 40),
        risk_percent: Number(strategy.parameters.risk?.risk_percent ?? 1),
    });
    const [period, setPeriod] = useState({ date_from: backtest.date_from.slice(0, 10), date_to: backtest.date_to.slice(0, 10) });

    const init = emptyRun(backtest);
    const [runs, setRuns] = useState<{ initial: WorkbenchRun; previous: WorkbenchRun | null; current: WorkbenchRun }>({
        initial: init,
        previous: null,
        current: init,
    });
    const [running, setRunning] = useState(false);
    const [runError, setRunError] = useState<string | null>(null);
    const [highlight, setHighlight] = useState<Set<string>>(new Set());
    const [persistRun, setPersistRun] = useState(true);
    const [overlay, setOverlay] = useState(false);

    const hl = (key: string) => (highlight.has(key) ? 'param-highlight' : '');

    const rerun = async () => {
        setRunning(true);
        setRunError(null);
        try {
            const { data } = await window.axios.post('/backtests/ephemeral', {
                strategy_type: type,
                pair: strategy.pair,
                timeframe: strategy.timeframe,
                date_from: period.date_from,
                date_to: period.date_to,
                indicators,
                risk,
            });
            const run: WorkbenchRun = { metrics: data.metrics, trades: data.trades ?? [], equity: data.equity_curve ?? [] };
            setRuns((p) => ({ initial: p.initial, previous: p.current, current: run }));
        } catch (e: unknown) {
            const err = e as { response?: { data?: { error?: string } } };
            setRunError(err.response?.data?.error ?? 'No se pudo correr el backtest.');
        } finally {
            setRunning(false);
        }
    };

    const applyToPanel = (sind: Record<string, number | string>, srisk: Record<string, number>) => {
        const touched: string[] = [];
        setIndicators((prev) => {
            const next = { ...prev };
            for (const [k, v] of Object.entries(sind)) {
                if (k in prev || fields.some((f) => f.name === k)) {
                    next[k] = v;
                    touched.push(k);
                }
            }
            return next;
        });
        setRisk((prev) => {
            const next = { ...prev };
            for (const k of ['sl_pips', 'tp_pips', 'risk_percent']) {
                if (srisk[k] != null) {
                    next[k] = Number(srisk[k]);
                    touched.push(k);
                }
            }
            return next;
        });
        setHighlight(new Set(touched));
        setTimeout(() => setHighlight(new Set()), 1300);
    };

    const saveVersion = () => {
        const payload = {
            indicators,
            risk,
            date_from: period.date_from,
            date_to: period.date_to,
            persist_run: persistRun,
            run: persistRun ? runs.current : null,
        };
        router.post(`/strategies/${strategy.id}/save-version-from-workbench`, payload as Parameters<typeof router.post>[1]);
    };

    return (
        <AppLayout>
            <Head title={`Workbench · ${strategy.name}`} />

            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-lg font-semibold tracking-tight">Workbench de afinamiento</h1>
                    <p className="font-mono text-xs text-text-secondary">
                        {strategy.name} · {type} · {strategy.pair} · {strategy.timeframe}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                        <input type="checkbox" checked={persistRun} onChange={(e) => setPersistRun(e.target.checked)} />
                        guardar también la corrida
                    </label>
                    <button
                        type="button"
                        onClick={saveVersion}
                        className="rounded-md border border-accent bg-accent/10 px-3 py-1.5 text-sm font-semibold text-accent hover:bg-accent/20"
                    >
                        Guardar como nueva versión
                    </button>
                    <Link href={`/backtests/${backtest.id}`} className="text-sm text-text-secondary hover:text-text-primary">
                        ← Volver
                    </Link>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                {/* Panel izquierdo: parámetros (sticky) */}
                <aside className="lg:sticky lg:top-20 lg:self-start">
                    <div className="rounded-lg border border-border bg-bg-surface p-4">
                        <h2 className="mb-3 text-sm font-semibold">Parámetros</h2>
                        {fields.length === 0 && (
                            <p className="mb-3 text-xs text-warning">Esquema no disponible (¿bridge apagado?).</p>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                            {fields.map((f) => (
                                <label key={f.name} className="block">
                                    <span className="mb-1 block text-[11px] uppercase tracking-wide text-text-secondary">{f.label}</span>
                                    {f.type === 'select' ? (
                                        <select
                                            value={String(indicators[f.name] ?? f.default)}
                                            onChange={(e) => setIndicators((p) => ({ ...p, [f.name]: e.target.value }))}
                                            className={`input ${hl(f.name)}`}
                                        >
                                            {f.options?.map((o) => (
                                                <option key={o.value} value={o.value}>
                                                    {o.label}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        <input
                                            type="number"
                                            min={f.min}
                                            max={f.max}
                                            step={f.step ?? 1}
                                            value={String(indicators[f.name] ?? f.default)}
                                            onChange={(e) => setIndicators((p) => ({ ...p, [f.name]: Number(e.target.value) }))}
                                            className={`input font-mono ${hl(f.name)}`}
                                        />
                                    )}
                                </label>
                            ))}
                        </div>

                        <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-text-secondary">Riesgo</h3>
                        <div className="grid grid-cols-3 gap-3">
                            {RISK_FIELDS.map((f) => (
                                <label key={f.key} className="block">
                                    <span className="mb-1 block text-[11px] uppercase tracking-wide text-text-secondary">{f.label}</span>
                                    <input
                                        type="number"
                                        min={0}
                                        step={f.key === 'risk_percent' ? 0.1 : 1}
                                        value={risk[f.key]}
                                        onChange={(e) => setRisk((p) => ({ ...p, [f.key]: Number(e.target.value) }))}
                                        className={`input font-mono ${hl(f.key)}`}
                                    />
                                </label>
                            ))}
                        </div>

                        <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-text-secondary">Periodo</h3>
                        <div className="grid grid-cols-2 gap-3">
                            <input
                                type="date"
                                value={period.date_from}
                                onChange={(e) => setPeriod((p) => ({ ...p, date_from: e.target.value }))}
                                className="input font-mono"
                            />
                            <input
                                type="date"
                                value={period.date_to}
                                onChange={(e) => setPeriod((p) => ({ ...p, date_to: e.target.value }))}
                                className="input font-mono"
                            />
                        </div>

                        <button
                            type="button"
                            onClick={rerun}
                            disabled={running}
                            className="mt-5 w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                        >
                            {running ? 'Corriendo…' : 'Re-correr backtest'}
                        </button>
                        {runError && <p className="mt-2 text-xs text-loss">{runError}</p>}
                        {timeframes.length === 0 && null}
                    </div>
                </aside>

                {/* Panel derecho: resultados */}
                <div className="space-y-6 lg:col-span-2">
                    <RunComparison
                        initial={runs.initial}
                        previous={runs.previous}
                        current={runs.current}
                        onPinInitial={() => setRuns((p) => ({ ...p, initial: p.current }))}
                    />

                    <div className="rounded-lg border border-border bg-bg-surface p-4">
                        <div className="mb-3 flex items-center justify-between">
                            <h2 className="text-sm font-semibold">Equity curve (Actual)</h2>
                            {runs.previous && (
                                <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                                    <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} />
                                    overlay Anterior
                                </label>
                            )}
                        </div>
                        <WorkbenchEquity current={runs.current.equity} previous={overlay ? runs.previous?.equity ?? null : null} />
                    </div>

                    {candles.length > 0 && (
                        <div className="rounded-lg border border-border bg-bg-surface p-2">
                            <BacktestChart candles={candles} trades={runs.current.trades} />
                        </div>
                    )}

                    <TradesTable trades={runs.current.trades} />
                </div>
            </div>

            {/* Optimización automática robusta */}
            <div className="mt-8">
                <OptimizationPanel
                    strategyType={type}
                    pair={strategy.pair}
                    timeframe={strategy.timeframe}
                    period={period}
                    indicators={indicators}
                    risk={risk}
                    onLoad={(params) => applyToPanel(params, risk)}
                />
            </div>

            {/* Panel inferior: afinamiento IA */}
            <div className="mt-8">
                <AiPanel
                    backtestId={backtest.id}
                    aiConfigured={aiConfigured}
                    initialManualPrompt={manualPrompt}
                    currentIndicators={indicators}
                    currentRisk={risk}
                    currentMetrics={runs.current.metrics}
                    onApply={applyToPanel}
                />
            </div>
        </AppLayout>
    );
}

// --- Equity con overlay opcional (por índice de punto) ----------------------
function WorkbenchEquity({ current, previous }: { current: { equity: number }[]; previous: { equity: number }[] | null }) {
    const data = useMemo(() => {
        const max = Math.max(current.length, previous?.length ?? 0);
        const step = Math.max(1, Math.ceil(max / 350));
        const rows: { i: number; current: number | null; previous: number | null }[] = [];
        for (let i = 0; i < max; i += step) {
            rows.push({ i, current: current[i]?.equity ?? null, previous: previous?.[i]?.equity ?? null });
        }
        return rows;
    }, [current, previous]);

    if (current.length === 0) {
        return <div className="flex h-[200px] items-center justify-center text-sm text-text-secondary">Sin corrida todavía.</div>;
    }

    return (
        <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data}>
                <defs>
                    <linearGradient id="wbeq" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2962ff" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#2962ff" stopOpacity={0} />
                    </linearGradient>
                </defs>
                <CartesianGrid stroke="#2a2d36" strokeDasharray="3 3" />
                <XAxis dataKey="i" tick={false} stroke="#2a2d36" />
                <YAxis stroke="#2a2d36" tick={{ fill: '#8b8fa8', fontSize: 11 }} width={60} domain={['auto', 'auto']} />
                <Tooltip
                    contentStyle={{ background: '#141519', border: '1px solid #2a2d36', borderRadius: 8 }}
                    formatter={(v) => [fmtMoney(Number(v)), '']}
                />
                {previous && <Line type="monotone" dataKey="previous" stroke="#8b8fa8" strokeWidth={1.5} dot={false} />}
                <Area type="monotone" dataKey="current" stroke="#2962ff" fill="url(#wbeq)" strokeWidth={2} />
            </AreaChart>
        </ResponsiveContainer>
    );
}

// --- Panel IA (Manual / API) cuyo "Aplicar" rellena el panel -----------------
interface AiPanelProps {
    backtestId: number;
    aiConfigured: boolean;
    initialManualPrompt: string;
    currentIndicators: Record<string, number | string>;
    currentRisk: Record<string, number>;
    currentMetrics: WorkbenchRun['metrics'];
    onApply: (indicators: Record<string, number | string>, risk: Record<string, number>) => void;
}

const RISK_KEYS = ['sl_pips', 'tp_pips', 'risk_percent'];

function splitSuggested(sug: Record<string, number | string>): { indicators: Record<string, number | string>; risk: Record<string, number> } {
    const indicators: Record<string, number | string> = {};
    const risk: Record<string, number> = {};
    for (const [k, v] of Object.entries(sug)) {
        if (RISK_KEYS.includes(k)) risk[k] = Number(v);
        else indicators[k] = v;
    }
    return { indicators, risk };
}

function AiPanel({ backtestId, aiConfigured, initialManualPrompt, currentIndicators, currentRisk, currentMetrics, onApply }: AiPanelProps) {
    const [open, setOpen] = useState(true);
    const [mode, setMode] = useState<'manual' | 'api'>(() => (localStorage.getItem('forexbot.analysis_mode') as 'manual' | 'api') || 'manual');

    // Manual
    const [prompt, setPrompt] = useState(initialManualPrompt);
    const [pasted, setPasted] = useState('');
    const [manualErr, setManualErr] = useState<string[]>([]);
    const [copied, setCopied] = useState(false);

    // API
    const [chat, setChat] = useState<AiAnalysis[]>([]);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [apiErr, setApiErr] = useState<string | null>(null);

    const setModePersist = (mdl: 'manual' | 'api') => {
        setMode(mdl);
        localStorage.setItem('forexbot.analysis_mode', mdl);
    };

    const regenPrompt = async () => {
        const { data } = await window.axios.post(`/backtests/${backtestId}/workbench/manual-prompt`, {
            indicators: currentIndicators,
            metrics: currentMetrics ?? {},
        });
        setPrompt(data.prompt);
    };

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(prompt);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            /* noop */
        }
    };

    const applyManual = async () => {
        if (!pasted.trim()) return;
        setManualErr([]);
        try {
            const { data } = await window.axios.post(`/backtests/${backtestId}/manual/preview`, { json: pasted });
            onApply(data.indicators ?? {}, data.risk ?? {});
        } catch (e: unknown) {
            const err = e as { response?: { data?: { errors?: string[] } } };
            setManualErr(err.response?.data?.errors ?? ['No se pudo validar el JSON.']);
        }
    };

    const sendApi = async (e: FormEvent) => {
        e.preventDefault();
        const message = input.trim();
        if (!message || sending) return;
        setSending(true);
        setApiErr(null);
        setInput('');
        try {
            const { data } = await window.axios.post(`/backtests/${backtestId}/workbench/analyze`, {
                message,
                indicators: currentIndicators,
                risk: currentRisk,
                metrics: currentMetrics ?? {},
            });
            setChat((p) => [...p, data.analysis as AiAnalysis]);
        } catch (e: unknown) {
            const err = e as { response?: { data?: { error?: string } } };
            setApiErr(err.response?.data?.error ?? 'No se pudo analizar.');
            setInput(message);
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="rounded-lg border border-border bg-bg-surface">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold"
            >
                <span>Afinamiento con IA · al aplicar rellena el panel (no crea versión)</span>
                <span className="text-text-secondary">{open ? '▾' : '▸'}</span>
            </button>

            {open && (
                <div className="border-t border-border p-4">
                    <div className="mb-4 inline-flex rounded-lg border border-border bg-bg-elevated p-0.5">
                        {(['manual', 'api'] as const).map((mdl) => (
                            <button
                                key={mdl}
                                type="button"
                                onClick={() => setModePersist(mdl)}
                                className={`rounded-md px-3 py-1 text-xs transition-colors ${
                                    mode === mdl ? 'bg-bg-surface text-text-primary' : 'text-text-secondary hover:text-text-primary'
                                }`}
                            >
                                {mdl === 'manual' ? 'Manual (sin coste)' : 'API'}
                            </button>
                        ))}
                    </div>

                    {mode === 'manual' ? (
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <div>
                                <div className="mb-2 flex items-center justify-between">
                                    <span className="text-xs font-semibold text-text-secondary">1 · Prompt para Claude.ai</span>
                                    <div className="flex gap-2">
                                        <button type="button" onClick={regenPrompt} className="rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:text-text-primary">
                                            Regenerar
                                        </button>
                                        <button type="button" onClick={copy} className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-white hover:opacity-90">
                                            {copied ? 'Copiado ✓' : 'Copiar'}
                                        </button>
                                    </div>
                                </div>
                                <textarea readOnly value={prompt} rows={10} onFocus={(e) => e.currentTarget.select()} className="w-full resize-y rounded-md border border-border bg-bg-elevated p-3 font-mono text-[11px] text-text-secondary" />
                            </div>
                            <div>
                                <span className="mb-2 block text-xs font-semibold text-text-secondary">2 · Pega la respuesta JSON de Claude</span>
                                <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={10} placeholder='{ "parametros_sugeridos": { ... }, "riesgo_sugerido": { ... } }' className="w-full resize-y rounded-md border border-border bg-bg-elevated p-3 font-mono text-[11px] text-text-primary outline-none focus:border-accent" />
                                <button type="button" onClick={applyManual} disabled={!pasted.trim()} className="mt-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                                    Aplicar al panel
                                </button>
                                {manualErr.length > 0 && (
                                    <ul className="mt-2 space-y-1 rounded-md border border-loss/40 bg-loss/10 p-2 text-[11px] text-loss">
                                        {manualErr.map((er, i) => <li key={i}>· {er}</li>)}
                                    </ul>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div>
                            {!aiConfigured && (
                                <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                                    El modo API no está configurado (ANTHROPIC_API_KEY).
                                </div>
                            )}
                            <div className="mb-3 space-y-3">
                                {chat.map((a) => {
                                    const sug = a.suggested_parameters;
                                    return (
                                        <div key={a.id} className="rounded-md bg-bg-elevated p-3">
                                            <p className="mb-1 text-xs text-text-secondary">{a.prompt}</p>
                                            <p className="whitespace-pre-wrap text-sm text-text-primary">{a.response}</p>
                                            {sug && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const { indicators, risk } = splitSuggested(sug);
                                                        onApply(indicators, risk);
                                                    }}
                                                    className="mt-2 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                                                >
                                                    Aplicar al panel
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            {apiErr && <p className="mb-2 text-xs text-loss">{apiErr}</p>}
                            <form onSubmit={sendApi} className="flex gap-2">
                                <input value={input} onChange={(e) => setInput(e.target.value)} disabled={!aiConfigured || sending} placeholder="Pregunta sobre esta corrida…" className="input" />
                                <button type="submit" disabled={!aiConfigured || sending || !input.trim()} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                                    {sending ? '…' : 'Enviar'}
                                </button>
                            </form>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
