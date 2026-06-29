import { Head, Link } from '@inertiajs/react';
import { useEffect, useState } from 'react';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import AppLayout from '@/Layouts/AppLayout';
import BacktestChart from '@/Components/BacktestChart';
import ProgressModal from '@/Components/ProgressModal';
import InfoTooltip from '@/Components/InfoTooltip';
import { fmtMoney, fmtNumber } from '@/lib/format';
import { DISPLAY_TZ_OFFSET_SECONDS } from '@/lib/tz';
import { REGIME_META, matchVerdict } from '@/lib/regime';
import { type CalEvent, eventNear } from '@/lib/calendar';
import type { BacktestMetrics, BacktestTrade, Candle, EquityPoint, Favorite, RegimeLabel } from '@/types';

const REGIME_WF_HELP = 'Régimen del periodo de BACKTEST (snapshot del favorito) vs el régimen del periodo de OPERACIÓN. Si el régimen cambió (p.ej. de rango a tendencia), una estrategia de reversión puede degradarse aunque su lógica sea correcta: es un MISMATCH sobrevenido.';

interface Props {
    favorites: Favorite[];
    defaultOperation: { date_from: string; date_to: string };
}

interface SimResult {
    metrics: BacktestMetrics | null;
    trades: BacktestTrade[];
    equity: EquityPoint[];
    error?: string;
}

const PALETTE = ['#26A69A', '#5C9DFF', '#F59E0B', '#EF5350', '#AB7DF6', '#26C6DA', '#EC407A', '#9CCC65'];

const VERDICT: Record<string, { label: string; cls: string }> = {
    cumple: { label: 'CUMPLE', cls: 'bg-profit/15 text-profit' },
    degrada: { label: 'SE DEGRADA', cls: 'bg-warning/15 text-warning' },
    falla: { label: 'FALLA', cls: 'bg-loss/15 text-loss' },
    na: { label: 'sin referencia', cls: 'bg-bg-elevated text-text-secondary' },
};

const CORR_HELP = 'Correlación de Pearson entre los retornos de cada par de estrategias en el periodo. +1 = se mueven idénticamente (diversificación FALSA: creías diversificar pero el riesgo está concentrado); 0 = independientes (diversificación REAL); negativo = se compensan. Recordatorio P6: en una crisis las correlaciones tienden a 1.0 y "todo se mueve junto".';
const WF_HELP = 'Walk-forward: compara el periodo de OPERACIÓN (datos posteriores que la estrategia nunca vio) contra el BACKTEST de referencia. Como los periodos duran distinto, se ANUALIZAN los retornos para comparar. Veredicto: CUMPLE (logra ≥70% del retorno anualizado esperado y sigue en positivo), SE DEGRADA (rinde menos), FALLA (pierde o quiebra en datos nuevos).';

const days = (from?: string | null, to?: string | null) =>
    from && to ? Math.max(1, Math.round((+new Date(to) - +new Date(from)) / 86400000)) : 0;
const annualize = (ret: number, d: number) => (d > 0 ? ret * 365 / d : ret);
const paramsLabel = (p: Record<string, number | string>) =>
    Object.entries(p).map(([k, v]) => `${k.replace(/_/g, ' ')}=${v}`).join(', ');

/** Veredicto walk-forward comparando operación (A) vs backtest (B), anualizados. */
function verdictOf(annA: number, annB: number, blown: boolean): keyof typeof VERDICT {
    if (annB <= 0) return 'na';            // el backtest no era rentable: nada que validar
    if (blown || annA <= 0) return 'falla'; // pierde/quiebra en datos nuevos
    const ratio = annA / annB;
    if (ratio >= 0.7) return 'cumple';
    return 'degrada';
}

function maxDrawdownPct(curve: { equity: number }[]): number {
    let peak = -Infinity, mdd = 0;
    for (const p of curve) {
        peak = Math.max(peak, p.equity);
        if (peak > 0) mdd = Math.min(mdd, (p.equity - peak) / peak);
    }
    return +(mdd * 100).toFixed(2);
}

