# ForexBot — Explorador: Caché de Resultados + Búsquedas Guardadas + Tope configurable

> El pasado no cambia: un backtest sobre velas históricas da SIEMPRE el mismo resultado. Cachear los cálculos ya hechos para no recalcularlos → búsquedas progresivamente más rápidas. Además, guardar búsquedas completas para reabrirlas, y subir/flexibilizar el tope de combinaciones.

---

## PARTE 1 — Caché de resultados por combinación (memoización)

### Idea
Cada combinación evaluada se guarda con su resultado. Si una búsqueda futura incluye esa misma combinación, se trae de la caché (instantáneo) en vez de recalcularla. Las búsquedas se aceleran a medida que se acumula caché.

### Almacenamiento: SQLite (decisión)
- Usar **SQLite** (archivo local en la tower, junto al bridge). Razones: ya está en el stack, no requiere instalar nada, es muy rápido para lookup por clave con índice, robusto, y local (sin dependencia de red).
- Tabla ej: `explore_cache` con la clave y el resultado (JSON con todas las métricas).
- Índice sobre la columna de clave (hash) para lookup O(log n) / instantáneo.
- Puede crecer a millones de filas sin problema con el índice adecuado.

### LA CLAVE DEL CACHÉ (crítico — definir con TODO lo que afecta el resultado)

> Un resultado SOLO es reutilizable si TODOS los factores que lo determinan son idénticos. Si la clave omite un factor, se devolvería un resultado incorrecto. La clave debe incluir EXACTArMENTE todo lo que cambia el cálculo:

