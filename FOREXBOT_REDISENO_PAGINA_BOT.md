# Rediseño de la página `/bot` — Especificación para implementación

## Contexto y objetivo

La página `/bot` nació como **consola de configuración** (añadir estrategias a mano, ajustar lotes, mandarlas a ejecución). El flujo evolucionó: ahora las estrategias vienen **solo de Favoritos** (validadas y optimizadas), la cartera está montada y armada, y la demo corre semanas de forma autónoma. La página ya no sirve para "configurar y lanzar" — sirve para **vigilar lo que corre y actuar rápido** (pausar/reanudar/panic).

**Objetivo del rediseño:** convertir `/bot` en un panel de **monitoreo + control rápido**, limpio y usable, y mover toda la configuración que se toca una sola vez a una página aparte llamada **Configuraciones** (que reemplaza la actual "Contexto").

**Decisiones ya tomadas por el usuario (no reabrir):**
1. La página es, sobre todo, para **vigilar Y actuar rápido** (pausar/reanudar/panic siempre a mano).
2. Las 4 estrategias ya están armadas; solo se necesita un **botón discreto para recargar de Favoritos** si hace falta. Se **eliminan** los formularios "Añadir estrategia" y "Añadir a la ejecución".
3. "Contexto" pasa a ser una **página/pestaña aparte** llamada **"Configuraciones"**. La vista `/bot` queda solo para monitoreo y control.
4. Refrescar el estilo visual (colores, tipografía, tarjetas) **manteniendo el tema oscuro**.

**Importante — alcance:** este es un rediseño de **frontend (React/Inertia/TS/Tailwind/shadcn)**. No cambia la lógica del bot, el ejecutor, ni los endpoints del bridge. Reusa los datos que ya expone `/bot/status`, `/bot/lifecycle`, `/bot/journal`, `/healthz`, y las acciones existentes (pausar/reanudar/detener/panic, cargar favoritos, preview). Si algún dato necesario no está en un endpoint actual, indícalo antes de codificar en vez de inventar; no toques el bridge sin avisar.

---

## Antes de codificar: leer la skill de diseño

Antes de escribir cualquier componente, lee `/mnt/skills/public/frontend-design/SKILL.md` (o la copia local si la tienes) y aplica sus principios: jerarquía por frecuencia de uso, tipografía con personalidad pero legible para datos, estructura que codifica información real (no decoración), y refresco visual con intención (no un dashboard genérico). El tema es oscuro; el refresco es sobre densidad, jerarquía y legibilidad de datos financieros, no sobre añadir adornos.

---

## Estructura de la página `/bot` (nueva)

Orden vertical, de lo más mirado (arriba) a lo menos (abajo). Jerarquía por **frecuencia de uso diario**.

```
┌───────────────────────────────────────────────────────────────┐
│  1. BARRA DE ESTADO GLOBAL  (sticky top)                        │
│     ● Bot activo · 4/4 armadas · PnL día +$X                    │
│                                    [Pausar todo]  [PANIC]       │
├───────────────────────────────────────────────────────────────┤
│  2. TARJETAS DE LAS 4 ESTRATEGIAS  (grid responsive)            │
│     cada tarjeta: símbolo·tipo, estado, PnL, params, acción     │
│                                     [↻ Recargar de Favoritos]   │
├──────────────────────────────┬────────────────────────────────┤
│  3. POSICIONES ABIERTAS       │  4. ACTIVIDAD (journal)         │
│     tabla compacta            │     aperturas/cierres recientes │
├──────────────────────────────┴────────────────────────────────┤
│  5. SALUD DEL SISTEMA  (fila discreta, footer)                  │
│     bridge ✓ · MT5 ✓ · watchdog ✓ · BD ✓ · última señal HH:MM  │
└───────────────────────────────────────────────────────────────┘
```

### 1. Barra de estado global (sticky arriba)

La pieza que el usuario mira primero cada vez que abre la página. Debe responder de un vistazo: *¿está corriendo el bot? ¿cuánto va hoy? ¿puedo pararlo ya si hace falta?*

- **Indicador de estado global:** punto de color + texto. Estados: `Activo` (verde), `Pausado` (ámbar), `Detenido` (gris), `Problema` (rojo — si salud degradada).
- **Resumen:** `N/4 armadas` (cuántas de las 4 corriendo) y **PnL del día** (grande, con color: verde positivo, rojo negativo, neutro en cero). El PnL del día es el número más importante de la barra.
- **Acciones globales, siempre visibles:**
  - **`Pausar todo`** — pausa las 4 (no cierra posiciones). Botón secundario.
  - **`PANIC — Cerrar todo`** — cierra todas las posiciones y detiene. Botón destructivo (rojo), con **confirmación** ("¿Cerrar las N posiciones abiertas y detener el bot?") porque es irreversible.
- Sticky: se mantiene visible al hacer scroll. Es la barra de control; nunca debe quedar fuera de vista.

