<?php

namespace App\Services;

use App\Events\BotUpdated;
use App\Models\BotRun;
use App\Models\SignalLog;
use App\Models\Trade;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * Sincroniza el estado del bot (del bridge) con la BD de Laravel y dispara
 * notificaciones Telegram de eventos autónomos (trades, límite diario, error).
 * El panel de control llama a syncAndStatus() periódicamente (polling).
 */
class BotService
{
    public function __construct(
        private readonly PythonBridgeService $bridge,
        private readonly TelegramNotifier $telegram,
    ) {}

    /** Estado del bot (sin sincronizar) — tolerante a bridge caído. */
    public function status(): array
    {
        try {
            return $this->bridge->botStatus();
        } catch (Throwable $e) {
            return ['status' => 'error', 'error' => 'Bridge no accesible: ' . $e->getMessage(), 'positions' => [], 'signals' => [], 'closed_trades' => []];
        }
    }

    /** Obtiene el estado, lo persiste en la BD, notifica eventos y lo emite por Reverb. */
    public function syncAndStatus(): array
    {
        $status = $this->status();
        $runId = $status['bot_run_id'] ?? null;

        if ($runId && ($run = BotRun::find($runId))) {
            try {
                $this->sync($run, $status);
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

    private function sync(BotRun $run, array $status): void
    {
        $strategyId = $run->strategy_id;

        // --- Señales nuevas (por seq) → signal_logs ---
        $seqKey = "forexbot.bot_seq.{$run->id}";
        $lastSeq = (int) Cache::get($seqKey, 0);
        $maxSeq = $lastSeq;
        foreach (array_reverse($status['signals'] ?? []) as $sig) { // de más antigua a más nueva
            $seq = (int) ($sig['seq'] ?? 0);
            if ($seq <= $lastSeq) {
                continue;
            }
            SignalLog::create([
                'strategy_id' => $strategyId,
                'evaluated_at' => $sig['evaluated_at'] ?? now(),
                'symbol' => $sig['symbol'] ?? $run->strategy->pair ?? '',
                'signal_type' => $sig['signal_type'] ?? 'none',
                'executed' => (bool) ($sig['executed'] ?? false),
                'reason' => $sig['reason'] ?? null,
                'indicator_values' => $sig['indicator_values'] ?? [],
            ]);
            $maxSeq = max($maxSeq, $seq);
        }
        if ($maxSeq > $lastSeq) {
            Cache::forever($seqKey, $maxSeq);
        }

        // --- Posiciones abiertas: detectar nuevas → Telegram trade_opened ---
        $seenOpenKey = "forexbot.bot_open.{$run->id}";
        $seenOpen = (array) Cache::get($seenOpenKey, []);
        $currentOpen = [];
        foreach ($status['positions'] ?? [] as $p) {
            $ticket = (int) ($p['ticket'] ?? 0);
            $currentOpen[] = $ticket;
            if ($ticket && ! in_array($ticket, $seenOpen, true)) {
                $dir = ($p['type'] ?? 0) === 0 ? 'BUY' : 'SELL';
                $this->telegram->notify('trade_opened', "Trade abierto: {$dir} {$p['symbol']} {$p['volume']} lotes @ {$p['price_open']}");
            }
        }
        Cache::forever($seenOpenKey, $currentOpen);

        // --- Trades cerrados → tabla trades (upsert por ticket) + Telegram ---
        $seenClosedKey = "forexbot.bot_closed.{$run->id}";
        $seenClosed = (array) Cache::get($seenClosedKey, []);
        foreach ($status['closed_trades'] ?? [] as $t) {
            $ticket = (int) ($t['ticket'] ?? 0);
            if (! $ticket) {
                continue;
            }
            Trade::updateOrCreate(
                ['ticket' => $ticket],
                [
                    'bot_run_id' => $run->id,
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
                ],
            );
            if (! in_array($ticket, $seenClosed, true)) {
                $seenClosed[] = $ticket;
                $pnl = (float) ($t['pnl'] ?? 0);
                $this->telegram->notify('trade_closed', "Trade cerrado: {$t['symbol']} PnL " . number_format($pnl, 2));
            }
        }
        Cache::forever($seenClosedKey, $seenClosed);

        // --- Actualizar BotRun ---
        $run->total_trades = count($seenClosed);
        $run->total_pnl = (float) ($status['realized_pnl_today'] ?? 0);
        $botStatus = $status['status'] ?? 'running';
        if (in_array($botStatus, ['stopped', 'error'], true) && $run->status !== $botStatus) {
            $run->status = $botStatus;
            $run->stopped_at = now();
        } elseif (in_array($botStatus, ['running', 'paused'], true)) {
            $run->status = $botStatus;
        }
        $run->save();

        // --- Eventos autónomos: límite diario / error (por cambio de estado) ---
        $lastStatusKey = "forexbot.bot_laststatus.{$run->id}";
        $prevStatus = Cache::get($lastStatusKey);
        if ($botStatus !== $prevStatus) {
            $reason = $status['stop_reason'] ?? '';
            if ($botStatus === 'stopped' && str_contains($reason, 'pérdida diaria')) {
                $this->telegram->notify('daily_limit', "Bot auto-detenido: {$reason}");
            } elseif ($botStatus === 'error') {
                $this->telegram->notify('error', 'Error crítico del bot: ' . ($status['error'] ?? 'desconocido'));
            }
            Cache::forever($lastStatusKey, $botStatus);
        }
    }
}
