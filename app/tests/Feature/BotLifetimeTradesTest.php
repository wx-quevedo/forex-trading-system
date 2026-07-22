<?php

namespace Tests\Feature;

use App\Models\Strategy;
use App\Models\Trade;
use App\Models\User;
use App\Services\PythonBridgeService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery\MockInterface;
use Tests\TestCase;

/**
 * PnL de vida + trades cerrados del bot (fuente canónica: history_deals de MT5 por magic).
 *
 * Garantías: filtro por rango de magic del bot (770000-869999); realizado = TODOS los
 * deals del bot (profit + commission + swap + fee, ambos lados); agrupación por
 * position_id con dirección desde el deal de ENTRADA (o invertida del OUT si la
 * apertura quedó fuera del epoch); enriquecimiento del motivo desde BD y journal con
 * fallback — y COMPLETITUD > enriquecimiento: el deal sin motivo se muestra igual.
 */
class BotLifetimeTradesTest extends TestCase
{
    use RefreshDatabase;

    /** Deals de fixture: posición A (IN+OUT), B (solo OUT, cierre de un corto),
     *  C (magic ajeno al bot: fuera), D (solo IN: posición aún abierta). */
    private function deals(): array
    {
        return [
            // A: buy 0.1 EURUSD# 1.1 -> 1.2 (magic 770001 = strategy_id 1)
            ['position_id' => 100, 'magic' => 770001, 'entry' => 0, 'type' => 0, 'price' => 1.1, 'time' => 1000, 'volume' => 0.1, 'profit' => 0, 'commission' => -0.5, 'swap' => 0, 'fee' => 0, 'symbol' => 'EURUSD#'],
            ['position_id' => 100, 'magic' => 770001, 'entry' => 1, 'type' => 1, 'price' => 1.2, 'time' => 2000, 'volume' => 0.1, 'profit' => 10.0, 'commission' => -0.5, 'swap' => -0.2, 'fee' => 0, 'symbol' => 'EURUSD#'],
            // B: OUT sin IN (abierta antes del epoch); el deal de cierre es BUY => la posición era SHORT
            ['position_id' => 200, 'magic' => 770007, 'entry' => 1, 'type' => 0, 'price' => 0.9, 'time' => 3000, 'volume' => 0.05, 'profit' => -3.0, 'commission' => 0, 'swap' => 0, 'fee' => 0, 'symbol' => 'EURUSD#'],
            // C: magic FUERA del rango del bot -> jamás cuenta
            ['position_id' => 900, 'magic' => 990001, 'entry' => 1, 'type' => 1, 'price' => 2.0, 'time' => 4000, 'volume' => 1.0, 'profit' => 999.0, 'commission' => 0, 'swap' => 0, 'fee' => 0, 'symbol' => 'GOLD#'],
            // D: posición del bot AÚN ABIERTA (solo IN): no es cierre, pero su comisión sí es realizada
            ['position_id' => 300, 'magic' => 770002, 'entry' => 0, 'type' => 0, 'price' => 5.0, 'time' => 5000, 'volume' => 0.2, 'profit' => 0, 'commission' => -0.4, 'swap' => 0, 'fee' => 0, 'symbol' => 'USDJPY#'],
        ];
    }

    public function test_lifetime_pnl_filtra_por_magic_y_suma_broker_fiel(): void
    {
        $this->mock(PythonBridgeService::class, function (MockInterface $m) {
            $m->shouldReceive('history')->once()->andReturn($this->deals());
            // Flotante: solo la posición con magic del bot (la de 555 se ignora).
            $m->shouldReceive('positions')->once()->andReturn([
                ['magic' => 770001, 'profit' => 2.5, 'swap' => -0.1],
                ['magic' => 555, 'profit' => 100.0, 'swap' => 0],
            ]);
        });

        $this->actingAs(User::factory()->create())->getJson('/bot/lifetime-pnl')
            ->assertOk()
            // realizado = A(0-0.5 + 10-0.5-0.2) + B(-3) + D(-0.4) = 5.4 — C (magic ajeno) fuera
            ->assertJsonPath('realized', 5.4)
            ->assertJsonPath('floating', 2.4)
            ->assertJsonPath('total', 7.8)
            ->assertJsonPath('closed_count', 2)
            ->assertJsonPath('open_count', 1);
    }

    public function test_closed_trades_agrupa_enriquece_y_nunca_omite(): void
    {
        $this->mock(PythonBridgeService::class, function (MockInterface $m) {
            $m->shouldReceive('history')->once()->andReturn($this->deals());
            // El journal solo conoce el cierre de B (ticket = position_id 200).
            $m->shouldReceive('botJournal')->once()->andReturn(['entries' => [
                ['kind' => 'close', 'ticket' => 200, 'close_reason' => 'signal'],
                ['kind' => 'open', 'ticket' => 100],
            ]]);
        });
        // La BD solo conoce el motivo de A (matching por ticket = position_id).
        $s = Strategy::create(['name' => 'EMA test', 'pair' => 'EURUSD#', 'timeframe' => 'H1',
            'parameters' => ['type' => 'ma_cross', 'indicators' => [], 'risk' => []]]);
        $this->assertSame(1, $s->id); // magic 770001 -> strategy_id 1
        Trade::create(['ticket' => 100, 'symbol' => 'EURUSD#', 'direction' => 'buy', 'close_reason' => 'take_profit']);

        $r = $this->actingAs(User::factory()->create())->getJson('/bot/closed-trades?limit=50')
            ->assertOk()
            ->assertJsonPath('count', 2)
            // Más reciente arriba: B (time 3000) antes que A (2000). C y D no aparecen.
            ->assertJsonPath('trades.0.position_id', 200)
            ->assertJsonPath('trades.1.position_id', 100)
            // B: cierre BUY sin IN => la posición era SHORT; sin precio de entrada; motivo del journal.
            ->assertJsonPath('trades.0.direction', 'sell')
            ->assertJsonPath('trades.0.entry_price', null)
            ->assertJsonPath('trades.0.close_reason', 'signal')
            ->assertJsonPath('trades.0.strategy', null)   // sid 7 no existe en BD: fila COMPLETA igual
            // A: dirección del deal de entrada, pnl bróker-fiel del grupo, motivo de la BD, estrategia resuelta.
            ->assertJsonPath('trades.1.direction', 'buy')
            ->assertJsonPath('trades.1.entry_price', 1.1)
            ->assertJsonPath('trades.1.pnl', 8.8)
            ->assertJsonPath('trades.1.close_reason', 'take_profit')
            ->assertJsonPath('trades.1.strategy.type', 'ma_cross');

        $this->assertSame(770007 - 770000, $r->json('trades.0.strategy_id'));
    }
}
