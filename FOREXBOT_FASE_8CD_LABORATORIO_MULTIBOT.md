# ForexBot — Fase 8C/8D: Laboratorio de Estrategias + Bot Multi-Estrategia

> Rediseño del flujo de creación de estrategias (laboratorio: probar/optimizar ANTES de guardar) + el bot ejecutando varias estrategias a la vez con riesgo independiente
> Prerequisito: Fase 8 (optimización, detalle de trades, UI MT5) completada

---

## PARTE C — Laboratorio de Estrategias (nuevo flujo de creación)

### C.1 El Problema con el Flujo Actual

Hoy el flujo está al revés y es incómodo:
1. Se crea una estrategia **a ciegas** (eligiendo tipo/par/timeframe/parámetros sin haber probado nada).
2. Se guarda.
3. Recién entonces se va al backtest a probarla.
4. Si se quiere cambiar par o timeframe, hay que **volver a editar la estrategia** y re-probar.

Esto obliga a un ida y vuelta molesto entre "crear estrategia" y "backtest", y las estrategias nacen sin validar.

### C.2 El Flujo Nuevo (laboratorio → guardar ya validada)

Un **laboratorio** (espacio de trabajo unificado, evolución del actual Workbench — puede cambiar de nombre a "Laboratorio") donde el usuario:

1. **Elige la herramienta** (tipo de estrategia: ma_cross, rsi, macd, bollinger, combined).
2. **Elige el par** (selector de símbolos operables) y el **timeframe**.
3. **Ajusta los parámetros** iniciales.
4. **Ejecuta backtest** ahí mismo (efímero, sin guardar nada todavía) → ve métricas y el chart.
5. **Optimiza** ahí mismo (el panel de optimización automática de la Fase 8) → ve el ranking robusto, carga una combinación DENTRO del rango.
6. Itera libremente: cambia par, timeframe, parámetros, vuelve a probar/optimizar — **todo sin crear nada en la base de datos**.
7. **Solo cuando está convencido**, pulsa **"Guardar como estrategia"** → ahí sí se crea la estrategia, ya validada y lista para el bot.

> Principio: la estrategia se guarda al final, ya probada. No se crea a ciegas. El usuario decidió: todo el trabajo en el laboratorio antes de guardar.

### C.3 Detalles

- El laboratorio es independiente de tener una estrategia guardada: se puede experimentar desde cero (elegir tipo/par/TF/params) sin partir de una estrategia existente.
- Todo el backtest y la optimización en el laboratorio son **efímeros** (no persisten) hasta "Guardar como estrategia".
- Al guardar: pide nombre, descripción, y guarda tipo + par + timeframe + parámetros (los que el usuario validó) + SL/TP/riesgo.
- También debe poder **abrir una estrategia existente en el laboratorio** para seguir experimentando y guardar como nueva versión (mantener el versionado que ya existe).
- El cambio de par/timeframe en el laboratorio es inmediato (re-fetch de velas), sin tener que ir a editar la estrategia.
- Mantener la edición rápida de estrategias existentes (la pantalla actual de crear/editar puede quedar como acceso directo, pero el camino recomendado es el laboratorio).

### C.4 Relación con el formulario actual de "Nueva estrategia"

- El formulario actual (crear estrategia a ciegas) puede mantenerse como atajo, pero el flujo principal pasa a ser el laboratorio.
- Evaluar si conviene que "Nueva estrategia" abra directamente el laboratorio en vez del formulario en blanco.

---

## PARTE D — Bot Multi-Estrategia (varias a la vez)

### D.1 Objetivo

Que el bot pueda **ejecutar varias estrategias simultáneamente**, no solo una. Las estrategias pueden ser sobre **pares distintos o el mismo par**.

### D.2 Riesgo Independiente por Estrategia

Decisión del usuario: **cada estrategia tiene su propio lote y sus propios límites** (no un presupuesto global compartido). Es decir, cada estrategia activa en el bot lleva su configuración:
- Lote fijo (o, en el futuro, su sizing).
- Límite de pérdida diaria propio.
- Máx posiciones simultáneas propio.
- (Futuro Fase 8B: su propio presupuesto en dólares / sizing dinámico.)

Esto evita que una estrategia agresiva contamine a una conservadora.

### D.3 PRINCIPIO CENTRAL: Trazabilidad total (cada orden sabe de qué bot/estrategia viene)

> Decisión del usuario: NO es un problema que dos estrategias choquen (una compre y otra venda el mismo par) — son estrategias distintas con su propia lógica y timeframe. Lo CRÍTICO es que el sistema SIEMPRE identifique de qué bot/estrategia viene cada orden. La trazabilidad es el corazón del multi-estrategia.

**Cada orden DEBE llevar grabado su origen.** Mecanismo (usando lo que MT5 provee):

