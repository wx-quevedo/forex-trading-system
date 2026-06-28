import { Head, Link, router } from '@inertiajs/react';
import AppLayout from '@/Layouts/AppLayout';
import { fmtMoney, fmtNumber } from '@/lib/format';
import type { Favorite } from '@/types';

interface Props {
    favorites: Favorite[];
}

const paramsLabel = (p: Record<string, number | string>) =>
    Object.entries(p).map(([k, v]) => `${k.replace(/_/g, ' ')}=${v}`).join(', ');

export default function Favorites({ favorites }: Props) {
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

            <div className="mb-4 flex items-center justify-between">
                <p className="text-sm text-text-secondary">
                    Estrategias marcadas desde el Explorador o el Laboratorio. Úsalas en el{' '}
                    <Link href="/bot-historico" className="text-accent hover:underline">Bot Histórico</Link> para validarlas walk-forward.
                </p>
            </div>

            {favorites.length === 0 ? (
                <p className="text-sm text-text-secondary">
                    Aún no hay favoritos. Marca estrategias con la estrella (☆) en el Explorador o el Laboratorio.
                </p>
            ) : (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
                    {favorites.map((f) => {
                        const m = f.backtest_metrics;
                        return (
                            <div key={f.id} className="rounded-lg border border-border bg-bg-surface p-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-semibold text-text-primary">{f.name}</div>
                                        <div className="font-mono text-[11px] text-text-secondary">
                                            {f.pair} · {f.timeframe} · SL{f.sl_pips ?? '—'}/TP{f.tp_pips ?? '—'} · {f.risk_percent ?? '—'}% · {fmtMoney(f.capital)}
                                        </div>
                                    </div>
                                    <span className="shrink-0 text-warning">★</span>
                                </div>
                                <div className="mt-1 font-mono text-[11px] text-text-secondary" title={paramsLabel(f.params)}>{paramsLabel(f.params)}</div>

                                {f.backtest_from && (
                                    <div className="mt-2 rounded-md border border-border/60 bg-bg-elevated/50 px-2 py-1.5">
                                        <div className="text-[10px] uppercase tracking-wide text-text-secondary">Backtest de referencia · {f.backtest_from} → {f.backtest_to}</div>
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

                                <div className="mt-2 flex gap-1">
                                    <button type="button" onClick={() => openInLab(f)} className="rounded border border-border px-2 py-1 text-[11px] text-text-primary hover:bg-bg-elevated">Laboratorio</button>
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
