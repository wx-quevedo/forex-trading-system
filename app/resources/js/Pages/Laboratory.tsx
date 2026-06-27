import { Head, router } from '@inertiajs/react';
import { useEffect, useState, type FormEvent } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import AppLayout from '@/Layouts/AppLayout';
import SymbolCombobox from '@/Components/SymbolCombobox';
import OptimizationPanel from '@/Components/OptimizationPanel';
import BacktestChart from '@/Components/BacktestChart';
import TradesTable from '@/Components/TradesTable';
import InfoTooltip from '@/Components/InfoTooltip';
import ProgressModal from '@/Components/ProgressModal';
import { PARAM_HELP } from '@/lib/paramHelp';
import { fmtMoney, fmtNumber } from '@/lib/format';
import type { BacktestMetrics, BacktestTrade, Candle, EquityPoint, Optimization, SchemaField, StrategySchemas } from '@/types';

interface Preload {
    from_strategy_id: number;
    name: string;
    description: string | null;
    type: string;
    pair: string;
    timeframe: string;
    indicators: Record<string, number | string>;
    risk: Record<string, number>;
}

interface Props {
    schemas: StrategySchemas;
    timeframes: string[];
    symbols: string[];
    preload: Preload | null;
    defaultPeriod: { date_from: string; date_to: string };
}

const RISK_FIELDS = [
    { key: 'sl_pips', label: 'SL (pips)' },
    { key: 'tp_pips', label: 'TP (pips)' },
    { key: 'risk_percent', label: 'Riesgo %' },
];

const defaultsFor = (fields: SchemaField[]): Record<string, number | string> =>
    Object.fromEntries(fields.map((f) => [f.name, f.default]));

interface Run {
    metrics: BacktestMetrics | null;
    trades: BacktestTrade[];
    equity: EquityPoint[];
}

type Tab = 'trades' | 'optimize';

// Ayuda de cada métrica de la barra de resultados.
const METRIC_HELP: Record<string, string> = {
    net: 'Ganancia/pérdida real tras descontar spread, comisión y swap del broker. Es lo que de verdad obtendrías.',
    gross: 'Ganancia/pérdida ignorando los costos del broker. Útil solo para comparar; NO es el resultado real.',
    costs: 'Total de spread + comisión + swap pagados. La diferencia entre bruto y neto. Cuanto más operas, más pagas.',
    ret: 'Rendimiento porcentual sobre el capital, ya con costos descontados.',
    trades: 'Número de operaciones cerradas. Menos de ~30 hace los resultados poco fiables estadísticamente.',
    winrate: 'Porcentaje de operaciones ganadoras. Un win rate alto no garantiza rentabilidad si las pérdidas son grandes.',
    pf: 'Ganancia bruta ÷ pérdida bruta. >1 es rentable; >1.5 es bueno; <1 pierde dinero.',
    dd: 'Máxima caída desde un pico de capital (el peor momento). Cuanto menor, más llevadero el riesgo.',
    capital: 'Capital con el que arranca el backtest; base para calcular retorno %, equity y drawdown.',
    capitalFinal: 'Capital al terminar el backtest = capital inicial + PnL neto.',
    capitalInput: 'Dinero inicial del backtest (USD). El retorno %, la equity y el drawdown se calculan sobre este monto.',
};

