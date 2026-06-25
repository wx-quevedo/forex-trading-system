<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_analyses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('backtest_id')->constrained()->cascadeOnDelete();
            $table->text('prompt');
            $table->longText('response')->nullable();
            $table->string('model')->nullable();       // p.ej. claude-sonnet-4-6
            $table->json('suggested_parameters')->nullable(); // ajuste propuesto por la IA
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_analyses');
    }
};
