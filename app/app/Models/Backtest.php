<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Backtest extends Model
{
    protected $fillable = [
        'strategy_id', 'date_from', 'date_to', 'status',
        'result_metrics', 'result_trades', 'result_equity_curve', 'error',
    ];

    protected $casts = [
        'date_from' => 'date',
        'date_to' => 'date',
        'result_metrics' => 'array',
        'result_trades' => 'array',
        'result_equity_curve' => 'array',
    ];

    public function strategy(): BelongsTo
    {
        return $this->belongsTo(Strategy::class);
    }

    public function aiAnalyses(): HasMany
    {
        return $this->hasMany(AiAnalysis::class);
    }
}
