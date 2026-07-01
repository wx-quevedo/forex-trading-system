<?php

namespace App\Console\Commands;

use App\Services\PythonBridgeService;
use App\Services\TelegramNotifier;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * Notifica por Telegram los eventos NUEVOS del bot (aperturas/cierres/protecciones/errores).
 *
 * Sondea el journal persistente y el status del bridge (solo LECTURA → no toca el bot ni
 * lo pausa), compara contra lo ya visto (cache) y envía cada evento nuevo vía
 * TelegramNotifier, respetando el enable global y los toggles por-evento del panel.
 * Pensado para correr cada minuto por el planificador de Laravel.
 */
class BotNotify extends Command
{
    protected $signature = 'bot:notify';
    protected $description = 'Notifica por Telegram los eventos nuevos del bot (aperturas/cierres/protecciones)';

    private const K_JOURNAL = 'forexbot.notify.last_journal_ts';
    private const K_STATES = 'forexbot.notify.run_states';
    private const K_SUMMARY = 'forexbot.notify.last_summary';

    public function handle(PythonBridgeService $bridge, TelegramNotifier $tg): int
    {
        if (! $tg->isConfigured() || ! $tg->globalEnabled()) {
            return self::SUCCESS; // Telegram apagado → nada que hacer (sin coste).
        }

        $this->processJournal($bridge, $tg);
        $status = $this->processStatus($bridge, $tg);
        $this->maybeDailySummary($tg, $status);

        return self::SUCCESS;
    }

    /** Aperturas/cierres/arme caducado/bloqueos desde el journal persistente. */
    private function processJournal(PythonBridgeService $bridge, TelegramNotifier $tg): void
    {
        try {
            $entries = $bridge->botJournal(200)['entries'] ?? [];
        } catch (Throwable) {
            return;
        }
        if (! $entries) {
            return;
        }
        usort($entries, fn ($a, $b) => strcmp($a['ts'] ?? '', $b['ts'] ?? ''));
        $lastTs = Cache::get(self::K_JOURNAL);
        $newestTs = end($entries)['ts'] ?? $lastTs;

        // Primera corrida: fijar baseline sin notificar el histórico acumulado.
        if ($lastTs === null) {
            Cache::forever(self::K_JOURNAL, $newestTs);
            return;
        }

        foreach ($entries as $e) {
            if (($e['ts'] ?? '') <= $lastTs) {
                continue;
            }
            $tag = strtoupper($e['symbol'] ?? '?') . ' ' . ($e['strategy_type'] ?? '');
            match ($e['kind'] ?? '') {
                'open' => $tg->notify('trade_opened', "🟢 <b>Apertura</b> {$tag}\n"
                    . strtoupper($e['direction'] ?? '') . " {$e['volume']} @ {$e['entry']}\n"
                    . "SL {$e['sl']} ({$e['sl_dist_pips']}p) · TP {$e['tp']} ({$e['tp_dist_pips']}p)\n"
                    . 'riesgo $' . ($e['risk_usd'] ?? '?') . ' · ATR ' . ($e['atr_value'] ?? '?')),
                'close' => $tg->notify('trade_closed', ($this->pnl($e['pnl'] ?? 0) >= 0 ? '✅' : '🔴')
                    . " <b>Cierre</b> {$tag}\n" . strtoupper($e['direction'] ?? '') . " {$e['volume']} → {$e['close_price']}\n"
                    . 'PnL ' . $this->money($e['pnl'] ?? 0) . ' · ' . ($e['close_reason'] ?? '')),
                'arm_expired' => $tg->notify('arm_expired', "⏸️ <b>Arme caducado</b> {$tag}\n"
                    . ($e['hours'] ?? '?') . 'h sin señal → pausada por seguridad'),
                'blocked' => $tg->notify('heat_block', "⚠️ <b>No abrió</b> {$tag}\n" . ($e['reason'] ?? '')),
                default => null,
            };
        }
        Cache::forever(self::K_JOURNAL, $newestTs);
    }

    /** Cambios de estado por-estrategia → protecciones (CB/límite diario) y errores. */
    private function processStatus(PythonBridgeService $bridge, TelegramNotifier $tg): array
    {
        try {
            $status = $bridge->botStatus();
        } catch (Throwable) {
            return [];
        }
        $prev = Cache::get(self::K_STATES, []);
        $cur = [];
        $first = empty($prev);
        foreach ($status['runs'] ?? [] as $r) {
            $sid = (string) ($r['strategy_id'] ?? '');
            $st = $r['status'] ?? '';
            $reason = (string) ($r['stop_reason'] ?? '');
            $err = (string) ($r['error'] ?? '');
            $cur[$sid] = ['status' => $st, 'reason' => $reason, 'error' => $err];
            $p = $prev[$sid] ?? null;
            if ($first || ! $p) {
                continue; // baseline: no notificar el estado inicial
            }
            if ($p['status'] === $st && $p['reason'] === $reason && $p['error'] === $err) {
                continue;
            }
            $tag = strtoupper(($r['strategy']['symbol'] ?? '?')) . ' ' . ($r['strategy']['timeframe'] ?? '');
            if ($err && $err !== $p['error']) {
                $tg->notify('error', "❗ <b>Error</b> {$tag}\n{$err}");
            } elseif ($st === 'stopped' && str_contains($reason, 'diaria')) {
                $tg->notify('daily_limit', "🛑 <b>Límite diario</b> {$tag}\n{$reason}");
            } elseif ($st === 'paused' && (str_contains($reason, 'racha') || str_contains($reason, 'drawdown') || str_contains($reason, 'breaker'))) {
                $tg->notify('circuit_breaker', "⏸️ <b>Circuit breaker</b> {$tag}\n{$reason}");
            } elseif ($st === 'paused' && str_contains($reason, 'caducado')) {
                $tg->notify('arm_expired', "⏸️ <b>Arme caducado</b> {$tag}\n{$reason}");
            } elseif ($st === 'paused') {
                $tg->notify('paused', "⏸️ <b>Pausada</b> {$tag}" . ($reason ? "\n{$reason}" : ''));
            } elseif ($st === 'running' && $p['status'] !== 'running') {
                $tg->notify('resumed', "▶️ <b>Reanudada</b> {$tag}");
            }
        }
        Cache::forever(self::K_STATES, $cur);
        return $status;
    }

    /** Un resumen al día (PnL del día + nº posiciones), a partir de las 22:00 UTC. */
    private function maybeDailySummary(TelegramNotifier $tg, array $status): void
    {
        $today = now()->toDateString();
        if (Cache::get(self::K_SUMMARY) === $today || now()->hour < 22) {
            return;
        }
        $runs = $status['runs'] ?? [];
        $lines = [];
        $total = 0.0;
        foreach ($runs as $r) {
            $pnl = (float) ($r['daily_pnl'] ?? 0);
            $total += $pnl;
            $lines[] = ($r['strategy']['symbol'] ?? '?') . ': ' . $this->money($pnl) . ' · ' . ($r['open_positions'] ?? 0) . ' pos';
        }
        $tg->notify('daily_summary', "📊 <b>Resumen {$today}</b>\nPnL día: " . $this->money($total) . "\n" . implode("\n", $lines));
        Cache::forever(self::K_SUMMARY, $today);
    }

    private function pnl($v): float
    {
        return (float) $v;
    }

    private function money($v): string
    {
        $v = (float) $v;
        return ($v >= 0 ? '+$' : '-$') . number_format(abs($v), 2);
    }
}
