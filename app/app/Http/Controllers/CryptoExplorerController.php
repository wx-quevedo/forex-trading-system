<?php

namespace App\Http\Controllers;

use App\Http\Requests\StrategyRequest;
use App\Services\ManualTuningService;
use App\Services\PythonBridgeService;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Explorador CRIPTO (Fase 2b-ii) — la MISMA página React que el forex, otro bridge.
 *
 * Hereda TODOS los endpoints proxy del ExplorerController (start/status/results/
 * score/cancel funcionan idénticos); lo único que cambia es el bridge inyectado
 * (Bybit :8001, solo lectura) y las props del render: market='crypto', BTCUSDT como
 * único par v1, sin búsquedas guardadas/favoritos (pendiente columna `market`) y sin
 * "Validar top-N": la validación externa la sustituye el TERCER TRAMO HOLDOUT que el
 * bridge cripto integra en cada barrido (lección de la verificación 2b-i: sin holdout
 * el ranking selecciona suerte — cci prometía PF 1.401 en OOS y dio 0.751).
 *
 * El /explorer forex NO se toca: ruta, controlador y bridge distintos.
 */
class CryptoExplorerController extends ExplorerController
{
    public function __construct(ManualTuningService $manual)
    {
        parent::__construct(PythonBridgeService::forMarket('crypto'), $manual);
    }

    public function show(): Response
    {
        return Inertia::render('Explorer', [
            'market' => 'crypto',
            'schemas' => $this->safe(fn () => $this->manual->schemas(), []),
            // v1: un solo par. ETHUSDT y más vendrán para validar candidatas en otros pares.
            'symbols' => ['BTCUSDT'],
            'timeframes' => StrategyRequest::TIMEFRAMES,
            'types' => StrategyRequest::TYPES,
            'meta' => $this->safe(fn () => $this->bridge->exploreMeta(), self::META_FALLBACK),
            // Contexto PROPIO del barrido cripto (el Contexto global de Ajustes es forex).
            // El tercer tramo holdout se corta DENTRO del bridge (15% final del rango);
            // val_* solo mantienen la forma que espera el componente (validación oculta).
            'context' => [
                'date_from' => '2022-01-01',
                'date_to' => now()->toDateString(),
                'capital' => 10000,
                'val_date_from' => now()->toDateString(),
                'val_date_to' => now()->toDateString(),
            ],
            'savedSearches' => [],
        ]);
    }
}
