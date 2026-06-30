<?php

namespace Tests\Feature;

use App\Models\Setting;
use App\Models\User;
use App\Services\PythonBridgeService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery\MockInterface;
use Tests\TestCase;

/**
 * Validación walk-forward del top-N en un rango POSTERIOR (página Contexto).
 * Cubre: persistencia del rango de validación, BLOQUEO del solape (data leakage) y
 * el proxy /explorer/validate (usa el rango del Contexto, defensa contra solape).
 */
class WalkforwardValidationTest extends TestCase
{
    use RefreshDatabase;

    public function test_contexto_persiste_el_rango_de_validacion(): void
    {
        $this->actingAs(User::factory()->create())
            ->post('/settings/analysis-context', [
                'date_from' => '2025-01-01', 'date_to' => '2025-12-31', 'capital' => 10000,
                'val_date_from' => '2026-01-01', 'val_date_to' => '2026-06-27',
            ])
            ->assertSessionHasNoErrors();

        $ctx = Setting::analysisContext();
        $this->assertSame('2026-01-01', $ctx['val_date_from']);
        $this->assertSame('2026-06-27', $ctx['val_date_to']);
    }

    public function test_contexto_bloquea_el_solape_de_validacion(): void
    {
        // val_date_from ANTES de date_to → solape → data leakage → rechazado (no se guarda).
        $this->actingAs(User::factory()->create())
            ->post('/settings/analysis-context', [
                'date_from' => '2025-01-01', 'date_to' => '2025-12-31', 'capital' => 10000,
                'val_date_from' => '2025-06-01', 'val_date_to' => '2026-06-27',
            ])
            ->assertSessionHasErrors('val_date_from');
    }

    public function test_validate_proxya_con_el_rango_del_contexto(): void
    {
        Setting::put(Setting::CONTEXT_KEY, [
            'date_from' => '2025-01-01', 'date_to' => '2025-12-31', 'capital' => 10000,
            'val_date_from' => '2026-01-01', 'val_date_to' => '2026-06-27',
        ]);

        $this->mock(PythonBridgeService::class, function (MockInterface $m) {
            $m->shouldReceive('exploreValidate')
                ->once()
                ->withArgs(function (array $payload) {
                    // El payload lleva el rango de validación del Contexto y las filas.
                    return str_starts_with($payload['val_from'], '2026-01-01')
                        && str_starts_with($payload['val_to'], '2026-06-27')
                        && count($payload['rows']) === 1;
                })
                ->andReturn(['results' => [['ok' => true, 'val_return_pct' => 12.5, 'val_final_balance' => 11250.75, 'val_blown' => false, 'val_total_trades' => 8]]]);
        });

        $this->actingAs(User::factory()->create())
            ->postJson('/explorer/validate', ['rows' => [['pair' => 'EURUSD#', 'type' => 'rsi', 'timeframe' => 'H1', 'params' => [], 'sl_pips' => 20, 'tp_pips' => 40, 'risk_percent' => 1.0, 'return_pct' => 30]]])
            ->assertOk()
            ->assertJsonPath('results.0.val_final_balance', 11250.75);
    }

    public function test_validate_rechaza_si_el_contexto_tiene_solape(): void
    {
        // Defensa en profundidad: aunque la UI lo bloquea, el backend reafirma el no-solape.
        Setting::put(Setting::CONTEXT_KEY, [
            'date_from' => '2025-01-01', 'date_to' => '2025-12-31', 'capital' => 10000,
            'val_date_from' => '2025-06-01', 'val_date_to' => '2026-06-27',  // solapa
        ]);

        $this->mock(PythonBridgeService::class, function (MockInterface $m) {
            $m->shouldReceive('exploreValidate')->never();  // no debe llegar al bridge
        });

        $this->actingAs(User::factory()->create())
            ->postJson('/explorer/validate', ['rows' => [['pair' => 'EURUSD#', 'type' => 'rsi', 'timeframe' => 'H1', 'params' => []]]])
            ->assertStatus(422);
    }
}
