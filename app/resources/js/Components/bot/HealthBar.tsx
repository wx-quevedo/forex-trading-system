/**
 * Sección de SALUD del sistema (fila 3 de /bot). Chips de un vistazo para operación
 * desatendida: MT5, watchdog, auto-reanudar, bridge, BD, última señal. Datos de
 * /bot/health-summary (agrega bridge /health + /bot/lifecycle + watchdog_state.txt, cada
 * fuente degradada por su cuenta) + la última señal del status que la página ya sondea.
 * Verde = sano · ámbar = atención · rojo = problema · gris = desconocido.
 */
export interface HealthSummary {
    bridge?: { ok: boolean } | null;
    mt5?: { connected: boolean; trade_allowed: boolean } | null;
    watchdog?: { ok: boolean; state: number; age_seconds: number; fresh: boolean } | null;
    autoresume?: { armed: boolean; restart_paused: boolean | null; last_boot: string | null } | null;
    db?: { ok: boolean } | null;
}

type Tone = 'ok' | 'warn' | 'bad' | 'unknown';

const hhmm = (iso?: string | null): string | null => {
    if (!iso) return null;
    try {
        return new Date(iso).toLocaleTimeString('es-EC', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', hour12: false });
    } catch { return null; }
};

function Chip({ tone, label, sub }: { tone: Tone; label: string; sub?: string | null }) {
    return (
        <span className={`bui-chip ${tone}`}>
            <span className="d" aria-hidden="true" />
            <span className="lab">{label}</span>
            {sub && <span className="sub">{sub}</span>}
        </span>
    );
}

export default function HealthBar({ health, lastSignalAt, loading }: {
    health: HealthSummary | null; lastSignalAt?: string | null; loading?: boolean;
}) {
    if (loading && !health) {
        return (
            <section>
                <div className="bui-section-label">Salud del sistema</div>
                <div className="bui-health"><Chip tone="unknown" label="Consultando la salud…" /></div>
            </section>
        );
    }
    const h = health ?? {};

    // MT5
    const mt5: { tone: Tone; label: string } = h.mt5 == null
        ? { tone: 'unknown', label: 'MT5 —' }
        : !h.mt5.connected ? { tone: 'bad', label: 'MT5 desconectado' }
        : !h.mt5.trade_allowed ? { tone: 'warn', label: 'MT5 · Algo Trading off' }
        : { tone: 'ok', label: 'MT5 conectado' };

    // Watchdog
    const wd: { tone: Tone; label: string; sub?: string } = h.watchdog == null
        ? { tone: 'unknown', label: 'Watchdog —' }
        : !h.watchdog.fresh ? { tone: 'warn', label: 'Watchdog sin latido' }
        : h.watchdog.state > 0 ? { tone: 'warn', label: `Watchdog · alerta (${h.watchdog.state})` }
        : { tone: 'ok', label: 'Watchdog vivo' };

    // Auto-reanudar
    const arBoot = hhmm(h.autoresume?.last_boot);
    const ar: { tone: Tone; label: string; sub?: string | null } = h.autoresume == null || !h.autoresume.armed
        ? { tone: 'unknown', label: 'Auto-reanudar off' }
        : h.autoresume.restart_paused === true ? { tone: 'warn', label: 'Auto-reanudar · pausado por reinicio', sub: arBoot ? `reinicio ${arBoot}` : null }
        : h.autoresume.restart_paused === null ? { tone: 'warn', label: 'Auto-reanudar · sin lifecycle' }
        : { tone: 'ok', label: 'Auto-reanudar armado', sub: arBoot ? `últ. reinicio ${arBoot}` : null };

    const bridge: { tone: Tone; label: string } = h.bridge?.ok ? { tone: 'ok', label: 'Bridge alcanzable' } : { tone: 'bad', label: 'Bridge caído' };
    const db: { tone: Tone; label: string } = h.db?.ok ? { tone: 'ok', label: 'BD escribible' } : h.db == null ? { tone: 'unknown', label: 'BD —' } : { tone: 'bad', label: 'BD no escribible' };

    const sig = hhmm(lastSignalAt);

    return (
        <section>
            <div className="bui-section-label">Salud del sistema</div>
            <div className="bui-health">
                <Chip tone={mt5.tone} label={mt5.label} />
                <Chip tone={wd.tone} label={wd.label} sub={wd.sub} />
                <Chip tone={ar.tone} label={ar.label} sub={ar.sub} />
                <Chip tone={bridge.tone} label={bridge.label} />
                <Chip tone={db.tone} label={db.label} />
                <Chip tone={sig ? 'ok' : 'unknown'} label={sig ? `Última señal ${sig}` : 'Sin señales aún'} />
            </div>
        </section>
    );
}
