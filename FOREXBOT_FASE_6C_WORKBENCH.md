# ForexBot — Fase 6C: Workbench de Afinamiento (Vista Unificada)
> Documento adicional · Convierte la vista de backtest en un banco de trabajo de iteración
> Prerequisito: Fase 6 (modo API) y Fase 6B (modo manual) completadas

---

## 1. Contexto y Objetivo

Hoy el ciclo de afinar una estrategia obliga a saltar entre pestañas: ver el backtest en una, ir a "Estrategias" a crear/editar otra versión, volver a "Backtests" a correr de nuevo. Eso rompe el flujo.

Esta fase unifica **estrategia + backtest + análisis IA** en una sola pantalla: un **workbench** donde el usuario edita parámetros en vivo, re-corre el backtest al instante, compara el resultado contra la corrida anterior y la inicial, y aplica las sugerencias de Claude directamente sobre los campos editables — sin cambiar de pestaña ni crear nada hasta que decide guardar.

**Filosofía:** así trabaja un trader cuando afina — ajustar, correr, ver, repetir, todo en el mismo lugar.

---

## 2. Decisiones de Diseño (confirmadas con el usuario)

1. **Edición en vivo sin persistir.** El usuario mueve parámetros y re-corre cuantas veces quiera; esas corridas son efímeras (no ensucian la BD). Solo cuando un resultado le gusta pulsa **"Guardar como nueva versión"** y ahí sí se crea la versión (mecanismo de versionado de la Fase 4).
2. **Comparación de tres corridas:** mostrar lado a lado **Inicial** (la primera corrida de referencia, fija) · **Anterior** (la corrida inmediatamente previa) · **Actual** (la recién ejecutada). Resaltar mejoras/empeoramientos por métrica.
3. **El JSON de Claude rellena el panel editable**, no crea entidades sueltas en otra pestaña. El usuario ve los campos cambiar, re-corre y compara.

---

## 3. Layout del Workbench

Reemplaza/extiende la vista actual de un backtest (`Backtests/Show` o una nueva `Backtests/Workbench`). Diseño de tres zonas:

