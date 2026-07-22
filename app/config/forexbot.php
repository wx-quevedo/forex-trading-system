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
    | Python Bybit Bridge — CRIPTO (Fase 2b, D:\cbot puerto 8001)
    |--------------------------------------------------------------------------
    |
    | Bridge SEPARADO del forex (solo datos públicos de Bybit; la ejecución
    | cripto llegará en Fase 4 vía testnet). Lo consume PythonBridgeService::
    | forMarket('crypto'); con el default 'forex' ninguna vista existente cambia.
    |
    */
    'bridge_crypto' => [
        'url' => env('CRYPTO_BRIDGE_URL', 'http://127.0.0.1:8001'),
        'api_key' => env('CRYPTO_BRIDGE_API_KEY', ''),
        'timeout' => (int) env('CRYPTO_BRIDGE_TIMEOUT', 15),
    ],

    /*
    |--------------------------------------------------------------------------
    | Anthropic (Análisis IA — Fase 6)
    |--------------------------------------------------------------------------
    */
    /*
    |--------------------------------------------------------------------------
    | Telegram (notificaciones del bot — Fase 7)
    |--------------------------------------------------------------------------
    | Crea un bot con @BotFather → TELEGRAM_BOT_TOKEN. Obtén tu chat_id enviando
    | un mensaje al bot y consultando https://api.telegram.org/bot<token>/getUpdates
    | (el campo result[].message.chat.id) → TELEGRAM_CHAT_ID.
    */
    'telegram' => [
        'token' => env('TELEGRAM_BOT_TOKEN', ''),
        'chat_id' => env('TELEGRAM_CHAT_ID', ''),
    ],

    /*
    |--------------------------------------------------------------------------
    | Auto-reanudar tras reinicio (bot:autoresume)
    |--------------------------------------------------------------------------
    | Tras un reinicio (Windows Update, corte de luz, redeploy) el bridge arranca
    | con las estrategias PAUSADAS por seguridad. Este comando las reanuda de forma
    | segura si las condiciones son sanas, salvo que detecte un CRASH-LOOP.
    |
    |  - loop_window_min / loop_max_boots: N arranques del bridge en X min => crash-loop
    |    => NO reanuda (queda pausado y avisa). Distingue reboot de máquina (1 arranque)
    |    de un bridge que se reinicia solo en bucle.
    |  - grace_min: tras un reinicio, cuánto esperar a que MT5/BD sanen antes de rendirse
    |    (la conexión a MT5 del bridge es perezosa: tarda un poco en volver tras el boot).
    */
    /*
    |--------------------------------------------------------------------------
    | Bot en vivo — epoch (PnL de vida / historial de cierres)
    |--------------------------------------------------------------------------
    | Fecha desde la que se agregan los deals de MT5 por magic del bot
    | (770000-869999) para el PnL total de vida y la pestaña Trades. 2026-06-25 =
    | primer deal real del bot en esta cuenta demo (e2e Fase 7). La fuente
    | canónica es el HISTORIAL DEL BRÓKER (history_deals), no el journal ni la BD.
    */
    'bot' => [
        'epoch' => env('BOT_EPOCH', '2026-06-25'),
    ],

    'autoresume' => [
        'enabled' => (bool) env('AUTORESUME_ENABLED', true),
        'loop_window_min' => (int) env('AUTORESUME_LOOP_WINDOW_MIN', 10),
        'loop_max_boots' => (int) env('AUTORESUME_LOOP_MAX_BOOTS', 3),
        'grace_min' => (int) env('AUTORESUME_GRACE_MIN', 10),
    ],

    'anthropic' => [
        'api_key' => env('ANTHROPIC_API_KEY', ''),
        'model' => env('ANTHROPIC_MODEL', 'claude-sonnet-4-6'),
        // Precio USD por 1M de tokens (para estimar el coste del modo API).
        // claude-sonnet-4-6: $3 input / $15 output.
        'price_input_per_mtok' => (float) env('ANTHROPIC_PRICE_INPUT', 3.0),
        'price_output_per_mtok' => (float) env('ANTHROPIC_PRICE_OUTPUT', 15.0),
    ],

];
