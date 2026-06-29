// Calendario económico (Fase 6): tipos y utilidades de MARCADO/contexto.
// Contextualiza outliers; NO predice. "Coincide con evento, no es causa probada."

export interface CalEvent {
    time: number; // epoch (s) UTC
    currency: string;
    impact: string; // High | Medium | Low
    title: string;
    source?: string; // feed | nfp | seed
    status?: string; // confirmed | por_verificar
}

/** Evento de alto impacto más cercano a `ts` dentro de ±windowMin, o null. */
export function eventNear(ts: number, events: CalEvent[], windowMin = 60): CalEvent | null {
    const w = windowMin * 60;
    let best: CalEvent | null = null;
    let bd = w + 1;
    for (const e of events) {
        const d = Math.abs(ts - e.time);
        if (d <= w && d < bd) {
            best = e;
            bd = d;
        }
    }
    return best;
}

export function fmtEventUtc(ts: number): string {
    return new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}
