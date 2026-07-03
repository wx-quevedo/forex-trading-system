import { Head, router } from '@inertiajs/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import AppLayout from '@/Layouts/AppLayout';
import GlobalBar from '@/Components/bot/GlobalBar';
import StrategyCard from '@/Components/bot/StrategyCard';
import BotLiveChart from '@/Components/BotLiveChart';
import BotDecisionPanel from '@/Components/BotDecisionPanel';
import MarketStatus from '@/Components/bot/MarketStatus';
import PositionsPanel from '@/Components/bot/PositionsPanel';
import ActivityFeed, { type JournalEntry } from '@/Components/bot/ActivityFeed';
import HealthBar, { type HealthSummary } from '@/Components/bot/HealthBar';
import type { BotSignal, BotStatus, Candle, Favorite, Strategy } from '@/types';

interface Props {
    strategies: (Pick<Strategy, 'id' | 'name' | 'pair' | 'timeframe' | 'parameters' | 'version'> & { favorite_id?: number | null })[];
    favorites: Favorite[];
    status: BotStatus;
}

/** Lote sugerido desde el riesgo% y capital del favorito (aprox: ~$10/pip por lote). */
const suggestLot = (f: Favorite): number => {
    const risk = f.risk_percent ?? 1;
    const sl = f.sl_pips ?? 20;
    const raw = (f.capital * risk / 100) / (Math.max(1, sl) * 10);
    return Math.max(0.01, Math.round(raw * 100) / 100);
};

/**
 * Panel /bot — vista de MONITOREO + control rápido de la cartera (rediseño, Parte 1:
 * barra global + tarjetas de estrategias). Reutiliza el polling, las acciones y el
 * diálogo de "Recargar de Favoritos" existentes. Posiciones/actividad/salud llegan en
 * las Partes 2-3. La lógica del bot y los endpoints no cambian.
 */
