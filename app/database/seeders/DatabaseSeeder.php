<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     *
     * Autenticación básica: un único usuario por ahora (ver documento maestro §8,
     * Fase 2). Credenciales configurables vía .env (ADMIN_EMAIL / ADMIN_PASSWORD).
     */
    public function run(): void
    {
        User::updateOrCreate(
            ['email' => env('ADMIN_EMAIL', 'admin@forexbot.local')],
            [
                'name' => env('ADMIN_NAME', 'ForexBot Admin'),
                'password' => Hash::make(env('ADMIN_PASSWORD', 'password')),
            ],
        );
    }
}
