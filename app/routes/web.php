<?php

use App\Http\Controllers\AiAnalysisController;
use App\Http\Controllers\Auth\AuthenticatedSessionController;
use App\Http\Controllers\BacktestController;
use App\Http\Controllers\BotController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\LaboratoryController;
use App\Http\Controllers\MarketController;
use App\Http\Controllers\StrategyController;
use App\Http\Controllers\WorkbenchController;
use Illuminate\Support\Facades\Route;

Route::get('/', fn () => redirect('/dashboard'));

// --- Autenticación (un solo usuario) ---
Route::middleware('guest')->group(function () {
    Route::get('/login', [AuthenticatedSessionController::class, 'create'])->name('login');
    Route::post('/login', [AuthenticatedSessionController::class, 'store']);
});

Route::middleware('auth')->group(function () {
    Route::post('/logout', [AuthenticatedSessionController::class, 'destroy'])->name('logout');

    Route::get('/dashboard', [DashboardController::class, 'index'])->name('dashboard');

    // --- Laboratorio de Estrategias (Fase 8C) ---
    Route::get('/laboratory', [LaboratoryController::class, 'show'])->name('laboratory');
    Route::post('/laboratory', [LaboratoryController::class, 'save'])->name('laboratory.save');

    // --- Módulo de Estrategias ---
    Route::post('/strategies/{strategy}/version', [StrategyController::class, 'version'])->name('strategies.version');
    Route::post('/strategies/{strategy}/evaluate', [StrategyController::class, 'evaluate'])->name('strategies.evaluate');
    Route::resource('strategies', StrategyController::class);

    // --- Módulo de Backtesting ---
    Route::resource('backtests', BacktestController::class)->only(['index', 'create', 'store', 'show', 'destroy']);

    // --- Módulo de Análisis IA (chat sobre un backtest) ---
    Route::get('/backtests/{backtest}/analysis', [AiAnalysisController::class, 'index'])->name('backtests.analysis');
    Route::post('/backtests/{backtest}/analysis', [AiAnalysisController::class, 'store'])->name('backtests.analysis.store');
    Route::post('/backtests/{backtest}/analysis/{analysis}/apply', [AiAnalysisController::class, 'apply'])->name('backtests.analysis.apply');

    // --- Modo manual (Fase 6B: copy-paste, sin coste de API) ---
    Route::get('/backtests/{backtest}/manual-prompt', [AiAnalysisController::class, 'manualPrompt'])->name('backtests.manual.prompt');
    Route::post('/backtests/{backtest}/manual/preview', [AiAnalysisController::class, 'manualPreview'])->name('backtests.manual.preview');
    Route::post('/backtests/{backtest}/manual/apply', [AiAnalysisController::class, 'manualApply'])->name('backtests.manual.apply');

    // --- Workbench de afinamiento (Fase 6C) ---
    Route::get('/backtests/{backtest}/workbench', [WorkbenchController::class, 'show'])->name('backtests.workbench');
    Route::post('/backtests/ephemeral', [WorkbenchController::class, 'ephemeral'])->name('backtests.ephemeral');
    Route::post('/backtests/optimize', [WorkbenchController::class, 'optimize'])->name('backtests.optimize');
    Route::post('/backtests/{backtest}/workbench/manual-prompt', [WorkbenchController::class, 'manualPrompt'])->name('workbench.manual-prompt');
    Route::post('/backtests/{backtest}/workbench/analyze', [WorkbenchController::class, 'analyze'])->name('workbench.analyze');
    Route::post('/strategies/{strategy}/save-version-from-workbench', [WorkbenchController::class, 'saveVersion'])->name('workbench.save-version');

    // --- Bot en vivo (Fase 7) ---
    Route::get('/bot', [BotController::class, 'control'])->name('bot.control');
    Route::get('/bot/status', [BotController::class, 'status'])->name('bot.status');
    Route::get('/bot/state', [BotController::class, 'state'])->name('bot.state');
    Route::post('/bot/start', [BotController::class, 'start'])->name('bot.start');
    Route::post('/bot/pause', [BotController::class, 'pause'])->name('bot.pause');
    Route::post('/bot/resume', [BotController::class, 'resume'])->name('bot.resume');
    Route::post('/bot/stop', [BotController::class, 'stop'])->name('bot.stop');
    Route::post('/bot/remove', [BotController::class, 'remove'])->name('bot.remove');
    Route::post('/bot/panic', [BotController::class, 'panic'])->name('bot.panic');
    Route::post('/bot/telegram', [BotController::class, 'updateTelegram'])->name('bot.telegram');

    // Endpoints JSON para el frontend (refresco de charts / precios / posiciones).
    Route::prefix('api')->group(function () {
        Route::get('/market/candles/{symbol}', [MarketController::class, 'candles']);
        Route::get('/market/price/{symbol}', [MarketController::class, 'price']);
        Route::get('/market/symbol/{symbol}', [MarketController::class, 'symbol']);
        Route::get('/market/session/{symbol}', [MarketController::class, 'session']);
        Route::get('/market/positions', [MarketController::class, 'positions']);
    });
});
