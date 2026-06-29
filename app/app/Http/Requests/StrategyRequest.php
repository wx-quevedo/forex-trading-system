<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StrategyRequest extends FormRequest
{
    public const TYPES = ['ma_cross', 'rsi', 'macd', 'bollinger', 'combined',
        'supertrend', 'ichimoku', 'donchian', 'stochastic', 'cci', 'psar'];
    public const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN1'];

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:120'],
            'description' => ['nullable', 'string', 'max:1000'],
            'pair' => ['required', 'string', 'max:20'],
            'timeframe' => ['required', Rule::in(self::TIMEFRAMES)],
            'type' => ['required', Rule::in(self::TYPES)],
            'indicators' => ['nullable', 'array'],
            'risk' => ['nullable', 'array'],
            'risk.sl_pips' => ['nullable', 'numeric', 'min:0'],
            'risk.tp_pips' => ['nullable', 'numeric', 'min:0'],
            'risk.risk_percent' => ['nullable', 'numeric', 'min:0', 'max:100'],
        ];
    }

    /** Empaqueta los parámetros en la forma persistida en strategies.parameters. */
    public function parameters(): array
    {
        return [
            'type' => $this->input('type'),
            'indicators' => $this->input('indicators', []),
            'risk' => $this->input('risk', []),
        ];
    }
}
