# ForexBot — FIX CRÍTICO: El caché del Explorador NO persiste tras reiniciar

> El caché pierde todo lo calculado al reiniciar el bridge/PC. EURUSD# estaba al 100% anoche; tras reiniciar volvió a 25% (recalcula en vez de leer de la DB). Esto rompe toda la premisa del caché ("el pasado no cambia, no recalcular").

---

## El Problema

- El usuario exploró EURUSD# por completo (100% en el mapa de cobertura) en un periodo+capital dados.
- Reinició el bridge y/o la PC.
- Al volver, con el **mismo periodo y capital exactos**, EURUSD# aparece al **25%** (o menos): el sistema NO encuentra los resultados en caché y los recalcula.
- El contexto es idéntico → la clave del caché debería coincidir → debería leer de la DB. No lo hace. **Los datos viejos ya no están en la DB.**

## Causa MÁS PROBABLE (investigar primero)

Al construir el mapa, se reportó: *"la caché se recreó con el esquema nuevo; el esquema viejo se recrea automáticamente"*. Sospecha principal:

1. **La DB del caché se BORRA/RECREA al arrancar el bridge.** Si el código de inicialización hace algo como `DROP TABLE` + `CREATE TABLE`, o recrea el archivo, o un "migrar esquema" que limpia los datos → cada reinicio del bridge vacía el caché. Esto explica EXACTAMENTE el síntoma (100% anoche → 25% tras reiniciar).
   - Revisar el código que crea/abre `explore_cache.db` y la tabla `explore_cache` (y `explore_searches`): debe usar `CREATE TABLE IF NOT EXISTS`, NUNCA `DROP`/recrear si ya existe.
   - Si hubo una migración de esquema (se añadieron columnas para el mapa), la migración debe **preservar los datos** (ALTER TABLE / añadir columnas), no recrear la tabla desde cero.

2. **Ruta del archivo de la DB inestable.** Verificar que `explore_cache.db` se guarde SIEMPRE en la misma ruta absoluta (ej: junto al bridge en `D:\mtrad\bridge\explore_cache.db`), no en un directorio temporal, ni relativa al working directory (que puede cambiar según cómo se arranque el bridge: desde el panel vs manual vs reinicio). Si la ruta cambia entre arranques, "no encuentra" la DB anterior y arranca una nueva vacía.

3. **La migración del esquema nuevo borró la data una vez** (aceptable la primera vez), pero además dejó el código recreando en cada arranque (no aceptable). Separar: migrar una vez (preservando), y nunca recrear si ya existe.

## La Solución

1. **La DB del caché debe PERSISTIR entre reinicios.** Nunca borrarse al arrancar.
   - `CREATE TABLE IF NOT EXISTS` para tablas.
   - Migraciones de esquema con `ALTER TABLE ADD COLUMN` (preservando filas), o detectar columnas faltantes y añadirlas sin borrar datos.
   - Si se necesita un cambio de esquema incompatible, migrar los datos viejos al nuevo formato, no descartarlos.

2. **Ruta absoluta y estable** para `explore_cache.db` (y `explore_searches`): siempre el mismo archivo, independiente de cómo o desde dónde se arranque el bridge (panel, manual, auto-recuperación, reinicio de PC). Definir la ruta de forma absoluta basada en la ubicación del módulo del bridge, no en el cwd.

3. **Verificar el flujo de lectura del caché:** que al evaluar una combinación, realmente consulte la DB por la clave (símbolo, tipo, tf, params, SL, TP, riesgo, capital, periodo, engine_version) y, si existe, la use sin recalcular. Confirmar que la clave que se ESCRIBE es idéntica a la que se LEE (mismo orden de campos, mismo formato de fechas, mismo redondeo) — una diferencia sutil de formato haría que nunca haya "hit".

4. **engine_version:** confirmar que no se está incrementando en cada arranque por error (si cambia sola, invalidaría todo el caché cada vez). Debe ser una constante estable.

## Diagnóstico a reportar
- Decir cuál de las causas era (borrado al arrancar / ruta inestable / clave inconsistente / engine_version).
- Confirmar dónde vive físicamente el archivo de la DB y su tamaño, para verificar que persiste.

## Verificación (el escenario EXACTO del usuario)
1. Explorar EURUSD# (o una zona) → queda al 100% en el mapa, con periodo+capital X.
2. **Reiniciar el bridge** (y probar también reiniciar la PC) .
3. Volver al mapa con el **mismo periodo+capital X** → EURUSD# sigue al **100%** (NO recalcula; lee de la DB).
4. Confirmar que una nueva búsqueda de esa zona dice "todo de caché" (0 calculadas) y es instantánea.
5. El archivo `explore_cache.db` existe en su ruta estable, conserva su tamaño tras reiniciar, y crece (no se resetea).
- `tsc` 0 · build OK · bridge tests: persistencia (escribir, simular reinicio reabriendo la DB, leer y encontrar hit) · verificar EN PANTALLA con reinicio real.

---

## Nota
Este fix es de alta prioridad: sin persistencia, el caché y el mapa de cobertura pierden su sentido (recalcular cada vez tras reiniciar). Es la base sobre la que descansa la premisa "el pasado no se recalcula".

---

*Fix crítico · el caché del Explorador debe persistir entre reinicios (no borrarse al arrancar, ruta estable, clave consistente)*
