<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SignalLog extends Model
{
    protected $fillable = [
        'strategy_id', 'evaluated_at', 'symbol',
        'signal_type', 'executed', 'reason', 'indicator_values',
    ];

    protected $casts = [
        'evaluated_at' => 'datetime',
        'executed' => 'boolean',
        'indicator_values' => 'array',
    ];

    public function strategy(): BelongsTo
    {
        return $this->belongsTo(Strategy::class);
    }
}
