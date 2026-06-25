import { useEffect, useState } from 'react';
import BotLiveChart from '@/Components/BotLiveChart';
import { fmtMoney, fmtTimeMs, fmtDuration, closeReasonLabel } from '@/lib/format';
import type { BotClosedTrade, Candle } from '@/types';

interface Props {
    trade: BotClosedTrade;
    symbol: string;
    timeframe: string;
    digits: number;
    strategyType: string;
    params: Record<string, number | string>;
    onClose: () => void;
}

const BAR_SECONDS: Record<string, number> = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 };

export default function TradeDetail({ trade, symbol, timeframe, digits, strategyType, params, onClose }: Props) {
    const [candles, setCandles] = useState<Candle[]>([]);
    const [loading, setLoading] = useState(true);

    const bar = BAR_SECONDS[timeframe] ?? 3600;
    const openEpoch = trade.open_at ? Math.floor(new Date(trade.open_at).getTime() / 1000) : 0;
    const closeEpoch = trade.close_at ? Math.floor(new Date(trade.close_at).getTime() / 1000) : openEpoch;

    useEffect(() => {
        let alive = true;
        setLoading(true);
        const from = new Date((openEpoch - 45 * bar) * 1000).toISOString();
        const to = new Date((closeEpoch + 45 * bar) * 1000).toISOString();
        (async () => {
            try {
                const { data } = await window.axios.get(`/api/market/candles/${encodeURIComponent(symbol)}`, { params: { timeframe, from, to } });
                if (alive) setCandles((data.data ?? []) as Candle[]);
            } catch {
                if (alive) setCandles([]);
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => {
            alive = false;
        };
    }, [trade.ticket, symbol, timeframe]); // eslint-disable-line react-hooks/exhaustive-deps

    const buy = (trade.direction ?? '').toLowerCase() === 'buy';
    const reason = trade.close_reason ?? trade.exit_reason ?? '';
    const openReason = trade.open_reason ?? trade.signal_data?.open_reason ?? null;
    const px = (v: number | null | undefined) => (v == null ? '—' : Number(v).toFixed(digits));
    const focus = { from: openEpoch - 12 * bar, to: closeEpoch + 12 * bar };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
            <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-lg border border-border bg-bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <h2 className="text-sm font-semibold">
                        Detalle de operación · {trade.symbol} · <span className={buy ? 'text-profit' : 'text-loss'}>{buy ? 'BUY' : 'SELL'}</span>
                    </h2>
                    <button type="button" onClick={onClose} className="text-text-secondary hover:text-text-primary" aria-label="Cerrar">✕</button>
                </div>

                <div className="p-3">
                    {loading ? (
                        <p className="p-10 text-center text-sm text-text-secondary">Cargando velas de la operación…</p>
                    ) : candles.length === 0 ? (
                        <p className="p-10 text-center text-sm text-text-secondary">No se pudieron cargar las velas de este tramo.</p>
                    ) : (
                        <BotLiveChart
                            candles={candles}
                            digits={digits}
                            strategyType={strategyType}
                            params={params}
                            signals={[]}
                            positions={[]}
                            closedTrades={[trade]}
                            onSelectSignal={() => {}}
                            focus={focus}
                            showClosedZones
                            height={360}
                        />
                    )}
                </div>

                <div className="grid grid-cols-1 gap-4 border-t border-border p-4 sm:grid-cols-3">
                    <div>
                        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Entrada</h3>
                        <dl className="space-y-1 font-mono text-xs">
                            <Row k="Hora" v={trade.open_at ? fmtTimeMs(trade.open_at) : '—'} />
                            <Row k="Precio" v={px(trade.open_price)} />
                            <Row k="Dirección" v={buy ? 'BUY' : 'SELL'} />
                            <Row k="Lote" v={String(trade.volume ?? '—')} />
                        </dl>
                        {openReason && <p className="mt-2 text-[11px] text-text-secondary">Señal: {openReason}</p>}
                    </div>
                    <div>
                        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Salida</h3>
                        <dl className="space-y-1 font-mono text-xs">
                            <Row k="Hora" v={trade.close_at ? fmtTimeMs(trade.close_at) : '—'} />
                            <Row k="Precio" v={px(trade.close_price)} />
                            <Row k="Motivo" v={closeReasonLabel(reason)} />
                            <Row k="Duración" v={fmtDuration(trade.open_at, trade.close_at)} />
                        </dl>
                    </div>
                    <div>
                        <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Resultado</h3>
                        <div className={`font-mono text-2xl font-semibold ${trade.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>{fmtMoney(trade.pnl)}</div>
                        <div className="mt-1 font-mono text-[11px] text-text-secondary">SL {px(trade.sl)} · TP {px(trade.tp)}</div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function Row({ k, v }: { k: string; v: string }) {
    return (
        <div className="flex justify-between gap-3">
            <dt className="text-text-secondary">{k}</dt>
            <dd className="text-text-primary">{v}</dd>
        </div>
    );
}
