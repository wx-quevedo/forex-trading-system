<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Estrategia marcada como favorita (Fase 9). Guarda su configuración + el periodo
 * y las métricas del backtest de referencia, para el Bot Histórico (walk-forward).
 */
class Favorite extends Model
{
    protected $fillable = [
        'name', 'source', 'pair', 'type', 'timeframe', 'params',
        'sl_pips', 'tp_pips', 'risk_percent', 'capital',
        'backtest_from', 'backtest_to', 'backtest_metrics',
        'regime', 'regime_confidence',
    ];

    protected $casts = [
        'params' => 'array',
        'backtest_metrics' => 'array',
        'backtest_from' => 'date',
        'backtest_to' => 'date',
        'sl_pips' => 'float',
        'tp_pips' => 'float',
        'risk_percent' => 'float',
        'capital' => 'float',
        'regime_confidence' => 'float',
    ];
}