```
┌───────────────────────────────────────────────────────────────────────┐
│  HEADER: Backtest workbench — {estrategia} ({tipo} · {par} · {tf})      │
│  [Guardar como nueva versión]   [Volver]                                │
├──────────────────────────┬────────────────────────────────────────────┤
│  PANEL IZQUIERDO (sticky) │  PANEL DERECHO — Resultados                 │
│  ── Parámetros ──         │  ── Comparación de corridas ──             │
│  (formulario dinámico,    │   ┌─────────┬─────────┬─────────┐          │
│   reusa STRATEGY_SCHEMAS) │   │ Inicial │ Anterior│ Actual  │          │
│  ma_type [ema ▾]          │   │ WR 30.9%│ WR 41%  │ WR 47% ▲│          │
│  fast [9]   slow [21]     │   │ PF 0.94 │ PF 1.08 │ PF 1.21▲│          │
│  ── Riesgo ──             │   │ PnL -427│ PnL +88 │ PnL +210▲│         │
│  SL [20] TP [40] risk[1%] │   └─────────┴─────────┴─────────┘          │
│  ── Periodo ──            │  ── Equity curve (Actual) ──               │
│  desde [..] hasta [..]    │  (Recharts; opción overlay Anterior)       │
│                           │  ── Chart velas + marcadores trades ──     │
│  [▶ Re-correr backtest]   │  ── Tabla de trades (filtros) ──           │
│  (estado: corriendo…)     │                                            │
├──────────────────────────┴────────────────────────────────────────────┤
│  PANEL INFERIOR — Afinamiento con IA   [modo: Manual ▾ | API]           │
│  Manual:  [Generar prompt]→textarea copiable                            │
│           [Pegar JSON de Claude]→[Aplicar al panel de parámetros]       │
│  API:     chat integrado (Fase 6) → [Aplicar al panel de parámetros]    │
│  En ambos: "Aplicar" rellena el PANEL IZQUIERDO (no crea versión)       │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 4. Comportamiento Detallado

### 4.1 Panel izquierdo — parámetros editables
- Formulario dinámico idéntico al de la Fase 4 (los campos dependen del tipo de estrategia, leídos de `STRATEGY_SCHEMAS` del bridge).
- Incluye gestión de riesgo (SL/TP/risk) y rango de fechas del backtest.
- Estado inicial: precargado con los parámetros de la estrategia y el rango del backtest que se abrió.
- Es **estado local del frontend** (React) — editar no guarda nada todavía.

### 4.2 Re-correr backtest (efímero)
- Botón "Re-correr backtest" toma los parámetros actuales del panel y lanza un backtest **efímero** (no persistido como entidad permanente).
- Endpoint nuevo: `POST /backtests/ephemeral` que recibe `{strategy_type, parameters, risk, pair, timeframe, date_from, date_to}`, llama al motor del bridge (`POST /backtest/run`) y **devuelve el resultado sin guardarlo** en la tabla `backtests`.
- Mientras corre: indicador de carga en el panel derecho.
- Al volver: el resultado pasa a ser la corrida **"Actual"**; la que era "Actual" se mueve a **"Anterior"**; la **"Inicial"** nunca cambia.
- Como es efímero, NO usa la cola (Horizon/queue:work) — es una llamada síncrona directa al bridge (con el set_time_limit/timeout largo ya resuelto en Fase 6). Esto da feedback inmediato sin depender del worker.

### 4.3 Comparación de corridas (3 columnas)
- **Inicial:** la primera corrida que se mostró al abrir el workbench (típicamente el backtest persistido original). Fija como línea base.
- **Anterior:** la corrida inmediatamente previa a la Actual.
- **Actual:** la última re-corrida.
- Métricas comparadas: win rate, profit factor, net PnL, return %, max drawdown, Sharpe, total trades.
- Indicadores visuales por métrica: ▲ verde si mejora respecto a Anterior, ▼ rojo si empeora, "=" neutro. (Cuidado con la dirección: en drawdown "mejor" es menos negativo).
- Botón pequeño "Fijar Actual como Inicial" por si el usuario quiere recalibrar la línea base.

### 4.4 Panel inferior — afinamiento IA
- Selector de modo (Manual/API) reutilizado de la Fase 6B.
- **Diferencia clave con 6B:** el botón "Aplicar" ya NO crea directamente una versión. En el workbench, "Aplicar" **rellena el panel izquierdo de parámetros** con los valores sugeridos por Claude. El usuario entonces ve los campos cambiar, pulsa "Re-correr" y compara. Solo si le gusta, usa "Guardar como nueva versión".
- El prompt generado (modo manual) y la validación del JSON son los mismos de la Fase 6B (reutilizar el servicio, no duplicar).
- Al aplicar parámetros sugeridos, hacer un highlight breve (animación) de los campos que cambiaron para que el usuario vea qué tocó la IA.

### 4.5 Guardar como nueva versión
- Botón en el header. Toma los parámetros actuales del panel + (opcionalmente) asocia el resultado de la corrida Actual.
- Crea la nueva versión de la estrategia (Fase 4: `parent_id` → raíz, `version` incremental).
- Opción de también persistir la corrida Actual como un `backtest` real ligado a la nueva versión (para que quede en el historial).
- Tras guardar: feedback claro ("Guardada como v3") y la nueva versión queda seleccionada.

---

## 5. Cambios Backend

1. **Endpoint efímero:** `POST /backtests/ephemeral` en `BacktestController` (o controlador nuevo `WorkbenchController`). Valida parámetros contra `STRATEGY_SCHEMAS`, llama síncronamente al bridge, devuelve métricas+trades+equity sin persistir. Aplica el timeout largo de Fase 6.
2. **Guardar versión desde workbench:** endpoint `POST /strategies/{id}/save-version-from-workbench` que crea la versión con los parámetros del panel y opcionalmente persiste la corrida Actual como `backtest`.
3. Reutilizar `ClaudeService` (API) y el servicio de prompt manual (6B) sin cambios — solo cambia cómo el frontend consume el resultado (rellenar panel vs crear versión).

## 6. Cambios Frontend

1. Nueva página `Backtests/Workbench.tsx` (o transformar `Show.tsx`), con los 3 paneles.
2. Estado local React que mantiene: parámetros actuales, y las tres corridas (inicial/anterior/actual).
3. Componente `RunComparison.tsx` — la tabla de 3 columnas con indicadores de mejora.
4. Componente `ParamHighlight` — animación al rellenar campos desde sugerencia IA.
5. Reutilizar `BacktestChart`, equity curve (Recharts) y tabla de trades existentes; el chart de equity debe poder hacer overlay opcional de la corrida Anterior para comparación visual.
6. El panel izquierdo "sticky" para que al hacer scroll de resultados los parámetros sigan visibles.

---

## 7. Diseño Visual

Mantener la paleta dark de trading y la coherencia con el resto:
- Panel izquierdo: fondo `background-surface`, sticky, separadores `border`.
- Tabla de comparación: las 3 columnas con `background-elevated`; valores en JetBrains Mono; ▲ en `green-profit`, ▼ en `red-loss`, neutro en `text-secondary`. La columna "Actual" ligeramente resaltada (borde `accent-blue`).
- Highlight de campos sugeridos por IA: pulso breve en `accent-blue` (no verde, para no confundir con PnL).
- Botón "Re-correr" prominente (`accent-blue`); "Guardar como nueva versión" claramente diferenciado.
- El panel inferior de IA colapsable, para dar más espacio a resultados cuando no se usa.
- Layout responsive: en pantallas estrechas (acceso desde iPad/móvil) los paneles se apilan verticalmente en orden parámetros → resultados → IA.

---

## 8. Resumen de Tareas para el Agente

1. Endpoint `POST /backtests/ephemeral` (síncrono, no persiste, timeout largo, valida schema).
2. Endpoint para guardar versión desde el workbench (+ opción de persistir la corrida actual).
3. Página `Workbench` con los 3 paneles y estado local de las 3 corridas.
4. Tabla de comparación Inicial/Anterior/Actual con indicadores de mejora por métrica.
5. Integrar afinamiento IA (Manual + API) cuyo "Aplicar" rellena el panel de parámetros (con highlight), no crea versión.
6. Overlay opcional de equity Anterior vs Actual.
7. Panel izquierdo sticky + layout responsive (apilado en pantallas estrechas).
8. Botón "Guardar como nueva versión" en el header.
9. Tests:
   - Endpoint efímero devuelve resultado correcto sin crear filas en `backtests`.
   - Aplicar JSON de IA rellena parámetros sin crear versión.
   - Guardar versión crea la versión correcta (y persiste corrida si se eligió).
   - Comparación calcula bien las flechas de mejora (incluida la inversión en drawdown).

---

## 9. Criterio de Aceptación (e2e)

Abrir el workbench de un backtest perdedor (EMA cross EURUSD):
1. Ver la corrida Inicial cargada en la columna correspondiente.
2. Cambiar fast/slow a mano → Re-correr → ver "Actual" con flechas de comparación vs Inicial.
3. Cambiar de nuevo → Re-correr → ahora hay Inicial / Anterior / Actual con sus 3 columnas.
4. Usar el panel IA (modo manual): generar prompt, pegar un JSON de sugerencia → "Aplicar" rellena los campos (con highlight) → Re-correr → comparar.
5. Cuando un resultado mejora, "Guardar como nueva versión" → se crea la v_n y queda en el historial de la estrategia.
6. Verificar que las corridas efímeras intermedias NO quedaron en la BD (solo la guardada explícitamente).

---

*Documento complementario a FOREXBOT_PROJECT.md · Ejecutar después de Fase 6B*
