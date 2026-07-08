<?php

namespace Tests\Feature;

use App\Models\Favorite;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Bot Histórico CRIPTO (Fase 2b-vii): routing por mercado de la simulación de seguimiento.
 *
 * Garantías: la página cripto carga SOLO favoritos market='crypto' con la MISMA página
 * React; el forex sigue idéntico (solo forex, sin prop market); el efímero y la
 * correlación cripto van al bridge 8001 (cuyo /backtest/run devuelve métricas NETAS en
 * top-level — el espejismo del bruto no puede entrar por esta tubería).
 */
class CryptoBotHistoricoTest extends TestCase
{
    use RefreshDatabase;

    private function seedFavs(): void
    {
        Favorite::create(['name' => 'fx', 'market' => 'forex', 'pair' => 'EURUSD#', 'type' => 'rsi',
            'timeframe' => 'H1', 'params' => ['period' => 14], 'capital' => 10000]);
        Favorite::create(['name' => 'cr', 'market' => 'crypto', 'pair' => 'BTCUSDT', 'type' => 'ichimoku',
            'timeframe' => 'H4', 'params' => ['tenkan' => 12, 'kijun' => 52, 'senkou_b' => 104], 'capital' => 10000,
            'validation' => ['holdout' => ['pf' => 1.492, 'return_pct' => 1.7, 'from' => '2025-07-01', 'to' => '2026-07-05']]]);
    }

    public function test_pagina_cripto_carga_solo_favoritos_cripto(): void
    {
        $this->seedFavs();

        $this->actingAs(User::factory()->create())->get('/crypto/bot-historico')
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('BotHistorico')
                ->where('market', 'crypto')
                ->has('favorites', 1)
                ->where('favorites.0.name', 'cr')
                ->where('favorites.0.market', 'crypto')
                ->has('favorites.0.validation.holdout'));
    }

    public function test_pagina_forex_sigue_identica_solo_forex_sin_market(): void
    {
        $this->seedFavs();

        $this->actingAs(User::factory()->create())->get('/bot-historico')
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('BotHistorico')
                ->missing('market')
                ->has('favorites', 1)
                ->where('favorites.0.name', 'fx'));
    }

    public function test_efimero_cripto_va_al_bridge_8001_y_devuelve_el_neto(): void
    {
        // El bridge cripto responde con el NETO en top-level (+ gross aparte): el
        // controlador debe extraer metrics/trades/equity_curve = el neto, y la petición
        // debe ir a 127.0.0.1:8001 (jamás al bridge MT5 :8000).
        Http::fake([
            '127.0.0.1:8001/*' => Http::response([
                'metrics' => ['profit_factor' => 1.492, 'return_pct' => 1.7, 'net_pnl' => 170.0, 'total_trades' => 10, 'win_rate' => 0.4, 'max_drawdown_pct' => -3.2, 'final_balance' => 10170.0, 'blown' => false, 'sharpe' => 0.4, 'sortino' => 0.5, 'calmar' => 0.3, 'total_costs' => 42.0],
                'trades' => [],
                'equity_curve' => [['time' => 1750000000, 'equity' => 10170.0]],
                'costs' => ['fees' => 30.25, 'funding' => -5.25, 'slippage' => 17.0, 'total' => 42.0],
                'gross' => ['metrics' => ['profit_factor' => 1.6]],
            ]),
        ]);

        $this->actingAs(User::factory()->create())
            ->postJson('/crypto/bot-historico/ephemeral', [
                'strategy_type' => 'ichimoku', 'pair' => 'BTCUSDT', 'timeframe' => 'H4',
                'date_from' => '2026-01-01', 'date_to' => '2026-07-05',
                'indicators' => ['tenkan' => 12, 'kijun' => 52, 'senkou_b' => 104],
                'risk' => ['sl_pips' => null, 'tp_pips' => null, 'sl_mode' => 'fixed'],
                'initial_balance' => 10000,
            ])
            ->assertOk()
            ->assertJsonPath('metrics.profit_factor', 1.492)   // el NETO del top-level, no el gross
            ->assertJsonPath('costs.funding', -5.25);

        Http::assertSent(fn ($req) => str_contains($req->url(), '127.0.0.1:8001/backtest/run'));
    }

    public function test_correlacion_cripto_va_al_8001_con_envoltura_data(): void
    {
        Http::fake([
            '127.0.0.1:8001/*' => Http::response(['labels' => ['a', 'b'], 'matrix' => [[1.0, 0.5], [0.5, 1.0]]]),
        ]);

        $this->actingAs(User::factory()->create())
            ->postJson('/crypto/bot-historico/correlation', ['labels' => ['a', 'b'], 'series' => [[0.1, -0.1], [0.05, 0.0]]])
            ->assertOk()
            ->assertJsonPath('data.matrix.0.1', 0.5);   // misma envoltura {data} que el proxy forex

        Http::assertSent(fn ($req) => str_contains($req->url(), '127.0.0.1:8001/portfolio/correlation'));
    }
}
