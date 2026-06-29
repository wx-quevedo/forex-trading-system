<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Strategy extends Model
{
    protected $fillable = [
        'name', 'description', 'pair', 'timeframe',
        'parameters', 'version', 'parent_id', 'is_active', 'favorite_id',
    ];

    protected $casts = [
        'parameters' => 'array',
        'version' => 'integer',
        'is_active' => 'boolean',
    ];

    /** Estrategia padre (versión anterior). */
    public function parent(): BelongsTo
    {
        return $this->belongsTo(Strategy::class, 'parent_id');
    }

    /** Favorito de origen (si se materializó desde Favoritos para operar). */
    public function favorite(): BelongsTo
    {
        return $this->belongsTo(Favorite::class);
    }

    /** Versiones derivadas de esta estrategia. */
    public function versions(): HasMany
    {
        return $this->hasMany(Strategy::class, 'parent_id');
    }

    public function backtests(): HasMany
    {
        return $this->hasMany(Backtest::class);
    }

    public function botRuns(): HasMany
    {
        return $this->hasMany(BotRun::class);
    }

    public function signalLogs(): HasMany
    {
        return $this->hasMany(SignalLog::class);
    }
}
