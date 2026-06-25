<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Trade extends Model
{
    protected $fillable = [
        'bot_run_id', 'ticket', 'symbol', 'direction',
        'open_price', 'close_price', 'volume', 'sl', 'tp',
        'open_at', 'close_at', 'pnl', 'commission', 'swap', 'signal_data', 'close_reason',
    ];

    protected $casts = [
        'open_price' => 'decimal:5',
        'close_price' => 'decimal:5',
        'volume' => 'decimal:2',
        'sl' => 'decimal:5',
        'tp' => 'decimal:5',
        'open_at' => 'datetime',
        'close_at' => 'datetime',
        'pnl' => 'decimal:2',
        'commission' => 'decimal:2',
        'swap' => 'decimal:2',
        'signal_data' => 'array',
    ];

    public function botRun(): BelongsTo
    {
        return $this->belongsTo(BotRun::class);
    }
}
