# ForexBot — Laboratorio: limpieza + capital inicial + equity lado a lado + tablas ordenables

> Refinamientos sobre la disposición Sidebar (ya elegida como definitiva).

---

## 1. Eliminar la disposición "Barra arriba" y el toggle (limpieza)

El usuario eligió **Sidebar** como definitiva. Eliminar:
- El componente `LayoutBar` y `BarConfig`.
- El toggle/selector de disposición ("Barra arriba" / "Sidebar").
- Cualquier referencia/estado asociado (la preferencia en localStorage del toggle).
Dejar el laboratorio funcionando solo con la disposición Sidebar (`LayoutSidebar` + `SidebarConfig`). Código limpio, sin restos de la disposición descartada.

---

## 2. Capital inicial configurable (en la card/sección Instrumento)

### Problema
Actualmente el backtest usa el saldo de la cuenta de MT5 como capital. El usuario quiere **definir su propio capital inicial** para el backtest.

### Solución
- Añadir un campo **"Capital inicial"** (monto en USD) en la sección Instrumento del sidebar.
- El usuario escribe el monto (ej: 1000, 500, 10000). Default razonable (ej: 10000 o el de la cuenta, pero editable).
- El backtest usa ESE capital inicial para todos los cálculos de rendimiento (retorno %, equity, drawdown), en vez del saldo real de MT5.
- Pasar el capital inicial al motor de backtest del bridge (parámetro de la petición de backtest/optimización).
- El retorno % y la curva de equity se calculan sobre este capital.

---

## 3. Capital inicial visible en la barra de métricas

En la franja de métricas fija sobre el chart, **mostrar el capital inicial** (el dinero de inicio) como una métrica/dato más, para dar contexto al rendimiento.
- Ej: una tarjeta "Capital inicial: $1,000" junto a las demás (neto/bruto/costos/retorno…).
- Idealmente mostrar también el **capital final** (inicial + PnL neto) para ver de un vistazo en cuánto terminó.
- Con su icono "i" si aplica ("Capital con el que arranca el backtest; base para calcular retorno % y drawdown").

---

## 4. Sidebar fijo con scroll SOLO en el sidebar (reforzar)

> Ya se intentó (sticky + overflow), pero el usuario lo pide de nuevo: asegurar que quede bien.

- El **sidebar permanece fijo** en su lugar; NO se mueve al scrollear la zona de resultados.
- El **scroll es solo del sidebar** (scroll interno propio) cuando su contenido excede el alto visible.
- La zona derecha (charts + tabs + tablas) scrollea de forma independiente.
- Verificar EN PANTALLA que: al bajar en los trades/resultados, el sidebar se queda quieto; y que si el sidebar es largo, tiene su propio scroll sin arrastrar el resto.
- Comprobar que no haya doble scroll raro ni que el sidebar empuje el layout.

---

## 5. Gráfica de Equity al lado del chart de TradingView (lado a lado)

### Qué se quiere
Mostrar la **curva de equity (balance)** AL LADO del chart de velas (lado a lado), no solo en una tab aparte. Así se ve el precio y la evolución del capital simultáneamente.

### Solución
- En la zona principal del laboratorio, disponer el **chart de precio (Lightweight Charts) y la gráfica de equity lado a lado** (dos columnas), tras ejecutar un backtest.
- La equity es la curva de balance acumulado a lo largo del backtest (ya existe en la tab Equity con Recharts; reusar).
- Proporción sugerida: el chart de precio más ancho (protagonista) y la equity más estrecha al lado, o 60/40 — lo que se vea equilibrado. El agente ajusta para que ambos sean legibles.
- En pantallas estrechas (no es el foco ahora, pero por robustez) pueden apilarse; en desktop, lado a lado.
- La tab "Equity" de abajo puede quedar o eliminarse si ya está lado a lado (a criterio; evitar redundancia molesta). Mantener Trades y Optimización como tabs.
- La equity debe reflejar el capital inicial configurado (punto 2).

---

## 6. Tablas ordenables al hacer clic en el encabezado

### Qué se quiere
En las tablas del laboratorio (Trades, y donde aplique como Optimización), al **hacer clic en el título de una columna**, ordenar la tabla por esa columna (como MT5).

### Solución
- Cada encabezado de columna clicable: primer clic ordena ascendente, segundo clic descendente (toggle), indicador visual de la dirección (flecha ▲/▼ — usar icono, sin emoji).
- Aplicar a la tabla de **Trades** (ordenar por hora de entrada, hora de salida, PnL, par, dirección, duración, etc.).
- Aplicar también a la tabla de **Optimización** si tiene sentido (ordenar por robustez, in-sample, out-sample, ops) — aunque por defecto debe seguir ordenada por robustez.
- Mantener la fila expandible con la gráfica embebida (punto previo) funcionando junto con el ordenamiento.

---

## 7. BUG — Tooltips del sidebar quedan recortados/detrás (z-index / overflow)

### Problema
Los tooltips "i" del sidebar quedan **detrás del límite del sidebar / recortados**, no se leen bien. Deben aparecer **por encima de todo**.

### Causa
Es un efecto secundario del scroll que se añadió al sidebar: al tener `overflow-y: auto` (y/o un stacking context), el contenedor **recorta** cualquier contenido que se salga de sus bordes, incluido el tooltip. Por eso el tooltip se corta o queda detrás.

