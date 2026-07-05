<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\PythonBridgeService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Fase 2b-ii — routing por mercado del Explorador.
 *
 * Garantías que fijan estos tests:
 * 1. /crypto/explorer renderiza la MISMA página React (Explorer) con market='crypto'
 *    y BTCUSDT como único par (bridge Bybit :8001 detrás).
 * 2. /explorer (forex) NO cambia: misma página SIN el prop market (el componente
 *    aplica default 'forex') — el routing cripto es puramente aditivo.
 * 3. PythonBridgeService::forMarket resuelve la URL por mercado con default forex.
 */
class CryptoExplorerTest extends TestCase
{
    use RefreshDatabase;

    public function test_crypto_explorer_renderiza_con_market_crypto(): void
    {
        $response = $this->actingAs(User::factory()->create())->get('/crypto/explorer');

        $response->assertOk()->assertInertia(fn ($page) => $page
            ->component('Explorer')
            ->where('market', 'crypto')
            ->where('symbols', ['BTCUSDT'])
            ->has('meta')
            ->has('context.date_from')
            ->where('savedSearches', []));
    }

    public function test_explorer_forex_sigue_sin_prop_market(): void
    {
        $response = $this->actingAs(User::factory()->create())->get('/explorer');

        $response->assertOk()->assertInertia(fn ($page) => $page
            ->component('Explorer')
            ->missing('market'));
    }

    public function test_for_market_resuelve_url_por_mercado_con_default_forex(): void
    {
        config(['forexbot.bridge.url' => 'http://127.0.0.1:8000']);
        config(['forexbot.bridge_crypto.url' => 'http://127.0.0.1:8001']);

        $url = fn (PythonBridgeService $s) => (new \ReflectionProperty($s, 'baseUrl'))->getValue($s);

        $this->assertSame('http://127.0.0.1:8001', $url(PythonBridgeService::forMarket('crypto')));
        $this->assertSame('http://127.0.0.1:8000', $url(PythonBridgeService::forMarket('forex')));
        // Cualquier valor desconocido cae a forex (nunca al bridge cripto por accidente).
        $this->assertSame('http://127.0.0.1:8000', $url(PythonBridgeService::forMarket('loquesea')));
    }
}