export default function Laboratory({ schemas, timeframes, symbols, preload, defaultPeriod }: Props) {
    const types = Object.keys(schemas);
    const [type, setType] = useState(preload?.type ?? types[0] ?? 'ma_cross');
    const [pair, setPair] = useState(preload?.pair ?? symbols[0] ?? 'EURUSD');
    const [timeframe, setTimeframe] = useState(preload?.timeframe ?? 'H1');
    const [indicators, setIndicators] = useState<Record<string, number | string>>(
        preload?.indicators ?? (schemas[preload?.type ?? types[0]] ? defaultsFor(schemas[preload?.type ?? types[0]].fields) : {}),
    );
    const [risk, setRisk] = useState<Record<string, number>>({
        sl_pips: Number(preload?.risk?.sl_pips ?? 20),
        tp_pips: Number(preload?.risk?.tp_pips ?? 40),
        risk_percent: Number(preload?.risk?.risk_percent ?? 1),
    });
    const [period, setPeriod] = useState(defaultPeriod);
    const [capital, setCapital] = useState<number>(() => Number(localStorage.getItem('forexbot.lab_capital')) || 10000);
    const setCapitalPref = (v: number) => { setCapital(v); localStorage.setItem('forexbot.lab_capital', String(v)); };

    const [run, setRun] = useState<Run | null>(null);
    const [candles, setCandles] = useState<Candle[]>([]);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [highlight, setHighlight] = useState<Set<string>>(new Set());
    const [digits, setDigits] = useState(5);

    const [tab, setTab] = useState<Tab>(() => (localStorage.getItem('forexbot.lab_tab') === 'optimize' ? 'optimize' : 'trades'));
    const setTabPref = (t: Tab) => { setTab(t); localStorage.setItem('forexbot.lab_tab', t); };
    const [optData, setOptData] = useState<Optimization | null>(null);
    const [optimizing, setOptimizing] = useState(false);

    const [showSave, setShowSave] = useState(false);
    const [name, setName] = useState(preload?.name ?? '');
    const [description, setDescription] = useState(preload?.description ?? '');

    const fields = schemas[type]?.fields ?? [];

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const { data } = await window.axios.get(`/api/market/symbol/${encodeURIComponent(pair)}`);
                if (alive && data.data?.digits) setDigits(Number(data.data.digits));
            } catch { /* default 5 */ }
        })();
        return () => { alive = false; };
    }, [pair]);

    // Combo enviado desde el Explorador (sessionStorage): carga una configuración
    // completa (tipo/par/tf/params/SL/TP/riesgo/capital) para inspeccionarla aquí.
    useEffect(() => {
        const raw = sessionStorage.getItem('forexbot.lab_combo');
        if (!raw) return;
        sessionStorage.removeItem('forexbot.lab_combo');
        try {
            const c = JSON.parse(raw) as {
                type?: string; pair?: string; timeframe?: string;
                indicators?: Record<string, number | string>; risk?: Record<string, number>; capital?: number;
            };
            if (c.type) setType(c.type);
            if (c.pair) setPair(c.pair);
            if (c.timeframe) setTimeframe(c.timeframe);
            if (c.indicators) setIndicators(c.indicators);
            if (c.risk) setRisk((p) => ({ ...p, ...c.risk }));
            if (c.capital) setCapitalPref(c.capital);
            if (c.indicators) {
                setHighlight(new Set(Object.keys(c.indicators)));
                setTimeout(() => setHighlight(new Set()), 2000);
            }
        } catch { /* combo inválido: ignora */ }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const changeType = (t: string) => {
        setType(t);
        setIndicators(schemas[t] ? defaultsFor(schemas[t].fields) : {});
    };
    const setIndicator = (nameKey: string, value: number | string) => setIndicators((p) => ({ ...p, [nameKey]: value }));
    const setRiskField = (key: string, value: number) => setRisk((p) => ({ ...p, [key]: value }));

    const runBacktest = async () => {
        setRunning(true);
        setError(null);
        try {
            const [bt, cd] = await Promise.all([
                window.axios.post('/backtests/ephemeral', { strategy_type: type, pair, timeframe, date_from: period.date_from, date_to: period.date_to, indicators, risk, initial_balance: capital }),
                window.axios.get(`/api/market/candles/${encodeURIComponent(pair)}`, { params: { timeframe, from: period.date_from, to: period.date_to } }),
            ]);
            setRun({ metrics: bt.data.metrics, trades: bt.data.trades ?? [], equity: bt.data.equity_curve ?? [] });
            setCandles((cd.data.data ?? []) as Candle[]);
            setTabPref('trades');
        } catch (e: unknown) {
            const err = e as { response?: { data?: { error?: string } } };
            setError(err.response?.data?.error ?? 'No se pudo correr el backtest.');
        } finally {
            setRunning(false);
        }
    };

    const runOptimize = async () => {
        setOptimizing(true);
        setError(null);
        setTabPref('optimize');
        try {
            const { data } = await window.axios.post('/backtests/optimize', { strategy_type: type, pair, timeframe, date_from: period.date_from, date_to: period.date_to, indicators, risk, initial_balance: capital });
            setOptData(data as Optimization);
        } catch (e: unknown) {
            const err = e as { response?: { data?: { error?: string } } };
            setError(err.response?.data?.error ?? 'No se pudo optimizar.');
        } finally {
            setOptimizing(false);
        }
    };

    const loadCombo = (params: Record<string, number | string>) => {
        setIndicators((prev) => ({ ...prev, ...params }));
        setHighlight(new Set(Object.keys(params)));
        setTimeout(() => setHighlight(new Set()), 2000);
    };

    const save = (e: FormEvent) => {
        e.preventDefault();
        router.post('/laboratory', { name, description, type, pair, timeframe, indicators, risk, from_strategy_id: preload?.from_strategy_id ?? null });
    };

    const lab: LabProps = {
        types, type, changeType, schemas, pair, setPair, symbols, timeframe, setTimeframe, timeframes,
        fields, indicators, setIndicator, highlight, risk, setRiskField, period, setPeriod, capital, setCapital: setCapitalPref,
        running, runBacktest, openSave: () => setShowSave(true), run, candles, digits, loadCombo,
        tab, setTab: setTabPref, error, optData, optimizing, runOptimize,
    };

    return (
        <AppLayout title="Laboratorio" fullHeight>
            <Head title="Laboratorio" />

            <LayoutSidebar lab={lab} />

            {(running || optimizing) && (
                <ProgressModal
                    title={optimizing ? 'Optimizando…' : 'Ejecutando backtest…'}
                    detail={optimizing ? 'Barriendo combinaciones y validando out-of-sample (puede tardar).' : `${type} · ${pair} · ${timeframe}`}
                />
            )}

            {showSave && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowSave(false)}>
                    <form onClick={(e) => e.stopPropagation()} onSubmit={save} className="w-full max-w-md rounded-lg border border-border bg-bg-surface p-5 shadow-2xl">
                        <h2 className="mb-3 text-sm font-semibold">{preload ? 'Guardar como nueva versión' : 'Guardar como estrategia'}</h2>
                        <Field label="Nombre"><input value={name} onChange={(e) => setName(e.target.value)} required className="input" /></Field>
                        <Field label="Descripción"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input" /></Field>
                        <div className="mt-2 rounded-md border border-border bg-bg-elevated px-3 py-2 font-mono text-[11px] text-text-secondary">{type} · {pair} · {timeframe} · SL {risk.sl_pips} / TP {risk.tp_pips}</div>
                        <div className="mt-4 flex justify-end gap-2">
                            <button type="button" onClick={() => setShowSave(false)} className="rounded-md border border-border px-4 py-2 text-sm text-text-secondary hover:text-text-primary">Cancelar</button>
                            <button type="submit" disabled={!name} className="rounded-md bg-profit px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50">Guardar</button>
                        </div>
                    </form>
                </div>
            )}
        </AppLayout>
    );
}

