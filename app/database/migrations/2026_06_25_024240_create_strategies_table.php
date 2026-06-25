<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('strategies', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->text('description')->nullable();
            $table->string('pair');            // p.ej. EURUSD
            $table->string('timeframe');       // M1, M5, H1, H4, D1...
            $table->json('parameters')->nullable(); // indicadores, condiciones, SL/TP, riesgo
            $table->unsignedInteger('version')->default(1);
            // Versionado: cada ajuste crea una versión nueva apuntando a su padre.
            $table->foreignId('parent_id')->nullable()->constrained('strategies')->nullOnDelete();
            $table->boolean('is_active')->default(false);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('strategies');
    }
};
