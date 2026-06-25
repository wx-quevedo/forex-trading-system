# ForexBot — Cambios y Mejoras (Lote 2)
> Fixes de la visualización del bot (Fase 7B) + mejoras de usabilidad · Ejecutar en una pasada
> NO incluye responsive móvil (ese va en su propio documento aparte, "lueeego")

---

## 1. BUG — El chart se resetea (scroll/zoom) al actualizarse

**Problema:** en la pestaña Visualización del bot, cuando el usuario hace scroll o zoom en el gráfico y llegan datos nuevos (refresco cada 15s o evento Reverb), el chart se redibuja y **pierde la posición de scroll/zoom**, devolviendo a la vista original. Es muy molesto: el usuario está leyendo el detalle de una evaluación abajo y el chart le quita el foco / lo reposiciona.

> El reporte anterior decía "preserva el zoom entre refrescos" pero en la práctica NO lo hace correctamente.

**Solución:**
- Al recibir datos nuevos, actualizar las series SIN resetear la vista visible (rango de tiempo/escala) que el usuario tiene puesta.
- Usar `series.setData()` / `series.update()` de forma que NO dispare un `timeScale().fitContent()` ni reseteo de rango en cada refresco.
- Guardar el rango visible (`timeScale().getVisibleLogicalRange()` o `getVisibleRange()`) antes de actualizar y restaurarlo después, SOLO si el usuario había interactuado (no forzar si está en modo "seguir el borde derecho").
- Idealmente: si el usuario está en el borde derecho (viendo lo más reciente), seguir mostrando lo nuevo automáticamente; si se ha desplazado/zoomeado a una zona, respetar su posición y no moverla.
- El panel de detalle de una evaluación seleccionada NO debe cerrarse ni cambiar cuando llegan datos nuevos (preservar la selección del usuario).

---

## 2. Visualización de posición estilo TradingView (zonas verde/roja de TP/SL)

**Qué se quiere:** cuando el bot tiene (o tuvo) una operación, mostrarla en el chart como la herramienta "Long/Short Position" de TradingView:
- Un **rectángulo/zona VERDE** desde el precio de **entrada** hasta el **Take Profit** (zona de ganancia)
- Un **rectángulo/zona ROJA** desde el precio de **entrada** hasta el **Stop Loss** (zona de pérdida)
- La línea de **entrada** entre ambas zonas
- El precio actual se ve moviéndose dentro/fuera de esas zonas

Esto es mucho más claro visualmente que solo líneas: el usuario ve de un vistazo cuánto puede ganar vs perder y dónde está el precio respecto a TP/SL.

**Implementación:**
- Lightweight Charts no tiene un "rectángulo" nativo de caja, pero se puede lograr con áreas/bandas: usar series de área o `createPriceLine` combinadas, o dibujar bandas horizontales coloreadas entre entrada↔TP (verde semitransparente) y entrada↔SL (rojo semitransparente).
- Alternativa robusta: usar dos series tipo `AreaSeries`/`BaselineSeries` o un plugin de rectángulos, acotadas al rango temporal de la posición (desde la apertura hasta el cierre o hasta "ahora" si sigue abierta).
- Aplicar a:
  - **Posiciones abiertas del bot:** zona desde la entrada hacia su TP (verde) y hacia su SL (rojo), extendida hasta el borde derecho mientras siga abierta.
  - **Operaciones cerradas (historial):** opcionalmente mostrar la zona en el tramo en que estuvo abierta, con el marcador de cierre y PnL (ya existe el marcador de salida).
- Colores coherentes con la plataforma: verde `#26A69A` y rojo `#EF5350`, semitransparentes para no tapar las velas.
- Las líneas de entrada/SL/TP que ya existen se mantienen o se integran con las zonas.

> Objetivo: ver la operación "encajonada" entre la zona de ganancia (verde) y la de pérdida (roja), como en TradingView.

---

## 3. Agregar timeframe M1 al selector del bot

**Problema:** el selector de timeframe del bot en vivo NO incluye M1, aunque el motor SÍ lo soporta (el bot ya operó en M1 cuando se pasó por config, y el usuario probó su estrategia en M1).

**Solución:** agregar **M1** como opción en el selector de timeframe de la página del bot (`Bot/Control.tsx`). Es un fix de UI; el motor ya lo maneja. Verificar que la lista de timeframes del selector incluya M1, M5, M15, M30, H1, H4, D1 (los que el bridge soporta).

---

## 4. Indicador de fecha/hora con milisegundos

**Qué se quiere:**
- Un **indicador de fecha y hora actual con milisegundos** visible (ej: en el header o cerca del estado del bot), actualizándose en vivo.
- **Timestamps con milisegundos** en los registros de entradas, salidas y evaluaciones/análisis del bot (en el log de señales, historial de trades, y detalle de evaluación).

**Objetivo:** precisión temporal exacta para saber el momento preciso de cada acción del bot.

**Implementación:**
- Formato con milisegundos (ej: `2026-06-25 09:17:05.842`).
- El indicador de hora actual se actualiza cada pocos ms o cada segundo con ms mostrados (definir según rendimiento; un tick por segundo mostrando ms reales del momento basta visualmente, o un requestAnimationFrame ligero).
- En los registros (señales, trades), preservar/mostrar el timestamp con ms que ya viene del bridge (los `evaluated_at` del bridge ya incluyen fracción de segundo; asegurarse de mostrarla en vez de truncarla).
- Zona horaria: coherente con la que usa el usuario (Ecuador) o la del servidor; indicar cuál si puede confundir.

---

## 5. Eliminar TODOS los emojis del proyecto

**Qué se quiere:** quitar los emojis de la interfaz del proyecto (el usuario no los quiere).

**Acción:**
- Buscar en todo el código del frontend (y donde aplique) los emojis y eliminarlos, reemplazándolos por texto plano o íconos apropiados si hacían falta funcionalmente.
- Casos conocidos: los toggles de la pestaña de visualización (`📈 Visualización` / `📝 Log`) → dejar solo el texto ("Visualización" / "Log") o usar íconos de una librería de íconos coherente (ej: lucide-react) si se quiere indicador visual.
- Revisar también: botones, encabezados, mensajes, notificaciones, panel de control de escritorio, y cualquier otro lugar donde se hayan colado emojis.
- Buscar de forma exhaustiva (los emojis pueden estar en JSX, strings, labels, constantes).

> Nota para futuro: mantener el proyecto libre de emojis salvo que el usuario lo pida explícitamente.

---

## 6. Verificación

- El chart NO se resetea al refrescar: el usuario hace scroll/zoom, llegan datos, y su vista se mantiene; el panel de detalle seleccionado permanece.
- Las posiciones se ven con zonas verde (hacia TP) y roja (hacia SL) estilo TradingView.
- El selector de timeframe del bot incluye M1 y el bot puede operar en M1 desde la UI.
- Hay indicador de fecha/hora con ms; los registros muestran ms.
- No quedan emojis en la interfaz.
- `tsc` 0 · build OK · tests pasan.

---

*Documento de mejoras Lote 2 · Complementa la Fase 7B · Responsive móvil va en documento aparte*
