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

    public function test_start_creates_bot_run_and_calls_bridge(): void
    {
        $this->mock(PythonBridgeService::class, function (MockInterface $m) {
            $m->shouldReceive('botStart')->once()
                ->with(\Mockery::on(fn ($cfg) => $cfg['strategy_type'] === 'ma_cross'
                    && $cfg['symbol'] === 'EURUSD'
                    && $cfg['lot'] === 0.05
                    && $cfg['max_positions'] === 2
                    && $cfg['sl_pips'] === 20.0))
                ->andReturn(['status' => 'running', 'positions' => [], 'signals' => [], 'closed_trades' => []]);
        });

        $strategy = $this->strategy();

        $this->actingAs(User::factory()->create())
            ->postJson('/bot/start', [
                'strategy_id' => $strategy->id, 'lot' => 0.05, 'daily_loss_limit' => 50, 'max_positions' => 2, 'timeframe' => 'H1',
            ])
            ->assertOk()
            ->assertJsonPath('status.status', 'running');

        $this->assertDatabaseHas('bot_runs', ['strategy_id' => $strategy->id, 'status' => 'running']);
    }

    public function test_panic_stops_active_run(): void
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

    public function test_status_syncs_signals_trades_and_run(): void
    {
        $strategy = $this->strategy();
        $run = BotRun::create(['strategy_id' => $strategy->id, 'started_at' => now(), 'status' => 'running']);

        $this->mock(PythonBridgeService::class, function (MockInterface $m) use ($run) {
            $m->shouldReceive('botStatus')->andReturn([
                'status' => 'running',
                'bot_run_id' => $run->id,
                'stop_reason' => null,
                'realized_pnl_today' => 12.5,
                'positions' => [],
                'signals' => [
                    ['seq' => 1, 'evaluated_at' => now()->toIso8601String(), 'symbol' => 'EURUSD', 'signal_type' => 'buy', 'executed' => true, 'reason' => 'cruce', 'indicator_values' => ['fast' => 1.1]],
                ],
                'closed_trades' => [
                    ['ticket' => 777, 'symbol' => 'EURUSD', 'direction' => 'buy', 'volume' => 0.01, 'open_price' => 1.1, 'close_price' => 1.105, 'pnl' => 12.5, 'exit_reason' => 'tp'],
                ],
            ]);
        });

        $this->actingAs(User::factory()->create())
            ->getJson('/bot/status')
            ->assertOk()
            ->assertJsonPath('status', 'running');

        $this->assertDatabaseHas('signal_logs', ['strategy_id' => $strategy->id, 'signal_type' => 'buy', 'executed' => true]);
        $this->assertDatabaseHas('trades', ['ticket' => 777, 'bot_run_id' => $run->id, 'pnl' => 12.5]);
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
}