/** Suma curvas de equity desalineadas: unión de tiempos + forward-fill por estrategia. */
function aggregateEquity(curves: EquityPoint[][], initials: number[]): EquityPoint[] {
    const times = [...new Set(curves.flatMap((c) => c.map((p) => p.time)))].sort((a, b) => a - b);
    if (!times.length) return [];
    const idx = curves.map(() => 0);
    const last = initials.slice();
    const out: EquityPoint[] = [];
    for (const t of times) {
        let sum = 0;
        curves.forEach((c, i) => {
            while (idx[i] < c.length && c[idx[i]].time <= t) { last[i] = c[idx[i]].equity; idx[i]++; }
            sum += last[i];
        });
        out.push({ time: t, equity: +sum.toFixed(2) });
    }
    return out;
}

/** Series de RETORNOS por estrategia, alineadas a una línea temporal común
 *  (forward-fill). Base de la matriz de correlación (Fase 7). */
function alignedReturns(curves: EquityPoint[][], initials: number[]): number[][] {
    const times = [...new Set(curves.flatMap((c) => c.map((p) => p.time)))].sort((a, b) => a - b);
    const idx = curves.map(() => 0);
    const last = initials.slice();
    const equities: number[][] = curves.map(() => []);
    for (const t of times) {
        curves.forEach((c, i) => {
            while (idx[i] < c.length && c[idx[i]].time <= t) { last[i] = c[idx[i]].equity; idx[i]++; }
            equities[i].push(last[i]);
        });
    }
    return equities.map((eq) => eq.slice(1).map((v, k) => (eq[k] ? (v - eq[k]) / eq[k] : 0)));
}

