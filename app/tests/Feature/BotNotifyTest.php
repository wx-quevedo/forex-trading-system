<?php

namespace Tests\Feature;

use App\Services\PythonBridgeService;
use App\Services\TelegramNotifier;
use Illuminate\Support\Facades\Cache;
use Mockery\MockInterface;
use Tests\TestCase;

/**
 * bot:notify sondea journal+status del bridge (solo lectura) y notifica lo NUEVO via el
 * TelegramNotifier (respetando toggles). Primera corrida = baseline (no spamea el histórico).
 */
class BotNotifyTest extends TestCase
{
    private function seenBaseline(): void
    {
        // Simula que ya hubo una corrida previa (baseline fijado) para probar "lo nuevo".
        Cache::forever('forexbot.notify.last_journal_ts', '2020-01-01T00:00:00Z');
        Cache::forever('forexbot.notify.run_states', ['33' => ['status' => 'running', 'reason' => '', 'error' => '']]);
        Cache::forever('forexbot.notify.last_summary', now()->toDateString()); // no disparar resumen
    }

    private function mockTelegram(callable $expect): void
    {
        $this->mock(TelegramNotifier::class, function (MockInterface $m) use ($expect) {
            $m->shouldReceive('isConfigured')->andReturn(true);
            $m->shouldReceive('globalEnabled')->andReturn(true);
            $expect($m);
        });
    }

    public function test_primera_corrida_no_notifica_el_historico(): void
    {
        Cache::forever('forexbot.notify.last_summary', now()->toDateString()); // aislar del resumen diario
        $this->mock(PythonBridgeService::class, function (MockInterface $m) {
            $m->shouldReceive('botJournal')->andReturn(['entries' => [['ts' => '2026-07-01T10:00:00Z', 'kind' => 'open', 'symbol' => 'GOLD#']]]);
            $m->shouldReceive('botStatus')->andReturn(['runs' => [['strategy_id' => 33, 'status' => 'running', 'strategy' => ['symbol' => 'GOLD#', 'timeframe' => 'H4']]]]);
        });
        $this->mockTelegram(fn (MockInterface $m) => $m->shouldReceive('notify')->never());

        $this->artisan('bot:notify')->assertExitCode(0);
    }

    public function test_notifica_apertura_nueva_del_journal(): void
    {
        $this->seenBaseline();
        $this->mock(PythonBridgeService::class, function (MockInterface $m) {
            $m->shouldReceive('botJournal')->andReturn(['entries' => [[
                'ts' => '2026-07-01T10:00:00Z', 'kind' => 'open', 'symbol' => 'GOLD#', 'strategy_type' => 'macd',
                'direction' => 'buy', 'volume' => 0.02, 'entry' => 4000, 'sl' => 3940, 'tp' => 4200,
                'sl_dist_pips' => 600, 'tp_dist_pips' => 2000, 'risk_usd' => 120, 'atr_value' => 40,
            ]]]);
            $m->shouldReceive('botStatus')->andReturn(['runs' => []]);
        });
        $this->mockTelegram(fn (MockInterface $m) => $m->shouldReceive('notify')->once()
            ->withArgs(fn ($ev, $txt) => $ev === 'trade_opened' && str_contains($txt, 'GOLD#'))->andReturn(true));

        $this->artisan('bot:notify')->assertExitCode(0);
    }

    public function test_notifica_limite_diario_por_cambio_de_estado(): void
    {
        $this->seenBaseline();
        $this->mock(PythonBridgeService::class, function (MockInterface $m) {
            $m->shouldReceive('botJournal')->andReturn(['entries' => []]);
            $m->shouldReceive('botStatus')->andReturn(['runs' => [[
                'strategy_id' => 33, 'status' => 'stopped',
                'stop_reason' => 'Límite de pérdida diaria alcanzado (PnL -101.76).',
                'strategy' => ['symbol' => 'GOLD#', 'timeframe' => 'H4'],
            ]]]);
        });
        $this->mockTelegram(fn (MockInterface $m) => $m->shouldReceive('notify')->once()
            ->withArgs(fn ($ev) => $ev === 'daily_limit')->andReturn(true));

        $this->artisan('bot:notify')->assertExitCode(0);
    }

    public function test_telegram_apagado_no_hace_nada(): void
    {
        $this->mock(TelegramNotifier::class, function (MockInterface $m) {
            $m->shouldReceive('isConfigured')->andReturn(false);
            $m->shouldReceive('globalEnabled')->andReturn(true);
            $m->shouldReceive('notify')->never();
        });
        // Ni siquiera debe consultar el bridge si Telegram está apagado.
        $this->mock(PythonBridgeService::class, fn (MockInterface $m) => $m->shouldReceive('botJournal')->never());

        $this->artisan('bot:notify')->assertExitCode(0);
    }
}
