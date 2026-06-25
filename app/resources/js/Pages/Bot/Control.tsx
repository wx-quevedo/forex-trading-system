import { Head } from '@inertiajs/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import AppLayout from '@/Layouts/AppLayout';
import BotLiveChart from '@/Components/BotLiveChart';
import BotDecisionPanel from '@/Components/BotDecisionPanel';
import LiveClock from '@/Components/LiveClock';
import { fmtMoney, fmtPrice, fmtTimeMs, pnlColor } from '@/lib/format';
import type { BotClosedTrade, BotPosition, BotSignal, BotStatus, Candle, Strategy, TelegramSettings } from '@/types';

interface Props {
    strategies: Pick<Strategy, 'id' | 'name' | 'pair' | 'timeframe' | 'parameters' | 'version'>[];
    status: BotStatus;
    telegram: TelegramSettings;
    recentTrades: BotClosedTrade[];
}

const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

const STATUS_META: Record<string, { label: string; dot: string; pulse: boolean }> = {
    running: { label: 'Activo', dot: 'bg-profit', pulse: true },
    paused: { label: 'Pausado', dot: 'bg-warning', pulse: false },
    stopped: { label: 'Detenido', dot: 'bg-text-secondary', pulse: false },
    error: { label: 'Error', dot: 'bg-loss', pulse: true },
};

