<?php

namespace App\Services;

use Anthropic\Client;
use GuzzleHttp\Client as GuzzleClient;
use RuntimeException;
use Throwable;

/**
 * Cliente de la API de Anthropic (Claude) para el Análisis IA (Módulo 4 / Fase 6).
 *
 * Usa el SDK oficial `anthropic-ai/sdk`. El contexto del backtest (estable durante
 * la conversación) se envía en `system` con prompt caching; los turnos del chat van
 * en `messages`. Se pide a Claude que devuelva un bloque ```json con
 * `suggested_parameters` cuando propone un ajuste, que parseamos para crear versiones.
 */
class ClaudeService
{
    /** Timeout (s) para la llamada a la API: thinking + respuesta larga pueden tardar. */
    public const TIMEOUT = 180;

    private const SYSTEM_INSTRUCTIONS = <<<'TXT'
        Eres un analista cuantitativo experto en trading algorítmico de forex. Recibes
        los resultados de un backtest (estrategia, parámetros, métricas y una muestra de
        trades) y ayudas al usuario a interpretarlos y a mejorar la estrategia.

        Pautas:
        - Sé concreto, cuantitativo y honesto sobre los riesgos (overfitting, drawdown,
          número de trades insuficiente, etc.).
        - Razona sobre las métricas reales que se te dan; no inventes datos.
        - Cuando propongas un ajuste de parámetros, termina tu respuesta con un bloque de
          código ```json que contenga exactamente {"suggested_parameters": { ... }},
          usando las MISMAS claves de indicadores que la estrategia actual
          (por ejemplo fast_period, slow_period, period, oversold, overbought...).
        - Si no propones cambios de parámetros, NO incluyas el bloque JSON.
        - Responde en español.
        TXT;

    public function __construct(
        private readonly string $apiKey,
        private readonly string $model,
    ) {}

    public static function fromConfig(): self
    {
        return new self(
            (string) config('forexbot.anthropic.api_key'),
            (string) config('forexbot.anthropic.model', 'claude-sonnet-4-6'),
        );
    }

    public function isConfigured(): bool
    {
        return $this->apiKey !== '';
    }

    /**
     * Envía el contexto del backtest + el historial de chat + el mensaje del usuario a
     * Claude y devuelve {text, suggested_parameters, model, usage}.
     *
     * @param  array<string, mixed>  $context  Contexto del backtest (estrategia + métricas + trades).
     * @param  array<int, array{role: string, content: string}>  $history  Turnos previos.
     */
    public function analyze(array $context, array $history, string $userMessage): array
    {
        if (! $this->isConfigured()) {
            throw new RuntimeException('ANTHROPIC_API_KEY no configurada en el backend.');
        }

        // Transporter Guzzle explícito con timeout amplio: el SDK no fuerza su
        // `timeout` sobre el cliente PSR-18, así que lo fijamos aquí para que Guzzle
        // no corte la conexión antes de que Claude termine (thinking + respuesta larga).
        $client = new Client(
            apiKey: $this->apiKey,
            requestOptions: [
                'transporter' => new GuzzleClient([
                    'timeout' => self::TIMEOUT,
                    'connect_timeout' => 15,
                ]),
                'timeout' => self::TIMEOUT,
            ],
        );

        $messages = [];
        foreach ($history as $turn) {
            $messages[] = ['role' => $turn['role'], 'content' => $turn['content']];
        }
        $messages[] = ['role' => 'user', 'content' => $userMessage];

        $contextJson = json_encode($context, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        try {
            $response = $client->messages->create(
                maxTokens: 8192,
                model: $this->model,
                // Thinking DESACTIVADO a propósito: con adaptive thinking un prompt
                // exigente puede gastar todo el presupuesto de maxTokens razonando y
                // dejar la respuesta visible vacía. Sin thinking, los 8192 tokens van
                // íntegros al análisis -> respuestas completas y más rápidas.
                thinking: ['type' => 'disabled'],
                system: [
                    ['type' => 'text', 'text' => self::SYSTEM_INSTRUCTIONS],
                    // El contexto es estable durante la conversación -> se cachea.
                    [
                        'type' => 'text',
                        'text' => "Datos del backtest a analizar:\n{$contextJson}",
                        'cacheControl' => ['type' => 'ephemeral'],
                    ],
                ],
                messages: $messages,
            );
        } catch (Throwable $e) {
            throw new RuntimeException('Error llamando a la API de Anthropic: ' . $e->getMessage(), previous: $e);
        }

        $text = '';
        foreach ($response->content as $block) {
            if (($block->type ?? null) === 'text') {
                $text .= $block->text;
            }
        }

        return [
            'text' => trim($text),
            'suggested_parameters' => $this->extractSuggestedParameters($text),
            'model' => $response->model ?? $this->model,
            'usage' => [
                'input_tokens' => $response->usage->inputTokens ?? null,
                'output_tokens' => $response->usage->outputTokens ?? null,
            ],
        ];
    }

    /** Extrae {suggested_parameters} del último bloque ```json de la respuesta. */
    private function extractSuggestedParameters(string $text): ?array
    {
        if (! preg_match_all('/```json\s*(\{.*?\})\s*```/s', $text, $matches)) {
            return null;
        }
        $last = end($matches[1]);
        $data = json_decode($last, true);

        if (is_array($data) && isset($data['suggested_parameters']) && is_array($data['suggested_parameters'])) {
            return $data['suggested_parameters'];
        }

        return null;
    }
}