- **Símbolo** (par, ej: EURUSD#)
- **Tipo** de estrategia (ma_cross, rsi, …)
- **Timeframe** (M5, H1, H4, …)
- **Todos los parámetros** de la estrategia (period, fast, slow, oversold, overbought, deviation, etc.)
- **SL** y **TP** (pips)
- **Riesgo %**
- **Capital inicial** (afecta sizing/resultado por el lote mínimo, como vimos)
- **Periodo del backtest:** fecha **Desde** y **Hasta** EXACTAS (define qué velas se usan).
- **Configuración de costos** (spread/comisión/swap) si pudiera variar — si los costos se derivan del símbolo en el momento, considerar incluir una versión/fecha (ver "invalidación" abajo).
- **Split in/out** y parámetros de la evaluación de robustez (si cambian, los veredictos cambian) — incluir una **versión del motor/lógica** en la clave (ver abajo).

La clave puede ser un **hash** (ej: SHA-1) de la tupla ordenada de todos esos campos. Guardar también los campos legibles para depurar/filtrar.

### Versión del motor (invalidación por cambios de lógica)
- Incluir en la clave una **`engine_version`** (constante que se incrementa manualmente cuando cambia la lógica de backtest/costos/robustez).
- Así, si en el futuro cambia cómo se calcula algo (ej: se ajustan los costos, o el split), los resultados viejos con otra versión NO se reutilizan por error: se recalculan con la lógica nueva.
- Esto evita el riesgo más sutil del caché: servir resultados calculados con una lógica antigua.

### Cuidado especial con el PERIODO "Hasta" y datos recientes
- Si el "Hasta" es una fecha pasada cerrada, las velas de ese rango ya no cambian → cacheable con seguridad.
- Si el "Hasta" es HOY o muy reciente, la última vela puede no estar cerrada / pueden llegar más datos → para rangos que incluyen el presente, ser cuidadoso: cachear solo hasta velas cerradas, o no cachear el tramo no cerrado. (Para backtests históricos normales no es problema; documentarlo por robustez.)

### Flujo
1. Al evaluar una combinación, calcular su clave (hash).
2. Buscar en `explore_cache`. Si existe (mismo hash y misma engine_version) → usar el resultado guardado (no recalcular).
3. Si no existe → calcular, y **guardar** el resultado en la caché.
4. El barrido del Explorador así solo calcula lo que NO está en caché; el resto es lookup instantáneo.

### Beneficio mostrado al usuario
- En el reporte/resumen, indicar cuántas combinaciones vinieron de caché vs cuántas se calcularon (ej: "15.000 de caché · 5.000 calculadas"). Así el usuario ve el ahorro.
- Esto puede hacer que una búsqueda de 20.000 que antes tardaba minutos, la segunda vez sea casi instantánea.

### Mantenimiento
- (Opcional) Un control en el panel de escritorio para ver el tamaño de la caché y limpiarla si se desea (ej: si quiere forzar recálculo, o liberar espacio).

---

## PARTE 2 — Guardar búsquedas completas con nombre (reabrir resultados)

### Idea
Además del caché por combinación, permitir **guardar una búsqueda completa** (su configuración + su reporte de resultados) con un nombre, para reabrirla después sin recalcular nada.

### Detalle
- Tras una búsqueda, un botón **"Guardar esta búsqueda"** → pide un nombre (ej: "Barrido majors H4 jun2026").
- Guarda: la configuración usada (pares, tipos, timeframes, SL/TP, riesgo, capital, periodo) + el reporte completo de resultados (todas las combinaciones con sus métricas).
- Una sección **"Búsquedas guardadas"** (lista) donde el usuario las ve y **reabre** una al instante (carga el reporte tal cual, sin recalcular).
- Poder borrar búsquedas guardadas.
- Almacenar en la BD (SQLite del bridge, o en Laravel/su BD si encaja mejor con la UI — a criterio; lo importante es que se reabran rápido).
- Distinción de las dos cosas:
  - **Caché por combinación** (Parte 1): transparente, acelera CUALQUIER búsqueda reutilizando cálculos.
  - **Búsquedas guardadas** (Parte 2): explícitas, con nombre, para volver a un reporte concreto que te interesó.

---

## PARTE 3 — Tope de combinaciones: subir / flexibilizar con advertencia

### Situación
Hoy hay un tope duro de 60.000 combinaciones (rechaza con 422). El usuario quiere poder superarlo.

### Solución
- **Subir el tope** a un valor más alto (ej: 200.000) Y/O convertirlo en una **advertencia en vez de un bloqueo**:
  - Si la estimación supera cierto umbral, mostrar una **advertencia clara** ("Esto ejecutará ~215.000 backtests; con caché previo puede ser más rápido, pero una búsqueda nueva de este tamaño puede tardar X y mantener la CPU alta. ¿Continuar?") y un botón para confirmar.
  - Permitir continuar bajo confirmación, en lugar de impedirlo del todo.
- Mantener un **límite máximo absoluto** de seguridad razonable (ej: que no se dispare a millones por error) — configurable.
- Con el caché (Parte 1), las búsquedas grandes repetidas dejan de ser costosas, así que el tope molesta menos.
- Mostrar en la estimación cuántas combinaciones probablemente ya están en caché (si es fácil estimarlo) para que el usuario sepa que no recalculará todo.

---

## PARTE 4 — Regla de quiebra de cuenta (capital no puede ser negativo)

### Problema (detectado por el usuario)
El backtest muestra valores de **capital final negativos**, lo cual es **imposible en la realidad**: si pierdes todo tu capital, llegas a $0 y NO puedes seguir operando (la cuenta "se quema" / blow up). El motor actual simula todas las operaciones de corrido sumando/restando PnL matemáticamente, **sin verificar si el capital tocó cero en el camino**, así que deja la estrategia "seguir operando" con capital imaginario negativo e incluso "recuperarse".

### Por qué importa (realismo crítico)
- En la realidad, al quedarse sin capital (o sin margen) el broker hace **margin call** y cierra posiciones; no se puede seguir.
- Una estrategia que en el backtest "se recupera" desde un capital negativo, en la vida real **ya habría quebrado la cuenta** y estaría fuera del juego.
- Mostrar capital negativo (o recuperación tras quiebra) hace que una estrategia ruinosa parezca menos mala. Es un sesgo optimista peligroso.

### Solución (en el motor de backtest — aplica a Laboratorio Y Explorador)
- Durante la simulación, **rastrear el capital (equity) acumulado operación a operación**.
- Si el capital cae a **cero o por debajo de un umbral de quiebra** (ej: capital ≤ 0, o ≤ un mínimo de margen requerido), marcar la cuenta como **QUEBRADA ("blown")** en ese punto:
  - **Detener la simulación ahí** (no se ejecutan más operaciones; no hay "recuperación" posible).
  - El capital final = 0 (o el valor de quiebra), nunca negativo.
  - Registrar que la cuenta quebró y **en qué punto/fecha** (y cuántas operaciones alcanzó a hacer antes).
- En el reporte (Laboratorio y Explorador), para esas combinaciones:
  - Mostrar capital final = $0 y un **indicador claro de "Cuenta quebrada"** (badge/color), no un número negativo.
  - Idealmente marcar el veredicto como descartable (una estrategia que quiebra la cuenta NO es robusta por definición, aunque "en papel" se recuperara).
- Consideración de margen (opcional, más realista): el margin call real ocurre antes de $0 (cuando el margen libre no cubre las posiciones abiertas). Como primer paso, usar capital ≤ 0 = quiebra; si se quiere más realismo, modelar un nivel de margen. Documentar cuál se implementó.

### Efecto en métricas
- El drawdown máximo de una cuenta que quiebra es −100% (perdió todo); reflejarlo así.
- El retorno de una cuenta quebrada es −100% (no un número peor inventado).
- Asegurar que la robustez/optimización trate la quiebra como el peor resultado posible (nunca como algo "recuperado").

### Interacción con el caché
- El resultado "quebró / capital final 0" es determinista para esa combinación+capital → se cachea igual que cualquier otro resultado.
- El **capital inicial** ya está en la clave del caché (afecta cuándo se quiebra), así que está cubierto.

### Verificación
- Una combinación que antes daba capital final negativo, ahora muestra capital final = $0, marcada "Cuenta quebrada", con el punto de quiebra registrado.
- No se simula ninguna operación después de la quiebra.
- El drawdown/retorno de esa combinación reflejan la quiebra (−100%), y no aparece como robusta.
- Aplica igual en Laboratorio y Explorador (mismo motor).

---

## Verificación general (actualizada)
- La clave incluye TODOS los factores (símbolo, tipo, tf, params, SL, TP, riesgo, capital, periodo, engine_version); cambiar cualquiera fuerza recálculo.
- Cambiar `engine_version` invalida la caché vieja (recalcula).
- **Búsquedas guardadas:** guardar una con nombre, reabrirla → muestra el reporte sin recalcular; se puede borrar.
- **Tope:** se puede lanzar una búsqueda > 60.000 tras confirmar la advertencia; hay un máximo absoluto de seguridad.
- **Quiebra:** una combinación que tocaba capital negativo ahora se detiene en $0, marcada "Cuenta quebrada", no aparece como robusta; aplica en Laboratorio y Explorador.
- `tsc` 0 · build OK · bridge tests (caché: hit/miss, clave correcta, invalidación por versión; quiebra: detención en 0, no recuperación) · verificar EN PANTALLA.

---

## Nota de orden
Se puede entregar por partes: (1) **regla de quiebra** (fix de realismo importante, e independiente), (2) caché por combinación (lo de mayor impacto en rendimiento), (3) tope configurable con advertencia, (4) búsquedas guardadas con nombre. La quiebra y el caché son las dos de mayor valor.

---

*Explorador · caché de resultados en SQLite (el pasado no se recalcula) + búsquedas guardadas + tope flexible · clave de caché exhaustiva + versión de motor*