export default function Control({ strategies, status: initialStatus, telegram: initialTelegram, recentTrades }: Props) {
    const [status, setStatus] = useState<BotStatus>(initialStatus);
    const [telegram, setTelegram] = useState<TelegramSettings>(initialTelegram);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [strategyId, setStrategyId] = useState<number>(strategies[0]?.id ?? 0);
    const [lot, setLot] = useState(0.01);
    const [dailyLossLimit, setDailyLossLimit] = useState(100);
    const [maxPositions, setMaxPositions] = useState(1);
    const [timeframe, setTimeframe] = useState('');

    const [view, setView] = useState<'chart' | 'log'>('chart');
    const [candles, setCandles] = useState<Candle[]>([]);
    const [digits, setDigits] = useState(5);
    const [selectedSignal, setSelectedSignal] = useState<BotSignal | null>(null);

    const running = status.status === 'running';
    const paused = status.status === 'paused';
    const active = running || paused;
    const selected = strategies.find((s) => s.id === strategyId);

    // Qué dibuja el chart: si el bot opera, el símbolo/estrategia REAL resuelto;
    // si está detenido, la estrategia seleccionada en el formulario.
    const chart = useMemo(() => {
        if (active && status.strategy) {
            return {
                symbol: status.strategy.symbol,
                timeframe: status.strategy.timeframe,
                type: status.strategy.type,
                params: (status.strategy.params ?? {}) as Record<string, number | string>,
            };
        }
        const p = selected?.parameters;
        return {
            symbol: selected?.pair ?? 'EURUSD',
            timeframe: timeframe || selected?.timeframe || 'H1',
            type: p?.type ?? 'ma_cross',
            params: (p?.indicators ?? {}) as Record<string, number | string>,
        };
    }, [active, status.strategy, selected, timeframe]);

    // Carga inicial + refresco de velas (las nuevas velas entran al chart).
    const fetchCandles = useRef<() => void>(() => {});
    fetchCandles.current = async () => {
        try {
            const { data } = await window.axios.get(`/api/market/candles/${encodeURIComponent(chart.symbol)}`, {
                params: { timeframe: chart.timeframe, count: 300 },
            });
            if (data.data) setCandles(data.data as Candle[]);
        } catch {
            /* el bridge puede caer; se reintenta */
        }
    };
    useEffect(() => {
        setCandles([]);
        fetchCandles.current();
        const id = window.setInterval(() => fetchCandles.current(), 15000);
        return () => window.clearInterval(id);
    }, [chart.symbol, chart.timeframe]);

    // Precisión de precio del símbolo (digits) para formatear el chart correctamente.
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const { data } = await window.axios.get(`/api/market/symbol/${encodeURIComponent(chart.symbol)}`);
                if (alive && data.data?.digits) setDigits(Number(data.data.digits));
            } catch {
                /* default 5 */
            }
        })();
        return () => {
            alive = false;
        };
    }, [chart.symbol]);

    // Polling del estado en vivo (también sincroniza la BD + Telegram en el backend).
    const poll = useRef<() => void>(() => {});
    poll.current = async () => {
        try {
            const { data } = await window.axios.get('/bot/status');
            setStatus(data as BotStatus);
        } catch {
            /* el bridge puede caer; se reintenta */
        }
    };
    useEffect(() => {
        const id = window.setInterval(() => poll.current(), 3000);
        const ch = window.Echo?.channel('bot');
        ch?.listen('.bot.updated', (e: { status: BotStatus }) => setStatus(e.status));
        return () => {
            window.clearInterval(id);
            ch?.stopListening('.bot.updated');
            // No hacemos Echo.leave('bot'): el header comparte este canal.
        };
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

    const start = () =>
        action('/bot/start', { strategy_id: strategyId, lot, daily_loss_limit: dailyLossLimit, max_positions: maxPositions, timeframe: timeframe || selected?.timeframe });

    const panic = () => {
        if (confirm('¿Cerrar TODAS las posiciones abiertas y detener el bot?')) action('/bot/panic');
    };

    const meta = STATUS_META[status.status] ?? STATUS_META.stopped;
    const cfg = status.config;
    const dailyPnl = status.daily_pnl ?? 0;
    const limit = active ? cfg?.daily_loss_limit ?? dailyLossLimit : dailyLossLimit;
    const lossPct = limit > 0 ? Math.min(100, Math.max(0, (-dailyPnl / limit) * 100)) : 0;

    return (
        <AppLayout title="Bot en vivo">
            <Head title="Bot en vivo" />

            {/* Cabecera de estado + PANIC */}
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <span className={`h-3 w-3 rounded-full ${meta.dot} ${meta.pulse ? 'animate-pulse-dot' : ''}`} />
                    <div>
                        <div className="text-sm font-semibold">Bot: {meta.label}</div>
                        {status.stop_reason && <div className="text-xs text-text-secondary">{status.stop_reason}</div>}
                        {status.error && <div className="text-xs text-loss">{status.error}</div>}
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <LiveClock />
                    <button
                        type="button"
                        onClick={panic}
                        disabled={busy}
                        className="rounded-md bg-loss px-5 py-2.5 text-sm font-bold text-white shadow-lg hover:opacity-90 disabled:opacity-50"
                    >
                        PANIC — Cerrar todo
                    </button>
                </div>
            </div>

            {error && <div className="mb-4 rounded-lg border border-loss/40 bg-loss/10 px-4 py-2 text-sm text-loss">{error}</div>}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                {/* Columna izquierda: configuración + control */}
                <div className="space-y-6">
                    <section className="rounded-lg border border-border bg-bg-surface p-4">
                        <h2 className="mb-3 text-sm font-semibold">Configuración</h2>
                        <label className="mb-3 block">
                            <span className="mb-1 block text-[11px] uppercase tracking-wide text-text-secondary">Estrategia</span>
                            <select
                                value={strategyId}
                                onChange={(e) => setStrategyId(Number(e.target.value))}
                                disabled={active}
                                className="input"
                            >
                                {strategies.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.name} v{s.version} ({s.pair} · {s.timeframe})
                                    </option>
                                ))}
                            </select>
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Lote fijo">
                                <input type="number" step={0.01} min={0.01} value={lot} disabled={active} onChange={(e) => setLot(Number(e.target.value))} className="input font-mono" />
                            </Field>
                            <Field label="Timeframe">
                                <select value={timeframe || selected?.timeframe || 'H1'} disabled={active} onChange={(e) => setTimeframe(e.target.value)} className="input font-mono">
                                    {TIMEFRAMES.map((tf) => (
                                        <option key={tf} value={tf}>
                                            {tf}
                                        </option>
                                    ))}
                                </select>
                            </Field>
                            <Field label="Límite pérdida diaria">
                                <input type="number" min={0} value={dailyLossLimit} disabled={active} onChange={(e) => setDailyLossLimit(Number(e.target.value))} className="input font-mono" />
                            </Field>
                            <Field label="Máx posiciones">
                                <input type="number" min={1} max={20} value={maxPositions} disabled={active} onChange={(e) => setMaxPositions(Number(e.target.value))} className="input font-mono" />
                            </Field>
                        </div>

                        {/* Botones de control */}
                        <div className="mt-4 flex flex-wrap gap-2">
                            {!active && (
                                <button type="button" onClick={start} disabled={busy || !strategyId} className="flex-1 rounded-md bg-profit px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50">
                                    Start
                                </button>
                            )}
                            {running && (
                                <button type="button" onClick={() => action('/bot/pause')} disabled={busy} className="flex-1 rounded-md bg-warning px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50">
                                    Pause
                                </button>
                            )}
                            {paused && (
                                <button type="button" onClick={() => action('/bot/resume')} disabled={busy} className="flex-1 rounded-md bg-profit px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50">
                                    Resume
                                </button>
                            )}
                            {active && (
                                <button type="button" onClick={() => action('/bot/stop')} disabled={busy} className="flex-1 rounded-md border border-border px-4 py-2.5 text-sm font-semibold text-text-primary hover:bg-bg-elevated disabled:opacity-50">
                                    Stop
                                </button>
                            )}
                        </div>
                    </section>

                    {/* PnL del día vs límite */}
                    <section className="rounded-lg border border-border bg-bg-surface p-4">
                        <h2 className="mb-3 text-sm font-semibold">PnL del día</h2>
                        <div className="mb-2 flex items-end justify-between">
                            <span className={`font-mono text-2xl font-semibold ${pnlColor(dailyPnl)}`}>{fmtMoney(dailyPnl)}</span>
                            <span className="font-mono text-xs text-text-secondary">límite −{fmtMoney(limit)}</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-bg-elevated">
                            <div className={`h-full ${lossPct > 80 ? 'bg-loss' : 'bg-warning'}`} style={{ width: `${lossPct}%` }} />
                        </div>
                        <div className="mt-2 flex justify-between font-mono text-[11px] text-text-secondary">
                            <span>realizado {fmtMoney(status.realized_pnl_today ?? 0)}</span>
                            <span>flotante {fmtMoney(status.floating_pnl ?? 0)}</span>
                        </div>
                    </section>

                    <TelegramPanel telegram={telegram} setTelegram={setTelegram} />
                </div>

                {/* Columna derecha: visualización (chart) o log de texto */}
                <div className="space-y-6 lg:col-span-2">
                    <div className="flex gap-1 rounded-lg border border-border bg-bg-surface p-1">
                        {(['chart', 'log'] as const).map((v) => (
                            <button
                                key={v}
                                type="button"
                                onClick={() => setView(v)}
                                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                                    view === v ? 'bg-bg-elevated text-text-primary' : 'text-text-secondary hover:text-text-primary'
                                }`}
                            >
                                {v === 'chart' ? 'Visualización' : 'Log de señales'}
                            </button>
                        ))}
                    </div>

                    {view === 'chart' ? (
                        <>
                            <section className="rounded-lg border border-border bg-bg-surface p-2">
                                <div className="mb-1 flex items-center justify-between px-2 pt-1">
                                    <h2 className="text-sm font-semibold">
                                        {chart.symbol} · {chart.timeframe} · {chart.type}
                                    </h2>
                                    <span className="font-mono text-[10px] text-text-secondary">{candles.length} velas</span>
                                </div>
                                {candles.length === 0 ? (
                                    <p className="p-10 text-center text-sm text-text-secondary">Cargando velas…</p>
                                ) : (
                                    <BotLiveChart
                                        candles={candles}
                                        digits={digits}
                                        strategyType={chart.type}
                                        params={chart.params}
                                        signals={status.signals ?? []}
                                        positions={status.positions ?? []}
                                        closedTrades={status.closed_trades ?? []}
                                        onSelectSignal={setSelectedSignal}
                                    />
                                )}
                            </section>
                            <BotDecisionPanel
                                signal={selectedSignal}
                                strategyType={chart.type}
                                params={chart.params}
                                lot={cfg?.lot ?? lot}
                                digits={digits}
                                onClose={() => setSelectedSignal(null)}
                            />
                            <Positions positions={status.positions ?? []} maxPositions={cfg?.max_positions} />
                        </>
                    ) : (
                        <>
                            <Positions positions={status.positions ?? []} maxPositions={cfg?.max_positions} />
                            <SignalLogLive signals={status.signals ?? []} />
                            <ClosedTrades trades={status.closed_trades?.length ? status.closed_trades : recentTrades} />
                        </>
                    )}
                </div>
            </div>
        </AppLayout>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-text-secondary">{label}</span>
            {children}
        </label>
    );
}

function Positions({ positions, maxPositions }: { positions: BotPosition[]; maxPositions?: number }) {
    return (
        <section className="rounded-lg border border-border bg-bg-surface p-4">
            <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Posiciones del bot</h2>
                <span className="font-mono text-xs text-text-secondary">
                    {positions.length}
                    {maxPositions ? ` / ${maxPositions}` : ''}
                </span>
            </div>
            {positions.length === 0 ? (
                <p className="py-4 text-center text-sm text-text-secondary">Sin posiciones abiertas.</p>
            ) : (
                <div className="space-y-2">
                    {positions.map((p) => (
                        <div key={p.ticket} className="flex items-center justify-between rounded-md border border-border bg-bg-elevated px-3 py-2">
                            <div className="flex items-center gap-3">
                                <span className={`font-mono text-sm font-bold ${p.type === 0 ? 'text-profit' : 'text-loss'}`}>{p.type === 0 ? '↑' : '↓'}</span>
                                <div>
                                    <div className="font-mono text-sm text-text-primary">{p.symbol}</div>
                                    <div className="font-mono text-[10px] text-text-secondary">#{p.ticket} · {p.volume} · SL {fmtPrice(p.sl)} TP {fmtPrice(p.tp)}</div>
                                </div>
                            </div>
                            <span className={`font-mono text-sm font-semibold ${pnlColor(p.profit)}`}>{fmtMoney(p.profit)}</span>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}

function SignalLogLive({ signals }: { signals: BotSignal[] }) {
    return (
        <section>
            <h2 className="mb-2 text-sm font-semibold">Log de señales (en vivo)</h2>
            <div className="max-h-[340px] overflow-auto rounded-lg border border-border bg-bg-surface">
                {signals.length === 0 ? (
                    <p className="p-6 text-center text-sm text-text-secondary">Sin evaluaciones todavía.</p>
                ) : (
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-bg-surface">
                            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
                                <th className="px-3 py-2 font-medium">Hora</th>
                                <th className="px-3 py-2 font-medium">Señal</th>
                                <th className="px-3 py-2 font-medium">Estado</th>
                                <th className="px-3 py-2 font-medium">Motivo</th>
                            </tr>
                        </thead>
                        <tbody>
                            {signals.map((s) => (
                                <tr key={s.seq} className="border-b border-border/40 last:border-0">
                                    <td className="px-3 py-1.5 font-mono text-xs text-text-secondary">
                                        {fmtTimeMs(s.evaluated_at)}
                                    </td>
                                    <td className="px-3 py-1.5">
                                        <span className={`font-mono text-xs font-semibold ${s.signal_type === 'buy' ? 'text-profit' : s.signal_type === 'sell' ? 'text-loss' : 'text-text-secondary'}`}>
                                            {s.signal_type.toUpperCase()}
                                        </span>
                                    </td>
                                    <td className="px-3 py-1.5">
                                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${s.executed ? 'bg-accent/15 text-accent' : 'bg-bg-elevated text-text-secondary'}`}>
                                            {s.executed ? 'Ejecutada' : 'No ejecutada'}
                                        </span>
                                    </td>
                                    <td className="px-3 py-1.5 text-xs text-text-secondary">{s.reason}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </section>
    );
}

