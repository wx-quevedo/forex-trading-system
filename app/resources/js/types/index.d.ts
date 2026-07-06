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
    sl_mode?: string;     // 'fixed' | 'atr' (Fase 1)
    atr_period?: number;
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
    gross_pnl?: number;
    total_costs?: number;
    gross_profit: number;
    gross_loss: number;
    return_pct: number;
    return_pct_gross?: number;
    final_balance: number;
    max_drawdown_abs: number;
    max_drawdown_pct: number;
    sharpe: number;
    sortino: number;
    calmar?: number | null;
    expectancy?: number; // monetaria: PnL medio por trade
    max_win_streak: number;
    max_loss_streak: number;
    avg_win: number;
    avg_loss: number;
    pnl_by_month: Record<string, number>;
    blown?: boolean;
    blown_at?: number | null;
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
    pnl_gross?: number;
    costs?: number;
    nights?: number;
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
    time?: number; // epoch (s) de apertura
    magic?: number;
    strategy_id?: number;
}

export interface BotSignal {
    seq: number;
    strategy_id?: number;
    evaluated_at: string;
    candle_time?: number | null;
    symbol: string;
    signal_type: 'buy' | 'sell' | 'none';
    executed: boolean;
    reason: string;
    indicator_values: Record<string, number | null>;
}

export interface BotClosedTrade {
    ticket: number;
    strategy_id?: number;
    magic?: number;
    symbol: string;
    direction: string | null;
    volume: number | null;
    open_price: number | null;
    close_price: number | null;
    sl?: number | null;
    tp?: number | null;
    pnl: number;
    close_reason?: string | null;
    exit_reason?: string;
    open_at?: string;
    close_at?: string;
    open_reason?: string | null;
    open_indicators?: Record<string, number | null> | null;
    signal_data?: { open_reason?: string | null; open_indicators?: Record<string, number | null> | null } | null;
}

export interface BotRunSummary {
    strategy_id: number;
    bot_run_id: number | null;
    status: 'stopped' | 'running' | 'paused' | 'error';
    error: string | null;
    stop_reason: string | null;
    started_at: string | null;
    magic: number;
    strategy: { type: string; params: Record<string, unknown>; symbol: string; timeframe: string };
    config: { lot: number; sl_pips: number; tp_pips: number; sl_mode?: string; atr_period?: number; risk_percent?: number; max_lot?: number; below_min?: string; daily_loss_limit: number; max_positions: number; news_filter?: boolean; news_window_min?: number; cb_max_losses?: number; cb_max_drawdown_pct?: number };
    realized_pnl_today: number;
    floating_pnl: number;
    daily_pnl: number;
    open_positions: number;
    loss_streak?: number;
}

export interface BotExposure {
    buy: number;
    sell: number;
    count: number;
}

export interface BotStatus {
    status: 'stopped' | 'running' | 'paused' | 'error';
    error?: string | null;
    day?: string;
    runs: BotRunSummary[];
    positions: BotPosition[];
    signals: BotSignal[];
    closed_trades: BotClosedTrade[];
    realized_pnl_today?: number;
    floating_pnl?: number;
    daily_pnl?: number;
    exposure?: Record<string, BotExposure>;
    journal?: BotEvent[];
    portfolio_heat_pct?: number;       // límite global configurado (Fase 7)
    portfolio_heat_used_pct?: number;  // riesgo agregado en uso ahora
    portfolio_risk_usd?: number;
}

export interface TelegramSettings {
    configured: boolean;
    enabled: boolean;
    events: Record<string, boolean>;
}

// --- Optimización automática (Fase 8A) ---
export interface OptimizationResult {
    params: Record<string, number | string>;
    in_return: number;
    out_return: number;
    in_trades: number;
    out_trades: number;
    total_trades: number;
    robustness: number;
    stars: number;
    verdict: 'inside' | 'edge' | 'outside';
    verdict_label: string;
    profit_factor_out: number | null;
    max_dd_out: number;
}

