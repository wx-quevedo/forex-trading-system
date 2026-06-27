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

        $this->syncSignals($status['signals'] ?? []);
        $this->syncOpenPositions($status['positions'] ?? [], $runByStrategy);
        $this->syncClosedTrades($status['closed_trades'] ?? [], $runByStrategy);
        $this->updateRuns($runByStrategy);
        $this->journalHedge($status['exposure'] ?? [], $status['positions'] ?? []);
    }

    /** Señales nuevas por estrategia (seq monotónico por estrategia) → signal_logs. */
    private function syncSignals(array $signals): void
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
            $key = "forexbot.bot_seq.{$sid}";
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
    private function syncOpenPositions(array $positions, array $runByStrategy): void
    {
        $seen = (array) Cache::get('forexbot.bot_open_seen', []);
        $current = [];
        foreach ($positions as $p) {
            $ticket = (int) ($p['ticket'] ?? 0);
            $current[] = $ticket;
            if ($ticket && ! in_array($ticket, $seen, true)) {
                $sid = (int) ($p['strategy_id'] ?? 0);
                $dir = ($p['type'] ?? 0) === 0 ? 'BUY' : 'SELL';
                $this->telegram->notify('trade_opened', "Trade abierto: {$dir} {$p['symbol']} {$p['volume']} @ {$p['price_open']}");
                $this->logEvent($runByStrategy[$sid]['bot_run_id'] ?? null, 'trade_opened', 'info', "Trade abierto {$dir} {$p['symbol']} {$p['volume']} @ {$p['price_open']}", $sid ?: null);
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
        Cache::forever('forexbot.bot_closed_seen', $seen);
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
