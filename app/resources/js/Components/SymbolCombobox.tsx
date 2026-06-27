import { useEffect, useMemo, useRef, useState } from 'react';

interface Props {
    value: string;
    onChange: (symbol: string) => void;
    symbols: string[];
    placeholder?: string;
}

// Lista curada de los más usados (se muestran solo los que el broker realmente ofrece).
const COMMON = [
    'EURUSD#', 'GBPUSD#', 'USDJPY#', 'USDCHF#', 'USDCAD#', 'AUDUSD#', 'NZDUSD#',
    'GOLD#', 'XAUEUR#', 'BTCUSD#', 'ETHUSD#', 'US500Cash#', 'US100Cash#', 'US30Cash#',
];

/**
 * Combobox buscable de símbolos en DOS grupos: "Más usados" (curado) y
 * "Todos (A-Z)". La búsqueda filtra ambos. Enter acepta un valor personalizado.
 */
export default function SymbolCombobox({ value, onChange, symbols, placeholder }: Props) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, []);

    const { common, rest } = useMemo(() => {
        const set = new Set(symbols.map((s) => s.toUpperCase()));
        const common = COMMON.filter((c) => set.has(c.toUpperCase()));
        const commonSet = new Set(common.map((c) => c.toUpperCase()));
        const rest = [...symbols].filter((s) => !commonSet.has(s.toUpperCase())).sort((a, b) => a.localeCompare(b));
        return { common, rest };
    }, [symbols]);

    const q = query.trim().toUpperCase();
    const match = (s: string) => s.toUpperCase().includes(q);
    const fCommon = (q ? common.filter(match) : common);
    const fRest = (q ? rest.filter(match) : rest).slice(0, 200);

    const pick = (s: string) => {
        onChange(s.toUpperCase());
        setQuery('');
        setOpen(false);
    };

    const Option = ({ s }: { s: string }) => (
        <li>
            <button type="button" onClick={() => pick(s)} className={`block w-full px-3 py-1.5 text-left font-mono text-sm hover:bg-bg-surface ${s === value ? 'text-accent' : 'text-text-primary'}`}>
                {s}
            </button>
        </li>
    );

    return (
        <div ref={ref} className="relative">
            <input
                type="text"
                className="input font-mono"
                value={open ? query : value}
                placeholder={placeholder ?? 'Buscar símbolo…'}
                onFocus={() => { setQuery(''); setOpen(true); }}
                onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        const first = fCommon[0] ?? fRest[0];
                        if (first) pick(first);
                        else if (q) pick(q);
                    } else if (e.key === 'Escape') {
                        setOpen(false);
                    }
                }}
            />
            {open && (
                <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-bg-elevated shadow-lg">
                    {fCommon.length === 0 && fRest.length === 0 ? (
                        <li className="px-3 py-2 text-xs text-text-secondary">
                            {symbols.length === 0 ? 'Lista no disponible (¿bridge apagado?). Escribe el símbolo y Enter.' : 'Sin coincidencias — Enter para usar lo escrito.'}
                        </li>
                    ) : (
                        <>
                            {fCommon.length > 0 && (
                                <>
                                    <li className="bg-bg-surface px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Más usados</li>
                                    {fCommon.map((s) => <Option key={`c-${s}`} s={s} />)}
                                </>
                            )}
                            {fRest.length > 0 && (
                                <>
                                    <li className="bg-bg-surface px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Todos (A-Z)</li>
                                    {fRest.map((s) => <Option key={`r-${s}`} s={s} />)}
                                </>
                            )}
                        </>
                    )}
                </ul>
            )}
        </div>
    );
}
