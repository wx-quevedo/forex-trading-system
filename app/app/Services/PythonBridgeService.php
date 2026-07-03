<?php

namespace App\Services;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Cache;
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

    private function client(?int $timeout = null): PendingRequest
    {
        return Http::baseUrl($this->baseUrl)
            ->withHeaders(['X-API-Key' => $this->apiKey])
            ->timeout($timeout ?? $this->timeout)
            ->acceptJson();
    }

    /**
     * Ejecuta una petición y devuelve el JSON, traduciendo errores del bridge
     * a una excepción con el mensaje original para que el caller decida.
     */
    private function request(string $method, string $uri, array $options = [], ?int $timeout = null): mixed
    {
        try {
            $response = $this->client($timeout)->send($method, $uri, $options);
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
    public function health(?int $timeout = null): array
    {
        // /health no requiere API key. Timeout override para chequeos de salud (corto).
        return Http::baseUrl($this->baseUrl)->timeout($timeout ?? $this->timeout)
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

    public function symbolInfo(string $symbol): array
    {
        return $this->request('GET', '/symbol/' . rawurlencode($symbol));
    }

    public function symbolSession(string $symbol): array
    {
        return $this->request('GET', '/symbol/' . rawurlencode($symbol) . '/session');
    }

    /**
     * Nombres de símbolos operables del broker (excluye las ~1300 acciones para
     * un selector usable): Forex, derivados, cripto e índices. Cacheado 1 hora.
     *
     * @return list<string>
     */
    public function tradableSymbolNames(): array
    {
        return Cache::remember('forexbot.tradable_symbols', now()->addHour(), function () {
            return collect($this->symbols())
                // Solo símbolos OPERABLES (trade_mode != 0): excluye las variantes
                // solo-datos (p.ej. EURUSD trade_mode=0) y deja las operables (EURUSD#).
                ->reject(fn ($s) => (int) ($s['trade_mode'] ?? 0) === 0)
                ->reject(fn ($s) => str_starts_with((string) ($s['path'] ?? ''), 'Stocks'))
                ->pluck('name')
                ->filter()
                ->unique()
                ->sort()
                ->values()
                ->all();
        });
    }

    // --- Mercado ---------------------------------------------------------
    public function price(string $symbol): array
    {
        // rawurlencode: símbolos con sufijo '#' (GOLD#, US500Cash#) si no, el '#' se
        // interpreta como fragmento de URL y el bridge recibe el símbolo truncado.
        return $this->request('GET', '/price/' . rawurlencode($symbol));
    }

    public function candles(string $symbol, array $query = []): array
    {
        // $query: timeframe, from, to, count
        // rawurlencode: el '#' de los símbolos de XM (GOLD#, US500Cash#) si va crudo en
        // la ruta se trata como fragmento de URL → el bridge recibiría 'GOLD' truncado.
        return $this->request('GET', '/candles/' . rawurlencode($symbol), ['query' => $query]);
    }

    /** Régimen de mercado del periodo (Fase 3). $query: timeframe, from, to, count. */
    public function marketRegime(string $symbol, array $query = []): array
    {
        return $this->request('GET', '/market/regime/' . rawurlencode($symbol), ['query' => $query], timeout: 30);
    }

    /** Calendario económico — eventos en un periodo (Fase 6). $query: from, to, symbol, impact. */
    public function calendarEvents(array $query = []): array
    {
        return $this->request('GET', '/calendar/events', ['query' => $query], timeout: 30);
    }

    /** Calendario económico — próximos eventos del símbolo (Fase 6). $query: symbol, hours, impact. */
    public function calendarUpcoming(array $query = []): array
    {
        return $this->request('GET', '/calendar/upcoming', ['query' => $query], timeout: 30);
    }

    /** Matriz de correlación entre estrategias (Fase 7). $body: labels, series. */
    public function portfolioCorrelation(array $body): array
    {
        return $this->request('POST', '/portfolio/correlation', ['json' => $body], timeout: 30);
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

    // --- Motor de estrategias (Módulo 2) ---------------------------------
    /** Tipos de estrategia disponibles y sus parámetros configurables. */
    public function strategyTypes(): array
    {
        return $this->request('GET', '/strategy/types');
    }

    /**
     * Evalúa una estrategia sobre los datos actuales de MT5.
     *
     * @param  array<string, mixed>  $params  Parámetros del indicador.
     */
    public function evaluateStrategy(
        string $type,
        array $params,
        string $symbol,
        string $timeframe = 'H1',
        int $count = 300,
    ): array {
        return $this->request('POST', '/strategy/evaluate', [
            'json' => [
                'type' => $type,
                'params' => (object) $params,
                'symbol' => $symbol,
                'timeframe' => $timeframe,
                'count' => $count,
            ],
        ]);
    }

    // --- Backtesting (Módulo 3) ------------------------------------------
    /**
     * Ejecuta un backtest sobre datos históricos de MT5.
     *
     * @param  array<string, mixed>  $params  Parámetros del indicador.
     * @param  array<string, mixed>  $risk    sl_pips, tp_pips, risk_percent.
     */
    public function runBacktest(
        string $type,
        array $params,
        string $symbol,
        string $timeframe,
        string $from,
        string $to,
        array $risk = [],
        array $config = [],
    ): array {
        return $this->request('POST', '/backtest/run', [
            'json' => [
                'type' => $type,
                'params' => (object) $params,
                'symbol' => $symbol,
                'timeframe' => $timeframe,
                'from' => $from,
                'to' => $to,
                'risk' => (object) $risk,
                'config' => (object) $config,
            ],
        ], timeout: 120); // el backtest puede tardar; ampliamos el timeout.
    }

    // --- Bot en vivo (Módulo 5 / Fase 7) ---------------------------------
    /** @param array<string, mixed> $config */
    public function botStart(array $config): array
    {
        return $this->request('POST', '/bot/start', ['json' => $config]);
    }

    public function botPause(?int $strategyId = null): array
    {
        return $this->request('POST', '/bot/pause', ['json' => ['strategy_id' => $strategyId]]);
    }

    public function botResume(?int $strategyId = null): array
    {
        return $this->request('POST', '/bot/resume', ['json' => ['strategy_id' => $strategyId]]);
    }

    public function botStop(?int $strategyId = null): array
    {
        return $this->request('POST', '/bot/stop', ['json' => ['strategy_id' => $strategyId]]);
    }

    public function botRemove(int $strategyId): array
    {
        return $this->request('POST', '/bot/remove', ['json' => ['strategy_id' => $strategyId]]);
    }

    /** PANIC: cierra todas las posiciones. Timeout amplio por si hay varias. */
    public function botPanic(): array
    {
        return $this->request('POST', '/bot/panic', [], timeout: 60);
    }

    public function botStatus(): array
    {
        return $this->request('GET', '/bot/status');
    }

    /** Señales del ciclo de vida del bridge (arranques/uptime SO/pausa-por-reinicio) para bot:autoresume. */
    public function botLifecycle(?int $timeout = null): array
    {
        return $this->request('GET', '/bot/lifecycle', [], $timeout);
    }

    /** Preview de fidelidad (Fase 1): SL/TP/lote que el ejecutor usaría, sin operar. Timeout amplio (corre backtests). */
    public function botPreview(): array
    {
        return $this->request('GET', '/bot/preview', timeout: 60);
    }

    /** Preview ad-hoc (estrategias aún no iniciadas, p.ej. el diálogo de confirmar). @param array<int, array<string, mixed>> $rows */
    public function botPreviewSpec(array $rows): array
    {
        return $this->request('POST', '/bot/preview', ['json' => ['rows' => $rows]], timeout: 90);
    }

    /** Journal PERSISTENTE del bot (aperturas/cierres; sobrevive reinicios y corte de día). */
    public function botJournal(int $limit = 200): array
    {
        return $this->request('GET', '/bot/journal', ['query' => ['limit' => $limit]], timeout: 20);
    }

    // --- Optimización automática (Fase 8A) -------------------------------
    /** @param array<string, mixed> $params @param array<string, mixed> $risk */
    public function optimize(string $type, array $params, string $symbol, string $timeframe, string $from, string $to, array $risk = [], float $split = 0.7, array $config = []): array
    {
        return $this->request('POST', '/optimize', ['json' => [
            'type' => $type, 'params' => $params, 'symbol' => $symbol, 'timeframe' => $timeframe,
            'from' => $from, 'to' => $to, 'risk' => $risk, 'split' => $split, 'config' => (object) $config,
        ]], timeout: 300); // el barrido corre decenas de backtests.
    }

    // --- Buscador de estrategias (Fase 8E) -------------------------------
    /** Opciones del buscador: grids por tipo, choices SL/TP/riesgo, tope de seguridad. */
    public function exploreMeta(): array
    {
        return $this->request('GET', '/explore/meta');
    }

    /** Inicia el barrido en segundo plano (devuelve al instante). @param array<string,mixed> $payload */
    public function exploreStart(array $payload): array
    {
        return $this->request('POST', '/explore/start', ['json' => $payload]);
    }

    /** Progreso de la búsqueda en curso (sin resultados, ligero para sondeo). */
    public function exploreStatus(): array
    {
        return $this->request('GET', '/explore/status');
    }

    /** Reporte completo de la última búsqueda. */
    public function exploreResults(): array
    {
        return $this->request('GET', '/explore/results', [], timeout: 60);
    }

    /**
     * Reporte completo como STRING JSON crudo (sin decodificar a array PHP). Para
     * /explorer/results: con muchas combinaciones el reporte pesa decenas de MB; si
     * PHP lo decodifica a array y lo re-serializa, agota la memoria (FatalError 128MB).
     * Devuelve el STREAM (PSR-7) del body del bridge SIN leerlo entero a memoria.
     *
     * El reporte puede pesar decenas de MB (decenas de miles de filas). Materializarlo
     * como string en PHP (aun crudo) agota los 128 MB con copias de Symfony Response.
     * El controlador lo canaliza en trozos al cliente → memoria PHP plana sea cual sea
     * el tamaño. La cabecera de respuesta (status) ya está disponible aquí sin leer el
     * body (Guzzle con stream=true), así que un error del bridge se traduce antes de
     * empezar a transmitir.
     */
    public function exploreResultsStream(): \Psr\Http\Message\StreamInterface
    {
        $response = $this->client(60)->withOptions(['stream' => true])->get('/explore/results');
        if ($response->failed()) {
            $body = $response->json();   // error: body pequeño, leerlo es seguro
            $message = $body['error'] ?? $body['detail'] ?? 'Error del bridge';
            throw new BridgeException(is_string($message) ? $message : json_encode($message), $response->status(), $body);
        }

        return $response->toPsrResponse()->getBody();
    }

    /** Desglose del score de Prioridad de UNA fila (on-demand para la modal). */
    public function exploreScore(array $payload): array
    {
        return $this->request('POST', '/explore/score', ['json' => $payload], timeout: 30);
    }

    /** Valida el top-N en un rango posterior (walk-forward). Timeout amplio: corre N backtests. */
    public function exploreValidate(array $payload): array
    {
        return $this->request('POST', '/explore/validate', ['json' => $payload], timeout: 180);
    }

    /** Cancela la búsqueda en curso. */
    public function exploreCancel(): array
    {
        return $this->request('POST', '/explore/cancel');
    }

    /** Carga del sistema y del proceso del bridge (CPU/RAM) vía psutil. */
    public function systemStats(): array
    {
        return $this->request('GET', '/system/stats');
    }

    /** Mapa de cobertura jerárquico del Explorador (qué se ha explorado). */
    public function exploreCoverage(array $query): array
    {
        return $this->request('GET', '/explore/coverage', ['query' => $query], timeout: 30);
    }
}
