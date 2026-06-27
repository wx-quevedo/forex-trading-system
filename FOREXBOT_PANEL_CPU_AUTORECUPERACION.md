# ForexBot — Panel de Escritorio: Monitor de CPU + Auto-recuperación de Servicios

> Dos mejoras al panel de control de escritorio (Python/tkinter): mostrar uso de CPU y núcleos lógicos, y auto-levantar servicios que se caigan (con interruptor on/off).

---

## PARTE 1 — Monitor de CPU y procesadores lógicos en el panel

### Qué se quiere
Mostrar en el panel de escritorio el **uso de CPU** del sistema y de sus **procesadores lógicos** (los 32 hilos del i9-13900K).

### Detalle
- Reusar `psutil` (ya usado en el panel).
- Mostrar:
  - **CPU total** (% de uso global), con una barra.
  - **Uso por núcleo lógico** (`psutil.cpu_percent(percpu=True)` → lista de los 32 hilos), idealmente como mini-barras o una grilla compacta (32 valores).
  - (Opcional) **RAM** total/uso si no está ya.
  - (Opcional) frecuencia actual de CPU si es fácil (`psutil.cpu_freq()`).
- Actualizar en el refresco que ya tiene el panel (ej. cada 1-2.5s).
- Diseño coherente con el panel (dark, sin emojis); compacto para no agrandar demasiado la ventana. Si 32 barras ocupan mucho, una grilla pequeña (ej. 8x4) de mini-indicadores.
- Útil para ver, por ejemplo, que el Explorador está aprovechando los núcleos durante un barrido.

---

## PARTE 2 — Auto-recuperación de servicios caídos (con interruptor)

### Qué se quiere
El panel monitorea los servicios (Bridge, Laravel, Reverb, Queue Worker). Si detecta que uno se **cayó**, lo **levanta automáticamente** y continúa. Con un **interruptor para activar/desactivar** esta auto-recuperación.

### Comportamiento
- **Interruptor (checkbox/toggle) "Auto-recuperación"** en el panel:
  - **Activado:** si un servicio que debería estar arriba se detecta caído, el panel lo reinicia solo.
  - **Desactivado:** el panel solo informa (como hoy), no actúa solo.
  - El estado del interruptor se recuerda entre sesiones (config local del panel).
- **Detección:** reusar la lógica de estado que ya tiene el panel (los indicadores verde/naranja). Si un servicio pasa a caído (proceso no vivo / puerto no responde), dispara la recuperación.
- **Acción:** levantar el servicio con el mismo mecanismo de "Start" que el panel ya usa para ese servicio.
- **Anti-bucle (importante):** si un servicio se cae y al levantarlo se vuelve a caer una y otra vez, NO entrar en un bucle infinito de reinicios:
  - Limitar reintentos (ej: máx 3 intentos en X minutos por servicio).
  - Si supera el límite, dejar de intentar, marcarlo en rojo y **avisar en el log de actividad** ("Bridge se cayó 3 veces seguidas; auto-recuperación pausada para este servicio, revisar manualmente").
  - Espera breve entre intentos (backoff).
- **Registro:** cada auto-recuperación se escribe en el log de actividad del panel ("[hora] Bridge detectado caído → reiniciado automáticamente (PID xxxx)").

### Sobre "continuar con la tarea que tenía" — comportamiento por servicio (IMPORTANTE)
Levantar el proceso es directo; retomar su trabajo depende del servicio:

- **Bot en vivo:** el panel levanta el proceso del bridge, PERO el bot mantiene su **fail-safe: arranca PAUSADO** tras una caída/reinicio (ya está así por diseño, por seguridad). La auto-recuperación **NO debe reactivar el trading del bot automáticamente** — el bot queda en pausa esperando que el usuario lo reanude. Esto es intencional: un bot no debe volver a operar dinero solo sin supervisión tras una caída. Avisar en el log: "Bridge reiniciado; el bot quedó en PAUSA, reanúdalo manualmente si quieres".
- **Explorador:** si el bridge se cae a media búsqueda, el job se pierde (estado en memoria). El panel levanta el bridge, pero la búsqueda hay que relanzarla desde la web. Con el caché de resultados (otro fix), relanzarla es rápido porque lo ya calculado vuelve de caché. La auto-recuperación NO intenta re-lanzar la búsqueda sola (no tiene los parámetros del cliente web); solo restaura el servicio para que esté disponible.
- **Laravel / Reverb / Queue Worker:** levantarlos restaura el servicio directamente (son stateless respecto a "tareas en curso" en este contexto); el Queue Worker retoma los jobs pendientes de la cola al volver.

> Resumen: la auto-recuperación garantiza que los SERVICIOS vuelvan a estar arriba. NO reactiva acciones sensibles automáticamente (trading del bot), por seguridad. Lo informa todo en el log.

### Seguridad
- Coherente con la arquitectura: el panel actúa solo sobre procesos locales en la tower.
- Nunca reactivar trading automático.
- El interruptor permite al usuario apagar la auto-recuperación cuando quiera (ej: durante mantenimiento).

