import { Head, Link, router } from '@inertiajs/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import AppLayout from '@/Layouts/AppLayout';
import ManualTuning from '@/Components/ManualTuning';
import { fmtMoney, fmtNumber, pnlColor } from '@/lib/format';
import type { AiAnalysis, Backtest } from '@/types';

interface Props {
    backtest: Backtest;
    analyses: AiAnalysis[];
    aiConfigured: boolean;
    manualPrompt: string;
    costThisMonth: number;
}

type Mode = 'api' | 'manual';
const MODE_KEY = 'forexbot.analysis_mode';

const SUGGESTIONS = [
    '¿Qué parámetros ajustarías para reducir el drawdown?',
    '¿La estrategia está sobreajustada? ¿Por qué?',
    '¿Cómo puedo mejorar el profit factor sin disparar el riesgo?',
];

export default function Analysis({ backtest, analyses, aiConfigured, manualPrompt, costThisMonth }: Props) {
    const m = backtest.result_metrics;
    const [mode, setMode] = useState<Mode>(() => (localStorage.getItem(MODE_KEY) as Mode) || 'manual');
    useEffect(() => localStorage.setItem(MODE_KEY, mode), [mode]);

    // Chat (modo API): solo análisis con mode 'api'.
    const [items, setItems] = useState<AiAnalysis[]>(analyses.filter((a) => a.mode === 'api'));
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const endRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [items, sending]);

    const send = async (e: FormEvent) => {
        e.preventDefault();
        const message = input.trim();
        if (!message || sending) return;
        setSending(true);
        setError(null);
        setInput('');
        try {
            const { data } = await window.axios.post(`/backtests/${backtest.id}/analysis`, { message });
            setItems((prev) => [...prev, data.analysis as AiAnalysis]);
        } catch (e: unknown) {
            const err = e as { response?: { data?: { error?: string } } };
            setError(err.response?.data?.error ?? 'No se pudo obtener el análisis.');
            setInput(message);
        } finally {
            setSending(false);
        }
    };

    return (
        <AppLayout>
            <Head title={`Análisis IA · Backtest #${backtest.id}`} />

            <div className="mb-5 flex items-start justify-between">
                <div>
                    <h1 className="text-lg font-semibold tracking-tight">Análisis IA</h1>
                    <p className="font-mono text-xs text-text-secondary">
                        {backtest.strategy?.name} · {backtest.strategy?.pair} · {backtest.strategy?.timeframe}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <span className="rounded-md border border-border bg-bg-surface px-3 py-1.5 text-xs text-text-secondary">
                        API este mes:{' '}
                        <span className="font-mono text-text-primary">{fmtMoney(costThisMonth)}</span>
                    </span>
                    <Link href={`/backtests/${backtest.id}`} className="text-sm text-text-secondary hover:text-text-primary">
                        ← Backtest
                    </Link>
                </div>
            </div>

            {/* Selector de modo */}
            <div className="mb-5 inline-flex rounded-lg border border-border bg-bg-surface p-0.5">
                <ModeButton active={mode === 'manual'} onClick={() => setMode('manual')} title="Manual (copy-paste)" sub="sin coste de API · usa tu Claude.ai" />
                <ModeButton active={mode === 'api'} onClick={() => setMode('api')} title="API automática" sub="coste por uso · respuesta inmediata" />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="lg:col-span-2">
                    {mode === 'manual' ? (
                        <ManualTuning backtestId={backtest.id} prompt={manualPrompt} />
                    ) : (
                        <ApiChat
                            backtestId={backtest.id}
                            aiConfigured={aiConfigured}
                            items={items}
                            input={input}
                            setInput={setInput}
                            sending={sending}
                            error={error}
                            send={send}
                            endRef={endRef}
                        />
                    )}
                </div>

                {/* Resumen del backtest */}
                <aside className="rounded-lg border border-border bg-bg-surface p-4">
                    <h2 className="mb-3 text-sm font-semibold">Contexto del backtest</h2>
                    {m ? (
                        <dl className="space-y-1.5 text-sm">
                            <Row label="PnL neto" value={fmtMoney(m.net_pnl)} cls={pnlColor(m.net_pnl)} />
                            <Row label="Retorno" value={`${fmtNumber(m.return_pct)}%`} cls={pnlColor(m.return_pct)} />
                            <Row label="Win rate" value={`${fmtNumber(m.win_rate * 100)}%`} />
                            <Row label="Profit factor" value={m.profit_factor != null ? fmtNumber(m.profit_factor) : '—'} />
                            <Row label="Sharpe" value={fmtNumber(m.sharpe)} />
                            <Row label="Sortino" value={fmtNumber(m.sortino)} />
                            <Row label="Max DD" value={`${fmtNumber(m.max_drawdown_pct)}%`} cls="text-loss" />
                            <Row label="Trades" value={String(m.total_trades)} />
                            <Row label="Rachas W/L" value={`${m.max_win_streak} / ${m.max_loss_streak}`} />
                        </dl>
                    ) : (
                        <p className="text-sm text-text-secondary">Sin métricas.</p>
                    )}
                </aside>
            </div>
        </AppLayout>
    );
}

