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

export function pnlColor(value: number): string {
    if (value > 0) return 'text-profit';
    if (value < 0) return 'text-loss';
    return 'text-text-secondary';
}
