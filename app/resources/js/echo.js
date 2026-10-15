import Echo from 'laravel-echo';
import Pusher from 'pusher-js';

window.Pusher = Pusher;

/**
 * Laravel Echo sobre Reverb (WebSockets).
 * Precios en vivo, señales del bot, trades y alertas se reciben por aquí.
 *
 * El HOST del WebSocket se deriva de `window.location.hostname`: así el cliente
 * Reverb usa el MISMO host por el que se entró a la web — `localhost` desde la
 * propia tower y `<LAN_IP>` (la IP de la tower en la red local) desde el iPhone/Mac — sin
 * tener que hornear una IP fija ni recompilar para cada caso (ver FOREXBOT_RED_LOCAL.md).
 * El puerto (8085) sí se hornea desde VITE_REVERB_PORT.
 */
const reverbPort = Number(import.meta.env.VITE_REVERB_PORT ?? 8085);
const reverbHost = window.location.hostname; // localhost en la tower, la IP desde la red

window.Echo = new Echo({
    broadcaster: 'reverb',
    key: import.meta.env.VITE_REVERB_APP_KEY,
    wsHost: reverbHost,
    wsPort: reverbPort,
    wssPort: reverbPort,
    forceTLS: (import.meta.env.VITE_REVERB_SCHEME ?? 'http') === 'https',
    enabledTransports: ['ws', 'wss'],
});
