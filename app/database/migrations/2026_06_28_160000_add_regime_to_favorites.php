<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Fase 3: snapshot del régimen de mercado del periodo de backtest del favorito
 * (tendencia/rango/volátil + confianza), para mostrar MATCH/MISMATCH.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('favorites', function (Blueprint $table) {
            $table->string('regime', 24)->nullable()->after('backtest_metrics');
            $table->float('regime_confidence')->nullable()->after('regime');
        });
    }

    public function down(): void
    {
        Schema::table('favorites', function (Blueprint $table) {
            $table->dropColumn(['regime', 'regime_confidence']);
        });
    }
};
