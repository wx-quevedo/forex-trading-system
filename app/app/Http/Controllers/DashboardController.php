<?php

namespace App\Http\Controllers;

use App\Services\BridgeException;
use App\Services\PythonBridgeService;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use Throwable;

class DashboardController extends Controller
{
    public function __construct(private readonly PythonBridgeService $bridge) {}

    public function index(Request $request): Response
    {
        $symbol = strtoupper($request->query('symbol', 'EURUSD'));
        $timeframe = strtoupper($request->query('timeframe', 'H1'));

        $account = null;
        $positions = [];
        $candles = [];
        $symbols = [];
        $bridgeError = null;

        try {
            $account = $this->bridge->account();
            $positions = $this->bridge->positions();
            $candles = $this->bridge->candles($symbol, [
                'timeframe' => $timeframe,
                'count' => 300,
            ]);
            // Solo majors para no saturar el selector.
            $symbols = collect($this->bridge->symbols('*USD*'))
                ->pluck('name')
                ->take(40)
                ->values()
                ->all();
        } catch (BridgeException $e) {
            $bridgeError = $e->getMessage();
        } catch (Throwable $e) {
            $bridgeError = 'Bridge no accesible: ' . $e->getMessage();
        }

        return Inertia::render('Dashboard', [
            'account' => $account,
            'positions' => $positions,
            'candles' => $candles,
            'symbols' => $symbols,
            'symbol' => $symbol,
            'timeframe' => $timeframe,
            'bridgeError' => $bridgeError,
        ]);
    }
}
