import { fmtMoney } from '@/lib/format';
import type { BotEvent } from '@/types';

/**
 * Entrada del journal PERSISTENTE del bridge (bot_journal.jsonl, vía /bot/journal).
 * Solo estos 4 kinds se registran ahí, CON detalle de fidelidad.
 */
export interface JournalEntry {
    ts: string;
    kind: string; // open | close | blocked | arm_expired
    symbol?: string;
    timeframe?: string;
    strategy_type?: string;
    strategy_id?: number;
    direction?: string;
    volume?: number;
    entry?: number;
    sl?: number;
    tp?: number;
    atr_value?: number | null;
    sl_dist_pips?: number | null;
    tp_dist_pips?: number | null;
    risk_usd?: number | null;
    risk_pct_actual?: number | null;
    pnl?: number;
    close_price?: number | null;
    close_reason?: string | null;
    reason?: string;
    hours?: number;
}

interface FeedItem { key: string; ts: string; tag: string; cls: string; strat: string; detail: string; }

const fmtT = (iso: string): string => {
    try {
        return new Date(iso).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    } catch { return iso; }
};

/** jsonl (bot_journal): aperturas/cierres/bloqueos/arme-caducado con detalle. */
function fromJournal(e: JournalEntry, i: number): FeedItem | null {
    const strat = `${e.symbol ?? '?'} ${e.strategy_type ?? ''}`.trim();
    const dir = (e.direction ?? '').toUpperCase();
    switch (e.kind) {
        case 'open':
            return { key: `j${i}`, ts: e.ts, tag: 'Abre', cls: 'bui-tag-open', strat,
                detail: `${dir} ${e.volume} @ ${e.entry} · SL ${e.sl_dist_pips}p / TP ${e.tp_dist_pips}p · ATR ${e.atr_value ?? '—'} · riesgo $${e.risk_usd ?? '—'}` };
        case 'close': {
            const pnl = e.pnl ?? 0;
            return { key: `j${i}`, ts: e.ts, tag: 'Cierra', cls: pnl >= 0 ? 'bui-tag-up' : 'bui-tag-down', strat,
                detail: `${dir} ${e.volume} → ${e.close_price ?? ''} · PnL ${fmtMoney(pnl)} · ${e.close_reason ?? ''}` };
        }
        case 'blocked':
            return { key: `j${i}`, ts: e.ts, tag: 'No abrió', cls: 'bui-tag-warn', strat, detail: e.reason ?? '' };
        case 'arm_expired':
            return { key: `j${i}`, ts: e.ts, tag: 'Arme caducado', cls: 'bui-tag-warn', strat, detail: `${e.hours ?? '?'}h sin señal → pausada por seguridad` };
        default:
            return null;
    }
}

const EVENT_TAG: Record<string, { label: string; cls: string }> = {
    started: { label: 'Iniciada', cls: 'bui-tag-accent' },
    paused: { label: 'Pausada', cls: 'bui-tag-warn' },
    resumed: { label: 'Reanudada', cls: 'bui-tag-accent' },
    stopped: { label: 'Detenida', cls: 'bui-tag-idle' },
    removed: { label: 'Quitada', cls: 'bui-tag-idle' },
    daily_limit: { label: 'Límite diario', cls: 'bui-tag-neg' },
    panic: { label: 'PANIC', cls: 'bui-tag-neg' },
    error: { label: 'Error', cls: 'bui-tag-neg' },
    hedge: { label: 'Hedge', cls: 'bui-tag-warn' },
};
// Aperturas/cierres YA vienen del jsonl (con detalle) → se omiten del feed de eventos.
const SKIP_EVENTS = new Set(['trade_opened', 'trade_closed']);

function fromEvent(e: BotEvent, name: (sid?: number) => string): FeedItem | null {
    if (SKIP_EVENTS.has(e.type)) return null;
    const t = EVENT_TAG[e.type] ?? { label: e.type, cls: e.severity === 'error' ? 'bui-tag-neg' : e.severity === 'warning' ? 'bui-tag-warn' : 'bui-tag-idle' };
    return { key: `e${e.id}`, ts: e.occurred_at, tag: t.label, cls: t.cls, strat: e.strategy_id ? name(e.strategy_id) : 'Global', detail: e.message };
}

/**
 * Feed de Actividad — FUSIÓN de dos fuentes read-only: bot_journal.jsonl (aperturas/
 * cierres/bloqueos/arme-caducado con detalle de fidelidad) + bot_events de /bot/status
 * (pausas/reanudaciones/límite-diario/panic/error). Cronológico, más reciente arriba.
 * (Los circuit breakers no se journalizan hoy → se ven como estado en la tarjeta.)
 */
export default function ActivityFeed({ journal, events, strategyName, limit = 40 }: {
    journal: JournalEntry[]; events: BotEvent[]; strategyName: (sid?: number) => string; limit?: number;
}) {
    const items = [
        ...journal.map((e, i) => fromJournal(e, i)),
        ...events.map((e) => fromEvent(e, strategyName)),
    ].filter((x): x is FeedItem => x !== null);
    items.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    const shown = items.slice(0, limit);

    return (
        <div className="bui-panel">
            <div className="bui-panel-head"><span>Actividad</span><span className="count">{items.length}</span></div>
            {shown.length === 0 ? (
                <div className="bui-panel-empty">Sin actividad todavía. Aquí verás aperturas, cierres, pausas/reanudaciones y protecciones.</div>
            ) : (
                <div className="bui-feed">
                    {shown.map((it) => (
                        <div key={it.key} className="bui-feeditem">
                            <span className="bui-feed-time">{fmtT(it.ts)}</span>
                            <span className={`bui-feed-tag ${it.cls}`}>{it.tag}</span>
                            <div className="bui-feed-body">
                                <div className="bui-feed-strat">{it.strat}</div>
                                <div className="bui-feed-detail">{it.detail}</div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
