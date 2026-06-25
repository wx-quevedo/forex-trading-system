import { fmtMoney, fmtTimeMs, fmtDuration, closeReasonLabel } from '@/lib/format';
import type { BotClosedTrade } from '@/types';

interface Props {
    trades: BotClosedTrade[];
    digits?: number;
    onSelect: (t: BotClosedTrade) => void;
}

const REASON_CLS: Record<string, string> = {
    take_profit: 'text-profit',
    stop_loss: 'text-loss',
    signal: 'text-accent',
    panic: 'text-loss',
    daily_limit: 'text-warning',
};

/** Historial de trades del bot estilo MT5 (clic en fila → detalle visual). */
export default function BotHistoryTable({ trades, digits = 5, onSelect }: Props) {
    const px = (v: number | null | undefined) => (v == null ? '—' : Number(v).toFixed(digits));

    if (trades.length === 0) {
        return <p className="p-6 text-center text-sm text-text-secondary">Sin trades cerrados.</p>;
    }

    return (
        <div className="max-h-[300px] overflow-auto">
            <table className="w-full text-sm">
                <thead className="sticky top-0 bg-bg-surface">
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
                        <th className="px-3 py-2 font-medium">Entrada</th>
                        <th className="px-3 py-2 font-medium">Salida</th>
                        <th className="px-3 py-2 font-medium">Par</th>
                        <th className="px-3 py-2 font-medium">Dir</th>
                        <th className="px-3 py-2 font-medium text-right">Lote</th>
                        <th className="px-3 py-2 font-medium text-right">P. entrada</th>
                        <th className="px-3 py-2 font-medium text-right">P. salida</th>
                        <th className="px-3 py-2 font-medium text-right">SL</th>
                        <th className="px-3 py-2 font-medium text-right">TP</th>
                        <th className="px-3 py-2 font-medium">Motivo</th>
                        <th className="px-3 py-2 font-medium text-right">Duración</th>
                        <th className="px-3 py-2 font-medium text-right">PnL</th>
                    </tr>
                </thead>
                <tbody>
                    {trades.map((t) => {
                        const reason = t.close_reason ?? t.exit_reason ?? '';
                        const buy = (t.direction ?? '').toLowerCase() === 'buy';
                        return (
                            <tr
                                key={t.ticket}
                                onClick={() => onSelect(t)}
                                className="cursor-pointer border-b border-border/40 last:border-0 hover:bg-bg-elevated"
                            >
                                <td className="px-3 py-1.5 font-mono text-[11px] text-text-secondary">{t.open_at ? fmtTimeMs(t.open_at) : '—'}</td>
                                <td className="px-3 py-1.5 font-mono text-[11px] text-text-secondary">{t.close_at ? fmtTimeMs(t.close_at) : '—'}</td>
                                <td className="px-3 py-1.5 font-mono text-xs text-text-primary">{t.symbol}</td>
                                <td className={`px-3 py-1.5 font-mono text-xs font-semibold ${buy ? 'text-profit' : 'text-loss'}`}>{buy ? 'BUY' : 'SELL'}</td>
                                <td className="px-3 py-1.5 text-right font-mono text-xs text-text-secondary">{t.volume ?? '—'}</td>
                                <td className="px-3 py-1.5 text-right font-mono text-xs text-text-primary">{px(t.open_price)}</td>
                                <td className="px-3 py-1.5 text-right font-mono text-xs text-text-primary">{px(t.close_price)}</td>
                                <td className="px-3 py-1.5 text-right font-mono text-xs text-text-secondary">{px(t.sl)}</td>
                                <td className="px-3 py-1.5 text-right font-mono text-xs text-text-secondary">{px(t.tp)}</td>
                                <td className={`px-3 py-1.5 text-xs ${REASON_CLS[reason] ?? 'text-text-secondary'}`}>{closeReasonLabel(reason)}</td>
                                <td className="px-3 py-1.5 text-right font-mono text-[11px] text-text-secondary">{fmtDuration(t.open_at, t.close_at)}</td>
                                <td className={`px-3 py-1.5 text-right font-mono text-xs font-semibold ${t.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>{fmtMoney(t.pnl)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
