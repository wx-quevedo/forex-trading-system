import type { BotRunSummary, BotStatus } from '@/types';

/**
 * Estado visual de una estrategia para el rediseño de /bot. Traduce el status crudo del
 * bridge (running/paused/stopped/error + stop_reason) al lenguaje de badges que resuelve
 * la confusión "¿esperando o inactiva?":
 *   operando  — running con posición abierta
 *   armada    — running sin posición (lista, esperando su señal)
 *   pausada   — paused por el usuario o auto-pausa (arme caducado)
 *   detenida  — stopped
 *   bloqueada — circuit breaker / límite diario / error crítico (con motivo)
 */
export type BotUiState = 'operando' | 'armada' | 'pausada' | 'detenida' | 'bloqueada';

const has = (s: string | null | undefined, ...subs: string[]): boolean =>
    !!s && subs.some((x) => s.toLowerCase().includes(x));

export function deriveState(run: BotRunSummary): { kind: BotUiState; reason?: string } {
    const reason = run.stop_reason ?? '';
    if (run.status === 'running') {
        return { kind: run.open_positions > 0 ? 'operando' : 'armada' };
    }
    if (run.status === 'error') {
        return { kind: 'bloqueada', reason: run.error || reason || 'Error crítico.' };
    }
    if (run.status === 'stopped') {
        if (has(reason, 'diaria', 'límite de pérdida', 'limite de perdida')) {
            return { kind: 'bloqueada', reason };
        }
        return { kind: 'detenida', reason: reason || undefined };
    }
    // paused
    if (has(reason, 'racha', 'drawdown', 'breaker')) {
        return { kind: 'bloqueada', reason };
    }
    return { kind: 'pausada', reason: reason || undefined };
}

export const STATE_LABEL: Record<BotUiState, string> = {
    operando: 'Operando',
    armada: 'Armada · esperando señal',
    pausada: 'Pausada',
    detenida: 'Detenida',
    bloqueada: 'Bloqueada',
};

/** Clase de acento (línea superior) de la tarjeta según el estado. */
export const STATE_ACCENT: Record<BotUiState, string> = {
    operando: 'acc-pos',
    armada: 'acc-armed',
    pausada: 'acc-warn',
    detenida: 'acc-idle',
    bloqueada: 'acc-neg',
};

/** Estado global de la barra (deriva del status agregado; salud puede forzar 'problema'). */
export function globalState(status: BotStatus, degraded = false): { key: string; label: string } {
    if (degraded) return { key: 'error', label: 'Problema' };
    switch (status.status) {
        case 'running': return { key: 'running', label: 'Bot activo' };
        case 'paused': return { key: 'paused', label: 'Pausado' };
        case 'error': return { key: 'error', label: 'Problema' };
        default: return { key: 'stopped', label: 'Detenido' };
    }
}
