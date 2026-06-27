# ForexBot — Control de Trabajos del Explorador (panel) + Auto-liberación de jobs huérfanos

> Tras una caída del bridge, una búsqueda del Explorador quedó "colgada": el sistema cree que sigue corriendo y rechaza toda búsqueda nueva (409), aunque el job ya no hace nada. Solución: control de trabajos en el panel de escritorio + arreglar la causa raíz (jobs huérfanos).

---

## Contexto del problema

- El Explorador corre un `ExploreJob` en segundo plano. `/explore/start` devuelve **409 si ya hay un job en curso** (para evitar dos búsquedas simultáneas).
- Si el bridge se cae / reinicia a media búsqueda, el estado del job puede quedar marcado como "corriendo" sin estarlo realmente (job huérfano / zombi).
- Resultado: el usuario lanza nuevas búsquedas (otros pares/parámetros) y SIEMPRE recibe el mismo resultado viejo o un rechazo; no puede procesar nada nuevo porque el sistema cree que hay uno activo.

---

## PARTE 1 — Causa raíz: que un job huérfano se libere solo

### Qué arreglar
El estado de "job en curso" debe reflejar la REALIDAD. Si el job no está vivo, el sistema NO debe bloquear nuevas búsquedas.

### Soluciones (aplicar las que correspondan)
1. **Detección de job vivo real:**
   - El estado del job debe verificar si el proceso/hilo/ProcessPool realmente sigue trabajando (heartbeat, timestamp de último avance, o estado del executor), no solo una bandera "running" que pudo quedar pegada.
   - Si el job está marcado "running" pero no ha avanzado en X tiempo (timeout, ej: sin progreso por N segundos/minutos) o el executor ya no existe → considerarlo MUERTO y liberar el estado.

2. **Estado en memoria, no persistente, tras reinicio:**
   - Si el estado del job vive solo en memoria del proceso del bridge, al reiniciar el bridge debería arrancar SIN ningún job activo (estado limpio). Verificar que un reinicio del bridge NO deje un job fantasma marcado como corriendo.
   - Si el estado se persiste en disco (archivo de estado), al arrancar el bridge debe **invalidar/limpiar** cualquier job que estuviera "running" (porque tras un reinicio, por definición, ya no está corriendo) — similar al fail-safe del bot que arranca PAUSADO tras reinicio.

3. **Heartbeat / timeout:**
   - El job actualiza un timestamp de "última señal de vida" mientras avanza. Si `/explore/start` recibe una nueva petición y el job "activo" no tiene latido reciente, se asume muerto y se permite el nuevo (liberando el anterior).

### Resultado esperado
- Tras una caída/reinicio del bridge, NO queda ningún job bloqueando; se puede lanzar una búsqueda nueva inmediatamente.
- Un job que de verdad murió a media ejecución no bloquea el sistema.

---

## PARTE 2 — Control de trabajos en el Panel de escritorio (Python/tkinter)

> El usuario quiere ver y gestionar los trabajos desde el panel de control de escritorio (no la web).

### Funcionalidad: VER el estado de los trabajos
- Una sección nueva en el panel: **"Trabajos del Explorador"** (o "Tareas").
- Mostrar el estado actual del job del Explorador:
  - Si hay uno **en ejecución**: mostrarlo con su progreso (N de Total, %), velocidad si está disponible, tiempo transcurrido.
  - Si está **inactivo/libre**: indicarlo ("Sin trabajos en cola — listo para nuevas búsquedas").
  - Si hay uno **huérfano/atascado** (marcado corriendo pero sin avance): señalarlo como tal.
- El panel consulta al bridge (ej: el endpoint `/explore/status` existente, y/o uno nuevo `/explore/jobs` que liste el estado) cada cierto intervalo.

### Funcionalidad: LIMPIAR / cancelar trabajos
- Un botón **"Cancelar / Liberar trabajo"** que:
  - Si hay un job corriendo de verdad: lo cancela (reusar el `/explore/cancel` existente).
  - Si hay un job huérfano/atascado: lo limpia/libera para que el sistema quede disponible para nuevas búsquedas desde la web.
- Tras pulsarlo, el estado debe quedar limpio y la web debe poder lanzar una búsqueda nueva.
- Confirmación antes de cancelar uno que SÍ está corriendo (para no abortar sin querer una búsqueda larga válida): "Hay una búsqueda en curso al X%. ¿Cancelarla?". Para uno huérfano, limpiar directo.

### Integración con el panel existente
- Coherente con el estilo actual del panel (dark, mismas convenciones).
- Sin emojis.
- El panel ya habla con el bridge para diagnósticos; reusar esa vía.
- Si el bridge está caído, el panel debe indicarlo (no puede consultar trabajos sin bridge); cuando el bridge vuelve, retoma.

### Endpoints del bridge necesarios (si faltan)
- `GET /explore/status` (ya existe) — estado/progreso del job actual.
- (Opcional) `GET /explore/jobs` — lista/estado más detallado si se quiere.
- `POST /explore/cancel` (ya existe) — cancelar.
- (Si hace falta) un endpoint para **forzar limpieza** de un job huérfano (ej: `POST /explore/reset`) que resetee el estado a libre. Solo 127.0.0.1.

---

## Verificación
- **Causa raíz:** tras reiniciar el bridge a media búsqueda, NO queda job fantasma; se puede lanzar una búsqueda nueva de inmediato. Un job sin avance por timeout se libera solo.
- **Panel — ver:** el panel muestra si hay un trabajo del Explorador corriendo (con progreso) o si está libre.
- **Panel — limpiar:** el botón cancela/libera el trabajo; tras ello, la web puede lanzar una búsqueda nueva.
- Reproducir el caso del usuario: dejar un job a medias, caer el bridge, y confirmar que ya NO bloquea (ni por sí solo ni tras usar el botón del panel).
- `tsc` 0 (si toca algo web) · build OK · bridge tests pasan · panel arranca y funciona · verificar EN PANTALLA/panel.

---

## Nota sobre la arquitectura (contexto)
El Explorador corre en el bridge (Python) en la tower; el cliente web solo lanza y consulta. Por eso tiene sentido gestionar los trabajos desde el panel de escritorio (que vive junto al bridge) además de poder cancelarlos desde la web. El estado de "ocupado/libre" del Explorador es global del bridge: si está ocupado, ningún cliente puede lanzar otra búsqueda hasta que se libere.

---

*Control de trabajos del Explorador en el panel + auto-liberación de jobs huérfanos · destrabar el sistema tras caídas*
