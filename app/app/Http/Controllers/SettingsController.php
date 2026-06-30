<?php

namespace App\Http\Controllers;

use App\Models\Setting;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Ajustes globales. Por ahora: el CONTEXTO de análisis (Desde/Hasta/Capital) que
 * el Explorador y el Mapa de cobertura usan fijo, para mantener el caché consistente.
 */
class SettingsController extends Controller
{
    public function analysisContext(): Response
    {
        return Inertia::render('Settings/AnalysisContext', [
            'context' => Setting::analysisContext(),
        ]);
    }

    public function updateAnalysisContext(Request $request): RedirectResponse
    {
        $data = $request->validate([
            'date_from' => ['required', 'date'],
            'date_to' => ['required', 'date', 'after_or_equal:date_from'],
            'capital' => ['required', 'numeric', 'min:1'],
            // Rango de validación: posterior y SIN solape con el de optimización.
            // `after_or_equal:date_to` BLOQUEA el solape por diseño (no solo avisa) →
            // evita data leakage silencioso (validar sobre datos ya optimizados).
            'val_date_from' => ['required', 'date', 'after_or_equal:date_to'],
            'val_date_to' => ['required', 'date', 'after_or_equal:val_date_from'],
        ], [
            'val_date_from.after_or_equal' => 'La validación debe empezar en o después del fin de la optimización (sin solape, para no falsear el walk-forward con datos ya vistos).',
        ]);

        Setting::put(Setting::CONTEXT_KEY, [
            'date_from' => $data['date_from'],
            'date_to' => $data['date_to'],
            'capital' => (float) $data['capital'],
            'val_date_from' => $data['val_date_from'],
            'val_date_to' => $data['val_date_to'],
        ]);

        return redirect()->route('settings.analysis-context')
            ->with('success', 'Contexto de análisis actualizado.');
    }
}
