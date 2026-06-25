<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AiAnalysis extends Model
{
    protected $table = 'ai_analyses';

    protected $fillable = [
        'backtest_id', 'prompt', 'response', 'model', 'suggested_parameters',
        'mode', 'input_tokens', 'output_tokens', 'estimated_cost_usd',
        'applied', 'resulting_strategy_id',
    ];

    protected $casts = [
        'suggested_parameters' => 'array',
        'input_tokens' => 'integer',
        'output_tokens' => 'integer',
        'estimated_cost_usd' => 'decimal:6',
        'applied' => 'boolean',
    ];

    public function backtest(): BelongsTo
    {
        return $this->belongsTo(Backtest::class);
    }

    public function resultingStrategy(): BelongsTo
    {
        return $this->belongsTo(Strategy::class, 'resulting_strategy_id');
    }
}