interface LabProps {
    types: string[]; type: string; changeType: (t: string) => void; schemas: StrategySchemas;
    pair: string; setPair: (s: string) => void; symbols: string[]; timeframe: string; setTimeframe: (t: string) => void; timeframes: string[];
    fields: SchemaField[]; indicators: Record<string, number | string>; setIndicator: (k: string, v: number | string) => void; highlight: Set<string>;
    risk: Record<string, number>; setRiskField: (k: string, v: number) => void; period: { date_from: string; date_to: string }; setPeriod: (p: { date_from: string; date_to: string }) => void;
    capital: number; setCapital: (v: number) => void;
    running: boolean; runBacktest: () => void; openSave: () => void; run: Run | null; candles: Candle[]; digits: number; loadCombo: (p: Record<string, number | string>) => void;
    tab: Tab; setTab: (t: Tab) => void; error: string | null;
    optData: Optimization | null; optimizing: boolean; runOptimize: () => void;
}

// ---------- Layout dashboard: dos zonas de scroll (sidebar + content) ----------
function LayoutSidebar({ lab }: { lab: LabProps }) {
    return (
        <div className="flex h-full">
            {/* Sidebar: columna de alto completo con su PROPIO scroll. */}
            <aside className="w-80 shrink-0 overflow-y-auto border-r border-border bg-bg-surface p-4">
                <ConfigControls lab={lab} />
            </aside>
            {/* Content: métricas fijas arriba + zona de scroll propia debajo. */}
            <div className="flex min-w-0 flex-1 flex-col">
                <div className="shrink-0 border-b border-border p-3">
                    <MetricsStrip metrics={lab.run?.metrics ?? null} capital={lab.capital} />
                </div>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
                    {/* Precio (protagonista) + curva de equity lado a lado. */}
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[3fr_2fr]">
                        <ChartPanel lab={lab} height={440} />
                        <EquityPanel equity={lab.run?.equity ?? []} height={440} />
                    </div>
                    <ResultsTabs lab={lab} />
                </div>
            </div>
        </div>
    );
}

