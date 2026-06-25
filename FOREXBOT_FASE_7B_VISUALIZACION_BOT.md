# ForexBot — Fase 7B: Visualización en Vivo del Bot
> Mejora de la Fase 7 · Chart en tiempo real que muestra QUÉ analiza el bot y POR QUÉ decide
> Prerequisito: Fase 7 (bot en vivo) completada y validada

---

## 1. Objetivo

Mientras el bot opera, mostrar un gráfico profesional en vivo que visualice exactamente lo que el bot está analizando y por qué tomó (o no) cada decisión. Convertir el bot de "caja negra que escribe en un log" a un sistema transparente donde el usuario entiende cada evaluación de un vistazo.

**Reutiliza** la base de TradingView Lightweight Charts ya implementada en el dashboard (Fase 3), potenciándola con la capa de decisiones del bot.

---

## 2. Qué Muestra el Chart

### 2.1 Base (velas + estrategia)
- **Velas del par** que el bot opera, actualizándose en vivo conforme cierran nuevas velas
- **Líneas de la estrategia superpuestas** sobre las velas, según el tipo:
  - `ma_cross`: las dos medias (fast/slow) con sus colores
  - `bollinger`: las bandas superior/media/inferior
  - `rsi` / `macd`: la línea principal va en la **franja de indicador inferior** (ver 2.3)
  - `combined`: las líneas relevantes de cada componente
- Las líneas se recalculan con los mismos valores que usa el bot (consistencia total entre lo que se ve y lo que se evalúa)

### 2.2 Marcadores de decisión
- **En cada vela evaluada:** un marcador discreto que indica que el bot evaluó ahí
  - Color/forma según resultado: evaluación sin entrada (neutro), señal de compra (verde ↑), señal de venta (rojo ↓)
- **Entradas y salidas reales:** flechas prominentes de compra/venta donde el bot ejecutó `order_send`
  - Líneas horizontales de **SL** (rojo) y **TP** (verde) dibujadas desde la entrada
  - Marcador de cierre con el PnL resultante

### 2.3 Franja de indicador inferior
- Pane separado debajo de las velas (como en el dashboard) para osciladores
- Para `rsi`: la línea de RSI con sus umbrales (oversold/overbought) dibujados; se ve claramente cuándo tocó zona de entrada
- Para `macd`: línea MACD + señal + histograma
- Para estrategias sin oscilador (ma_cross, bollinger): la franja puede mostrar volumen o quedar oculta

---

## 3. Explicación de Decisiones (Tooltip + Panel)

> Decisión de diseño confirmada: tooltip para resumen rápido, panel lateral para detalle completo.

### 3.1 Tooltip (resumen rápido)
- Al pasar el mouse / tocar un marcador de evaluación → tooltip breve
- Contenido: timestamp, resultado (entró/no entró), motivo corto, valores clave de indicadores
- Ej: "13:45 · No entró · Sin cruce de medias · fast 1.13487 / slow 1.13496"

### 3.2 Panel lateral (detalle completo)
- Al hacer clic en un marcador → panel lateral sincronizado con el detalle completo de esa evaluación:
  - Timestamp exacto
  - Tipo de señal y si se ejecutó
  - **Todas las condiciones evaluadas** y cuáles se cumplieron o no (ej: "fast > slow: NO · cruce reciente: NO")
  - Valores completos de todos los indicadores en ese momento
  - Si ejecutó: detalles de la orden (lote, precio entrada, SL, TP)
  - Si no ejecutó: la razón precisa
  - Estado de los guards en ese momento (¿había margen? ¿se alcanzó máx posiciones?)
- El panel se actualiza al hacer clic en distintos marcadores; navegación fluida entre decisiones

### 3.3 Explicación enriquecida por IA (OPCIONAL / FUTURO)
- El motivo base lo da el código del bot (ya existe: "Sin cruce de medias", "RSI en zona neutra")
- **Futuro opcional:** un botón "Explicar con IA" que genera una explicación en lenguaje natural más rica ("Las medias venían convergiendo desde hace 3 velas; el fast está a punto de cruzar pero aún no confirma"). Usaría API o modo manual (copy-paste).
- NO es parte del MVP de esta fase; se deja la puerta abierta en el diseño pero se implementa después si se desea.

