import { Head, Link, router } from '@inertiajs/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import AppLayout from '@/Layouts/AppLayout';
import BotLiveChart from '@/Components/BotLiveChart';
import BotDecisionPanel from '@/Components/BotDecisionPanel';
import BotHistoryTable from '@/Components/BotHistoryTable';
import TradeDetail from '@/Components/TradeDetail';
import LiveClock from '@/Components/LiveClock';
import { fmtMoney, fmtTimeMs, pnlColor } from '@/lib/format';
import { type CalEvent, fmtEventUtc } from '@/lib/calendar';
import type { BotClosedTrade, BotEvent, BotRunSummary, BotSignal, BotStatus, Candle, Favorite, Strategy, TelegramSettings } from '@/types';

interface Props {
    strategies: (Pick<Strategy, 'id' | 'name' | 'pair' | 'timeframe' | 'parameters' | 'version'> & { favorite_id?: number | null })[];
    favorites: Favorite[];
    status: BotStatus;
    telegram: TelegramSettings;
    recentTrades: BotClosedTrade[];
    journal: BotEvent[];
}

/** Lote sugerido desde el riesgo% y capital del favorito (aprox: ~$10/pip por lote). */
const suggestLot = (f: Favorite): number => {
    const risk = f.risk_percent ?? 1;
    const sl = f.sl_pips ?? 20;
    const raw = (f.capital * risk / 100) / (Math.max(1, sl) * 10);
    return Math.max(0.01, Math.round(raw * 100) / 100);
};

const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
type Tab = 'positions' | 'history' | 'log' | 'journal';

const DOT: Record<string, string> = { running: 'bg-profit', paused: 'bg-warning', stopped: 'bg-text-secondary', error: 'bg-loss' };
const STATUS_LABEL: Record<string, string> = { running: 'Activo', paused: 'Pausado', stopped: 'Detenido', error: 'Error' };