function EquityPanel({ equity, height }: { equity: EquityPoint[]; height: number }) {
    return (
        <section className="rounded-lg border border-border bg-bg-surface p-2">
            <div className="px-2 pb-1 pt-1 text-[11px] font-semibold text-text-secondary">Curva de equity (balance)</div>
            {equity.length > 0 ? (
                <EquityChart equity={equity} height={height - 28} />
            ) : (
                <div className="flex items-center justify-center text-sm text-text-secondary" style={{ height: height - 28 }}>Sin corrida todavía.</div>
            )}
        </section>
    );
}

// ---------- Franja de métricas fija sobre el chart ----------
function MetricsStrip({ metrics: m, capital }: { metrics: BacktestMetrics | null; capital: number }) {
    if (!m) {
        return <div className="rounded-lg border border-dashed border-border bg-bg-surface px-4 py-2 text-center text-[11px] text-text-secondary">Capital inicial {fmtMoney(capital)} · las métricas aparecerán aquí tras ejecutar un backtest.</div>;
    }
    const finalCap = capital + m.net_pnl;
    const cards: { label: string; value: string; help: string; color?: string }[] = [
        { label: 'Capital inicial', value: fmtMoney(capital), help: METRIC_HELP.capital, color: 'text-text-primary' },
        { label: 'Capital final', value: fmtMoney(finalCap), help: METRIC_HELP.capitalFinal, color: finalCap >= capital ? 'text-profit' : 'text-loss' },
        { label: 'PnL neto', value: fmtMoney(m.net_pnl), help: METRIC_HELP.net, color: m.net_pnl >= 0 ? 'text-profit' : 'text-loss' },
        { label: 'PnL bruto', value: fmtMoney(m.gross_pnl ?? m.net_pnl), help: METRIC_HELP.gross, color: (m.gross_pnl ?? m.net_pnl) >= 0 ? 'text-profit' : 'text-loss' },
        { label: 'Costos broker', value: fmtMoney(m.total_costs ?? 0), help: METRIC_HELP.costs, color: 'text-warning' },
        { label: 'Retorno neto', value: `${m.return_pct.toFixed(2)}%`, help: METRIC_HELP.ret, color: m.return_pct >= 0 ? 'text-profit' : 'text-loss' },
        { label: 'Trades', value: String(m.total_trades), help: METRIC_HELP.trades },
        { label: 'Win rate', value: `${(m.win_rate * 100).toFixed(1)}%`, help: METRIC_HELP.winrate },
        { label: 'Profit factor', value: m.profit_factor != null ? fmtNumber(m.profit_factor) : '—', help: METRIC_HELP.pf },
        { label: 'Max DD', value: `${m.max_drawdown_pct.toFixed(2)}%`, help: METRIC_HELP.dd, color: 'text-loss' },
    ];
    return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 xl:grid-cols-10">
            {cards.map((c) => (
                <div key={c.label} className="rounded-lg border border-border bg-bg-surface px-3 py-2">
                    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-text-secondary">
                        {c.label}
                        <InfoTooltip text={c.help} />
                    </div>
                    <div className={`font-mono text-base font-semibold ${c.color ?? 'text-text-primary'}`}>{c.value}</div>
                </div>
            ))}
        </div>
    );
}

// ---------- Controles de configuración (Sidebar) ----------
function ConfigControls({ lab }: { lab: LabProps }) {
    return <SidebarConfig lab={lab} />;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return <h3 className="mb-1.5 mt-4 text-[10px] font-semibold uppercase tracking-wide text-text-secondary first:mt-0">{children}</h3>;
}

