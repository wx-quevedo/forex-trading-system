<?php

namespace App\Services;

use App\Events\BotUpdated;
use App\Models\BotEvent;
use App\Models\BotRun;
use App\Models\SignalLog;
use App\Models\Trade;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * Sincroniza el estado MULTI-ESTRATEGIA del bot (del bridge) con la BD de Laravel,
 * con trazabilidad por estrategia (strategy_id/magic en cada trade) y dispara
 * notificaciones Telegram + eventos del Journal. El panel llama syncAndStatus() en polling.
 */
class BotService
{
    public function __construct(
        private readonly PythonBridgeService $bridge,
        private readonly TelegramNotifier $telegram,
    ) {}

    public function status(): array
    {
        try {
            return $this->bridge->botStatus();
        } catch (Throwable $e) {
            return ['status' => 'error', 'error' => 'Bridge no accesible: ' . $e->getMessage(), 'runs' => [], 'positions' => [], 'signals' => [], 'closed_trades' => [], 'exposure' => []];
        }
    }

    public function syncAndStatus(): array
    {
        $status = $this->status();
        if (! empty($status['runs'])) {
            try {
                $this->sync($status);
            } catch (Throwable) {
                // la persistencia no debe romper el estado en vivo
            }
        }
        try {
            BotUpdated::dispatch($status);
        } catch (Throwable) {
        }

        return $status;
    }

    private function sync(array $status): void
    {
        // strategy_id -> resumen del run (incluye bot_run_id de Laravel).
        $runByStrategy = [];
        foreach ($status['runs'] as $r) {
            $runByStrategy[(int) $r['strategy_id']] = $r;
        }

        // Fix Telegram #5: el bridge (post-reinicio del finde) marca positions_ok=false
        // cuando su bucle de posiciones falló (hipo de MT5) en vez de mentir con lista
        // vacía. Bridges viejos no envían el campo → se asume true (compat).
        $positionsOk = ($status['positions_ok'] ?? true) !== false;

        $this->syncSignals($status['signals'] ?? [], $runByStrategy);
        $this->syncOpenPositions($status['positions'] ?? [], $runByStrategy, $positionsOk);
        $this->syncClosedTrades($status['closed_trades'] ?? [], $runByStrategy);
        $this->updateRuns($runByStrategy);
        $this->journalHedge($status['exposure'] ?? [], $status['positions'] ?? []);
    }

    /** Señales nuevas por estrategia (seq monotónico POR RUN) → signal_logs. */
    private function syncSignals(array $signals, array $runByStrategy = []): void
    {
        $bySid = [];
        foreach ($signals as $s) {
            $sid = (int) ($s['strategy_id'] ?? 0);
            if ($sid) {
                $bySid[$sid][] = $s;
            }
        }
        foreach ($bySid as $sid => $list) {
            usort($list, fn ($a, $b) => ($a['seq'] ?? 0) <=> ($b['seq'] ?? 0));
            // Fix Telegram #3: cursor POR RUN (sid + started_at del run), no por
            // estrategia. Un RE-ARME crea un run nuevo con seq=0; con el cursor viejo
            // clavado por sid, sus señales quedaban ≤ cursor y se PERDÍAN en silencio.
            // Con el started_at en la clave, cada run nace con cursor propio en 0.
            $started = preg_replace('/[^A-Za-z0-9]/', '', (string) ($runByStrategy[$sid]['started_at'] ?? ''));
            $key = "forexbot.bot_seq.{$sid}.{$started}";
            $lastSeq = (int) Cache::get($key, 0);
            $maxSeq = $lastSeq;
            foreach ($list as $sig) {
                $seq = (int) ($sig['seq'] ?? 0);
                if ($seq <= $lastSeq) {
                    continue;
                }
                SignalLog::create([
                    'strategy_id' => $sid,
                    'evaluated_at' => $sig['evaluated_at'] ?? now(),
                    'symbol' => $sig['symbol'] ?? '',
                    'signal_type' => $sig['signal_type'] ?? 'none',
                    'executed' => (bool) ($sig['executed'] ?? false),
                    'reason' => $sig['reason'] ?? null,
                    'indicator_values' => $sig['indicator_values'] ?? [],
                ]);
                $maxSeq = max($maxSeq, $seq);
            }
            if ($maxSeq > $lastSeq) {
                Cache::forever($key, $maxSeq);
            }
        }
    }

