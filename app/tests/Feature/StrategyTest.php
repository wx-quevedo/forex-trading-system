<?php

namespace Tests\Feature;

use App\Models\SignalLog;
use App\Models\Strategy;
use App\Models\User;
use App\Services\PythonBridgeService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery\MockInterface;
use Tests\TestCase;

class StrategyTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::factory()->create();
    }

    private function payload(array $overrides = []): array
    {
        return array_merge([
            'name' => 'EUR Scalper',
            'description' => 'Cruce de medias',
            'pair' => 'eurusd',
            'timeframe' => 'H1',
            'type' => 'ma_cross',
            'indicators' => ['ma_type' => 'ema', 'fast_period' => 9, 'slow_period' => 21],
            'risk' => ['sl_pips' => 20, 'tp_pips' => 40, 'risk_percent' => 1],
            'is_active' => true,
        ], $overrides);
    }

    public function test_can_create_strategy(): void
    {
        $this->actingAs($this->user())
            ->post('/strategies', $this->payload())
            ->assertRedirect();

        $s = Strategy::firstOrFail();
        $this->assertSame('EURUSD', $s->pair);            // normalizado a mayúsculas
        $this->assertSame('ma_cross', $s->parameters['type']);
        $this->assertSame(9, $s->parameters['indicators']['fast_period']);
        $this->assertSame(1, $s->version);
    }

    public function test_validation_rejects_bad_type(): void
    {
        $this->actingAs($this->user())
            ->post('/strategies', $this->payload(['type' => 'invalid']))
            ->assertSessionHasErrors('type');
    }

    public function test_versioning_creates_child(): void
    {
        $user = $this->user();
        $this->actingAs($user)->post('/strategies', $this->payload());
        $root = Strategy::firstOrFail();

        $this->actingAs($user)
            ->post("/strategies/{$root->id}/version", $this->payload(['name' => 'EUR Scalper v2']))
            ->assertRedirect();

        $child = Strategy::where('parent_id', $root->id)->firstOrFail();
        $this->assertSame(2, $child->version);
        $this->assertSame($root->id, $child->parent_id);
    }

    public function test_evaluate_records_signal_log(): void
    {
        $this->mock(PythonBridgeService::class, function (MockInterface $m) {
            $m->shouldReceive('evaluateStrategy')->once()->andReturn([
                'signal' => 'buy',
                'reason' => 'EMA rápida cruzó por encima',
                'indicators' => ['fast' => 1.1, 'slow' => 1.09],
                'price' => 1.105,
                'time' => 1700000000,
            ]);
        });

        $user = $this->user();
        $strategy = Strategy::create([
            'name' => 'X',
            'pair' => 'EURUSD',
            'timeframe' => 'H1',
            'parameters' => ['type' => 'ma_cross', 'indicators' => ['fast_period' => 9], 'risk' => []],
            'version' => 1,
        ]);

        $this->actingAs($user)
            ->postJson("/strategies/{$strategy->id}/evaluate")
            ->assertOk()
            ->assertJsonPath('result.signal', 'buy');

        $this->assertDatabaseCount('signal_logs', 1);
        $log = SignalLog::firstOrFail();
        $this->assertSame('buy', $log->signal_type);
        $this->assertFalse($log->executed);
    }
}