export interface Optimization {
    strategy_type: string;
    symbol: string;
    timeframe: string;
    min_trades: number;
    in_sample: { candles: number; from: number | null; to: number | null };
    out_sample: { candles: number; from: number | null; to: number | null };
    combinations: number;
    results: OptimizationResult[];
}

// --- Buscador de estrategias (Fase 8E) ---
export interface ExploreCacheStats {
    entries: number;
    size_bytes: number;
    size_mb: number;
    engine_version: number;
    path: string;
}

export interface ExploreMeta {
    grid_sizes: Record<string, number>;
    sl_choices: number[];
    tp_choices: number[];
    risk_choices: number[];
    sweep_timeframes: string[];
    max_configs: number;
    warn_configs: number;
    cpu_count: number;
    default_workers: number;
    engine_version: number;
    cache: ExploreCacheStats;
    atr_sl_choices: number[];
    atr_tp_choices: number[];
    atr_period_default: number;
    atr_period_choices?: number[];
    // --- Cripto (bridge 8001, Fase 2b-ii): presentes solo cuando market='crypto' ---
    market?: 'forex' | 'crypto';
    holdout_split_default?: number;
    holdout_top_default?: number;
    costs_defaults?: { taker_rate: number; maker_rate: number; fee_side: string; slippage_pct: number; apply_funding: boolean };
}

export interface SavedSearch {
    id: number;
    name: string;
    total: number;
    inside: number;
    created_at: string;
}

// Evidencia del pipeline de verificación CRIPTO (net → OOS → holdout → cross-pair):
// por qué se confió en el favorito y cuánto. Todos los campos opcionales — se guarda
// lo que el pipeline haya producido para esa candidata.
export interface FavoriteValidation {
    pipeline?: string;                 // p.ej. 'net+oos+holdout+crosspair'
    labels?: string[];                 // 'viaja-eth' | 'solo-btc' | 'funding-dependiente' | 'holdout-aguanta' | 'holdout-plano' | 'holdout-cayo'
    holdout?: { pf: number | null; return_pct?: number | null; trades?: number | null; from?: string; to?: string };
    no_funding_pf?: number | null;     // PF con funding=0 (fees+slippage puestos): edge sin subsidio
    cross?: Record<string, { pf: number | null; pf_no_funding?: number | null; verdict: string }>;
    trades_per_year?: number;
    costs_eaten_pct?: number | null;
    short_time_pct?: number | null;
    pf_gross?: number | null;
    pf_out?: number | null;
    source?: string;                   // 'explorador-cripto' | 'verificacion-2b-i' | ...
    validated_at?: string;
    notes?: string;
}

export interface Favorite {
    id: number;
    name: string;
    source: string;
    market?: 'forex' | 'crypto';       // default forex (columna con default: los viejos no cambian)
    pair: string;
    type: string;
    timeframe: string;
    params: Record<string, number | string>;
    sl_pips: number | null;
    tp_pips: number | null;
    risk_percent: number | null;
    capital: number;
    sl_mode?: string;
    atr_period?: number;
    backtest_from: string | null;
    backtest_to: string | null;
    backtest_metrics: BacktestMetrics | null;
    regime?: RegimeLabel | null;
    regime_confidence?: number | null;
    validation?: FavoriteValidation | null;  // evidencia del pipeline cripto
    created_at: string;
}

export interface CoverageCell {
    name: string;
    explored: number;
    total: number;
    pct: number;
    params?: Record<string, number | string>;
}

export interface CoverageMapData {
    path: string[];
    level: 'pairs' | 'types' | 'timeframes' | 'params';
    explorable: boolean;
    cells: CoverageCell[];
    explored: number;
    total: number;
    pct: number;
    context: { date_from: string; date_to: string; capital: number };
}

export interface SystemStats {
    cpu_count: number;
    logical_cores: number;
    physical_cores: number;
    system_cpu_percent: number;
    process_cpu_percent: number;
    process_cpu_percent_norm: number;
    ram_total_gb: number;
    ram_used_gb: number;
    ram_percent: number;
    process_ram_mb: number;
}

