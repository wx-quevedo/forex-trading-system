<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Python MT5 Bridge
    |--------------------------------------------------------------------------
    |
    | Conexión al bridge FastAPI que expone MetaTrader 5. En desarrollo apunta
    | a la tower local; en producción a su hostname/IP de Tailscale. La API key
    | viaja en el header X-API-Key y debe coincidir con la del bridge.
    |
    */
    'bridge' => [
        'url' => env('BRIDGE_URL', 'http://127.0.0.1:8000'),
        'api_key' => env('BRIDGE_API_KEY', ''),
        'timeout' => (int) env('BRIDGE_TIMEOUT', 15),
    ],

    /*
    |--------------------------------------------------------------------------
    | Anthropic (Análisis IA — Fase 6)
    |--------------------------------------------------------------------------
    */
    'anthropic' => [
        'api_key' => env('ANTHROPIC_API_KEY', ''),
        'model' => env('ANTHROPIC_MODEL', 'claude-sonnet-4-6'),
        // Precio USD por 1M de tokens (para estimar el coste del modo API).
        // claude-sonnet-4-6: $3 input / $15 output.
        'price_input_per_mtok' => (float) env('ANTHROPIC_PRICE_INPUT', 3.0),
        'price_output_per_mtok' => (float) env('ANTHROPIC_PRICE_OUTPUT', 15.0),
    ],

];
