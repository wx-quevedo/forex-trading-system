<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Journal del bot (ciclo de vida / salud), separado del log de señales.
        Schema::create('bot_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bot_run_id')->nullable()->constrained()->nullOnDelete();
            $table->string('type');               // started, paused, resumed, stopped, panic, error, daily_limit, ...
            $table->string('severity')->default('info'); // info | warning | error
            $table->text('message');
            $table->timestamp('occurred_at');
            $table->timestamps();
            $table->index('bot_run_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('bot_events');
    }
};
