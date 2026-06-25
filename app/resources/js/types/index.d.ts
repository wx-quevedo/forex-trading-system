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
    indicator_values?: Record<string, number | null>;
}

// --- Estrategias (Módulo 2) ---
export interface StrategyRisk {
    sl_pips?: number | null;
    tp_pips?: number | null;
    risk_percent?: number | null;
}

export interface StrategyParameters {
    type: string;
    indicators: Record<string, number | string>;
    risk: StrategyRisk;
}

export interface Strategy {
    id: number;
    name: string;
    description: string | null;
    pair: string;
    timeframe: string;
    parameters: StrategyParameters;
    version: number;
    parent_id: number | null;
    is_active: boolean;
    created_at: string;
    versions_count?: number;
}

export interface SchemaField {
    name: string;
    label: string;
    type: 'number' | 'select';
    default: number | string;
    min?: number;
    max?: number;
    step?: number;
    options?: { value: string; label: string }[];
}

export interface StrategySchema {
    label: string;
    description: string;
    fields: SchemaField[];
}

export type StrategySchemas = Record<string, StrategySchema>;

export interface EvaluateResult {
    signal: 'buy' | 'sell' | 'none';
    reason: string;
    indicators: Record<string, number | null>;
    price: number | null;
    time: number | null;
    type: string;
    symbol: string;
    timeframe: string;
    candles_evaluated: number;
}
