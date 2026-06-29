<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Persistir el modo de SL/TP (Fase 1) en los favoritos para que el walk-forward del
 * Bot Histórico valide con la MISMA lógica con la que se exploró: si una estrategia
 * se exploró en ATR (SL=N×ATR, TP=M×ATR), debe validarse en ATR, no caer a fijo.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('favorites', function (Blueprint $table) {
            $table->string('sl_mode', 8)->default('fixed')->after('risk_percent'); // fixed | atr
            $table->integer('atr_period')->default(14)->after('sl_mode');
        });
    }

    public function down(): void
    {
        Schema::table('favorites', function (Blueprint $table) {
            $table->dropColumn(['sl_mode', 'atr_period']);
        });
    }
};
