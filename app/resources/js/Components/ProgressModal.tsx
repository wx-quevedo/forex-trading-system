/**
 * Modal con barra de progreso indeterminada para tareas en ejecución
 * (backtest / optimización). Sin emojis, coherente con el tema dark.
 */
export default function ProgressModal({ title, detail }: { title: string; detail?: string }) {
    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60">
            <div className="w-full max-w-sm rounded-lg border border-border bg-bg-surface p-5 shadow-2xl">
                <div className="mb-1 text-sm font-semibold text-text-primary">{title}</div>
                {detail && <div className="mb-3 text-xs text-text-secondary">{detail}</div>}
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-bg-elevated">
                    <div className="animate-progress-indeterminate h-full w-1/3 rounded-full bg-accent" />
                </div>
            </div>
        </div>
    );
}
