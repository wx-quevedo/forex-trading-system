import { type BotUiState, STATE_LABEL } from '@/lib/botState';

/**
 * Badge de estado de una estrategia — el elemento signature del panel.
 * OPERANDO = relleno sólido; ARMADA·esperando = contorno + punto que "respira"
 * (vivo, a la espera). Se detiene con prefers-reduced-motion (definido en app.css).
 */
export default function BotStatusBadge({ kind }: { kind: BotUiState }) {
    return (
        <span className={`bui-badge bui-b-${kind}`}>
            <span className="bui-dot" aria-hidden="true" />
            {STATE_LABEL[kind]}
        </span>
    );
}
