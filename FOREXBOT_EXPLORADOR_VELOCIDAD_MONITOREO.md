# ForexBot — Explorador: Diagnóstico de Velocidad + Optimización + Monitoreo en Web

> El usuario observó que el Explorador va LENTO pero la tower NO está al máximo (CPU baja, proceso lento). Eso señala un cuello de botella. Primero DIAGNOSTICAR dónde se va el tiempo, luego optimizar. Además, monitoreo de carga en la web.
> Hardware del usuario: i9-13900K (24 hilos), 128GB RAM, RTX 4090. La tower está infrautilizada durante el barrido.

---

## PARTE A — DIAGNÓSTICO (hacer ESTO PRIMERO, antes de optimizar)

> No optimizar a ciegas. Primero medir dónde se va el tiempo en una búsqueda del Explorador.

### Síntoma observado
- El Explorador procesa lento (ej: una búsqueda de 480 combinaciones tarda bastante).
- PERO la CPU de la tower NO está saturada (el usuario lo ve en el administrador de tareas: la torre está "relajada").
- Conclusión preliminar: hay un cuello de botella que impide aprovechar el hardware.

### Hipótesis a verificar (instrumentar y medir)
1. **¿Ejecución mono-núcleo (serie)?** — HIPÓTESIS MÁS PROBABLE.
   - Python por defecto usa 1 hilo de CPU. Si el barrido corre los backtests **secuencialmente**, usa 1 de 24 núcleos → CPU total ~4%, proceso lento, resto de núcleos ocioso.
   - Verificar: ¿el `ExploreJob` corre las combinaciones en serie en un solo hilo?
2. **¿Cuello de botella en MT5 (I/O wait)?**
   - Si cada backtest espera datos de MT5, la CPU está ociosa *esperando*, no calculando.
   - Verificar que el **reuso de velas** (descargar velas de cada par+timeframe UNA vez y reusarlas) de verdad esté funcionando y no se estén re-pidiendo velas por combinación.
   - Medir cuánto tiempo total se va en llamadas a MT5 vs en cálculo puro.
3. **¿Ineficiencia en el cálculo del backtest?**
   - Recalcular indicadores desde cero en cada combinación cuando podrían cachearse, copias innecesarias de DataFrames, etc.

### Qué instrumentar
- Medir y reportar (en logs o en el resultado de una búsqueda de prueba):
  - Tiempo total del barrido.
  - Tiempo promedio por combinación (backtest individual).
  - Desglose: tiempo en descarga/acceso de velas (MT5) vs tiempo en cálculo (indicadores + simulación) vs overhead.
  - Cuántas veces se piden velas a MT5 (debería ser ~1 por par+timeframe único, NO por combinación).
  - Núcleos/hilos realmente usados durante el barrido.
- Con esos números, **determinar la causa real** y reportarla antes de aplicar la optimización.

---

## PARTE B — OPTIMIZACIÓN (aplicar según lo que revele el diagnóstico)

> Aplicar las que correspondan a la causa encontrada. La más probable es la paralelización.

### B.1 Paralelización multi-núcleo (si es mono-núcleo, que es lo más probable)
- Distribuir los backtests entre **múltiples núcleos** del i9-13900K (tiene 24 hilos).
- En Python, por el GIL, para cálculo CPU-bound conviene **`multiprocessing`** (procesos, no hilos) o `concurrent.futures.ProcessPoolExecutor`. Cada proceso corre un subconjunto de combinaciones.
- Consideraciones:
  - **MT5 y los procesos:** la conexión a MT5 puede no ser compartible entre procesos. Solución: **descargar TODAS las velas necesarias UNA vez en el proceso principal** (par+timeframe únicos), y pasar los datos (DataFrames de velas) a los procesos worker, que hacen SOLO cálculo (backtest sobre velas ya en memoria, sin tocar MT5). Así los workers son CPU puro y paralelizables, y MT5 se toca solo al inicio.
  - Esto encaja perfecto con el reuso de velas: primero se juntan las velas únicas, luego se paraleliza el cálculo.
  - Dejar **configurable el nº de workers** (ej: nº de núcleos − 2, para no congelar la máquina; o un valor ajustable). El usuario tiene 24 hilos; usar muchos acelera mucho.
  - El progreso (done/total) debe seguir funcionando con la ejecución paralela (agregar resultados conforme terminan los procesos).
  - La cancelación debe seguir funcionando (terminar los procesos).
