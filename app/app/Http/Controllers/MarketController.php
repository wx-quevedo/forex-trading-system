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
