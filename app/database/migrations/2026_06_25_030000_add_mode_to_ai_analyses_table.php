<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ai_analyses', function (Blueprint $table) {
            // 'api' (Fase 6) o 'manual' (Fase 6B copy-paste).
            $table->string('mode')->default('manual')->after('model');
            $table->unsignedInteger('input_tokens')->nullable()->after('mode');
            $table->unsignedInteger('output_tokens')->nullable()->after('input_tokens');
            $table->decimal('estimated_cost_usd', 10, 6)->nullable()->after('output_tokens');
            $table->boolean('applied')->default(false)->after('suggested_parameters');
            $table->foreignId('resulting_strategy_id')->nullable()->after('applied')
                ->constrained('strategies')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('ai_analyses', function (Blueprint $table) {
            $table->dropConstrainedForeignId('resulting_strategy_id');
            $table->dropColumn(['mode', 'input_tokens', 'output_tokens', 'estimated_cost_usd', 'applied']);
        });
    }
};
