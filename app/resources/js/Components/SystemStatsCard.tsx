import { useEffect, useState } from 'react';
import type { SystemStats } from '@/types';

/**
 * Tarjeta de monitoreo de carga del proceso del bridge (CPU/RAM del sistema y del
 * proceso). Sondea cada 1.5s. Solo local (el bridge está atado a 127.0.0.1).
 */
export default function SystemStatsCard() {
    const [s, setS] = useState<SystemStats | null>(null);
    const [err, setErr] = useState(false);

    useEffect(() => {
        let alive = true;
        const tick = async () => {
            try {
                const { data } = await window.axios.get('/explorer/system-stats');
                if (alive) { setS(data as SystemStats); setErr(false); }
            } catch {
                if (alive) setErr(true);
            }
        };
        tick();
        const id = window.setInterval(tick, 1500);
        return () => { alive = false; window.clearInterval(id); };
    }, []);

    return (
        <section className="rounded-lg border border-border bg-bg-surface p-3">
            <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Carga de la tower</h2>
                {s && <span className="font-mono text-[11px] text-text-secondary">{s.physical_cores} núcleos · {s.logical_cores} hilos</span>}
            </div>
            {err || !s ? (
                <p className="text-xs text-text-secondary">{err ? 'No se pudo leer la carga (¿bridge apagado?).' : 'Cargando…'}</p>
            ) : (
                <div className="grid grid-cols-2 gap-3">
                    <Bar label="CPU sistema" pct={s.system_cpu_percent} text={`${s.system_cpu_percent}%`} />
                    <Bar label="CPU bridge" pct={s.process_cpu_percent_norm} text={`${s.process_cpu_percent_norm}% (${s.process_cpu_percent}% bruto)`} />
                    <Bar label="RAM sistema" pct={s.ram_percent} text={`${s.ram_used_gb} / ${s.ram_total_gb} GB`} />
                    <Bar label="RAM bridge" pct={Math.min(100, (s.process_ram_mb / 1000))} text={`${s.process_ram_mb} MB`} />
                </div>
            )}
        </section>
    );
}

function Bar({ label, pct, text }: { label: string; pct: number; text: string }) {
    const w = Math.max(0, Math.min(100, pct));
    const color = w > 85 ? 'bg-loss' : w > 50 ? 'bg-warning' : 'bg-profit';
    return (
        <div>
            <div className="mb-1 flex items-baseline justify-between">
                <span className="text-[11px] uppercase tracking-wide text-text-secondary">{label}</span>
                <span className="font-mono text-[11px] text-text-primary">{text}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-bg-elevated">
                <div className={`h-full rounded-full ${color} transition-[width] duration-300`} style={{ width: `${w}%` }} />
            </div>
        </div>
    );
}
