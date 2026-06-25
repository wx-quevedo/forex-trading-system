<?php

namespace App\Jobs;

use App\Events\BacktestCompleted;
use App\Models\Backtest;
use App\Services\PythonBridgeService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

/**
 * Ejecuta un backtest de forma asíncrona (Queue + Horizon en producción):
 * pide al bridge correr la simulación sobre datos históricos de MT5 y persiste
 * el resultado en la fila `backtests`, emitiendo el evento de finalización.
 */
class RunBacktest implements ShouldQueue
{
    use Queueable;

    public int $timeout = 180;

    public function __construct(public int $backtestId) {}

    public function handle(PythonBridgeService $bridge): void
    {
        $backtest = Backtest::with('strategy')->find($this->backtestId);
        if (! $backtest || ! $backtest->strategy) {
            return;
        }

        $backtest->update(['status' => 'running', 'error' => null]);

        try {
            $params = $backtest->strategy->parameters ?? [];
            $result = $bridge->runBacktest(
                type: $params['type'] ?? 'ma_cross',
                params: $params['indicators'] ?? [],
                symbol: $backtest->strategy->pair,
                timeframe: $backtest->strategy->timeframe,
                from: $backtest->date_from->toIso8601String(),
                to: $backtest->date_to->toIso8601String(),
                risk: $params['risk'] ?? [],
            );

            $backtest->update([
                'status' => 'completed',
                'result_metrics' => $result['metrics'] ?? null,
                'result_trades' => $result['trades'] ?? null,
                'result_equity_curve' => $result['equity_curve'] ?? null,
            ]);
        } catch (Throwable $e) {
            $backtest->update(['status' => 'failed', 'error' => $e->getMessage()]);
        }

        BacktestCompleted::dispatch($backtest->fresh());
    }
}
