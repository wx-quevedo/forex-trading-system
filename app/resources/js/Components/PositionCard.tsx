import type { Position } from '@/types';
import { fmtMoney, fmtPrice, pnlColor } from '@/lib/format';

/** Tarjeta de posición abierta: ticket, símbolo, dirección, PnL flotante. */
export default function PositionCard({ position }: { position: Position }) {
    const isBuy = position.type === 0;
    return (
        <div className="flex items-center justify-between rounded-lg border border-border bg-bg-surface px-4 py-3">
            <div className="flex items-center gap-3">
                <span
                    className={`flex h-8 w-8 items-center justify-center rounded font-mono text-sm font-bold ${
                        isBuy ? 'bg-profit/15 text-profit' : 'bg-loss/15 text-loss'
                    }`}
                >
                    {isBuy ? '↑' : '↓'}
                </span>
                <div>
                    <div className="font-mono text-sm font-semibold text-text-primary">{position.symbol}</div>
                    <div className="font-mono text-[11px] text-text-secondary">
                        #{position.ticket} · {position.volume.toFixed(2)} lots
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-6">
                <div className="text-right">
                    <div className="text-[10px] uppercase text-text-secondary">Apertura</div>
                    <div className="font-mono text-xs text-text-primary">{fmtPrice(position.price_open)}</div>
                </div>
                <div className="text-right">
                    <div className="text-[10px] uppercase text-text-secondary">Actual</div>
                    <div className="font-mono text-xs text-text-primary">{fmtPrice(position.price_current)}</div>
                </div>
                <div className="w-24 text-right">
                    <div className="text-[10px] uppercase text-text-secondary">PnL</div>
                    <div className={`font-mono text-sm font-semibold ${pnlColor(position.profit)}`}>
                        {fmtMoney(position.profit)}
                    </div>
                </div>
            </div>
        </div>
    );
}