export default function BotHistorico({ favorites, defaultOperation }: Props) {
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [op, setOp] = useState(defaultOperation);
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [results, setResults] = useState<Record<number, SimResult>>({});
    const [error, setError] = useState<string | null>(null);
    const [corr, setCorr] = useState<{ labels: string[]; matrix: (number | null)[][] } | null>(null);

    const toggle = (id: number) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const selectedFavs = favorites.filter((f) => selected.has(f.id));

    const simulate = async () => {
        if (!selectedFavs.length) return;
        setError(null);
        setRunning(true);
        setProgress({ done: 0, total: selectedFavs.length });
        const out: Record<number, SimResult> = {};
        for (const f of selectedFavs) {
            try {
                const { data } = await window.axios.post('/backtests/ephemeral', {
                    strategy_type: f.type, pair: f.pair, timeframe: f.timeframe,
                    date_from: op.date_from, date_to: op.date_to,
                    indicators: f.params,
                    risk: { sl_pips: f.sl_pips, tp_pips: f.tp_pips, risk_percent: f.risk_percent },
                    initial_balance: f.capital,
                });
                out[f.id] = { metrics: data.metrics, trades: data.trades ?? [], equity: data.equity_curve ?? [] };
            } catch (e: unknown) {
                const err = e as { response?: { data?: { error?: string } } };
                out[f.id] = { metrics: null, trades: [], equity: [], error: err.response?.data?.error ?? 'Falló la simulación.' };
            }
            setProgress((p) => ({ ...p, done: p.done + 1 }));
        }
        setResults(out);
        setRunning(false);
    };

    const opDays = days(op.date_from, op.date_to);
    const simulated = selectedFavs.filter((f) => results[f.id]?.metrics);

    // --- Suma global sobre las estrategias simuladas con éxito ---
    const global = (() => {
        if (!simulated.length) return null;
        const initials = simulated.map((f) => f.capital);
        const finals = simulated.map((f) => results[f.id].metrics!.final_balance);
        const curve = aggregateEquity(simulated.map((f) => results[f.id].equity), initials);
        const initial = initials.reduce((a, b) => a + b, 0);
        const final = finals.reduce((a, b) => a + b, 0);
        const net = +(final - initial).toFixed(2);
        const ops = simulated.reduce((a, f) => a + (results[f.id].metrics!.total_trades || 0), 0);
        const costs = +simulated.reduce((a, f) => a + (results[f.id].metrics!.total_costs || 0), 0).toFixed(2);
        const wins = simulated.reduce((a, f) => a + (results[f.id].metrics!.win_rate || 0) * (results[f.id].metrics!.total_trades || 0), 0);
        return {
            initial, final, net,
            return_pct: initial ? +(net / initial * 100).toFixed(2) : 0,
            max_drawdown_pct: maxDrawdownPct(curve),
            ops, costs, win_rate: ops ? wins / ops : 0, curve,
        };
    })();

    // Correlación entre estrategias (Fase 7): se calcula en el bridge sobre las
    // series de retornos alineadas. Análisis puro, no toca operaciones.
    useEffect(() => {
        const sims = favorites.filter((f) => selected.has(f.id) && results[f.id]?.metrics);
        if (sims.length < 2) { setCorr(null); return; }
        const series = alignedReturns(sims.map((f) => results[f.id].equity), sims.map((f) => f.capital));
        const labels = sims.map((f) => `${f.pair}·${f.timeframe}·${f.type}`);
        let alive = true;
        window.axios.post('/api/portfolio/correlation', { labels, series })
            .then(({ data }) => { if (alive) setCorr({ labels: data.labels ?? labels, matrix: data.matrix ?? [] }); })
            .catch(() => { if (alive) setCorr(null); });
        return () => { alive = false; };
    }, [results, selected, favorites]);

    return (
        <AppLayout title="Bot Histórico (walk-forward)" wide>
            <Head title="Bot Histórico" />

            {/* Configuración */}
            <section className="mb-4 rounded-lg border border-border bg-bg-surface p-4">
                <div className="mb-3 flex items-center gap-2">
                    <h2 className="text-sm font-semibold">Validación walk-forward</h2>
                    <InfoTooltip text={WF_HELP} />
                </div>
                {favorites.length === 0 ? (
                    <p className="text-sm text-text-secondary">
                        No hay favoritos. Marca estrategias con ☆ en el <Link href="/explorer" className="text-accent hover:underline">Explorador</Link> o el <Link href="/laboratory" className="text-accent hover:underline">Laboratorio</Link>.
                    </p>
                ) : (
                    <>
                        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <Field label="Inicio operación"><input type="date" value={op.date_from} onChange={(e) => setOp((o) => ({ ...o, date_from: e.target.value }))} className="input font-mono" /></Field>
                            <Field label="Fin operación"><input type="date" value={op.date_to} onChange={(e) => setOp((o) => ({ ...o, date_to: e.target.value }))} className="input font-mono" /></Field>
                            <div className="col-span-2 flex items-end">
                                <button type="button" onClick={simulate} disabled={running || selected.size === 0} className="w-full rounded-md bg-accent px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                                    {running ? 'Simulando…' : `Simular ${selected.size || ''} estrategia(s)`}
                                </button>
                            </div>
                        </div>
                        <div className="max-h-52 overflow-auto rounded-md border border-border/60">
                            {favorites.map((f) => {
                                const overlap = f.backtest_to && op.date_from < f.backtest_to;
                                return (
                                    <label key={f.id} className="flex cursor-pointer items-center gap-2 border-b border-border/40 px-3 py-1.5 text-sm last:border-0 hover:bg-bg-elevated">
                                        <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggle(f.id)} />
                                        <span className="font-mono text-xs text-text-primary">{f.pair} · {f.timeframe} · {f.type}</span>
                                        <span className="font-mono text-[11px] text-text-secondary">SL{f.sl_pips ?? '—'}/TP{f.tp_pips ?? '—'} · {f.risk_percent ?? '—'}% · {fmtMoney(f.capital)}</span>
                                        {overlap && <span className="ml-auto text-[10px] text-warning" title="El periodo de operación se solapa con el backtest: no es validación limpia">⚠ solapa backtest</span>}
                                    </label>
                                );
                            })}
                        </div>
                    </>
                )}
                {error && <div className="mt-3 rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">{error}</div>}
            </section>

            {/* Suma global */}
            {global && simulated.length > 1 && (
                <section className="mb-4 rounded-lg border border-accent/40 bg-bg-surface p-4">
                    <h2 className="mb-2 text-sm font-semibold">Suma global ({simulated.length} estrategias · {op.date_from} → {op.date_to})</h2>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
                        <GlobalCard label="Capital inicial" value={fmtMoney(global.initial)} />
                        <GlobalCard label="Capital actual" value={fmtMoney(global.final)} color={global.final >= global.initial ? 'text-profit' : 'text-loss'} />
                        <GlobalCard label="PnL neto global" value={fmtMoney(global.net)} color={global.net >= 0 ? 'text-profit' : 'text-loss'} />
                        <GlobalCard label="Retorno global" value={`${global.return_pct}%`} color={global.return_pct >= 0 ? 'text-profit' : 'text-loss'} />
                        <GlobalCard label="Max DD (curva agregada)" value={`${global.max_drawdown_pct}%`} color="text-loss" help="Drawdown de la curva de equity SUMADA (no la suma de drawdowns individuales)." />
                        <GlobalCard label="Operaciones" value={String(global.ops)} />
                        <GlobalCard label="Costos totales" value={fmtMoney(global.costs)} color="text-warning" />
                    </div>
                    <div className="mt-3">
                        <div className="mb-1 text-[11px] uppercase tracking-wide text-text-secondary">Equity global (suma de todas en el tiempo)</div>
                        <EquityArea curve={global.curve} height={220} />
                    </div>
                </section>
            )}

            {/* Comparativa multi-estrategia */}
            {simulated.length > 1 && (
                <section className="mb-4 rounded-lg border border-border bg-bg-surface p-4">
                    <h2 className="mb-2 text-sm font-semibold">Comparativa</h2>
                    <div className="overflow-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
                                    <th className="px-2 py-1.5">Estrategia</th>
                                    <th className="px-2 py-1.5 text-right">Ret. oper.</th>
                                    <th className="px-2 py-1.5 text-right">Ret. backtest</th>
                                    <th className="px-2 py-1.5 text-right">Anualiz. op/bt</th>
                                    <th className="px-2 py-1.5 text-right">Cumplim.</th>
                                    <th className="px-2 py-1.5 text-right">Win op/bt</th>
                                    <th className="px-2 py-1.5 text-right">DD op/bt</th>
                                    <th className="px-2 py-1.5">Veredicto</th>
                                </tr>
                            </thead>
                            <tbody>
                                {simulated.map((f) => {
                                    const A = results[f.id].metrics!;
                                    const B = f.backtest_metrics;
                                    const bDays = days(f.backtest_from, f.backtest_to);
                                    const annA = annualize(A.return_pct, opDays);
                                    const annB = B ? annualize(Number(B.return_pct), bDays) : 0;
                                    const v = verdictOf(annA, annB, !!A.blown);
                                    const ratio = annB > 0 ? annA / annB : null;
                                    return (
                                        <tr key={f.id} className="border-b border-border/40 last:border-0">
                                            <td className="px-2 py-1.5 font-mono text-xs">{f.pair}·{f.timeframe}·{f.type}</td>
                                            <td className={`px-2 py-1.5 text-right font-mono text-xs ${A.return_pct >= 0 ? 'text-profit' : 'text-loss'}`}>{A.return_pct}%</td>
                                            <td className="px-2 py-1.5 text-right font-mono text-xs text-text-secondary">{B ? `${B.return_pct}%` : '—'}</td>
                                            <td className="px-2 py-1.5 text-right font-mono text-xs">{annA.toFixed(1)}/{annB.toFixed(1)}%</td>
                                            <td className="px-2 py-1.5 text-right font-mono text-xs">{ratio != null ? `${Math.round(ratio * 100)}%` : '—'}</td>
                                            <td className="px-2 py-1.5 text-right font-mono text-xs">{(A.win_rate * 100).toFixed(0)}/{B ? (Number(B.win_rate) * 100).toFixed(0) : '—'}%</td>
                                            <td className="px-2 py-1.5 text-right font-mono text-xs text-loss">{A.max_drawdown_pct}/{B ? B.max_drawdown_pct : '—'}%</td>
                                            <td className="px-2 py-1.5"><span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${VERDICT[v].cls}`}>{VERDICT[v].label}</span></td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div className="mt-3">
                        <div className="mb-1 text-[11px] uppercase tracking-wide text-text-secondary">Curvas de equity superpuestas</div>
                        <OverlaidEquity favs={simulated} results={results} height={240} />
                    </div>
                </section>
            )}

            {/* Correlación entre estrategias (Fase 7) */}
            {corr && corr.matrix.length > 1 && (
                <section className="mb-4 rounded-lg border border-border bg-bg-surface p-4">
                    <h2 className="mb-1 inline-flex items-center gap-1 text-sm font-semibold">Correlación entre estrategias<InfoTooltip text={CORR_HELP} /></h2>
                    <p className="mb-2 text-[11px] text-text-secondary">Sobre los retornos del periodo. Cerca de +1 = se mueven juntas (diversificación FALSA); cerca de 0 o negativo = diversificación REAL. En crisis, las correlaciones tienden a 1.0 (P6).</p>
                    <CorrelationMatrix labels={corr.labels} matrix={corr.matrix} />
                </section>
            )}

            {/* Tarjeta por estrategia */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {selectedFavs.map((f) => {
                    const res = results[f.id];
                    if (!res) return null;
                    return <StrategyCard key={f.id} fav={f} res={res} opDays={opDays} op={op} />;
                })}
            </div>

            {running && <ProgressModal title="Simulando walk-forward…" detail={`${selectedFavs[progress.done]?.pair ?? ''} · estrategia ${progress.done + 1} de ${progress.total}`} value={progress.done} max={progress.total} />}
        </AppLayout>
    );
}

function StrategyCard({ fav, res, opDays, op }: { fav: Favorite; res: SimResult; opDays: number; op: { date_from: string; date_to: string } }) {
    const [showTrades, setShowTrades] = useState(false);
    // Régimen del periodo de OPERACIÓN (el del backtest viene en el favorito).
    const [opRegime, setOpRegime] = useState<RegimeLabel | null | undefined>(undefined);
    const [calEvents, setCalEvents] = useState<CalEvent[]>([]);
    useEffect(() => {
        let alive = true;
        window.axios.get(`/api/market/regime/${encodeURIComponent(fav.pair)}`, { params: { timeframe: fav.timeframe, from: op.date_from, to: op.date_to } })
            .then(({ data }) => { if (alive) setOpRegime(data?.regime ?? null); })
            .catch(() => { if (alive) setOpRegime(null); });
        window.axios.get('/api/calendar/events', { params: { symbol: fav.pair, from: op.date_from, to: op.date_to, impact: 'high' } })
            .then(({ data }) => { if (alive) setCalEvents(data?.events ?? []); })
            .catch(() => { if (alive) setCalEvents([]); });
        return () => { alive = false; };
    }, [fav.pair, fav.timeframe, op.date_from, op.date_to]);
    if (res.error) {
        return <div className="rounded-lg border border-loss/40 bg-bg-surface p-4 text-sm text-loss">{fav.pair}·{fav.timeframe}: {res.error}</div>;
    }
    const A = res.metrics!;
    const B = fav.backtest_metrics;
    const bDays = days(fav.backtest_from, fav.backtest_to);
    // Expectativa en R desde win% y R/R (TP/SL) del favorito; comparable A vs B.
    const expR = (win: number | null | undefined) =>
        win != null && fav.sl_pips ? win * ((fav.tp_pips ?? 0) / fav.sl_pips) - (1 - win) : null;
    const fmtR = (v: number | null) => (v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}R` : '—');
    const fmtN = (v: number | null | undefined) => (v != null ? fmtNumber(Number(v)) : '—');
    // Contexto de noticias (Fase 6): ¿qué operaciones coinciden con eventos de alto
    // impacto? CONTEXTUALIZA outliers, no prueba causa.
    const EV_WIN = 60;
    const nearEvent = (t: BacktestTrade) => eventNear(t.exit_time, calEvents, EV_WIN) ?? eventNear(t.entry_time, calEvents, EV_WIN);
    const tradesNear = res.trades.filter(nearEvent).length;
    const worst = res.trades.length ? res.trades.reduce((a, b) => (b.pnl < a.pnl ? b : a)) : null;
    const worstEvent = worst ? nearEvent(worst) : null;
    const annA = annualize(A.return_pct, opDays);
    const annB = B ? annualize(Number(B.return_pct), bDays) : 0;
    const v = verdictOf(annA, annB, !!A.blown);
    const ratio = annB > 0 ? annA / annB : null;

    return (
        <div className="rounded-lg border border-border bg-bg-surface p-4">
            <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="text-sm font-semibold text-text-primary">{fav.name}</div>
                    <div className="font-mono text-[11px] text-text-secondary" title={paramsLabel(fav.params)}>
                        {paramsLabel(fav.params)} · SL{fav.sl_pips ?? '—'}/TP{fav.tp_pips ?? '—'} · {fav.risk_percent ?? '—'}% · {fmtMoney(fav.capital)}
                    </div>
                </div>
                <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold ${VERDICT[v].cls}`} title={ratio != null ? `Logró ${Math.round(ratio * 100)}% del retorno anualizado del backtest` : 'Backtest no rentable: sin referencia'}>
                    {VERDICT[v].label}
                </span>
            </div>

            {/* Régimen: backtest (snapshot del favorito) vs operación */}
            <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="inline-flex items-center gap-1 text-text-secondary">Régimen<InfoTooltip text={REGIME_WF_HELP} /></span>
                <span className="text-text-secondary">backtest:</span>
                {fav.regime
                    ? <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${REGIME_META[fav.regime].badge}`} title={REGIME_META[fav.regime].help}>{REGIME_META[fav.regime].label}</span>
                    : <span className="text-text-secondary">—</span>}
                <span className="text-text-secondary">· operación:</span>
                {opRegime === undefined
                    ? <span className="text-text-secondary">…</span>
                    : opRegime
                        ? <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${REGIME_META[opRegime].badge}`} title={REGIME_META[opRegime].help}>{REGIME_META[opRegime].label}</span>
                        : <span className="text-text-secondary">—</span>}
                {(() => { const mv = matchVerdict(fav.type, opRegime ?? null); return mv.verdict
                    ? <span className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${mv.badge}`} title={mv.help}>{mv.label}</span>
                    : null; })()}
            </div>

            {/* Contexto de noticias (Fase 6): coincidencias con eventos de alto impacto */}
            {calEvents.length > 0 && (
                <div className="mb-2 text-[11px] text-text-secondary" title="Coincidencia temporal con eventos de alto impacto (±60 min). Es CONTEXTO, no causa probada.">
                    <span className="inline-flex items-center gap-1">Noticias:</span>{' '}
                    {tradesNear} de {res.trades.length} ops coinciden con eventos de alto impacto
                    {worstEvent && (
                        <span className="text-loss"> · la peor pérdida ({fmtMoney(worst!.pnl)}) coincide con {worstEvent.title}{worstEvent.status === 'por_verificar' ? ' (fecha por verificar)' : ''}</span>
                    )}
                </div>
            )}

            {/* Tabla A / B / Δ */}
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-text-secondary">
                        <th className="py-1 font-medium">Métrica</th>
                        <th className="py-1 text-right font-medium">Backtest</th>
                        <th className="py-1 text-right font-medium">Operación</th>
                        <th className="py-1 text-right font-medium">Δ</th>
                    </tr>
                </thead>
                <tbody className="font-mono text-xs">
                    <Row label="Retorno %" b={B ? `${B.return_pct}%` : '—'} a={`${A.return_pct}%`} d={B ? `${(A.return_pct - Number(B.return_pct)).toFixed(1)}` : '—'} good={A.return_pct >= 0} />
                    <Row label="Retorno anualizado %" b={B ? `${annB.toFixed(1)}%` : '—'} a={`${annA.toFixed(1)}%`} d={ratio != null ? `${Math.round(ratio * 100)}% cumplido` : '—'} good={annA >= 0} />
                    <Row label="Win rate" b={B ? `${(Number(B.win_rate) * 100).toFixed(0)}%` : '—'} a={`${(A.win_rate * 100).toFixed(0)}%`} d={B ? `${((A.win_rate - Number(B.win_rate)) * 100).toFixed(0)}pp` : '—'} good />
                    <Row label="Profit factor" b={B && B.profit_factor != null ? fmtNumber(Number(B.profit_factor)) : '—'} a={A.profit_factor != null ? fmtNumber(A.profit_factor) : '—'} d="—" good />
                    <Row label="Max drawdown %" b={B ? `${B.max_drawdown_pct}%` : '—'} a={`${A.max_drawdown_pct}%`} d={B ? `${(A.max_drawdown_pct - Number(B.max_drawdown_pct)).toFixed(1)}` : '—'} good={false} />
                    <Row label="Sharpe" b={fmtN(B?.sharpe)} a={fmtN(A.sharpe)} d="—" good={A.sharpe >= 0} />
                    <Row label="Sortino" b={fmtN(B?.sortino)} a={fmtN(A.sortino)} d="—" good={A.sortino >= 0} />
                    <Row label="Calmar" b={fmtN(B?.calmar)} a={fmtN(A.calmar)} d="—" good={(A.calmar ?? 0) >= 0} />
                    <Row label="Expectativa (R)" b={fmtR(expR(B ? Number(B.win_rate) : null))} a={fmtR(expR(A.win_rate))} d="—" good={(expR(A.win_rate) ?? 0) >= 0} />
                    <Row label="PnL neto" b={B ? fmtMoney(Number(B.net_pnl)) : '—'} a={fmtMoney(A.net_pnl)} d="" good={A.net_pnl >= 0} />
                    <Row label="Capital final" b={B ? fmtMoney(Number(B.final_balance)) : '—'} a={fmtMoney(A.final_balance)} d="" good={A.final_balance >= fav.capital} />
                    <Row label="Operaciones" b={B ? String(B.total_trades) : '—'} a={String(A.total_trades)} d="" good />
                </tbody>
            </table>
            {A.blown && <div className="mt-2 rounded border border-loss/40 bg-loss/10 px-2 py-1 text-[11px] text-loss">Cuenta quebrada en el periodo de operación.</div>}

            {/* Gráfica de evolución (equity) */}
            <div className="mt-3">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-text-secondary">Evolución del capital (operación)</div>
                <EquityArea curve={res.equity} height={180} />
            </div>

            {/* Gráfica de trading (lazy) */}
            <button type="button" onClick={() => setShowTrades((s) => !s)} className="mt-2 text-[11px] text-accent hover:underline">
                {showTrades ? 'Ocultar' : 'Ver'} gráfica de trading ({A.total_trades} ops)
            </button>
            {showTrades && <TradingChartLazy pair={fav.pair} timeframe={fav.timeframe} from={op.date_from} to={op.date_to} trades={res.trades} />}
        </div>
    );
}

