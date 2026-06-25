interface Props {
    label: string;
    value: string;
    delta?: number | null;
    valueClass?: string;
}

/** Valor grande monoespaciado + label pequeño + delta opcional (↑/↓ %). */
export default function MetricBadge({ label, value, delta, valueClass = 'text-text-primary' }: Props) {
    return (
        <div className="rounded-lg border border-border bg-bg-surface px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-text-secondary">{label}</div>
            <div className={`mt-1 font-mono text-2xl font-semibold ${valueClass}`}>{value}</div>
            {delta !== undefined && delta !== null && (
                <div className={`mt-0.5 text-xs font-mono ${delta >= 0 ? 'text-profit' : 'text-loss'}`}>
                    {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(2)}%
                </div>
            )}
        </div>
    );
}
