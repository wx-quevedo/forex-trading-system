/**
 * Modal de progreso para tareas en ejecución (backtest / optimización / búsqueda).
 * - Indeterminado por defecto (barra animada).
 * - Determinado si se pasa `value`/`max` (barra real con %).
 * - Botón Cancelar opcional (`onCancel`).
 * Sin emojis, coherente con el tema dark.
 */
export default function ProgressModal({
    title,
    detail,
    value,
    max,
    onCancel,
    cancelLabel = 'Cancelar',
}: {
    title: string;
    detail?: string;
    value?: number;
    max?: number;
    onCancel?: () => void;
    cancelLabel?: string;
}) {
    const determinate = typeof value === 'number' && typeof max === 'number' && max > 0;
    const pct = determinate ? Math.min(100, Math.round((value! / max!) * 100)) : 0;

    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60">
            <div className="w-full max-w-sm rounded-lg border border-border bg-bg-surface p-5 shadow-2xl">
                <div className="mb-1 flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold text-text-primary">{title}</span>
                    {determinate && <span className="font-mono text-xs text-text-secondary">{pct}%</span>}
                </div>
                {detail && <div className="mb-3 break-words whitespace-pre-line text-xs text-text-secondary">{detail}</div>}

                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-bg-elevated">
                    {determinate ? (
                        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
                    ) : (
                        <div className="animate-progress-indeterminate h-full w-1/3 rounded-full bg-accent" />
                    )}
                </div>

                {determinate && (
                    <div className="mt-1.5 text-right font-mono text-[11px] text-text-secondary">
                        {value!.toLocaleString()} / {max!.toLocaleString()}
                    </div>
                )}

                {onCancel && (
                    <div className="mt-4 flex justify-end">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="rounded-md border border-loss/50 px-3 py-1.5 text-sm text-loss hover:bg-loss/10"
                        >
                            {cancelLabel}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