export default function Control({ strategies, favorites, status: initialStatus }: Props) {
    const [status, setStatus] = useState<BotStatus>(initialStatus);
    const [journal, setJournal] = useState<JournalEntry[]>([]);
    const [health, setHealth] = useState<HealthSummary | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // --- Polling del estado + journal persistente (mismo ciclo, cada 3s) + Reverb ---
    const poll = useRef<() => void>(() => {});
    poll.current = async () => {
        try {
            const { data } = await window.axios.get('/bot/status');
            setStatus(data as BotStatus);
        } catch { /* bridge no accesible: reintenta al siguiente tick */ }
        try {
            const { data } = await window.axios.get('/bot/journal', { params: { limit: 60 } });
            setJournal((data.entries ?? []) as JournalEntry[]);
        } catch { /* journal no accesible: mantiene lo último */ }
    };
    // --- Salud del sistema: ciclo MÁS LENTO (cada 15s; cambia despacio) ---
    const pollHealth = useRef<() => void>(() => {});
    pollHealth.current = async () => {
        try {
            const { data } = await window.axios.get('/bot/health-summary');
            setHealth(data as HealthSummary);
        } catch { /* la ruta degrada por su cuenta; si ni responde, mantiene lo último */ }
    };
    useEffect(() => {
        poll.current(); // carga inmediata (el journal jsonl no viene en las props)
        pollHealth.current();
        const id = window.setInterval(() => poll.current(), 3000);
        const idH = window.setInterval(() => pollHealth.current(), 15000);
        const ch = window.Echo?.channel('bot');
        ch?.listen('.bot.updated', (e: { status: BotStatus }) => setStatus(e.status));
        return () => { window.clearInterval(id); window.clearInterval(idH); ch?.stopListening('.bot.updated'); };
    }, []);

    // Salud degradada (algo crítico en rojo) → la barra global lo refleja como "Problema".
    const healthDegraded = !!health && (health.bridge?.ok === false || (health.mt5 != null && !health.mt5.connected) || health.db?.ok === false);

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

    const pauseAll = () => action('/bot/pause', {});
    const resumeAll = () => action('/bot/resume', {});
    const panic = () => {
        const n = (status.positions ?? []).length;
        if (confirm(`¿Cerrar ${n} posición(es) abierta(s) de TODAS las estrategias y detener el bot?`)) action('/bot/panic');
    };

    const runs = status.runs ?? [];
    const stratById = useMemo(() => Object.fromEntries(strategies.map((s) => [s.id, s])), [strategies]);
    const strategyName = (sid?: number) => (sid != null ? stratById[sid]?.name ?? `#${sid}` : '—');

    // --- Selección para el gráfico grande de la derecha ---
    const [selectedSid, setSelectedSid] = useState<number | null>(null);
    useEffect(() => {
        if (runs.length === 0) { setSelectedSid(null); return; }
        if (!runs.some((r) => r.strategy_id === selectedSid)) setSelectedSid(runs[0].strategy_id);
    }, [runs, selectedSid]);
    const selectedRun = runs.find((r) => r.strategy_id === selectedSid) ?? runs[0] ?? null;

    const chart = useMemo(() => {
        if (!selectedRun) return null;
        return {
            symbol: selectedRun.strategy.symbol,
            timeframe: selectedRun.strategy.timeframe,
            type: selectedRun.strategy.type,
            params: (selectedRun.strategy.params ?? {}) as Record<string, number | string>,
            lot: selectedRun.config.lot,
        };
    }, [selectedRun]);

    const [candles, setCandles] = useState<Candle[]>([]);
    const [digits, setDigits] = useState(5);
    const [selectedSignal, setSelectedSignal] = useState<BotSignal | null>(null);

    // Velas del par/timeframe de la estrategia seleccionada (read-only; refresco 15s).
    const fetchCandles = useRef<() => void>(() => {});
    fetchCandles.current = async () => {
        if (!chart) return;
        try {
            const { data } = await window.axios.get(`/api/market/candles/${encodeURIComponent(chart.symbol)}`, { params: { timeframe: chart.timeframe, count: 300 } });
            if (data.data) setCandles(data.data as Candle[]);
        } catch { /* bridge no accesible */ }
    };
    useEffect(() => {
        setCandles([]);
        setSelectedSignal(null);
        fetchCandles.current();
        const id = window.setInterval(() => fetchCandles.current(), 15000);
        return () => window.clearInterval(id);
    }, [chart?.symbol, chart?.timeframe]);
    useEffect(() => {
        if (!chart) return;
        let alive = true;
        (async () => {
            try {
                const { data } = await window.axios.get(`/api/market/symbol/${encodeURIComponent(chart.symbol)}`);
                if (alive && data.data?.digits) setDigits(Number(data.data.digits));
            } catch { /* default 5 */ }
        })();
        return () => { alive = false; };
    }, [chart?.symbol]);

    const chartPositions = selectedRun ? (status.positions ?? []).filter((p) => p.strategy_id === selectedRun.strategy_id) : [];
    const chartSignals = selectedRun ? (status.signals ?? []).filter((s) => s.strategy_id === selectedRun.strategy_id) : [];
    const chartClosed = selectedRun ? (status.closed_trades ?? []).filter((t) => t.strategy_id === selectedRun.strategy_id) : [];

    // ═══ Recargar de Favoritos (diálogo existente, reutilizado) ═══
    const [showPicker, setShowPicker] = useState(false);
    const [favSel, setFavSel] = useState<Set<number>>(new Set());
    const [confirmRows, setConfirmRows] = useState<{ fav: Favorite; lot: number }[] | null>(null);
    const [belowMin, setBelowMin] = useState<'skip' | 'floor'>('skip');
    const [maxLot, setMaxLot] = useState(0);
    const [armExpiryHours, setArmExpiryHours] = useState(24);
    const [confirmPreview, setConfirmPreview] = useState<Record<number, PreviewRow>>({});
    const [confirmLoading, setConfirmLoading] = useState(false);
    const [confirmLimits, setConfirmLimits] = useState<Record<number, { daily: number; maxLot: number }>>({});
    // Respaldos globales (aplican a toda la cartera al cargar).
    const [dailyLossLimit, setDailyLossLimit] = useState(100);
    const [maxPositions, setMaxPositions] = useState(1);
    const [newsFilter, setNewsFilter] = useState(false);
    const [newsWindowMin, setNewsWindowMin] = useState(15);
    const [cbMaxLosses, setCbMaxLosses] = useState(0);
    const [cbMaxDrawdownPct, setCbMaxDrawdownPct] = useState(0);
    const [portfolioHeatPct, setPortfolioHeatPct] = useState(0);

    const toggleFav = (id: number) => setFavSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const fetchConfirmPreview = async (ids: number[]) => {
        setConfirmLoading(true);
        try {
            const { data } = await window.axios.post('/bot/preview', { favorite_ids: ids, below_min: belowMin, max_lot: maxLot });
            const map: Record<number, PreviewRow> = {};
            for (const p of (data.previews ?? []) as (PreviewRow & { favorite_id?: number })[]) {
                if (p.favorite_id != null) map[p.favorite_id] = p;
            }
            setConfirmPreview(map);
            setConfirmLimits((prev) => {
                const next = { ...prev };
                for (const [idStr, p] of Object.entries(map)) {
                    const id = Number(idStr);
                    if (next[id] || !p.ok) continue;
                    const risk = p.risk_usd ?? 0;
                    const daily = risk > 0 ? Math.max(10, Math.round((risk * 3) / 10) * 10) : 100;
                    const ml = Math.max(0.5, Math.ceil((p.would_lot ?? 0.1) * 5 * 10) / 10);
                    next[id] = { daily, maxLot: ml };
                }
                return next;
            });
        } catch { setConfirmPreview({}); } finally { setConfirmLoading(false); }
    };
    const openConfirm = () => {
        const rows = favorites.filter((f) => favSel.has(f.id)).map((f) => ({ fav: f, lot: suggestLot(f) }));
        if (rows.length) { setShowPicker(false); setConfirmRows(rows); fetchConfirmPreview(rows.map((r) => r.fav.id)); }
    };
    useEffect(() => {
        if (confirmRows) fetchConfirmPreview(confirmRows.map((r) => r.fav.id));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [belowMin, maxLot]);
    const confirmLoad = async () => {
        if (!confirmRows) return;
        await action('/bot/load-favorites', {
            favorites: confirmRows.map((r) => ({
                favorite_id: r.fav.id, lot: r.lot,
                daily_loss_limit: confirmLimits[r.fav.id]?.daily,
                max_lot: confirmLimits[r.fav.id]?.maxLot,
            })),
            daily_loss_limit: dailyLossLimit, max_positions: maxPositions,
            news_filter: newsFilter, news_window_min: newsWindowMin,
            cb_max_losses: cbMaxLosses, cb_max_drawdown_pct: cbMaxDrawdownPct, portfolio_heat_pct: portfolioHeatPct,
            max_lot: maxLot, below_min: belowMin, arm_expiry_hours: armExpiryHours,
        });
        setConfirmRows(null);
        setFavSel(new Set());
        router.reload({ only: ['strategies', 'favorites'] });
    };

    return (
        <AppLayout title="Bot — Monitoreo">
            <Head title="Bot" />

            <div className="botui space-y-5">
                {error && <div className="rounded-lg border border-loss/40 bg-loss/10 px-4 py-2 text-sm text-loss">{error}</div>}

                {/* 1 · Barra de estado global (sticky) */}
                <GlobalBar status={status} busy={busy} degraded={healthDegraded} onPauseAll={pauseAll} onResumeAll={resumeAll} onPanic={panic} />

                {/* FILA 1 · El "ahora": sidebar (selectoras) + gráfico grande + posiciones abiertas */}
                <div className="grid grid-cols-1 items-stretch gap-5 xl:grid-cols-[300px_1fr_320px]">
                    {/* Col 1 · Sidebar de tarjetas dinámicas (marca el alto de la fila) */}
                    <div className="flex flex-col gap-3">
                        {runs.length === 0 ? (
                            <div className="bui-placeholder">No hay estrategias en la cartera. Recarga tu cartera validada desde Favoritos.</div>
                        ) : (
                            runs.map((r) => (
                                <StrategyCard
                                    key={r.strategy_id}
                                    run={r}
                                    name={stratById[r.strategy_id]?.name}
                                    selected={r.strategy_id === selectedRun?.strategy_id}
                                    busy={busy}
                                    onSelect={() => setSelectedSid(r.strategy_id)}
                                    onPause={() => action('/bot/pause', { strategy_id: r.strategy_id })}
                                    onResume={() => action('/bot/resume', { strategy_id: r.strategy_id })}
                                    onStop={() => action('/bot/stop', { strategy_id: r.strategy_id })}
                                    onRemove={() => action('/bot/remove', { strategy_id: r.strategy_id })}
                                />
                            ))
                        )}
                        <button type="button" className="bui-btn ghost" style={{ width: '100%' }} onClick={() => setShowPicker(true)} disabled={busy}>↻ Recargar de Favoritos</button>
                    </div>

                    {/* Col 2 · Gráfico (crece en alto para igualar el sidebar: flex-fill + BotLiveChart fill) */}
                    <div className="flex min-w-0 flex-col">
                        {chart && <MarketStatus symbol={chart.symbol} />}
                        <div className="bui-chartpanel flex min-h-0 flex-1 flex-col">
                            <div className="bui-chart-head shrink-0">
                                <div className="bui-chart-title">
                                    {chart ? <>{chart.symbol} <span className="type">· {chart.type}</span></> : 'Sin estrategia seleccionada'}
                                </div>
                                {chart && <div className="bui-chart-sub">{chart.timeframe}{selectedRun?.strategy.symbol ? ` · ${stratById[selectedRun.strategy_id]?.name ?? ''}` : ''}</div>}
                            </div>
                            {!chart ? (
                                <div className="bui-chart-empty bui-chart-body">Selecciona una estrategia del panel izquierdo para ver su gráfico.</div>
                            ) : candles.length === 0 ? (
                                <div className="bui-chart-empty bui-chart-body">Cargando velas…</div>
                            ) : (
                                <div className="bui-chart-body">
                                    <BotLiveChart
                                        candles={candles}
                                        digits={digits}
                                        strategyType={chart.type}
                                        params={chart.params}
                                        signals={chartSignals}
                                        positions={chartPositions}
                                        closedTrades={chartClosed}
                                        onSelectSignal={setSelectedSignal}
                                        fill
                                    />
                                </div>
                            )}
                        </div>
                        {selectedSignal && chart && (
                            <div className="mt-3 shrink-0">
                                <BotDecisionPanel signal={selectedSignal} strategyType={chart.type} params={chart.params} lot={chart.lot} digits={digits} onClose={() => setSelectedSignal(null)} />
                            </div>
                        )}
                    </div>

                    {/* Col 3 · Posiciones abiertas ahora mismo (tarjetas compactas, junto al precio) */}
                    <PositionsPanel positions={status.positions ?? []} runs={runs} />
                </div>

                {/* FILA 2 · Actividad (journal) a ancho completo — histórico/auditoría */}
                <ActivityFeed journal={journal} events={status.journal ?? []} strategyName={strategyName} />

                {/* FILA 3 · Salud del sistema (ancho completo) */}
                <HealthBar health={health} lastSignalAt={status.signals?.[0]?.evaluated_at} loading={health === null} />
            </div>

            {/* Selector de Favoritos → confirmación */}
            {showPicker && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowPicker(false)}>
                    <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-lg border border-border bg-bg-surface p-5 shadow-2xl">
                        <h2 className="mb-1 text-sm font-semibold">Recargar de Favoritos</h2>
                        <p className="mb-3 text-xs text-text-secondary">Elige las candidatas a (re)armar. Verás el lote real y las protecciones antes de operar.</p>
                        {favorites.length === 0 ? (
                            <p className="py-4 text-center text-xs text-text-secondary">Sin favoritos. Marca candidatas con ☆ en el Explorador o el Laboratorio.</p>
                        ) : (
                            <>
                                <div className="max-h-64 overflow-auto rounded-md border border-border/60">
                                    {favorites.map((f) => (
                                        <label key={f.id} className="flex cursor-pointer items-center gap-2 border-b border-border/40 px-2 py-1.5 text-xs last:border-0 hover:bg-bg-elevated">
                                            <input type="checkbox" checked={favSel.has(f.id)} onChange={() => toggleFav(f.id)} />
                                            <span className="font-mono text-text-primary">{f.pair}·{f.timeframe}·{f.type}</span>
                                            <span className="ml-auto font-mono text-[10px] text-text-secondary">SL{f.sl_pips ?? '—'}/TP{f.tp_pips ?? '—'} · {f.risk_percent ?? '—'}%</span>
                                        </label>
                                    ))}
                                </div>
                                <div className="mt-4 flex justify-end gap-2">
                                    <button type="button" onClick={() => setShowPicker(false)} className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary">Cancelar</button>
                                    <button type="button" onClick={openConfirm} disabled={favSel.size === 0} className="rounded-md border border-accent px-4 py-1.5 text-sm font-semibold text-accent hover:bg-accent/10 disabled:opacity-50">Continuar {favSel.size || ''}…</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Confirmación antes de operar (diálogo de fidelidad existente) */}
            {confirmRows && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setConfirmRows(null)}>
                    <div onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl rounded-lg border border-border bg-bg-surface p-5 shadow-2xl">
                        <h2 className="mb-1 text-sm font-semibold">Confirmar antes de operar</h2>
                        <p className="mb-3 text-xs text-text-secondary">
                            El bot opera con FIDELIDAD al backtest: SL/TP por ATR y lote por riesgo%. El lote mostrado es el REAL que se usaría ahora{confirmLoading && ' — calculando…'}.
                        </p>

                        <div className="max-h-[50vh] space-y-2 overflow-auto">
                            {confirmRows.map(({ fav }) => {
                                const pv = confirmPreview[fav.id];
                                const blocked = pv && pv.ok && pv.would_open === false;
                                const stopsBad = pv && pv.ok && (pv.sl_ok === false || pv.tp_ok === false);
                                return (
                                <div key={fav.id} className="rounded-md border border-border bg-bg-elevated p-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-mono text-sm text-text-primary">{fav.pair} · {fav.timeframe} · {fav.type}</span>
                                        <span className="text-[11px] text-warning">★ {fav.name}</span>
                                    </div>
                                    <div className="mt-1 font-mono text-[11px] text-text-secondary">
                                        {Object.entries(fav.params).map(([k, v]) => `${k}=${v}`).join(' · ')} · {fav.sl_mode === 'atr' ? `ATR×${fav.atr_period} N${fav.sl_pips}/M${fav.tp_pips}` : `SL${fav.sl_pips ?? '—'}/TP${fav.tp_pips ?? '—'}`} · riesgo {fav.risk_percent ?? '—'}%
                                    </div>
                                    {!pv ? (
                                        <div className="mt-2 text-[11px] text-text-secondary">{confirmLoading ? 'Calculando lote real…' : 'Sin preview.'}</div>
                                    ) : !pv.ok ? (
                                        <div className="mt-2 text-[11px] text-loss">{pv.reason}</div>
                                    ) : (
                                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px]">
                                            <span className="text-profit">lote riesgo%: <b>{pv.would_lot ?? pv.risk_lot}</b></span>
                                            {pv.risk_usd != null && <span className="text-text-secondary" title="$ en riesgo si toca el SL, con el lote ya redondeado. El % real puede exceder al nominal por el redondeo del lote.">riesgo/op: <b className="text-text-primary">${pv.risk_usd}</b>{pv.risk_pct_actual != null && ` (${pv.risk_pct_actual}% real)`}</span>}
                                            <span className="text-text-secondary">SL {pv.sl_dist_pips}p / TP {pv.tp_dist_pips}p</span>
                                            {stopsBad && <span className="rounded bg-loss/20 px-1.5 py-0.5 font-semibold text-loss">stops RECHAZABLES (mín {pv.min_stop_pips}p)</span>}
                                            {pv.backtest_match?.available && (pv.backtest_match.match
                                                ? <span className="text-profit">= backtest ✓</span>
                                                : <span className="text-loss">≠ backtest</span>)}
                                            {blocked && <span className="rounded bg-warning/20 px-1.5 py-0.5 text-warning" title={pv.block_reason}>NO abriría: {pv.block_reason?.slice(0, 60)}</span>}
                                            {pv.warn && <span className="text-warning" title={pv.warn}>aviso</span>}
                                        </div>
                                    )}
                                    {pv?.ok && (() => {
                                        const lim = confirmLimits[fav.id] ?? { daily: 100, maxLot: 0.5 };
                                        const low = (pv.risk_usd ?? 0) > 0 && lim.daily < (pv.risk_usd ?? 0);
                                        const set = (patch: Partial<{ daily: number; maxLot: number }>) =>
                                            setConfirmLimits((p) => ({ ...p, [fav.id]: { ...lim, ...patch } }));
                                        return (
                                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                                                <label className="flex items-center gap-1"><span className="text-text-secondary">límite diario $</span>
                                                    <input type="number" min={0} value={lim.daily} onChange={(e) => set({ daily: Number(e.target.value) })} className={`w-20 rounded border bg-bg-surface px-1.5 py-0.5 font-mono ${low ? 'border-loss text-loss' : 'border-border'}`} /></label>
                                                <label className="flex items-center gap-1"><span className="text-text-secondary">tope lote</span>
                                                    <input type="number" min={0} step={0.01} value={lim.maxLot} onChange={(e) => set({ maxLot: Number(e.target.value) })} className="w-16 rounded border border-border bg-bg-surface px-1.5 py-0.5 font-mono" /></label>
                                                {low && <span className="text-loss">límite &lt; riesgo/op (${pv.risk_usd}) — se disparará con una pérdida</span>}
                                            </div>
                                        );
                                    })()}
                                </div>
                            ); })}
                        </div>

                        <p className="mt-3 text-[11px] text-text-secondary">El límite diario y el tope de lote se fijan POR candidata arriba (calibrados con su riesgo/op). Los de abajo son respaldo global (Heat, breakers y caducidad aplican a toda la cartera).</p>
                        <div className="mt-1 grid grid-cols-2 gap-3">
                            <FieldLab label="Límite diario (respaldo global)"><input type="number" min={0} value={dailyLossLimit} onChange={(e) => setDailyLossLimit(Number(e.target.value))} className="input font-mono" /></FieldLab>
                            <FieldLab label="Máx posiciones (por estrategia)"><input type="number" min={1} max={20} value={maxPositions} onChange={(e) => setMaxPositions(Number(e.target.value))} className="input font-mono" /></FieldLab>
                            <FieldLab label="Tope de lote (respaldo global)"><input type="number" min={0} step={0.01} value={maxLot} onChange={(e) => setMaxLot(Number(e.target.value))} className="input font-mono" /></FieldLab>
                            <FieldLab label="Si riesgo% < lote mínimo">
                                <select value={belowMin} onChange={(e) => setBelowMin(e.target.value as 'skip' | 'floor')} className="input font-mono">
                                    <option value="skip">No abrir (conservador)</option>
                                    <option value="floor">Abrir lote mínimo (con aviso)</option>
                                </select>
                            </FieldLab>
                            <FieldLab label="Caducidad del arme (h, 0 = off)"><input type="number" min={0} max={168} value={armExpiryHours} onChange={(e) => setArmExpiryHours(Number(e.target.value))} className="input font-mono" title="Si tras armar no abre posición en N horas, se auto-pausa." /></FieldLab>
                        </div>

                        <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Protecciones de cartera (globales)</div>
                        <div className="mt-1 grid grid-cols-3 gap-3">
                            <FieldLab label="Portfolio Heat % (0 = off)"><input type="number" min={0} max={100} step={0.5} value={portfolioHeatPct} onChange={(e) => setPortfolioHeatPct(Number(e.target.value))} className="input font-mono" title="Riesgo agregado máximo de TODAS las estrategias. No abre si se superaría." /></FieldLab>
                            <FieldLab label="CB: pérdidas seguidas (0 = off)"><input type="number" min={0} max={50} value={cbMaxLosses} onChange={(e) => setCbMaxLosses(Number(e.target.value))} className="input font-mono" title="Pausa la estrategia tras N pérdidas consecutivas." /></FieldLab>
                            <FieldLab label="CB: drawdown % (0 = off)"><input type="number" min={0} max={100} step={0.5} value={cbMaxDrawdownPct} onChange={(e) => setCbMaxDrawdownPct(Number(e.target.value))} className="input font-mono" title="Pausa la estrategia si el PnL cae X% desde su pico." /></FieldLab>
                        </div>

                        {(() => {
                            const missing = confirmRows.filter((r) => { const p = confirmPreview[r.fav.id]; return !p || !p.ok; });
                            const blocked = confirmRows.filter((r) => { const p = confirmPreview[r.fav.id]; return p && p.ok && p.would_open === false; });
                            const ready = !confirmLoading && missing.length === 0 && blocked.length === 0;
                            return (
                                <>
                                    {!ready && (
                                        <div className="mt-3 rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-[11px] text-loss">
                                            {confirmLoading ? 'Calculando el lote real por riesgo%…'
                                                : missing.length ? `No se pudo calcular el lote para ${missing.length} candidata(s) — no se puede operar sin saber el lote (¿bridge accesible? ¿velas disponibles?). Revisa el detalle arriba.`
                                                : `${blocked.length} candidata(s) NO abrirían con la configuración actual (stops/tope/riesgo% < mínimo). Ajusta los controles o quítalas antes de operar.`}
                                        </div>
                                    )}
                                    <div className="mt-3 flex justify-end gap-2">
                                        <button type="button" onClick={() => setConfirmRows(null)} className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary">Cancelar</button>
                                        <button type="button" onClick={confirmLoad} disabled={busy || !ready} title={ready ? '' : 'Hay candidatas sin lote calculado o bloqueadas'} className="rounded-md bg-profit px-4 py-1.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50">Confirmar y operar</button>
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                </div>
            )}
        </AppLayout>
    );
}

function FieldLab({ label, children }: { label: string; children: React.ReactNode }) {
    return (<label className="block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-text-secondary">{label}</span>{children}</label>);
}

interface PreviewRow {
    strategy_id: number; symbol: string; timeframe: string; strategy_type: string;
    sl_mode: string; atr_period: number; risk_percent: number; fixed_lot: number;
    ok: boolean; reason?: string;
    balance?: number; entry_ref?: number; atr_value?: number | null;
    sl_price?: number | null; tp_price?: number | null;
    sl_dist_pips?: number | null; tp_dist_pips?: number | null;
    risk_lot?: number | null; would_lot?: number; risk_usd?: number | null; risk_pct_actual?: number | null;
    min_stop_pips?: number; sl_ok?: boolean; tp_ok?: boolean;
    would_open?: boolean; block_reason?: string; warn?: string | null; volume_cap?: number | null;
    backtest_match?: { available: boolean; match?: boolean; reason?: string;
        live?: { sl: number; volume: number }; backtest?: { sl: number | null; volume: number; entry: number; direction: string } };
}
