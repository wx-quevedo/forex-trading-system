<?php

namespace Tests\Feature;

use App\Models\Favorite;
use App\Models\Strategy;
use App\Models\User;
use App\Services\PythonBridgeService;
use App\Services\TelegramNotifier;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery\MockInterface;
use Tests\TestCase;

/**
 * Fidelidad ATR del bot en vivo (Fase 1). El ejecutor debe recibir sl_mode/atr_period/
 * risk_percent (antes se perdían → operaba pips/lote fijo, distinto del backtest). Y el
 * preview /bot/preview proxya al bridge sin operar.
 */
class BotAtrFidelityTest extends TestCase
{
    use RefreshDatabase;

    public function test_start_reenvia_sl_mode_atr_period_risk_percent_al_bridge(): void
    {
        $strategy = Strategy::create([
            'name' => 'oro donchian', 'pair' => 'XAUUSD#', 'timeframe' => 'H1',
            'parameters' => [
                'type' => 'donchian',
                'indicators' => ['period' => 20],
                'risk' => ['sl_pips' => 2.0, 'tp_pips' => 3.0, 'risk_percent' => 1.5, 'sl_mode' => 'atr', 'atr_period' => 7],
            ],
            'version' => 1, 'is_active' => false,
        ]);

        $this->mock(TelegramNotifier::class, fn (MockInterface $m) => $m->shouldReceive('notify'));
        $this->mock(PythonBridgeService::class, function (MockInterface $m) {
            $m->shouldReceive('botStart')->once()
                ->withArgs(fn (array $p) => $p['sl_mode'] === 'atr' && $p['atr_period'] === 7 && $p['risk_percent'] === 1.5
                    && array_key_exists('max_lot', $p) && $p['below_min'] === 'skip' && array_key_exists('arm_expiry_hours', $p))
                ->andReturn(['status' => 'running']);
        });

        $this->actingAs(User::factory()->create())
            ->postJson('/bot/start', ['strategy_id' => $strategy->id, 'lot' => 0.01, 'daily_loss_limit' => 100, 'max_positions' => 1])
            ->assertOk();
    }

    public function test_preview_proxya_el_bridge_sin_operar(): void
    {
        $this->mock(PythonBridgeService::class, function (MockInterface $m) {
            $m->shouldReceive('botPreview')->once()->andReturn([
                'previews' => [['strategy_id' => 1, 'symbol' => 'XAUUSD#', 'ok' => true, 'risk_lot' => 0.5,
                    'sl_dist_pips' => 30.0, 'sl_ok' => true, 'backtest_match' => ['available' => true, 'match' => true]]],
            ]);
            $m->shouldReceive('botStart')->never();  // preview NO opera
        });

        $this->actingAs(User::factory()->create())
            ->getJson('/bot/preview')
            ->assertOk()
            ->assertJsonPath('previews.0.risk_lot', 0.5)
            ->assertJsonPath('previews.0.backtest_match.match', true);
    }

    public function test_load_favorites_usa_limite_diario_y_tope_por_candidata(): void
    {
        $fav = Favorite::create([
            'name' => 'oro macd', 'source' => 'explorer', 'pair' => 'GOLD#', 'type' => 'macd',
            'timeframe' => 'H4', 'params' => ['fast' => 16, 'slow' => 26, 'signal' => 9],
            'sl_pips' => 1.5, 'tp_pips' => 4.0, 'risk_percent' => 1.0, 'capital' => 10000,
            'sl_mode' => 'atr', 'atr_period' => 21,
        ]);

        $this->mock(TelegramNotifier::class, fn (MockInterface $m) => $m->shouldReceive('notify'));
        $this->mock(PythonBridgeService::class, function (MockInterface $m) {
            // El limite diario y el tope de lote deben venir de la CANDIDATA (360/0.2),
            // no del global (999/9), calibrados con su riesgo/op.
            $m->shouldReceive('botStart')->once()
                ->withArgs(fn (array $p) => $p['daily_loss_limit'] === 360.0 && $p['max_lot'] === 0.2)
                ->andReturn(['status' => 'running']);
        });

        $this->actingAs(User::factory()->create())
            ->postJson('/bot/load-favorites', [
                'favorites' => [['favorite_id' => $fav->id, 'lot' => 0.01, 'daily_loss_limit' => 360, 'max_lot' => 0.2]],
                'daily_loss_limit' => 999, 'max_positions' => 1, 'max_lot' => 9,
            ])
            ->assertOk();
    }

    public function test_journal_persistente_proxya_el_bridge(): void
    {
        $this->mock(PythonBridgeService::class, function (MockInterface $m) {
            $m->shouldReceive('botJournal')->once()->with(100)
                ->andReturn(['entries' => [['kind' => 'open', 'symbol' => 'GOLD#', 'risk_usd' => 117.66], ['kind' => 'close', 'pnl' => -118.40]]]);
        });

        $this->actingAs(User::factory()->create())
            ->getJson('/bot/journal?limit=100')
            ->assertOk()
            ->assertJsonPath('entries.0.risk_usd', 117.66)
            ->assertJsonPath('entries.1.pnl', -118.40);
    }

    public function test_preview_spec_arma_specs_desde_favoritos_y_proxya(): void
    {
        $fav = Favorite::create([
            'name' => 'oro donchian', 'source' => 'explorer', 'pair' => 'XAUUSD#', 'type' => 'donchian',
            'timeframe' => 'H4', 'params' => ['period' => 20], 'sl_pips' => 1.5, 'tp_pips' => 4.0,
            'risk_percent' => 2.0, 'capital' => 10000, 'sl_mode' => 'atr', 'atr_period' => 14,
        ]);

        $this->mock(PythonBridgeService::class, function (MockInterface $m) use ($fav) {
            $m->shouldReceive('botPreviewSpec')->once()
                ->withArgs(function (array $rows) use ($fav) {
                    $r = $rows[0];
                    return $r['favorite_id'] === $fav->id && $r['symbol'] === 'XAUUSD#'
                        && $r['sl_mode'] === 'atr' && (float) $r['risk_percent'] === 2.0;
                })
                ->andReturn(['previews' => [['favorite_id' => $fav->id, 'ok' => true, 'would_lot' => 0.03, 'would_open' => true]]]);
        });

        $this->actingAs(User::factory()->create())
            ->postJson('/bot/preview', ['favorite_ids' => [$fav->id], 'below_min' => 'skip', 'max_lot' => 0])
            ->assertOk()
            ->assertJsonPath('previews.0.would_lot', 0.03);
    }
}
