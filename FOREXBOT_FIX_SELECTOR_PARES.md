# ForexBot — FIX: Selector de Pares Sigue Hardcodeado en EURUSD

> Bug reportado como resuelto en el Lote 1 pero NO funciona en la práctica.
> Al crear una nueva estrategia, el campo de Par sigue fijo en EURUSD; no permite elegir otros.

---

## 1. El Problema (confirmado por el usuario)

En la pantalla de **crear una nueva estrategia**, el campo "Par" sigue **hardcodeado solo con EURUSD**. El usuario no puede elegir ningún otro símbolo. Debe poder elegir entre todos los pares operables del broker (los ~186 con `trade_mode != 0`).

> El Lote 1 reportó este fix como hecho (input + datalist poblado desde `tradableSymbolNames()`), pero en la UI real de creación de estrategia NO está funcionando: sigue mostrando EURUSD fijo.

Esto NO es problema de caché — el usuario ya hizo recarga forzada (Ctrl+Shift+R) y persiste.

---

## 2. Qué Investigar (la causa puede ser una de estas)

El agente debe revisar la **pantalla real de creación/edición de estrategia** (no solo asumir que el cambio anterior aplicó) y verificar:

1. **¿El componente del formulario de estrategia realmente usa el selector dinámico?** Puede que el fix del Lote 1 se aplicara en un sitio (ej: un componente o página) pero la pantalla de "crear estrategia" use OTRO campo/componente que quedó con EURUSD hardcodeado.
2. **¿El campo está hardcodeado en el valor por defecto?** Buscar en el formulario de creación de estrategia dónde se setea `pair`/`symbol` y si está fijo a `"EURUSD"` como valor no editable o como `<input disabled>` / texto fijo.
3. **¿El endpoint de símbolos operables responde y llega al frontend?** Confirmar que `tradableSymbolNames()` (o el endpoint equivalente) devuelve la lista y que el componente de creación la consume realmente.
4. **¿El `<datalist>` o selector está presente pero no se ve / no funciona?** A veces el datalist existe pero el input no está enlazado a él, o la lista llega vacía por un error silencioso.

---

## 3. La Solución

- En la pantalla de **crear nueva estrategia** (y también editar), el campo "Par" debe ser un **selector/combobox poblado dinámicamente** con los símbolos operables del broker (`trade_mode != 0`, ~186 símbolos).
- Debe permitir **buscar y elegir cualquiera** de ellos (no solo EURUSD).
- Default puede ser EURUSD (o EURUSD#), pero **seleccionable y cambiable**.
- Usar la misma fuente de datos del selector que ya existe (el de 186 símbolos operables); si la pantalla de creación usa un componente distinto, unificarlos o aplicar el mismo selector ahí.
- Mostrar preferentemente los símbolos operables (con `#` cuando aplique), ya que son los que el bot puede operar.

---

## 4. Verificación (OBLIGATORIA en la UI real, no solo tests)

> El bug se reportó como resuelto antes sin que funcionara. Esta vez, verificar EN PANTALLA.

1. Abrir la pantalla de **crear nueva estrategia** en el navegador.
2. Hacer clic en el campo "Par".
3. Confirmar que aparece la lista de símbolos operables y que se puede **buscar y seleccionar uno distinto de EURUSD** (ej: GBPUSD#, USDJPY#, BTCUSD#).
4. Crear una estrategia con un par distinto de EURUSD y confirmar que se guarda con ese par.
5. Confirmar lo mismo en **editar estrategia**.
6. `tsc` 0 · build OK.

> Adjuntar/confirmar explícitamente que se probó en la pantalla de creación de estrategia, no solo que el código compila.

---

*Fix de corrección · El selector debe funcionar en la pantalla real de crear estrategia*
