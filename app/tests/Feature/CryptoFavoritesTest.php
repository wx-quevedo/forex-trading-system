<?php

namespace Tests\Feature;

use App\Models\Favorite;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Favoritos cripto (Fase 2b-iv): columna `market` + evidencia `validation`.
 *
 * Garantías: el favorito cripto guarda market='crypto' con su evidencia del pipeline;
 * los llamadores existentes (sin market) siguen produciendo forex; el Bot Histórico
 * (que corre por el bridge FOREX) jamás recibe favoritos cripto; el índice sirve
 * ambos mercados para las tabs.
 */
class CryptoFavoritesTest extends TestCase
{
    use RefreshDatabase;

    private function payload(array $extra = []): array
    {
        return array_merge([
            'name' => 'Ichimoku test', 'source' => 'explorer',
            'pair' => 'BTCUSDT', 'type' => 'ichimoku', 'timeframe' => 'H4',
            'params' => ['tenkan' => 12, 'kijun' => 52, 'senkou_b' => 104],
            'capital' => 10000,
        ], $extra);
    }

    public function test_favorito_cripto_guarda_market_y_evidencia(): void
    {
        $validation = [
            'pipeline' => 'net+oos+holdout',
            'labels' => ['holdout-aguanta', 'viaja-eth'],
            'holdout' => ['pf' => 1.492, 'return_pct' => 1.7, 'trades' => 10],
            'no_funding_pf' => 1.47,
            'cross' => ['ETHUSDT' => ['pf' => 1.15, 'verdict' => 'viaja']],
        ];

        $this->actingAs(User::factory()->create())
            ->postJson('/favorites', $this->payload(['market' => 'crypto', 'validation' => $validation]))
            ->assertOk();

        $fav = Favorite::firstOrFail();
        $this->assertSame('crypto', $fav->market);
        $this->assertSame(['holdout-aguanta', 'viaja-eth'], $fav->validation['labels']);
        $this->assertSame(1.492, $fav->validation['holdout']['pf']);
        $this->assertSame('viaja', $fav->validation['cross']['ETHUSDT']['verdict']);
    }

    public function test_payload_legacy_sin_market_sigue_siendo_forex(): void
    {
        // El flujo forex existente no envía market ni validation: nada cambia para él.
        $this->actingAs(User::factory()->create())
            ->postJson('/favorites', $this->payload(['pair' => 'EURUSD#']))
            ->assertOk();

        $fav = Favorite::firstOrFail();
        $this->assertSame('forex', $fav->market);
        $this->assertNull($fav->validation);
    }

    public function test_bot_historico_excluye_favoritos_cripto(): void
    {
        // El Bot Histórico simula por /backtests/ephemeral (bridge MT5): un favorito
        // cripto ahí produciría basura silenciosa. Solo debe recibir forex.
        Favorite::create(['name' => 'fx', 'market' => 'forex', 'pair' => 'EURUSD#', 'type' => 'rsi',
            'timeframe' => 'H1', 'params' => ['period' => 14], 'capital' => 10000]);
        Favorite::create(['name' => 'cr', 'market' => 'crypto', 'pair' => 'BTCUSDT', 'type' => 'rsi',
            'timeframe' => 'H4', 'params' => ['period' => 14], 'capital' => 10000]);

        $this->actingAs(User::factory()->create())->get('/bot-historico')
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('BotHistorico')
                ->has('favorites', 1)
                ->where('favorites.0.name', 'fx')
                ->where('favorites.0.market', 'forex'));
    }

    public function test_index_sirve_ambos_mercados_para_las_tabs(): void
    {
        Favorite::create(['name' => 'fx', 'market' => 'forex', 'pair' => 'EURUSD#', 'type' => 'rsi',
            'timeframe' => 'H1', 'params' => ['period' => 14], 'capital' => 10000]);
        Favorite::create(['name' => 'cr', 'market' => 'crypto', 'pair' => 'BTCUSDT', 'type' => 'rsi',
            'timeframe' => 'H4', 'params' => ['period' => 14], 'capital' => 10000,
            'validation' => ['labels' => ['solo-btc']]]);

        $this->actingAs(User::factory()->create())->get('/favorites')
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('Favorites')
                ->has('favorites', 2));
    }
}
