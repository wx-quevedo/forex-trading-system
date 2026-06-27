<?php

namespace App\Http\Controllers;

use App\Http\Requests\StrategyRequest;
use App\Models\AiAnalysis;
use App\Models\Backtest;
use App\Models\Strategy;
use App\Services\BridgeException;
use App\Services\ClaudeService;
use App\Services\ManualTuningService;
use App\Services\PythonBridgeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;
use Throwable;

/**
 * Workbench de afinamiento (Fase 6C): estrategia + backtest + IA en una pantalla.
 * Re-corridas efímeras (no persisten), comparación de 3 corridas, y la IA rellena
 * el panel de parámetros en vez de crear versiones.
 */
class WorkbenchController extends Controller
{
    private const TIME_LIMIT = 180;

    public function __construct(
        private readonly PythonBridgeService $bridge,
        private readonly ClaudeService $claude,
        private readonly ManualTuningService $manual,
    ) {}

    public function show(Backtest $backtest): Response
    {
        $backtest->load('strategy');

        // Velas del rango para el chart (solo dependen de par/tf/periodo, no de los params).
        $candles = [];
        try {
            $candles = $this->bridge->candles($backtest->strategy->pair, [
                'timeframe' => $backtest->strategy->timeframe,
                'from' => $backtest->date_from->toIso8601String(),
                'to' => $backtest->date_to->toIso8601String(),
            ]);
        } catch (Throwable) {
            $candles = [];
        }

        return Inertia::render('Backtests/Workbench', [
            'backtest' => $backtest,
            'strategy' => $backtest->strategy,
            'schemas' => $this->manual->schemas(),
            'timeframes' => StrategyRequest::TIMEFRAMES,
            'candles' => $candles,
            'aiConfigured' => $this->claude->isConfigured(),
            'manualPrompt' => $this->manual->buildPrompt($backtest),
        ]);
    }

    /** Corrida efímera: corre el backtest en el bridge y devuelve el resultado SIN persistir. */
    public function ephemeral(Request $request): JsonResponse
    {
        $data = $request->validate([
            'strategy_type' => ['required', Rule::in(StrategyRequest::TYPES)],
            'pair' => ['required', 'string', 'max:20'],
            'timeframe' => ['required', Rule::in(StrategyRequest::TIMEFRAMES)],
            'date_from' => ['required', 'date'],
            'date_to' => ['required', 'date', 'after_or_equal:date_from'],
            'indicators' => ['array'],
            'risk' => ['array'],
            'initial_balance' => ['nullable', 'numeric', 'min:1'],
        ]);

        if ($err = $this->validateAgainstSchema($data['strategy_type'], $data['indicators'] ?? [])) {
            return response()->json(['error' => $err], 422);
        }

        set_time_limit(self::TIME_LIMIT);

        try {
            $result = $this->bridge->runBacktest(
                type: $data['strategy_type'],
                params: $data['indicators'] ?? [],
                symbol: strtoupper($data['pair']),
                timeframe: $data['timeframe'],
                from: \Illuminate\Support\Carbon::parse($data['date_from'])->toIso8601String(),
                to: \Illuminate\Support\Carbon::parse($data['date_to'])->toIso8601String(),
                risk: $data['risk'] ?? [],
                config: ! empty($data['initial_balance']) ? ['initial_balance' => (float) $data['initial_balance']] : [],
            );
        } catch (BridgeException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        } catch (Throwable $e) {
            return response()->json(['error' => 'Bridge no accesible: ' . $e->getMessage()], 502);
        }

        return response()->json([
            'metrics' => $result['metrics'] ?? null,
            'trades' => $result['trades'] ?? [],
            'equity_curve' => $result['equity_curve'] ?? [],
        ]);
    }

