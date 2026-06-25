<?php

namespace Tests\Feature;

use App\Events\BacktestCompleted;
use App\Jobs\RunBacktest;
use App\Models\Backtest;
use App\Models\Strategy;
use App\Models\User;
use App\Services\PythonBridgeService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Mockery\MockInterface;
use Tests\TestCase;

class BacktestTest extends TestCase
{
    use RefreshDatabase;

    private function strategy(): Strategy
    {
        return Strategy::create([
            'name' => 'EUR EMA',
            'pair' => 'EURUSD',
            'timeframe' => 'H1',
            'parameters' => [
                'type' => 'ma_cross',
                'indicators' => ['ma_type' => 'ema', 'fast_period' => 9, 'slow_period' => 21],
                'risk' => ['sl_pips' => 20, 'tp_pips' => 40, 'risk_percent' => 1],
            ],
            'version' => 1,
        ]);
    }

    public function test_store_creates_backtest_and_dispatches_job(): void
    {
        Queue::fake();
        $strategy = $this->strategy();

        $this->actingAs(User::factory()->create())
            ->post('/backtests', [
                'strategy_id' => $strategy->id,
                'date_from' => '2024-01-01',
                'date_to' => '2024-06-30',
            ])
            ->assertRedirect();

        $this->assertDatabaseHas('backtests', ['strategy_id' => $strategy->id, 'status' => 'pending']);
        Queue::assertPushed(RunBacktest::class);
    }

    public function test_store_validates_date_order(): void
    {
        $strategy = $this->strategy();

        $this->actingAs(User::factory()->create())
            ->post('/backtests', [
                'strategy_id' => $strategy->id,
                'date_from' => '2024-06-30',
                'date_to' => '2024-01-01',
            ])
            ->assertSessionHasErrors('date_to');
    }

    public function test_job_runs_backtest_and_persists_results(): void
    {
        Event::fake([BacktestCompleted::class]);

        $this->mock(PythonBridgeService::class, function (MockInterface $m) {
            $m->shouldReceive('runBacktest')->once()->andReturn([
                'metrics' => ['total_trades' => 5, 'win_rate' => 0.6, 'net_pnl' => 120.5],
                'trades' => [['direction' => 'buy', 'pnl' => 10]],
                'equity_curve' => [['time' => 1700000000, 'equity' => 10010]],
            ]);
        });

        $strategy = $this->strategy();
        $backtest = Backtest::create([
            'strategy_id' => $strategy->id,
            'date_from' => '2024-01-01',
            'date_to' => '2024-06-30',
            'status' => 'pending',
        ]);

        (new RunBacktest($backtest->id))->handle(app(PythonBridgeService::class));

        $backtest->refresh();
        $this->assertSame('completed', $backtest->status);
        $this->assertSame(5, $backtest->result_metrics['total_trades']);
        $this->assertCount(1, $backtest->result_trades);
        Event::assertDispatched(BacktestCompleted::class);
    }

    public function test_index_renders(): void
    {
        $this->actingAs(User::factory()->create())->get('/backtests')->assertOk();
    }
}
