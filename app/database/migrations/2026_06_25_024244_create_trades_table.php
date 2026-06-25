<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('trades', function (Blueprint $table) {
            $table->id();
            // Un trade puede venir del bot en vivo o registrarse manualmente (nullable).
            $table->foreignId('bot_run_id')->nullable()->constrained()->nullOnDelete();
            $table->unsignedBigInteger('ticket')->nullable();  // ticket de MT5
            $table->string('symbol');
            $table->string('direction');        // buy | sell
            $table->decimal('open_price', 15, 5)->nullable();
            $table->decimal('close_price', 15, 5)->nullable();
            $table->decimal('volume', 12, 2)->default(0);
            $table->decimal('sl', 15, 5)->nullable();
            $table->decimal('tp', 15, 5)->nullable();
            $table->timestamp('open_at')->nullable();
            $table->timestamp('close_at')->nullable();
            $table->decimal('pnl', 15, 2)->nullable();
            $table->decimal('commission', 15, 2)->default(0);
            $table->decimal('swap', 15, 2)->default(0);
            $table->json('signal_data')->nullable();  // qué señal originó el trade
            $table->timestamps();

            $table->index('ticket');
            $table->index('symbol');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('trades');
    }
};
