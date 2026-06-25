# ForexBot — Configuración de Acceso en Red Local
> Documento adicional · Permite acceder al dashboard desde otros dispositivos (iPhone, Mac M1) en la red local
> Puede ejecutarse en cualquier momento; independiente de las fases funcionales

---

## 1. Objetivo

Hacer el dashboard de ForexBot accesible desde otros dispositivos en la misma red WiFi (iPhone, Mac M1, iPad), **manteniendo el bridge Python cerrado** porque ejecuta órdenes de trading reales y no debe ser alcanzable desde la red.

**IP local de la tower (servidor):** `192.168.0.172`
> Nota: es una IP asignada por DHCP. Puede cambiar si se reinicia el router. Si el acceso deja de funcionar, verificar con `ipconfig`. Para fijarla, reservar la IP en el router o configurar IP estática en Windows (opcional, futuro).

---

## 2. Principio de Seguridad (Crítico)

El flujo de acceso debe ser:

```
iPhone / Mac  →  Laravel (tower, red local)  →  Bridge Python (localhost, misma tower)  →  MT5
```

Los dispositivos externos hablan SOLO con Laravel. El bridge nunca se expone a la red.

| Servicio | Binding | Accesible desde red local | Razón |
|---|---|---|---|
| Laravel (8090) | `0.0.0.0` | ✅ Sí | El dashboard debe cargar en otros dispositivos |
| Reverb (8085) | `0.0.0.0` | ✅ Sí | WebSockets en tiempo real para esos dispositivos |
| Bridge Python (8000) | `127.0.0.1` | ❌ NO | Ejecuta órdenes de trading; solo Laravel lo consume desde la misma máquina |

---

## 3. Cambios a Aplicar

### 3.1 Laravel
Servir en `0.0.0.0` para aceptar conexiones de red:
```
php artisan serve --host=0.0.0.0 --port=8090
```
Documentar este comando como el de uso diario (antes era sin `--host`).

### 3.2 Reverb
- `REVERB_SERVER_HOST=0.0.0.0` en `.env` — el servidor Reverb escucha en todas las interfaces (bind).
- `REVERB_HOST=192.168.0.172` en `.env` — el **cliente** (navegador del iPhone/Mac) debe apuntar a la IP de la tower, NO a `localhost`, o intentará conectarse a sí mismo.
- `REVERB_PORT=8085` (ya configurado).
- Recordar: las variables `VITE_*` (incluida `VITE_REVERB_HOST`) se **hornean en el build**. Tras cambiarlas hay que `npm run build`.

> Detalle importante: hay una tensión entre acceso local (desde la tower misma, `localhost`) y acceso remoto (desde iPhone, IP). Si `REVERB_HOST` se fija a la IP, el navegador en la propia tower también deberá usar la IP (`http://192.168.0.172:8090`) en vez de `localhost:8090`, para que el WebSocket apunte correctamente. Considerar usar la IP de forma consistente en todos los accesos, o detectar el host dinámicamente en `echo.js` a partir de `window.location.hostname` (solución más robusta: el cliente Reverb usa el mismo host por el que se entró a la web).

**Recomendación:** en `echo.js`, derivar el host del WebSocket de `window.location.hostname` en lugar de hornear una IP fija. Así funciona tanto desde `localhost` (en la tower) como desde `192.168.0.172` (desde el iPhone) sin recompilar para cada caso.

### 3.3 Bridge Python
- **NO cambiar.** Debe permanecer en `127.0.0.1`.
- Si actualmente está en `0.0.0.0` (uvicorn arranca con `0.0.0.0:8000` según los logs), **cambiarlo a `127.0.0.1`** en `run.py` o la config de uvicorn, por seguridad. Solo Laravel lo consume desde la misma máquina, así que localhost es suficiente.

---

## 4. Firewall de Windows

La primera vez que Laravel y Reverb escuchen en `0.0.0.0`, Windows Defender Firewall mostrará un popup pidiendo permiso para PHP. Acción: **Permitir acceso en redes privadas** (NO públicas).

Si el popup no aparece o se cerró sin permitir, abrir los puertos manualmente (PowerShell como administrador):
```powershell
New-NetFirewallRule -DisplayName "ForexBot Laravel" -Direction Inbound -LocalPort 8090 -Protocol TCP -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "ForexBot Reverb" -Direction Inbound -LocalPort 8085 -Protocol TCP -Action Allow -Profile Private
```
NO abrir el 8000 (bridge) — debe permanecer cerrado.

---

## 5. Cómo Conectarse desde iPhone / Mac

1. El dispositivo debe estar en la **misma red WiFi** que la tower (mismo router, rango `192.168.0.x`).
2. Abrir el navegador y entrar a:
   ```
   http://192.168.0.172:8090
   ```
3. Login normal: `admin@forexbot.local` / `password`.
4. Verificar que el dashboard carga datos y que el tiempo real (posiciones, precios) funciona — eso confirma que el WebSocket de Reverb también conecta.

---

## 6. Resumen de Tareas para el Agente

1. Documentar/ajustar el comando de Laravel a `--host=0.0.0.0 --port=8090`.
2. `.env`: `REVERB_SERVER_HOST=0.0.0.0`. Implementar en `echo.js` la derivación del host del cliente desde `window.location.hostname` (preferido sobre hornear la IP). Recompilar.
3. Bridge: asegurar binding en `127.0.0.1` (cambiar desde `0.0.0.0` si aplica). Verificar que Laravel sigue consumiéndolo bien en localhost.
4. Documentar el procedimiento de firewall (popup o reglas manuales para 8090 y 8085; nunca 8000).
5. Verificación: acceder desde otro dispositivo de la red a `http://192.168.0.172:8090`, login correcto, dashboard con datos, y WebSocket conectado (tiempo real funcionando).

---

## 7. Criterio de Aceptación

- Desde el iPhone/Mac en la misma WiFi: `http://192.168.0.172:8090` carga el login y el dashboard con datos reales de MT5.
- El tiempo real funciona desde el dispositivo externo (precios/posiciones se actualizan sin recargar) → confirma Reverb accesible.
- Desde otro dispositivo, intentar `http://192.168.0.172:8000` (bridge) **NO** debe responder → confirma que el bridge está cerrado a la red.
- Desde la propia tower, `http://localhost:8090` sigue funcionando con tiempo real (gracias a la derivación de host en echo.js).

---

*Documento complementario a FOREXBOT_PROJECT.md · Ejecutable en cualquier momento*