### 2. Tarjetas de las 4 estrategias (el corazón de la página)

Una tarjeta por estrategia de la cartera (las 4 de Favoritos: GOLD macd, GOLD donchian, GBPUSD cci, USDJPY rsi). Grid responsive: 2×2 en escritorio, 1 columna en móvil.

Cada tarjeta muestra:
- **Cabecera:** símbolo + tipo (`GOLD# · macd`) y un badge de **estado** claro y distinguible:
  - **`ARMADA · esperando señal`** (verde suave) — running, sin posición abierta. *Este estado debe ser inequívoco: el usuario no debe confundir "armada esperando" con "inactiva".* Es la confusión que motivó parte de este rediseño.
  - **`OPERANDO`** (verde intenso) — running con posición abierta.
  - **`PAUSADA`** (ámbar) — pausada por el usuario o por auto-pausa.
  - **`DETENIDA`** (gris).
  - **`BLOQUEADA`** (rojo) — circuit breaker saltó o límite diario alcanzado; mostrar el motivo.
- **PnL de esa estrategia** (del día o de la posición abierta): con color.
- **Si OPERANDO:** entrada, SL, TP, lote de la posición (compacto).
- **Parámetros clave:** `riesgo 1% · ATR×N · límite $X`. Discretos, en la línea inferior.
- **Acción individual:** un solo botón contextual — `Pausar` si corre, `Reanudar` si pausada. `Detener`/`Quitar` en un menú "⋯" secundario (no en primer plano; se usan poco).

**Debajo del grid:** el único control de gestión que queda — **`↻ Recargar de Favoritos`** (discreto, secundario). Abre el diálogo de carga de favoritos existente (con los límites por candidata pre-rellenados y las protecciones). Solo para re-armar si hiciera falta. **Elimina por completo** el formulario "Añadir estrategia" (selector de estrategia, lote, timeframe, etc.) y el botón "+ Añadir a la ejecución".

### 3. Posiciones abiertas (columna izquierda inferior)

Tabla compacta de posiciones abiertas ahora mismo (la que ya existe, pero más densa y legible). Columnas: estrategia, símbolo, dir, lote, entrada, actual, SL, TP, PnL. Si no hay posiciones: estado vacío con dirección, no un simple "sin posiciones" — algo como *"Sin posiciones abiertas. Las estrategias armadas abrirán cuando llegue su señal."* (invita/explica, no solo informa el vacío — ver guía de escritura de la skill).

### 4. Actividad / Journal (columna derecha inferior)

Feed de las aperturas/cierres recientes desde el **journal persistente** (`/bot/journal`). Cada entrada: hora, estrategia, ABRE/CIERRA, detalle (lote, precio, SL/TP, PnL/motivo). Es la trazabilidad — sobrevive reinicios. Botón/enlace "ver más" si el journal es largo. Reemplaza las pestañas actuales (Posiciones/Historial/Log/Journal) por esta vista de actividad continua, o mantenlas como sub-tabs si es más limpio — a tu criterio, priorizando legibilidad.

### 5. Salud del sistema (footer discreto)

Una fila compacta, no una tarjeta grande — es información de fondo que el usuario mira solo si algo va mal. Chips de estado: `bridge ✓`, `MT5 ✓`, `watchdog ✓`, `BD ✓`, `última señal HH:MM`, `auto-reanudar armado`. Verde si OK, rojo si falla. Datos de `/healthz` y `/bot/lifecycle`. Si algo está rojo, que la barra de estado global (arriba) también lo refleje en `Problema`.

---

## Página `/configuraciones` (reemplaza "Contexto")

Renombrar "Contexto" a **"Configuraciones"** en la navegación y rutas (mantener redirect de la ruta vieja si existe, para no romper enlaces). Aquí va todo lo que se toca una vez y no pertenece a la vista diaria de monitoreo. Agrupar en secciones claras:

- **Rango y capital de validación** — el rango de backtest/optimización y el de validación walk-forward, capital inicial (lo que hoy vive en Contexto).
- **Notificaciones** — mover aquí los toggles de Telegram desde `/bot`. Nombrar por lo que el usuario controla, no por el sistema: "Avisarme de aperturas", "Avisarme de cierres", "Avisarme de circuit breakers / límites", "Resumen diario", etc. (No exponer el token; solo los toggles y quizá un indicador "Telegram conectado ✓".)
- **Protecciones por defecto** — valores por defecto de Portfolio Heat, Circuit Breakers (pérdidas/DD), caducidad de arme. Los que se aplican al cargar la cartera.
- **Filtro de noticias** — el toggle y la ventana de minutos.
- **Gestión de Favoritos / cartera** — cargar/quitar favoritos, ver la cartera actual. La parte "pesada" de gestión, fuera de la vista diaria de `/bot`.

Cada sección con su descripción breve en lenguaje de usuario (qué controla, en plano). Ver la guía de escritura de la skill: nombres por lo que la persona controla y reconoce, no por cómo está construido el sistema.

