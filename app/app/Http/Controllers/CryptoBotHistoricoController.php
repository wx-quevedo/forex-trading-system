<?php

namespace App\Http\Controllers;

use App\Http\Requests\StrategyRequest;
use App\Models\Favorite;
use App\Services\BridgeException;
use App\Services\PythonBridgeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;
use Throwable;

/**
 * Bot Histórico CRIPTO (Fase 2b-vii) — la MISMA página React que el forex, otro bridge.
 *
 * Es SIMULACIÓN DE SEGUIMIENTO (walk-forward continuo), no operación en vivo: el mismo
 * rol de detector de degradación que el veredicto SE DEGRADA cumplió en forex. Carga
 * SOLO favoritos market='crypto' y enruta los 4 proxies que la vista usa (efímero,
 * correlación, régimen, velas) al bridge Bybit :8001 — cuyo /backtest/run devuelve
 * métricas NETAS en top-level (fees + funding real + slippage; el espejismo del bruto
 * no puede entrar por aquí). El /bot-historico forex NO se toca: sigue filtrando
 * market='forex' contra el bridge MT5.
 *
 * Formas de respuesta espejadas de los proxies forex (la página no distingue backend):
 *  - ephemeral → {metrics, trades, equity_curve} plano (como WorkbenchController).
 *  - correlation/regime/candles → {data: ...} (como MarketController::safe).
 */
class CryptoBotHistoricoController extends Controller
{
    /** La simulación corre backtests reales en el bridge: mismo margen que el Workbench. */
    private const TIME_LIMIT = 180;

    private readonly PythonBridgeService $bridge;

    public function __construct()
    {
        $this->bridge = PythonBridgeService::forMarket('crypto');
    }

    public function show(): Response
    {
        return Inertia::render('BotHistorico', [
            'market' => 'crypto',
            'favorites' => Favorite::query()->where('market', 'crypto')->latest()->get(),
            'defaultOperation' => [
                'date_from' => '2026-01-01',
                'date_to' => now()->toDateString(),
            ],
        ]);
    }

    /** Simulación efímera NETA por el bridge cripto (espejo de WorkbenchController::ephemeral). */
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

        set_time_limit(self::TIME_LIMIT);

        try {
            // El /backtest/run de cbot ya devuelve el NETO en metrics/trades/equity_curve
            // (bruto aparte en "gross"): extraer el top-level ES extraer el neto.
            $result = $this->bridge->runBacktest(
                type: $data['strategy_type'],
                params: $data['indicators'] ?? [],
                symbol: strtoupper($data['pair']),
                timeframe: $data['timeframe'],
                from: Carbon::parse($data['date_from'])->toIso8601String(),
                to: Carbon::parse($data['date_to'])->toIso8601String(),
                risk: $data['risk'] ?? [],
                config: ! empty($data['initial_balance']) ? ['initial_balance' => (float) $data['initial_balance']] : [],
            );
        } catch (BridgeException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        } catch (Throwable $e) {
            return response()->json(['error' => 'Bridge cripto no accesible: ' . $e->getMessage()], 502);
        }

        return response()->json([
            'metrics' => $result['metrics'] ?? null,
            'trades' => $result['trades'] ?? [],
            'equity_curve' => $result['equity_curve'] ?? [],
            'costs' => $result['costs'] ?? null,   // desglose fees/funding/slippage (informativo)
        ]);
    }

    /** Matriz de correlación (matemática pura en el bridge cripto). */
    public function correlation(Request $request): JsonResponse
    {
        $data = $request->validate([
            'labels' => ['array'],
            'series' => ['required', 'array'],
        ]);

        return $this->safe(fn () => $this->bridge->portfolioCorrelation([
            'labels' => $data['labels'] ?? [],
            'series' => $data['series'],
        ]));
    }

    /** Régimen del periodo de operación (espejo de MarketController::regime). */
    public function regime(Request $request, string $symbol): JsonResponse
    {
        $validated = $request->validate([
            'timeframe' => ['nullable', 'string'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
        ]);
        $query = ['timeframe' => strtoupper($validated['timeframe'] ?? 'H4')];
        if (! empty($validated['from'])) {
            $query['from'] = Carbon::parse($validated['from'])->toIso8601String();
            $query['to'] = Carbon::parse($validated['to'] ?? 'now')->toIso8601String();
        } else {
            $query['count'] = 400;
        }

        return $this->safe(fn () => $this->bridge->marketRegime(strtoupper($symbol), $query));
    }

    /** Velas para la gráfica de trading (espejo de MarketController::candles). */
    public function candles(Request $request, string $symbol): JsonResponse
    {
        $validated = $request->validate([
            'timeframe' => ['nullable', 'string'],
            'count' => ['nullable', 'integer', 'min:1', 'max:5000'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
        ]);
        $query = ['timeframe' => strtoupper($validated['timeframe'] ?? 'H4')];
        if (! empty($validated['from'])) {
            $query['from'] = Carbon::parse($validated['from'])->toIso8601String();
            $query['to'] = Carbon::parse($validated['to'] ?? 'now')->toIso8601String();
        } else {
            $query['count'] = $validated['count'] ?? 300;
        }

        return $this->safe(fn () => $this->bridge->candles(strtoupper($symbol), $query));
    }

    /** Envuelve como MarketController::safe ({data: ...}) para que la página no distinga backend. */
    private function safe(callable $fn): JsonResponse
    {
        try {
            return response()->json(['data' => $fn()]);
        } catch (BridgeException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        } catch (Throwable $e) {
            return response()->json(['error' => 'Bridge cripto no accesible: ' . $e->getMessage()], 502);
        }
    }
}