    /**
     * Optimización automática anti-overfitting: barre parámetros y devuelve un
     * ranking por robustez (consistencia in-sample ↔ out-of-sample), NO por retorno.
     */
    public function optimize(Request $request): JsonResponse
    {
        $data = $request->validate([
            'strategy_type' => ['required', Rule::in(StrategyRequest::TYPES)],
            'pair' => ['required', 'string', 'max:20'],
            'timeframe' => ['required', Rule::in(StrategyRequest::TIMEFRAMES)],
            'date_from' => ['required', 'date'],
            'date_to' => ['required', 'date', 'after_or_equal:date_from'],
            'indicators' => ['array'],
            'risk' => ['array'],
            'initial_balance' => ['nullable', 'numeric', 'min:1'],
        ]);

        set_time_limit(300);

        try {
            $result = $this->bridge->optimize(
                $data['strategy_type'],
                $data['indicators'] ?? [],
                strtoupper($data['pair']),
                $data['timeframe'],
                \Illuminate\Support\Carbon::parse($data['date_from'])->toIso8601String(),
                \Illuminate\Support\Carbon::parse($data['date_to'])->toIso8601String(),
                $data['risk'] ?? [],
                config: ! empty($data['initial_balance']) ? ['initial_balance' => (float) $data['initial_balance']] : [],
            );
        } catch (BridgeException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        } catch (Throwable $e) {
            return response()->json(['error' => 'Bridge no accesible: ' . $e->getMessage()], 502);
        }

        return response()->json($result);
    }

    /** Guarda los parámetros del panel como nueva versión; opcionalmente persiste la corrida actual. */
    public function saveVersion(Request $request, Strategy $strategy): RedirectResponse
    {
        $data = $request->validate([
            'indicators' => ['required', 'array'],
            'risk' => ['array'],
            'date_from' => ['required', 'date'],
            'date_to' => ['required', 'date', 'after_or_equal:date_from'],
            'persist_run' => ['boolean'],
            'run' => ['array'],
        ]);

        if ($err = $this->validateAgainstSchema($strategy->parameters['type'] ?? 'ma_cross', $data['indicators'])) {
            return back()->with('error', $err);
        }

        $rootId = $strategy->parent_id ?? $strategy->id;
        $nextVersion = Strategy::where('id', $rootId)->orWhere('parent_id', $rootId)->max('version') + 1;

        $params = $strategy->parameters ?? [];
        $params['indicators'] = array_merge($params['indicators'] ?? [], $data['indicators']);
        $params['risk'] = array_merge($params['risk'] ?? [], $data['risk'] ?? []);

        $new = Strategy::create([
            'name' => $strategy->name,
            'description' => trim(($strategy->description ? $strategy->description . ' · ' : '') . 'Afinada en workbench'),
            'pair' => $strategy->pair,
            'timeframe' => $strategy->timeframe,
            'parameters' => $params,
            'version' => $nextVersion,
            'parent_id' => $rootId,
            'is_active' => false,
        ]);

        // Opción: persistir la corrida actual como backtest ligado a la nueva versión.
        if (($data['persist_run'] ?? false) && ! empty($data['run'])) {
            $run = $data['run'];
            Backtest::create([
                'strategy_id' => $new->id,
                'date_from' => $data['date_from'],
                'date_to' => $data['date_to'],
                'status' => 'completed',
                'result_metrics' => $run['metrics'] ?? null,
                'result_trades' => $run['trades'] ?? null,
                'result_equity_curve' => $run['equity_curve'] ?? null,
            ]);
        }

        return redirect()->route('strategies.show', $new)
            ->with('success', "Guardada como v{$nextVersion}.");
    }

    /** Prompt manual generado con los parámetros editados en vivo + métricas de la corrida actual. */
    public function manualPrompt(Request $request, Backtest $backtest): JsonResponse
    {
        $data = $request->validate([
            'indicators' => ['array'],
            'metrics' => ['array'],
        ]);
        $strategy = $backtest->strategy;

        $prompt = $this->manual->buildPromptFromState(
            name: $strategy->name,
            type: $strategy->parameters['type'] ?? 'ma_cross',
            pair: $strategy->pair,
            timeframe: $strategy->timeframe,
            indicators: $data['indicators'] ?? ($strategy->parameters['indicators'] ?? []),
            metrics: $data['metrics'] ?? ($backtest->result_metrics ?? []),
            from: $backtest->date_from->toDateString(),
            to: $backtest->date_to->toDateString(),
        );

        return response()->json(['prompt' => $prompt]);
    }

