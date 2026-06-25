<?php

namespace App\Services;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Cliente HTTP del bridge Python FastAPI (Capa de Mercado, Módulo 1).
 *
 * El bridge corre en la tower Windows local (MT5) y se accede de forma privada
 * vía Tailscale desde el VPS. La autenticación es por header X-API-Key.
 */
class PythonBridgeService
{
    public function __construct(
        private readonly string $baseUrl,
        private readonly string $apiKey,
        private readonly int $timeout = 15,
    ) {}

    public static function fromConfig(): self
    {
        return new self(
            rtrim((string) config('forexbot.bridge.url'), '/'),
            (string) config('forexbot.bridge.api_key'),
            (int) config('forexbot.bridge.timeout', 15),
        );
    }

    private function client(): PendingRequest
    {
        return Http::baseUrl($this->baseUrl)
            ->withHeaders(['X-API-Key' => $this->apiKey])
            ->timeout($this->timeout)
            ->acceptJson();
    }

    /**
     * Ejecuta una petición y devuelve el JSON, traduciendo errores del bridge
     * a una excepción con el mensaje original para que el caller decida.
     */
    private function request(string $method, string $uri, array $options = []): mixed
    {
        try {
            $response = $this->client()->send($method, $uri, $options);
        } catch (RequestException $e) {
            throw new RuntimeException("Bridge no accesible: {$e->getMessage()}", previous: $e);
        }

        if ($response->failed()) {
            $body = $response->json();
            $message = $body['error'] ?? $body['detail'] ?? $response->body();
            throw new BridgeException(
                is_string($message) ? $message : json_encode($message),
                $response->status(),
                $body,
            );
        }

        return $response->json();
    }

    // --- Salud -----------------------------------------------------------
    public function health(): array
    {
        // /health no requiere API key.
        return Http::baseUrl($this->baseUrl)->timeout($this->timeout)
            ->acceptJson()->get('/health')->json() ?? [];
    }

    // --- Cuenta / símbolos ----------------------------------------------
    public function account(): array
    {
        return $this->request('GET', '/account');
    }

    public function symbols(?string $group = null): array
    {
        return $this->request('GET', '/symbols', $group ? ['query' => ['group' => $group]] : []);
    }

    // --- Mercado ---------------------------------------------------------
    public function price(string $symbol): array
    {
        return $this->request('GET', "/price/{$symbol}");
    }

    public function candles(string $symbol, array $query = []): array
    {
        // $query: timeframe, from, to, count
        return $this->request('GET', "/candles/{$symbol}", ['query' => $query]);
    }

    public function positions(?string $symbol = null): array
    {
        return $this->request('GET', '/positions', $symbol ? ['query' => ['symbol' => $symbol]] : []);
    }

    public function orders(?string $symbol = null): array
    {
        return $this->request('GET', '/orders', $symbol ? ['query' => ['symbol' => $symbol]] : []);
    }

    public function history(?string $from = null, ?string $to = null): array
    {
        $query = array_filter(['from' => $from, 'to' => $to]);
        return $this->request('GET', '/history', ['query' => $query]);
    }

    // --- Trading ---------------------------------------------------------
    public function sendOrder(array $order): array
    {
        // $order: symbol, type (BUY|SELL), volume, price?, sl?, tp?, deviation?, comment?, magic?
        return $this->request('POST', '/order', ['json' => $order]);
    }

    public function closePosition(int $ticket): array
    {
        return $this->request('DELETE', "/position/{$ticket}");
    }
}
