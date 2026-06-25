<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AiAnalysis extends Model
{
    protected $table = 'ai_analyses';

    protected $fillable = [
        'backtest_id', 'prompt', 'response', 'model', 'suggested_parameters',
    ];

    protected $casts = [
        'suggested_parameters' => 'array',
    ];

    public function backtest(): BelongsTo
    {
        return $this->belongsTo(Backtest::class);
    }
}
