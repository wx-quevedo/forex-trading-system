import { useMemo } from 'react';
import { fmtDuration, fmtMoney, fmtPrice } from '@/lib/format';
import type { BotPosition, BotRunSummary } from '@/types';

/** Dígitos de precio aproximados por símbolo (para entrada/actual/SL/TP sin ruido). */
function priceDigits(symbol: string): number {
    if (/jpy/i.test(symbol)) return 3;
    if (/gold|xau|silver|xag/i.test(symbol)) return 2;
    if (/cash|us30|us100|us500|ger|nas|spx/i.test(symbol)) return 2;
    return 5;
}

/**
 * Columna del "ahora mismo" (fila 1, a la derecha del gráfico): posiciones abiertas como
 * TARJETAS compactas apiladas (una por posición). Prioriza dirección y PnL flotante — lo que
 * se mira de un vistazo. Datos de status.positions (mismo polling de 3s) + el tipo de la
 * estrategia cruzado desde runs. Tiempo abierta = ahora − time (el bridge ya normaliza a UTC).
 */
export default function PositionsPanel({ positions, runs }: { positions: BotPosition[]; runs: BotRunSummary[] }) {
    const typeBySid = useMemo(() => Object.fromEntries(runs.map((r) => [r.strategy_id, r.strategy.type])), [runs]);
    const nowIso = new Date().toISOString();

    return (
        <div>
            <div className="bui-poscol-head"><span>Posiciones abiertas</span><span className="count">{positions.length}</span></div>
            {positions.length === 0 ? (
                <div className="bui-poscol-empty">Sin posiciones abiertas ahora mismo. Las estrategias armadas abrirán cuando llegue su señal.</div>
            ) : (
                <div className="flex flex-col gap-3">
                    {positions.map((p) => {
                        const d = priceDigits(p.symbol);
                        const buy = p.type === 0;
                        const type = p.strategy_id != null ? typeBySid[p.strategy_id] ?? '' : '';
                        const pnlUp = p.profit >= 0;
                        return (
                            <div key={p.ticket} className={`bui-poscard ${buy ? 'buy' : 'sell'}`}>
                                <div className="bui-poscard-head">
                                    <span className="bui-poscard-strat">{p.symbol} <span className="type">{type}</span></span>
                                    <span className={`bui-poscard-dir ${buy ? 'buy' : 'sell'}`}>{buy ? 'BUY' : 'SELL'}</span>
                                </div>
                                <div className={`bui-poscard-pnl ${pnlUp ? 'up' : 'down'}`}>{fmtMoney(p.profit)}</div>
                                <div className="bui-poscard-px">{fmtPrice(p.price_open, d)} <span className="arrow">→</span> {fmtPrice(p.price_current, d)}</div>
                                <div className="bui-poscard-sltp">
                                    <span className="sl">SL {fmtPrice(p.sl, d)}</span>
                                    <span className="tp">TP {fmtPrice(p.tp, d)}</span>
                                </div>
                                <div className="bui-poscard-meta">lote {p.volume} · {p.time ? fmtDuration(new Date(p.time * 1000).toISOString(), nowIso) : '—'}</div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
