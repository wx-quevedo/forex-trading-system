<?php

namespace App\Http\Controllers;

use App\Models\BotRun;
use App\Models\Strategy;
use App\Models\Trade;
use App\Services\BotService;
use App\Services\BridgeException;
use App\Services\PythonBridgeService;
use App\Services\TelegramNotifier;
use App\Http\Requests\StrategyRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;
use Throwable;

class BotController extends Controller
{
    public function __construct(
        private readonly PythonBridgeService $bridge,
        private readonly BotService $bot,
        private readonly TelegramNotifier $telegram,
    ) {}

    public function control(): Response
    {
        return Inertia::render('Bot/Control', [
            'strategies' => Strategy::orderBy('name')->get(['id', 'name', 'pair', 'timeframe', 'parameters', 'version']),
            'status' => $this->bot->status(),
            'telegram' => $this->telegram->settings(),
            'recentTrades' => Trade::whereNotNull('bot_run_id')->latest('close_at')->limit(50)->get(),
        ]);
    }

    /** Estado en vivo (polling): sincroniza a la BD + emite Reverb + notifica. */
    public function status(): JsonResponse
    {
        return response()->json($this->bot->syncAndStatus());
    }

    /** Estado ligero (solo lectura) para el indicador del header; bridge caído = 'stopped'. */
    public function state(): JsonResponse
    {
        try {
            $s = $this->bridge->botStatus();

            return response()->json(['status' => $s['status'] ?? 'stopped']);
        } catch (Throwable) {
            return response()->json(['status' => 'stopped']);
        }
    }

    public function start(Request $request): JsonResponse
    {
        $data = $request->validate([
            'strategy_id' => ['required', 'exists:strategies,id'],
            'lot' => ['required', 'numeric', 'gt:0', 'max:100'],
            'daily_loss_limit' => ['required', 'numeric', 'min:0'],
            'max_positions' => ['required', 'integer', 'min:1', 'max:20'],
            'timeframe' => ['nullable', Rule::in(StrategyRequest::TIMEFRAMES)],
        ]);

        $strategy = Strategy::findOrFail($data['strategy_id']);
        $params = $strategy->parameters ?? [];
        $risk = $params['risk'] ?? [];

        $run = BotRun::create([
            'strategy_id' => $strategy->id,
            'started_at' => now(),
            'status' => 'running',
            'total_trades' => 0,
            'total_pnl' => 0,
        ]);

        try {
            $status = $this->bridge->botStart([
                'bot_run_id' => $run->id,
                'strategy_type' => $params['type'] ?? 'ma_cross',
                'params' => $params['indicators'] ?? [],
                'symbol' => $strategy->pair,
                'timeframe' => $data['timeframe'] ?? $strategy->timeframe,
                'lot' => (float) $data['lot'],
                'sl_pips' => (float) ($risk['sl_pips'] ?? 20),
                'tp_pips' => (float) ($risk['tp_pips'] ?? 40),
                'daily_loss_limit' => (float) $data['daily_loss_limit'],
                'max_positions' => (int) $data['max_positions'],
            ]);
        } catch (BridgeException $e) {
            $run->update(['status' => 'error', 'stopped_at' => now()]);
            return response()->json(['error' => $e->getMessage()], $e->status);
        } catch (Throwable $e) {
            $run->update(['status' => 'error', 'stopped_at' => now()]);
            return response()->json(['error' => 'Bridge no accesible: ' . $e->getMessage()], 502);
        }

        $this->telegram->notify('started', "Bot iniciado: {$strategy->name} ({$strategy->pair} {$data['timeframe']}) · lote {$data['lot']} · máx {$data['max_positions']} pos · límite diario " . number_format((float) $data['daily_loss_limit'], 2));

        return response()->json(['status' => $status]);
    }

    public function pause(): JsonResponse
    {
        return $this->control_action('botPause', 'paused', 'Bot pausado.');
    }

    public function resume(): JsonResponse
    {
        return $this->control_action('botResume', 'resumed', 'Bot reanudado.');
    }

    public function stop(): JsonResponse
    {
        return $this->control_action('botStop', 'stopped', 'Bot detenido.', stoppedRun: true);
    }

    /** PANIC: cierra TODAS las posiciones y detiene el bot. */
    public function panic(): JsonResponse
    {
        try {
            $result = $this->bridge->botPanic();
        } catch (Throwable $e) {
            return response()->json(['error' => 'Error en PANIC: ' . $e->getMessage()], 502);
        }
        $this->markRunStopped();
        $closed = $result['panic']['count'] ?? 0;
        $this->telegram->notify('panic', "PANIC activado: {$closed} posiciones cerradas y bot detenido.");

        return response()->json($result);
    }

    public function updateTelegram(Request $request): JsonResponse
    {
        $data = $request->validate([
            'enabled' => ['required', 'boolean'],
            'events' => ['array'],
        ]);
        $this->telegram->updateSettings($data['enabled'], $data['events'] ?? []);

        return response()->json(['telegram' => $this->telegram->settings()]);
    }

    // --- helpers ---------------------------------------------------------
    private function control_action(string $method, string $event, string $message, bool $stoppedRun = false): JsonResponse
    {
        try {
            $status = $this->bridge->{$method}();
        } catch (Throwable $e) {
            return response()->json(['error' => $e->getMessage()], 502);
        }
        if ($stoppedRun) {
            $this->markRunStopped();
        }
        $this->telegram->notify($event, $message);

        return response()->json(['status' => $status]);
    }

    private function markRunStopped(): void
    {
        BotRun::whereIn('status', ['running', 'paused'])
            ->latest('id')
            ->first()
            ?->update(['status' => 'stopped', 'stopped_at' => now()]);
    }
}
