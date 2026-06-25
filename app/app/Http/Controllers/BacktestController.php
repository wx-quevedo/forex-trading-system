<?php

namespace App\Http\Controllers;

use App\Jobs\RunBacktest;
use App\Models\Backtest;
use App\Models\Strategy;
use App\Services\PythonBridgeService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use Throwable;

class BacktestController extends Controller
{
    public function __construct(private readonly PythonBridgeService $bridge) {}

    public function index(): Response
    {
        $backtests = Backtest::with('strategy:id,name,pair,timeframe')
            ->orderByDesc('created_at')
            ->get();

        return Inertia::render('Backtests/Index', [
            'backtests' => $backtests,
        ]);
    }

    public function create(Request $request): Response
    {
        return Inertia::render('Backtests/Create', [
            'strategies' => Strategy::orderBy('name')->get(['id', 'name', 'pair', 'timeframe']),
            'selectedStrategyId' => $request->integer('strategy_id') ?: null,
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $data = $request->validate([
            'strategy_id' => ['required', 'exists:strategies,id'],
            'date_from' => ['required', 'date'],
            'date_to' => ['required', 'date', 'after_or_equal:date_from'],
        ]);

        $backtest = Backtest::create([
            'strategy_id' => $data['strategy_id'],
            'date_from' => $data['date_from'],
            'date_to' => $data['date_to'],
            'status' => 'pending',
        ]);

        // Ejecución asíncrona (Queue + Horizon en producción).
        RunBacktest::dispatch($backtest->id);

        return redirect()->route('backtests.show', $backtest)->with('success', 'Backtest encolado.');
    }

    public function show(Backtest $backtest): Response
    {
        $backtest->load('strategy');

        // Velas del rango para el chart con marcadores de trades (si el bridge responde).
        $candles = [];
        if ($backtest->status === 'completed') {
            try {
                $candles = $this->bridge->candles($backtest->strategy->pair, [
                    'timeframe' => $backtest->strategy->timeframe,
                    'from' => $backtest->date_from->toIso8601String(),
                    'to' => $backtest->date_to->toIso8601String(),
                ]);
            } catch (Throwable) {
                $candles = [];
            }
        }

        return Inertia::render('Backtests/Show', [
            'backtest' => $backtest,
            'candles' => $candles,
        ]);
    }

    public function destroy(Backtest $backtest): RedirectResponse
    {
        $backtest->delete();

        return redirect()->route('backtests.index')->with('success', 'Backtest eliminado.');
    }
}