- Resultado esperado: aceleración grande (potencialmente ~10-20x según núcleos usados), con la CPU ahora sí cerca del máximo durante el barrido.

### B.2 Asegurar reuso de velas (si el diagnóstico muestra re-pedidos)
- Confirmar/implementar que las velas de cada (par, timeframe) se descargan una sola vez y se reutilizan para TODAS las combinaciones de parámetros/SL/TP/riesgo de ese par+timeframe.
- Cachear en memoria durante el barrido.

### B.3 Eficiencia de cálculo (si el diagnóstico lo señala)
- Cachear indicadores que se repiten entre combinaciones cuando sea posible (ej: si varias combinaciones comparten el mismo periodo de una media, no recalcularla).
- Evitar copias innecesarias de DataFrames; usar vistas/operaciones vectorizadas de pandas/numpy.
- (Estas son secundarias; la paralelización es la que más impacto tendrá.)

### B.4 Respuesta honesta sobre "¿es el tope?"
- Tras optimizar, reportar la nueva velocidad (combinaciones/seg) y si quedó cerca del límite real del hardware o si hay más margen.
- Ser honesto: si tras paralelizar el cuello pasa a ser MT5 o el cálculo, decirlo. El objetivo es aprovechar el hardware, no prometer imposibles.

---

## PARTE C — MONITOREO EN LA WEB

### C.1 Carga del proceso del bridge (CPU/RAM)
- Exponer en el bridge un endpoint (ej: `GET /system/stats`) que con `psutil` reporte:
  - **CPU del sistema** (% total) y, si es posible, **% del proceso del bridge** específicamente.
  - **RAM** del sistema y del proceso del bridge.
  - Nº de núcleos / hilos disponibles.
  - (Opcional) si es fácil con alguna librería, uso de GPU — pero NO es prioritario (el Explorador no usa GPU; los backtests son CPU). No invertir mucho aquí.
- Mostrar en la web una **sección de monitoreo** (puede ser una tarjeta en el Explorador o una pequeña sección/página) con estos valores actualizándose (polling cada 1-2s).

### C.2 Monitoreo específico del Explorador (progreso + velocidad)
- Durante una búsqueda, mostrar en la web:
  - Progreso real (N de Total, %) — ya existe en el modal; reflejarlo también como dato.
  - **Velocidad:** combinaciones por segundo / por minuto.
  - **Tiempo transcurrido** y **estimación de tiempo restante** (ETA) basada en la velocidad actual.
  - Nº de workers/núcleos en uso (tras la paralelización).
- Así el usuario ve, durante el barrido, cuánto está rindiendo y cuánto falta.

### C.3 Privacidad/seguridad
- El endpoint de stats es solo local (bridge en 127.0.0.1), coherente con la arquitectura actual. No exponer a la red.

---

## Verificación
- **Diagnóstico:** se reporta el desglose de tiempos (MT5 vs cálculo), núcleos usados, y la causa real del cuello de botella, ANTES de optimizar.
- **Optimización:** tras aplicar (probablemente paralelización), el barrido es notablemente más rápido y la CPU se aprovecha; progreso y cancelación siguen funcionando; resultados idénticos a los de antes (misma lógica, solo más rápido).
- **Monitoreo web:** hay una sección que muestra CPU/RAM (sistema y proceso del bridge) y, durante una búsqueda, velocidad + ETA + workers.
- Comparar tiempo de una misma búsqueda (ej: 480 combinaciones) antes vs después de optimizar, y reportarlo.
- `tsc` 0 · build OK · tests del bridge pasan (incl. que los resultados paralelos = secuenciales) · verificar EN PANTALLA.

---

*Explorador · diagnóstico honesto del cuello de botella + paralelización multi-núcleo + monitoreo de carga real en la web*
