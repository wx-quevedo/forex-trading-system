import { useState } from 'react';
import { Head, Link, router } from '@inertiajs/react';
import AppLayout from '@/Layouts/AppLayout';
import { fmtMoney, fmtNumber } from '@/lib/format';
import { REGIME_META, matchVerdict } from '@/lib/regime';
import type { Favorite, FavoriteValidation } from '@/types';

interface Props {
    favorites: Favorite[];
}

const paramsLabel = (p: Record<string, number | string>) =>
    Object.entries(p).map(([k, v]) => `${k.replace(/_/g, ' ')}=${v}`).join(', ');

// Etiquetas de EVIDENCIA del pipeline cripto (net → OOS → holdout → cross-pair).
// La idea: mirar un favorito meses después y saber POR QUÉ se confió en él.
const VAL_LABELS: Record<string, { label: string; cls: string; help: string }> = {
    'viaja-eth': { label: 'VIAJA A ETH', cls: 'bg-profit/15 text-profit', help: 'Cross-pair: PF neto >1 en ETHUSDT con params CONGELADOS, con y sin funding. El edge no es peculiaridad de BTC.' },
    'viaja-sol': { label: 'VIAJA A SOL', cls: 'bg-profit/15 text-profit', help: 'Cross-pair: PF neto >1 en SOLUSDT con params CONGELADOS, con y sin funding (en SOL el funding medio es NEGATIVO — pagó peaje y aun así ganó). Tercer par: estructura firme.' },
    'solo-btc': { label: 'SOLO BTC', cls: 'bg-warning/15 text-warning', help: 'Cross-pair: el edge NO viajó a ETHUSDT (PF <1 congelada). Par-específico de BTC — operable solo allí y con esa etiqueta en mente.' },
    'funding-dependiente': { label: 'FUNDING-DEP', cls: 'bg-loss/15 text-loss', help: 'Parte del edge depende del crédito de funding (régimen: los cortos cobran mientras el rate sea positivo), no de la señal. Si el régimen se invierte, el subsidio se vuelve costo.' },
    'holdout-aguanta': { label: 'HOLDOUT OK', cls: 'bg-profit/15 text-profit', help: 'PF neto ≥1.05 en el tramo final INTOCADO que el ranking nunca vio (params congelados, sin re-optimizar).' },
    'holdout-plano': { label: 'HOLDOUT PLANO', cls: 'bg-warning/15 text-warning', help: 'PF 0.98–1.05 en el holdout intocado: no se cayó, pero llegó degradada.' },
    'holdout-cayo': { label: 'CAYÓ EN HOLDOUT', cls: 'bg-loss/15 text-loss', help: 'PF <0.98 en el holdout intocado: lo que prometía en OOS era suerte seleccionada.' },
};

/** Bloque compacto de evidencia del pipeline (solo favoritos cripto con validation). */
function EvidenceBlock({ v }: { v: FavoriteValidation }) {
    const cross = Object.entries(v.cross ?? {});
    return (
        <div className="mt-2 rounded-md border border-accent/30 bg-accent/5 px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-accent">
                Evidencia del pipeline{v.pipeline ? ` · ${v.pipeline}` : ''}{v.validated_at ? ` · ${v.validated_at}` : ''}
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] text-text-secondary">
                {v.holdout && (
                    <span title={v.holdout.from ? `Holdout ${v.holdout.from} → ${v.holdout.to}` : undefined}>
                        Holdout PF <span className={Number(v.holdout.pf) >= 1.05 ? 'text-profit' : Number(v.holdout.pf) >= 0.98 ? 'text-warning' : 'text-loss'}>{v.holdout.pf != null ? fmtNumber(v.holdout.pf) : '—'}</span>
                        {v.holdout.return_pct != null && <> · {Number(v.holdout.return_pct) >= 0 ? '+' : ''}{v.holdout.return_pct}%</>}
                        {v.holdout.trades != null && <> · {v.holdout.trades} ops</>}
                    </span>
                )}
                {v.no_funding_pf != null && (
                    <span title="PF con funding=0 (fees+slippage puestos): el edge sin subsidio de régimen.">
                        Sin funding <span className={Number(v.no_funding_pf) >= 1 ? 'text-profit' : 'text-loss'}>{fmtNumber(v.no_funding_pf)}</span>
                    </span>
                )}
                {cross.map(([pair, c]) => (
                    <span key={pair} title={`Cross-pair ${pair} con params congelados${c.pf_no_funding != null ? ` · sin funding ${fmtNumber(c.pf_no_funding)}` : ''}`}>
                        {pair} PF <span className={Number(c.pf) >= 1 ? 'text-profit' : 'text-loss'}>{c.pf != null ? fmtNumber(c.pf) : '—'}</span> ({c.verdict})
                    </span>
                ))}
                {v.trades_per_year != null && <span title="Frecuencia REAL: en cripto el costo por trade es ~constante, la frecuencia ES el costo.">{v.trades_per_year} ops/año</span>}
                {v.costs_eaten_pct != null && <span title="% del PnL bruto comido por fees+funding+slippage.">{v.costs_eaten_pct}% comido</span>}
                {v.short_time_pct != null && <span title="% del tiempo-en-posición en corto (exposición al régimen de funding).">{v.short_time_pct}% corto</span>}
            </div>
            {v.notes && <div className="mt-1 text-[11px] text-text-secondary">{v.notes}</div>}
        </div>
    );
}

