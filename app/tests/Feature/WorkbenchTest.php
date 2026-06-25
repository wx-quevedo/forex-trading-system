<?php

namespace Tests\Feature;

use App\Models\AiAnalysis;
use App\Models\Backtest;
use App\Models\Strategy;
use App\Models\User;
use App\Services\ClaudeService;
use App\Services\PythonBridgeService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Mockery\MockInterface;
use Tests\TestCase;

class WorkbenchTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::put('forexbot.strategy_schemas', [
            'ma_cross' => [
                'fields' => [
                    ['name' => 'ma_type', 'type' => 'select', 'default' => 'ema', 'options' => [['value' => 'sma'], ['value' => 'ema']]],
                    ['name' => 'fast_period', 'type' => 'number', 'default' => 9, 'min' => 1, 'max' => 200],
                    ['name' => 'slow_period', 'type' => 'number', 'default' => 21, 'min' => 2, 'max' => 400],
                ],
            ],
        ]);
    }

    private function setup_(): array
    {
        $s = Strategy::create([
            'name' => 'EUR EMA', 'pair' => 'EURUSD', 'timeframe' => 'H1',
            'parameters' => [
                'type' => 'ma_cross',
                'indicators' => ['ma_type' => 'ema', 'fast_period' => 9, 'slow_period' => 21],
                'risk' => ['sl_pips' => 20, 'tp_pips' => 40, 'risk_percent' => 1],
            ],
            'version' => 1,
        ]);
        $b = Backtest::create([
            'strategy_id' => $s->id, 'date_from' => '2024-01-01', 'date_to' => '2024-06-30', 'status' => 'completed',
            'result_metrics' => ['net_pnl' => -100, 'total_trades' => 50],
        ]);

        return [$s, $b];
    }

    public function test_ephemeral_runs_without_persisting_a_backtest(): void
    {
        $this->mock(PythonBridgeService::class, function (MockInterface $m) {
            $m->shouldReceive('runBacktest')->once()->andReturn([
                'metrics' => ['net_pnl' => 210.0, 'total_trades' => 30, 'win_rate' => 0.47],
                'trades' => [['direction' => 'buy', 'pnl' => 10]],
                'equity_curve' => [['time' => 1700000000, 'equity' => 10210]],
            ]);
        });
        [$s] = $this->setup_();
        $before = Backtest::count();

        $this->actingAs(User::factory()->create())
            ->postJson('/backtests/ephemeral', [
                'strategy_type' => 'ma_cross', 'pair' => 'EURUSD', 'timeframe' => 'H1',
                'date_from' => '2024-01-01', 'date_to' => '2024-06-30',
                'indicators' => ['ma_type' => 'ema', 'fast_period' => 12, 'slow_period' => 30],
                'risk' => ['sl_pips' => 20, 'tp_pips' => 60, 'risk_percent' => 1],
            ])
            ->assertOk()
            ->assertJsonStructure(['metrics', 'trades', 'equity_curve'])
            ->assertJsonPath('metrics.total_trades', 30);

        // No se creó ninguna fila nueva en backtests.
        $this->assertSame($before, Backtest::count());
    }

    public function test_ephemeral_rejects_params_out_of_schema_range(): void
    {
        $this->setup_();
        $this->actingAs(User::factory()->create())
            ->postJson('/backtests/ephemeral', [
                'strategy_type' => 'ma_cross', 'pair' => 'EURUSD', 'timeframe' => 'H1',
                'date_from' => '2024-01-01', 'date_to' => '2024-06-30',
                'indicators' => ['fast_period' => 9999],
            ])
            ->assertStatus(422);
    }

    public function test_save_version_creates_version_and_persists_run_when_chosen(): void
    {
        [$s] = $this->setup_();
        $btBefore = Backtest::count();

        $this->actingAs(User::factory()->create())
            ->post("/strategies/{$s->id}/save-version-from-workbench", [
                'indicators' => ['fast_period' => 13, 'slow_period' => 34],
                'risk' => ['tp_pips' => 60],
                'date_from' => '2024-01-01', 'date_to' => '2024-06-30',
                'persist_run' => true,
                'run' => ['metrics' => ['net_pnl' => 210], 'trades' => [], 'equity' => [['time' => 1, 'equity' => 10210]]],
            ])
            ->assertRedirect();

        $child = Strategy::where('parent_id', $s->id)->firstOrFail();
        $this->assertSame(2, $child->version);
        $this->assertSame(13, $child->parameters['indicators']['fast_period']);
        $this->assertSame(60, $child->parameters['risk']['tp_pips']);
        $this->assertSame(20, $child->parameters['risk']['sl_pips']); // conservado

        // Se persistió la corrida ligada a la nueva versión.
        $this->assertSame($btBefore + 1, Backtest::count());
        $this->assertDatabaseHas('backtests', ['strategy_id' => $child->id, 'status' => 'completed']);
    }

    public function test_save_version_without_persist_run_creates_no_backtest(): void
    {
        [$s] = $this->setup_();
        $btBefore = Backtest::count();

        $this->actingAs(User::factory()->create())
            ->post("/strategies/{$s->id}/save-version-from-workbench", [
                'indicators' => ['fast_period' => 15],
                'date_from' => '2024-01-01', 'date_to' => '2024-06-30',
                'persist_run' => false,
            ])
            ->assertRedirect();

        $this->assertSame(1, Strategy::where('parent_id', $s->id)->count());
        $this->assertSame($btBefore, Backtest::count());
    }

    public function test_workbench_analyze_records_api_analysis_without_creating_version(): void
    {
        $this->mock(ClaudeService::class, function (MockInterface $m) {
            $m->shouldReceive('isConfigured')->andReturn(true);
            $m->shouldReceive('analyze')->once()->andReturn([
                'text' => 'Alarga las medias.',
                'suggested_parameters' => ['fast_period' => 12, 'slow_period' => 26],
                'model' => 'claude-sonnet-4-6',
                'usage' => ['input_tokens' => 100, 'output_tokens' => 40],
            ]);
        });
        [$s, $b] = $this->setup_();
        $strategiesBefore = Strategy::count();

        $this->actingAs(User::factory()->create())
            ->postJson("/backtests/{$b->id}/workbench/analyze", [
                'message' => '¿Cómo mejoro el win rate?',
                'indicators' => ['fast_period' => 9, 'slow_period' => 21],
                'risk' => ['sl_pips' => 20],
                'metrics' => ['net_pnl' => -100],
            ])
            ->assertOk()
            ->assertJsonPath('analysis.suggested_parameters.fast_period', 12);

        $a = AiAnalysis::where('backtest_id', $b->id)->firstOrFail();
        $this->assertSame('api', $a->mode);
        $this->assertNotNull($a->estimated_cost_usd);
        // El análisis NO crea versiones (solo rellena el panel en el front).
        $this->assertSame($strategiesBefore, Strategy::count());
    }
}
