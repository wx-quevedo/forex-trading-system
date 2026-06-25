# ForexBot — Fase 7: Bot en Vivo (Ejecución Automática)
> Documento detallado de ejecución · El bot que opera solo contra MT5
> Prerequisito: Fases 1-6C completadas. Opera SIEMPRE en cuenta demo XM hasta validación extensa.

---

## 1. Objetivo

Construir el bot que ejecuta una estrategia automáticamente contra MT5: evalúa en cada vela cerrada, abre/cierra posiciones reales (`order_send`), con control total desde la web (pause/resume/kill), panic button, límites de seguridad, log en tiempo real, e historial. Más notificaciones Telegram.

**Esta fase usa LOTE FIJO.** El sizing dinámico y el presupuesto en dólares avanzado se construyen después (Fase 8B), una vez el bot esté validado.

---

## 2. Principios de Seguridad (Leer Primero)

> El bot ejecuta órdenes reales. Aunque sea demo, se construye con disciplina de producción.

1. **Solo demo:** el bot opera exclusivamente en la cuenta demo XM hasta que el usuario decida lo contrario explícitamente. No hay path a cuenta real en esta fase.
2. **Panic button es prioridad #1:** lo primero que debe funcionar y probarse. Cierra TODAS las posiciones abiertas inmediatamente y detiene el bot.
3. **Límite de pérdida diaria:** configurable; si se alcanza, el bot se auto-detiene y notifica. No reabre hasta el día siguiente o intervención manual.
4. **Máximo de posiciones simultáneas:** configurable; el bot no abre más de N posiciones a la vez.
5. **Evaluación en vela cerrada, no en tick:** el bot decide solo cuando una vela se cierra (evita señales falsas por ruido intradía). Configurable el timeframe.
6. **Idempotencia:** el bot no debe abrir dos posiciones por la misma señal si hay un reinicio o lag. Verificar estado antes de actuar.
7. **Fail-safe en errores:** si el bridge cae, MT5 se desconecta, o hay error de broker, el bot NO asume nada — registra el error, notifica, y se pausa si es crítico.

---

## 3. Arquitectura del Bot

El bot vive en el **bridge Python** (es quien habla con MT5), controlado desde Laravel.

```
Laravel (web)                    Bridge Python (bot loop)
├── Botón Start/Pause/Kill  ───→  ├── Loop de ejecución
├── Panic button           ───→  │   (cada vela cerrada)
├── Config (límites)       ───→  │   ├── lee precio/velas MT5
├── Estado del bot         ←───  │   ├── evalúa estrategia
├── Log de señales (Reverb)←───  │   ├── decide abrir/cerrar
└── Historial trades       ←───  │   ├── order_send() si procede
                                 │   └── reporta a Laravel
                                 └── respeta límites de seguridad
```

### Opciones de implementación del loop
- **Opción elegida:** proceso Python independiente lanzado/controlado por el bridge (un endpoint `POST /bot/start` arranca el loop en un thread/task; `POST /bot/stop` lo detiene). El estado del bot se consulta vía `GET /bot/status`.
- El loop reporta cada acción a Laravel (vía HTTP callback o escribiendo en la DB que Laravel lee + Reverb para tiempo real).
- Persistencia del estado: si el bridge se reinicia, el bot arranca PAUSADO por seguridad (nunca auto-resume).

---

## 4. Componentes a Construir

### 4.1 Bridge — Motor del Bot (`bridge/app/bot/`)
- `runner.py` — el loop principal: espera cierre de vela, evalúa, actúa
- `executor.py` — ejecuta órdenes con `order_send()`, maneja SL/TP, valida respuesta del broker
- `guards.py` — chequea límites (pérdida diaria, máx posiciones, presupuesto) antes de cada orden
- `state.py` — estado del bot (running/paused/stopped/error), persistido
- Endpoints en `routers/bot.py`:
  - `POST /bot/start` (recibe strategy_id, params, lote fijo, límites)
  - `POST /bot/pause` · `POST /bot/resume` · `POST /bot/stop`
  - `POST /bot/panic` — cierra todas las posiciones + stop
  - `GET /bot/status` — estado actual + posiciones + PnL del día
- Tests: el loop evalúa correctamente, los guards bloquean cuando deben, panic cierra todo

### 4.2 Laravel — Control y Persistencia
- `BotController` — start/pause/resume/stop/panic, proxy al bridge vía `PythonBridgeService`
- Extender `PythonBridgeService` con los métodos del bot
- Usar el modelo `BotRun` (ya existe) para registrar cada sesión del bot
- Cada trade del bot → registro en `trades` (ya existe, con `bot_run_id`)
- Cada señal evaluada → `signal_logs` (ya existe)
- Evento `BotSignalEvaluated` y `BotTradeExecuted` por Reverb para tiempo real
- Config del bot persistida: límites de seguridad por `BotRun`