export default function Control({ strategies, favorites, status: initialStatus, telegram: initialTelegram, recentTrades, journal: initialJournal }: Props) {
    const [status, setStatus] = useState<BotStatus>(initialStatus);
    const [journal, setJournal] = useState<BotEvent[]>(initialJournal ?? []);
    const [telegram, setTelegram] = useState<TelegramSettings>(initialTelegram);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Formulario "añadir estrategia"
    const [addId, setAddId] = useState<number>(strategies[0]?.id ?? 0);
    const [lot, setLot] = useState(0.01);
    const [dailyLossLimit, setDailyLossLimit] = useState(100);
    const [maxPositions, setMaxPositions] = useState(1);
    const [newsFilter, setNewsFilter] = useState(false);
    const [newsWindowMin, setNewsWindowMin] = useState(15);
    const [upcoming, setUpcoming] = useState<CalEvent[]>([]);
    // Circuit breakers (por estrategia) + portfolio heat (global) — Fase 7.
    const [cbMaxLosses, setCbMaxLosses] = useState(0);
    const [cbMaxDrawdownPct, setCbMaxDrawdownPct] = useState(0);
    const [portfolioHeatPct, setPortfolioHeatPct] = useState(0);
    const [timeframe, setTimeframe] = useState(() => localStorage.getItem('forexbot.bot_tf') ?? '');
    const setTf = (v: string) => { setTimeframe(v); localStorage.setItem('forexbot.bot_tf', v); };

    const [selectedSid, setSelectedSid] = useState<number | null>(null);
    const [filterSid, setFilterSid] = useState<number | null>(null);
    const [tab, setTab] = useState<Tab>(() => (localStorage.getItem('forexbot.bot_tab') as Tab) ?? 'positions');
    const setToolboxTab = (t: Tab) => { setTab(t); localStorage.setItem('forexbot.bot_tab', t); };
    const [selectedSignal, setSelectedSignal] = useState<BotSignal | null>(null);
    const [selectedTrade, setSelectedTrade] = useState<BotClosedTrade | null>(null);
    const [candles, setCandles] = useState<Candle[]>([]);
    const [digits, setDigits] = useState(5);

    const runs = status.runs ?? [];
    const stratById = useMemo(() => Object.fromEntries(strategies.map((s) => [s.id, s])), [strategies]);
    const strategyName = (id?: number) => (id != null ? stratById[id]?.name ?? `#${id}` : '—');
    const addStrategy = strategies.find((s) => s.id === addId);

    // Próximos eventos de alto impacto del símbolo a añadir (defensa en vivo).
    useEffect(() => {
        const sym = addStrategy?.pair;
        if (!sym) { setUpcoming([]); return; }
        let alive = true;
        window.axios.get('/api/calendar/upcoming', { params: { symbol: sym, hours: 168, impact: 'high' } })
            .then(({ data }) => { if (alive) setUpcoming(data?.data?.events ?? []); })
            .catch(() => { if (alive) setUpcoming([]); });
        return () => { alive = false; };
    }, [addStrategy?.pair]);

    useEffect(() => {
        if (runs.length === 0) { setSelectedSid(null); return; }
        if (!runs.some((r) => r.strategy_id === selectedSid)) setSelectedSid(runs[0].strategy_id);
    }, [runs, selectedSid]);

    const selectedRun = runs.find((r) => r.strategy_id === selectedSid) ?? runs[0] ?? null;

    const chart = useMemo(() => {
        if (selectedRun) {
            return { symbol: selectedRun.strategy.symbol, timeframe: selectedRun.strategy.timeframe, type: selectedRun.strategy.type, params: (selectedRun.strategy.params ?? {}) as Record<string, number | string>, lot: selectedRun.config.lot };
        }
        const p = addStrategy?.parameters;
        return { symbol: addStrategy?.pair ?? 'EURUSD', timeframe: timeframe || addStrategy?.timeframe || 'H1', type: p?.type ?? 'ma_cross', params: (p?.indicators ?? {}) as Record<string, number | string>, lot };
    }, [selectedRun, addStrategy, timeframe, lot]);

    const fetchCandles = useRef<() => void>(() => {});
    fetchCandles.current = async () => {
        try {
            const { data } = await window.axios.get(`/api/market/candles/${encodeURIComponent(chart.symbol)}`, { params: { timeframe: chart.timeframe, count: 300 } });
            if (data.data) setCandles(data.data as Candle[]);
        } catch { /* bridge */ }
    };
    useEffect(() => {
        setCandles([]);
        fetchCandles.current();
        const id = window.setInterval(() => fetchCandles.current(), 15000);
        return () => window.clearInterval(id);
    }, [chart.symbol, chart.timeframe]);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const { data } = await window.axios.get(`/api/market/symbol/${encodeURIComponent(chart.symbol)}`);
                if (alive && data.data?.digits) setDigits(Number(data.data.digits));
            } catch { /* default 5 */ }
        })();
        return () => { alive = false; };
    }, [chart.symbol]);

    const poll = useRef<() => void>(() => {});
    poll.current = async () => {
        try {
            const { data } = await window.axios.get('/bot/status');
            setStatus(data as BotStatus);
            if (data.journal) setJournal(data.journal as BotEvent[]);
        } catch { /* bridge */ }
    };
    useEffect(() => {
        const id = window.setInterval(() => poll.current(), 3000);
        const ch = window.Echo?.channel('bot');
        ch?.listen('.bot.updated', (e: { status: BotStatus }) => setStatus(e.status));
        return () => { window.clearInterval(id); ch?.stopListening('.bot.updated'); };
    }, []);

    const action = async (url: string, body?: Record<string, unknown>) => {
        setBusy(true);
        setError(null);
        try {
            const { data } = await window.axios.post(url, body ?? {});
            if (data.status) setStatus(data.status as BotStatus);
            else poll.current();
        } catch (e: unknown) {
            const err = e as { response?: { data?: { error?: string } } };
            setError(err.response?.data?.error ?? 'La operación falló.');
        } finally {
            setBusy(false);
        }
    };

    const add = () => action('/bot/start', { strategy_id: addId, lot, daily_loss_limit: dailyLossLimit, max_positions: maxPositions, timeframe: timeframe || addStrategy?.timeframe, news_filter: newsFilter, news_window_min: newsWindowMin, cb_max_losses: cbMaxLosses, cb_max_drawdown_pct: cbMaxDrawdownPct, portfolio_heat_pct: portfolioHeatPct });
    const panic = () => { if (confirm('¿Cerrar TODAS las posiciones de TODAS las estrategias y detener el bot?')) action('/bot/panic'); };

    // --- Cargar desde Favoritos (Fase 8) ---
    const [favSel, setFavSel] = useState<Set<number>>(new Set());
    const [confirmRows, setConfirmRows] = useState<{ fav: Favorite; lot: number }[] | null>(null);
    const toggleFav = (id: number) => setFavSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const openConfirm = () => {
        const rows = favorites.filter((f) => favSel.has(f.id)).map((f) => ({ fav: f, lot: suggestLot(f) }));
        if (rows.length) setConfirmRows(rows);
    };
    const setConfirmLot = (id: number, lot: number) => setConfirmRows((rows) => rows?.map((r) => (r.fav.id === id ? { ...r, lot } : r)) ?? null);
    const confirmLoad = async () => {
        if (!confirmRows) return;
        await action('/bot/load-favorites', {
            favorites: confirmRows.map((r) => ({ favorite_id: r.fav.id, lot: r.lot })),
            daily_loss_limit: dailyLossLimit, max_positions: maxPositions,
            news_filter: newsFilter, news_window_min: newsWindowMin,
            cb_max_losses: cbMaxLosses, cb_max_drawdown_pct: cbMaxDrawdownPct, portfolio_heat_pct: portfolioHeatPct,
        });
        setConfirmRows(null);
        setFavSel(new Set());
        // Refresca la lista de estrategias para que la traza "★ favorito" aparezca.
        router.reload({ only: ['strategies', 'favorites'] });
    };

    const dailyPnl = status.daily_pnl ?? 0;
    const positions = status.positions ?? [];
    const chartPositions = selectedRun ? positions.filter((p) => p.strategy_id === selectedRun.strategy_id) : [];
    const chartSignals = selectedRun ? (status.signals ?? []).filter((s) => s.strategy_id === selectedRun.strategy_id) : [];
    const chartClosed = selectedRun ? (status.closed_trades ?? []).filter((t) => t.strategy_id === selectedRun.strategy_id) : [];

    const history = useMemo(() => {
        const map = new Map<number, BotClosedTrade>();
        for (const t of recentTrades) map.set(t.ticket, t);
        for (const t of status.closed_trades ?? []) map.set(t.ticket, t);
        return Array.from(map.values()).sort((a, b) => (b.close_at ?? '').localeCompare(a.close_at ?? ''));
    }, [recentTrades, status.closed_trades]);

    const byFilter = <T extends { strategy_id?: number }>(items: T[]) => (filterSid == null ? items : items.filter((i) => i.strategy_id === filterSid));

    return (
        <AppLayout title="Bot multi-estrategia">
            <Head title="Bot" />

            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <span className={`h-3 w-3 rounded-full ${DOT[status.status] ?? DOT.stopped} ${status.status === 'running' || status.status === 'error' ? 'animate-pulse-dot' : ''}`} />
                    <div>
                        <div className="text-sm font-semibold">Bot: {STATUS_LABEL[status.status] ?? '—'} · {runs.filter((r) => r.status === 'running').length} activas</div>
                        <div className="font-mono text-xs text-text-secondary">PnL día: <span className={pnlColor(dailyPnl)}>{fmtMoney(dailyPnl)}</span></div>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <LiveClock />
                    <button type="button" onClick={panic} disabled={busy} className="rounded-md bg-loss px-5 py-2.5 text-sm font-bold text-white shadow-lg hover:opacity-90 disabled:opacity-50">PANIC — Cerrar todo</button>
                </div>
            </div>

            {error && <div className="mb-4 rounded-lg border border-loss/40 bg-loss/10 px-4 py-2 text-sm text-loss">{error}</div>}

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
                {/* SIDEBAR */}
                <div className="space-y-5">
                    {/* Añadir estrategia */}
                    <section className="rounded-lg border border-border bg-bg-surface p-4">
                        <h2 className="mb-3 text-sm font-semibold">Añadir estrategia</h2>
                        <label className="mb-3 block">
                            <span className="mb-1 block text-[11px] uppercase tracking-wide text-text-secondary">Estrategia</span>
                            <select value={addId} onChange={(e) => setAddId(Number(e.target.value))} className="input">
                                {strategies.map((s) => (<option key={s.id} value={s.id}>{s.name} v{s.version} ({s.pair} · {s.timeframe})</option>))}
                            </select>
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                            <FieldLab label="Lote fijo"><input type="number" step={0.01} min={0.01} value={lot} onChange={(e) => setLot(Number(e.target.value))} className="input font-mono" /></FieldLab>
                            <FieldLab label="Timeframe">
                                <select value={timeframe || addStrategy?.timeframe || 'H1'} onChange={(e) => setTf(e.target.value)} className="input font-mono">
                                    {TIMEFRAMES.map((tf) => (<option key={tf} value={tf}>{tf}</option>))}
                                </select>
                            </FieldLab>
                            <FieldLab label="Límite pérdida diaria"><input type="number" min={0} value={dailyLossLimit} onChange={(e) => setDailyLossLimit(Number(e.target.value))} className="input font-mono" /></FieldLab>
                            <FieldLab label="Máx posiciones"><input type="number" min={1} max={20} value={maxPositions} onChange={(e) => setMaxPositions(Number(e.target.value))} className="input font-mono" /></FieldLab>
                        </div>

                        {/* Capa defensiva (Fase 6): pausa por noticias de alto impacto */}
                        <div className="mt-3 rounded-md border border-border/60 bg-bg-elevated/40 p-2.5">
                            <label className="flex items-center gap-2 text-xs text-text-primary" title="Gestión de riesgo: durante NFP/FOMC/CPI los spreads se ensanchan y los stops se vuelven teóricos. Con esto el bot NO abre nuevas posiciones dentro de la ventana.">
                                <input type="checkbox" checked={newsFilter} onChange={(e) => setNewsFilter(e.target.checked)} />
                                <span>Pausar en noticias de alto impacto</span>
                            </label>
                            {newsFilter && (
                                <div className="mt-2 flex items-center gap-2 text-[11px] text-text-secondary">
                                    <span>Ventana ±</span>
                                    <input type="number" min={1} max={120} value={newsWindowMin} onChange={(e) => setNewsWindowMin(Number(e.target.value))} className="input font-mono w-16" />
                                    <span>min · no abre cerca de NFP/FOMC/CPI</span>
                                </div>
                            )}
                            {upcoming.length > 0 && (
                                <div className="mt-2 text-[11px]">
                                    <div className="mb-0.5 text-text-secondary">Próximos eventos ({addStrategy?.pair}):</div>
                                    {upcoming.slice(0, 3).map((e, i) => (
                                        <div key={i} className="font-mono text-text-secondary">{fmtEventUtc(e.time)} · {e.currency} · {e.title}</div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Circuit breakers (Fase 7): pausa por racha/drawdown (OFF si 0) */}
                        <div className="mt-3 rounded-md border border-border/60 bg-bg-elevated/40 p-2.5">
                            <div className="mb-1.5 text-[11px] uppercase tracking-wide text-text-secondary" title="Una racha de pérdidas o un drawdown brusco pueden señalar un cambio de régimen. Al saltar, la estrategia se PAUSA (no se detiene) para que revises y reanudes.">Circuit breakers (0 = off)</div>
                            <div className="grid grid-cols-2 gap-3">
                                <FieldLab label="Máx pérdidas seguidas"><input type="number" min={0} max={50} value={cbMaxLosses} onChange={(e) => setCbMaxLosses(Number(e.target.value))} className="input font-mono" /></FieldLab>
                                <FieldLab label="Máx drawdown %"><input type="number" min={0} max={100} step={0.5} value={cbMaxDrawdownPct} onChange={(e) => setCbMaxDrawdownPct(Number(e.target.value))} className="input font-mono" /></FieldLab>
                            </div>
                        </div>

                        {/* Portfolio heat global (Fase 7) */}
                        <div className="mt-3 rounded-md border border-border/60 bg-bg-elevated/40 p-2.5">
                            <FieldLab label="Límite de portfolio heat % (riesgo agregado, 0 = off)">
                                <input type="number" min={0} max={100} step={0.5} value={portfolioHeatPct} onChange={(e) => setPortfolioHeatPct(Number(e.target.value))} className="input font-mono" />
                            </FieldLab>
                            <HeatGauge used={status.portfolio_heat_used_pct ?? 0} limit={status.portfolio_heat_pct ?? portfolioHeatPct} />
                            <p className="mt-1 text-[11px] text-text-secondary" title="Suma del riesgo (distancia al SL × valor) de TODAS las posiciones del bot / capital. Límite global único (regla del ~6%).">Riesgo agregado en uso vs límite global. No abre nuevas posiciones si se superaría.</p>
                        </div>

                        <button type="button" onClick={add} disabled={busy || !addId} className="mt-4 w-full rounded-md bg-profit px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50">+ Añadir a la ejecución</button>
                        <p className="mt-2 text-[11px] text-text-secondary">Cada estrategia opera con su propio lote y límites (riesgo independiente).</p>
                    </section>

                    {/* Cargar desde Favoritos (Fase 8) */}
                    <section className="rounded-lg border border-border bg-bg-surface p-4">
                        <div className="mb-2 flex items-center justify-between">
                            <h2 className="text-sm font-semibold">Cargar desde Favoritos</h2>
                            <Link href="/favorites" className="text-[11px] text-accent hover:underline">Ver favoritos</Link>
                        </div>
                        {favorites.length === 0 ? (
                            <p className="text-[11px] text-text-secondary">Sin favoritos. Marca candidatas con ☆ en el Explorador o el Laboratorio.</p>
                        ) : (
                            <>
                                <div className="max-h-44 overflow-auto rounded-md border border-border/60">
                                    {favorites.map((f) => (
                                        <label key={f.id} className="flex cursor-pointer items-center gap-2 border-b border-border/40 px-2 py-1.5 text-xs last:border-0 hover:bg-bg-elevated">
                                            <input type="checkbox" checked={favSel.has(f.id)} onChange={() => toggleFav(f.id)} />
                                            <span className="font-mono text-text-primary">{f.pair}·{f.timeframe}·{f.type}</span>
                                            <span className="ml-auto font-mono text-[10px] text-text-secondary">SL{f.sl_pips ?? '—'}/TP{f.tp_pips ?? '—'} · {f.risk_percent ?? '—'}%</span>
                                        </label>
                                    ))}
                                </div>
                                <button type="button" onClick={openConfirm} disabled={busy || favSel.size === 0} className="mt-3 w-full rounded-md border border-accent px-4 py-2 text-sm font-semibold text-accent hover:bg-accent/10 disabled:opacity-50">
                                    Cargar {favSel.size || ''} al bot…
                                </button>
                                <p className="mt-2 text-[11px] text-text-secondary">Verás un resumen de confirmación antes de operar.</p>
                            </>
                        )}
                    </section>

                    {/* Estrategias activas */}
                    <section className="rounded-lg border border-border bg-bg-surface p-4">
                        <h2 className="mb-3 text-sm font-semibold">Estrategias activas ({runs.length})</h2>
                        {runs.length === 0 ? (
                            <p className="py-3 text-center text-sm text-text-secondary">Ninguna. Añade una arriba.</p>
                        ) : (
                            <div className="space-y-2">
                                {runs.map((r) => (
                                    <RunRow key={r.strategy_id} run={r} name={strategyName(r.strategy_id)} selected={r.strategy_id === selectedRun?.strategy_id} busy={busy}
                                        onSelect={() => setSelectedSid(r.strategy_id)}
                                        onPause={() => action('/bot/pause', { strategy_id: r.strategy_id })}
                                        onResume={() => action('/bot/resume', { strategy_id: r.strategy_id })}
                                        onStop={() => action('/bot/stop', { strategy_id: r.strategy_id })}
                                        onRemove={() => action('/bot/remove', { strategy_id: r.strategy_id })}
                                    />
                                ))}
                            </div>
                        )}
                    </section>

                    <Exposure exposure={status.exposure ?? {}} />
                    <TelegramPanel telegram={telegram} setTelegram={setTelegram} />
                </div>

                {/* MAIN */}
                <div className="min-w-0 space-y-5">
                    <section className="rounded-lg border border-border bg-bg-surface p-2">
                        <div className="mb-1 flex items-center justify-between px-2 pt-1">
                            <h2 className="text-sm font-semibold">
                                {selectedRun ? `${strategyName(selectedRun.strategy_id)} · ` : ''}{chart.symbol} · {chart.timeframe} · {chart.type}
                            </h2>
                            {runs.length > 1 && (
                                <select value={selectedRun?.strategy_id ?? ''} onChange={(e) => setSelectedSid(Number(e.target.value))} className="input max-w-[180px] py-1 text-xs">
                                    {runs.map((r) => (<option key={r.strategy_id} value={r.strategy_id}>{strategyName(r.strategy_id)}</option>))}
                                </select>
                            )}
                        </div>
                        {candles.length === 0 ? (
                            <p className="p-10 text-center text-sm text-text-secondary">Cargando velas…</p>
                        ) : (
                            <BotLiveChart candles={candles} digits={digits} strategyType={chart.type} params={chart.params} signals={chartSignals} positions={chartPositions} closedTrades={chartClosed} onSelectSignal={setSelectedSignal} />
                        )}
                    </section>

                    {selectedSignal && <BotDecisionPanel signal={selectedSignal} strategyType={chart.type} params={chart.params} lot={chart.lot} digits={digits} onClose={() => setSelectedSignal(null)} />}

                    {/* TOOLBOX */}
                    <section className="rounded-lg border border-border bg-bg-surface">
                        <div className="flex flex-wrap items-center gap-1 border-b border-border p-1">
                            {([['positions', `Posiciones (${positions.length})`], ['history', 'Historial'], ['log', 'Log de señales'], ['journal', 'Journal']] as [Tab, string][]).map(([t, label]) => (
                                <button key={t} type="button" onClick={() => setToolboxTab(t)} className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === t ? 'bg-bg-elevated text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}>{label}</button>
                            ))}
                            <select value={filterSid ?? ''} onChange={(e) => setFilterSid(e.target.value ? Number(e.target.value) : null)} className="input ml-auto max-w-[180px] py-1 text-xs">
                                <option value="">Todas las estrategias</option>
                                {runs.map((r) => (<option key={r.strategy_id} value={r.strategy_id}>{strategyName(r.strategy_id)}</option>))}
                            </select>
                        </div>
                        <div>
                            {tab === 'positions' && <PositionsTable positions={byFilter(positions)} digits={digits} strategyName={strategyName} />}
                            {tab === 'history' && <BotHistoryTable trades={byFilter(history)} digits={digits} strategyName={strategyName} onSelect={setSelectedTrade} />}
                            {tab === 'log' && <LogTable signals={byFilter(status.signals ?? [])} strategyName={strategyName} onSelect={setSelectedSignal} />}
                            {tab === 'journal' && <Journal events={byFilter(journal)} strategyName={strategyName} />}
                        </div>
                    </section>
                </div>
            </div>

            {selectedTrade && (
                <TradeDetail trade={selectedTrade} symbol={selectedTrade.symbol} timeframe={chart.timeframe} digits={digits} strategyType={chart.type} params={chart.params} onClose={() => setSelectedTrade(null)} />
            )}

            {confirmRows && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setConfirmRows(null)}>
                    <div onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl rounded-lg border border-border bg-bg-surface p-5 shadow-2xl">
                        <h2 className="mb-1 text-sm font-semibold">Confirmar antes de operar</h2>
                        <p className="mb-3 text-xs text-text-secondary">Revisa cada estrategia. Se añadirán a la ejecución del bot (demo) con su lote.</p>

                        <div className="max-h-[50vh] space-y-2 overflow-auto">
                            {confirmRows.map(({ fav, lot }) => (
                                <div key={fav.id} className="rounded-md border border-border bg-bg-elevated p-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-mono text-sm text-text-primary">{fav.pair} · {fav.timeframe} · {fav.type}</span>
                                        <span className="text-[11px] text-warning">★ {fav.name}</span>
                                    </div>
                                    <div className="mt-1 font-mono text-[11px] text-text-secondary">
                                        {Object.entries(fav.params).map(([k, v]) => `${k}=${v}`).join(' · ')} · SL{fav.sl_pips ?? '—'}/TP{fav.tp_pips ?? '—'}
                                    </div>
                                    <div className="mt-1 font-mono text-[11px] text-text-secondary">
                                        Validado: riesgo {fav.risk_percent ?? '—'}% · capital {fmtMoney(fav.capital)}
                                        {fav.backtest_from && <> · backtest {fav.backtest_from}→{fav.backtest_to}</>}
                                    </div>
                                    <label className="mt-2 flex items-center gap-2 text-xs">
                                        <span className="text-text-secondary">Lote a operar</span>
                                        <input type="number" step={0.01} min={0.01} value={lot} onChange={(e) => setConfirmLot(fav.id, Number(e.target.value))} className="input w-28 font-mono" />
                                        <span className="text-[10px] text-text-secondary">(sugerido por riesgo%·capital·SL — aprox.)</span>
                                    </label>
                                </div>
                            ))}
                        </div>

                        <div className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
                            El bot opera con LOTE FIJO (no replica el riesgo% del favorito en vivo). El lote sugerido es una aproximación: ajústalo.
                            Verifica que la candidata sigue vigente para las condiciones actuales.
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-3">
                            <FieldLab label="Límite pérdida diaria (por estrategia)"><input type="number" min={0} value={dailyLossLimit} onChange={(e) => setDailyLossLimit(Number(e.target.value))} className="input font-mono" /></FieldLab>
                            <FieldLab label="Máx posiciones (por estrategia)"><input type="number" min={1} max={20} value={maxPositions} onChange={(e) => setMaxPositions(Number(e.target.value))} className="input font-mono" /></FieldLab>
                        </div>

                        <div className="mt-4 flex justify-end gap-2">
                            <button type="button" onClick={() => setConfirmRows(null)} className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary">Cancelar</button>
                            <button type="button" onClick={confirmLoad} disabled={busy} className="rounded-md bg-profit px-4 py-1.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50">Confirmar y operar</button>
                        </div>
                    </div>
                </div>
            )}
        </AppLayout>
    );
}

function FieldLab({ label, children }: { label: string; children: React.ReactNode }) {
    return (<label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-text-secondary">{label}</span>{children}</label>);
}

function RunRow({ run, name, selected, busy, onSelect, onPause, onResume, onStop, onRemove }: {
    run: BotRunSummary; name: string; selected: boolean; busy: boolean;
    onSelect: () => void; onPause: () => void; onResume: () => void; onStop: () => void; onRemove: () => void;
}) {
    return (
        <div onClick={onSelect} className={`cursor-pointer rounded-md border bg-bg-elevated px-3 py-2 ${selected ? 'border-accent' : 'border-border'}`}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${DOT[run.status] ?? DOT.stopped}`} />
                    <span className="text-sm font-medium text-text-primary">{name}</span>
                </div>
                <span className={`font-mono text-xs font-semibold ${pnlColor(run.daily_pnl)}`}>{fmtMoney(run.daily_pnl)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-text-secondary">
                <span>{run.strategy.symbol} · {run.strategy.timeframe} · {run.config.lot} lote · {run.open_positions}/{run.config.max_positions} pos</span>
            </div>
            <div className="mt-2 flex gap-1" onClick={(e) => e.stopPropagation()}>
                {run.status === 'running' && <MiniBtn onClick={onPause} disabled={busy}>Pausar</MiniBtn>}
                {(run.status === 'paused' || run.status === 'stopped' || run.status === 'error') && <MiniBtn onClick={onResume} disabled={busy}>Reanudar</MiniBtn>}
                {(run.status === 'running' || run.status === 'paused') && <MiniBtn onClick={onStop} disabled={busy}>Detener</MiniBtn>}
                <MiniBtn onClick={onRemove} disabled={busy} danger>Quitar</MiniBtn>
            </div>
            {run.stop_reason && <div className="mt-1 text-[10px] text-text-secondary">{run.stop_reason}</div>}
        </div>
    );
}

function MiniBtn({ children, onClick, disabled, danger }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
    return <button type="button" onClick={onClick} disabled={disabled} className={`rounded border border-border px-2 py-0.5 text-[11px] ${danger ? 'text-loss' : 'text-text-primary'} hover:bg-bg-surface disabled:opacity-40`}>{children}</button>;
}

function HeatGauge({ used, limit }: { used: number; limit: number }) {
    if (limit <= 0) return <div className="mt-1 text-[11px] text-text-secondary">Heat actual: {used.toFixed(1)}% (sin límite activo)</div>;
    const pct = Math.min(100, (used / limit) * 100);
    const tone = used >= limit ? 'bg-loss' : used >= limit * 0.8 ? 'bg-warning' : 'bg-profit';
    return (
        <div className="mt-1.5">
            <div className="mb-0.5 flex justify-between font-mono text-[11px]">
                <span className={used >= limit ? 'text-loss' : 'text-text-primary'}>{used.toFixed(1)}%</span>
                <span className="text-text-secondary">límite {limit.toFixed(1)}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded bg-bg-surface">
                <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}

function Exposure({ exposure }: { exposure: Record<string, { buy: number; sell: number; count: number }> }) {
    const rows = Object.entries(exposure);
    return (
        <section className="rounded-lg border border-border bg-bg-surface p-4">
            <h2 className="mb-2 text-sm font-semibold">Exposición por par</h2>
            {rows.length === 0 ? (
                <p className="text-xs text-text-secondary">Sin posiciones abiertas.</p>
            ) : (
                <div className="space-y-1">
                    {rows.map(([sym, ex]) => {
                        const net = ex.buy - ex.sell;
                        const hedged = ex.buy > 0 && ex.sell > 0;
                        return (
                            <div key={sym} className="flex items-center justify-between font-mono text-xs">
                                <span className="text-text-primary">{sym}{hedged && <span className="ml-1 text-warning">⚠ opuestas</span>}</span>
                                <span className="text-text-secondary">B {ex.buy} / S {ex.sell} · neto <span className={pnlColor(net)}>{net.toFixed(2)}</span></span>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}

function PositionsTable({ positions, digits, strategyName }: { positions: import('@/types').BotPosition[]; digits: number; strategyName: (id?: number) => string }) {
    const px = (v: number) => v.toFixed(digits);
    if (positions.length === 0) return <p className="p-6 text-center text-sm text-text-secondary">Sin posiciones abiertas.</p>;
    return (
        <div className="max-h-[300px] overflow-auto">
            <table className="w-full text-sm">
                <thead className="sticky top-0 bg-bg-surface">
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
                        <th className="px-3 py-2 font-medium">Estrategia</th><th className="px-3 py-2 font-medium">Símbolo</th><th className="px-3 py-2 font-medium">Dir</th>
                        <th className="px-3 py-2 font-medium text-right">Lote</th><th className="px-3 py-2 font-medium text-right">Entrada</th><th className="px-3 py-2 font-medium text-right">Actual</th>
                        <th className="px-3 py-2 font-medium text-right">SL</th><th className="px-3 py-2 font-medium text-right">TP</th><th className="px-3 py-2 font-medium text-right">PnL</th>
                    </tr>
                </thead>
                <tbody>
                    {positions.map((p) => (
                        <tr key={p.ticket} className="border-b border-border/40 last:border-0">
                            <td className="px-3 py-1.5 text-xs text-text-primary">{strategyName(p.strategy_id)}</td>
                            <td className="px-3 py-1.5 font-mono text-xs text-text-primary">{p.symbol}</td>
                            <td className={`px-3 py-1.5 font-mono text-xs font-semibold ${p.type === 0 ? 'text-profit' : 'text-loss'}`}>{p.type === 0 ? 'BUY' : 'SELL'}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-xs text-text-secondary">{p.volume}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-xs text-text-primary">{px(p.price_open)}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-xs text-text-secondary">{px(p.price_current)}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-xs text-text-secondary">{px(p.sl)}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-xs text-text-secondary">{px(p.tp)}</td>
                            <td className={`px-3 py-1.5 text-right font-mono text-xs font-semibold ${pnlColor(p.profit)}`}>{fmtMoney(p.profit)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function LogTable({ signals, strategyName, onSelect }: { signals: BotSignal[]; strategyName: (id?: number) => string; onSelect: (s: BotSignal) => void }) {
    if (signals.length === 0) return <p className="p-6 text-center text-sm text-text-secondary">Sin evaluaciones todavía.</p>;
    return (
        <div className="max-h-[300px] overflow-auto">
            <table className="w-full text-sm">
                <thead className="sticky top-0 bg-bg-surface">
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
                        <th className="px-3 py-2 font-medium">Estrategia</th><th className="px-3 py-2 font-medium">Hora</th><th className="px-3 py-2 font-medium">Señal</th><th className="px-3 py-2 font-medium">Estado</th><th className="px-3 py-2 font-medium">Motivo</th>
                    </tr>
                </thead>
                <tbody>
                    {signals.map((s) => (
                        <tr key={`${s.strategy_id}-${s.seq}`} onClick={() => onSelect(s)} className="cursor-pointer border-b border-border/40 last:border-0 hover:bg-bg-elevated">
                            <td className="px-3 py-1.5 text-xs text-text-primary">{strategyName(s.strategy_id)}</td>
                            <td className="px-3 py-1.5 font-mono text-xs text-text-secondary">{fmtTimeMs(s.evaluated_at)}</td>
                            <td className="px-3 py-1.5"><span className={`font-mono text-xs font-semibold ${s.signal_type === 'buy' ? 'text-profit' : s.signal_type === 'sell' ? 'text-loss' : 'text-text-secondary'}`}>{s.signal_type.toUpperCase()}</span></td>
                            <td className="px-3 py-1.5"><span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${s.executed ? 'bg-accent/15 text-accent' : 'bg-bg-elevated text-text-secondary'}`}>{s.executed ? 'Ejecutada' : 'No ejecutada'}</span></td>
                            <td className="px-3 py-1.5 text-xs text-text-secondary">{s.reason}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

const SEV: Record<string, string> = { info: 'text-text-secondary', warning: 'text-warning', error: 'text-loss' };

function Journal({ events, strategyName }: { events: BotEvent[]; strategyName: (id?: number) => string }) {
    if (events.length === 0) return <p className="p-6 text-center text-sm text-text-secondary">Sin eventos del bot todavía.</p>;
    return (
        <div className="max-h-[300px] overflow-auto p-2">
            {events.map((e) => (
                <div key={e.id} className="flex items-start gap-3 border-b border-border/30 px-2 py-1.5 last:border-0">
                    <span className="font-mono text-[11px] text-text-secondary">{fmtTimeMs(e.occurred_at)}</span>
                    <span className={`font-mono text-[10px] uppercase ${SEV[e.severity] ?? 'text-text-secondary'}`}>{e.severity}</span>
                    <span className="text-[11px] text-accent">{e.strategy_id ? strategyName(e.strategy_id) : 'global'}</span>
                    <span className="text-xs text-text-primary">{e.message}</span>
                </div>
            ))}
        </div>
    );
}

function TelegramPanel({ telegram, setTelegram }: { telegram: TelegramSettings; setTelegram: (t: TelegramSettings) => void }) {
    const [saving, setSaving] = useState(false);
    const save = async (next: TelegramSettings) => {
        setTelegram(next);
        setSaving(true);
        try { await window.axios.post('/bot/telegram', { enabled: next.enabled, events: next.events }); } finally { setSaving(false); }
    };
    return (
        <section className="rounded-lg border border-border bg-bg-surface p-4">
            <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Notificaciones Telegram</h2>
                {saving && <span className="text-[10px] text-text-secondary">guardando…</span>}
            </div>
            {!telegram.configured ? (
                <p className="text-xs text-text-secondary">No configurado. Define <code>TELEGRAM_BOT_TOKEN</code> y <code>TELEGRAM_CHAT_ID</code> en el <code>.env</code>.</p>
            ) : (
                <>
                    <label className="mb-3 flex items-center gap-2 text-sm text-text-primary">
                        <input type="checkbox" checked={telegram.enabled} onChange={(e) => save({ ...telegram, enabled: e.target.checked })} /> Activar notificaciones
                    </label>
                    {telegram.enabled && (
                        <div className="grid grid-cols-2 gap-1.5">
                            {Object.entries(telegram.events).map(([ev, on]) => (
                                <label key={ev} className="flex items-center gap-1.5 text-xs text-text-secondary">
                                    <input type="checkbox" checked={on} onChange={(e) => save({ ...telegram, events: { ...telegram.events, [ev]: e.target.checked } })} /> {ev}
                                </label>
                            ))}
                        </div>
                    )}
                </>
            )}
        </section>
    );
}
