<?php

namespace App\Http\Controllers;

use App\Http\Requests\StrategyRequest;
use App\Models\ExploreSearch;
use App\Services\BridgeException;
use App\Services\ManualTuningService;
use App\Services\PythonBridgeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;
use Throwable;

/**
 * Buscador automático de estrategias (Fase 8E).
 *
 * Barre pares × tipos × timeframes × parámetros × SL/TP × riesgo, valida cada
 * configuración out-of-sample (reusa el motor de la Fase 8) y entrega un reporte
 * ordenable. El cómputo corre en el bridge en segundo plano: este controlador
 * solo arranca, sondea progreso, trae resultados y cancela.
 *
 * ADVERTENCIA de diseño (anti data-mining): el reporte ordena por robustez por
 * defecto, nunca por retorno; no oculta out-of-sample ni costos. Nada opera en
 * vivo: llevar una estrategia al bot sigue siendo decisión manual del usuario.
 */
class ExplorerController extends Controller
{
    /** Fallback si el bridge está caído al renderizar la página. */
    private const META_FALLBACK = [
        'grid_sizes' => ['ma_cross' => 30, 'rsi' => 27, 'macd' => 9, 'bollinger' => 9, 'combined' => 8],
        'sl_choices' => [15, 20, 30, 50],
        'tp_choices' => [30, 40, 60, 100],
        'risk_choices' => [0.5, 1.0, 2.0],
        'sweep_timeframes' => ['M5', 'M15', 'H1', 'H4'],
        'max_configs' => 60000,
    ];

    public function __construct(
        private readonly PythonBridgeService $bridge,
        private readonly ManualTuningService $manual,
    ) {}

    public function show(): Response
    {
        return Inertia::render('Explorer', [
            'schemas' => $this->safe(fn () => $this->manual->schemas(), []),
            'symbols' => $this->safe(fn () => $this->bridge->tradableSymbolNames(), []),
            'timeframes' => StrategyRequest::TIMEFRAMES,
            'types' => StrategyRequest::TYPES,
            'meta' => $this->safe(fn () => $this->bridge->exploreMeta(), self::META_FALLBACK),
            'defaultPeriod' => [
                'date_from' => now()->subMonths(6)->toDateString(),
                'date_to' => now()->toDateString(),
            ],
            'savedSearches' => ExploreSearch::query()
                ->latest()
                ->get(['id', 'name', 'total', 'inside', 'created_at']),
        ]);
    }

    public function start(Request $request): JsonResponse
    {
        $data = $request->validate([
            'pairs' => ['required', 'array', 'min:1'],
            'pairs.*' => ['required', 'string', 'max:20'],
            'types' => ['required', 'array', 'min:1'],
            'types.*' => [Rule::in(StrategyRequest::TYPES)],
            'timeframes' => ['required', 'array', 'min:1'],
            'timeframes.*' => [Rule::in(StrategyRequest::TIMEFRAMES)],
            'date_from' => ['required', 'date'],
            'date_to' => ['required', 'date', 'after_or_equal:date_from'],
            'capital' => ['required', 'numeric', 'min:1'],
            'sl_choices' => ['required', 'array', 'min:1'],
            'sl_choices.*' => ['numeric', 'min:0'],
            'tp_choices' => ['required', 'array', 'min:1'],
            'tp_choices.*' => ['numeric', 'min:0'],
            'risk_choices' => ['required', 'array', 'min:1'],
            'risk_choices.*' => ['numeric', 'min:0.1', 'max:100'],
            'workers' => ['nullable', 'integer', 'min:1', 'max:64'],
        ]);

        $payload = [
            'pairs' => array_map(fn ($p) => strtoupper($p), $data['pairs']),
            'types' => array_values($data['types']),
            'timeframes' => array_values($data['timeframes']),
            'from' => Carbon::parse($data['date_from'])->toIso8601String(),
            'to' => Carbon::parse($data['date_to'])->toIso8601String(),
            'capital' => (float) $data['capital'],
            'sl_choices' => array_map('floatval', $data['sl_choices']),
            'tp_choices' => array_map('floatval', $data['tp_choices']),
            'risk_choices' => array_map('floatval', $data['risk_choices']),
            'workers' => isset($data['workers']) ? (int) $data['workers'] : null,
        ];

        return $this->proxy(fn () => $this->bridge->exploreStart($payload));
    }

    public function systemStats(): JsonResponse
    {
        return $this->proxy(fn () => $this->bridge->systemStats());
    }

    // --- Búsquedas guardadas (Parte 2) ----------------------------------
    public function saveSearch(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:160'],
            'config' => ['required', 'array'],
            'results' => ['required', 'array'],
            'total' => ['nullable', 'integer', 'min:0'],
            'inside' => ['nullable', 'integer', 'min:0'],
        ]);

        $search = ExploreSearch::create([
            'name' => $data['name'],
            'config' => $data['config'],
            'results' => $data['results'],
            'total' => $data['total'] ?? count($data['results']),
            'inside' => $data['inside'] ?? 0,
        ]);

        return response()->json([
            'id' => $search->id, 'name' => $search->name,
            'total' => $search->total, 'inside' => $search->inside,
            'created_at' => $search->created_at,
        ]);
    }

    /** Devuelve una búsqueda guardada con su reporte completo (para reabrirla). */
    public function showSearch(ExploreSearch $search): JsonResponse
    {
        return response()->json([
            'id' => $search->id,
            'name' => $search->name,
            'config' => $search->config,
            'results' => $search->results,
        ]);
    }

    public function deleteSearch(ExploreSearch $search): JsonResponse
    {
        $search->delete();
        return response()->json(['ok' => true]);
    }

    public function status(): JsonResponse
    {
        return $this->proxy(fn () => $this->bridge->exploreStatus());
    }

    public function results(): JsonResponse
    {
        return $this->proxy(fn () => $this->bridge->exploreResults());
    }

    public function cancel(): JsonResponse
    {
        return $this->proxy(fn () => $this->bridge->exploreCancel());
    }

    /** Ejecuta una llamada al bridge devolviendo JSON y traduciendo errores. */
    private function proxy(callable $fn): JsonResponse
    {
        try {
            return response()->json($fn());
        } catch (BridgeException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        } catch (Throwable $e) {
            return response()->json(['error' => 'Bridge no accesible: ' . $e->getMessage()], 502);
        }
    }

    /** Como proxy pero devuelve un fallback en vez de error (para render inicial). */
    private function safe(callable $fn, mixed $fallback): mixed
    {
        try {
            return $fn();
        } catch (Throwable) {
            return $fallback;
        }
    }
}