function ClosedTrades({ trades }: { trades: BotClosedTrade[] }) {
    return (
        <section>
            <h2 className="mb-2 text-sm font-semibold">Historial de trades del bot</h2>
            <div className="max-h-[340px] overflow-auto rounded-lg border border-border bg-bg-surface">
                {trades.length === 0 ? (
                    <p className="p-6 text-center text-sm text-text-secondary">Sin trades cerrados.</p>
                ) : (
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-bg-surface">
                            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
                                <th className="px-3 py-2 font-medium">Cierre</th>
                                <th className="px-3 py-2 font-medium">Símbolo</th>
                                <th className="px-3 py-2 font-medium">Dir</th>
                                <th className="px-3 py-2 font-medium text-right">Vol</th>
                                <th className="px-3 py-2 font-medium">Motivo</th>
                                <th className="px-3 py-2 font-medium text-right">PnL</th>
                            </tr>
                        </thead>
                        <tbody>
                            {trades.map((t) => (
                                <tr key={t.ticket} className="border-b border-border/40 last:border-0">
                                    <td className="px-3 py-1.5 font-mono text-[11px] text-text-secondary">{t.close_at ? fmtTimeMs(t.close_at) : '—'}</td>
                                    <td className="px-3 py-1.5 font-mono text-xs text-text-primary">{t.symbol}</td>
                                    <td className="px-3 py-1.5 font-mono text-xs text-text-secondary">{t.direction ?? '—'}</td>
                                    <td className="px-3 py-1.5 text-right font-mono text-xs text-text-secondary">{t.volume ?? '—'}</td>
                                    <td className="px-3 py-1.5">
                                        <span className="rounded bg-bg-elevated px-1.5 py-0.5 font-mono text-[10px] uppercase text-text-secondary">{t.exit_reason ?? 'cierre'}</span>
                                    </td>
                                    <td className={`px-3 py-1.5 text-right font-mono text-xs ${t.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>{fmtMoney(t.pnl)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </section>
    );
}

function TelegramPanel({ telegram, setTelegram }: { telegram: TelegramSettings; setTelegram: (t: TelegramSettings) => void }) {
    const [saving, setSaving] = useState(false);
    const save = async (next: TelegramSettings) => {
        setTelegram(next);
        setSaving(true);
        try {
            await window.axios.post('/bot/telegram', { enabled: next.enabled, events: next.events });
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="rounded-lg border border-border bg-bg-surface p-4">
            <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Notificaciones Telegram</h2>
                {saving && <span className="text-[10px] text-text-secondary">guardando…</span>}
            </div>
            {!telegram.configured ? (
                <p className="text-xs text-text-secondary">
                    No configurado. Define <code>TELEGRAM_BOT_TOKEN</code> y <code>TELEGRAM_CHAT_ID</code> en el <code>.env</code>.
                </p>
            ) : (
                <>
                    <label className="mb-3 flex items-center gap-2 text-sm text-text-primary">
                        <input type="checkbox" checked={telegram.enabled} onChange={(e) => save({ ...telegram, enabled: e.target.checked })} />
                        Activar notificaciones
                    </label>
                    {telegram.enabled && (
                        <div className="grid grid-cols-2 gap-1.5">
                            {Object.entries(telegram.events).map(([ev, on]) => (
                                <label key={ev} className="flex items-center gap-1.5 text-xs text-text-secondary">
                                    <input type="checkbox" checked={on} onChange={(e) => save({ ...telegram, events: { ...telegram.events, [ev]: e.target.checked } })} />
                                    {ev}
                                </label>
                            ))}
                        </div>
                    )}
                </>
            )}
        </section>
    );
}