function ModeButton({ active, onClick, title, sub }: { active: boolean; onClick: () => void; title: string; sub: string }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`rounded-md px-4 py-2 text-left transition-colors ${
                active ? 'bg-bg-elevated' : 'hover:bg-bg-elevated/40'
            }`}
        >
            <div className={`text-sm font-medium ${active ? 'text-text-primary' : 'text-text-secondary'}`}>{title}</div>
            <div className="text-[10px] text-text-secondary">{sub}</div>
        </button>
    );
}

interface ChatProps {
    backtestId: number;
    aiConfigured: boolean;
    items: AiAnalysis[];
    input: string;
    setInput: (v: string) => void;
    sending: boolean;
    error: string | null;
    send: (e: FormEvent) => void;
    endRef: React.RefObject<HTMLDivElement | null>;
}

function ApiChat({ backtestId, aiConfigured, items, input, setInput, sending, error, send, endRef }: ChatProps) {
    return (
        <>
            {!aiConfigured && (
                <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
                    El modo API no está configurado. Define <code>ANTHROPIC_API_KEY</code> en el <code>.env</code>, o usa el modo Manual.
                </div>
            )}
            <div className="flex min-h-[60vh] flex-col rounded-lg border border-border bg-bg-surface">
                <div className="flex-1 space-y-4 overflow-y-auto p-4">
                    {items.length === 0 && (
                        <p className="py-10 text-center text-sm text-text-secondary">
                            Pregúntale a Claude sobre este backtest para empezar.
                        </p>
                    )}
                    {items.map((a) => (
                        <div key={a.id} className="space-y-3">
                            <div className="flex justify-end">
                                <div className="max-w-[85%] rounded-lg bg-accent/15 px-3 py-2 text-sm text-text-primary">{a.prompt}</div>
                            </div>
                            <div className="flex justify-start">
                                <div className="max-w-[90%] rounded-lg bg-bg-elevated px-3 py-2">
                                    <p className="whitespace-pre-wrap text-sm text-text-primary">{a.response}</p>
                                    {a.suggested_parameters && (
                                        <div className="mt-3 rounded-md border border-accent/30 bg-accent/10 p-3">
                                            <div className="mb-2 text-xs font-semibold text-accent">Parámetros sugeridos</div>
                                            <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-text-secondary">
                                                {Object.entries(a.suggested_parameters).map(([k, v]) => (
                                                    <span key={k}>
                                                        {k}: <span className="text-text-primary">{String(v)}</span>
                                                    </span>
                                                ))}
                                            </div>
                                            {!a.applied && (
                                                <button
                                                    type="button"
                                                    onClick={() => router.post(`/backtests/${backtestId}/analysis/${a.id}/apply`)}
                                                    className="mt-3 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                                                >
                                                    Aplicar como nueva versión
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    <div className="mt-2 font-mono text-[10px] text-text-secondary">
                                        {a.model}
                                        {a.estimated_cost_usd != null && <> · ${Number(a.estimated_cost_usd).toFixed(4)}</>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                    {sending && (
                        <div className="flex justify-start">
                            <div className="rounded-lg bg-bg-elevated px-3 py-2 text-sm text-text-secondary">Claude está analizando…</div>
                        </div>
                    )}
                    <div ref={endRef} />
                </div>

                {error && <div className="border-t border-border px-4 py-2 text-xs text-loss">{error}</div>}

                <form onSubmit={send} className="border-t border-border p-3">
                    {items.length === 0 && (
                        <div className="mb-2 flex flex-wrap gap-2">
                            {SUGGESTIONS.map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    onClick={() => setInput(s)}
                                    className="rounded-full border border-border px-2.5 py-1 text-xs text-text-secondary hover:text-text-primary"
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="flex gap-2">
                        <input
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            disabled={!aiConfigured || sending}
                            placeholder="Pregunta sobre esta estrategia…"
                            className="input"
                        />
                        <button
                            type="submit"
                            disabled={!aiConfigured || sending || !input.trim()}
                            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                        >
                            Enviar
                        </button>
                    </div>
                </form>
            </div>
        </>
    );
}

function Row({ label, value, cls = 'text-text-primary' }: { label: string; value: string; cls?: string }) {
    return (
        <div className="flex justify-between">
            <dt className="text-text-secondary">{label}</dt>
            <dd className={`font-mono ${cls}`}>{value}</dd>
        </div>
    );
}
