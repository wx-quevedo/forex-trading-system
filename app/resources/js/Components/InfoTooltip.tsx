import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Icono "i" con tooltip explicativo (hover y focus/touch). Sin emojis.
 * El tooltip se renderiza en un PORTAL a document.body para que NO lo recorte
 * el overflow del sidebar (aparece por encima de todo).
 */
export default function InfoTooltip({ text }: { text: string }) {
    const ref = useRef<HTMLSpanElement>(null);
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

    const open = () => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        const left = Math.min(Math.max(r.left + r.width / 2, 130), window.innerWidth - 130);
        setPos({ top: r.top, left });
    };
    const close = () => setPos(null);

    if (!text) return null;
    return (
        <span
            ref={ref}
            className="inline-flex align-middle"
            tabIndex={0}
            role="img"
            aria-label={text}
            onMouseEnter={open}
            onMouseLeave={close}
            onFocus={open}
            onBlur={close}
        >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 cursor-help text-text-secondary hover:text-text-primary" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="11" x2="12" y2="16" />
                <circle cx="12" cy="7.5" r="0.6" fill="currentColor" stroke="none" />
            </svg>
            {pos &&
                createPortal(
                    <span
                        className="pointer-events-none fixed z-[100] w-60 max-w-[16rem] -translate-x-1/2 -translate-y-full rounded-md border border-border bg-bg-elevated px-2.5 py-1.5 text-[11px] font-normal normal-case leading-snug text-text-primary shadow-xl"
                        style={{ top: pos.top - 6, left: pos.left }}
                    >
                        {text}
                    </span>,
                    document.body,
                )}
        </span>
    );
}
