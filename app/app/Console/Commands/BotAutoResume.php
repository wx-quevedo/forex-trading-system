<?php

namespace App\Console\Commands;

use App\Models\Setting;
use App\Services\PythonBridgeService;
use App\Services\TelegramNotifier;
use Carbon\CarbonInterface;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Auto-reanudar SEGURO tras un reinicio (Windows Update, corte de luz, redeploy).
 *
 * El bridge, al arrancar, deja PAUSADAS por seguridad las estrategias que estaban
 * operando (fail-safe). Este comando —que corre cada minuto como SYSTEM— las reanuda
 * SOLO si las condiciones son sanas (MT5 conectado, BD escribible, config íntegra) y
 * NO hay un crash-loop del bridge. En cualquier caso, notifica por Telegram.
 *
 * Superpone la seguridad SIN debilitar el fail-safe: si este actor falla o muere, el
 * bridge se queda pausado (última línea de defensa). Solo toca runs con el marcador
 * exacto de pausa-por-reinicio → nunca reanuda lo que el usuario pausó/detuvo a mano.
 *
 * Idempotente por `boot_id` (ts del último arranque del bridge): reanuda/decide una vez
 * por reinicio, no cada minuto.
 */
class BotAutoResume extends Command
{
    protected $signature = 'bot:autoresume';
    protected $description = 'Reanuda las estrategias tras un reinicio si las condiciones son sanas (o las deja pausadas y avisa)';

    private const K_HANDLED = 'forexbot.autoresume.handled_boot';
    private const K_HEADSUP = 'forexbot.autoresume.headsup_boot';

    public function handle(PythonBridgeService $bridge, TelegramNotifier $tg): int
    {
        if (! config('forexbot.autoresume.enabled', true)) {
            return self::SUCCESS;
        }

        // Señales del ciclo de vida del bridge. Si el bridge no responde, no hay nada que
        // hacer aquí (el watchdog es quien alerta de caídas). Salimos silenciosamente.
        try {
            $life = $bridge->botLifecycle();
        } catch (Throwable) {
            return self::SUCCESS;
        }

        // ¿Hay estrategias pausadas por el fail-safe de reinicio? Si no, nada que reanudar.
        if (empty($life['restart_paused'])) {
            return self::SUCCESS;
        }

        $bootId = $life['boot_id'] ?? null;
        if ($bootId === null) {
            return self::SUCCESS; // sin arranque registrado no podemos razonar de forma idempotente
        }

        // Ya decidimos sobre ESTE reinicio (reanudado o dejado pausado) → no repetir.
        if (Cache::get(self::K_HANDLED) === $bootId) {
            return self::SUCCESS;
        }

        // 1) CRASH-LOOP: demasiados arranques del bridge en la ventana → NO reanudar.
        if ($this->isCrashLoop($life)) {
            $window = (int) config('forexbot.autoresume.loop_window_min', 10);
            $this->notifyRestart($tg, "\u{267B}\u{FE0F} <b>Reinicio detectado</b>\nVarios arranques del bridge en {$window} min (posible crash-loop). "
                . 'Dejé las estrategias <b>PAUSADAS</b>. Revisa.');
            Cache::forever(self::K_HANDLED, $bootId);
            return self::SUCCESS;
        }

        // 2) Condiciones sanas: MT5 conectado, BD escribible, config íntegra.
        [$healthy, $reason, $count] = $this->health($bridge);

        if ($healthy) {
            try {
                $bridge->botResume(null); // reanuda TODAS las pausadas-por-reinicio
            } catch (Throwable $e) {
                // No pudimos reanudar: no marcamos como gestionado → se reintenta al minuto.
                return self::SUCCESS;
            }
            $when = $this->bootLocal($bootId)?->format('H:i') ?? '??:??';
            $this->notifyRestart($tg, "\u{267B}\u{FE0F} <b>Reinicio detectado</b> a las {$when}. "
                . "Condiciones sanas. Reanudé <b>{$count}</b> estrategia(s) automáticamente." . $this->originHint($life));
            Cache::forever(self::K_HANDLED, $bootId);
            return self::SUCCESS;
        }

        // 3) No sano todavía. Dentro de la gracia → esperar (aviso único) y reintentar.
        $graceMin = (int) config('forexbot.autoresume.grace_min', 10);
        $deadline = $this->bootLocal($bootId)?->addMinutes($graceMin);
        if ($deadline !== null && Carbon::now()->lt($deadline)) {
            if (Cache::get(self::K_HEADSUP) !== $bootId) {
                $this->notifyRestart($tg, "\u{267B}\u{FE0F} <b>Reinicio detectado</b>\n{$reason} — esperando a que se restablezca (reintentando hasta {$graceMin} min).");
                Cache::forever(self::K_HEADSUP, $bootId);
            }
            return self::SUCCESS; // NO marcar gestionado: se reintenta al siguiente minuto
        }

        // 4) Gracia agotada sin sanar → quedarse PAUSADO y avisar (final).
        $this->notifyRestart($tg, "\u{267B}\u{FE0F} <b>Reinicio detectado</b> pero {$reason} tras {$graceMin} min. "
            . 'Dejé las estrategias <b>PAUSADAS</b>. Revisa.');
        Cache::forever(self::K_HANDLED, $bootId);
        return self::SUCCESS;
    }

