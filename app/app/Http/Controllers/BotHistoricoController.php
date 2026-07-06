<?php

namespace App\Http\Controllers;

use App\Models\Favorite;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Bot Histórico (Fase 9): validación walk-forward. La simulación de cada estrategia
 * sobre el periodo de operación reusa /backtests/ephemeral (mismo motor honesto:
 * costos reales, quiebra, etc.); este controlador solo sirve la página + favoritos.
 */
class BotHistoricoController extends Controller
{
    public function show(): Response
    {
        return Inertia::render('BotHistorico', [
            // SOLO forex: la simulación corre por /backtests/ephemeral (bridge MT5);
            // un favorito cripto aquí produciría basura silenciosa. (Todo lo existente
            // es market='forex' por default => comportamiento idéntico.)
            'favorites' => Favorite::query()->where('market', 'forex')->latest()->get(),
            'defaultOperation' => [
                'date_from' => '2026-01-01',
                'date_to' => now()->toDateString(),
            ],
        ]);
    }
}