function Buttons({ lab }: { lab: LabProps }) {
    return (
        <>
            <button type="button" onClick={lab.runBacktest} disabled={lab.running} className="w-full rounded-md bg-accent px-3 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                {lab.running ? 'Corriendo…' : 'Ejecutar backtest'}
            </button>
            <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={lab.runOptimize} disabled={lab.optimizing || lab.running} className="rounded-md border border-border px-3 py-2 text-sm text-text-primary hover:bg-bg-elevated disabled:opacity-50">{lab.optimizing ? 'Optimizando…' : 'Optimizar'}</button>
                <button type="button" onClick={lab.openSave} className="rounded-md bg-profit px-3 py-2 text-sm font-bold text-white hover:opacity-90">Guardar</button>
            </div>
        </>
    );
}

// Disposición B (ganadora): sidebar compacto en secciones, campos pequeños en 2 columnas.
function SidebarConfig({ lab }: { lab: LabProps }) {
    return (
        <div>
            <SectionLabel>Instrumento</SectionLabel>
            <Field label="Tipo de estrategia">
                <select value={lab.type} onChange={(e) => lab.changeType(e.target.value)} className="input">
                    {lab.types.map((t) => (<option key={t} value={t}>{lab.schemas[t].label}</option>))}
                </select>
            </Field>
            {lab.schemas[lab.type] && <p className="mb-2 mt-1 text-[11px] leading-snug text-text-secondary">{lab.schemas[lab.type].description}</p>}
            <div className="grid grid-cols-2 gap-2">
                <Field label="Par"><SymbolCombobox value={lab.pair} symbols={lab.symbols} onChange={lab.setPair} placeholder="EURUSD#" /></Field>
                <Field label="Timeframe">
                    <select value={lab.timeframe} onChange={(e) => lab.setTimeframe(e.target.value)} className="input font-mono">
                        {lab.timeframes.map((tf) => (<option key={tf} value={tf}>{tf}</option>))}
                    </select>
                </Field>
            </div>
            <div className="mt-2">
                <Field label="Capital inicial (USD)" help={METRIC_HELP.capitalInput}>
                    <input type="number" min={1} step={100} value={lab.capital} onChange={(e) => lab.setCapital(Number(e.target.value))} className="input font-mono" />
                </Field>
            </div>
            <MarketStatus symbol={lab.pair} />

            <SectionLabel>Parámetros</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
                {lab.fields.map((f) => (
                    <ParamField key={f.name} f={f} value={lab.indicators[f.name]} onChange={(v) => lab.setIndicator(f.name, v)} highlight={lab.highlight.has(f.name)} />
                ))}
            </div>

            <SectionLabel>Riesgo</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
                {RISK_FIELDS.map((rf) => (
                    <Field key={rf.key} label={rf.label} help={PARAM_HELP[rf.key]}>
                        <input type="number" min={0} step={0.1} value={lab.risk[rf.key] ?? ''} onChange={(e) => lab.setRiskField(rf.key, Number(e.target.value))} className="input font-mono" />
                    </Field>
                ))}
            </div>

            <SectionLabel>Periodo</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
                <Field label="Desde"><input type="date" value={lab.period.date_from} onChange={(e) => lab.setPeriod({ ...lab.period, date_from: e.target.value })} className="input font-mono" /></Field>
                <Field label="Hasta"><input type="date" value={lab.period.date_to} onChange={(e) => lab.setPeriod({ ...lab.period, date_to: e.target.value })} className="input font-mono" /></Field>
            </div>

            <div className="mt-4 space-y-2"><Buttons lab={lab} /></div>
            {lab.error && <div className="mt-2 rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">{lab.error}</div>}
        </div>
    );
}

// ---------- Chart protagonista ----------
function ChartPanel({ lab, height }: { lab: LabProps; height: number }) {
    return (
        <section className="rounded-lg border border-border bg-bg-surface p-2">
            <div className="px-2 pb-1 pt-1 font-mono text-[11px] text-text-secondary">{lab.pair} · {lab.timeframe} · {lab.type}</div>
            {lab.run && lab.candles.length > 0 ? (
                <BacktestChart candles={lab.candles} trades={lab.run.trades} height={height} />
            ) : (
                <div className="flex items-center justify-center text-sm text-text-secondary" style={{ height }}>
                    Configura y pulsa «Ejecutar backtest». Todo es efímero hasta «Guardar».
                </div>
            )}
        </section>
    );
}

