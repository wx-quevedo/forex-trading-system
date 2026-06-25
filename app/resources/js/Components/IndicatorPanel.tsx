import type { Oscillator } from './CandleChart';

interface Props {
    value: Oscillator;
    onChange: (value: Oscillator) => void;
}

const OPTIONS: { key: Oscillator; label: string }[] = [
    { key: 'none', label: 'Ninguno' },
    { key: 'rsi', label: 'RSI' },
    { key: 'macd', label: 'MACD' },
];

/** Selector segmentado del oscilador inferior del chart. */
export default function IndicatorPanel({ value, onChange }: Props) {
    return (
        <div className="inline-flex rounded-lg border border-border bg-bg-surface p-0.5">
            {OPTIONS.map((o) => (
                <button
                    key={o.key}
                    type="button"
                    onClick={() => onChange(o.key)}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                        value === o.key
                            ? 'bg-bg-elevated text-text-primary'
                            : 'text-text-secondary hover:text-text-primary'
                    }`}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}
