import { Head, router } from '@inertiajs/react';
import { useState, type FormEvent } from 'react';
import AppLayout from '@/Layouts/AppLayout';
import SymbolCombobox from '@/Components/SymbolCombobox';
import OptimizationPanel from '@/Components/OptimizationPanel';
import BacktestChart from '@/Components/BacktestChart';
import TradesTable from '@/Components/TradesTable';
import { fmtMoney, fmtNumber } from '@/lib/format';
import type { BacktestMetrics, BacktestTrade, Candle, EquityPoint, SchemaField, StrategySchemas } from '@/types';

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

    const [run, setRun] = useState<Run | null>(null);
    const [candles, setCandles] = useState<Candle[]>([]);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [highlight, setHighlight] = useState<Set<string>>(new Set());

    const [showSave, setShowSave] = useState(false);
    const [name, setName] = useState(preload?.name ?? '');
    const [description, setDescription] = useState(preload?.description ?? '');

    const fields = schemas[type]?.fields ?? [];

    const changeType = (t: string) => {
        setType(t);
        setIndicators(schemas[t] ? defaultsFor(schemas[t].fields) : {});
    };

    const runBacktest = async () => {
        setRunning(true);
        setError(null);
        try {
            const [bt, cd] = await Promise.all([
                window.axios.post('/backtests/ephemeral', { strategy_type: type, pair, timeframe, date_from: period.date_from, date_to: period.date_to, indicators, risk }),
                window.axios.get(`/api/market/candles/${encodeURIComponent(pair)}`, { params: { timeframe, from: period.date_from, to: period.date_to } }),
            ]);
            setRun({ metrics: bt.data.metrics, trades: bt.data.trades ?? [], equity: bt.data.equity_curve ?? [] });
            setCandles((cd.data.data ?? []) as Candle[]);
        } catch (e: unknown) {
            const err = e as { response?: { data?: { error?: string } } };
            setError(err.response?.data?.error ?? 'No se pudo correr el backtest.');
        } finally {
            setRunning(false);
        }
    };

    const loadCombo = (params: Record<string, number | string>) => {
        setIndicators((prev) => ({ ...prev, ...params }));
        setHighlight(new Set(Object.keys(params)));
        setTimeout(() => setHighlight(new Set()), 2000);
    };

    const save = (e: FormEvent) => {
        e.preventDefault();
        router.post('/laboratory', {
            name, description, type, pair, timeframe, indicators, risk,
            from_strategy_id: preload?.from_strategy_id ?? null,
        });
    };

    const m = run?.metrics;

    return (
        <AppLayout title={preload ? `Laboratorio · ${preload.name}` : 'Laboratorio de estrategias'}>
            <Head title="Laboratorio" />

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
                {/* Panel de configuración */}
                <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
                    <section className="rounded-lg border border-border bg-bg-surface p-4">
                        <h2 className="mb-3 text-sm font-semibold">Herramienta</h2>
                        <Field label="Tipo de estrategia">
                            <select value={type} onChange={(e) => changeType(e.target.value)} className="input">
                                {types.map((t) => (
                                    <option key={t} value={t}>{schemas[t].label}</option>
                                ))}
                            </select>
                        </Field>
                        {schemas[type] && <p className="-mt-2 mb-3 text-xs text-text-secondary">{schemas[type].description}</p>}
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Par">
                                <SymbolCombobox value={pair} symbols={symbols} onChange={setPair} placeholder="EURUSD#" />
                            </Field>
                            <Field label="Timeframe">
                                <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} className="input font-mono">
                                    {timeframes.map((tf) => (
                                        <option key={tf} value={tf}>{tf}</option>
                                    ))}
                                </select>
                            </Field>
                        </div>
                    </section>

                    <section className="rounded-lg border border-border bg-bg-surface p-4">
                        <h2 className="mb-3 text-sm font-semibold">Parámetros</h2>
                        <div className="grid grid-cols-2 gap-3">
                            {fields.map((f) => (
                                <Field key={f.name} label={f.label} highlight={highlight.has(f.name)}>
                                    {f.type === 'select' ? (
                                        <select value={String(indicators[f.name] ?? f.default)} onChange={(e) => setIndicators((p) => ({ ...p, [f.name]: e.target.value }))} className="input">
                                            {f.options?.map((o) => (
                                                <option key={o.value} value={o.value}>{o.label}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <input type="number" min={f.min} max={f.max} step={f.step ?? 1} value={String(indicators[f.name] ?? f.default)} onChange={(e) => setIndicators((p) => ({ ...p, [f.name]: Number(e.target.value) }))} className="input font-mono" />
                                    )}
                                </Field>
                            ))}
                        </div>
                        <h3 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Gestión de riesgo</h3>
                        <div className="grid grid-cols-3 gap-3">
                            {RISK_FIELDS.map((rf) => (
                                <Field key={rf.key} label={rf.label}>
                                    <input type="number" min={0} step={0.1} value={risk[rf.key] ?? ''} onChange={(e) => setRisk((p) => ({ ...p, [rf.key]: Number(e.target.value) }))} className="input font-mono" />
                                </Field>
                            ))}
                        </div>
                    </section>

                    <section className="rounded-lg border border-border bg-bg-surface p-4">
                        <h2 className="mb-3 text-sm font-semibold">Periodo</h2>
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Desde">
                                <input type="date" value={period.date_from} onChange={(e) => setPeriod((p) => ({ ...p, date_from: e.target.value }))} className="input font-mono" />
                            </Field>
                            <Field label="Hasta">
                                <input type="date" value={period.date_to} onChange={(e) => setPeriod((p) => ({ ...p, date_to: e.target.value }))} className="input font-mono" />
                            </Field>
                        </div>
                        <div className="mt-4 flex gap-2">
                            <button type="button" onClick={runBacktest} disabled={running} className="flex-1 rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                                {running ? 'Corriendo…' : 'Ejecutar backtest'}
                            </button>
                            <button type="button" onClick={() => setShowSave(true)} className="flex-1 rounded-md bg-profit px-4 py-2.5 text-sm font-bold text-white hover:opacity-90">
                                Guardar como estrategia
                            </button>
                        </div>
                        <p className="mt-2 text-[11px] text-text-secondary">Nada se guarda hasta pulsar «Guardar». Experimenta libremente.</p>
                    </section>
                </aside>

                {/* Resultados */}
                <div className="min-w-0 space-y-5">
                    {error && <div className="rounded-lg border border-loss/40 bg-loss/10 px-4 py-2 text-sm text-loss">{error}</div>}

                    {m ? (
                        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                            <Metric label="PnL neto" value={fmtMoney(m.net_pnl)} color={m.net_pnl >= 0 ? 'text-profit' : 'text-loss'} />
                            <Metric label="Retorno" value={`${m.return_pct.toFixed(2)}%`} color={m.return_pct >= 0 ? 'text-profit' : 'text-loss'} />
                            <Metric label="Trades" value={String(m.total_trades)} />
                            <Metric label="Win rate" value={`${m.win_rate.toFixed(1)}%`} />
                            <Metric label="Profit factor" value={m.profit_factor != null ? fmtNumber(m.profit_factor) : '—'} />
                            <Metric label="Max DD" value={`${m.max_drawdown_pct.toFixed(2)}%`} color="text-loss" />
                        </section>
                    ) : (
                        <section className="rounded-lg border border-dashed border-border bg-bg-surface p-10 text-center text-sm text-text-secondary">
                            Configura a la izquierda y pulsa «Ejecutar backtest» para ver resultados aquí. Todo es efímero hasta guardar.
                        </section>
                    )}

                    {run && candles.length > 0 && (
                        <section className="rounded-lg border border-border bg-bg-surface p-2">
                            <BacktestChart candles={candles} trades={run.trades} />
                        </section>
                    )}

                    <OptimizationPanel strategyType={type} pair={pair} timeframe={timeframe} period={period} indicators={indicators} risk={risk} onLoad={loadCombo} />

                    {run && run.trades.length > 0 && (
                        <section className="rounded-lg border border-border bg-bg-surface p-4">
                            <h2 className="mb-3 text-sm font-semibold">Trades</h2>
                            <TradesTable trades={run.trades} />
                        </section>
                    )}
                </div>
            </div>

            {showSave && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowSave(false)}>
                    <form onClick={(e) => e.stopPropagation()} onSubmit={save} className="w-full max-w-md rounded-lg border border-border bg-bg-surface p-5 shadow-2xl">
                        <h2 className="mb-3 text-sm font-semibold">{preload ? 'Guardar como nueva versión' : 'Guardar como estrategia'}</h2>
                        <Field label="Nombre">
                            <input value={name} onChange={(e) => setName(e.target.value)} required className="input" />
                        </Field>
                        <Field label="Descripción">
                            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input" />
                        </Field>
                        <div className="mt-2 rounded-md border border-border bg-bg-elevated px-3 py-2 font-mono text-[11px] text-text-secondary">
                            {type} · {pair} · {timeframe} · SL {risk.sl_pips} / TP {risk.tp_pips}
                        </div>
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

function Field({ label, highlight, children }: { label: string; highlight?: boolean; children: React.ReactNode }) {
    return (
        <label className={`mb-3 block ${highlight ? 'param-highlight' : ''}`}>
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-text-secondary">{label}</span>
            {children}
        </label>
    );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
    return (
        <div className="rounded-lg border border-border bg-bg-surface p-3">
            <div className="text-[10px] uppercase tracking-wide text-text-secondary">{label}</div>
            <div className={`font-mono text-lg font-semibold ${color ?? 'text-text-primary'}`}>{value}</div>
        </div>
    );
}
