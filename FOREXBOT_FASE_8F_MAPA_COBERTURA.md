# ForexBot — Fase 8F: Mapa de Cobertura de Exploración (jerárquico)

> Una guía visual de QUÉ hemos explorado y qué falta — NO un mapa de resultados/robustez (eso es otra cosa, para después). Responde "¿qué combinaciones ya calculé y cuáles siguen vírgenes?".
> Inspirado en el grid de contribuciones de GitHub, pero JERÁRQUICO (para manejar las muchas dimensiones sin aplastarlas en un gráfico imposible).
> Prerequisito: caché de resultados del Explorador (Fase 8E + caché) ya construido — el mapa se alimenta de la caché.

---

## Concepto

El espacio de búsqueda tiene muchas dimensiones (par, tipo, timeframe, parámetros, SL, TP, riesgo). No se pueden dibujar todas a la vez. Solución: **niveles jerárquicos navegables**, cada nivel = una dimensión, con drill-down por clic.

Cada celda muestra un **% de completitud (0-100%)** = qué fracción de las combinaciones posibles "debajo" de esa celda ya está calculada (en caché). Color verde proporcional al %: blanco = 0% (virgen), verde fuerte = 100% (todo explorado).

> Propósito: GUIAR la exploración. De un vistazo, el usuario ve dónde concentrarse (celdas blancas/bajas) y qué ya está cubierto (verdes). Cuando todo está verde, trabajar ahí es instantáneo (todo de caché).

---

## La jerarquía (niveles)

```
CONTEXTO (arriba, siempre visible): Periodo [Desde]–[Hasta]  +  Capital
   (el mapa entero refleja la cobertura PARA ESE periodo y capital)

NIVEL 1 — PARES
   [EURUSD# 87%] [GBPUSD# 40%] [USDJPY# 12%] [GOLD# 0%] ...
      ↓ clic en un par
NIVEL 2 — TIPOS DE ESTRATEGIA (de ese par)
   [ma_cross 100%] [rsi 60%] [macd 0%] [bollinger 25%] [combined 0%]
      ↓ clic en un tipo
NIVEL 3 — TIMEFRAMES (de ese par + tipo)
   [M5 0%] [M15 0%] [H1 100%] [H4 50%] [D1 0%] ...
      ↓ clic en un timeframe
NIVEL 4 — PARÁMETROS / SL / TP / RIESGO (de ese par+tipo+tf)
   La combinación más fina. Aquí cada celda es una combinación concreta
   (o un sub-grid 2D, ej. SL×TP, con los params del tipo). 
   Explorado (en caché) vs no explorado.
```

- **Breadcrumb / navegación:** mostrar la ruta actual (ej: "EURUSD# › rsi › H4") con poder volver a niveles superiores.
- Cada nivel es una cuadrícula de celdas con su nombre + % + color verde proporcional.

---

## CONTEXTO: Periodo y Capital (decisión del usuario)

- El **periodo (Desde/Hasta)** y el **capital** son **selectores de contexto en la parte superior**, NO niveles de la jerarquía. Razón: las fechas son un rango continuo (infinitas combinaciones), no discretas como par/tipo/tf.
- El mapa muestra la cobertura **para ese periodo y capital concretos**. Si el usuario cambia el periodo o el capital, el mapa se recalcula (porque la caché distingue resultados por periodo y capital — son parte de la clave).
- Default: el último periodo/capital usado, o uno razonable.

---

## EL % DE COMPLETITUD (corazón del sistema — definir bien)

Para decir "EURUSD# está al 87%", el sistema necesita saber cuál es el **100% = el universo total de combinaciones posibles**.

### El universo lo define el SISTEMA (decisión del usuario)
- El sistema define **rangos estándar** para cada parámetro (el "universo oficial" de exploración). Ejemplos (el agente ajusta a valores sensatos por tipo):
  - Timeframes considerados: {M5, M15, M30, H1, H4, D1} (definir el set oficial).
  - SL: {15, 20, 30, 50}. TP: {30, 40, 60, 100}. Riesgo: {0.5, 1, 2}.
  - Parámetros por tipo (ej. RSI: period {7,14,21}, oversold {25,30,35}, overbought {65,70,75}; ma_cross: fast/slow en rangos definidos; etc.) — usar los MISMOS rangos que el Explorador ofrece por defecto, para coherencia.
- El **100% de una celda** = todas las combinaciones posibles dentro de esos rangos, "debajo" de esa celda.
- El **% actual** = (combinaciones de esa celda que YA están en caché para el periodo+capital del contexto) / (total de combinaciones posibles de esa celda) × 100.