    /** ¿Arrancó el bridge demasiadas veces en la ventana (crash-loop) frente a un reinicio único? */
    private function isCrashLoop(array $life): bool
    {
        $windowMin = (int) config('forexbot.autoresume.loop_window_min', 10);
        $maxBoots = (int) config('forexbot.autoresume.loop_max_boots', 3);
        $since = Carbon::now()->subMinutes($windowMin);
        $recent = 0;
        foreach ($life['boots'] ?? [] as $b) {
            $ts = $this->parseTs($b['ts'] ?? null);
            if ($ts !== null && $ts->gte($since)) {
                $recent++;
            }
        }
        return $recent > $maxBoots;
    }

    /**
     * Chequeo de salud. Devuelve [sano, motivo_si_no, nº_estrategias_a_reanudar].
     * Orden: BD (local, barato) → MT5 (bridge) → integridad de config.
     */
    private function health(PythonBridgeService $bridge): array
    {
        // BD escribible (detecta "database is locked"): un write real + un select.
        try {
            Setting::query()->updateOrCreate(['key' => 'autoresume_healthz'], ['value' => Carbon::now()->toIso8601String()]);
            DB::select('select 1');
        } catch (Throwable $e) {
            return [false, 'la BD no es escribible (¿locked?)', 0];
        }

        // MT5 conectado: /account debe devolver balance numérico.
        try {
            $acc = $bridge->account();
        } catch (Throwable) {
            return [false, 'MT5 no responde (bridge /account falló)', 0];
        }
        if (! isset($acc['balance']) || ! is_numeric($acc['balance'])) {
            return [false, 'MT5 sin datos de cuenta (desconectado)', 0];
        }

        // Config íntegra: los runs pausados-por-reinicio deben tener campos esenciales.
        try {
            $runs = $bridge->botStatus()['runs'] ?? [];
        } catch (Throwable) {
            return [false, 'no se pudo leer el estado del bot', 0];
        }
        $toResume = 0;
        foreach ($runs as $r) {
            if (($r['status'] ?? '') !== 'paused' || ! str_contains((string) ($r['stop_reason'] ?? ''), 'Reinicio del bridge')) {
                continue;
            }
            $s = $r['strategy'] ?? [];
            if (empty($s['type']) || empty($s['symbol']) || empty($s['timeframe'])) {
                return [false, 'config incompleta en alguna estrategia', 0];
            }
            $toResume++;
        }
        if ($toResume === 0) {
            return [false, 'sin estrategias válidas que reanudar', 0];
        }

        return [true, '', $toResume];
    }

    /** Pista sobre el origen: reboot de máquina (uptime SO bajo) vs reinicio del bridge. */
    private function originHint(array $life): string
    {
        $up = $life['os_uptime_s'] ?? null;
        if (! is_numeric($up)) {
            return '';
        }
        return $up < 900 ? "\n(Reinicio de la máquina)" : "\n(Reinicio del bridge; la máquina seguía encendida)";
    }

    private function notifyRestart(TelegramNotifier $tg, string $text): void
    {
        $tg->notify('restart', $text);
    }

    private function bootLocal(string $bootId): ?CarbonInterface
    {
        return $this->parseTs($bootId);
    }

    private function parseTs(?string $ts): ?CarbonInterface
    {
        if (! $ts) {
            return null;
        }
        try {
            return Carbon::parse($ts);
        } catch (Throwable) {
            return null;
        }
    }
}
