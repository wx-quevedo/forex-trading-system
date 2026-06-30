<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Ajustes globales clave/valor. Incluye la "marca" de CONTEXTO de análisis
 * (Desde/Hasta/Capital) que el Explorador y el Mapa de cobertura usan fija, para
 * que el caché siempre acierte (mismo periodo+capital → misma clave).
 */
class Setting extends Model
{
    protected $primaryKey = 'key';
    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = ['key', 'value'];
    protected $casts = ['value' => 'array'];

    /** Fechas FIJAS por defecto (no "hoy" dinámico: rompería el caché entre días). */
    public const CONTEXT_KEY = 'analysis_context';
    public const CONTEXT_DEFAULTS = [
        'date_from' => '2025-01-01',
        'date_to' => '2025-12-31',
        'capital' => 10000,
        // Rango de VALIDACIÓN walk-forward: posterior y SIN solape con el de optimización
        // (datos que el Explorador no optimiza). Regla: val_date_from >= date_to.
        'val_date_from' => '2026-01-01',
        'val_date_to' => '2026-06-27',
    ];

    public static function get(string $key, mixed $default = null): mixed
    {
        return static::query()->find($key)->value ?? $default;
    }

    public static function put(string $key, mixed $value): void
    {
        static::query()->updateOrCreate(['key' => $key], ['value' => $value]);
    }

    /** Contexto global de análisis (con defaults si nunca se configuró). */
    public static function analysisContext(): array
    {
        return array_merge(self::CONTEXT_DEFAULTS, (array) self::get(self::CONTEXT_KEY, []));
    }
}
