<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Estado del bot actualizado → se emite por Reverb al panel de control en vivo.
 */
class BotUpdated implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    /** @param array<string, mixed> $status */
    public function __construct(public array $status) {}

    public function broadcastOn(): Channel
    {
        return new Channel('bot');
    }

    public function broadcastAs(): string
    {
        return 'bot.updated';
    }

    /** @return array<string, mixed> */
    public function broadcastWith(): array
    {
        return ['status' => $this->status];
    }
}
