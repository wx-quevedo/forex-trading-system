import { fmtMoney } from '@/lib/format';
import { globalState } from '@/lib/botState';
import type { BotLifetimePnl, BotStatus } from '@/types';

interface Props {
    status: BotStatus;
    busy: boolean;
    degraded?: boolean;      // salud degradada (Parte 3) → fuerza "Problema"
    lifetime?: BotLifetimePnl | null;  // realizado de vida (MT5 por magic, ciclo 30s)
    floatingLive?: number;             // flotante del polling de 3s (posiciones del status)
    onPauseAll: () => void;
    onResumeAll: () => void;
    onPanic: () => void;
}

/**
 * Barra de estado global (sticky). Lo primero que se mira: ¿corre el bot? ¿cuánto va hoy?
 * ¿puedo pararlo ya? El PnL del día es el número protagonista de la página.
 */
export default function GlobalBar({ status, busy, degraded, lifetime, floatingLive, onPauseAll, onResumeAll, onPanic }: Props) {
    const runs = status.runs ?? [];
    const running = runs.filter((r) => r.status === 'running').length;
    const paused = runs.filter((r) => r.status === 'paused').length;
    const total = runs.length;
    const gs = globalState(status, degraded);

    const pnl = status.daily_pnl ?? 0;
    const pnlTone = pnl > 0 ? 'up' : pnl < 0 ? 'down' : '';

    // PnL TOTAL de vida = realizado (MT5 por magic, 30s) + flotante EN VIVO (3s).
    const lifeTotal = lifetime ? +(lifetime.realized + (floatingLive ?? lifetime.floating)).toFixed(2) : null;
    const lifeTone = lifeTotal == null ? '' : lifeTotal > 0 ? 'up' : lifeTotal < 0 ? 'down' : '';
    const lifeHelp = lifetime
        ? `Realizado ${fmtMoney(lifetime.realized)} (${lifetime.closed_count} cierres, fuente: historial del bróker por magic) + flotante ${fmtMoney(floatingLive ?? lifetime.floating)} (${lifetime.open_count} posiciones) · desde ${lifetime.since ?? lifetime.epoch}`
        : '';

    const heatUsed = status.portfolio_heat_used_pct ?? 0;
    const heatLimit = status.portfolio_heat_pct ?? 0;

    return (
        <div className="bui-globalbar sticky top-3 z-20">
            <div className={`bui-gb-state is-${gs.key}`}>
                <span className="bui-gb-dot" aria-hidden="true" />
                <span className="bui-gb-lab">{gs.label}</span>
            </div>

            <div className="bui-gb-arm">
                <b className="bui-num">{running}/{total || 0}</b> armadas
                {heatLimit > 0 && <> · heat <b className="bui-num">{heatUsed.toFixed(0)}%</b>/{heatLimit.toFixed(0)}%</>}
            </div>

            <div className="bui-hero">
                <div className="bui-hero-label">PnL del día</div>
                <div className={`bui-hero-val ${pnlTone}`}>{fmtMoney(pnl)}</div>
            </div>

            {lifeTotal != null && (
                <div className="bui-hero" title={lifeHelp}>
                    <div className="bui-hero-label">PnL total</div>
                    <div className={`bui-hero-val ${lifeTone}`}>{fmtMoney(lifeTotal)}</div>
                </div>
            )}

            <div className="bui-gactions">
                {running > 0 ? (
                    <button type="button" className="bui-btn ghost" onClick={onPauseAll} disabled={busy}>Pausar todo</button>
                ) : paused > 0 ? (
                    <button type="button" className="bui-btn ghost" onClick={onResumeAll} disabled={busy}>Reanudar todo</button>
                ) : null}
                <button type="button" className="bui-btn danger" onClick={onPanic} disabled={busy}>PANIC — Cerrar todo</button>
            </div>
        </div>
    );
}
