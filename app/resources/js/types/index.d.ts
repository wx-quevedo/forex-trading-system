import type Echo from 'laravel-echo';
import type Pusher from 'pusher-js';

declare global {
    interface Window {
        Echo: Echo<'reverb'>;
        Pusher: typeof Pusher;
        axios: typeof import('axios').default;
    }
}

export interface User {
    id: number;
    name: string;
    email: string;
}

export interface SharedProps {
    app: { name: string };
    auth: { user: User | null };
    flash: { success: string | null; error: string | null };
    [key: string]: unknown;
}

// --- Dominio MT5 (forma de los datos del bridge) ---
export interface AccountInfo {
    login: number;
    balance: number;
    equity: number;
    margin: number;
    margin_free: number;
    margin_level: number;
    profit: number;
    currency: string;
    leverage: number;
    server: string;
    name: string;
    trade_allowed: boolean;
}

export interface Position {
    ticket: number;
    symbol: string;
    type: number; // 0 = buy, 1 = sell
    volume: number;
    price_open: number;
    price_current: number;
    sl: number;
    tp: number;
    profit: number;
    swap: number;
    time: number;
}

export interface Candle {
    time: number;
    datetime: string;
    open: number;
    high: number;
    low: number;
    close: number;
    tick_volume: number;
}

export interface Tick {
    symbol: string;
    bid: number;
    ask: number;
    last: number;
    time: number;
}

export interface SignalLogEntry {
    id: number;
    evaluated_at: string;
    symbol: string;
    signal_type: 'buy' | 'sell' | 'none';
    executed: boolean;
    reason: string | null;
}
