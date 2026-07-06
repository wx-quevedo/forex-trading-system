<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Estrategia marcada como favorita (Fase 9). Guarda su configuración + el periodo
 * y las métricas del backtest de referencia, para el Bot Histórico (walk-forward).
 *
 * Cripto (Fase 2b-iv): `market` ('forex' default | 'crypto') separa los mercados sin
 * tocar lo existente; `validation` (JSON nullable) guarda la EVIDENCIA del pipeline de
 * verificación (labels viaja-eth/solo-btc/…, PF holdout, PF sin funding, cross-pair).
 */
class Favorite extends Model
{
    protected $fillable = [
        'name', 'source', 'market', 'pair', 'type', 'timeframe', 'params',
        'sl_pips', 'tp_pips', 'risk_percent', 'capital',
        'sl_mode', 'atr_period',
        'backtest_from', 'backtest_to', 'backtest_metrics',
        'regime', 'regime_confidence', 'validation',
    ];

    protected $casts = [
        'params' => 'array',
        'backtest_metrics' => 'array',
        'validation' => 'array',
        'backtest_from' => 'date',
        'backtest_to' => 'date',
        'sl_pips' => 'float',
        'tp_pips' => 'float',
        'risk_percent' => 'float',
        'capital' => 'float',
        'atr_period' => 'integer',
        'regime_confidence' => 'float',
    ];
}
