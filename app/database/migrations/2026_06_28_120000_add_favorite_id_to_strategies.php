<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Fase 8: trazabilidad de la estrategia cargada al bot desde un Favorito. Una
 * estrategia "materializada" desde un favorito recuerda su origen.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('strategies', function (Blueprint $table) {
            $table->foreignId('favorite_id')->nullable()->after('parent_id')
                ->constrained('favorites')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('strategies', function (Blueprint $table) {
            $table->dropConstrainedForeignId('favorite_id');
        });
    }
};
