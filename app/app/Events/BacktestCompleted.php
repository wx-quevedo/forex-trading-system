<?php

namespace App\Events;

use App\Models\Backtest;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Un backtest terminó (o falló). Se emite por Reverb para que la vista de
 * resultados se actualice en vivo sin recargar.
 */
class BacktestCompleted implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(public Backtest $backtest) {}

    public function broadcastOn(): Channel
    {
        return new Channel('backtests');
    }

    public function broadcastAs(): string
    {
        return 'backtest.completed';
    }

    /** @return array<string, mixed> */
    public function broadcastWith(): array
    {
        return [
            'id' => $this->backtest->id,
            'status' => $this->backtest->status,
        ];
    }
}