---

## 4. Tiempo Real (el reto técnico)

El chart debe sincronizar TRES flujos en vivo:
1. **Velas nuevas** — cuando cierra una vela, se añade al chart
2. **Valores de estrategia recalculados** — las líneas (EMAs, bandas, RSI) se extienden con cada vela
3. **Eventos del bot** — cada evaluación y cada trade llegan por Reverb y aparecen como marcadores

### Implementación
- Reusar el componente de chart del dashboard como base
- Suscripción Reverb a los eventos del bot (`BotSignalEvaluated`, `BotTradeExecuted`) ya emitidos en Fase 7
- El bridge debe exponer, junto a cada evaluación, los valores de indicadores necesarios para dibujar las líneas (ya incluye `indicator_values`; ampliar si hace falta para las series completas)
- `series.update()` de Lightweight Charts para añadir datos sin redibujar todo (eficiente)
- Buffer de las últimas N velas + evaluaciones para no saturar memoria en sesiones largas
- Estado de carga inicial: al abrir la vista del bot, cargar el histórico reciente de velas + las evaluaciones ya registradas de la sesión actual (`signals` del `/bot/status`)

---

## 5. Ubicación en la UI

- Integrar en la página de control del bot (`Pages/Bot/Control.tsx`) o una pestaña dedicada "Visualización"
- Layout: chart grande como protagonista, panel lateral de detalle a la derecha (colapsable), controles del bot accesibles
- El log de señales en texto (Fase 7) se mantiene como vista alternativa/complementaria — algunos prefieren texto, otros el chart

---

## 6. Diseño Visual

- Coherente con el chart del dashboard (paleta dark, mismos colores de velas verde/rojo)
- Líneas de estrategia con colores distinguibles (ej: fast EMA azul, slow EMA naranja)
- Marcadores de evaluación discretos para no saturar; entradas/salidas prominentes
- Panel lateral: fondo `background-surface`, valores en JetBrains Mono, condiciones cumplidas en verde / no cumplidas en gris
- Tooltip ligero, no intrusivo

---

## 7. Resumen de Tareas para el Agente

1. Componente de chart en vivo del bot reutilizando la base de Lightweight Charts del dashboard
2. Superposición de líneas de estrategia según tipo (ma_cross, bollinger, rsi, macd, combined)
3. Franja de indicador inferior para osciladores con umbrales dibujados
4. Marcadores de evaluación (con color por resultado) + flechas de entrada/salida con SL/TP
5. Tooltip de resumen al hover/tap sobre marcadores
6. Panel lateral de detalle completo al hacer clic (condiciones evaluadas, indicadores, guards, orden)
7. Sincronización en tiempo real vía Reverb (velas + líneas + eventos del bot)
8. Carga inicial del histórico reciente + evaluaciones de la sesión actual
9. Asegurar que el bridge expone los valores necesarios para dibujar las series completas
10. (Dejar preparado, sin implementar) el gancho para explicación IA futura
11. Tests + verificación e2e con el bot corriendo (idealmente provocando una entrada en M1/M5)

---

## 8. Criterio de Aceptación (e2e)

Con el bot corriendo en una estrategia ma_cross (EMA 5/10) en M1/M5:
1. El chart muestra las velas en vivo y las dos EMAs superpuestas, actualizándose con cada vela
2. Cada evaluación del bot aparece como marcador en la vela correspondiente
3. Hover sobre un marcador → tooltip con resumen (motivo + valores)
4. Clic sobre un marcador → panel lateral con el detalle completo de esa decisión
5. Cuando el bot entra → flecha de entrada + líneas SL/TP visibles; al cerrar → marcador con PnL
6. Todo se actualiza en vivo sin recargar (Reverb)
7. Para una estrategia RSI: la franja inferior muestra la línea RSI con los umbrales y dónde tocó

---

*Documento complementario · Mejora de la Fase 7 · Ejecutar tras validar el bot en vivo*
