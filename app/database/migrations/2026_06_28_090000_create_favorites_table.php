<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Favoritos (Fase 9): estrategias marcadas desde el Explorador o el Laboratorio,
 * con su configuración + el periodo y métricas del BACKTEST de referencia (para
 * comparar luego en el Bot Histórico walk-forward).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('favorites', function (Blueprint $table) {
            $table->id();
            $table->string('name', 160);
            $table->string('source', 20)->default('explorer'); // explorer | lab
            $table->string('pair', 20);
            $table->string('type', 20);
            $table->string('timeframe', 8);
            $table->json('params');
            $table->float('sl_pips')->nullable();
            $table->float('tp_pips')->nullable();
            $table->float('risk_percent')->nullable();
            $table->float('capital')->default(10000);
            $table->date('backtest_from')->nullable();
            $table->date('backtest_to')->nullable();
            $table->json('backtest_metrics')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('favorites');
    }
};
