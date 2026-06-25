<?php

namespace App\Services;

use App\Models\Backtest;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * Modo de afinamiento manual (Fase 6B): genera el prompt para pegar en Claude.ai
 * y valida/aplica el JSON que el usuario pega de vuelta. No consume API de Anthropic.
 */
class ManualTuningService
{
    public function __construct(private readonly PythonBridgeService $bridge) {}

    /** Esquemas de estrategia (del bridge), cacheados para funcionar sin conexión. */
    public function schemas(): array
    {
        try {
            return Cache::remember('forexbot.strategy_schemas', now()->addDay(), fn () => $this->bridge->strategyTypes());
        } catch (Throwable) {
            return Cache::get('forexbot.strategy_schemas', []);
        }
    }

    public function schemaFor(string $type): ?array
    {
        return $this->schemas()[$type] ?? null;
    }

    // --- Paso 1: construir el prompt -------------------------------------
    public function buildPrompt(Backtest $backtest): string
    {
        $strategy = $backtest->strategy;
        $params = $strategy->parameters ?? [];

        return $this->buildPromptFromState(
            name: $strategy->name,
            type: $params['type'] ?? 'ma_cross',
            pair: $strategy->pair,
            timeframe: $strategy->timeframe,
            indicators: $params['indicators'] ?? [],
            metrics: $backtest->result_metrics ?? [],
            from: $backtest->date_from->toDateString(),
            to: $backtest->date_to->toDateString(),
        );
    }