---

## Dirección visual (refresco, tema oscuro)

Mantener oscuro, pero refrescar densidad, jerarquía y legibilidad de datos financieros. No un dashboard genérico. Guía (el agente afina según la skill, pero con estas anclas):

- **Fondo:** oscuro pero no negro puro — un carbón/azul-noche muy oscuro da menos fatiga que `#000` y se siente más intencional. Ej. rango `#0E1116`–`#151A21` para fondo y superficies de tarjeta ligeramente más claras que el fondo (jerarquía por elevación, no por bordes duros).
- **Acentos por estado, no decorativos:** el color codifica información. Verde para activo/positivo, ámbar para pausado/atención, rojo para bloqueado/negativo/panic, gris para inactivo. Un solo verde de acción, un solo rojo de peligro — consistentes en toda la página. Evita paletas de muchos colores compitiendo.
- **Tipografía:** una face para números/datos financieros con **cifras tabulares** (que los dígitos alineen en columnas — crítico en tablas de PnL/precios; ej. una mono o una sans con `font-variant-numeric: tabular-nums`), y una sans limpia para etiquetas y texto. El PnL y los precios son los protagonistas tipográficos; que se lean rápido y alineados.
- **Tarjetas:** superficies con elevación sutil (sombra suave o fondo más claro), radios moderados, buen padding interno. Densidad de "cockpit" — información compacta pero respirable, no espaciado de landing page.
- **El PnL del día (barra global)** es el número más grande y protagonista de la página. Es lo primero que el ojo debe encontrar.
- **Signature (el elemento memorable):** los **badges de estado de las estrategias**. En vez de un simple pill de color, hazlos claros e informativos — el estado "ARMADA · esperando señal" con quizá un pulso/indicador sutil de "vivo, esperando", distinto visualmente de "OPERANDO". Ese lenguaje de estados es lo que hace esta página reconocible y resuelve la confusión original de "¿está esperando o inactiva?". Gasta aquí la intención de diseño; mantén el resto disciplinado.

**Calidad de base (sin anunciarla):** responsive hasta móvil (el usuario revisa desde el teléfono), foco de teclado visible, `prefers-reduced-motion` respetado (si el badge "esperando" pulsa, que se detenga con reduced-motion). La confirmación del PANIC es obligatoria.

---

## Qué se elimina (explícito)

- Formulario **"Añadir estrategia"** (selector de estrategia, lote de respaldo, timeframe, límite pérdida diaria manual, máx posiciones manual) — fuera.
- Botón **"+ Añadir a la ejecución"** — fuera.
- Sección de toggles de **Telegram** en `/bot` — se mueve a `/configuraciones`.
- Los controles de **Circuit Breakers / Portfolio Heat / caducidad** como formulario editable en `/bot` — sus valores por defecto viven en `/configuraciones`; en `/bot` se **muestran** (solo lectura) en cada tarjeta/salud, no se editan.

## Qué se conserva (reubicado o refrescado)

- Estado global, PnL, pausar/panic → barra global sticky.
- Las tarjetas de estrategias activas → refrescadas, con estados claros.
- Posiciones, historial, journal → vista de actividad + posiciones.
- Salud del sistema (bridge/MT5/watchdog/BD) → footer discreto.
- Cargar de Favoritos → botón discreto en `/bot` + gestión completa en `/configuraciones`.

---

## Proceso sugerido para el agente

1. Leer la skill de frontend-design y proponer un mini design-system (tokens de color por estado, escala tipográfica con cifras tabulares, estilo de tarjeta) **antes** de codificar. Enseñárselo al usuario si hay duda.
2. Confirmar qué datos exponen ya los endpoints (`/bot/status`, `/bot/lifecycle`, `/bot/journal`, `/healthz`) y si falta alguno para esta vista; **no tocar el bridge sin avisar**.
3. Implementar por partes verificables: primero la barra global + tarjetas (lo más usado), luego posiciones/journal, luego salud, luego la página Configuraciones. Verificar en pantalla cada parte (hard-refresh, es frontend).
4. Mantener la demo intacta durante todo el rediseño — es solo la capa de presentación; el bot sigue corriendo. Si algo requiere reiniciar el bridge, avisar y agendarlo, no hacerlo en medio.
5. Tests de los componentes nuevos donde aplique; `tsc`/build limpios antes de dar por hecho.
6. Commit al terminar cada parte verificada.

## Criterio de éxito

- Al abrir `/bot`, el usuario ve en <2 segundos: si el bot corre, cuánto va hoy, el estado de las 4, y tiene Pausar/Panic a mano — sin scroll.
- Ningún estado ambiguo: "armada esperando" nunca se confunde con "inactiva".
- Cero formularios de configuración en la vista diaria; todo lo de config vive en `/configuraciones`.
- Legible y usable desde el móvil.
- El estilo se siente intencional y fresco (no un dashboard de plantilla), manteniéndose oscuro y sobrio.
