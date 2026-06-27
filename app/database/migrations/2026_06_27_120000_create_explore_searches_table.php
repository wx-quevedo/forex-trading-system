<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Búsquedas guardadas del Explorador (Fase 8E): config + reporte completo, para
 * reabrir un barrido concreto sin recalcular.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('explore_searches', function (Blueprint $table) {
            $table->id();
            $table->string('name', 160);
            $table->json('config');          // pares, tipos, tfs, sl/tp, riesgo, capital, periodo
            $table->longText('results');     // reporte completo (todas las combinaciones)
            $table->unsignedInteger('total')->default(0);
            $table->unsignedInteger('inside')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('explore_searches');
    }
};
