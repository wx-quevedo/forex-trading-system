<?php

namespace App\Http\Controllers;

use App\Models\BotEvent;
use App\Models\BotRun;
use App\Models\Favorite;
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
            'strategies' => Strategy::orderBy('name')->get(['id', 'name', 'pair', 'timeframe', 'parameters', 'version', 'favorite_id']),
            'favorites' => Favorite::latest()->get(),
            'status' => $this->bot->status(),
            'telegram' => $this->telegram->settings(),
            'recentTrades' => Trade::whereNotNull('bot_run_id')->latest('close_at')->limit(50)->get(),
            'journal' => $this->journal(null),
        ]);
    }

    /** Estado en vivo (polling): sincroniza a la BD + emite Reverb + notifica. */
    public function status(): JsonResponse
    {
        $status = $this->bot->syncAndStatus();
        $status['journal'] = $this->journal(null);

        return response()->json($status);
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
            'news_filter' => ['nullable', 'boolean'],
            'news_window_min' => ['nullable', 'integer', 'min:1', 'max:120'],
            'cb_max_losses' => ['nullable', 'integer', 'min:0', 'max:50'],
            'cb_max_drawdown_pct' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'portfolio_heat_pct' => ['nullable', 'numeric', 'min:0', 'max:100'],
        ]);

        $strategy = Strategy::findOrFail($data['strategy_id']);

        try {
            $status = $this->startStrategy($strategy, (float) $data['lot'], (float) $data['daily_loss_limit'], (int) $data['max_positions'], $data['timeframe'] ?? null, (bool) ($data['news_filter'] ?? false), (int) ($data['news_window_min'] ?? 15), (int) ($data['cb_max_losses'] ?? 0), (float) ($data['cb_max_drawdown_pct'] ?? 0), (float) ($data['portfolio_heat_pct'] ?? 0));
        } catch (BridgeException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        } catch (Throwable $e) {
            return response()->json(['error' => 'Bridge no accesible: ' . $e->getMessage()], 502);
        }

        return response()->json(['status' => $status]);
    }

    /**
     * Fase 8: carga uno o varios FAVORITOS al bot que opera. Cada favorito se
     * "materializa" como Strategy (con traza al favorito, sin duplicar) y se arranca
     * con su propio lote (sugerido desde riesgo%/capital en el front, ajustable).
     */
    public function loadFavorites(Request $request): JsonResponse
    {
        $data = $request->validate([
            'favorites' => ['required', 'array', 'min:1'],
            'favorites.*.favorite_id' => ['required', 'exists:favorites,id'],
            'favorites.*.lot' => ['required', 'numeric', 'gt:0', 'max:100'],
            'daily_loss_limit' => ['required', 'numeric', 'min:0'],
            'max_positions' => ['required', 'integer', 'min:1', 'max:20'],
            'news_filter' => ['nullable', 'boolean'],
            'news_window_min' => ['nullable', 'integer', 'min:1', 'max:120'],
            'cb_max_losses' => ['nullable', 'integer', 'min:0', 'max:50'],
            'cb_max_drawdown_pct' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'portfolio_heat_pct' => ['nullable', 'numeric', 'min:0', 'max:100'],
        ]);

        $errors = [];
        foreach ($data['favorites'] as $row) {
            $fav = Favorite::find($row['favorite_id']);
            if (! $fav) {
                continue;
            }
            // Materializa el favorito como Strategy (sin duplicar al recargar).
            $strategy = Strategy::updateOrCreate(
                ['favorite_id' => $fav->id],
                [
                    'name' => '★ ' . $fav->name,
                    'description' => 'Cargada desde Favoritos (Fase 8)',
                    'pair' => $fav->pair,
                    'timeframe' => $fav->timeframe,
                    'parameters' => [
                        'type' => $fav->type,
                        'indicators' => $fav->params,
                        'risk' => [
                            'sl_pips' => $fav->sl_pips,
                            'tp_pips' => $fav->tp_pips,
                            'risk_percent' => $fav->risk_percent,
                            // Preserva el modo SL/TP del favorito en la definición (el
                            // ejecutor en vivo aún opera en pips fijos; integridad a futuro).
                            'sl_mode' => $fav->sl_mode ?? 'fixed',
                            'atr_period' => $fav->atr_period ?? 14,
                        ],
                    ],
                    'version' => 1,
                    'is_active' => false,
                ],
            );

            try {
                $this->startStrategy($strategy, (float) $row['lot'], (float) $data['daily_loss_limit'], (int) $data['max_positions'], null, (bool) ($data['news_filter'] ?? false), (int) ($data['news_window_min'] ?? 15), (int) ($data['cb_max_losses'] ?? 0), (float) ($data['cb_max_drawdown_pct'] ?? 0), (float) ($data['portfolio_heat_pct'] ?? 0));
            } catch (Throwable $e) {
                $errors[] = "{$fav->name}: " . $e->getMessage();
            }
        }

        return response()->json(['status' => $this->bot->status(), 'errors' => $errors]);
    }

    /**
     * Arranca una estrategia en el bot (común a /bot/start y a cargar favoritos):
     * cierra corridas previas, crea la corrida, llama al bridge y notifica/loguea.
     * Lanza si el bridge falla (el caller decide la respuesta).
     */
    private function startStrategy(Strategy $strategy, float $lot, float $dailyLossLimit, int $maxPositions, ?string $timeframe, bool $newsFilter = false, int $newsWindowMin = 15, int $cbMaxLosses = 0, float $cbMaxDrawdownPct = 0.0, float $portfolioHeatPct = 0.0): array
    {
        $params = $strategy->parameters ?? [];
        $risk = $params['risk'] ?? [];
        $tf = $timeframe ?? $strategy->timeframe;

        // Una sola corrida activa por estrategia: cierra anteriores en la BD.
        BotRun::where('strategy_id', $strategy->id)->whereIn('status', ['running', 'paused'])
            ->update(['status' => 'stopped', 'stopped_at' => now()]);

        $run = BotRun::create([
            'strategy_id' => $strategy->id,
            'started_at' => now(),
            'status' => 'running',
            'total_trades' => 0,
            'total_pnl' => 0,
        ]);

        try {
            $status = $this->bridge->botStart([
                'strategy_id' => $strategy->id,
                'bot_run_id' => $run->id,
                'strategy_type' => $params['type'] ?? 'ma_cross',
                'params' => $params['indicators'] ?? [],
                'symbol' => $strategy->pair,
                'timeframe' => $tf,
                'lot' => $lot,
                'sl_pips' => (float) ($risk['sl_pips'] ?? 20),
                'tp_pips' => (float) ($risk['tp_pips'] ?? 40),
                'daily_loss_limit' => $dailyLossLimit,
                'max_positions' => $maxPositions,
                'news_filter' => $newsFilter,
                'news_window_min' => $newsWindowMin,
                'cb_max_losses' => $cbMaxLosses,
                'cb_max_drawdown_pct' => $cbMaxDrawdownPct,
                'portfolio_heat_pct' => $portfolioHeatPct,
            ]);
        } catch (Throwable $e) {
            $run->update(['status' => 'error', 'stopped_at' => now()]);
            throw $e;
        }

        $msg = "Estrategia añadida: {$strategy->name} ({$strategy->pair} {$tf}) · lote {$lot} · máx {$maxPositions} pos · límite diario " . number_format($dailyLossLimit, 2);
        $this->telegram->notify('started', $msg);
        $this->bot->logEvent($run->id, 'started', 'info', $msg, $strategy->id);

        return $status;
    }

    public function pause(Request $request): JsonResponse
    {
        return $this->target($request, 'botPause', 'paused', 'Estrategia pausada.', 'paused');
    }

    public function resume(Request $request): JsonResponse
    {
        return $this->target($request, 'botResume', 'resumed', 'Estrategia reanudada.', 'running');
    }

    public function stop(Request $request): JsonResponse
    {
        return $this->target($request, 'botStop', 'stopped', 'Estrategia detenida.', 'stopped');
    }

    public function remove(Request $request): JsonResponse
    {
        $sid = $request->integer('strategy_id') ?: null;
        if (! $sid) {
            return response()->json(['error' => 'strategy_id requerido.'], 422);
        }
        try {
            $status = $this->bridge->botRemove($sid);
        } catch (Throwable $e) {
            return response()->json(['error' => $e->getMessage()], 502);
        }
        $this->stopBotRuns($sid);

        return response()->json(['status' => $status]);
    }

    /** PANIC: cierra TODAS las posiciones de TODAS las estrategias y detiene todo. */
    public function panic(): JsonResponse
    {
        try {
            $result = $this->bridge->botPanic();
        } catch (Throwable $e) {
            return response()->json(['error' => 'Error en PANIC: ' . $e->getMessage()], 502);
        }
        $this->stopBotRuns(null);
        $closed = $result['panic']['count'] ?? 0;
        $this->telegram->notify('panic', "PANIC activado: {$closed} posiciones cerradas, todas las estrategias detenidas.");
        $this->bot->logEvent(null, 'panic', 'warning', "PANIC: {$closed} posiciones cerradas, todas las estrategias detenidas.");

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
    /** Acción de control dirigida a una estrategia (strategy_id) o a todas. */
    private function target(Request $request, string $method, string $event, string $message, string $newStatus): JsonResponse
    {
        $sid = $request->integer('strategy_id') ?: null;
        try {
            $status = $this->bridge->{$method}($sid);
        } catch (Throwable $e) {
            return response()->json(['error' => $e->getMessage()], 502);
        }

        // Reflejar en la BD el nuevo estado de la(s) corrida(s).
        $query = BotRun::whereIn('status', ['running', 'paused']);
        if ($sid) {
            $query->where('strategy_id', $sid);
        }
        $update = ['status' => $newStatus];
        if ($newStatus === 'stopped') {
            $update['stopped_at'] = now();
        }
        $query->update($update);

        $this->telegram->notify($event, $message);
        $this->bot->logEvent($this->runIdForStrategy($sid), $event, 'info', $message, $sid);

        return response()->json(['status' => $status]);
    }

    private function stopBotRuns(?int $strategyId): void
    {
        $query = BotRun::whereIn('status', ['running', 'paused']);
        if ($strategyId) {
            $query->where('strategy_id', $strategyId);
        }
        $query->update(['status' => 'stopped', 'stopped_at' => now()]);
    }

    private function runIdForStrategy(?int $strategyId): ?int
    {
        return BotRun::when($strategyId, fn ($q) => $q->where('strategy_id', $strategyId))
            ->latest('id')->value('id');
    }

    /** Journal del bot (eventos recientes de todas las estrategias). */
    private function journal(?int $runId): \Illuminate\Support\Collection
    {
        return BotEvent::when($runId, fn ($q) => $q->where('bot_run_id', $runId))
            ->latest('occurred_at')
            ->limit(150)
            ->get(['id', 'bot_run_id', 'strategy_id', 'type', 'severity', 'message', 'occurred_at']);
    }
}
