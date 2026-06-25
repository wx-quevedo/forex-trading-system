# ForexBot — Corrección Crítica: Sufijo de Símbolos del Broker

> Bug que impide al bot ejecutar órdenes reales · PRIORIDAD ALTA
> Descubierto durante la validación de la Fase 7

---

## 1. El Problema (diagnóstico CONFIRMADO con datos del bridge)

El bot falla al ejecutar órdenes con `retcode 10017: Trade disabled`, a pesar de que:
- `trade_allowed: true` (Algo Trading activo)
- MT5 conectado
- El bot lee datos (precios, velas) de `EURUSD` sin problema

**Causa raíz CONFIRMADA:** en la cuenta XM Ultra Low del usuario existen DOS variantes de cada par, y el bot está usando la incorrecta. Datos reales del endpoint `/symbols` del bridge:

```json
// La que el bot usa (INCORRECTA):
{ "name": "EURUSD",  "path": "Forex\\Standard\\Majors\\EURUSD",
  "trade_mode": 0,   "visible": true }    // trade_mode 0 = DESHABILITADO

// La operable (CORRECTA):
{ "name": "EURUSD#", "path": "Forex\\Standard Ultra Low\\Majors\\EURUSD#",
  "trade_mode": 4,   "visible": false }   // trade_mode 4 = OPERABLE (full)
```

**Dos hechos clave:**
1. **`trade_mode`:** los símbolos sin `#` tienen `trade_mode: 0` (SYMBOL_TRADE_MODE_DISABLED) — solo datos, NO operables. Los símbolos con `#` tienen `trade_mode: 4` (SYMBOL_TRADE_MODE_FULL) — operables. Operar uno con `trade_mode: 0` → `10017`.
2. **`visible: false`:** los símbolos `#` están OCULTOS en el Market Watch de MT5 (por eso el usuario no los encuentra al buscar "EUR" en la interfaz, aunque la API sí los lista). Requieren `symbol_select(name, True)` para activarse antes de operar.

**Evidencia:**
- El `/symbols` del bridge muestra `EURUSD` con `trade_mode: 0` y `EURUSD#` con `trade_mode: 4`
- El usuario no ve `EURUSD#` en MT5 porque tiene `visible: false`
- Orden manual en `USDCNH#` (visible + trade_mode 4) ejecutada correctamente; órdenes del bot en `EURUSD` (trade_mode 0) rechazadas con 10017
- Todos los pares operables del broker están bajo `...\Standard Ultra Low\...` con sufijo `#` y `trade_mode: 4`

---

## 2. La Solución

El bot debe **operar usando el símbolo operable correcto del broker** (con sufijo cuando aplique), mientras puede seguir leyendo datos del símbolo que corresponda.

### Enfoque recomendado: resolución automática de símbolo en el bridge

En el bridge, antes de cualquier operación (`order_send`) y idealmente también para datos, **resolver el símbolo operable real**:

1. Dado un símbolo base (ej: `EURUSD`), verificar si es operable (`symbol_info(symbol).trade_mode != SYMBOL_TRADE_MODE_DISABLED`).
2. Si NO es operable, buscar variantes con sufijo común del broker: probar `EURUSD#`, y si el broker usa otros sufijos (`.`, `.m`, `_`, etc.), detectarlos.
3. Estrategia robusta: listar todos los símbolos del broker (`symbols_get()`) y encontrar el que, normalizado (quitando sufijos no alfabéticos), coincide con el base Y es operable (`trade_mode == FULL`).
4. Usar ese símbolo resuelto para `order_send`, `symbol_info_tick`, posiciones, etc.
5. Cachear el mapeo base→operable para no resolver en cada llamada.

> Detalle MT5: antes de operar un símbolo puede requerirse `symbol_select(symbol, True)` para activarlo en Market Watch. Incluir esto en la resolución.

### Alternativa simple (si la automática se complica)
- Hacer que el usuario seleccione directamente los símbolos operables (con `#`) al crear estrategias. Con el selector dinámico de 205 símbolos (Lote 1), `EURUSD#` ya debería estar disponible.
- Pero esto es frágil: depende de que el usuario recuerde el `#`. La resolución automática es preferible.

### Enfoque combinado (ideal)
- El selector de símbolos muestra y guarda los símbolos **operables** del broker (los que tienen `trade_mode` operable), de modo que el usuario solo pueda elegir símbolos con los que el bot realmente puede operar.
- Internamente, marcar cuáles son operables vs solo-datos.
- Para datos de velas/precios, usar el símbolo operable también (en XM, `EURUSD#` también tiene datos), unificando todo en un solo símbolo correcto.

---

## 3. Consideraciones

- **Backtesting:** verificar de qué símbolo se obtienen las velas históricas. Si `EURUSD` (sin #) tiene historial y `EURUSD#` también, usar el operable para consistencia entre backtest y vivo.
- **Estrategias existentes:** las que el usuario ya creó con `EURUSD` deben migrarse o resolverse automáticamente al operable. Considerar un mapeo retroactivo.
- **Spread/condiciones:** los símbolos `#` pueden tener spreads ligeramente distintos a los de visualización; usar siempre el operable para que backtest y vivo coincidan.
- **Otros brokers:** la solución de resolución automática debe ser genérica (no hardcodear `#`), porque distintos brokers usan distintos sufijos (`.m`, `.raw`, `_`, etc.). Esto hace el sistema portable.

---

## 4. Resumen de Tareas para el Agente

1. En el bridge, implementar resolución de símbolo operable: dado un base, encontrar el símbolo del broker que es operable (`trade_mode` full) y coincide normalizado.
2. Aplicar `symbol_select(symbol, True)` antes de operar si hace falta.
3. Usar el símbolo resuelto en `order_send`, ticks, posiciones (y datos si corresponde).
4. Cachear el mapeo base→operable.
5. Que el selector de símbolos de la web muestre/guarde preferentemente los operables (marcar operable vs solo-datos).
6. Manejar estrategias existentes (resolver `EURUSD` → `EURUSD#` automáticamente).
7. Solución genérica de sufijos (no hardcodear `#`) para portabilidad entre brokers.
8. Verificación e2e: el bot ejecuta una orden REAL en demo sobre el símbolo resuelto, sin 10017.

---

## 5. Criterio de Aceptación

- Con el bot corriendo una estrategia sobre "EURUSD", al darse una señal, el bot ejecuta la orden sobre `EURUSD#` (resuelto automáticamente) SIN error 10017.
- La posición aparece abierta en MT5, en la web y en el historial.
- El panic button cierra esa posición correctamente.
- Funciona igual para otros símbolos (probar con uno de los Exotics que ya se sabe operable).

---

*Corrección crítica · Desbloquea la ejecución real del bot · Ejecutar antes de cerrar la Fase 7*
