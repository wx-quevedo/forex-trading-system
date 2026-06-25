<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('signal_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('strategy_id')->constrained()->cascadeOnDelete();
            $table->timestamp('evaluated_at');
            $table->string('symbol');
            $table->string('signal_type');     // buy | sell | none
            $table->boolean('executed')->default(false);
            $table->text('reason')->nullable(); // por qué (no) se ejecutó
            $table->json('indicator_values')->nullable(); // snapshot de indicadores
            $table->timestamps();

            $table->index(['strategy_id', 'evaluated_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('signal_logs');
    }
};