    /** Detecta posiciones recién abiertas → Telegram + Journal (con estrategia). */
    private function syncOpenPositions(array $positions, array $runByStrategy, bool $positionsOk = true): void
    {
        $seen = (array) Cache::get('forexbot.bot_open_seen', []);
        // Fix Telegram #1 (guard no-encoger) + #5: un snapshot SIN posiciones cuando
        // antes las había huele a hipo de MT5/bridge, no a cierre masivo. Sobrescribir
        // 'seen' con lista vacía era la CAUSA RAÍZ del replay: al siguiente poll sano
        // todas las posiciones parecían nuevas y Telegram re-enviaba "Trade abierto"
        // viejos. En ese ciclo: no escribir, no notificar. (Un cierre masivo real solo
        // deja 'seen' obsoleto, que es inofensivo: los tickets no se reutilizan.)
        if (! $positionsOk || (empty($positions) && ! empty($seen))) {
            return;
        }
        $current = [];
        foreach ($positions as $p) {
            $ticket = (int) ($p['ticket'] ?? 0);
            $current[] = $ticket;
            if ($ticket && ! in_array($ticket, $seen, true)) {
                $sid = (int) ($p['strategy_id'] ?? 0);
                $dir = ($p['type'] ?? 0) === 0 ? 'BUY' : 'SELL';
                // Fix Telegram #2 (descarte de seguridad por edad): una "apertura nueva"
                // con más de 1h es un replay/carga tardía, no un trade fresco → va al
                // Journal (auditoría) pero NO a Telegram.
                $openedAt = (int) ($p['time'] ?? 0);
                $fresh = $openedAt === 0 || (now()->getTimestamp() - $openedAt) <= 3600;
                if ($fresh) {
                    $this->telegram->notify('trade_opened', "Trade abierto: {$dir} {$p['symbol']} {$p['volume']} @ {$p['price_open']}");
                    $this->logEvent($runByStrategy[$sid]['bot_run_id'] ?? null, 'trade_opened', 'info', "Trade abierto {$dir} {$p['symbol']} {$p['volume']} @ {$p['price_open']}", $sid ?: null);
                } else {
                    $this->logEvent($runByStrategy[$sid]['bot_run_id'] ?? null, 'trade_opened', 'info', "Trade abierto {$dir} {$p['symbol']} {$p['volume']} @ {$p['price_open']} · detectado tarde (sin Telegram)", $sid ?: null);
                }
            }
        }
        Cache::forever('forexbot.bot_open_seen', $current);
    }

    /** Trades cerrados → tabla trades con strategy_id/magic + Telegram/Journal. */
    private function syncClosedTrades(array $trades, array $runByStrategy): void
    {
        $seen = (array) Cache::get('forexbot.bot_closed_seen', []);
        foreach ($trades as $t) {
            $ticket = (int) ($t['ticket'] ?? 0);
            if (! $ticket) {
                continue;
            }
            $sid = (int) ($t['strategy_id'] ?? 0) ?: null;
            $botRunId = $sid ? ($runByStrategy[$sid]['bot_run_id'] ?? null) : null;
            Trade::updateOrCreate(
                ['ticket' => $ticket],
                [
                    'bot_run_id' => $botRunId,
                    'strategy_id' => $sid,
                    'magic' => $t['magic'] ?? null,
                    'symbol' => $t['symbol'] ?? '',
                    'direction' => $t['direction'] ?? '',
                    'open_price' => $t['open_price'] ?? null,
                    'close_price' => $t['close_price'] ?? null,
                    'volume' => $t['volume'] ?? 0,
                    'sl' => $t['sl'] ?? null,
                    'tp' => $t['tp'] ?? null,
                    'open_at' => isset($t['open_at']) ? Carbon::parse($t['open_at']) : null,
                    'close_at' => isset($t['close_at']) ? Carbon::parse($t['close_at']) : null,
                    'pnl' => $t['pnl'] ?? 0,
                    'close_reason' => $t['close_reason'] ?? null,
                    'signal_data' => ['open_reason' => $t['open_reason'] ?? null, 'open_indicators' => $t['open_indicators'] ?? null],
                ],
            );
            if (! in_array($ticket, $seen, true)) {
                $seen[] = $ticket;
                $pnl = (float) ($t['pnl'] ?? 0);
                $reason = $t['close_reason'] ?? 'cierre';
                $this->telegram->notify('trade_closed', "Trade cerrado: {$t['symbol']} PnL " . number_format($pnl, 2) . " ({$reason})");
                $this->logEvent($botRunId, 'trade_closed', $pnl >= 0 ? 'info' : 'warning', "Trade cerrado {$t['symbol']} · PnL " . number_format($pnl, 2) . " · {$reason}", $sid);
            }
        }
        // Fix Telegram #4: poda — la lista era append-only y crecía sin límite. Los
        // closed_trades del bridge son por sesión (~60/run): 500 vistos dan margen de sobra.
        Cache::forever('forexbot.bot_closed_seen', array_slice($seen, -500));
    }

