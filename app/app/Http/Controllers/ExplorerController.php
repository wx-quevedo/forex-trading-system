<?php

namespace App\Http\Controllers;

use App\Http\Requests\StrategyRequest;
use App\Models\ExploreSearch;
use App\Models\Setting;
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
        'max_configs' => 200000,
        'warn_configs' => 20000,
        'cpu_count' => 8,
        'default_workers' => 6,
        'engine_version' => 4,
        'cache' => ['entries' => 0, 'size_mb' => 0, 'size_bytes' => 0, 'engine_version' => 4, 'path' => ''],
        'atr_sl_choices' => [1.5, 2.0, 3.0],
        'atr_tp_choices' => [2.0, 3.0, 4.0],
        'atr_period_default' => 14,
        'atr_period_choices' => [7, 14, 21],
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
            'context' => Setting::analysisContext(),
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
            'sl_mode' => ['nullable', Rule::in(['fixed', 'atr'])],
            'atr_period' => ['nullable', 'integer', 'min:2', 'max:200'],
            'atr_periods' => ['nullable', 'array', 'min:1'],
            'atr_periods.*' => ['integer', 'min:2', 'max:200'],
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
            'sl_mode' => $data['sl_mode'] ?? 'fixed',
            'atr_period' => isset($data['atr_period']) ? (int) $data['atr_period'] : 14,
            'atr_periods' => isset($data['atr_periods']) ? array_map('intval', $data['atr_periods']) : [14],
        ];

        return $this->proxy(fn () => $this->bridge->exploreStart($payload));
    }

    public function systemStats(): JsonResponse
    {
        return $this->proxy(fn () => $this->bridge->systemStats());
    }

    // --- Mapa de cobertura (Fase 8F) ------------------------------------
    public function coverageMap(): Response
    {
        return Inertia::render('CoverageMap', [
            'schemas' => $this->safe(fn () => $this->manual->schemas(), []),
            'symbols' => $this->safe(fn () => $this->bridge->tradableSymbolNames(), []),
            'meta' => $this->safe(fn () => $this->bridge->exploreMeta(), self::META_FALLBACK),
            'context' => Setting::analysisContext(),
        ]);
    }

    public function coverage(Request $request): JsonResponse
    {
        $data = $request->validate([
            'date_from' => ['required', 'date'],
            'date_to' => ['required', 'date'],
            'capital' => ['required', 'numeric', 'min:1'],
            'path' => ['nullable', 'string'],
            'pairs' => ['nullable', 'string'],
        ]);

        return $this->proxy(fn () => $this->bridge->exploreCoverage([
            'date_from' => Carbon::parse($data['date_from'])->toIso8601String(),
            'date_to' => Carbon::parse($data['date_to'])->toIso8601String(),
            'capital' => (float) $data['capital'],
            'path' => $data['path'] ?? '',
            'pairs' => $data['pairs'] ?? '',
        ]));
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

    public function results(): \Illuminate\Http\Response|JsonResponse
    {
        // Devuelve el JSON CRUDO del bridge sin decodificarlo a array PHP: el reporte
        // puede pesar decenas de MB y materializarlo + re-serializarlo agota la memoria.
        try {
            return response($this->bridge->exploreResultsRaw(), 200)
                ->header('Content-Type', 'application/json');
        } catch (BridgeException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'Bridge no accesible: ' . $e->getMessage()], 502);
        }
    }

    /** Desglose del score de Prioridad de una fila (on-demand para la modal A3). */
    public function score(Request $request): JsonResponse
    {
        $data = $request->validate([
            'row' => ['required', 'array'],
            'period_days' => ['nullable', 'numeric', 'min:1'],
        ]);

        return $this->proxy(fn () => $this->bridge->exploreScore([
            'row' => $data['row'],
            'period_days' => (float) ($data['period_days'] ?? 365),
        ]));
    }

    /**
     * Validación walk-forward del top-N en el rango de validación del Contexto
     * (posterior y SIN solape con la optimización → datos que el Explorador no vio).
     * Recibe las filas top-N (config exacta) y devuelve las métricas logradas.
     */
    public function validate(Request $request): JsonResponse
    {
        $data = $request->validate([
            'rows' => ['required', 'array', 'min:1', 'max:200'],
            'rows.*' => ['array'],
        ]);

        $ctx = Setting::analysisContext();

        // Defensa en profundidad: el rango de validación NO debe solapar la optimización.
        // (La UI ya lo bloquea, pero el backend lo reafirma: el data leakage es grave.)
        if ($ctx['val_date_from'] < $ctx['date_to']) {
            return response()->json([
                'error' => 'El rango de validación solapa con el de optimización. Ajusta el Contexto antes de validar.',
            ], 422);
        }

        return $this->proxy(fn () => $this->bridge->exploreValidate([
            'rows' => array_values($data['rows']),
            'val_from' => Carbon::parse($ctx['val_date_from'])->toIso8601String(),
            'val_to' => Carbon::parse($ctx['val_date_to'])->toIso8601String(),
            'capital' => (float) $ctx['capital'],
        ]));
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