    /**
     * Construye el prompt a partir de un estado arbitrario (lo usa el workbench con
     * los parámetros editados en vivo y las métricas de la última corrida).
     *
     * @param  array<string, mixed>  $indicators
     * @param  array<string, mixed>  $metrics
     */
    public function buildPromptFromState(
        string $name,
        string $type,
        string $pair,
        string $timeframe,
        array $indicators,
        array $metrics,
        string $from,
        string $to,
    ): string {
        $m = $metrics;
        $current = json_encode($indicators, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        $schema = $this->schemaFor($type);
        $schemaTxt = $schema
            ? json_encode($schema['fields'] ?? $schema, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
            : '(esquema no disponible: el bridge no respondió; usa valores razonables del mismo tipo)';

        $metric = fn (string $k, string $fb = '—') => array_key_exists($k, $m) ? (string) $m[$k] : $fb;
        $months = $m['pnl_by_month'] ?? [];
        $monthsTxt = $months ? json_encode($months, JSON_UNESCAPED_UNICODE) : '—';

        return <<<TXT
            Eres un experto en trading algorítmico. Analiza el resultado de este backtest
            y sugiere ajustes a los parámetros de la estrategia para mejorar su rendimiento.

            ESTRATEGIA ACTUAL
            - Nombre: {$name}
            - Tipo: {$type}
            - Par: {$pair}  ·  Timeframe: {$timeframe}
            - Parámetros actuales:
            {$current}
            - Esquema de parámetros válidos (rangos y tipos permitidos):
            {$schemaTxt}

            RESULTADO DEL BACKTEST
            - Periodo: {$from} a {$to}
            - Total trades: {$metric('total_trades')}
            - Win rate: {$metric('win_rate')}
            - Profit factor: {$metric('profit_factor')}
            - Net PnL: {$metric('net_pnl')}
            - Return: {$metric('return_pct')}%
            - Max drawdown: {$metric('max_drawdown_pct')}% ({$metric('max_drawdown_abs')} abs)
            - Sharpe: {$metric('sharpe')}  ·  Sortino: {$metric('sortino')}
            - Racha ganadora máx: {$metric('max_win_streak')}  ·  Racha perdedora máx: {$metric('max_loss_streak')}
            - Avg win: {$metric('avg_win')}  ·  Avg loss: {$metric('avg_loss')}
            - PnL por mes: {$monthsTxt}

            INSTRUCCIONES DE RESPUESTA
            Responde ÚNICAMENTE con un bloque JSON válido (sin texto adicional antes ni después)
            con esta estructura exacta:

            {
              "diagnostico": "explicación breve de qué está fallando en la estrategia",
              "parametros_sugeridos": {
                // solo los parámetros del mismo tipo de estrategia, con sus nuevos valores
                // deben respetar el esquema de parámetros válidos de arriba
              },
              "riesgo_sugerido": {
                "sl_pips": 0,
                "tp_pips": 0,
                "risk_percent": 0
              },
              "justificacion": "por qué estos cambios deberían mejorar el rendimiento",
              "confianza": "alta | media | baja"
            }
            TXT;
    }

    // --- Paso 2: parsear + validar el JSON pegado ------------------------
    /**
     * Extrae el primer objeto JSON balanceado de un texto (tolera ruido alrededor).
     */
    public function extractJson(string $raw): ?string
    {
        $start = strpos($raw, '{');
        if ($start === false) {
            return null;
        }
        $depth = 0;
        $inStr = false;
        $esc = false;
        for ($i = $start, $len = strlen($raw); $i < $len; $i++) {
            $ch = $raw[$i];
            if ($inStr) {
                if ($esc) {
                    $esc = false;
                } elseif ($ch === '\\') {
                    $esc = true;
                } elseif ($ch === '"') {
                    $inStr = false;
                }
                continue;
            }
            if ($ch === '"') {
                $inStr = true;
            } elseif ($ch === '{') {
                $depth++;
            } elseif ($ch === '}') {
                $depth--;
                if ($depth === 0) {
                    return substr($raw, $start, $i - $start + 1);
                }
            }
        }
        return null;
    }

    /**
     * Valida el JSON pegado contra el tipo/esquema de la estrategia.
     *
     * @return array{ok: bool, errors: array<int,string>, indicators: array, risk: array, parsed: array}
     */
    public function validate(Backtest $backtest, string $raw): array
    {
        $params = $backtest->strategy->parameters ?? [];

        return $this->validateForType($params['type'] ?? 'ma_cross', $params['indicators'] ?? [], $raw);
    }

    /**
     * Valida el JSON pegado contra un tipo de estrategia y sus indicadores actuales.
     * Usada por el modo manual (6B) y por el workbench (6C, con params en vivo).
     */
    public function validateForType(string $type, array $currentInd, string $raw): array
    {
        $errors = [];
        $json = $this->extractJson($raw);
        if ($json === null) {
            return ['ok' => false, 'errors' => ['El texto pegado no es un JSON válido. Asegúrate de copiar el bloque JSON.'], 'indicators' => [], 'risk' => [], 'parsed' => []];
        }
        $data = json_decode($json, true);
        if (! is_array($data)) {
            return ['ok' => false, 'errors' => ['No se pudo decodificar el JSON pegado.'], 'indicators' => [], 'risk' => [], 'parsed' => []];
        }

        $suggested = $data['parametros_sugeridos'] ?? null;
        if (! is_array($suggested) || $suggested === []) {
            $errors[] = 'Falta el objeto "parametros_sugeridos" o está vacío.';
        }

        $schema = $this->schemaFor($type);
        $fields = [];
        if ($schema) {
            foreach (($schema['fields'] ?? []) as $f) {
                $fields[$f['name']] = $f;
            }
        }

        $indicators = [];
        foreach ((array) ($suggested ?? []) as $key => $value) {
            // La clave debe pertenecer al tipo de estrategia.
            $known = $fields ? isset($fields[$key]) : array_key_exists($key, $currentInd);
            if (! $known) {
                $errors[] = "Parámetro no válido para una estrategia de tipo '{$type}': '{$key}'.";
                continue;
            }
            $field = $fields[$key] ?? null;
            if ($field && ($field['type'] ?? 'number') === 'select') {
                $opts = array_column($field['options'] ?? [], 'value');
                if (! in_array($value, $opts, true)) {
                    $errors[] = "Valor inválido para '{$key}': debe ser uno de " . implode(', ', $opts) . '.';
                    continue;
                }
                $indicators[$key] = $value;
            } else {
                if (! is_numeric($value)) {
                    $errors[] = "El parámetro '{$key}' debe ser numérico.";
                    continue;
                }
                $num = $value + 0;
                if ($field && isset($field['min']) && $num < $field['min']) {
                    $errors[] = "'{$key}' = {$num} está por debajo del mínimo ({$field['min']}).";
                    continue;
                }
                if ($field && isset($field['max']) && $num > $field['max']) {
                    $errors[] = "'{$key}' = {$num} supera el máximo ({$field['max']}).";
                    continue;
                }
                $indicators[$key] = $num;
            }
        }

        // Riesgo (opcional; límites sanos).
        $risk = [];
        $rs = $data['riesgo_sugerido'] ?? [];
        if (is_array($rs)) {
            foreach (['sl_pips', 'tp_pips', 'risk_percent'] as $k) {
                if (! array_key_exists($k, $rs) || $rs[$k] === null || $rs[$k] === '') {
                    continue;
                }
                if (! is_numeric($rs[$k])) {
                    $errors[] = "Riesgo '{$k}' debe ser numérico.";
                    continue;
                }
                $v = $rs[$k] + 0;
                if ($v <= 0) {
                    $errors[] = "Riesgo '{$k}' debe ser mayor que 0.";
                    continue;
                }
                if ($k === 'risk_percent' && $v > 5) {
                    $errors[] = 'risk_percent no debe superar 5%.';
                    continue;
                }
                $risk[$k] = $v;
            }
        }

        if ($indicators === [] && $risk === []) {
            $errors[] = 'No hay ningún cambio de parámetros o riesgo aplicable.';
        }

        return [
            'ok' => $errors === [],
            'errors' => $errors,
            'indicators' => $indicators,
            'risk' => $risk,
            'parsed' => $data,
        ];
    }

    /**
     * Diff antes/después de indicadores + riesgo.
     *
     * @return array<int, array{key: string, group: string, old: mixed, new: mixed, changed: bool}>
     */
    public function diff(Backtest $backtest, array $indicators, array $risk): array
    {
        $params = $backtest->strategy->parameters ?? [];
        $rows = [];
        foreach (array_merge($params['indicators'] ?? [], $indicators) as $key => $_) {
            $old = $params['indicators'][$key] ?? null;
            $new = $indicators[$key] ?? $old;
            $rows[] = ['key' => $key, 'group' => 'indicadores', 'old' => $old, 'new' => $new, 'changed' => $this->changed($old, $new)];
        }
        foreach (['sl_pips', 'tp_pips', 'risk_percent'] as $key) {
            $old = $params['risk'][$key] ?? null;
            $new = $risk[$key] ?? $old;
            if ($old === null && $new === null) {
                continue;
            }
            $rows[] = ['key' => $key, 'group' => 'riesgo', 'old' => $old, 'new' => $new, 'changed' => $this->changed($old, $new)];
        }
        return $rows;
    }

    private function changed(mixed $old, mixed $new): bool
    {
        if (is_numeric($old) && is_numeric($new)) {
            return abs(($old + 0) - ($new + 0)) > 1e-9;
        }
        return (string) $old !== (string) $new;
    }
}
