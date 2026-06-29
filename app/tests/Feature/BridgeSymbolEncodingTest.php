<?php

namespace Tests\Feature;

use App\Services\PythonBridgeService;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * El sufijo '#' de los símbolos de XM (GOLD#, US500Cash#) debe llegar INTACTO al
 * bridge. Si va crudo en la ruta, el cliente HTTP lo trata como fragmento de URL y
 * el bridge recibe el símbolo truncado ('GOLD') → "Símbolo desconocido". Bug que
 * afectaba al Laboratorio (fetch de velas para el chart).
 */
class BridgeSymbolEncodingTest extends TestCase
{
    private function bridge(): PythonBridgeService
    {
        return new PythonBridgeService('http://bridge.test', 'test-key');
    }

    public function test_candles_preserva_el_sufijo_hash(): void
    {
        Http::fake(['*' => Http::response(['data' => []])]);

        $this->bridge()->candles('GOLD#', ['timeframe' => 'H4']);

        Http::assertSent(fn ($request) => str_contains($request->url(), '/candles/GOLD%23'));
        // No debe llegar truncado a 'GOLD' (el '#' como fragmento desaparecería).
        Http::assertSent(fn ($request) => ! preg_match('#/candles/GOLD(\?|$)#', $request->url()));
    }

    public function test_candles_preserva_simbolos_cash(): void
    {
        Http::fake(['*' => Http::response(['data' => []])]);

        $this->bridge()->candles('US500Cash#', ['timeframe' => 'H1']);

        Http::assertSent(fn ($request) => str_contains($request->url(), '/candles/US500Cash%23'));
    }

    public function test_price_preserva_el_sufijo_hash(): void
    {
        Http::fake(['*' => Http::response(['data' => []])]);

        $this->bridge()->price('GOLD#');

        Http::assertSent(fn ($request) => str_contains($request->url(), '/price/GOLD%23'));
    }
}
