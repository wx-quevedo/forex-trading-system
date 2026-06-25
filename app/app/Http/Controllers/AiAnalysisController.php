<?php

namespace App\Http\Controllers;

use App\Models\AiAnalysis;
use App\Models\Backtest;
use App\Models\Strategy;
use App\Services\ClaudeService;
use App\Services\ManualTuningService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Inertia\Inertia;
use Inertia\Response;
use Throwable;

class AiAnalysisController extends Controller
{
    /** Margen para la request de análisis API (s); supera el max_execution_time por defecto. */
    private const ANALYSIS_TIME_LIMIT = 180;

    public function __construct(
        private readonly ClaudeService $claude,
        private readonly ManualTuningService $manual,
    ) {}

    public function index(Backtest $backtest): Response
    {
        $backtest->load('strategy');

        return Inertia::render('Backtests/Analysis', [
            'backtest' => $backtest,
            'analyses' => $backtest->aiAnalyses()->oldest()->get(),
            'aiConfigured' => $this->claude->isConfigured(),
            // Prompt del modo manual + coste API acumulado del mes en curso.
            'manualPrompt' => $this->manual->buildPrompt($backtest),
            'costThisMonth' => round((float) AiAnalysis::where('mode', 'api')
                ->whereYear('created_at', now()->year)
                ->whereMonth('created_at', now()->month)
                ->sum('estimated_cost_usd'), 4),
        ]);
    }

    // --- Modo API (Fase 6) -----------------------------------------------
    public function store(Request $request, Backtest $backtest): JsonResponse
    {
        $data = $request->validate(['message' => ['required', 'string', 'max:2000']]);

        if (! $this->claude->isConfigured()) {
            return response()->json(['error' => 'El análisis IA no está configurado (ANTHROPIC_API_KEY).'], 422);
        }
        if ($backtest->status !== 'completed') {
            return response()->json(['error' => 'El backtest debe estar completado para analizarlo.'], 422);
        }

        $backtest->load('strategy');

        $history = [];
        foreach ($backtest->aiAnalyses()->where('mode', 'api')->oldest()->get() as $prev) {
            $history[] = ['role' => 'user', 'content' => $prev->prompt];
            $history[] = ['role' => 'assistant', 'content' => (string) $prev->response];
        }

        set_time_limit(self::ANALYSIS_TIME_LIMIT);

        try {
            $result = $this->claude->analyze($this->buildContext($backtest), $history, $data['message']);
        } catch (Throwable $e) {
            return response()->json(['error' => $e->getMessage()], 502);
        }

        $in = $result['usage']['input_tokens'] ?? null;
        $out = $result['usage']['output_tokens'] ?? null;

        $analysis = AiAnalysis::create([
            'backtest_id' => $backtest->id,
            'prompt' => $data['message'],
            'response' => $result['text'],
            'model' => $result['model'],
            'mode' => 'api',
            'input_tokens' => $in,
            'output_tokens' => $out,
            'estimated_cost_usd' => $this->estimateCost($in, $out),
            'suggested_parameters' => $result['suggested_parameters'],
        ]);

        return response()->json(['analysis' => $analysis]);
    }

    /** Aplica los parámetros sugeridos por la IA (modo API) como nueva versión. */
    public function apply(Backtest $backtest, AiAnalysis $analysis): RedirectResponse
    {
        abort_unless($analysis->backtest_id === $backtest->id, 404);

        $suggested = $analysis->suggested_parameters;
        if (! is_array($suggested) || $suggested === []) {
            return back()->with('error', 'Este análisis no contiene parámetros sugeridos.');
        }

        $strategy = $backtest->strategy;
        $indicators = Arr::only($suggested, array_keys($strategy->parameters['indicators'] ?? []));
        $new = $this->createVersion($strategy, $indicators, [], "Ajuste IA (backtest #{$backtest->id})");

        $analysis->update(['applied' => true, 'resulting_strategy_id' => $new->id]);

        return redirect()->route('strategies.show', $new)
            ->with('success', "Versión {$new->version} creada a partir de la sugerencia de la IA.");
    }

    // --- Modo Manual (Fase 6B copy-paste) --------------------------------
    public function manualPrompt(Backtest $backtest): JsonResponse
    {
        $backtest->load('strategy');

        return response()->json(['prompt' => $this->manual->buildPrompt($backtest)]);
    }

    /** Valida el JSON pegado y devuelve el diff (sin tocar la BD). */
    public function manualPreview(Request $request, Backtest $backtest): JsonResponse
    {
        $data = $request->validate(['json' => ['required', 'string']]);
        $backtest->load('strategy');

        $result = $this->manual->validate($backtest, $data['json']);
        if (! $result['ok']) {
            return response()->json(['ok' => false, 'errors' => $result['errors']], 422);
        }

        return response()->json([
            'ok' => true,
            'diff' => $this->manual->diff($backtest, $result['indicators'], $result['risk']),
            'indicators' => $result['indicators'],
            'risk' => $result['risk'],
            'diagnostico' => $result['parsed']['diagnostico'] ?? null,
            'justificacion' => $result['parsed']['justificacion'] ?? null,
            'confianza' => $result['parsed']['confianza'] ?? null,
        ]);
    }

