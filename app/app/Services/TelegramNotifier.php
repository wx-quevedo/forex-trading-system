<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Notificaciones del bot por Telegram (Fase 7).
 *
 * Setup: crea un bot con @BotFather (TELEGRAM_BOT_TOKEN); obtén tu chat_id con
 * https://api.telegram.org/bot<token>/getUpdates tras enviarle un mensaje
 * (TELEGRAM_CHAT_ID). Toggle global + por tipo de evento (persistidos en cache).
 */
class TelegramNotifier
{
    public const EVENTS = ['started', 'paused', 'resumed', 'stopped', 'trade_opened', 'trade_closed', 'daily_limit', 'circuit_breaker', 'arm_expired', 'heat_block', 'daily_summary', 'panic', 'error', 'restart'];

    private const CACHE_ENABLED = 'forexbot.telegram_enabled';
    private const CACHE_EVENTS = 'forexbot.telegram_events';

    public function isConfigured(): bool
    {
        return (string) config('forexbot.telegram.token') !== '' && (string) config('forexbot.telegram.chat_id') !== '';
    }

    public function globalEnabled(): bool
    {
        return (bool) Cache::get(self::CACHE_ENABLED, true);
    }

    /** @return array<string, bool> */
    public function eventToggles(): array
    {
        $stored = Cache::get(self::CACHE_EVENTS, []);

        return collect(self::EVENTS)->mapWithKeys(fn ($e) => [$e => (bool) ($stored[$e] ?? true)])->all();
    }

    /** @return array{configured: bool, enabled: bool, events: array<string, bool>} */
    public function settings(): array
    {
        return [
            'configured' => $this->isConfigured(),
            'enabled' => $this->globalEnabled(),
            'events' => $this->eventToggles(),
        ];
    }

    public function updateSettings(bool $enabled, array $events): void
    {
        Cache::forever(self::CACHE_ENABLED, $enabled);
        $clean = collect(self::EVENTS)->mapWithKeys(fn ($e) => [$e => (bool) ($events[$e] ?? true)])->all();
        Cache::forever(self::CACHE_EVENTS, $clean);
    }

    /** Notifica un evento (respeta configuración y toggles). Devuelve si se envió. */
    public function notify(string $event, string $text): bool
    {
        if (! $this->isConfigured() || ! $this->globalEnabled() || ! ($this->eventToggles()[$event] ?? false)) {
            return false;
        }

        try {
            $resp = Http::timeout(10)->post(
                'https://api.telegram.org/bot' . config('forexbot.telegram.token') . '/sendMessage',
                [
                    'chat_id' => config('forexbot.telegram.chat_id'),
                    'text' => $text,
                    'parse_mode' => 'HTML',
                    'disable_web_page_preview' => true,
                ],
            );

            return $resp->successful();
        } catch (Throwable) {
            return false;
        }
    }
}