function Row({ label, b, a, d, good }: { label: string; b: string; a: string; d: string; good: boolean }) {
    return (
        <tr className="border-t border-border/30">
            <td className="py-1 text-text-secondary">{label}</td>
            <td className="py-1 text-right text-text-secondary">{b}</td>
            <td className={`py-1 text-right ${good ? 'text-profit' : 'text-loss'}`}>{a}</td>
            <td className="py-1 text-right text-text-secondary">{d}</td>
        </tr>
    );
}

function GlobalCard({ label, value, color, help }: { label: string; value: string; color?: string; help?: string }) {
    return (
        <div className="rounded-lg border border-border bg-bg-elevated px-3 py-2">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-text-secondary">{label}{help && <InfoTooltip text={help} />}</div>
            <div className={`font-mono text-base font-semibold ${color ?? 'text-text-primary'}`}>{value}</div>
        </div>
    );
}

function corrColor(v: number | null): string {
    if (v == null) return 'bg-bg-elevated text-text-secondary';
    if (v >= 0.7) return 'bg-loss/30 text-loss';            // muy correlacionadas → diversif. falsa
    if (v >= 0.3) return 'bg-warning/20 text-warning';
    if (v > -0.3) return 'bg-bg-elevated text-text-primary'; // independientes
    return 'bg-profit/20 text-profit';                      // se compensan
}

