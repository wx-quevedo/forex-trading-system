<?php

namespace Tests\Feature;

use App\Models\BotRun;
use App\Models\SignalLog;
use App\Models\Strategy;
use App\Models\Trade;
use App\Models\User;
use App\Services\PythonBridgeService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery\MockInterface;
use Tests\TestCase;

class BotTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        // Evitar que BotUpdated intente emitir por Reverb en los tests.
        config(['broadcasting.default' => 'null']);
    }

    private function strategy(): Strategy
    {
        return Strategy::create([
            'name' => 'EUR EMA', 'pair' => 'EURUSD', 'timeframe' => 'H1',
            'parameters' => [
                'type' => 'ma_cross',
                'indicators' => ['ma_type' => 'ema', 'fast_period' => 9, 'slow_period' => 21],
                'risk' => ['sl_pips' => 20, 'tp_pips' => 40, 'risk_percent' => 1],
            ],
            'version' => 1,
        ]);
    }

    public function test_start_adds_strategy_and_calls_bridge(): void
    {
        $strategy = $this->strategy();
        $this->mock(PythonBridgeService::class, function (MockInterface $m) use ($strategy) {
            $m->shouldReceive('botStart')->once()
                ->with(\Mockery::on(fn ($cfg) => $cfg['strategy_id'] === $strategy->id
                    && $cfg['strategy_type'] === 'ma_cross'
                    && $cfg['symbol'] === 'EURUSD'
                    && $cfg['lot'] === 0.05
                    && $cfg['max_positions'] === 2
                    && $cfg['sl_pips'] === 20.0))
                ->andReturn(['status' => 'running', 'runs' => [], 'positions' => [], 'signals' => [], 'closed_trades' => []]);
        });

        $this->actingAs(User::factory()->create())
            ->postJson('/bot/start', [
                'strategy_id' => $strategy->id, 'lot' => 0.05, 'daily_loss_limit' => 50, 'max_positions' => 2, 'timeframe' => 'H1',
            ])
            ->assertOk()
            ->assertJsonPath('status.status', 'running');

        $this->assertDatabaseHas('bot_runs', ['strategy_id' => $strategy->id, 'status' => 'running']);
    }

    public function test_panic_stops_all_runs(): void
    {
        $this->mock(PythonBridgeService::class, function (MockInterface $m) {
            $m->shouldReceive('botPanic')->once()->andReturn(['panic' => ['count' => 2, 'closed' => [], 'errors' => []], 'status' => ['status' => 'stopped']]);
        });
        $strategy = $this->strategy();
        $run = BotRun::create(['strategy_id' => $strategy->id, 'started_at' => now(), 'status' => 'running']);

        $this->actingAs(User::factory()->create())
            ->postJson('/bot/panic')
            ->assertOk()
            ->assertJsonPath('panic.count', 2);

        $this->assertSame('stopped', $run->fresh()->status);
    }

    public function test_pause_targets_one_strategy(): void
    {
        $strategy = $this->strategy();
        $run = BotRun::create(['strategy_id' => $strategy->id, 'started_at' => now(), 'status' => 'running']);
        $this->mock(PythonBridgeService::class, function (MockInterface $m) use ($strategy) {
            $m->shouldReceive('botPause')->once()->with($strategy->id)->andReturn(['status' => 'paused', 'runs' => []]);
        });

        $this->actingAs(User::factory()->create())
            ->postJson('/bot/pause', ['strategy_id' => $strategy->id])
            ->assertOk();

        $this->assertSame('paused', $run->fresh()->status);
    }

    public function test_status_syncs_per_strategy_with_traceability(): void
    {
        $strategy = $this->strategy();
        $run = BotRun::create(['strategy_id' => $strategy->id, 'started_at' => now(), 'status' => 'running']);

        $this->mock(PythonBridgeService::class, function (MockInterface $m) use ($run, $strategy) {
            $m->shouldReceive('botStatus')->andReturn([
                'status' => 'running',
                'runs' => [
                    ['strategy_id' => $strategy->id, 'bot_run_id' => $run->id, 'status' => 'running', 'realized_pnl_today' => 12.5, 'stop_reason' => null, 'error' => null],
                ],
                'positions' => [],
                'exposure' => [],
                'signals' => [
                    ['seq' => 1, 'strategy_id' => $strategy->id, 'evaluated_at' => now()->toIso8601String(), 'symbol' => 'EURUSD', 'signal_type' => 'buy', 'executed' => true, 'reason' => 'cruce', 'indicator_values' => ['fast' => 1.1]],
                ],
                'closed_trades' => [
                    ['ticket' => 777, 'strategy_id' => $strategy->id, 'magic' => 770001, 'symbol' => 'EURUSD', 'direction' => 'buy', 'volume' => 0.01, 'open_price' => 1.1, 'close_price' => 1.105, 'pnl' => 12.5, 'close_reason' => 'take_profit'],
                ],
            ]);
        });

        $this->actingAs(User::factory()->create())
            ->getJson('/bot/status')
            ->assertOk()
            ->assertJsonPath('status', 'running');

        $this->assertDatabaseHas('signal_logs', ['strategy_id' => $strategy->id, 'signal_type' => 'buy', 'executed' => true]);
        $this->assertDatabaseHas('trades', ['ticket' => 777, 'bot_run_id' => $run->id, 'strategy_id' => $strategy->id, 'magic' => 770001, 'close_reason' => 'take_profit']);
        $this->assertEquals(12.5, $run->fresh()->total_pnl);
        $this->assertSame(1, $run->fresh()->total_trades);
    }

    public function test_telegram_settings_persist(): void
    {
        $this->actingAs(User::factory()->create())
            ->postJson('/bot/telegram', ['enabled' => false, 'events' => ['panic' => true, 'trade_opened' => false]])
            ->assertOk()
            ->assertJsonPath('telegram.enabled', false)
            ->assertJsonPath('telegram.events.trade_opened', false)
            ->assertJsonPath('telegram.events.panic', true);
    }

    // --- Fase 8: cargar favoritos al bot --------------------------------
    private function favorite(string $pair = 'USDCAD#', string $type = 'bollinger'): \App\Models\Favorite
    {
        return \App\Models\Favorite::create([
            'name' => "$type $pair H4", 'source' => 'explorer', 'pair' => $pair, 'type' => $type, 'timeframe' => 'H4',
            'params' => ['period' => 20, 'std_dev' => 2.0],
            'sl_pips' => 50, 'tp_pips' => 40, 'risk_percent' => 1, 'capital' => 10000,
            'backtest_from' => '2025-01-01', 'backtest_to' => '2025-12-31',
            'backtest_metrics' => ['return_pct' => 12.0, 'win_rate' => 0.6],
        ]);
    }

    public function test_load_favorite_materializes_strategy_and_starts(): void
    {
        $fav = $this->favorite();
        $this->mock(PythonBridgeService::class, function (MockInterface $m) {
            $m->shouldReceive('botStart')->once()
                ->with(\Mockery::on(fn ($cfg) => $cfg['strategy_type'] === 'bollinger'
                    && $cfg['symbol'] === 'USDCAD#'
                    && $cfg['timeframe'] === 'H4'
                    && $cfg['lot'] === 0.04
                    && $cfg['sl_pips'] === 50.0
                    && $cfg['tp_pips'] === 40.0))
                ->andReturn(['status' => 'running']);
            $m->shouldReceive('botStatus')->andReturn(['status' => 'running', 'runs' => []]);
        });

        $this->actingAs(User::factory()->create())
            ->postJson('/bot/load-favorites', [
                'favorites' => [['favorite_id' => $fav->id, 'lot' => 0.04]],
                'daily_loss_limit' => 100, 'max_positions' => 1,
            ])
            ->assertOk()
            ->assertJsonPath('status.status', 'running');

        // Estrategia materializada con traza al favorito y parámetros correctos.
        $this->assertDatabaseHas('strategies', ['favorite_id' => $fav->id, 'pair' => 'USDCAD#', 'timeframe' => 'H4', 'name' => '★ ' . $fav->name]);
        $strategy = Strategy::where('favorite_id', $fav->id)->first();
        $this->assertSame('bollinger', $strategy->parameters['type']);
        $this->assertSame(50, $strategy->parameters['risk']['sl_pips']);
        $this->assertDatabaseHas('bot_runs', ['strategy_id' => $strategy->id, 'status' => 'running']);
    }

    public function test_load_favorite_twice_does_not_duplicate_strategy(): void
    {
        $fav = $this->favorite();
        $this->mock(PythonBridgeService::class, function (MockInterface $m) {
            $m->shouldReceive('botStart')->twice()->andReturn(['status' => 'running']);
            $m->shouldReceive('botStatus')->andReturn(['status' => 'running', 'runs' => []]);
        });
        $user = User::factory()->create();
        $payload = ['favorites' => [['favorite_id' => $fav->id, 'lot' => 0.02]], 'daily_loss_limit' => 100, 'max_positions' => 1];

        $this->actingAs($user)->postJson('/bot/load-favorites', $payload)->assertOk();
        $this->actingAs($user)->postJson('/bot/load-favorites', $payload)->assertOk();

        $this->assertSame(1, Strategy::where('favorite_id', $fav->id)->count());
    }

    public function test_load_multiple_favorites_starts_each(): void
    {
        $f1 = $this->favorite('USDCAD#', 'bollinger');
        $f2 = $this->favorite('EURUSD#', 'rsi');
        $this->mock(PythonBridgeService::class, function (MockInterface $m) {
            $m->shouldReceive('botStart')->twice()->andReturn(['status' => 'running']);
            $m->shouldReceive('botStatus')->andReturn(['status' => 'running', 'runs' => []]);
        });

        $this->actingAs(User::factory()->create())
            ->postJson('/bot/load-favorites', [
                'favorites' => [['favorite_id' => $f1->id, 'lot' => 0.02], ['favorite_id' => $f2->id, 'lot' => 0.03]],
                'daily_loss_limit' => 100, 'max_positions' => 1,
            ])
            ->assertOk();

        $this->assertSame(2, Strategy::whereNotNull('favorite_id')->count());
        $this->assertSame(2, BotRun::where('status', 'running')->count());
    }

    public function test_load_favorites_requires_at_least_one(): void
    {
        $this->actingAs(User::factory()->create())
            ->postJson('/bot/load-favorites', ['favorites' => [], 'daily_loss_limit' => 100, 'max_positions' => 1])
            ->assertStatus(422);
    }
}
