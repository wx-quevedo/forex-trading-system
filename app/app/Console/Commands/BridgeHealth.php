<?php

namespace App\Console\Commands;

use App\Services\BridgeException;
use App\Services\PythonBridgeService;
use Illuminate\Console\Command;
use Throwable;

class BridgeHealth extends Command
{
    protected $signature = 'bridge:health {--account : También intenta leer la cuenta MT5}';

    protected $description = 'Comprueba la conexión con el bridge Python MT5';

    public function handle(PythonBridgeService $bridge): int
    {
        $this->info('Bridge URL: ' . config('forexbot.bridge.url'));

        try {
            $health = $bridge->health();
        } catch (Throwable $e) {
            $this->error('No se pudo contactar al bridge: ' . $e->getMessage());
            return self::FAILURE;
        }

        $this->line('Health: ' . json_encode($health, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

        if ($this->option('account')) {
            try {
                $account = $bridge->account();
                $this->info('Cuenta MT5:');
                $this->line(json_encode($account, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            } catch (BridgeException $e) {
                $this->warn("Cuenta no disponible (HTTP {$e->status}): {$e->getMessage()}");
            } catch (Throwable $e) {
                $this->error('Error consultando cuenta: ' . $e->getMessage());
                return self::FAILURE;
            }
        }

        return self::SUCCESS;
    }
}