export default function Favorites({ favorites }: Props) {
    // Tabs por mercado. DEFAULT Forex: los favoritos existentes (todos market='forex')
    // se listan EXACTAMENTE igual que antes; cripto es una pestaña aparte.
    const [tab, setTab] = useState<'forex' | 'crypto'>('forex');
    const marketOf = (f: Favorite) => f.market ?? 'forex';
    const counts = {
        forex: favorites.filter((f) => marketOf(f) === 'forex').length,
        crypto: favorites.filter((f) => marketOf(f) === 'crypto').length,
    };
    const list = favorites.filter((f) => marketOf(f) === tab);

    const openInLab = (f: Favorite) => {
        const combo = {
            type: f.type, pair: f.pair, timeframe: f.timeframe, indicators: f.params,
            risk: { sl_pips: f.sl_pips, tp_pips: f.tp_pips, risk_percent: f.risk_percent },
            capital: f.capital,
            period: f.backtest_from && f.backtest_to ? { date_from: f.backtest_from, date_to: f.backtest_to } : undefined,
        };
        window.open(`/laboratory?combo=${encodeURIComponent(JSON.stringify(combo))}`, '_blank', 'noopener');
    };

    const remove = (f: Favorite) => {
        if (window.confirm(`¿Quitar "${f.name}" de favoritos?`)) router.delete(`/favorites/${f.id}`, { preserveScroll: true });
    };

    return (
        <AppLayout title="Favoritos" wide>
            <Head title="Favoritos" />

            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-text-secondary">
                    {tab === 'forex' ? (
                        <>Estrategias marcadas desde el Explorador o el Laboratorio. Úsalas en el{' '}
                        <Link href="/bot-historico" className="text-accent hover:underline">Bot Histórico</Link> para validarlas walk-forward.</>
                    ) : (
                        <>Candidatas cripto con su <span className="text-text-primary">evidencia del pipeline</span> (holdout intocado, cross-pair, funding).
                        Solo lectura hasta la Fase 4 — el Bot Histórico es forex.</>
                    )}
                </p>
                <div className="flex gap-1.5">
                    {(['forex', 'crypto'] as const).map((m) => (
                        <button key={m} type="button" onClick={() => setTab(m)}
                            className={`rounded-md border px-3 py-1 text-xs ${tab === m ? 'border-accent bg-accent/15 text-text-primary' : 'border-border text-text-secondary hover:text-text-primary'}`}>
                            {m === 'forex' ? 'Forex' : 'Cripto'} <span className="font-mono">({counts[m]})</span>
                        </button>
                    ))}
                </div>
            </div>

            {list.length === 0 ? (
                <p className="text-sm text-text-secondary">
                    {tab === 'forex'
                        ? 'Aún no hay favoritos. Marca estrategias con la estrella (☆) en el Explorador o el Laboratorio.'
                        : 'Aún no hay favoritos cripto. Márcalos con la estrella (☆) en el Explorador CRIPTO (/crypto/explorer).'}
                </p>
            ) : (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
                    {list.map((f) => {
                        const m = f.backtest_metrics;
                        const isCrypto = marketOf(f) === 'crypto';
                        return (
                            <div key={f.id} className="rounded-lg border border-border bg-bg-surface p-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-semibold text-text-primary">{f.name}</div>
                                        <div className="font-mono text-[11px] text-text-secondary">
                                            {f.pair} · {f.timeframe} · SL{f.sl_pips ?? '—'}/TP{f.tp_pips ?? '—'}{f.sl_mode === 'atr' ? '×ATR' : ''} · {f.risk_percent ?? '—'}% · {fmtMoney(f.capital)}
                                        </div>
                                    </div>
                                    <span className="shrink-0 text-warning">★</span>
                                </div>
                                <div className="mt-1 font-mono text-[11px] text-text-secondary" title={paramsLabel(f.params)}>{paramsLabel(f.params)}</div>

                                {/* Etiquetas de evidencia del pipeline cripto (viaja-eth / solo-btc / holdout…). */}
                                {(f.validation?.labels?.length ?? 0) > 0 && (
                                    <div className="mt-2 flex flex-wrap items-center gap-1">
                                        {f.validation!.labels!.map((l) => {
                                            const meta = VAL_LABELS[l];
                                            return meta
                                                ? <span key={l} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.cls}`} title={meta.help}>{meta.label}</span>
                                                : <span key={l} className="rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] text-text-secondary">{l}</span>;
                                        })}
                                    </div>
                                )}

                                {f.regime && (() => { const mv = matchVerdict(f.type, f.regime); return (
                                    <div className="mt-2 flex flex-wrap items-center gap-1">
                                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${REGIME_META[f.regime].badge}`} title={`${REGIME_META[f.regime].help}${f.regime_confidence != null ? ` (confianza ${(f.regime_confidence * 100).toFixed(0)}%)` : ''}`}>{REGIME_META[f.regime].label}</span>
                                        {mv.verdict && <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${mv.badge}`} title={mv.help}>{mv.label}</span>}
                                    </div>
                                ); })()}

                                {f.backtest_from && (
                                    <div className="mt-2 rounded-md border border-border/60 bg-bg-elevated/50 px-2 py-1.5">
                                        <div className="text-[10px] uppercase tracking-wide text-text-secondary">Backtest de referencia · {f.backtest_from} → {f.backtest_to}{isCrypto ? ' · NETO (fees+funding+slippage)' : ''}</div>
                                        {m && (
                                            <div className="mt-1 grid grid-cols-3 gap-1 font-mono text-[11px]">
                                                <span className={Number(m.return_pct) >= 0 ? 'text-profit' : 'text-loss'}>Ret {m.return_pct}%</span>
                                                <span>Win {(Number(m.win_rate) * 100).toFixed(0)}%</span>
                                                <span>PF {m.profit_factor != null ? fmtNumber(m.profit_factor) : '—'}</span>
                                                <span className="text-loss">DD {m.max_drawdown_pct}%</span>
                                                <span>Ops {m.total_trades}</span>
                                                <span className={Number(m.net_pnl) >= 0 ? 'text-profit' : 'text-loss'}>{fmtMoney(Number(m.net_pnl))}</span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {f.validation && <EvidenceBlock v={f.validation} />}

                                <div className="mt-2 flex gap-1">
                                    {/* El Laboratorio corre por el bridge FOREX (MT5): no aplica a favoritos cripto. */}
                                    {!isCrypto && (
                                        <button type="button" onClick={() => openInLab(f)} className="rounded border border-border px-2 py-1 text-[11px] text-text-primary hover:bg-bg-elevated">Laboratorio</button>
                                    )}
                                    <button type="button" onClick={() => remove(f)} className="rounded border border-loss/50 px-2 py-1 text-[11px] text-loss hover:bg-loss/10">Quitar</button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </AppLayout>
    );
}
