<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BotEvent extends Model
{
    protected $fillable = ['bot_run_id', 'type', 'severity', 'message', 'occurred_at'];

    protected $casts = ['occurred_at' => 'datetime'];

    public function botRun(): BelongsTo
    {
        return $this->belongsTo(BotRun::class);
    }
}
