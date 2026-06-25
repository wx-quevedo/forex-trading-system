import { useEffect, useState } from 'react';
import { fmtDateTimeMs } from '@/lib/format';

/**
 * Reloj en vivo con milisegundos (hora local del navegador, Ecuador = UTC-5).
 * Componente aislado: solo él se re-renderiza ~20 fps, no la página entera.
 */
export default function LiveClock() {
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        const id = window.setInterval(() => setNow(new Date()), 50);
        return () => window.clearInterval(id);
    }, []);

    return (
        <span className="font-mono text-xs tabular-nums text-text-secondary" title="Hora local (Ecuador, UTC-5)">
            {fmtDateTimeMs(now)}
        </span>
    );
}
