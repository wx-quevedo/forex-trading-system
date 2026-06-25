# ForexBot — Documento de Cambios y Correcciones (Lote 1)
> Ajustes de UX, terminología y bugs detectados durante el uso · Ejecutar en una pasada
> No son fases nuevas; son refinamientos sobre lo ya construido.

---

## 1. Terminología de Trading en Inglés (i18n parcial)

**Alcance preciso (confirmado con el usuario):**
- La **interfaz general permanece en español** (navegación, botones, mensajes del sistema, gestión de riesgo, etc.).
- Solo la **terminología técnica de trading va en inglés**: nombres de tipos de estrategia, nombres de indicadores y nombres de parámetros.
- Las **descripciones de las estrategias permanecen en español** (ej: "Compra cuando la media rápida cruza por encima de la lenta").

### Cambios concretos

**Nombres de tipos de estrategia → inglés:**
| Actual (español) | Nuevo (inglés) |
|---|---|
| Cruce de Medias Móviles | Moving Average Cross |
| RSI | RSI (ya en inglés) |
| MACD | MACD (ya en inglés) |
| Bandas de Bollinger | Bollinger Bands |
| Combinada | Combined |

**Nombres de parámetros → inglés:**
| Actual (español) | Nuevo (inglés) |
|---|---|
| Periodo rápido | Fast Period |
| Periodo lento | Slow Period |
| Tipo de media | MA Type |
| Periodo RSI | RSI Period |
| Nivel sobreventa | Oversold Level |
| Nivel sobrecompra | Overbought Level |
| (MACD) rápido/lento/señal | Fast / Slow / Signal |
| (Bollinger) periodo, desviación | Period, Deviation |

> Implementación: los labels de los parámetros viven en `STRATEGY_SCHEMAS` (bridge) y/o en el frontend. Actualizar las etiquetas mostradas a inglés, manteniendo las descripciones en español. La gestión de riesgo (SL/TP/Riesgo) y el resto de la UI siguen en español.

**Consistencia en el análisis IA:** cuando se generen prompts o se muestren sugerencias, referirse a los parámetros en inglés también (ej: "usar RSI con Fast Period 5"), para que coincida con lo que el usuario ve en pantalla.

---

## 2. BUG — Selector de Pares Limitado a EURUSD

**Problema:** al crear/editar una estrategia, el campo "Par" solo permite EURUSD; no deja elegir otras divisas.

**Causa probable:** el campo está hardcodeado a EURUSD (texto fijo o input no poblado) en vez de ser un selector dinámico.

**Solución:** poblar el selector de pares dinámicamente desde el endpoint `/symbols` del bridge (ya existe desde la Fase 1, usa `mt5.symbols_get()`). El broker XM ofrece ~40 símbolos.
- El selector debe cargar la lista real de símbolos disponibles del broker
- Usable tanto en el formulario de estrategia como en el workbench y en la config del bot
- Considerar agrupar o permitir búsqueda si son muchos símbolos
- Default sigue siendo EURUSD, pero seleccionable

---

## 3. BUG — Indicador de Estado del Bot Desincronizado

**Problema:** la web muestra "Bot pausado" cuando el bot en realidad está `running` (evaluando el mercado activamente). Confirmado vía `botStatus()` del bridge: estado real `running`, pero el `BotStatusIndicator` muestra pausado.

**Causa probable:** el frontend no está reflejando el estado real devuelto por `/bot/status`, o hay un desfase en cómo se mapea/actualiza el estado (polling/Reverb no actualiza el indicador, o mapeo incorrecto de los valores de estado).

**Solución:**
- Asegurar que `BotStatusIndicator` lea el campo `status` real de `/bot/status` (`running` / `paused` / `stopped` / `error`)
- Verificar el mapeo de estados a colores: running=verde, paused=gris, stopped=neutro, error=rojo
- Confirmar que el polling (3s) y/o Reverb actualizan el indicador en vivo
- Probar el ciclo completo start→running (verde) → pause (gris) → resume (verde) → stop, confirmando que el indicador sigue el estado real en cada transición

---

## 4. Verificación

- Estrategias muestran nombres/parámetros en inglés; descripciones en español; resto de UI en español
- Selector de pares carga símbolos reales de XM y permite elegir distintos de EURUSD
- Indicador de estado del bot refleja el estado real en todas las transiciones
- `tsc` 0 · build OK · tests pasan

---

## Notas
- La mejora de **compatibilidad/responsive móvil** del workbench va en un documento separado (no en este lote).
- Estos cambios no afectan la lógica de trading ni la seguridad del bot; son UX/correcciones.

---

*Documento de correcciones · Complementario a las fases · Ejecutar cuando se indique*
