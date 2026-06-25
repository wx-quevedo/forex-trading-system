import { fmtDateTimeMs } from '@/lib/format';
import type { BotSignal } from '@/types';

interface Props {
    signal: BotSignal | null;
    strategyType: string;
    params: Record<string, number | string>;
    lot?: number;
    digits?: number;
    onClose: () => void;
}

interface Cond {
    label: string;
    met: boolean;
}

const n = (v: number | string | undefined, d: number) => (v == null || v === '' ? d : Number(v));

/** Deriva las condiciones evaluadas a partir de los valores del indicador del bot. */
function deriveConditions(sig: BotSignal, type: string, params: Record<string, number | string>): Cond[] {
    const iv = sig.indicator_values || {};
    const v = (k: string) => (iv[k] == null ? null : Number(iv[k]));

    if (type === 'ma_cross') {
        const f = v('fast');
        const s = v('slow');
        if (f == null || s == null) return [];
        return [
            { label: 'MA rápida > MA lenta (tendencia alcista)', met: f > s },
            { label: 'MA rápida < MA lenta (tendencia bajista)', met: f < s },
        ];
    }
    if (type === 'rsi' || type === 'combined') {
        const r = v('rsi');
        const over = n(type === 'combined' ? params.rsi_oversold : params.oversold, 30);
        const under = n(type === 'combined' ? params.rsi_overbought : params.overbought, 70);
        const rows: Cond[] = r == null ? [] : [
            { label: `RSI (${r.toFixed(2)}) ≤ sobreventa (${over})`, met: r <= over },
            { label: `RSI (${r.toFixed(2)}) ≥ sobrecompra (${under})`, met: r >= under },
        ];
        if (type === 'combined') {
            const close = v('close');
            const trend = v('trend_ma');
            if (close != null && trend != null) {
                rows.unshift(
                    { label: 'Precio > MA de tendencia (filtro alcista)', met: close > trend },
                    { label: 'Precio < MA de tendencia (filtro bajista)', met: close < trend },
                );
            }
        }
        return rows;
    }
    if (type === 'bollinger') {
        const close = v('close');
        const upper = v('upper');
        const lower = v('lower');
        if (close == null) return [];
        return [
            { label: 'Precio > banda superior (breakout alcista)', met: upper != null && close > upper },
            { label: 'Precio < banda inferior (breakout bajista)', met: lower != null && close < lower },
        ];
    }
    if (type === 'macd') {
        const m = v('macd');
        const s = v('signal');
        if (m == null || s == null) return [];
        return [
            { label: 'MACD > línea de señal', met: m > s },
            { label: 'MACD < línea de señal', met: m < s },
        ];
    }
    return [];
}

export default function BotDecisionPanel({ signal, strategyType, params, lot, digits = 5, onClose }: Props) {
    const fmt = (v: number | null) => (v == null ? '—' : Number(v).toFixed(digits));

    if (!signal) {
        return (
            <div className="rounded-lg border border-border bg-bg-surface p-4 text-sm text-text-secondary">
                Haz clic en un marcador del gráfico para ver el detalle de esa evaluación.
            </div>
        );
    }

    const conditions = deriveConditions(signal, strategyType, params);
    const sigColor = signal.signal_type === 'buy' ? 'text-profit' : signal.signal_type === 'sell' ? 'text-loss' : 'text-text-secondary';

    return (
        <div className="rounded-lg border border-border bg-bg-surface p-4">
            <div className="mb-3 flex items-start justify-between">
                <div>
                    <div className="text-sm font-semibold">Detalle de la evaluación</div>
                    <div className="font-mono text-[11px] text-text-secondary">
                        {fmtDateTimeMs(signal.evaluated_at)}
                        {signal.candle_time ? ` · vela ${new Date(signal.candle_time * 1000).toLocaleTimeString('en-GB')}` : ''}
                    </div>
                </div>
                <button type="button" onClick={onClose} className="text-text-secondary hover:text-text-primary" aria-label="Cerrar">
                    ✕
                </button>
            </div>

            <div className="mb-3 flex items-center gap-2">
                <span className={`font-mono text-sm font-bold ${sigColor}`}>{signal.signal_type.toUpperCase()}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${signal.executed ? 'bg-accent/15 text-accent' : 'bg-bg-elevated text-text-secondary'}`}>
                    {signal.executed ? 'Ejecutada' : 'No ejecutada'}
                </span>
            </div>

            <p className="mb-3 text-xs text-text-secondary">{signal.reason}</p>

            {conditions.length > 0 && (
                <div className="mb-3">
                    <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Condiciones</h3>
                    <ul className="space-y-1">
                        {conditions.map((c) => (
                            <li key={c.label} className={`flex items-center gap-2 text-xs ${c.met ? 'text-profit' : 'text-text-secondary'}`}>
                                <span className="font-mono">{c.met ? '✓' : '·'}</span>
                                {c.label}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="mb-1">
                <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Indicadores</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {Object.entries(signal.indicator_values || {}).map(([k, v]) => (
                        <div key={k} className="flex justify-between font-mono text-xs">
                            <span className="text-text-secondary">{k}</span>
                            <span className="text-text-primary">{fmt(v)}</span>
                        </div>
                    ))}
                </div>
            </div>

            {signal.executed && (
                <div className="mt-3 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-text-primary">
                    Orden ejecutada{lot ? ` · lote ${lot}` : ''} sobre {signal.symbol}.
                </div>
            )}
        </div>
    );
}
