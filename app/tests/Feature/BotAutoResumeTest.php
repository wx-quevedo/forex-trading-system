<?php

namespace Tests\Feature;

use App\Services\PythonBridgeService;
use App\Services\TelegramNotifier;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Mockery\MockInterface;
use Tests\TestCase;

/**
 * bot:autoresume reanuda las estrategias pausadas por el fail-safe de reinicio SOLO si las
 * condiciones son sanas (MT5/BD/config) y no hay crash-loop; si no, las deja pausadas. En
 * todos los casos avisa por Telegram. Idempotente por boot_id.
 */
class BotAutoResumeTest extends TestCase
{
    use RefreshDatabase;

    private const MARKER = 'Reinicio del bridge: la estrategia arrancó PAUSADA por seguridad.';
    private const K_HANDLED = 'forexbot.autoresume.handled_boot';

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    /** @param array<string,mixed> $over */
    private function lifecycle(string $bootId, array $over = []): array
    {
        return array_merge([
            'boots' => [['ts' => $bootId, 'os_uptime_s' => 120]],
            'boot_id' => $bootId,
            'os_uptime_s' => 120,
            'restart_paused' => true,
            'restart_paused_ids' => [33],
        ], $over);
    }

    /** @return array<string,mixed> */
    private function healthyStatus(): array
    {
        return ['runs' => [[
            'strategy_id' => 33, 'status' => 'paused', 'stop_reason' => self::MARKER,
            'strategy' => ['type' => 'macd', 'symbol' => 'GOLD#', 'timeframe' => 'H4'],
        ]]];
    }

    private function mockTelegram(callable $expect): void
    {
        $this->mock(TelegramNotifier::class, function (MockInterface $m) use ($expect) {
            $expect($m);
        });
    }

    public function test_reanuda_cuando_todo_esta_sano_y_es_idempotente(): void
    {
        $boot = now()->toIso8601String();
        $this->mock(PythonBridgeService::class, function (MockInterface $m) use ($boot) {
            $m->shouldReceive('botLifecycle')->andReturn($this->lifecycle($boot));
            $m->shouldReceive('account')->andReturn(['balance' => 10000.0]);
            $m->shouldReceive('botStatus')->andReturn($this->healthyStatus());
            $m->shouldReceive('botResume')->once()->with(null)->andReturn([]); // UNA sola vez pese a 2 corridas
        });
        $this->mockTelegram(fn (MockInterface $m) => $m->shouldReceive('notify')->once()
            ->withArgs(fn ($ev, $txt) => $ev === 'restart' && str_contains($txt, 'Reanudé'))->andReturn(true));

        $this->artisan('bot:autoresume')->assertExitCode(0);
        $this->assertSame($boot, Cache::get(self::K_HANDLED));
        // Segunda corrida: mismo boot ya gestionado → no reanuda ni notifica de nuevo.
        $this->artisan('bot:autoresume')->assertExitCode(0);
    }

    public function test_crash_loop_no_reanuda_y_avisa(): void
    {
        $boot = now()->toIso8601String();
        $boots = [];
        for ($i = 0; $i < 4; $i++) { // 4 arranques en la ventana > umbral (3)
            $boots[] = ['ts' => now()->subMinutes($i)->toIso8601String(), 'os_uptime_s' => 5];
        }
        $this->mock(PythonBridgeService::class, function (MockInterface $m) use ($boot, $boots) {
            $m->shouldReceive('botLifecycle')->andReturn($this->lifecycle($boot, ['boots' => $boots]));
            $m->shouldReceive('botResume')->never();
        });
        $this->mockTelegram(fn (MockInterface $m) => $m->shouldReceive('notify')->once()
            ->withArgs(fn ($ev, $txt) => $ev === 'restart' && str_contains($txt, 'PAUSADAS'))->andReturn(true));

        $this->artisan('bot:autoresume')->assertExitCode(0);
        $this->assertSame($boot, Cache::get(self::K_HANDLED));
    }

    public function test_mt5_caido_dentro_de_gracia_espera_sin_reanudar(): void
    {
        $boot = now()->toIso8601String(); // recién arrancado → dentro de la gracia
        $this->mock(PythonBridgeService::class, function (MockInterface $m) use ($boot) {
            $m->shouldReceive('botLifecycle')->andReturn($this->lifecycle($boot));
            $m->shouldReceive('account')->andThrow(new \RuntimeException('MT5 down'));
            $m->shouldReceive('botResume')->never();
        });
        $this->mockTelegram(fn (MockInterface $m) => $m->shouldReceive('notify')->once()
            ->withArgs(fn ($ev, $txt) => $ev === 'restart' && str_contains($txt, 'esperando'))->andReturn(true));

        $this->artisan('bot:autoresume')->assertExitCode(0);
        // NO marca gestionado → se reintentará al siguiente minuto.
        $this->assertNull(Cache::get(self::K_HANDLED));
    }

    public function test_gracia_agotada_sin_sanar_queda_pausado_y_avisa(): void
    {
        $boot = now()->subMinutes(20)->toIso8601String(); // arrancó hace 20 min, gracia 10
        $this->mock(PythonBridgeService::class, function (MockInterface $m) use ($boot) {
            $m->shouldReceive('botLifecycle')->andReturn($this->lifecycle($boot, [
                'boots' => [['ts' => $boot, 'os_uptime_s' => 5]],
            ]));
            $m->shouldReceive('account')->andThrow(new \RuntimeException('MT5 down'));
            $m->shouldReceive('botResume')->never();
        });
        $this->mockTelegram(fn (MockInterface $m) => $m->shouldReceive('notify')->once()
            ->withArgs(fn ($ev, $txt) => $ev === 'restart' && str_contains($txt, 'PAUSADAS'))->andReturn(true));

        $this->artisan('bot:autoresume')->assertExitCode(0);
        $this->assertSame($boot, Cache::get(self::K_HANDLED));
    }

    public function test_sin_pausa_por_reinicio_no_hace_nada(): void
    {
        $this->mock(PythonBridgeService::class, function (MockInterface $m) {
            $m->shouldReceive('botLifecycle')->andReturn($this->lifecycle(now()->toIso8601String(), ['restart_paused' => false, 'restart_paused_ids' => []]));
            $m->shouldReceive('botResume')->never();
            $m->shouldReceive('account')->never();
        });
        $this->mockTelegram(fn (MockInterface $m) => $m->shouldReceive('notify')->never());

        $this->artisan('bot:autoresume')->assertExitCode(0);
    }

    public function test_desactivado_por_config_no_toca_el_bridge(): void
    {
        config(['forexbot.autoresume.enabled' => false]);
        $this->mock(PythonBridgeService::class, fn (MockInterface $m) => $m->shouldReceive('botLifecycle')->never());
        $this->mockTelegram(fn (MockInterface $m) => $m->shouldReceive('notify')->never());

        $this->artisan('bot:autoresume')->assertExitCode(0);
    }
}
