<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\PythonBridgeService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery\MockInterface;
use Tests\TestCase;

/**
 * Contrato del envelope del proxy de mercado: TODA respuesta va envuelta en
 * {data: <json del bridge>} (vía MarketController::safe). El frontend DEBE leer
 * `data.data`. El bug sistémico fue que varios fetches nuevos (régimen, eventos,
 * correlación) leían `data.X` directo → siempre vacíos. Este test fija el contrato.
 */
class MarketProxyEnvelopeTest extends TestCase
{
    use RefreshDatabase;

    public function test_regime_va_envuelto_en_data(): void
    {
        $this->mock(PythonBridgeService::class, function (MockInterface $m) {
            $m->shouldReceive('marketRegime')->once()
                ->andReturn(['regime' => 'RANGO', 'confidence' => 0.8]);
        });

        $this->actingAs(User::factory()->create())
            ->getJson('/api/market/regime/' . rawurlencode('EURUSD#') . '?timeframe=H1')
            ->assertOk()
            ->assertJsonPath('data.regime', 'RANGO')   // ← bajo data, no en la raíz
            ->assertJsonMissingPath('regime');
    }

    public function test_calendar_events_va_envuelto_en_data(): void
    {
        $this->mock(PythonBridgeService::class, function (MockInterface $m) {
            $m->shouldReceive('calendarEvents')->once()
                ->andReturn(['count' => 1, 'events' => [['title' => 'NFP', 'currency' => 'USD']]]);
        });

        $this->actingAs(User::factory()->create())
            ->getJson('/api/calendar/events?from=2026-03-01&to=2026-03-31&impact=high')
            ->assertOk()
            ->assertJsonPath('data.events.0.title', 'NFP');
    }

    public function test_portfolio_correlation_va_envuelto_en_data(): void
    {
        $this->mock(PythonBridgeService::class, function (MockInterface $m) {
            $m->shouldReceive('portfolioCorrelation')->once()
                ->andReturn(['labels' => ['A', 'B'], 'matrix' => [[1.0, -1.0], [-1.0, 1.0]]]);
        });

        $this->actingAs(User::factory()->create())
            ->postJson('/api/portfolio/correlation', ['labels' => ['A', 'B'], 'series' => [[0.1, -0.1], [-0.1, 0.1]]])
            ->assertOk()
            ->assertJsonPath('data.labels', ['A', 'B'])   // ← bajo data, no en la raíz
            ->assertJsonMissingPath('matrix');
    }
}
