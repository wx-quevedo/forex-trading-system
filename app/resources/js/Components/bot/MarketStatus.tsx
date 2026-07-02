import { useEffect, useState } from 'react';

/**
 * Franja de estado de mercado del símbolo seleccionado, ENCIMA del gráfico.
 * Fuente: /api/market/session/{symbol} (bridge → MT5). El punto abierto/cerrado es DATO
 * REAL del bróker (frescura del último tick de XM). La HORA del próximo cambio es la
 * aproximación genérica del bridge (Vie/Dom ~21:00 UTC) → se marca "aprox." y puede
 * desviarse ~1h en cambios de horario de verano/feriados. Degrada con gracia: si el
 * endpoint falla, muestra "estado no disponible" en gris, no rompe.
 */
interface Session {
    symbol: string;
    open: boolean;
    last_tick_age_seconds: number | null;
    next_change: number | null; // unix (s) en UTC
    next_change_type: 'open' | 'close' | null;
    note?: string;
}

const fmt = (tsSec: number, tz: string) =>
    new Date(tsSec * 1000).toLocaleString('es-EC', {
        timeZone: tz, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    });

export default function MarketStatus({ symbol }: { symbol: string }) {
    const [s, setS] = useState<Session | null>(null);
    const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading');

    useEffect(() => {
        let alive = true;
        const load = async () => {
            try {
                const { data } = await window.axios.get(`/api/market/session/${encodeURIComponent(symbol)}`);
                if (!alive) return;
                setS((data?.data ?? data) as Session);
                setState('ok');
            } catch {
                if (alive) setState('failed');
            }
        };
        setState('loading');
        setS(null);
        load();
        const id = window.setInterval(load, 60000);
        return () => { alive = false; window.clearInterval(id); };
    }, [symbol]);

    if (state === 'failed' || (state === 'ok' && !s)) {
        return (
            <div className="bui-mktstrip">
                <span className="bui-mkt-dot closed" aria-hidden="true" />
                <span className="bui-mkt-lab" style={{ color: 'var(--text-2)' }}>Estado de mercado no disponible</span>
            </div>
        );
    }
    if (state === 'loading' || !s) {
        return (
            <div className="bui-mktstrip">
                <span className="bui-mkt-dot closed" aria-hidden="true" />
                <span className="bui-mkt-lab" style={{ color: 'var(--text-3)' }}>Consultando el mercado…</span>
            </div>
        );
    }

    const verb = s.next_change_type === 'close' ? 'cierra' : 'abre';
    return (
        <div className="bui-mktstrip">
            <span className={`bui-mkt-dot ${s.open ? 'open' : 'closed'}`} aria-hidden="true" />
            <span className="bui-mkt-lab" style={{ color: s.open ? 'var(--pos)' : 'var(--text-2)' }}>
                {s.open ? 'Mercado abierto' : 'Mercado cerrado'}
            </span>
            {s.next_change ? (
                <>
                    <span className="bui-mkt-sep">·</span>
                    <span className="bui-mkt-when">
                        {verb} ~{fmt(s.next_change, 'America/Guayaquil')} <span className="tz">(Ecuador)</span>
                        {' · '}{fmt(s.next_change, 'UTC')} <span className="tz">UTC</span>
                    </span>
                    <span className="bui-mkt-aprox" title="El próximo cambio usa la aproximación semanal del forex (puede variar ~1h en horario de verano/feriados). El estado abierto/cerrado sí es dato real del bróker.">aprox.</span>
                </>
            ) : s.note ? (
                <><span className="bui-mkt-sep">·</span><span className="bui-mkt-when">{s.note}</span></>
            ) : null}
        </div>
    );
}
