import { fmtMoney } from '@/lib/format';
import { globalState } from '@/lib/botState';
import type { BotStatus } from '@/types';

interface Props {
    status: BotStatus;
    busy: boolean;
    degraded?: boolean;      // salud degradada (Parte 3) → fuerza "Problema"
    onPauseAll: () => void;
    onResumeAll: () => void;
    onPanic: () => void;
}

/**
 * Barra de estado global (sticky). Lo primero que se mira: ¿corre el bot? ¿cuánto va hoy?
 * ¿puedo pararlo ya? El PnL del día es el número protagonista de la página.
 */
export default function GlobalBar({ status, busy, degraded, onPauseAll, onResumeAll, onPanic }: Props) {
    const runs = status.runs ?? [];
    const running = runs.filter((r) => r.status === 'running').length;
    const paused = runs.filter((r) => r.status === 'paused').length;
    const total = runs.length;
    const gs = globalState(status, degraded);

    const pnl = status.daily_pnl ?? 0;
    const pnlTone = pnl > 0 ? 'up' : pnl < 0 ? 'down' : '';

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
