<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use RuntimeException;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     *
     * Autenticación básica: un único usuario por ahora (ver documento maestro §8,
     * Fase 2). Credenciales obligatorias vía .env (ADMIN_EMAIL / ADMIN_PASSWORD):
     * no hay valores por defecto, el seeder falla si alguna está vacía.
     */
    public function run(): void
    {
        $email = trim((string) env('ADMIN_EMAIL', ''));
        $password = (string) env('ADMIN_PASSWORD', '');

        if ($email === '' || $password === '') {
            throw new RuntimeException('Define ADMIN_EMAIL y ADMIN_PASSWORD en .env antes de correr el seeder.');
        }

        User::updateOrCreate(
            ['email' => $email],
            [
                'name' => env('ADMIN_NAME', 'ForexBot Admin'),
                'password' => Hash::make($password),
            ],
        );
    }
}
