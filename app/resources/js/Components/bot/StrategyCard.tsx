import { useState } from 'react';
import { deriveState, STATE_ACCENT } from '@/lib/botState';
import { fmtMoney } from '@/lib/format';
import BotStatusBadge from './BotStatusBadge';
import type { BotRunSummary } from '@/types';

interface Props {
    run: BotRunSummary;
    name?: string;
    selected: boolean;
    busy: boolean;
    onSelect: () => void;
    onPause: () => void;
    onResume: () => void;
    onStop: () => void;
    onRemove: () => void;
}

/**
 * Tarjeta compacta de una estrategia en el sidebar: estado inequívoco (badge signature),
 * PnL del día, parámetros clave y una acción primaria contextual (Pausar/Reanudar). Es a
 * la vez SELECTOR: al pulsarla, el gráfico grande de la derecha muestra esa estrategia
 * (SL/TP/entrada de su posición van en el chart, no aquí). Lo secundario en el menú ⋯.
 */
export default function StrategyCard({ run, name, selected, busy, onSelect, onPause, onResume, onStop, onRemove }: Props) {
    const [menu, setMenu] = useState(false);
    const { kind, reason } = deriveState(run);
    const cfg = run.config;

    const pnl = run.daily_pnl ?? 0;
    const pnlTone = pnl > 0 ? 'up' : pnl < 0 ? 'down' : 'flat';

    const riskTag = cfg.risk_percent ? `riesgo ${cfg.risk_percent}%` : `${cfg.lot} lote`;
    const modeTag = cfg.sl_mode === 'atr' ? `ATR×${cfg.atr_period ?? 14}` : 'stops fijos';

    const canPause = run.status === 'running';
    const canResume = run.status === 'paused' || run.status === 'stopped' || run.status === 'error';
    const canStop = run.status === 'running' || run.status === 'paused';
    const stop = (e: React.MouseEvent) => e.stopPropagation();

    return (
        <div
            className={`bui-card compact ${STATE_ACCENT[kind]} ${selected ? 'is-selected' : ''}`}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            onClick={onSelect}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
        >
            <div className="bui-card-head">
                <div>
                    <div className="bui-sym">
                        {run.strategy.symbol} <span className="type">· {run.strategy.type}</span>
                        {name && <span className="sub">{name}</span>}
                    </div>
                    <div style={{ marginTop: 8 }}>
                        <BotStatusBadge kind={kind} />
                    </div>
                </div>
                <div>
                    <div className="bui-pnl-label">PnL día</div>
                    <div className={`bui-pnl ${pnlTone}`}>{fmtMoney(pnl)}</div>
                </div>
            </div>

            {(kind === 'bloqueada' || kind === 'pausada') && reason && (
                <div className={`bui-reason ${kind === 'bloqueada' ? '' : 'warn'}`}>
                    <span aria-hidden="true">{kind === 'bloqueada' ? '⚠' : '◷'}</span>
                    <span>{reason}</span>
                </div>
            )}

            <div className="bui-cardmeta">
                <span>{riskTag}</span><span>·</span><span>{modeTag}</span><span>·</span><span>límite ${cfg.daily_loss_limit}</span>
            </div>

            <div className="bui-card-foot" onClick={stop}>
                {canPause ? (
                    <button type="button" className="bui-btn sm" onClick={onPause} disabled={busy}>Pausar</button>
                ) : canResume ? (
                    <button type="button" className="bui-btn sm primary" onClick={onResume} disabled={busy}>Reanudar</button>
                ) : <span />}

                <div className="bui-kebab">
                    <button type="button" className="bui-kebab-btn" aria-label="Más acciones" aria-haspopup="true" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>⋯</button>
                    {menu && (
                        <>
                            <div className="bui-backdrop-t" onClick={() => setMenu(false)} />
                            <div className="bui-menu" role="menu">
                                {canStop && <button type="button" role="menuitem" onClick={() => { setMenu(false); onStop(); }} disabled={busy}>Detener</button>}
                                <button type="button" role="menuitem" className="danger" onClick={() => { setMenu(false); onRemove(); }} disabled={busy}>Quitar de la cartera</button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