### 4.3 Frontend — Panel de Control del Bot
- Página `Bot/Control.tsx` (o integrada en Dashboard):
  - Selector de estrategia a operar (de las versiones guardadas)
  - Config: lote fijo, límite pérdida diaria, máx posiciones simultáneas, timeframe
  - Botones grandes: **Start** · **Pause** · **Resume** · **Stop**
  - **PANIC BUTTON** — rojo, prominente, con confirmación ("¿Cerrar TODAS las posiciones?")
  - `BotStatusIndicator` (ya existe): pulso verde activo / gris pausado / rojo error
- **Log de señales en vivo** (Reverb): cada evaluación aparece en tiempo real, incluso las que NO ejecutaron (con su motivo)
- **Posiciones abiertas del bot** con PnL flotante en vivo
- **Historial de trades del bot:** entrada, salida, lote, SL/TP, PnL, señal que lo disparó
- PnL del día acumulado + cuánto falta para el límite diario

### 4.4 Notificaciones Telegram
- `TelegramNotifier` service (Laravel) — HTTP a la API de Telegram Bot
- Setup: bot creado vía BotFather, `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` en `.env`
- Eventos que notifican (configurable cuáles):
  - Bot iniciado / pausado / detenido
  - Trade abierto (símbolo, dirección, lote, precio, SL/TP)
  - Trade cerrado (PnL)
  - SL o TP alcanzado
  - Límite de pérdida diaria alcanzado (bot auto-detenido)
  - Panic button activado
  - Error crítico (bridge caído, desconexión MT5)
- Toggle global "notificaciones Telegram" + por tipo de evento
- Documentar en el resumen cómo crear el bot de Telegram y obtener el chat_id

---

## 5. Flujo de Operación (cómo funciona en uso)

1. Usuario elige una estrategia validada + configura lote y límites de seguridad
2. Pulsa **Start** → el bot arranca, evalúa en cada cierre de vela del timeframe
3. Cuando la estrategia da señal de entrada Y pasan los guards (límites OK) → `order_send` abre posición con SL/TP
4. Cada acción se registra y notifica (web en vivo + Telegram)
5. El bot gestiona las salidas (SL/TP automáticos en MT5, o cierre por señal contraria)
6. Si se alcanza el límite diario → auto-stop + notificación
7. El usuario puede pausar (deja de evaluar, mantiene posiciones), reanudar, o detener (cierra evaluación) en cualquier momento
8. **Panic** en emergencia → todo cerrado, bot detenido

---

## 6. Criterio de Aceptación (e2e en demo)

> Probar con MT5 demo abierto y el mercado abierto (no fin de semana).

1. **Panic button primero:** abrir manualmente una posición de prueba, pulsar Panic → confirma que se cierra y el bot queda detenido. (Probar esto ANTES que nada.)
2. Start con una estrategia simple → verificar que evalúa en cada vela cerrada (log en vivo lo muestra)
3. Forzar/esperar una señal → verificar que abre posición real en MT5 con el lote y SL/TP correctos
4. Verificar que el trade aparece en: web (tiempo real), historial, y notificación Telegram
5. Verificar guards: configurar máx 1 posición → confirmar que no abre una segunda
6. Configurar límite de pérdida diaria bajo → forzar pérdida → confirmar auto-stop + notificación
7. Pausar/reanudar → confirma que respeta el estado
8. Reiniciar el bridge mientras el bot corre → confirma que arranca PAUSADO (no auto-resume)
9. Notificaciones Telegram llegan en todos los eventos configurados

---

## 7. Lo Que NO Entra en Esta Fase (va a Fase 8B)

- Sizing dinámico / lote automático según fuerza de señal
- Presupuesto en dólares avanzado con traducción lote→riesgo
- Optimización automática de parámetros

Esta fase = bot sólido con **lote fijo** y seguridad robusta. Lo demás se construye encima una vez validado.

---

## 8. Resumen de Tareas para el Agente

1. Motor del bot en el bridge (`runner`, `executor`, `guards`, `state`) + endpoints
2. **Panic button funcional y probado primero** (prioridad)
3. `BotController` + extensión de `PythonBridgeService` + eventos Reverb
4. Panel de control en el frontend (start/pause/resume/stop/panic + config)
5. Log de señales en vivo + posiciones + historial del bot
6. Límites de seguridad (pérdida diaria, máx posiciones) con auto-stop
7. Arranque PAUSADO tras reinicio del bridge (fail-safe)
8. `TelegramNotifier` + eventos configurables + instrucciones de setup
9. Tests (loop, guards, panic, ejecución) + verificación e2e en demo

---

*Documento complementario a FOREXBOT_PROJECT.md · Ejecutar con MT5 demo · El panic button se prueba antes que nada*
