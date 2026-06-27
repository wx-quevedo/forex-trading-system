# ForexBot — Refinamiento del Laboratorio (disposición Sidebar)

> El usuario eligió la disposición SIDEBAR como ganadora. Estos son refinamientos para hacerla pulida y usable.
> (La disposición "Barra arriba" puede mantenerse por ahora vía el toggle, o descartarse cuando el usuario confirme; foco aquí en pulir el Sidebar.)

---

## 1. Tooltips "i" en cada métrica de la barra de resultados

En la barra de métricas del Resumen (PNL Neto, PNL Bruto, Costos Broker, Retorno Neto, Trades, Win Rate, Profit Factor, Max DD), añadir el icono "i" (el mismo `InfoTooltip` ya creado) a CADA métrica, explicando qué es y cómo leerla. Ejemplos:

- **PNL Neto (con costos):** "Ganancia/pérdida real tras descontar spread, comisión y swap del broker. Es lo que de verdad obtendrías."
- **PNL Bruto (sin costos):** "Ganancia/pérdida ignorando los costos del broker. Útil solo para comparar; NO es el resultado real."
- **Costos Broker:** "Total de spread + comisión + swap pagados. La diferencia entre bruto y neto. Cuanto más operas, más pagas."
- **Retorno Neto:** "Rendimiento porcentual sobre el capital, ya con costos descontados."
- **Trades:** "Número de operaciones cerradas en el backtest. Menos de ~30 hace los resultados poco fiables estadísticamente."
- **Win Rate:** "Porcentaje de operaciones ganadoras. Ojo: un win rate alto no garantiza rentabilidad si las pérdidas son grandes."
- **Profit Factor:** "Ganancia bruta dividida entre pérdida bruta. >1 es rentable; >1.5 es bueno; <1 pierde dinero."
- **Max DD (drawdown):** "Máxima caída desde un pico de capital. Mide el peor momento; cuanto menor, más llevadero el riesgo."

> Redactar textos claros y correctos para cada métrica mostrada.

---

## 2. Barra de métricas SIEMPRE fija encima del chart

Mover la barra de métricas (neto/bruto/costos/retorno + las secundarias) a una **franja fija justo ENCIMA de la gráfica**, siempre visible — no dentro de la tab "Resumen" abajo.

- La barra de métricas vive sobre el chart de forma permanente (tras ejecutar un backtest se llena; antes puede mostrar placeholders o estado vacío discreto).
- Las tabs de abajo (Trades, Optimización, Equity) se mantienen; la tab "Resumen" puede quedar redundante si las métricas ya están arriba — evaluar: o se elimina la tab Resumen, o queda con detalle ampliado. Lo esencial (neto/bruto/costos/retorno/trades/winrate/PF/DD) va arriba fijo.
- Diseño compacto en una o dos filas de "tarjetas" pequeñas, sin ocupar demasalto alto vertical (el chart sigue siendo protagonista).

---

## 3. Sidebar con scroll independiente (sticky)

El sidebar de configuración debe tener su **propio scroll independiente** del resto de la página:

- Al desplazar la zona de la derecha (chart + tabs + trades), el sidebar **permanece fijo** (sticky) y no se mueve.
- Si el contenido del sidebar es más alto que la ventana, el sidebar tiene su propio scroll interno.
- Resultado: el usuario siempre tiene los controles de configuración a la vista, sin importar cuánto baje en los resultados.

Implementación: el sidebar como columna con `position: sticky` / `height` acotado al viewport y `overflow-y: auto` propio; la columna derecha scrollea independiente.

---

## 4. Ocupar todo el ancho de la página

El laboratorio debe **aprovechar el ancho completo** de la página (ahora parece dejar espacio sin usar). Que el layout (sidebar + zona derecha) ocupe el ancho disponible, dando más espacio al chart y las tablas.

---

## 5. Reorganizar el sidebar para que sea compacto y usable

Problema: campos pequeños desperdician una fila entera (ej: Timeframe "H1" ocupa toda una fila). Hay que reorganizar para densidad y claridad.

### Propuesta de organización (agrupar en filas compartidas + secciones)

Organizar el sidebar en **secciones con encabezado**, y poner los campos pequeños/relacionados en **la misma fila (2 columnas)**:

```
INSTRUMENTO
  [Tipo de estrategia ▾]            (fila completa, es un select largo)
  [Par ▾]            [Timeframe ▾]  (2 columnas — Timeframe NO ocupa fila sola)
  Estado de mercado: Abierto/Cerrado (línea compacta)

PARÁMETROS  (solo los del tipo elegido)
  [MA Type ▾]        [Fast Period]  (2 columnas)
  [Slow Period]                     (o emparejar con el siguiente si lo hay)
  ...cada uno con su icono "i"...

RIESGO
  [SL pips]          [TP pips]      (2 columnas)
  [Riesgo %]                        (puede ir solo o emparejado)

PERIODO
  [Desde]            [Hasta]        (2 columnas — las dos fechas juntas)

[ Ejecutar backtest ]  (botón ancho, destacado)
[ Optimizar ]  [ Guardar como estrategia ]
```

### Reglas
- Campos pequeños y relacionados van en **2 columnas** en la misma fila (Par+Timeframe, SL+TP, Desde+Hasta, MA Type+Fast Period).
- Selects largos (Tipo de estrategia) pueden ocupar fila completa.
- Agrupar bajo **encabezados de sección** (Instrumento, Parámetros, Riesgo, Periodo) para escaneo visual rápido.
- Mantener el icono "i" en cada parámetro.
- Mantener solo los parámetros del tipo de estrategia elegido (ocultar los que no aplican).
- Botones de acción claros al final (Ejecutar destacado; Optimizar y Guardar secundarios).
- Densidad cómoda: compacto pero no apretado; labels legibles.
- Sin emojis.

---

## 6. Verificación

- Cada métrica de la barra tiene su icono "i" con explicación.
- La barra de métricas está fija encima del chart, siempre visible.
- El sidebar no se mueve al scrollear la derecha; tiene scroll propio si hace falta.
- El laboratorio ocupa todo el ancho de la página.
- El sidebar está reorganizado: campos pequeños en 2 columnas, secciones con encabezado, Timeframe ya NO ocupa una fila entera solo.
- Solo se ven los parámetros del tipo elegido; cada uno con icono "i".
- `tsc` 0 · build OK · verificar EN PANTALLA.

---

*Refinamiento del Laboratorio (Sidebar) · métricas con tooltip fijas sobre el chart + sidebar sticky, compacto y a ancho completo*
