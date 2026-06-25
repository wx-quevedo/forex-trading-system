import type { SignalLogEntry } from '@/types';

/** Tabla de señales evaluadas (timestamp, tipo, símbolo, resultado). */
export default function SignalLog({ signals }: { signals: SignalLogEntry[] }) {
    if (signals.length === 0) {
        return (
            <div className="rounded-lg border border-border bg-bg-surface p-6 text-center text-sm text-text-secondary">
                Sin señales registradas todavía.
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-lg border border-border bg-bg-surface">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-secondary">
                        <th className="px-4 py-2 font-medium">Hora</th>
                        <th className="px-4 py-2 font-medium">Símbolo</th>
                        <th className="px-4 py-2 font-medium">Señal</th>
                        <th className="px-4 py-2 font-medium">Estado</th>
                        <th className="px-4 py-2 font-medium">Motivo</th>
                    </tr>
                </thead>
                <tbody>
                    {signals.map((s) => (
                        <tr key={s.id} className="border-b border-border/50 last:border-0">
                            <td className="px-4 py-2 font-mono text-xs text-text-secondary">{s.evaluated_at}</td>
                            <td className="px-4 py-2 font-mono text-xs text-text-primary">{s.symbol}</td>
                            <td className="px-4 py-2">
                                <span
                                    className={`font-mono text-xs font-semibold ${
                                        s.signal_type === 'buy'
                                            ? 'text-profit'
                                            : s.signal_type === 'sell'
                                              ? 'text-loss'
                                              : 'text-text-secondary'
                                    }`}
                                >
                                    {s.signal_type.toUpperCase()}
                                </span>
                            </td>
                            <td className="px-4 py-2">
                                <span
                                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                        s.executed ? 'bg-accent/15 text-accent' : 'bg-bg-elevated text-text-secondary'
                                    }`}
                                >
                                    {s.executed ? 'Ejecutada' : 'No ejecutada'}
                                </span>
                            </td>
                            <td className="px-4 py-2 text-xs text-text-secondary">{s.reason ?? '—'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