1. **Magic number único por estrategia activa:**
   - Cada estrategia que el bot ejecuta recibe un **magic number distinto**.
   - Cuando el bot consulta posiciones en MT5, cada una trae su magic number → el sistema sabe inmediatamente de qué estrategia es.
   - El cierre, SL/TP, pausa selectiva y PnL se rastrean por estrategia vía su magic.

2. **Comment legible en la orden:**
   - Además del magic, grabar en el campo `comment` de la orden info legible, ej: `"estrategia3_EURUSD_M5"`, para identificar el origen incluso mirando directamente en MT5.

3. **Persistencia en BD:**
   - Cada trade guarda `strategy_id` (de qué estrategia viene) + el magic number + el comment.
   - Las órdenes/posiciones/historial llevan SIEMPRE el campo "de qué bot/estrategia viene".

4. **Visible en TODA la UI:**
   - Posiciones, Historial, Log de señales y Journal muestran de qué estrategia es cada fila.
   - Poder filtrar por estrategia.

**Sobre señales opuestas en el mismo par (una compra, otra vende):**
- Está PERMITIDO y es esperado — son estrategias distintas. La cuenta XM es "Hedge", lo soporta.
- No se bloquea ni se trata como error. Simplemente cada posición queda trazada a su estrategia.
- Registrar en el Journal cuando ocurre (informativo, no como alarma), para que el usuario tenga visibilidad.

**Informativo (no bloqueante):**
- Mostrar la **exposición por par** (suma de posiciones de todas las estrategias en ese par) como información útil, para que el usuario vea su concentración real. No es una restricción, es transparencia.

**Límite global de seguridad (recomendado, opcional):**
- Además de los límites por estrategia, un límite global del bot (máx posiciones totales, pérdida total diaria) como red de seguridad. Documentado como recomendado; el usuario decide si lo activa.

### D.4 Implementación

- El estado del bot pasa de "una estrategia" a "una lista de estrategias activas", cada una con su config y su runner/loop (o un loop que itera sobre todas las estrategias activas evaluando cada una en su par/timeframe).
- Cada estrategia activa: su símbolo resuelto (operable), su timeframe, su magic number, sus guards.
- El panel de control del bot debe permitir **añadir/quitar estrategias** a la ejecución, cada una con su config, y ver el estado de cada una.
- El Journal y el log de señales deben indicar **de qué estrategia** es cada evento/evaluación.
- Las posiciones, historial y PnL se muestran por estrategia y en agregado.
- El panic sigue cerrando TODO (todas las estrategias), pero considerar también un "detener/pausar una estrategia concreta".

### D.5 UI del Bot Multi-Estrategia

- En el panel de control: una lista de estrategias activas (no un único selector). Para cada una: estrategia, par, timeframe, lote, límites, estado (running/paused), PnL.
- Botón para añadir otra estrategia a la ejecución.
- Pausar/detener una estrategia individual, además del panic global.
- En el Toolbox (Posiciones/Historial/Log/Journal de la Fase 8), poder filtrar por estrategia o ver de cuál es cada fila.
- Mostrar exposición por par (alerta si hay concentración).

### D.6 Seguridad

- Sigue siendo SOLO demo hasta decisión explícita del usuario.
- El panic global cierra todas las posiciones de todas las estrategias (prioridad).
- Arranque PAUSADO tras reinicio del bridge se mantiene para todas.
- Los límites por estrategia + (recomendado) límite global protegen la cuenta.

---

## Verificación

**Parte C (laboratorio):**
- Se puede entrar al laboratorio, elegir tipo/par/timeframe/parámetros desde cero.
- Backtest y optimización funcionan ahí mismo, efímeros (no crean nada hasta guardar).
- Cambiar par/timeframe es inmediato, sin editar una estrategia.
- "Guardar como estrategia" crea la estrategia ya validada con todos sus datos.
- Abrir una estrategia existente en el laboratorio y guardar como nueva versión funciona.

**Parte D (multi-estrategia):**
- El bot ejecuta 2+ estrategias a la vez, cada una con su lote/límites.
- Cada estrategia usa magic number distinto; las posiciones se rastrean por estrategia.
- Dos estrategias sobre el mismo par: el sistema las identifica, registra en Journal, muestra exposición; no se confunden.
- Panic cierra todo; se puede pausar una estrategia individual.
- Log/Journal/Historial indican de qué estrategia es cada registro.

- `tsc` 0 · build OK · tests pasan · verificar EN PANTALLA.

---

## Nota de orden sugerida

La Parte C (laboratorio) es independiente y de valor inmediato — puede ir primero.
La Parte D (multi-estrategia) es más compleja y toca el motor del bot; conviene construirla con cuidado y probar bien los guardarraíles del "mismo par".
Si el agente lo prefiere, puede entregarlas en dos entregas (C primero, D después), pero ambas están especificadas aquí.

---

*Fase 8C/8D · Laboratorio de estrategias + bot multi-estrategia con riesgo independiente · SOLO demo*
