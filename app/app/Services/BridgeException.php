<?php

namespace App\Services;

use RuntimeException;

/**
 * Error devuelto por el bridge Python (terminal MT5 offline, mercado cerrado,
 * orden rechazada, símbolo inválido, etc.). Conserva el status HTTP y el cuerpo
 * original para que controllers/jobs reaccionen con detalle.
 */
class BridgeException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly int $status = 502,
        public readonly mixed $body = null,
    ) {
        parent::__construct($message, $status);
    }
}
