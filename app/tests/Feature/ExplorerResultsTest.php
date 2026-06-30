<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\PythonBridgeService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery\MockInterface;
use Tests\TestCase;

/**
 * /explorer/results crasheaba con 500 (FatalError: 128MB) al servir reportes grandes:
 * PHP decodificaba el JSON del bridge a array y lo re-serializaba (memoria x8). El fix
 * pasa el body CRUDO sin materializarlo. El desglose del score (pesado por fila) salió
 * del payload masivo y se pide on-demand vía /explorer/score.
 */
class ExplorerResultsTest extends TestCase
{
    use RefreshDatabase;

    public function test_results_pasa_el_json_crudo_sin_materializar(): void
    {
        $raw = '{"status":"done","results_count":1,"results":[{"id":1,"priority":7,"atr_period":14}]}';
        $this->mock(PythonBridgeService::class, function (MockInterface $m) use ($raw) {
            $m->shouldReceive('exploreResultsRaw')->once()->andReturn($raw);
            $m->shouldReceive('exploreResults')->never();  // NO debe decodificar a array
        });

        $this->actingAs(User::factory()->create())
            ->get('/explorer/results')
            ->assertOk()
            ->assertHeader('Content-Type', 'application/json')
            ->assertJsonPath('results.0.priority', 7)
            ->assertJsonPath('results.0.atr_period', 14);
    }

    public function test_score_devuelve_el_desglose_on_demand(): void
    {
        $this->mock(PythonBridgeService::class, function (MockInterface $m) {
            $m->shouldReceive('exploreScore')->once()
                ->andReturn(['score' => 7, 'breakdown' => ['add' => [], 'sub' => [['label' => 'Drawdown', 'points' => 40, 'detail' => '-30%']]], 'verdict' => 'Frágil']);
        });

        $this->actingAs(User::factory()->create())
            ->postJson('/explorer/score', ['row' => ['return_pct' => 74, 'max_drawdown_pct' => -30], 'period_days' => 364])
            ->assertOk()
            ->assertJsonPath('score', 7)
            ->assertJsonPath('breakdown.sub.0.label', 'Drawdown');
    }
}
