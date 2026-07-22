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

    /**
     * Preview de fidelidad (Fase 1): SL/TP/lote que el ejecutor en vivo usaría para
     * cada estrategia activa, calculado con el mismo módulo que el backtest, SIN operar.
     */
    public function preview(): JsonResponse
    {
        try {
            return response()->json($this->bridge->botPreview());
        } catch (Throwable $e) {
            return response()->json(['error' => 'No se pudo obtener el preview: ' . $e->getMessage()], 502);
        }
    }

    /** ¿Magic del rango del bot? (magic_for(sid) = 770000 + sid; espejo de state.py del bridge). */
    private function isBotMagic(int $magic): bool
    {
        return $magic >= 770000 && $magic <= 869999;
    }

    /** Deals del bot desde el epoch (fuente CANÓNICA: history_deals de MT5 por magic). */
    private function botDeals(): \Illuminate\Support\Collection
    {
        $since = \Illuminate\Support\Carbon::parse((string) config('forexbot.bot.epoch', '2026-06-25'))->toIso8601String();
        $deals = $this->bridge->history($since, now()->toIso8601String());

        return collect($deals)->filter(fn ($d) => $this->isBotMagic((int) ($d['magic'] ?? 0)))->values();
    }

    /**
     * PnL TOTAL de vida del bot (read-only): realizado (deals del bróker por magic,
     * con comisiones/swaps/fees — sobrevive a re-armes y huecos del journal) + flotante
     * actual de las posiciones del bot. El journal/BD NO son fuente aquí: cubren 2 y 11
     * de los 35 cierres reales; MT5 los cubre todos.
     */
    public function lifetimePnl(): JsonResponse
    {
        try {
            $deals = $this->botDeals();
            // Realizado = TODOS los deals del bot: el profit vive en los deals OUT, pero
            // commission/fee pueden venir también en los IN según el broker → sumar todo
            // el grupo es lo bróker-fiel (los IN traen profit 0, no doblan nada).
            $realized = round($deals->sum(
                fn ($d) => (float) ($d['profit'] ?? 0) + (float) ($d['commission'] ?? 0)
                    + (float) ($d['swap'] ?? 0) + (float) ($d['fee'] ?? 0)
            ), 2);
            // DEAL_ENTRY: 0=IN, 1=OUT, 2=INOUT (reversal), 3=OUT_BY. Cierres = OUT | OUT_BY.
            $closed = $deals->filter(fn ($d) => in_array((int) ($d['entry'] ?? -1), [1, 3], true))->count();

            $positions = collect($this->bridge->positions())
                ->filter(fn ($p) => $this->isBotMagic((int) ($p['magic'] ?? 0)))->values();
            $floating = round($positions->sum(fn ($p) => (float) ($p['profit'] ?? 0) + (float) ($p['swap'] ?? 0)), 2);

            $first = $deals->min('time');

            return response()->json([
                'realized' => $realized,
                'floating' => $floating,
                'total' => round($realized + $floating, 2),
                'closed_count' => $closed,
                'open_count' => $positions->count(),
                'since' => $first ? gmdate('Y-m-d', (int) $first) : null,
                'epoch' => (string) config('forexbot.bot.epoch', '2026-06-25'),
            ]);
        } catch (Throwable $e) {
            return response()->json(['error' => 'No se pudo calcular el PnL de vida: ' . $e->getMessage()], 502);
        }
    }

    /**
     * Trades CERRADOS del bot (read-only): deals del bróker agrupados por posición,
     * más reciente arriba. Enriquecidos con el motivo de cierre desde la BD/journal
     * cuando existe (matching por position_id) — COMPLETITUD > enriquecimiento: un
     * deal sin motivo se muestra igual, jamás se omite.
     */
    public function closedTrades(Request $request): JsonResponse
    {
        $limit = min(200, max(1, (int) $request->integer('limit', 50)));
        try {
            $deals = $this->botDeals();
        } catch (Throwable $e) {
            return response()->json(['error' => 'No se pudo obtener el historial: ' . $e->getMessage()], 502);
        }

        $rows = collect();
        foreach ($deals->groupBy(fn ($d) => (int) ($d['position_id'] ?? 0)) as $posId => $group) {
            $out = $group->first(fn ($d) => in_array((int) ($d['entry'] ?? -1), [1, 3], true));
            if (! $out) {
                continue; // posición aún abierta (solo deal de entrada)
            }
            $in = $group->first(fn ($d) => (int) ($d['entry'] ?? -1) === 0);
            $magic = (int) ($out['magic'] ?? 0);
            $rows->push([
                'position_id' => (int) $posId,
                'magic' => $magic,
                'strategy_id' => $magic - 770000,
                'symbol' => (string) ($out['symbol'] ?? ''),
                // Dirección de la POSICIÓN = el deal de ENTRADA (type 0=BUY/1=SELL). Sin
                // IN dentro del epoch, se invierte el OUT (cerrar un largo ES un SELL).
                'direction' => $in
                    ? ((int) ($in['type'] ?? 0) === 0 ? 'buy' : 'sell')
                    : ((int) ($out['type'] ?? 0) === 0 ? 'sell' : 'buy'),
                'volume' => (float) ($out['volume'] ?? 0),
                'entry_price' => $in ? (float) $in['price'] : null,
                'close_price' => (float) ($out['price'] ?? 0),
                'open_time' => $in ? (int) $in['time'] : null,
                'close_time' => (int) ($out['time'] ?? 0),
                // PnL bróker-fiel del grupo completo (profit + comisiones de ambos lados + swap + fee).
                'pnl' => round($group->sum(
                    fn ($d) => (float) ($d['profit'] ?? 0) + (float) ($d['commission'] ?? 0)
                        + (float) ($d['swap'] ?? 0) + (float) ($d['fee'] ?? 0)
                ), 2),
            ]);
        }
        $rows = $rows->sortByDesc('close_time')->take($limit)->values();

        // --- Enriquecimiento best-effort (su fallo degrada el motivo, nunca la fila) ---
        $posIds = $rows->pluck('position_id');
        $dbReasons = Trade::whereIn('ticket', $posIds)->whereNotNull('close_reason')->pluck('close_reason', 'ticket');
        $jReasons = [];
        try {
            $journal = $this->bridge->botJournal(500);
            foreach (($journal['entries'] ?? []) as $e) {
                if (($e['kind'] ?? '') === 'close' && ! empty($e['ticket'])) {
                    $jReasons[(int) $e['ticket']] = $e['close_reason'] ?? null;
                }
            }
        } catch (Throwable) {
            // journal no accesible: las filas salen sin ese motivo extra
        }
        $strategies = Strategy::whereIn('id', $rows->pluck('strategy_id')->unique())
            ->get(['id', 'name', 'pair', 'parameters'])->keyBy('id');

        $rows = $rows->map(function ($r) use ($dbReasons, $jReasons, $strategies) {
            $s = $strategies->get($r['strategy_id']);
            $r['close_reason'] = $dbReasons[$r['position_id']] ?? $jReasons[$r['position_id']] ?? null;
            $r['strategy'] = $s
                ? ['name' => $s->name, 'pair' => $s->pair, 'type' => $s->parameters['type'] ?? null]
                : null;
            return $r;
        });

        return response()->json([
            'trades' => $rows,
            'count' => $rows->count(),
            'epoch' => (string) config('forexbot.bot.epoch', '2026-06-25'),
        ]);
    }

    /** Journal PERSISTENTE del bot (aperturas/cierres; sobrevive reinicios y corte de día). */
    public function journalPersistent(Request $request): JsonResponse
    {
        $limit = (int) $request->integer('limit', 200);
        try {
            return response()->json($this->bridge->botJournal($limit));
        } catch (Throwable $e) {
            return response()->json(['error' => 'No se pudo obtener el journal: ' . $e->getMessage()], 502);
        }
    }

    /**
     * Resumen de SALUD para la sección de salud de /bot (pegamento de LECTURA, solo-Laravel).
     * Agrega tres fuentes que ya existen: bridge /health (MT5), bridge /bot/lifecycle
     * (auto-reanudar) y scripts/watchdog_state.txt (watchdog) + un write real a la BD.
     * CADA fuente en su propio try/catch con timeout corto: un fallo parcial degrada SOLO su
     * chip (null / ok=false), nunca rompe la ruta ni la página. No toca el bridge ni el bot.
     */
    public function healthSummary(): JsonResponse
    {
        $out = [];

        // Bridge alcanzable + MT5 (del /health; timeout corto para no colgar si el bridge cae).
        try {
            $h = $this->bridge->health(4);
            $out['bridge'] = ['ok' => true];
            $out['mt5'] = [
                'connected' => (bool) ($h['connected'] ?? false),
                'trade_allowed' => (bool) (($h['terminal'] ?? [])['trade_allowed'] ?? false),
            ];
        } catch (Throwable) {
            $out['bridge'] = ['ok' => false];
            $out['mt5'] = null;
        }

        // Watchdog: lee scripts/watchdog_state.txt (0 = sano) + frescura del mtime (vivo si
        // se escribió hace < 6 min = ~3 ciclos del watchdog de 2 min).
        try {
            $path = base_path('../scripts/watchdog_state.txt');
            if (is_file($path)) {
                $val = (int) trim((string) @file_get_contents($path));
                $age = time() - (int) @filemtime($path);
                $fresh = $age >= 0 && $age < 360;
                $out['watchdog'] = ['ok' => $val === 0 && $fresh, 'state' => $val, 'age_seconds' => $age, 'fresh' => $fresh];
            } else {
                $out['watchdog'] = null;
            }
        } catch (Throwable) {
            $out['watchdog'] = null;
        }

        // Auto-reanudar: armado = config activa; último reinicio = boot_id (ISO exacto).
        $armed = (bool) config('forexbot.autoresume.enabled', true);
        try {
            $life = $this->bridge->botLifecycle(4);
            $out['autoresume'] = ['armed' => $armed, 'restart_paused' => (bool) ($life['restart_paused'] ?? false), 'last_boot' => $life['boot_id'] ?? null];
        } catch (Throwable) {
            $out['autoresume'] = ['armed' => $armed, 'restart_paused' => null, 'last_boot' => null];
        }

        // BD escribible: write real + select (igual que /healthz).
        try {
            \App\Models\Setting::query()->updateOrCreate(['key' => 'healthz'], ['value' => now()->toIso8601String()]);
            \Illuminate\Support\Facades\DB::select('select 1');
            $out['db'] = ['ok' => true];
        } catch (Throwable) {
            $out['db'] = ['ok' => false];
        }

        return response()->json($out);
    }

    /**
     * Preview ad-hoc de favoritos ANTES de iniciarlos (diálogo de confirmar): muestra el
     * SL/TP ATR y el lote por riesgo% REAL que se usaría, sin operar. Las specs se arman
     * en el servidor desde el favorito (no se confía en el cliente).
     */
    public function previewSpec(Request $request): JsonResponse
    {
        $data = $request->validate([
            'favorite_ids' => ['required', 'array', 'min:1', 'max:50'],
            'favorite_ids.*' => ['integer', 'exists:favorites,id'],
            'max_lot' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'below_min' => ['nullable', Rule::in(['skip', 'floor'])],
        ]);

        $rows = Favorite::whereIn('id', $data['favorite_ids'])->get()->map(fn ($f) => [
            'favorite_id' => $f->id,
            'strategy_id' => $f->id,
            'symbol' => $f->pair,
            'timeframe' => $f->timeframe,
            'strategy_type' => $f->type,
            'params' => $f->params,
            'sl_pips' => (float) $f->sl_pips,
            'tp_pips' => (float) $f->tp_pips,
            'risk_percent' => (float) ($f->risk_percent ?? 0),
            'sl_mode' => $f->sl_mode ?? 'fixed',
            'atr_period' => (int) ($f->atr_period ?? 14),
            'lot' => 0.01,
            'max_lot' => (float) ($data['max_lot'] ?? 0),
            'below_min' => (string) ($data['below_min'] ?? 'skip'),
        ])->all();

        try {
            return response()->json($this->bridge->botPreviewSpec($rows));
        } catch (Throwable $e) {
            return response()->json(['error' => 'No se pudo obtener el preview: ' . $e->getMessage()], 502);
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
            'max_lot' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'below_min' => ['nullable', Rule::in(['skip', 'floor'])],
            'arm_expiry_hours' => ['nullable', 'numeric', 'min:0', 'max:168'],
        ]);

        $strategy = Strategy::findOrFail($data['strategy_id']);

        try {
            $status = $this->startStrategy($strategy, (float) $data['lot'], (float) $data['daily_loss_limit'], (int) $data['max_positions'], $data['timeframe'] ?? null, (bool) ($data['news_filter'] ?? false), (int) ($data['news_window_min'] ?? 15), (int) ($data['cb_max_losses'] ?? 0), (float) ($data['cb_max_drawdown_pct'] ?? 0), (float) ($data['portfolio_heat_pct'] ?? 0), (float) ($data['max_lot'] ?? 0), (string) ($data['below_min'] ?? 'skip'), (float) ($data['arm_expiry_hours'] ?? 24));
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
            // Límite diario y tope de lote POR candidata (cartera multi-instrumento);
            // si faltan, cae al global. Permite calibrar cada pata con su riesgo/op.
            'favorites.*.daily_loss_limit' => ['nullable', 'numeric', 'min:0'],
            'favorites.*.max_lot' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'daily_loss_limit' => ['required', 'numeric', 'min:0'],
            'max_positions' => ['required', 'integer', 'min:1', 'max:20'],
            'news_filter' => ['nullable', 'boolean'],
            'news_window_min' => ['nullable', 'integer', 'min:1', 'max:120'],
            'cb_max_losses' => ['nullable', 'integer', 'min:0', 'max:50'],
            'cb_max_drawdown_pct' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'portfolio_heat_pct' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'max_lot' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'below_min' => ['nullable', Rule::in(['skip', 'floor'])],
            'arm_expiry_hours' => ['nullable', 'numeric', 'min:0', 'max:168'],
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
                            // Modo SL/TP + periodo ATR del favorito: el ejecutor en vivo los
                            // usa para operar por ATR + riesgo% con FIDELIDAD al backtest.
                            'sl_mode' => $fav->sl_mode ?? 'fixed',
                            'atr_period' => $fav->atr_period ?? 14,
                        ],
                    ],
                    'version' => 1,
                    'is_active' => false,
                ],
            );

            try {
                $this->startStrategy($strategy, (float) $row['lot'], (float) ($row['daily_loss_limit'] ?? $data['daily_loss_limit']), (int) $data['max_positions'], null, (bool) ($data['news_filter'] ?? false), (int) ($data['news_window_min'] ?? 15), (int) ($data['cb_max_losses'] ?? 0), (float) ($data['cb_max_drawdown_pct'] ?? 0), (float) ($data['portfolio_heat_pct'] ?? 0), (float) ($row['max_lot'] ?? $data['max_lot'] ?? 0), (string) ($data['below_min'] ?? 'skip'), (float) ($data['arm_expiry_hours'] ?? 24));
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
    private function startStrategy(Strategy $strategy, float $lot, float $dailyLossLimit, int $maxPositions, ?string $timeframe, bool $newsFilter = false, int $newsWindowMin = 15, int $cbMaxLosses = 0, float $cbMaxDrawdownPct = 0.0, float $portfolioHeatPct = 0.0, float $maxLot = 0.0, string $belowMin = 'skip', float $armExpiryHours = 24.0): array
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
                // Fidelidad con el backtest (ATR en vivo): el ejecutor necesita el modo
                // SL/TP, el periodo ATR y el riesgo% para dimensionar igual que el backtest.
                'sl_mode' => $risk['sl_mode'] ?? 'fixed',
                'atr_period' => (int) ($risk['atr_period'] ?? 14),
                'risk_percent' => (float) ($risk['risk_percent'] ?? 0),
                // Guardas de sizing (Fase 2): tope de lote y política si riesgo% < mínimo.
                'max_lot' => $maxLot,
                'below_min' => $belowMin,
                'arm_expiry_hours' => $armExpiryHours,
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