function CorrelationMatrix({ labels, matrix }: { labels: string[]; matrix: (number | null)[][] }) {
    return (
        <div className="overflow-auto">
            <table className="text-xs font-mono">
                <thead>
                    <tr>
                        <th className="p-1" />
                        {labels.map((l, i) => (<th key={i} className="p-1 text-text-secondary" title={l}>{i + 1}</th>))}
                    </tr>
                </thead>
                <tbody>
                    {matrix.map((row, i) => (
                        <tr key={i}>
                            <td className="whitespace-nowrap p-1 pr-2 text-right text-text-secondary" title={labels[i]}>{i + 1}. {labels[i]}</td>
                            {row.map((v, j) => (
                                <td key={j} className={`p-1 text-center ${corrColor(v)}`} title={`${labels[i]} ↔ ${labels[j]}`}>{v == null ? '—' : v.toFixed(2)}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function EquityArea({ curve, height = 180 }: { curve: EquityPoint[]; height?: number }) {
    if (!curve.length) return <p className="text-xs text-text-secondary">Sin datos de equity.</p>;
    const data = curve.map((p) => ({ t: new Date((p.time + DISPLAY_TZ_OFFSET_SECONDS) * 1000).toLocaleDateString(), equity: p.equity }));
    return (
        <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#1c1e24" strokeDasharray="3 3" />
                <XAxis dataKey="t" tick={{ fontSize: 9, fill: '#8b8fa8' }} minTickGap={40} />
                <YAxis tick={{ fontSize: 9, fill: '#8b8fa8' }} width={52} domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ background: '#141519', border: '1px solid #2a2d36', fontSize: 11 }} />
                <Area type="monotone" dataKey="equity" stroke="#26A69A" fill="#26A69A22" strokeWidth={1.5} />
            </AreaChart>
        </ResponsiveContainer>
    );
}

function OverlaidEquity({ favs, results, height }: { favs: Favorite[]; results: Record<number, SimResult>; height: number }) {
    // Une por fecha (string) las equities normalizadas a % sobre el capital inicial.
    const map = new Map<string, Record<string, number | string>>();
    favs.forEach((f) => {
        const cap = f.capital || 1;
        results[f.id].equity.forEach((p) => {
            const key = new Date((p.time + DISPLAY_TZ_OFFSET_SECONDS) * 1000).toLocaleDateString();
            const row = map.get(key) ?? { t: key };
            row[`s${f.id}`] = +((p.equity - cap) / cap * 100).toFixed(2);
            map.set(key, row);
        });
    });
    const data = [...map.values()];
    return (
        <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#1c1e24" strokeDasharray="3 3" />
                <XAxis dataKey="t" tick={{ fontSize: 9, fill: '#8b8fa8' }} minTickGap={40} />
                <YAxis tick={{ fontSize: 9, fill: '#8b8fa8' }} width={44} tickFormatter={(v) => `${v}%`} />
                <Tooltip contentStyle={{ background: '#141519', border: '1px solid #2a2d36', fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {favs.map((f, i) => (
                    <Line key={f.id} type="monotone" dataKey={`s${f.id}`} name={`${f.pair}·${f.timeframe}`} stroke={PALETTE[i % PALETTE.length]} dot={false} strokeWidth={1.3} connectNulls />
                ))}
            </LineChart>
        </ResponsiveContainer>
    );
}

function TradingChartLazy({ pair, timeframe, from, to, trades }: { pair: string; timeframe: string; from: string; to: string; trades: BacktestTrade[] }) {
    const [candles, setCandles] = useState<Candle[] | null>(null);
    useEffect(() => {
        let alive = true;
        window.axios.get(`/api/market/candles/${encodeURIComponent(pair)}`, { params: { timeframe, from, to } })
            .then(({ data }) => { if (alive) setCandles((data.data ?? []) as Candle[]); })
            .catch(() => { if (alive) setCandles([]); });
        return () => { alive = false; };
    }, [pair, timeframe, from, to]);
    if (candles === null) return <p className="mt-2 text-xs text-text-secondary">Cargando velas…</p>;
    if (!candles.length) return <p className="mt-2 text-xs text-text-secondary">Sin velas para el periodo.</p>;
    return <div className="mt-2"><BacktestChart candles={candles} trades={trades} height={260} /></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return <label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-text-secondary">{label}</span>{children}</label>;
}
