<?php

namespace Tests\Feature;

use App\Models\BotEvent;
use App\Models\SignalLog;
use App\Models\Strategy;
use App\Services\BotService;
use App\Services\PythonBridgeService;
use App\Services\TelegramNotifier;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Mockery;
use Tests\TestCase;

/**
 * Fixes del replay de Telegram (diagnóstico 2026-07-08). Los dos mecanismos raíz:
 *
 * #1 GUARD NO-ENCOGER: un snapshot con positions=[] y runs presentes (hipo de MT5 —
 *    el bridge tenía `except: pass`) sobrescribía la memoria de vistos con lista
 *    vacía → al siguiente poll sano TODAS las posiciones parecían nuevas y Telegram
 *    re-enviaba "Trade abierto" viejos (bot:notify corre cada minuto).
 * #3 CURSOR POR RUN: el cursor de señales vivía por strategy_id (forever); un
 *    RE-ARME crea un run nuevo con seq=0 → señales ≤ cursor viejo se PERDÍAN en
 *    silencio. Ahora la clave incluye el started_at del run.
 *
 * También cubre #2 (descarte por edad) y #5 (positions_ok:false del bridge).
 */
class BotTelegramReplayTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['broadcasting.default' => 'null']);
    }

    /** @return array{0: BotService, 1: Mockery\MockInterface} servicio con bridge que devuelve $status */
    private function service(array $status): array
    {
        $bridge = Mockery::mock(PythonBridgeService::class);
        $bridge->shouldReceive('botStatus')->andReturn($status);
        $telegram = Mockery::mock(TelegramNotifier::class);

        return [new BotService($bridge, $telegram), $telegram];
    }

    private function botStatusArray(array $overrides = []): array
    {
        return array_merge([
            'status' => 'running',
            'runs' => [['strategy_id' => 5, 'bot_run_id' => null, 'status' => 'running',
                'started_at' => '2026-07-08T10:00:00+00:00']],
            'positions' => [], 'signals' => [], 'closed_trades' => [], 'exposure' => [],
        ], $overrides);
    }

    private function position(int $ticket, ?int $openedAt = null, int $sid = 5): array
    {
        return ['ticket' => $ticket, 'strategy_id' => $sid, 'type' => 0, 'symbol' => 'EURUSD#',
            'volume' => 0.1, 'price_open' => 1.1, 'time' => $openedAt ?? now()->getTimestamp()];
    }

    public function test_fix1_snapshot_vacio_no_borra_vistos_ni_notifica(): void
    {
        Cache::forever('forexbot.bot_open_seen', [111]);
        [$svc, $telegram] = $this->service($this->botStatusArray(['positions' => []]));
        $telegram->shouldReceive('notify')->never();

        $svc->syncAndStatus();

        $this->assertSame([111], Cache::get('forexbot.bot_open_seen'),
            'el hipo (positions vacías con runs presentes) NO debe encoger la memoria de vistos');
    }

    public function test_fix5_positions_ok_false_se_trata_como_el_guard(): void
    {
        Cache::forever('forexbot.bot_open_seen', [111]);
        // El bridge honesto: trae datos pero declara que su bucle de posiciones falló.
        [$svc, $telegram] = $this->service($this->botStatusArray([
            'positions' => [$this->position(222)], 'positions_ok' => false,
        ]));
        $telegram->shouldReceive('notify')->never();

        $svc->syncAndStatus();

        $this->assertSame([111], Cache::get('forexbot.bot_open_seen'));
    }

    public function test_flujo_normal_notifica_solo_las_nuevas_y_actualiza_vistos(): void
    {
        Cache::forever('forexbot.bot_open_seen', [111]);
        [$svc, $telegram] = $this->service($this->botStatusArray([
            'positions' => [$this->position(111), $this->position(222)],
        ]));
        $telegram->shouldReceive('notify')->once()
            ->with('trade_opened', Mockery::pattern('/EURUSD#/'));

        $svc->syncAndStatus();

        $this->assertSame([111, 222], Cache::get('forexbot.bot_open_seen'));
    }

    public function test_fix2_apertura_vieja_va_al_journal_sin_telegram(): void
    {
        // Estrategia REAL: bot_events.strategy_id tiene FK y logEvent traga errores —
        // sin la fila, el evento no se crearía y el test no probaría nada.
        $s = Strategy::create(['name' => 'rsi test', 'pair' => 'EURUSD#', 'timeframe' => 'H1',
            'parameters' => ['type' => 'rsi', 'indicators' => [], 'risk' => []]]);
        Cache::forever('forexbot.bot_open_seen', [111]);
        // "Nueva" con 2h de antigüedad = replay/carga tardía, no un trade fresco.
        [$svc, $telegram] = $this->service($this->botStatusArray([
            'positions' => [$this->position(111, null, $s->id), $this->position(333, now()->getTimestamp() - 7200, $s->id)],
        ]));
        $telegram->shouldReceive('notify')->never();

        $svc->syncAndStatus();

        $this->assertSame(1, BotEvent::where('type', 'trade_opened')
            ->where('message', 'like', '%detectado tarde%')->count(),
            'la apertura vieja queda auditada en el Journal aunque no vaya a Telegram');
    }

    public function test_fix3_cursor_por_run_no_pierde_seniales_tras_rearme(): void
    {
        $s = Strategy::create(['name' => 'psar test', 'pair' => 'EURUSD#', 'timeframe' => 'H4',
            'parameters' => ['type' => 'psar', 'indicators' => [], 'risk' => []]]);
        // Cursor VIEJO pre-fix (clavado por strategy_id) en 99: con la clave antigua,
        // las señales seq 1-2 del run re-armado se habrían descartado en silencio.
        Cache::forever("forexbot.bot_seq.{$s->id}", 99);

        $signal = fn (int $seq) => ['strategy_id' => $s->id, 'seq' => $seq,
            'evaluated_at' => '2026-07-08T11:00:00+00:00', 'symbol' => 'EURUSD#',
            'signal_type' => 'none', 'executed' => false, 'reason' => 'test', 'indicator_values' => []];
        $status = $this->botStatusArray([
            'runs' => [['strategy_id' => $s->id, 'bot_run_id' => null, 'status' => 'running',
                'started_at' => '2026-07-08T10:00:00+00:00']],
            'signals' => [$signal(1), $signal(2)],
        ]);
        [$svc, $telegram] = $this->service($status);
        $telegram->shouldReceive('notify')->never();

        $svc->syncAndStatus();
        $this->assertSame(2, SignalLog::count(), 'el run re-armado tiene cursor propio: nada se pierde');

        // Idempotencia: el mismo snapshot otra vez no duplica.
        $svc->syncAndStatus();
        $this->assertSame(2, SignalLog::count());
    }
}
