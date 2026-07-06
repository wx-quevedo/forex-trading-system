<?php

namespace Database\Seeders;

use App\Models\Favorite;
use Illuminate\Database\Seeder;

/**
 * Pobladoras de Favoritos CRIPTO (Fase 2b-iv) — las candidatas que sobrevivieron el
 * pipeline de verificación (net → OOS → holdout intocado → cross-pair ETHUSDT), con su
 * EVIDENCIA congelada. Números de: cbot docs/FASE2B_VERIFICACION_HOLDOUT.md (holdout
 * virgen 2025-07→2026-07, params congelados) + docs/FASE2B_CROSSPAIR_ETH.md (cross-pair
 * congelado) + E2E del Explorador (holdout 2025-10-31→2026-07-05). Métricas de
 * referencia: BTCUSDT H4 2022-01-01→2026-07-05, NETAS (taker 0.055%/lado + funding real
 * + slippage 0.02%/lado), corridas por el bridge cripto :8001 el 2026-07-05.
 *
 * Idempotente: firstOrCreate por nombre (re-ejecutar no duplica).
 * Ejecutar: php artisan db:seed --class=CryptoFavoritesSeeder
 */
class CryptoFavoritesSeeder extends Seeder
{
    public function run(): void
    {
        $common = [
            'source' => 'pipeline', 'market' => 'crypto', 'pair' => 'BTCUSDT',
            'timeframe' => 'H4', 'capital' => 10000.0,
            'backtest_from' => '2022-01-01', 'backtest_to' => '2026-07-05',
        ];

        $seeds = [
            // ── Las que VIAJAN (únicas validadas cross-pair) ──────────────────────
            [
                'name' => 'Ichimoku 12/52/104 — BTC H4 (sin SL)',
                'type' => 'ichimoku', 'params' => ['tenkan' => 12, 'kijun' => 52, 'senkou_b' => 104],
                'sl_mode' => 'fixed', 'sl_pips' => null, 'tp_pips' => null, 'risk_percent' => null,
                'backtest_metrics' => ['return_pct' => 4.38, 'net_pnl' => 438.04, 'win_rate' => 0.3273, 'profit_factor' => 1.329, 'max_drawdown_pct' => -5.23, 'total_trades' => 55, 'total_costs' => 117.23, 'final_balance' => 10438.04, 'sharpe' => 0.333, 'sortino' => 0.43, 'calmar' => 0.186],
                'validation' => [
                    'pipeline' => 'net+oos+holdout+crosspair',
                    'labels' => ['holdout-aguanta', 'viaja-eth', 'viaja-sol'],
                    'holdout' => ['pf' => 1.492, 'return_pct' => 1.70, 'trades' => 10, 'from' => '2025-07-01', 'to' => '2026-07-05'],
                    'no_funding_pf' => 1.470,
                    'cross' => [
                        'ETHUSDT' => ['pf' => 1.150, 'pf_no_funding' => 1.148, 'verdict' => 'viaja'],
                        'SOLUSDT' => ['pf' => 1.903, 'pf_no_funding' => 2.011, 'verdict' => 'viaja'],
                    ],
                    'trades_per_year' => 12.2, 'costs_eaten_pct' => 21.1,
                    'source' => 'verificacion-2b-i + crosspair-2b-iii + crosspair-2b-vi', 'validated_at' => '2026-07-05',
                    'notes' => 'Única familia que sobrevivió TODA la cadena. ESTRUCTURA FIRME (3 pares): en SOL PF 1.903 pagando funding EN CONTRA (rate medio negativo).',
                ],
            ],
            [
                'name' => 'Ichimoku 12/52/104 — BTC H4 (ATR 3/3)',
                'type' => 'ichimoku', 'params' => ['tenkan' => 12, 'kijun' => 52, 'senkou_b' => 104],
                'sl_mode' => 'atr', 'sl_pips' => 3.0, 'tp_pips' => 3.0, 'risk_percent' => 1.0,
                'backtest_metrics' => ['return_pct' => 24.65, 'net_pnl' => 2464.86, 'win_rate' => 0.6117, 'profit_factor' => 1.593, 'max_drawdown_pct' => -4.49, 'total_trades' => 103, 'total_costs' => 435.4, 'final_balance' => 12464.86, 'sharpe' => 1.054, 'sortino' => 0.82, 'calmar' => 1.217],
                'validation' => [
                    'pipeline' => 'net+oos+holdout+crosspair',
                    'labels' => ['holdout-aguanta', 'viaja-eth', 'viaja-sol'],
                    'holdout' => ['pf' => 1.670, 'return_pct' => 3.49, 'trades' => 14, 'from' => '2025-10-31', 'to' => '2026-07-05'],
                    'cross' => [
                        'ETHUSDT' => ['pf' => 1.096, 'pf_no_funding' => 1.091, 'verdict' => 'viaja'],
                        'SOLUSDT' => ['pf' => 1.435, 'pf_no_funding' => 1.450, 'verdict' => 'viaja'],
                    ],
                    'trades_per_year' => 23.2, 'costs_eaten_pct' => 16.6, 'short_time_pct' => 48.8,
                    'source' => 'explorador-e2e + crosspair-2b-iii + crosspair-2b-vi', 'validated_at' => '2026-07-05',
                    'notes' => 'La #1 del E2E del Explorador (robustez 0.75+). Estructura firme (3 pares). Con sizing por riesgo 1% el retorno de referencia sube a +24.65%.',
                ],
            ],
            [
                'name' => 'Ichimoku 12/52/104 — BTC H4 (ATR 3/4)',
                'type' => 'ichimoku', 'params' => ['tenkan' => 12, 'kijun' => 52, 'senkou_b' => 104],
                'sl_mode' => 'atr', 'sl_pips' => 3.0, 'tp_pips' => 4.0, 'risk_percent' => 1.0,
                'backtest_metrics' => ['return_pct' => 25.74, 'net_pnl' => 2574.21, 'win_rate' => 0.5258, 'profit_factor' => 1.572, 'max_drawdown_pct' => -5.55, 'total_trades' => 97, 'total_costs' => 461.09, 'final_balance' => 12574.21, 'sharpe' => 0.951, 'sortino' => 0.821, 'calmar' => 1.029],
                'validation' => [
                    'pipeline' => 'net+oos+holdout+crosspair',
                    'labels' => ['holdout-aguanta', 'viaja-eth', 'viaja-sol'],
                    'holdout' => ['pf' => 1.414, 'return_pct' => 2.24, 'trades' => 12, 'from' => '2025-10-31', 'to' => '2026-07-05'],
                    'cross' => [
                        'ETHUSDT' => ['pf' => 1.168, 'pf_no_funding' => 1.164, 'verdict' => 'viaja'],
                        'SOLUSDT' => ['pf' => 1.401, 'pf_no_funding' => 1.423, 'verdict' => 'viaja'],
                    ],
                    'trades_per_year' => 22.2, 'costs_eaten_pct' => 16.3, 'short_time_pct' => 49.4,
                    'source' => 'explorador-e2e + crosspair-2b-iii + crosspair-2b-vi', 'validated_at' => '2026-07-05',
                    'notes' => 'La variante que mejor viajó a ETH (PF 1.168 congelada). Estructura firme (3 pares).',
                ],
            ],
            // ── Las RSI de BTC (holdout OK, pero NO viajaron: par-específicas) ────
            [
                'name' => 'RSI 14/30/75 — BTC H4 (sin SL) [solo BTC]',
                'type' => 'rsi', 'params' => ['period' => 14, 'oversold' => 30, 'overbought' => 75],
                'sl_mode' => 'fixed', 'sl_pips' => null, 'tp_pips' => null, 'risk_percent' => null,
                'backtest_metrics' => ['return_pct' => 4.51, 'net_pnl' => 450.71, 'win_rate' => 0.7324, 'profit_factor' => 1.294, 'max_drawdown_pct' => -4.92, 'total_trades' => 71, 'total_costs' => 42.43, 'final_balance' => 10450.71, 'sharpe' => 0.343, 'sortino' => 0.427, 'calmar' => 0.203],
                'validation' => [
                    'pipeline' => 'net+oos+holdout+crosspair',
                    'labels' => ['holdout-aguanta', 'solo-btc'],
                    'holdout' => ['pf' => 1.287, 'return_pct' => 1.04, 'trades' => 12, 'from' => '2025-07-01', 'to' => '2026-07-05'],
                    'no_funding_pf' => 1.322,
                    'cross' => ['ETHUSDT' => ['pf' => 0.729, 'pf_no_funding' => 0.717, 'verdict' => 'no-viaja']],
                    'trades_per_year' => 15.8, 'costs_eaten_pct' => 8.6,
                    'source' => 'verificacion-2b-i + crosspair-2b-iii', 'validated_at' => '2026-07-05',
                    'notes' => 'Gana incluso PAGANDO funding en BTC (1.322 sin él), pero el edge NO viajó a ETH (0.729): operar solo en BTC.',
                ],
            ],
            [
                'name' => 'RSI 14/25/75 — BTC H4 (sin SL) [solo BTC]',
                'type' => 'rsi', 'params' => ['period' => 14, 'oversold' => 25, 'overbought' => 75],
                'sl_mode' => 'fixed', 'sl_pips' => null, 'tp_pips' => null, 'risk_percent' => null,
                'backtest_metrics' => ['return_pct' => 4.12, 'net_pnl' => 411.7, 'win_rate' => 0.7059, 'profit_factor' => 1.306, 'max_drawdown_pct' => -4.41, 'total_trades' => 51, 'total_costs' => -52.79, 'final_balance' => 10411.7, 'sharpe' => 0.319, 'sortino' => 0.402, 'calmar' => 0.207],
                'validation' => [
                    'pipeline' => 'net+oos+holdout+crosspair',
                    'labels' => ['holdout-aguanta', 'solo-btc', 'funding-dependiente'],
                    'holdout' => ['pf' => 1.127, 'return_pct' => 0.45, 'trades' => 10, 'from' => '2025-07-01', 'to' => '2026-07-05'],
                    'no_funding_pf' => 1.094,
                    'cross' => ['ETHUSDT' => ['pf' => 0.602, 'pf_no_funding' => 0.578, 'verdict' => 'no-viaja']],
                    'trades_per_year' => 11.3, 'costs_eaten_pct' => -14.7,
                    'source' => 'verificacion-2b-i + crosspair-2b-iii', 'validated_at' => '2026-07-05',
                    'notes' => 'Margen fino: sin funding queda 1.094 y sus costos totales son NEGATIVOS (cobró más funding del que pagó en fees) — parte del brillo es subsidio de régimen. La peor cross-pair (0.602 en ETH).',
                ],
            ],
            [
                'name' => 'RSI 21/30/70 — BTC H4 (ATR 3/4) [solo BTC]',
                'type' => 'rsi', 'params' => ['period' => 21, 'oversold' => 30, 'overbought' => 70],
                'sl_mode' => 'atr', 'sl_pips' => 3.0, 'tp_pips' => 4.0, 'risk_percent' => 1.0,
                'backtest_metrics' => ['return_pct' => 8.51, 'net_pnl' => 851.43, 'win_rate' => 0.4857, 'profit_factor' => 1.146, 'max_drawdown_pct' => -8.38, 'total_trades' => 105, 'total_costs' => 203.96, 'final_balance' => 10851.43, 'sharpe' => 0.348, 'sortino' => 0.321, 'calmar' => 0.225],
                'validation' => [
                    'pipeline' => 'net+oos+holdout+crosspair',
                    'labels' => ['holdout-aguanta', 'solo-btc'],
                    'holdout' => ['pf' => 1.226, 'return_pct' => 1.46, 'trades' => 12, 'from' => '2025-10-31', 'to' => '2026-07-05'],
                    'cross' => ['ETHUSDT' => ['pf' => 0.906, 'pf_no_funding' => 0.897, 'verdict' => 'no-viaja']],
                    'trades_per_year' => 24.0, 'costs_eaten_pct' => 15.7, 'short_time_pct' => 54.5,
                    'source' => 'explorador-e2e + crosspair-2b-iii', 'validated_at' => '2026-07-05',
                    'notes' => 'Inside del E2E; en ETH se quedó a las puertas (0.906). Par-específica.',
                ],
            ],
        ];

        foreach ($seeds as $seed) {
            Favorite::firstOrCreate(['name' => $seed['name']], [...$common, ...$seed, 'atr_period' => 14]);
        }
    }
}