// ---------- Resultados en tabs ----------
function ResultsTabs({ lab }: { lab: LabProps }) {
    const TABS: [Tab, string][] = [['trades', 'Trades'], ['optimize', 'Optimización']];
    return (
        <section className="rounded-lg border border-border bg-bg-surface">
            <div className="flex gap-1 border-b border-border p-1">
                {TABS.map(([t, label]) => (
                    <button key={t} type="button" onClick={() => lab.setTab(t)} className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${lab.tab === t ? 'bg-bg-elevated text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}>{label}</button>
                ))}
            </div>
            <div className="p-3">
                {lab.tab === 'trades' && (
                    lab.run && lab.run.trades.length > 0
                        ? <TradesTable trades={lab.run.trades} chartContext={{ symbol: lab.pair, timeframe: lab.timeframe, digits: lab.digits, strategyType: lab.type, params: lab.indicators }} />
                        : <Placeholder />
                )}
                {lab.tab === 'optimize' && <OptimizationPanel data={lab.optData} onLoad={lab.loadCombo} />}
            </div>
        </section>
    );
}

function Placeholder() {
    return <p className="p-8 text-center text-sm text-text-secondary">Ejecuta un backtest para ver resultados.</p>;
}

function EquityChart({ equity, height = 300 }: { equity: EquityPoint[]; height?: number }) {
    const step = Math.max(1, Math.ceil(equity.length / 400));
    const data = equity.filter((_, i) => i % step === 0).map((p, i) => ({ i, equity: p.equity }));
    return (
        <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                    <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2962ff" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#2962ff" stopOpacity={0} />
                    </linearGradient>
                </defs>
                <CartesianGrid stroke="#1c1e24" />
                <XAxis dataKey="i" tick={{ fill: '#8b8fa8', fontSize: 10 }} />
                <YAxis tick={{ fill: '#8b8fa8', fontSize: 10 }} domain={['auto', 'auto']} width={60} />
                <Tooltip contentStyle={{ background: '#141519', border: '1px solid #2a2d36', fontSize: 12 }} formatter={(v) => [fmtMoney(Number(v)), 'Equity']} />
                <Area type="monotone" dataKey="equity" stroke="#2962ff" fill="url(#eq)" strokeWidth={1.5} />
            </AreaChart>
        </ResponsiveContainer>
    );
}

function ParamField({ f, value, onChange, highlight }: { f: SchemaField; value: number | string | undefined; onChange: (v: number | string) => void; highlight: boolean }) {
    return (
        <Field label={f.label} help={PARAM_HELP[f.name]} highlight={highlight}>
            {f.type === 'select' ? (
                <select value={String(value ?? f.default)} onChange={(e) => onChange(e.target.value)} className="input">
                    {f.options?.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                </select>
            ) : (
                <input type="number" min={f.min} max={f.max} step={f.step ?? 1} value={String(value ?? f.default)} onChange={(e) => onChange(Number(e.target.value))} className="input font-mono" />
            )}
        </Field>
    );
}

function Field({ label, highlight, help, children }: { label: string; highlight?: boolean; help?: string; children: React.ReactNode }) {
    return (
        <label className={`block ${highlight ? 'param-highlight' : ''}`}>
            <span className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wide text-text-secondary">
                {label}
                {help && <InfoTooltip text={help} />}
            </span>
            {children}
        </label>
    );
}

function MarketStatus({ symbol }: { symbol: string }) {
    const [s, setS] = useState<{ open: boolean; next_change: number | null; next_change_type: string | null } | null>(null);
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const { data } = await window.axios.get(`/api/market/session/${encodeURIComponent(symbol)}`);
                if (alive) setS(data.data ?? null);
            } catch { if (alive) setS(null); }
        })();
        return () => { alive = false; };
    }, [symbol]);
    if (!s) return null;
    const next = s.next_change ? new Date(s.next_change * 1000).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : null;
    return (
        <div className="mt-1 flex items-center gap-1.5 text-[11px]">
            <span className={`h-2 w-2 rounded-full ${s.open ? 'bg-profit' : 'bg-loss'}`} />
            <span className={s.open ? 'text-profit' : 'text-loss'}>{s.open ? 'Abierto' : 'Cerrado'}</span>
            {next && <span className="text-text-secondary">· {s.next_change_type === 'open' ? 'Abre' : 'Cierra'} {next}</span>}
        </div>
    );
}