export interface ExploreResultRow {
    pair: string;
    type: string;
    timeframe: string;
    params: Record<string, number | string>;
    sl_pips: number;
    tp_pips: number;
    risk_percent: number;
    capital_final: number;
    costs: number;
    return_pct: number;
    net_pnl: number;
    win_rate: number; // fracción 0..1
    profit_factor: number | null;
    max_drawdown_pct: number;
    sharpe?: number | null;
    sortino?: number | null;
    calmar?: number | null;
    expectancy_r?: number | null;
    total_trades: number;
    blown: boolean;
    sl_mode?: string;
    regime?: RegimeLabel | null;
    regime_confidence?: number | null;
    atr_period?: number | null;
    priority?: number;  // el desglose (breakdown/verdict) se pide on-demand vía /explorer/score
    in_return: number;
    out_return: number;
    robustness: number;
    stars: number;
    verdict: 'inside' | 'edge' | 'outside';
    verdict_label: string;
    // --- Cripto (market='crypto'): métricas NETAS + tercer tramo holdout ---
    pf_gross?: number | null;         // PF BRUTO (profit_factor arriba es NETO en cripto)
    costs_eaten_pct?: number | null;  // % del PnL bruto comido por fees+funding+slippage
    pf_out?: number | null;           // PF NETO del tramo OOS (contraste con holdout)
    pf_out_gross?: number | null;
    short_time_pct?: number | null;   // % del tiempo-en-posición en corto (exposición a funding)
    trades_per_year?: number;         // frecuencia REAL (la clave de la hipótesis 2b)
    holdout_pf?: number | null;       // PF NETO en el tercer tramo intocado (solo top-N)
    holdout_return?: number | null;
    holdout_trades?: number | null;
    final_verdict?: 'inside' | 'edge' | 'outside';  // veredicto OOS ponderado por holdout
    final_verdict_label?: string;
}

// --- Score de Prioridad (mejoras post-fase) ---
export interface ScoreFactor { label: string; points: number; detail: string }
export interface ScoreBreakdown { add: ScoreFactor[]; sub: ScoreFactor[] }

// --- Régimen de mercado (Fase 3) ---
export type RegimeLabel = 'TENDENCIA_ALCISTA' | 'TENDENCIA_BAJISTA' | 'RANGO' | 'VOLATIL';

export interface RegimeInfo {
    regime: RegimeLabel | null;
    confidence: number;
    adx: number | null;
    efficiency_ratio: number | null;
    directionality?: number | null;
    net_change_pct?: number;
    atr_pct: number | null;
    vol_ratio?: number | null;
    ma200_side: 'above' | 'below' | null;
    ma_period?: number | null;
    candles?: number;
}

export interface ExploreStatus {
    status: 'idle' | 'running' | 'done' | 'cancelled' | 'error';
    total: number;
    done: number;
    results_count: number;
    inside_count: number;
    skipped?: { pair: string; timeframe: string; candles: number; reason: string }[];
    current: string | null;
    error: string | null;
    started_at: string | null;
    finished_at: string | null;
    request: Record<string, unknown> | null;
    // Velocidad / monitoreo.
    workers: number;
    elapsed_seconds: number;
    speed_per_sec: number;
    speed_per_min: number;
    eta_seconds: number | null;
    // Diagnóstico.
    t_mt5_seconds: number;
    t_compute_seconds: number;
    candle_fetches: number;
    // Caché.
    cache_hits: number;
    cache_misses: number;
    // Cripto: tercer tramo holdout del barrido (null en forex).
    holdout?: { split: number; top: number; from: string; to: string; tested: number } | null;
    results?: ExploreResultRow[];
}

// --- Journal del bot (Fase 8D) ---
export interface BotEvent {
    id: number;
    bot_run_id?: number | null;
    strategy_id?: number;
    type: string;
    severity: 'info' | 'warning' | 'error';
    message: string;
    occurred_at: string;
}
