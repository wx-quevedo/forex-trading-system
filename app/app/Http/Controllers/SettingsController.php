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
        ]);

        Setting::put(Setting::CONTEXT_KEY, [
            'date_from' => $data['date_from'],
            'date_to' => $data['date_to'],
            'capital' => (float) $data['capital'],
        ]);

        return redirect()->route('settings.analysis-context')
            ->with('success', 'Contexto de análisis actualizado.');
    }
}