### Cálculo jerárquico
- Nivel 4 (combinación concreta): está al 0% o 100% (existe en caché o no).
- Nivel 3 (timeframe): % = fracción de sus combinaciones de parámetros/SL/TP/riesgo que están en caché.
- Nivel 2 (tipo): % = fracción agregada sobre todos sus timeframes.
- Nivel 1 (par): % = fracción agregada sobre todos sus tipos.
- Es decir, el % de una celda superior es el agregado (promedio ponderado por nº de combinaciones) de las celdas inferiores.

### Importante: el universo debe ser explícito y versionado
- El "universo oficial" (los rangos) debe estar definido en un solo lugar (config), y ser el MISMO que usa el Explorador por defecto, para que "100%" signifique "exploré todo el universo estándar".
- Si en el futuro se amplían los rangos (ej. se añade un timeframe), el denominador cambia y los % bajan (hay más por explorar) — eso es correcto y esperado. Documentarlo.

---

## INTERACCIÓN: clic para navegar Y para explorar

- **Clic en una celda con % > 0 y < 100 o = 100:** baja al siguiente nivel (drill-down) para ver el detalle.
- **Clic en una celda vacía/incompleta a nivel explorable → LANZAR la búsqueda de esa zona** (decisión del usuario):
  - En el nivel apropiado, un botón/acción "Explorar esta zona" que lanza en el Explorador la búsqueda de todas las combinaciones faltantes de esa celda (para el periodo+capital del contexto).
  - Reusa el motor del Explorador (con su modal de progreso, caché, etc.). Solo calcula lo que falta (lo ya en caché no se recalcula).
  - Al terminar, el mapa se actualiza: la celda sube su % (se pinta más verde).
- Así el flujo es: ver el mapa → detectar zonas blancas → clic → explorar → el mapa se pinta → repetir. La cobertura crece visiblemente.

> El mapa es a la vez PASIVO (refleja lo que ya se ha calculado, venga de donde venga) y ACTIVO (permite lanzar exploración de zonas concretas). Ambas, como pidió el usuario.

---

## Página / ubicación

- Puede ser una pestaña o sección dentro del Explorador (ej: "Mapa de cobertura") o una página propia ligada a él.
- Se alimenta de la **caché de resultados** (consulta qué claves existen para el periodo+capital del contexto y las cuenta contra el universo).
- Endpoint(s) en el bridge para devolver los conteos de cobertura por nivel (ej: `GET /explore/coverage?period=…&capital=…&path=EURUSD#/rsi` → devuelve los % de las celdas hijas). Solo 127.0.0.1.

---

## Lo que este mapa NO es (aclaración)
- NO es un mapa de robustez/resultados (no colorea por retorno ni por DENTRO/FUERA del rango). Eso es una herramienta distinta (el heatmap de resultados), que se puede hacer DESPUÉS.
- Este mapa solo responde: **¿qué he explorado y qué me falta?** El verde = explorado, no = bueno.
- (Nota para el futuro: más adelante se podría añadir un modo alternativo de color = robustez, pero NO en esta entrega; mantenerlo enfocado en cobertura.)

---

## Verificación
- El mapa muestra el Nivel 1 (pares) con % de completitud y verde proporcional, para el periodo+capital del contexto.
- Clic en un par → Nivel 2 (tipos) con sus %; clic en tipo → timeframes; clic en timeframe → parámetros. Breadcrumb para volver.
- Los % se calculan contra un universo estándar definido por el sistema (mismos rangos que el Explorador por defecto).
- Cambiar el periodo/capital del contexto recalcula el mapa.
- Una celda recién explorada (vía "Explorar esta zona" o vía una búsqueda normal del Explorador) sube su % y se pinta más verde.
- "Explorar esta zona" lanza solo lo faltante (usa caché) con el modal de progreso.
- El mapa refleja correctamente la caché (si algo está en caché, cuenta como explorado).
- `tsc` 0 · build OK · bridge tests (conteo de cobertura por nivel correcto) · verificar EN PANTALLA.

---

## Nota de orden
Funcionalidad nueva y visual. Se puede entregar por partes:
1. Endpoint de cobertura en el bridge (contar caché vs universo por nivel) + definición del universo estándar.
2. El mapa jerárquico navegable (niveles, %, color, breadcrumb).
3. La acción "Explorar esta zona" desde una celda.

---

*Fase 8F · Mapa de cobertura jerárquico · guía visual de qué se ha explorado y qué falta · niveles par→tipo→tf→params · alimentado por la caché*
