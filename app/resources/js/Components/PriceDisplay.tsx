import type { Tick } from '@/types';

interface Props {
    symbol: string;
    tick: Tick | null;
    digits?: number;
}

/** Precio con bid/ask separados y el dígito de pip resaltado. */
function Quote({ label, value, digits, accent }: { label: string; value: number; digits: number; accent: string }) {
    const str = value.toFixed(digits);
    // Resalta el penúltimo dígito (pip) en tamaño mayor.
    const pipIndex = str.length - 2;
    return (
        <div className="flex flex-col items-start">
            <span className="text-[10px] uppercase tracking-wide text-text-secondary">{label}</span>
            <span className={`font-mono text-lg leading-tight ${accent}`}>
                {str.slice(0, pipIndex)}
                <span className="text-2xl font-semibold">{str.slice(pipIndex, pipIndex + 1)}</span>
                {str.slice(pipIndex + 1)}
            </span>
        </div>
    );
}

export default function PriceDisplay({ symbol, tick, digits = 5 }: Props) {
    return (
        <div className="flex items-center gap-6 rounded-lg border border-border bg-bg-surface px-4 py-3">
            <div className="font-mono text-sm font-semibold text-text-primary">{symbol}</div>
            {tick ? (
                <div className="flex items-center gap-6">
                    <Quote label="Bid" value={tick.bid} digits={digits} accent="text-loss" />
                    <Quote label="Ask" value={tick.ask} digits={digits} accent="text-profit" />
                    <div className="flex flex-col items-start">
                        <span className="text-[10px] uppercase tracking-wide text-text-secondary">Spread</span>
                        <span className="font-mono text-sm text-text-secondary">
                            {Math.round((tick.ask - tick.bid) * Math.pow(10, digits - 1) * 10)}
                        </span>
                    </div>
                </div>
            ) : (
                <span className="font-mono text-sm text-text-secondary">esperando precio…</span>
            )}
        </div>
    );
}
