<?php

use App\Http\Controllers\Auth\AuthenticatedSessionController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\MarketController;
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

    // Endpoints JSON para el frontend (refresco de charts / precios / posiciones).
    Route::prefix('api')->group(function () {
        Route::get('/market/candles/{symbol}', [MarketController::class, 'candles']);
        Route::get('/market/price/{symbol}', [MarketController::class, 'price']);
        Route::get('/market/positions', [MarketController::class, 'positions']);
    });
});
