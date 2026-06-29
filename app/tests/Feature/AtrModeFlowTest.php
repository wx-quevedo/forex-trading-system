<?php

namespace Tests\Feature;

use App\Models\Strategy;
use App\Models\User;
use App\Services\PythonBridgeService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia;
use Mockery\MockInterface;
use Tests\TestCase;

/**
 * El modo SL/TP (Fase 1: fixed | atr + atr_period) debe llegar INTACTO desde el
 * favorito hasta el walk-forward del Bot Histórico. Si se perdiera, una estrategia
 * explorada en ATR se validaría con stops FIJOS (validación sin sentido).
 */
class AtrModeFlowTest extends TestCase
{
    use RefreshDatabase;

    public function test_favorito_persiste_sl_mode_atr(): void
    {
        $this->actingAs(User::factory()->create())
            ->postJson('/favorites', [
                'name' => 'Supertrend EURUSD# H1', 'pair' => 'EURUSD#', 'type' => 'supertrend',
                'timeframe' => 'H1', 'params' => ['period' => 10, 'multiplier' => 3],
                'sl_pips' => 3, 'tp_pips' => 3, 'risk_percent' => 1, 'capital' => 10000,
                'sl_mode' => 'atr', 'atr_period' => 14,
            ])
            ->assertOk();

        $this->assertDatabaseHas('favorites', [
            'pair' => 'EURUSD#', 'type' => 'supertrend', 'sl_mode' => 'atr', 'atr_period' => 14,
        ]);
    }

    public function test_walkforward_reenvia_sl_mode_atr_al_motor(): void
    {
        $captured = null;
        $this->mock(PythonBridgeService::class, function (MockInterface $m) use (&$captured) {
            $m->shouldReceive('runBacktest')->once()
                ->andReturnUsing(function ($type, $params, $symbol, $timeframe, $from, $to, $risk = [], $config = []) use (&$captured) {
                    $captured = $risk;
                    return ['metrics' => ['total_trades' => 5, 'return_pct' => 1.0], 'trades' => [], 'equity_curve' => []];
                });
        });

        // El Bot Histórico llama a /backtests/ephemeral con el risk del favorito (incluye sl_mode/atr_period).
        $this->actingAs(User::factory()->create())
            ->postJson('/backtests/ephemeral', [
                'strategy_type' => 'supertrend', 'pair' => 'EURUSD#', 'timeframe' => 'H1',
                'date_from' => '2025-01-01', 'date_to' => '2026-06-27',
                'indicators' => ['period' => 10, 'multiplier' => 3],
                'risk' => ['sl_pips' => 3, 'tp_pips' => 3, 'risk_percent' => 1, 'sl_mode' => 'atr', 'atr_period' => 14],
                'initial_balance' => 10000,
            ])
            ->assertOk();

        $this->assertNotNull($captured, 'runBacktest no fue llamado');
        $this->assertSame('atr', $captured['sl_mode'] ?? null, 'el walk-forward NO recibió sl_mode=atr');
        $this->assertSame(14, $captured['atr_period'] ?? null, 'el walk-forward NO recibió atr_period');
    }

    private function atrStrategy(): Strategy
    {
        return Strategy::create([
            'name' => 'ST ATR', 'pair' => 'EURUSD#', 'timeframe' => 'H1',
            'parameters' => [
                'type' => 'supertrend',
                'indicators' => ['period' => 10, 'multiplier' => 3],
                'risk' => ['sl_pips' => 3, 'tp_pips' => 3, 'risk_percent' => 1, 'sl_mode' => 'atr', 'atr_period' => 14],
            ],
            'version' => 1,
        ]);
    }

    public function test_lab_preload_lleva_el_modo_atr(): void
    {
        $s = $this->atrStrategy();
        $this->actingAs(User::factory()->create())
            ->get('/laboratory?strategy=' . $s->id)
            ->assertInertia(fn (AssertableInertia $page) => $page
                ->component('Laboratory')
                ->where('preload.risk.sl_mode', 'atr')
                ->where('preload.risk.atr_period', 14));
    }

    public function test_lab_store_persiste_el_modo_atr(): void
    {
        $this->actingAs(User::factory()->create())
            ->post('/laboratory', [
                'name' => 'Nueva ATR', 'type' => 'supertrend', 'pair' => 'EURUSD#', 'timeframe' => 'H1',
                'indicators' => ['period' => 10, 'multiplier' => 3],
                'risk' => ['sl_pips' => 3, 'tp_pips' => 3, 'risk_percent' => 1, 'sl_mode' => 'atr', 'atr_period' => 14],
            ]);

        $s = Strategy::where('name', 'Nueva ATR')->firstOrFail();
        $this->assertSame('atr', $s->parameters['risk']['sl_mode'] ?? null);
        $this->assertSame(14, $s->parameters['risk']['atr_period'] ?? null);
    }
}
