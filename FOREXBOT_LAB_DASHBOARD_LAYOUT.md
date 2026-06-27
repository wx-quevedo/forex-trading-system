# ForexBot — Laboratorio: Layout tipo Dashboard (dos zonas de scroll) + botón Optimizar directo

> Cambios estructurales del Laboratorio para que se comporte como un dashboard profesional.

---

## 1. Layout tipo dashboard: la página cabe en UNA vista, con dos zonas de scroll independientes

### Qué se quiere
El Laboratorio debe comportarse como un **dashboard clásico** (estilo Gmail/Notion/cualquier panel serio):

- **Toda la página cabe en una sola vista** = ocupa exactamente el alto de la pantalla (100vh). **NO hay scroll global de la ventana.**
- Hay **DOS zonas independientes, cada una con su propio scroll**:
  - **Sidebar** (izquierda): fijo. No se mueve cuando se scrollea el área de gráficas. Tiene su PROPIO scroll interno solo si su contenido excede el alto.
  - **Content area** (derecha: métricas + charts + tabs + tablas): tiene su PROPIO scroll interno. Al scrollear aquí, el sidebar permanece totalmente quieto.

### Diagrama

```
┌─────────────────────────────────────────────────────────────┐
│  HEADER (fijo, fuera de las zonas de scroll)                │
├──────────────┬──────────────────────────────────────────────┤
│  SIDEBAR      │   CONTENT AREA                              │
│  (fijo;       │   (overflow-y: auto — su propio scroll)     │
│   su propio   │   métricas fijas arriba + charts +          │
│   scroll si   │   tabs (Trades/Optimización) + tablas       │
│   hace falta) │                                             │
│  overflow-y:  │   ← scrollea SOLO esta zona                 │
│  auto         │                                             │
└──────────────┴──────────────────────────────────────────────┘
   ↑ contenedor raíz = 100vh, overflow hidden (sin scroll de ventana)
```

### Implementación
- El contenedor raíz de la página: alto fijo al viewport (`h-screen` / `100vh`) y `overflow: hidden` para eliminar el scroll global de la ventana.
- Debajo del header, un contenedor flex horizontal (sidebar + content) que ocupa el alto restante.
- **Sidebar:** alto completo de esa fila, `overflow-y: auto` propio. Queda fijo; no se desplaza con el content.
- **Content area:** `flex-1`, `overflow-y: auto` propio. Todo lo de la derecha (métricas, charts, tabs, tablas) scrollea dentro de esta zona.
- Importante: ya NO se usa `position: sticky` para el sidebar; ahora el sidebar es una columna de alto completo con su propio scroll (enfoque dashboard real), no un elemento sticky que depende del scroll de página.
- La barra de métricas puede quedar fija en la parte superior del content area (no scrollear con el resto del content) o scrollear con él — preferible: **métricas fijas arriba del content**, y solo charts+tabs+tablas scrollean debajo. (Si fijar las métricas dentro del content complica, al menos lograr las dos zonas de scroll; las métricas fijas son un plus.)
- Verificar que NO aparezca scroll de la ventana (la página no "crece"); solo scrollean las dos zonas internas.
- El header de la app permanece arriba, fijo, fuera de las zonas de scroll.

### Verificación
- La ventana del navegador NO tiene scroll global; la página ocupa exactamente el alto de pantalla.
- Scrollear el área de gráficas/tablas NO mueve el sidebar.
- El sidebar, si su contenido es largo, tiene su propio scroll independiente.
- Ambas zonas conviven en una sola vista, estilo dashboard.

---

## 2. Botón "Optimizar" del sidebar: ejecutar la optimización directamente

### Problema
El botón "Optimizar" (debajo de "Ejecutar backtest" en el sidebar) actualmente **solo lleva a la pestaña Optimización**, no ejecuta nada. El usuario tiene que pulsar otro botón dentro de la pestaña para que corra.

### Solución
- El botón **"Optimizar" del sidebar debe LANZAR la optimización directamente** (la misma acción que hoy hace el botón de dentro de la pestaña).
- Al pulsarlo: ejecuta la optimización (mostrando el modal de progreso) y, al terminar, muestra los resultados en la pestaña Optimización (cambiar a esa pestaña automáticamente está bien).

---

## 3. Quitar el botón "Ejecutar optimización" de dentro de la pestaña

### Problema
Dentro de la pestaña Optimización hay un botón "Ejecutar optimización" que ahora es redundante (la acción la dispara el botón del sidebar).

### Solución
- **Eliminar el botón "Ejecutar optimización"** de dentro de la pestaña Optimización.
- La pestaña Optimización solo muestra el texto explicativo y los resultados (el ranking) cuando existen; antes de ejecutar, un placeholder ("Pulsa Optimizar para barrer combinaciones…").
- La optimización se dispara únicamente desde el botón "Optimizar" del sidebar.

---

## 4. Verificación general
- Layout dashboard: una vista, dos scrolls (sidebar + content), sin scroll de ventana.
- Sidebar fijo al scrollear el content.
- "Optimizar" del sidebar ejecuta directamente (con modal de progreso) y muestra resultados.
- Ya no existe el botón de optimizar dentro de la pestaña.
- `tsc` 0 · build OK · verificar EN PANTALLA.

---

*Laboratorio · estructura de dashboard con dos zonas de scroll + flujo de optimización directo*
