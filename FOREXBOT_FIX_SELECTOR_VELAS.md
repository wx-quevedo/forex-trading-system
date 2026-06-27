# ForexBot — FIX: Selector de Pares (grupos + solo disponibles) y Error de Velas

> Mejora del selector de símbolos (dos grupos) + corregir el error "símbolo desconocido / no se pueden descargar velas" al elegir símbolos como BTCUSD#

---

## 1. BUG — Error al descargar velas de símbolos ocultos (ej: BTCUSD#)

### Síntoma
Al elegir `BTCUSD#` (con #, el símbolo operable correcto) en el laboratorio/estrategia, da **"símbolo desconocido"** y un error de que **no se pudieron descargar las velas** solicitadas. Con EURUSD funciona; con BTCUSD# falla.

### Causa probable
- Símbolos como `BTCUSD#` tienen `visible: false` en MT5 (ocultos en Market Watch). Para **descargar velas históricas** de un símbolo en MT5, normalmente hay que **activarlo primero con `symbol_select(symbol, True)`** — igual que se hace para operarlo.
- El fix de símbolo operable (Fase 7) activaba el símbolo para *operar* (`send_order`/runner), pero la **descarga de velas** (para el chart del laboratorio y el backtest) puede NO estar haciendo `symbol_select` antes de pedir `copy_rates_*`. Por eso EURUSD (visible) funciona y BTCUSD# (oculto) falla.
- Causa secundaria posible: MT5 no tiene histórico precargado de ese instrumento (cripto/símbolos poco usados); hay que solicitar/esperar la descarga del histórico desde el servidor del broker.

### Solución
1. **Antes de pedir velas de CUALQUIER símbolo**, el bridge debe:
   - Resolver el símbolo operable (reusar `resolve_tradable_symbol`).
   - Hacer `symbol_select(symbol, True)` para activarlo (aunque esté oculto).
   - Luego pedir las velas (`copy_rates_from`/`copy_rates_range`).
2. **Si tras activar no hay histórico disponible**, manejar el caso:
   - Reintentar / esperar brevemente a que MT5 descargue el histórico del servidor.
   - Si sigue sin haber datos, devolver un error CLARO ("MT5 no tiene histórico disponible para BTCUSD#") en vez de un genérico "símbolo desconocido".
3. Aplicar esto en TODOS los puntos que piden velas: chart del laboratorio, chart del bot, backtest, optimización. Unificar para que todos usen la misma ruta de "resolver + select + pedir velas".

---

## 2. Selector de pares: SOLO símbolos disponibles (que funcionan)

### Decisión del usuario
El selector debe mostrar **solo los símbolos que de verdad funcionan** — operables Y con datos descargables. No tiene sentido ofrecer 186 símbolos si muchos dan error al pedir velas.

### Solución
- El endpoint que alimenta el selector debe devolver solo símbolos:
  - Operables (`trade_mode != 0`), Y
  - De los que MT5 puede entregar velas (tienen histórico disponible).
- Forma práctica de determinarlo: marcar como "disponibles" los símbolos que están en el Market Watch / tienen histórico, o validar disponibilidad de datos. Si validar todos es costoso, al menos filtrar por los grupos que se sabe que funcionan (Forex majors/minors, los Cash de índices, metales, las cripto principales con histórico) y excluir los que notoriamente no traen datos.
- Si un símbolo se ofrece pero al pedir velas falla, NO romper la UI: mostrar el error claro y permitir elegir otro.
- Objetivo: que cualquier símbolo que el usuario pueda elegir en el selector, funcione al pedir sus velas.

---

## 3. Selector de pares: DOS GRUPOS (comunes + alfabético)

### Qué se quiere
Organizar el selector en dos grupos para mejor UX:

**Grupo 1 — Más comunes / conocidos** (arriba, acceso rápido):
- Los pares más usados: EURUSD#, GBPUSD#, USDJPY#, USDCHF#, USDCAD#, AUDUSD#, NZDUSD#
- Cripto principales: BTCUSD#, ETHUSD#
- Oro: XAUUSD# / GAUUSD# (el que aplique en el broker)
- Índices principales si se quiere: US500Cash#, US100Cash#, US30Cash#
- (Ajustar la lista a los que estén disponibles y sean realmente conocidos.)

**Grupo 2 — Todos los demás** (abajo, en orden alfabético):
- El resto de símbolos disponibles, ordenados alfabéticamente.

### Implementación
- En el combobox de símbolos (`SymbolCombobox`), renderizar dos secciones con encabezado: "Más usados" y "Todos (A-Z)".
- El grupo de comunes es una lista curada (definida en el front o config); el resto se ordena alfabéticamente.
- La búsqueda al teclear filtra ambos grupos.
- Solo incluir símbolos disponibles (punto 2).
- Aplica en el laboratorio, formulario de estrategia y donde se elija par.

---

## 4. Verificación

1. Elegir BTCUSD# en el laboratorio → descarga velas y muestra el chart SIN error (el bridge hace `symbol_select` antes de pedir velas).
2. Si algún símbolo no tiene histórico, muestra un error claro (no "símbolo desconocido" genérico) y no rompe la UI.
3. El selector muestra solo símbolos que funcionan (al elegir cualquiera, las velas cargan).
4. El selector tiene dos grupos: "Más usados" arriba (EURUSD#, BTCUSD#, etc.) y "Todos (A-Z)" abajo; la búsqueda filtra ambos.
5. Probar varios símbolos de distintos grupos (forex, cripto, oro, índice) y confirmar que cargan velas.
6. `tsc` 0 · build OK · verificar EN PANTALLA.

---

*Fix de selector y descarga de velas · Que todo símbolo elegible funcione · Dos grupos para mejor UX*
