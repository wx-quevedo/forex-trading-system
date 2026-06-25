<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('backtests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('strategy_id')->constrained()->cascadeOnDelete();
            $table->date('date_from');
            $table->date('date_to');
            // pending | running | completed | failed
            $table->string('status')->default('pending');
            $table->json('result_metrics')->nullable();      // win_rate, sharpe, drawdown...
            $table->json('result_trades')->nullable();        // lista de trades simulados
            $table->json('result_equity_curve')->nullable();  // puntos de la equity curve
            $table->text('error')->nullable();                // mensaje si status=failed
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('backtests');
    }
};
