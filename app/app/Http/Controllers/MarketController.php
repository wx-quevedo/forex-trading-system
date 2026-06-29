<?php

namespace App\Http\Controllers;

use App\Services\BridgeException;
use App\Services\PythonBridgeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

/**
 * Endpoints JSON consumidos por el frontend (axios) para refrescar charts,
 * precios y posiciones sin recargar la página Inertia.
 */
class MarketController extends Controller
{
    public function __construct(private readonly PythonBridgeService $bridge) {}

    public function candles(Request $request, string $symbol): JsonResponse
    {
        $validated = $request->validate([
            'timeframe' => ['nullable', 'string'],
            'count' => ['nullable', 'integer', 'min:1', 'max:5000'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
        ]);

        $query = ['timeframe' => strtoupper($validated['timeframe'] ?? 'H1')];
        if (! empty($validated['from'])) {
            // Ventana temporal explícita (p.ej. detalle de un trade).
            $query['from'] = \Illuminate\Support\Carbon::parse($validated['from'])->toIso8601String();
            $query['to'] = \Illuminate\Support\Carbon::parse($validated['to'] ?? 'now')->toIso8601String();
        } else {
            $query['count'] = $validated['count'] ?? 300;
        }

        return $this->safe(fn () => $this->bridge->candles(strtoupper($symbol), $query));
    }

    public function price(string $symbol): JsonResponse
    {
        return $this->safe(fn () => $this->bridge->price(strtoupper($symbol)));
    }

    /** Régimen de mercado del periodo (Fase 3): tendencia/rango/volátil + confianza. */
    public function regime(Request $request, string $symbol): JsonResponse
    {
        $validated = $request->validate([
            'timeframe' => ['nullable', 'string'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
        ]);
        $query = ['timeframe' => strtoupper($validated['timeframe'] ?? 'H1')];
        if (! empty($validated['from'])) {
            $query['from'] = \Illuminate\Support\Carbon::parse($validated['from'])->toIso8601String();
            $query['to'] = \Illuminate\Support\Carbon::parse($validated['to'] ?? 'now')->toIso8601String();
        } else {
            $query['count'] = 400;
        }

        return $this->safe(fn () => $this->bridge->marketRegime(strtoupper($symbol), $query));
    }

    /** Calendario económico — eventos en un periodo (Fase 6, marcado/contexto). */
    public function calendarEvents(Request $request): JsonResponse
    {
        $v = $request->validate([
            'from' => ['required', 'date'],
            'to' => ['required', 'date'],
            'symbol' => ['nullable', 'string', 'max:20'],
            'impact' => ['nullable', 'string'],
        ]);
        $query = [
            'from' => \Illuminate\Support\Carbon::parse($v['from'])->toIso8601String(),
            'to' => \Illuminate\Support\Carbon::parse($v['to'])->toIso8601String(),
            'impact' => $v['impact'] ?? 'high',
        ];
        if (! empty($v['symbol'])) {
            $query['symbol'] = strtoupper($v['symbol']);
        }

        return $this->safe(fn () => $this->bridge->calendarEvents($query));
    }

    /** Calendario económico — próximos eventos del símbolo (Fase 6, defensa en vivo). */
    public function calendarUpcoming(Request $request): JsonResponse
    {
        $v = $request->validate([
            'symbol' => ['nullable', 'string', 'max:20'],
            'hours' => ['nullable', 'integer', 'min:1', 'max:336'],
            'impact' => ['nullable', 'string'],
        ]);
        $query = ['hours' => $v['hours'] ?? 48, 'impact' => $v['impact'] ?? 'high'];
        if (! empty($v['symbol'])) {
            $query['symbol'] = strtoupper($v['symbol']);
        }

        return $this->safe(fn () => $this->bridge->calendarUpcoming($query));
    }

    /** Matriz de correlación entre estrategias (Fase 7, análisis del Bot Histórico). */
    public function portfolioCorrelation(Request $request): JsonResponse
    {
        $v = $request->validate([
            'labels' => ['nullable', 'array'],
            'series' => ['required', 'array', 'min:2'],
            'series.*' => ['array'],
        ]);

        return $this->safe(fn () => $this->bridge->portfolioCorrelation([
            'labels' => $v['labels'] ?? [],
            'series' => $v['series'],
        ]));
    }

    public function symbol(string $symbol): JsonResponse
    {
        return $this->safe(fn () => $this->bridge->symbolInfo(strtoupper($symbol)));
    }

    public function session(string $symbol): JsonResponse
    {
        return $this->safe(fn () => $this->bridge->symbolSession(strtoupper($symbol)));
    }

    public function positions(): JsonResponse
    {
        return $this->safe(fn () => $this->bridge->positions());
    }

    /** Ejecuta una llamada al bridge y normaliza errores a JSON. */
    private function safe(callable $fn): JsonResponse
    {
        try {
            return response()->json(['data' => $fn()]);
        } catch (BridgeException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        } catch (Throwable $e) {
            return response()->json(['error' => 'Bridge no accesible: ' . $e->getMessage()], 502);
        }
    }
}
