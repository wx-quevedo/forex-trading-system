<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Posiciones abiertas actualizadas (emitidas vía Reverb al dashboard).
 * Canal público `trading` (app de un solo usuario).
 */
class PositionsUpdated implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    /** @param array<int, array<string, mixed>> $positions */
    public function __construct(public array $positions) {}

    public function broadcastOn(): Channel
    {
        return new Channel('trading');
    }

    public function broadcastAs(): string
    {
        return 'positions.updated';
    }

    /** @return array<string, mixed> */
    public function broadcastWith(): array
    {
        return ['positions' => $this->positions];
    }
}
