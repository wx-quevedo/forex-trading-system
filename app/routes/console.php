<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Notificaciones Telegram del bot: cada minuto sondea journal+status y avisa lo nuevo
// (solo lectura del bridge, no toca el bot). withoutOverlapping evita solapes.
Schedule::command('bot:notify')->everyMinute()->withoutOverlapping();

// Auto-reanudar seguro tras reinicio: si el bridge arrancó con las estrategias pausadas
// por el fail-safe y las condiciones son sanas (MT5/BD/config) sin crash-loop, las reanuda
// y avisa; si no, las deja pausadas y avisa. Idempotente por boot_id.
Schedule::command('bot:autoresume')->everyMinute()->withoutOverlapping();