    /** Chat API del workbench: analiza el estado en vivo y persiste el análisis (mode=api). */
    public function analyze(Request $request, Backtest $backtest): JsonResponse
    {
        $data = $request->validate([
            'message' => ['required', 'string', 'max:2000'],
            'indicators' => ['array'],
            'risk' => ['array'],
            'metrics' => ['array'],
        ]);
        if (! $this->claude->isConfigured()) {
            return response()->json(['error' => 'El modo API no está configurado (ANTHROPIC_API_KEY).'], 422);
        }

        $strategy = $backtest->strategy;
        $context = [
            'estrategia' => [
                'nombre' => $strategy->name,
                'tipo' => $strategy->parameters['type'] ?? null,
                'par' => $strategy->pair,
                'timeframe' => $strategy->timeframe,
                'parametros' => $data['indicators'] ?? ($strategy->parameters['indicators'] ?? []),
                'riesgo' => $data['risk'] ?? ($strategy->parameters['risk'] ?? []),
            ],
            'backtest' => [
                'periodo' => $backtest->date_from->toDateString() . ' / ' . $backtest->date_to->toDateString(),
                'metricas' => $data['metrics'] ?? ($backtest->result_metrics ?? []),
                'nota' => 'Esta es una corrida de afinamiento en vivo (parámetros editados).',
            ],
        ];

        set_time_limit(self::TIME_LIMIT);

        try {
            $result = $this->claude->analyze($context, [], $data['message']);
        } catch (Throwable $e) {
            return response()->json(['error' => $e->getMessage()], 502);
        }

        $in = $result['usage']['input_tokens'] ?? null;
        $out = $result['usage']['output_tokens'] ?? null;
        $pi = (float) config('forexbot.anthropic.price_input_per_mtok', 3.0);
        $po = (float) config('forexbot.anthropic.price_output_per_mtok', 15.0);

        $analysis = AiAnalysis::create([
            'backtest_id' => $backtest->id,
            'prompt' => $data['message'],
            'response' => $result['text'],
            'model' => $result['model'],
            'mode' => 'api',
            'input_tokens' => $in,
            'output_tokens' => $out,
            'estimated_cost_usd' => round(($in ?? 0) / 1e6 * $pi + ($out ?? 0) / 1e6 * $po, 6),
            'suggested_parameters' => $result['suggested_parameters'],
        ]);

        return response()->json(['analysis' => $analysis]);
    }

    /** Valida un mapa de indicadores contra el esquema del tipo (rangos/options). */
    private function validateAgainstSchema(string $type, array $indicators): ?string
    {
        $schema = $this->manual->schemaFor($type);
        if (! $schema) {
            return null; // sin esquema (bridge caído) no bloqueamos; el motor usa defaults.
        }
        $fields = [];
        foreach (($schema['fields'] ?? []) as $f) {
            $fields[$f['name']] = $f;
        }
        foreach ($indicators as $key => $value) {
            $f = $fields[$key] ?? null;
            if (! $f) {
                return "Parámetro no válido para el tipo '{$type}': '{$key}'.";
            }
            if (($f['type'] ?? 'number') === 'select') {
                $opts = array_column($f['options'] ?? [], 'value');
                if (! in_array($value, $opts, true)) {
                    return "Valor inválido para '{$key}'.";
                }
            } else {
                if (! is_numeric($value)) {
                    return "El parámetro '{$key}' debe ser numérico.";
                }
                if (isset($f['min']) && $value < $f['min']) {
                    return "'{$key}' por debajo del mínimo ({$f['min']}).";
                }
                if (isset($f['max']) && $value > $f['max']) {
                    return "'{$key}' supera el máximo ({$f['max']}).";
                }
            }
        }

        return null;
    }
}
