<?php

namespace Tests\Feature;

use App\Models\AiAnalysis;
use App\Models\Backtest;
use App\Models\Strategy;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class ManualTuningTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        // Esquemas en caché para que ManualTuningService no dependa del bridge.
        Cache::put('forexbot.strategy_schemas', [
            'ma_cross' => [
                'label' => 'Cruce MA',
                'fields' => [
                    ['name' => 'ma_type', 'type' => 'select', 'default' => 'ema', 'options' => [['value' => 'sma'], ['value' => 'ema']]],
                    ['name' => 'fast_period', 'type' => 'number', 'default' => 9, 'min' => 1, 'max' => 200],
                    ['name' => 'slow_period', 'type' => 'number', 'default' => 21, 'min' => 2, 'max' => 400],
                ],
            ],
        ]);
    }

    private function backtest(): Backtest
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

        return Backtest::create([
            'strategy_id' => $s->id, 'date_from' => '2024-01-01', 'date_to' => '2024-06-30',
            'status' => 'completed',
            'result_metrics' => ['total_trades' => 162, 'win_rate' => 0.3086, 'net_pnl' => -427.49, 'profit_factor' => 0.945],
        ]);
    }

    public function test_manual_prompt_contains_params_and_metrics(): void
    {
        $b = $this->backtest();
        $this->actingAs(User::factory()->create())
            ->getJson("/backtests/{$b->id}/manual-prompt")
            ->assertOk()
            ->assertJson(fn ($json) => $json->where('prompt', fn ($p) => str_contains($p, 'fast_period') && str_contains($p, '0.3086') && str_contains($p, 'EURUSD')));
    }

    public function test_preview_rejects_malformed_json(): void
    {
        $b = $this->backtest();
        $this->actingAs(User::factory()->create())
            ->postJson("/backtests/{$b->id}/manual/preview", ['json' => 'esto no es json'])
            ->assertStatus(422)
            ->assertJsonPath('ok', false);
    }

    public function test_preview_rejects_out_of_range_and_wrong_type(): void
    {
        $b = $this->backtest();
        $user = User::factory()->create();

        // fuera de rango
        $this->actingAs($user)
            ->postJson("/backtests/{$b->id}/manual/preview", ['json' => '{"parametros_sugeridos":{"fast_period":9999}}'])
            ->assertStatus(422);

        // parámetro de otro tipo (rsi.period no existe en ma_cross)
        $this->actingAs($user)
            ->postJson("/backtests/{$b->id}/manual/preview", ['json' => '{"parametros_sugeridos":{"period":14}}'])
            ->assertStatus(422);

        // risk_percent excesivo
        $this->actingAs($user)
            ->postJson("/backtests/{$b->id}/manual/preview", ['json' => '{"parametros_sugeridos":{"fast_period":12},"riesgo_sugerido":{"risk_percent":50}}'])
            ->assertStatus(422);
    }

    public function test_preview_returns_diff_for_valid_json_with_noise(): void
    {
        $b = $this->backtest();
        // JSON con texto alrededor (tolerancia a ruido).
        $raw = 'Claro, aquí tienes:```json {"diagnostico":"win rate bajo","parametros_sugeridos":{"fast_period":13,"slow_period":34},"riesgo_sugerido":{"tp_pips":60},"justificacion":"mas separacion","confianza":"media"}``` Espero que ayude.';

        $this->actingAs(User::factory()->create())
            ->postJson("/backtests/{$b->id}/manual/preview", ['json' => $raw])
            ->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('diagnostico', 'win rate bajo');
    }

    public function test_apply_creates_version_and_records_manual_analysis(): void
    {
        $b = $this->backtest();
        $raw = '{"parametros_sugeridos":{"fast_period":13,"slow_period":34},"riesgo_sugerido":{"tp_pips":60}}';

        $this->actingAs(User::factory()->create())
            ->post("/backtests/{$b->id}/manual/apply", ['json' => $raw])
            ->assertRedirect();

        $child = Strategy::where('parent_id', $b->strategy_id)->firstOrFail();
        $this->assertSame(2, $child->version);
        $this->assertSame(13, $child->parameters['indicators']['fast_period']);
        $this->assertSame(34, $child->parameters['indicators']['slow_period']);
        $this->assertSame('ema', $child->parameters['indicators']['ma_type']); // conservado
        $this->assertSame(60, $child->parameters['risk']['tp_pips']);
        $this->assertSame(20, $child->parameters['risk']['sl_pips']); // conservado

        $a = AiAnalysis::where('backtest_id', $b->id)->firstOrFail();
        $this->assertSame('manual', $a->mode);
        $this->assertEquals(0, $a->estimated_cost_usd);
        $this->assertTrue($a->applied);
        $this->assertSame($child->id, $a->resulting_strategy_id);
    }
}
