<?php

namespace App\Http\Controllers;

use App\Http\Requests\StrategyRequest;
use App\Models\Favorite;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Favoritos (Fase 9): marcar estrategias desde el Explorador/Laboratorio y
 * reutilizarlas en el Bot Histórico.
 */
class FavoriteController extends Controller
{
    public function index(): Response
    {
        return Inertia::render('Favorites', [
            'favorites' => Favorite::query()->latest()->get(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:160'],
            'source' => ['nullable', Rule::in(['explorer', 'lab'])],
            'pair' => ['required', 'string', 'max:20'],
            'type' => ['required', Rule::in(StrategyRequest::TYPES)],
            'timeframe' => ['required', Rule::in(StrategyRequest::TIMEFRAMES)],
            'params' => ['required', 'array'],
            'sl_pips' => ['nullable', 'numeric', 'min:0'],
            'tp_pips' => ['nullable', 'numeric', 'min:0'],
            'risk_percent' => ['nullable', 'numeric', 'min:0'],
            'capital' => ['required', 'numeric', 'min:1'],
            'backtest_from' => ['nullable', 'date'],
            'backtest_to' => ['nullable', 'date'],
            'backtest_metrics' => ['nullable', 'array'],
        ]);

        $fav = Favorite::create([
            'name' => $data['name'],
            'source' => $data['source'] ?? 'explorer',
            'pair' => strtoupper($data['pair']),
            'type' => $data['type'],
            'timeframe' => $data['timeframe'],
            'params' => $data['params'],
            'sl_pips' => $data['sl_pips'] ?? null,
            'tp_pips' => $data['tp_pips'] ?? null,
            'risk_percent' => $data['risk_percent'] ?? null,
            'capital' => (float) $data['capital'],
            'backtest_from' => $data['backtest_from'] ?? null,
            'backtest_to' => $data['backtest_to'] ?? null,
            'backtest_metrics' => $data['backtest_metrics'] ?? null,
        ]);

        return response()->json($fav);
    }

    public function destroy(Favorite $favorite): RedirectResponse
    {
        $favorite->delete();
        return back()->with('success', 'Favorito eliminado.');
    }
}
