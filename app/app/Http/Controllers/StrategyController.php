<?php

namespace App\Http\Controllers;

use App\Http\Requests\StrategyRequest;
use App\Models\SignalLog;
use App\Models\Strategy;
use App\Services\BridgeException;
use App\Services\PythonBridgeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use Throwable;

class StrategyController extends Controller
{
    public function __construct(private readonly PythonBridgeService $bridge) {}

    public function index(): Response
    {
        $strategies = Strategy::query()
            ->withCount('versions')
            ->orderByDesc('created_at')
            ->get();

        return Inertia::render('Strategies/Index', [
            'strategies' => $strategies,
        ]);
    }

    public function create(): Response
    {
        return Inertia::render('Strategies/Form', [
            'strategy' => null,
            'schemas' => $this->strategyTypes(),
            'timeframes' => StrategyRequest::TIMEFRAMES,
            'symbols' => $this->symbols(),
        ]);
    }

    public function store(StrategyRequest $request): RedirectResponse
    {
        $strategy = Strategy::create([
            'name' => $request->string('name'),
            'description' => $request->input('description'),
            'pair' => strtoupper($request->string('pair')),
            'timeframe' => $request->string('timeframe'),
            'parameters' => $request->parameters(),
            'version' => 1,
            'is_active' => $request->boolean('is_active'),
        ]);

        return redirect()->route('strategies.show', $strategy)->with('success', 'Estrategia creada.');
    }

    public function show(Strategy $strategy): Response
    {
        $strategy->load('parent');

        return Inertia::render('Strategies/Show', [
            'strategy' => $strategy,
            'versions' => $this->versionHistory($strategy),
            'recentSignals' => $strategy->signalLogs()
                ->latest('evaluated_at')
                ->limit(20)
                ->get(),
        ]);
    }

    public function edit(Strategy $strategy): Response
    {
        return Inertia::render('Strategies/Form', [
            'strategy' => $strategy,
            'schemas' => $this->strategyTypes(),
            'timeframes' => StrategyRequest::TIMEFRAMES,
            'symbols' => $this->symbols(),
        ]);
    }

    public function update(StrategyRequest $request, Strategy $strategy): RedirectResponse
    {
        $strategy->update([
            'name' => $request->string('name'),
            'description' => $request->input('description'),
            'pair' => strtoupper($request->string('pair')),
            'timeframe' => $request->string('timeframe'),
            'parameters' => $request->parameters(),
            'is_active' => $request->boolean('is_active'),
        ]);

        return redirect()->route('strategies.show', $strategy)->with('success', 'Estrategia actualizada.');
    }

    /**
     * Versionado: crea una NUEVA estrategia (versión incrementada) que apunta a
     * la raíz de la familia, manteniendo el historial de parámetros.
     */
    public function version(StrategyRequest $request, Strategy $strategy): RedirectResponse
    {
        $rootId = $strategy->parent_id ?? $strategy->id;
        $nextVersion = Strategy::where('id', $rootId)
            ->orWhere('parent_id', $rootId)
            ->max('version') + 1;

        $new = Strategy::create([
            'name' => $request->string('name'),
            'description' => $request->input('description'),
            'pair' => strtoupper($request->string('pair')),
            'timeframe' => $request->string('timeframe'),
            'parameters' => $request->parameters(),
            'version' => $nextVersion,
            'parent_id' => $rootId,
            'is_active' => $request->boolean('is_active'),
        ]);

        return redirect()->route('strategies.show', $new)->with('success', "Versión {$nextVersion} creada.");
    }

    public function destroy(Strategy $strategy): RedirectResponse
    {
        $strategy->delete();

        return redirect()->route('strategies.index')->with('success', 'Estrategia eliminada.');
    }

    /**
     * Evaluación manual: corre la estrategia contra los datos actuales de MT5,
     * registra una señal en signal_logs y devuelve el resultado (JSON para axios).
     */
    public function evaluate(Request $request, Strategy $strategy): JsonResponse
    {
        $params = $strategy->parameters ?? [];
        $type = $params['type'] ?? null;

        if (! $type) {
            return response()->json(['error' => 'La estrategia no tiene un tipo definido.'], 422);
        }

        try {
            $result = $this->bridge->evaluateStrategy(
                $type,
                $params['indicators'] ?? [],
                $strategy->pair,
                $strategy->timeframe,
            );
        } catch (BridgeException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        } catch (Throwable $e) {
            return response()->json(['error' => 'Bridge no accesible: ' . $e->getMessage()], 502);
        }

        $signal = SignalLog::create([
            'strategy_id' => $strategy->id,
            'evaluated_at' => now(),
            'symbol' => $strategy->pair,
            'signal_type' => $result['signal'] ?? 'none',
            'executed' => false, // evaluación manual: no ejecuta órdenes
            'reason' => $result['reason'] ?? null,
            'indicator_values' => $result['indicators'] ?? [],
        ]);

        return response()->json(['result' => $result, 'signal' => $signal]);
    }

    // --- helpers ---------------------------------------------------------
    /** Schemas de tipos desde el bridge; vacío si no está accesible. */
    private function strategyTypes(): array
    {
        try {
            return $this->bridge->strategyTypes();
        } catch (Throwable) {
            return [];
        }
    }

    /** Símbolos operables del broker para el selector de par; vacío si el bridge no responde. */
    private function symbols(): array
    {
        try {
            return $this->bridge->tradableSymbolNames();
        } catch (Throwable) {
            return [];
        }
    }

    private function versionHistory(Strategy $strategy): \Illuminate\Support\Collection
    {
        $rootId = $strategy->parent_id ?? $strategy->id;

        return Strategy::where('id', $rootId)
            ->orWhere('parent_id', $rootId)
            ->orderBy('version')
            ->get(['id', 'name', 'version', 'is_active', 'created_at']);
    }
}
