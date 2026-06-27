<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Trazabilidad multi-estrategia: cada trade sabe de qué estrategia viene.
        Schema::table('trades', function (Blueprint $table) {
            $table->foreignId('strategy_id')->nullable()->after('bot_run_id')->constrained()->nullOnDelete();
            $table->unsignedBigInteger('magic')->nullable()->after('ticket');
        });
        Schema::table('bot_events', function (Blueprint $table) {
            $table->foreignId('strategy_id')->nullable()->after('bot_run_id')->constrained()->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('trades', function (Blueprint $table) {
            $table->dropConstrainedForeignId('strategy_id');
            $table->dropColumn('magic');
        });
        Schema::table('bot_events', function (Blueprint $table) {
            $table->dropConstrainedForeignId('strategy_id');
        });
    }
};
