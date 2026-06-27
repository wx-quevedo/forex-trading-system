<?php

namespace App\Http\Controllers;

use App\Http\Requests\StrategyRequest;
use App\Models\Strategy;
use App\Services\ManualTuningService;
use App\Services\PythonBridgeService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;
use Throwable;

/**
 * Laboratorio de estrategias (Fase 8C): probar/optimizar ANTES de guardar.
 *
 * Flujo nuevo: el usuario experimenta (tipo/par/TF/parámetros) con backtests y
 * optimización EFÍMEROS (reusa /backtests/ephemeral y /backtests/optimize, que
 * no persisten nada) y solo al final pulsa "Guardar como estrategia".
 */
class LaboratoryController extends Controller
{
    public function __construct(
        private readonly PythonBridgeService $bridge,
        private readonly ManualTuningService $manual,
    ) {}

    public function show(Request $request): Response
    {
        $strategy = $request->integer('strategy') ? Strategy::find($request->integer('strategy')) : null;

        $preload = null;
        if ($strategy) {
            $p = $strategy->parameters ?? [];
            $preload = [
                'from_strategy_id' => $strategy->id,
                'name' => $strategy->name,
                'description' => $strategy->description,
                'type' => $p['type'] ?? 'ma_cross',
                'pair' => $strategy->pair,
                'timeframe' => $strategy->timeframe,
                'indicators' => $p['indicators'] ?? [],
                'risk' => $p['risk'] ?? [],
            ];
        }

        return Inertia::render('Laboratory', [
            'schemas' => $this->manual->schemas(),
            'timeframes' => StrategyRequest::TIMEFRAMES,
            'symbols' => $this->symbols(),
            'preload' => $preload,
            'defaultPeriod' => [
                'date_from' => now()->subMonths(6)->toDateString(),
                'date_to' => now()->toDateString(),
            ],
        ]);
    }

    /** Guarda lo validado en el laboratorio: estrategia nueva o nueva versión. */
    public function save(Request $request): RedirectResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'description' => ['nullable', 'string', 'max:1000'],
            'type' => ['required', Rule::in(StrategyRequest::TYPES)],
            'pair' => ['required', 'string', 'max:20'],
            'timeframe' => ['required', Rule::in(StrategyRequest::TIMEFRAMES)],
            'indicators' => ['array'],
            'risk' => ['array'],
            'from_strategy_id' => ['nullable', 'exists:strategies,id'],
        ]);

        $parameters = [
            'type' => $data['type'],
            'indicators' => $data['indicators'] ?? [],
            'risk' => $data['risk'] ?? [],
        ];

        $base = [
            'name' => $data['name'],
            'description' => $data['description'] ?? null,
            'pair' => strtoupper($data['pair']),
            'timeframe' => $data['timeframe'],
            'parameters' => $parameters,
            'is_active' => false,
        ];

        if (! empty($data['from_strategy_id'])) {
            // Nueva versión de una familia existente (mantiene el versionado).
            $parent = Strategy::findOrFail($data['from_strategy_id']);
            $rootId = $parent->parent_id ?? $parent->id;
            $nextVersion = Strategy::where('id', $rootId)->orWhere('parent_id', $rootId)->max('version') + 1;
            $strategy = Strategy::create([...$base, 'version' => $nextVersion, 'parent_id' => $rootId]);
            $msg = "Versión {$nextVersion} creada desde el laboratorio.";
        } else {
            $strategy = Strategy::create([...$base, 'version' => 1]);
            $msg = 'Estrategia creada desde el laboratorio.';
        }

        return redirect()->route('strategies.show', $strategy)->with('success', $msg);
    }

    private function symbols(): array
    {
        try {
            return $this->bridge->tradableSymbolNames();
        } catch (Throwable) {
            return [];
        }
    }
}
