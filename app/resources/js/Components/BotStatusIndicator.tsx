type Status = 'active' | 'paused' | 'error';

const MAP: Record<Status, { color: string; label: string; pulse: boolean }> = {
    active: { color: 'bg-profit', label: 'Activo', pulse: true },
    paused: { color: 'bg-text-secondary', label: 'Pausado', pulse: false },
    error: { color: 'bg-loss', label: 'Error', pulse: true },
};

/** Pulso animado: verde activo / gris pausado / rojo error. */
export default function BotStatusIndicator({ status }: { status: Status }) {
    const s = MAP[status];
    return (
        <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${s.color} ${s.pulse ? 'animate-pulse-dot' : ''}`} />
            <span className="text-xs font-medium text-text-secondary">Bot: {s.label}</span>
        </div>
    );
}