    /** Actualiza cada BotRun (pnl, nº trades, estado) y registra auto-stop/error. */
    private function updateRuns(array $runByStrategy): void
    {
        foreach ($runByStrategy as $sid => $r) {
            $botRunId = $r['bot_run_id'] ?? null;
            if (! $botRunId || ! ($run = BotRun::find($botRunId))) {
                continue;
            }
            $run->total_pnl = (float) ($r['realized_pnl_today'] ?? 0);
            $run->total_trades = Trade::where('bot_run_id', $botRunId)->count();
            $botStatus = $r['status'] ?? 'running';
            if (in_array($botStatus, ['stopped', 'error'], true) && $run->status !== $botStatus) {
                $run->status = $botStatus;
                $run->stopped_at = now();
            } elseif (in_array($botStatus, ['running', 'paused'], true)) {
                $run->status = $botStatus;
            }
            $run->save();

            // Eventos autónomos por cambio de estado de la estrategia.
            $key = "forexbot.bot_laststatus.{$botRunId}";
            if ($botStatus !== Cache::get($key)) {
                $reason = $r['stop_reason'] ?? '';
                if ($botStatus === 'stopped' && str_contains($reason, 'pérdida diaria')) {
                    $this->telegram->notify('daily_limit', "Estrategia auto-detenida: {$reason}");
                    $this->logEvent($botRunId, 'daily_limit', 'warning', "Auto-stop: {$reason}", (int) $sid);
                } elseif ($botStatus === 'error') {
                    $msg = 'Error crítico: ' . ($r['error'] ?? 'desconocido');
                    $this->telegram->notify('error', $msg);
                    $this->logEvent($botRunId, 'error', 'error', $msg, (int) $sid);
                }
                Cache::forever($key, $botStatus);
            }
        }
    }

    /** Registra (informativo) cuando dos estrategias quedan opuestas en el mismo par. */
    private function journalHedge(array $exposure, array $positions): void
    {
        foreach ($exposure as $symbol => $ex) {
            if (($ex['buy'] ?? 0) > 0 && ($ex['sell'] ?? 0) > 0) {
                $sids = collect($positions)->where('symbol', $symbol)->pluck('strategy_id')->unique()->values()->all();
                if (count($sids) < 2) {
                    continue; // mismo sentido/estrategia, no es hedge entre estrategias
                }
                $key = 'forexbot.bot_hedge.' . $symbol;
                if (! Cache::get($key)) {
                    $this->logEvent(null, 'hedge', 'info', "Exposición opuesta en {$symbol}: BUY {$ex['buy']} / SELL {$ex['sell']} (estrategias distintas).");
                    Cache::put($key, true, now()->addMinutes(30));
                }
            }
        }
    }

    public function logEvent(?int $runId, string $type, string $severity, string $message, ?int $strategyId = null): void
    {
        try {
            BotEvent::create([
                'bot_run_id' => $runId,
                'strategy_id' => $strategyId,
                'type' => $type,
                'severity' => $severity,
                'message' => $message,
                'occurred_at' => now(),
            ]);
        } catch (Throwable) {
        }
    }
}
