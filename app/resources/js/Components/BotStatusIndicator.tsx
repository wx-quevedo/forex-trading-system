type Status = 'running' | 'paused' | 'stopped' | 'error';

const MAP: Record<Status, { color: string; label: string; pulse: boolean }> = {
    running: { color: 'bg-profit', label: 'Activo', pulse: true },
    paused: { color: 'bg-text-secondary', label: 'Pausado', pulse: false },
    stopped: { color: 'bg-border', label: 'Detenido', pulse: false },
    error: { color: 'bg-loss', label: 'Error', pulse: true },
};

/** Refleja el estado real del bot: verde activo / gris pausado / neutro detenido / rojo error. */
export default function BotStatusIndicator({ status }: { status: Status | string }) {
    const s = MAP[(status as Status)] ?? MAP.stopped;
    return (
        <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${s.color} ${s.pulse ? 'animate-pulse-dot' : ''}`} />
            <span className="text-xs font-medium text-text-secondary">Bot: {s.label}</span>
        </div>
    );
}