### Solución
- El tooltip debe renderizarse **por encima de todo** y NO ser recortado por el `overflow` del sidebar. Opciones (elegir la más robusta):
  - Renderizar el tooltip en un **portal** (React portal a `document.body`), posicionado junto al icono "i" con coordenadas calculadas → así no lo recorta ningún `overflow` ancestro.
  - O asegurar que el tooltip tenga un `z-index` alto y que ningún ancestro con `overflow` lo recorte (puede requerir que el tooltip escape del contenedor scrolleable).
- Recomendado: **portal**, es la forma fiable de que un tooltip dentro de un contenedor con overflow se muestre completo por encima de todo.
- El tooltip debe seguir apareciendo en hover y focus, posicionado correctamente junto a su icono, sin cortarse en los bordes de la pantalla.
- Aplica al `InfoTooltip` usado en el sidebar (y conviene que valga para todos los usos del componente).

### Verificación
- Abrir un tooltip "i" de un parámetro del sidebar → se ve completo, por encima del sidebar y de todo lo demás, legible.
- Funciona incluso para los parámetros de más abajo en el sidebar (con scroll).

---

## 8. Modal con barra de progreso para tareas en ejecución

### Problema
Al ejecutar un backtest o una optimización (que tarda, porque barre muchas combinaciones), no hay feedback de que la tarea está corriendo. Puede parecer que se congeló.

### Solución
- Mostrar un **modal con una barra de progreso** mientras se ejecuta una tarea (backtest y, sobre todo, optimización).
- El modal indica qué se está ejecutando (ej: "Optimizando… combinación 12 de 30") y una **barra de progreso** que avanza.
- Para la **optimización**: el progreso real importa (son muchas combinaciones). El bridge debe reportar avance:
  - Idealmente, el endpoint de optimización reporta progreso (nº de combinaciones evaluadas / total), vía polling a un endpoint de estado, o streaming (SSE/websocket), o respuestas por lotes.
  - Si reportar progreso real es complejo, como mínimo: barra indeterminada (spinner/animada) + contador si está disponible, para que el usuario sepa que sigue trabajando.
- Para el **backtest** simple (más rápido): al menos un estado de "Ejecutando…" con barra (indeterminada si no hay progreso granular).
- El modal se cierra solo al terminar y muestra el resultado; permitir (si es viable) un botón para cancelar una optimización larga.
- Sin emojis; diseño coherente con el dark theme.

### Verificación
- Al ejecutar una optimización, aparece el modal con barra de progreso que avanza (o indeterminada con contador).
- Al ejecutar un backtest, hay feedback visual de que está corriendo.
- El modal desaparece al terminar y se ven los resultados.

---

## 9. BUG — Revisar el cálculo del Win Rate (parece mostrar fracción, no porcentaje)

### Problema
El Win Rate muestra **0.4%** con 55 trades, profit factor 1.22 y PnL neto positivo. Esto es **incoherente**: con 0.4% de aciertos (menos de 1 trade ganador de 55) sería imposible tener profit factor 1.22 y PnL positivo.

### Causa probable
El cálculo está mostrando la **fracción** (ej: 0.4) en lugar del **porcentaje** (40%). Falta multiplicar por 100, o se formatea como "%" un valor que ya es fracción. El valor real probablemente es **~40%**, que sí es coherente con profit factor 1.22 y PnL positivo.

### Solución
- Revisar el cálculo/formato del Win Rate (en el bridge o donde se calcule, y en el frontend donde se muestra).
- Asegurar que Win Rate = (trades ganadores / trades totales) × 100, mostrado como porcentaje con 1-2 decimales (ej: "40.0%").
- Verificar coherencia: el Win Rate debe cuadrar con el nº de trades ganadores vs perdedores reales del backtest.
- Revisar de paso que las demás métricas (profit factor, retorno, DD) estén bien calculadas y formateadas, ya que un error de fracción/porcentaje puede repetirse.

### Verificación
- El Win Rate muestra un valor coherente (ej: ~40%, no 0.4%) que cuadra con los trades ganadores/perdedores reales.
- Cruzar: si hay 55 trades y el win rate es 40%, deben ser ~22 ganadores y ~33 perdedores; confirmar que los números reales coinciden.

---

## 10. Verificación

- Ya no existe la disposición "Barra arriba" ni el toggle; solo Sidebar, código limpio.
- Hay un campo de Capital inicial editable; el backtest usa ese monto (retorno %, equity, DD sobre él).
- La barra de métricas muestra el capital inicial (y final).
- El sidebar queda fijo y con scroll propio; la derecha scrollea independiente.
- El chart de precio y la curva de equity se ven lado a lado tras un backtest.
- Las tablas se ordenan al hacer clic en los encabezados (asc/desc con indicador).
- Los tooltips "i" del sidebar se ven completos por encima de todo (no recortados por el scroll/overflow).
- Al ejecutar backtest/optimización aparece un modal con barra de progreso; desaparece al terminar.
- El Win Rate muestra un valor coherente (porcentaje real, no fracción) que cuadra con los trades reales.
- `tsc` 0 · build OK · si se toca el motor de backtest (capital inicial), tests del bridge pasan · verificar EN PANTALLA.

---

*Laboratorio · limpieza de disposición + capital inicial propio + equity junto al precio + tablas ordenables*
