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

// --- Backtesting (Módulo 3) ---
export interface BacktestMetrics {
    total_trades: number;
    wins: number;
    losses: number;
    win_rate: number;
    profit_factor: number | null;
    net_pnl: number;
    gross_profit: number;
    gross_loss: number;
    return_pct: number;
    final_balance: number;
    max_drawdown_abs: number;
    max_drawdown_pct: number;
    sharpe: number;
    sortino: number;
    max_win_streak: number;
    max_loss_streak: number;
    avg_win: number;
    avg_loss: number;
    pnl_by_month: Record<string, number>;
}

export interface BacktestTrade {
    entry_time: number;
    exit_time: number;
    direction: 'buy' | 'sell';
    entry_price: number;
    exit_price: number;
    volume: number;
    sl: number | null;
    tp: number | null;
    pnl: number;
    exit_reason: 'sl' | 'tp' | 'signal' | 'end';
    balance: number;
}

export interface EquityPoint {
    time: number;
    equity: number;
}

export interface Backtest {
    id: number;
    strategy_id: number;
    date_from: string;
    date_to: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    result_metrics: BacktestMetrics | null;
    result_trades: BacktestTrade[] | null;
    result_equity_curve: EquityPoint[] | null;
    error: string | null;
    created_at: string;
    strategy?: Strategy;
}

// --- Análisis IA (Módulo 4 / Fase 6 + 6B) ---
export interface AiAnalysis {
    id: number;
    backtest_id: number;
    prompt: string;
    response: string | null;
    model: string | null;
    mode: 'api' | 'manual';
    input_tokens: number | null;
    output_tokens: number | null;
    estimated_cost_usd: string | number | null;
    suggested_parameters: Record<string, number | string> | null;
    applied: boolean;
    resulting_strategy_id: number | null;
    created_at: string;
}

export interface DiffRow {
    key: string;
    group: 'indicadores' | 'riesgo';
    old: number | string | null;
    new: number | string | null;
    changed: boolean;
}

// --- Workbench (Fase 6C) ---
export interface WorkbenchRun {
    metrics: BacktestMetrics | null;
    trades: BacktestTrade[];
    equity: EquityPoint[];
}

// --- Bot en vivo (Fase 7) ---
export interface BotPosition {
    ticket: number;
    symbol: string;
    type: number; // 0 = buy, 1 = sell
    volume: number;
    price_open: number;
    price_current: number;
    sl: number;
    tp: number;
    profit: number;
}

export interface BotSignal {
    seq: number;
    evaluated_at: string;
    symbol: string;
    signal_type: 'buy' | 'sell' | 'none';
    executed: boolean;
    reason: string;
    indicator_values: Record<string, number | null>;
}

export interface BotClosedTrade {
    ticket: number;
    symbol: string;
    direction: string | null;
    volume: number | null;
    open_price: number | null;
    close_price: number | null;
    pnl: number;
    exit_reason?: string;
    close_at?: string;
}

export interface BotStatus {
    status: 'stopped' | 'running' | 'paused' | 'error';
    error: string | null;
    stop_reason: string | null;
    bot_run_id: number | null;
    strategy?: { type: string; params: Record<string, unknown>; symbol: string; timeframe: string };
    config?: { lot: number; sl_pips: number; tp_pips: number; daily_loss_limit: number; max_positions: number };
    day?: string;
    started_at?: string | null;
    realized_pnl_today?: number;
    floating_pnl?: number;
    daily_pnl?: number;
    positions: BotPosition[];
    open_positions?: number;
    signals: BotSignal[];
    closed_trades: BotClosedTrade[];
}

export interface TelegramSettings {
    configured: boolean;
    enabled: boolean;
    events: Record<string, boolean>;
}
