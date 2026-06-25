/** Helpers de formato para la UI (números, moneda, fechas). */

export function fmtMoney(value: number | null | undefined, currency = 'USD'): string {
    if (value === null || value === undefined) return '—';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value);
}

export function fmtNumber(value: number | null | undefined, digits = 2): string {
    if (value === null || value === undefined) return '—';
    return value.toLocaleString('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
}

/** Precio con el dígito de pip resaltado (4º/5º decimal). */
export function fmtPrice(value: number | null | undefined, digits = 5): string {
    if (value === null || value === undefined) return '—';
    return value.toFixed(digits);
}

export function fmtTime(unixSeconds: number): string {
    return new Date(unixSeconds * 1000).toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/** Hora local con milisegundos a partir de un ISO del bridge (HH:MM:SS.mmm). */
export function fmtTimeMs(iso: string | number | Date): string {
    const d = iso instanceof Date ? iso : new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${d.toLocaleTimeString('en-GB')}.${ms}`;
}

/** Fecha y hora local con milisegundos (YYYY-MM-DD HH:MM:SS.mmm). */
export function fmtDateTimeMs(iso: string | number | Date): string {
    const d = iso instanceof Date ? iso : new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    return (
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
        `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
    );
}

export function pnlColor(value: number): string {
    if (value > 0) return 'text-profit';
    if (value < 0) return 'text-loss';
    return 'text-text-secondary';
}
