<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Favoritos cripto (Fase 2b-iv del subproyecto cripto).
 *
 * - market: 'forex' | 'crypto'. DEFAULT 'forex' => todos los favoritos existentes
 *   quedan como forex sin tocarlos y las vistas forex no cambian.
 * - validation: JSON de EVIDENCIA del pipeline de verificación cripto (net + OOS +
 *   holdout + cross-pair): etiquetas (viaja-eth / solo-btc / funding-dependiente…),
 *   PF de holdout, PF sin funding, resultados por par cruzado, fuente y fecha.
 *   La idea: al mirar un favorito meses después, saber POR QUÉ se confió en él y
 *   cuánto. Nullable: los favoritos forex no lo usan.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('favorites', function (Blueprint $table) {
            $table->string('market', 10)->default('forex')->index()->after('source');
            $table->json('validation')->nullable()->after('regime_confidence');
        });
    }

    public function down(): void
    {
        Schema::table('favorites', function (Blueprint $table) {
            $table->dropColumn(['market', 'validation']);
        });
    }
};
