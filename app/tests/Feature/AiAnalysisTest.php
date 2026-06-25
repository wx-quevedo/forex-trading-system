<?php

namespace Tests\Feature;

use App\Models\Backtest;
use App\Models\Strategy;
use App\Models\User;
use App\Services\ClaudeService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery\MockInterface;
use Tests\TestCase;

class AiAnalysisTest extends TestCase
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

    private function completedBacktest(Strategy $strategy): Backtest
    {
        return Backtest::create([
            'strategy_id' => $strategy->id,
            'date_from' => '2024-01-01',
            'date_to' => '2024-06-30',
            'status' => 'completed',
            'result_metrics' => ['net_pnl' => -100, 'win_rate' => 0.3, 'total_trades' => 50],
            'result_trades' => [['direction' => 'buy', 'pnl' => 5]],
            'result_equity_curve' => [['time' => 1700000000, 'equity' => 10000]],
        ]);
    }

    public function test_store_calls_claude_and_persists_analysis(): void
    {
        $this->mock(ClaudeService::class, function (MockInterface $m) {
            $m->shouldReceive('isConfigured')->andReturn(true);
            $m->shouldReceive('analyze')->once()->andReturn([
                'text' => 'El drawdown es alto. Sugiero alargar las medias.',
                'suggested_parameters' => ['fast_period' => 12, 'slow_period' => 26],
                'model' => 'claude-sonnet-4-6',
                'usage' => ['input_tokens' => 100, 'output_tokens' => 50],
            ]);
        });

        $strategy = $this->strategy();
        $backtest = $this->completedBacktest($strategy);

        $this->actingAs(User::factory()->create())
            ->postJson("/backtests/{$backtest->id}/analysis", ['message' => '¿Cómo reduzco el drawdown?'])
            ->assertOk()
            ->assertJsonPath('analysis.suggested_parameters.fast_period', 12);

        $this->assertDatabaseCount('ai_analyses', 1);
    }

    public function test_store_rejects_when_backtest_not_completed(): void
    {
        $this->mock(ClaudeService::class, fn (MockInterface $m) => $m->shouldReceive('isConfigured')->andReturn(true));

        $strategy = $this->strategy();
        $backtest = Backtest::create([
            'strategy_id' => $strategy->id, 'date_from' => '2024-01-01', 'date_to' => '2024-06-30', 'status' => 'running',
        ]);

        $this->actingAs(User::factory()->create())
            ->postJson("/backtests/{$backtest->id}/analysis", ['message' => 'hola'])
            ->assertStatus(422);
    }

    public function test_apply_creates_new_strategy_version(): void
    {
        $this->mock(ClaudeService::class, fn (MockInterface $m) => $m->shouldReceive('isConfigured')->andReturn(true));

        $strategy = $this->strategy();
        $backtest = $this->completedBacktest($strategy);
        $analysis = $strategy->backtests()->first()->aiAnalyses()->create([
            'prompt' => 'q',
            'response' => 'r',
            'model' => 'claude-sonnet-4-6',
            'suggested_parameters' => ['fast_period' => 15, 'slow_period' => 30],
        ]);

        $this->actingAs(User::factory()->create())
            ->post("/backtests/{$backtest->id}/analysis/{$analysis->id}/apply")
            ->assertRedirect();

        $child = Strategy::where('parent_id', $strategy->id)->firstOrFail();
        $this->assertSame(2, $child->version);
        $this->assertSame(15, $child->parameters['indicators']['fast_period']);
        $this->assertSame(30, $child->parameters['indicators']['slow_period']);
        // ma_type no se sugiere: se conserva.
        $this->assertSame('ema', $child->parameters['indicators']['ma_type']);
    }
}
