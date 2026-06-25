<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class BotRun extends Model
{
    protected $fillable = [
        'strategy_id', 'started_at', 'stopped_at',
        'status', 'total_trades', 'total_pnl',
    ];

    protected $casts = [
        'started_at' => 'datetime',
        'stopped_at' => 'datetime',
        'total_trades' => 'integer',
        'total_pnl' => 'decimal:2',
    ];

    public function strategy(): BelongsTo
    {
        return $this->belongsTo(Strategy::class);
    }

    public function trades(): HasMany
    {
        return $this->hasMany(Trade::class);
    }
}
