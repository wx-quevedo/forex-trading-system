<?php

namespace App\Providers;

use App\Services\ClaudeService;
use App\Services\PythonBridgeService;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->singleton(PythonBridgeService::class, fn () => PythonBridgeService::fromConfig());
        $this->app->singleton(ClaudeService::class, fn () => ClaudeService::fromConfig());
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        //
    }
}
