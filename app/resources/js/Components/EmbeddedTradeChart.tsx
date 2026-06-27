import { useEffect, useState } from 'react';
import BotLiveChart from '@/Components/BotLiveChart';
import { fmtMoney, fmtDuration } from '@/lib/format';
import type { BacktestTrade, BotClosedTrade, Candle } from '@/types';

export interface TradeChartContext {
    symbol: string;
    timeframe: string;
    digits: number;
    strategyType: string;
    params: Record<string, number | string>;
}

const BAR_SECONDS: Record<string, number> = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 };

/** Mini-chart embebido (inline) enfocado a un trade del backtest del laboratorio. */
export default function EmbeddedTradeChart({ trade, ctx }: { trade: BacktestTrade; ctx: TradeChartContext }) {
    const [candles, setCandles] = useState<Candle[]>([]);
    const [loading, setLoading] = useState(true);
    const bar = BAR_SECONDS[ctx.timeframe] ?? 3600;

    useEffect(() => {
        let alive = true;
        setLoading(true);
        const from = new Date((trade.entry_time - 45 * bar) * 1000).toISOString();
        const to = new Date((trade.exit_time + 45 * bar) * 1000).toISOString();
        (async () => {
            try {
                const { data } = await window.axios.get(`/api/market/candles/${encodeURIComponent(ctx.symbol)}`, { params: { timeframe: ctx.timeframe, from, to } });
                if (alive) setCandles((data.data ?? []) as Candle[]);
            } catch {
                if (alive) setCandles([]);
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, [trade.entry_time, trade.exit_time, ctx.symbol, ctx.timeframe, bar]);

    const closed: BotClosedTrade = {
        ticket: trade.entry_time,
        symbol: ctx.symbol,
        direction: trade.direction,
        volume: trade.volume,
        open_price: trade.entry_price,
        close_price: trade.exit_price,
        sl: trade.sl,
        tp: trade.tp,
        pnl: trade.pnl,
        close_reason: trade.exit_reason,
        open_at: new Date(trade.entry_time * 1000).toISOString(),
        close_at: new Date(trade.exit_time * 1000).toISOString(),
    };

    return (
        <div className="border-t border-border bg-bg-elevated/40 p-2">
            <div className="mb-2 flex flex-wrap gap-4 px-2 font-mono text-[11px] text-text-secondary">
                <span>Entrada @ {trade.entry_price.toFixed(ctx.digits)}</span>
                <span>Salida @ {trade.exit_price.toFixed(ctx.digits)}</span>
                <span>Duración {fmtDuration(closed.open_at, closed.close_at)}</span>
                <span className={trade.pnl >= 0 ? 'text-profit' : 'text-loss'}>PnL neto {fmtMoney(trade.pnl)}</span>
                {trade.pnl_gross != null && <span>bruto {fmtMoney(trade.pnl_gross)}</span>}
            </div>
            {loading ? (
                <p className="p-6 text-center text-sm text-text-secondary">Cargando velas de la operación…</p>
            ) : candles.length === 0 ? (
                <p className="p-6 text-center text-sm text-text-secondary">Sin velas para este tramo.</p>
            ) : (
                <BotLiveChart
                    candles={candles}
                    digits={ctx.digits}
                    strategyType={ctx.strategyType}
                    params={ctx.params}
                    signals={[]}
                    positions={[]}
                    closedTrades={[closed]}
                    onSelectSignal={() => {}}
                    focus={{ from: trade.entry_time - 12 * bar, to: trade.exit_time + 12 * bar }}
                    showClosedZones
                    height={300}
                />
            )}
        </div>
    );
}
