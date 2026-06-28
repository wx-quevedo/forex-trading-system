# ForexBot — Contexto Global de Análisis (fechas + capital fijos)

> Una "marca" global de contexto (Desde, Hasta, Capital) que el usuario fija UNA vez en un ajuste aparte, y que el Explorador y el Mapa de cobertura toman por defecto, sin poder cambiarse accidentalmente en cada búsqueda. Garantiza consistencia entre análisis y que el caché siempre acierte.

---

## Motivación

- El caché y el mapa de cobertura dependen del contexto exacto (periodo + capital). Si el usuario usa fechas/capital distintos entre búsquedas (aunque sea sin querer), el caché no acierta y el mapa se fragmenta.
- El usuario quiere fijar su contexto de trabajo UNA vez (ej: Desde 01/01/2025, Hasta 27/06/2026, Capital $10.000) y que TODOS los análisis (Explorador, Mapa) usen esa marca por defecto, sin reescribirla ni cambiarla por accidente.

---

## Comportamiento

### La marca global
- Un **contexto global** con tres valores: **Desde**, **Hasta**, **Capital inicial**.
- Se configura en un **ajuste aparte** (no en cada búsqueda): una pequeña sección/página de "Ajustes" o un panel de "Contexto de análisis" accesible (ej: desde el nav, o un engranaje en el Explorador/Mapa).
- Persistente (se guarda y prevalece entre sesiones y reinicios). Guardarlo donde sea estable (BD del bridge o config de Laravel; debe sobrevivir reinicios, como el caché).

### Uso por defecto (fijo, no editable en la búsqueda)
- En el **Explorador** y en el **Mapa de cobertura**, los campos Desde/Hasta/Capital toman su valor de la marca global y se muestran **fijos / de solo lectura** (no editables ahí). Así el usuario no los cambia sin querer y el caché siempre coincide.
- Mostrar de forma visible cuál es el contexto activo (ej: "Contexto: 01/01/2025 → 27/06/2026 · $10.000") con un enlace/botón "Editar contexto" que lleva al ajuste aparte.

### Cambiar la marca (solo a propósito)
- Solo se cambia desde el **ajuste aparte** dedicado, no desde la pantalla de búsqueda.
- Al cambiarla, advertir que cambiar el contexto hará que el caché/mapa reflejen el nuevo contexto (lo ya calculado con el contexto anterior sigue en caché, pero el mapa ahora cuenta sobre el nuevo periodo+capital).
- Tras guardarla, el Explorador y el Mapa pasan a usar el nuevo contexto.

---

## Detalle

- **Valores por defecto iniciales** (si nunca se configuró): algo razonable (ej: Desde hace ~18 meses con fecha fija, Hasta una fecha fija reciente, Capital $10.000). NO usar "hoy" dinámico como Hasta por defecto (rompería el caché entre días); usar una fecha fija.
- La marca aplica a Explorador y Mapa. El **Laboratorio** puede seguir permitiendo fechas/capital libres (es para experimentación puntual), o también ofrecer "usar el contexto global" como atajo — a criterio; lo importante es que Explorador y Mapa respeten la marca fija.
- Si en el futuro hay más lugares que usan periodo+capital, que lean de la misma marca global (única fuente de verdad).

---

## Verificación
- Existe un ajuste aparte donde se fija Desde/Hasta/Capital; persiste entre reinicios.
- El Explorador y el Mapa muestran ese contexto fijo (solo lectura) y lo usan por defecto; no se puede cambiar desde la pantalla de búsqueda.
- Hay un acceso claro para editar el contexto (que lleva al ajuste).
- Cambiar la marca en el ajuste actualiza lo que usan Explorador y Mapa.
- Con la marca fija, repetir búsquedas/abrir el mapa usa siempre el mismo contexto → el caché acierta (no recalcula).
- `tsc` 0 · build OK · verificar EN PANTALLA.

---

*Contexto global de análisis · marca fija de fechas + capital · consistencia y caché estable entre análisis*
