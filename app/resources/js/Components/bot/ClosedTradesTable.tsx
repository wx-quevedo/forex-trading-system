import { useMemo, useState } from 'react';
import { fmtMoney, fmtNumber, closeReasonLabel } from '@/lib/format';
import type { BotClosedDeal } from '@/types';

/**
 * Pestaña TRADES del panel de Actividad: los cierres REALES del bróker (history_deals
 * de MT5 por magic del bot, desde el epoch), más reciente arriba. El motivo de cierre
 * es ENRIQUECIMIENTO best-effort (BD/journal por position_id): un deal sin motivo se
 * muestra igual — completitud > enriquecimiento. Filtro por estrategia client-side.
 */
export default function ClosedTradesTable({ trades, epoch }: { trades: BotClosedDeal[]; epoch?: string | null }) {
    const [filter, setFilter] = useState<string>('all');

    // Opciones del filtro: una por strategy_id presente (etiqueta = par+tipo si la
    // estrategia sigue en la BD; si fue borrada, símbolo del deal + sid).
    const options = useMemo(() => {
        const seen = new Map<string, string>();
        for (const t of trades) {
            const key = String(t.strategy_id);
            if (!seen.has(key)) seen.set(key, stratLabel(t));
        }
        return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    }, [trades]);

    const shown = filter === 'all' ? trades : trades.filter((t) => String(t.strategy_id) === filter);

    return (
        <div className="bui-panel">
            <div className="bui-panel-head">
                <span>Trades cerrados <span className="text-text-secondary" title={`Fuente canónica: historial de deals del BRÓKER (MT5) filtrado por magic del bot, desde ${epoch ?? '—'}. Sobrevive a re-armes y huecos del journal; incluye comisiones/swaps.`}>· bróker desde {epoch ?? '—'}</span></span>
                <span className="flex items-center gap-2">
                    {options.length > 1 && (
                        <select value={filter} onChange={(e) => setFilter(e.target.value)}
                            className="rounded-md border border-border bg-bg-elevated px-2 py-0.5 text-[11px] text-text-primary">
                            <option value="all">Todas</option>
                            {options.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                        </select>
                    )}
                    <span className="count">{shown.length}</span>
                </span>
            </div>
            {shown.length === 0 ? (
                <div className="bui-panel-empty">Sin trades cerrados todavía en el historial del bróker.</div>
            ) : (
                <div className="max-h-80 overflow-auto">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-bg-elevated">
                            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-text-secondary">
                                <th className="px-2 py-1.5">Cierre</th>
                                <th className="px-2 py-1.5">Estrategia</th>
                                <th className="px-2 py-1.5">Dir</th>
                                <th className="px-2 py-1.5 text-right">Lote</th>
                                <th className="px-2 py-1.5 text-right">Entrada → Salida</th>
                                <th className="px-2 py-1.5 text-right">PnL</th>
                                <th className="px-2 py-1.5">Motivo</th>
                            </tr>
                        </thead>
                        <tbody>
                            {shown.map((t) => (
                                <tr key={t.position_id} className="border-b border-border/40 last:border-0">
                                    <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[11px] text-text-secondary">{fmtClose(t.close_time)}</td>
                                    <td className="px-2 py-1.5 font-mono text-xs text-text-primary" title={t.strategy ? t.strategy.name : `Estrategia #${t.strategy_id} (ya no está en la BD)`}>{stratLabel(t)}</td>
                                    <td className="px-2 py-1.5"><span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${t.direction === 'buy' ? 'bg-profit/15 text-profit' : 'bg-loss/15 text-loss'}`}>{t.direction.toUpperCase()}</span></td>
                                    <td className="px-2 py-1.5 text-right font-mono text-xs">{t.volume}</td>
                                    <td className="px-2 py-1.5 text-right font-mono text-xs text-text-secondary">{t.entry_price != null ? fmtNumber(t.entry_price) : '?'} → {fmtNumber(t.close_price)}</td>
                                    <td className={`px-2 py-1.5 text-right font-mono text-xs font-semibold ${t.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>{fmtMoney(t.pnl)}</td>
                                    <td className="px-2 py-1.5 text-[11px] text-text-secondary" title={t.close_reason ? undefined : 'El deal viene del bróker; ni la BD ni el journal registraron el motivo (completitud > enriquecimiento).'}>{closeReasonLabel(t.close_reason)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function stratLabel(t: BotClosedDeal): string {
    if (t.strategy) return `${t.strategy.pair} ${t.strategy.type ?? ''}`.trim();
    return `${t.symbol} · sid ${t.strategy_id}`;
}

function fmtClose(epochS: number): string {
    try {
        return new Date(epochS * 1000).toLocaleString('es-EC', {
            timeZone: 'America/Guayaquil', day: '2-digit', month: 'short',
            hour: '2-digit', minute: '2-digit', hour12: false,
        });
    } catch {
        return String(epochS);
    }
}