---

## Verificación
- **CPU:** el panel muestra uso de CPU total y por núcleo lógico (32), actualizándose; se ve la carga subir durante un barrido del Explorador.
- **Auto-recuperación ON:** matar un servicio (ej: cerrar el bridge) → el panel lo detecta y lo levanta solo, lo registra en el log.
- **Bot tras recuperación:** el bot queda en PAUSA (no reactiva trading), con aviso en el log.
- **Anti-bucle:** si un servicio falla repetidamente, tras N intentos el panel deja de intentar y avisa.
- **Interruptor OFF:** el panel solo informa, no levanta solo; el estado del interruptor se recuerda.
- El panel arranca y funciona (`py_compile` / ejecución real).

---

*Panel · monitor de CPU/núcleos + auto-recuperación de servicios con interruptor · sin reactivar trading automático*

---

## PARTE 3 — BUG: el botón "Laboratorio" del Explorador no pasa las fechas

### Problema
Al pulsar "Laboratorio" en una fila del Explorador, se abre el Laboratorio con la combinación cargada (tipo, par, timeframe, parámetros, SL, TP, riesgo, capital), PERO **NO se pasan la fecha de inicio (Desde) ni la fecha de fin (Hasta)** del test. El Laboratorio abre con un periodo distinto al que tenía esa combinación en el Explorador.

### Por qué importa
- El resultado de un backtest depende del periodo. Si el Laboratorio abre con otras fechas, mostrará un resultado distinto al que el usuario vio en el Explorador → confusión e inconsistencia.
- Para inspeccionar correctamente una candidata, el Laboratorio debe reproducir EXACTAMENTE la misma combinación, fechas incluidas.

### Solución
- Incluir **Desde** y **Hasta** en los parámetros que el botón "Laboratorio" pasa por la URL (`/laboratory?combo=…`), junto al resto.
- El Laboratorio debe leer esas fechas del `?combo=` y aplicarlas al abrir, igual que aplica el par/tipo/tf/params/etc.
- Verificar: abrir una fila del Explorador en el Laboratorio → el periodo (Desde/Hasta) coincide con el del Explorador, y al ejecutar el backtest el resultado coincide con el que mostraba esa fila.

---

## PARTE 4 — BUG: GOLD# aparece en el selector pero da error / no carga velas

### Problema
En el Laboratorio, el oro (**GOLD#**) aparece en el selector de pares, pero al elegirlo **da error / no carga las velas**. (El usuario espera poder operar/backtestear oro.)

### Diagnóstico (el agente debe determinar la causa)
Distinto del fix previo de BTCUSD# (donde se arregló hacer `symbol_select` antes de pedir velas). Posibles causas a investigar:
1. **MT5 no tiene el histórico de GOLD# descargado** (como pasaba con BTCUSD# antes de abrir su gráfico). El error debería ser claro ("MT5 no tiene histórico disponible para GOLD#").
2. El **nombre real del símbolo del oro** en el broker no es exactamente "GOLD#" (puede tener otro sufijo/variante, o existir solo como otra forma). Verificar con `symbols_get()` el nombre exacto del oro operable en esta cuenta XM.
3. El `symbol_select` / resolución de símbolo operable no se está aplicando bien para metales (puede que el oro esté en otra ruta/categoría y la lógica de resolución no lo cubra).
4. Los metales pueden tener distinto número de `digits` o specs que rompan algo en la carga.

### Solución
- Diagnosticar cuál de las causas es (revisar el símbolo real del oro en el broker y el error exacto que devuelve el bridge).
- Asegurar que al elegir GOLD# (o el nombre real del oro): se hace `symbol_select`, se reintenta la descarga de velas (MT5 baja histórico async), y si de verdad no hay histórico, se muestra un error CLARO (no genérico).
- Si el problema es que MT5 no tiene el histórico, documentar para el usuario el truco de abrir el gráfico de GOLD# en MT5 para forzar la descarga (como con BTCUSD#), Y que el bridge reintente.
- Confirmar que el oro queda usable en el Laboratorio (y por tanto en el Explorador, mismo motor): carga velas, backtest corre.
- Revisar que el grupo "Más usados" del selector ofrezca el nombre correcto del oro (si es GOLD#, que apunte a ese; no a XAUUSD# que no existe en XM).

### Verificación
- Elegir GOLD# (o el nombre real del oro) en el Laboratorio → carga velas y muestra el chart sin error.
- Si MT5 no tiene histórico, error claro + instrucción; tras forzar la descarga, funciona.
- El oro se puede backtestear en el Laboratorio y aparece/funciona en el Explorador.

---

## Verificación general del documento
- CPU/núcleos visibles en el panel; auto-recuperación con interruptor y anti-bucle; bot queda en pausa tras recuperación.
- El botón "Laboratorio" del Explorador pasa también Desde/Hasta; el periodo coincide.
- GOLD# (o el nombre real del oro) carga velas y se puede backtestear.
- `tsc` 0 · build OK · bridge/panel tests segun aplique · verificar EN PANTALLA.