    /** Aplica la sugerencia manual: crea nueva versión + registra el análisis (mode:manual). */
    public function manualApply(Request $request, Backtest $backtest): RedirectResponse
    {
        $data = $request->validate(['json' => ['required', 'string']]);
        $backtest->load('strategy');

        $result = $this->manual->validate($backtest, $data['json']);
        if (! $result['ok']) {
            return back()->with('error', 'JSON inválido: ' . implode(' ', $result['errors']));
        }

        $new = $this->createVersion(
            $backtest->strategy,
            $result['indicators'],
            $result['risk'],
            "Ajuste manual (backtest #{$backtest->id})",
        );

        $parsed = $result['parsed'];
        AiAnalysis::create([
            'backtest_id' => $backtest->id,
            'prompt' => 'Afinamiento manual (copy-paste)',
            'response' => trim(($parsed['diagnostico'] ?? '') . "\n\n" . ($parsed['justificacion'] ?? '')),
            'model' => 'claude.ai (manual)',
            'mode' => 'manual',
            'estimated_cost_usd' => 0,
            'suggested_parameters' => array_merge($result['indicators'], $result['risk']),
            'applied' => true,
            'resulting_strategy_id' => $new->id,
        ]);

        return redirect()->route('strategies.show', $new)
            ->with('success', "Versión {$new->version} creada a partir del afinamiento manual.");
    }

    // --- Helpers ---------------------------------------------------------
    /** Crea una nueva versión de la estrategia mergeando indicadores + riesgo. */
    private function createVersion(Strategy $strategy, array $indicators, array $risk, string $note): Strategy
    {
        $rootId = $strategy->parent_id ?? $strategy->id;
        $nextVersion = Strategy::where('id', $rootId)->orWhere('parent_id', $rootId)->max('version') + 1;

        $params = $strategy->parameters ?? [];
        $params['indicators'] = array_merge($params['indicators'] ?? [], $indicators);
        if ($risk !== []) {
            $params['risk'] = array_merge($params['risk'] ?? [], $risk);
        }

        return Strategy::create([
            'name' => $strategy->name,
            'description' => trim(($strategy->description ? $strategy->description . ' · ' : '') . $note),
            'pair' => $strategy->pair,
            'timeframe' => $strategy->timeframe,
            'parameters' => $params,
            'version' => $nextVersion,
            'parent_id' => $rootId,
            'is_active' => false,
        ]);
    }

    private function estimateCost(?int $in, ?int $out): ?float
    {
        if ($in === null && $out === null) {
            return null;
        }
        $pi = (float) config('forexbot.anthropic.price_input_per_mtok', 3.0);
        $po = (float) config('forexbot.anthropic.price_output_per_mtok', 15.0);

        return round(($in ?? 0) / 1_000_000 * $pi + ($out ?? 0) / 1_000_000 * $po, 6);
    }

    /** @return array<string, mixed> */
    private function buildContext(Backtest $backtest): array
    {
        $strategy = $backtest->strategy;
        $params = $strategy->parameters ?? [];
        $trades = $backtest->result_trades ?? [];
        $equity = $backtest->result_equity_curve ?? [];

        return [
            'estrategia' => [
                'nombre' => $strategy->name,
                'tipo' => $params['type'] ?? null,
                'par' => $strategy->pair,
                'timeframe' => $strategy->timeframe,
                'parametros' => $params['indicators'] ?? [],
                'riesgo' => $params['risk'] ?? [],
            ],
            'backtest' => [
                'periodo' => $backtest->date_from->toDateString() . ' / ' . $backtest->date_to->toDateString(),
                'metricas' => $backtest->result_metrics ?? [],
                'trades_total' => count($trades),
                'trades_muestra' => $this->sampleTrades($trades, 25),
                'equity_resumen' => $this->equitySummary($equity),
            ],
        ];
    }

    private function sampleTrades(array $trades, int $max): array
    {
        $n = count($trades);
        if ($n <= $max) {
            return $trades;
        }
        $step = (int) ceil($n / $max);

        return array_values(array_filter($trades, fn ($t, $i) => $i % $step === 0, ARRAY_FILTER_USE_BOTH));
    }

    private function equitySummary(array $equity): array
    {
        if ($equity === []) {
            return [];
        }
        $values = array_column($equity, 'equity');

        return [
            'inicial' => $values[0] ?? null,
            'final' => end($values) ?: null,
            'minimo' => $values ? min($values) : null,
            'maximo' => $values ? max($values) : null,
            'puntos' => count($values),
        ];
    }
}
