<?php

namespace App\Console\Commands;

use App\Events\PositionsUpdated;
use App\Services\PythonBridgeService;
use Illuminate\Console\Command;
use Throwable;

/**
 * Sondea el bridge MT5 y emite las posiciones abiertas por Reverb al dashboard.
 *
 *   php artisan bridge:broadcast-positions            # una vez
 *   php artisan bridge:broadcast-positions --watch    # loop continuo
 *
 * En producción se ejecuta bajo Supervisor (o el loop del bot, Fase 7).
 */
class BroadcastPositions extends Command
{
    protected $signature = 'bridge:broadcast-positions {--watch : Repetir indefinidamente} {--interval=3 : Segundos entre sondeos}';

    protected $description = 'Emite las posiciones abiertas MT5 al dashboard vía Reverb';

    public function handle(PythonBridgeService $bridge): int
    {
        $interval = max(1, (int) $this->option('interval'));

        do {
            try {
                $positions = $bridge->positions();
                PositionsUpdated::dispatch($positions);
                $this->line(now()->format('H:i:s') . " · emitidas " . count($positions) . ' posiciones');
            } catch (Throwable $e) {
                $this->warn('No se pudo sondear el bridge: ' . $e->getMessage());
            }

            if ($this->option('watch')) {
                sleep($interval);
            }
        } while ($this->option('watch'));

        return self::SUCCESS;
    }
}
