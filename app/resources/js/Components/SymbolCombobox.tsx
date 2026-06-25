import { useEffect, useRef, useState } from 'react';

interface Props {
    value: string;
    onChange: (symbol: string) => void;
    symbols: string[];
    placeholder?: string;
}

/**
 * Combobox buscable de símbolos del broker. Al enfocar muestra la lista completa
 * (operables); al teclear filtra; clic elige; Enter acepta un valor personalizado.
 * Reemplaza al <datalist> (poco visible/inconsistente entre navegadores).
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

    const q = query.trim().toUpperCase();
    const filtered = (q ? symbols.filter((s) => s.toUpperCase().includes(q)) : symbols).slice(0, 200);

    const pick = (s: string) => {
        onChange(s.toUpperCase());
        setQuery('');
        setOpen(false);
    };

    return (
        <div ref={ref} className="relative">
            <input
                type="text"
                className="input font-mono"
                value={open ? query : value}
                placeholder={placeholder ?? 'Buscar símbolo…'}
                onFocus={() => {
                    setQuery('');
                    setOpen(true);
                }}
                onChange={(e) => {
                    setQuery(e.target.value);
                    setOpen(true);
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        if (filtered.length > 0) pick(filtered[0]);
                        else if (q) pick(q);
                    } else if (e.key === 'Escape') {
                        setOpen(false);
                    }
                }}
            />
            {open && (
                <ul className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-bg-elevated shadow-lg">
                    {filtered.length === 0 ? (
                        <li className="px-3 py-2 text-xs text-text-secondary">
                            {symbols.length === 0 ? 'Lista no disponible (¿bridge apagado?). Escribe el símbolo y pulsa Enter.' : 'Sin coincidencias — Enter para usar lo escrito.'}
                        </li>
                    ) : (
                        filtered.map((s) => (
                            <li key={s}>
                                <button
                                    type="button"
                                    onClick={() => pick(s)}
                                    className={`block w-full px-3 py-1.5 text-left font-mono text-sm hover:bg-bg-surface ${s === value ? 'text-accent' : 'text-text-primary'}`}
                                >
                                    {s}
                                </button>
                            </li>
                        ))
                    )}
                </ul>
            )}
        </div>
    );
}
