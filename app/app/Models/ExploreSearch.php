<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Búsqueda guardada del Explorador (Fase 8E): su configuración + el reporte
 * completo de resultados, para reabrirla sin recalcular.
 */
class ExploreSearch extends Model
{
    protected $fillable = ['name', 'config', 'results', 'total', 'inside'];

    protected $casts = [
        'config' => 'array',
        'results' => 'array',
    ];
}
