# ForexBot — Fase 6B: Modo de Afinamiento Manual (Copy-Paste)
> Documento adicional · Funcionalidad complementaria a la Fase 6 (Análisis IA por API)
> Prerequisito: Fase 6 (modo API) completada

---

## 1. Contexto y Objetivo

La Fase 6 integra el análisis de estrategias vía Anthropic API (automático, con costo por uso). Esta Fase 6B agrega un **segundo modo de afinamiento** que NO consume API: la plataforma empaqueta los resultados del backtest en un bloque de texto que el usuario copia y pega en Claude.ai (cubierto por su suscripción), Claude responde un JSON con parámetros ajustados, y el usuario lo pega de vuelta para crear una nueva versión de la estrategia.

**Objetivo:** ofrecer dos caminos intercambiables para el mismo resultado (ajustar una estrategia a partir de un backtest), permitiendo al usuario:
- Evitar el costo de API cuando lo prefiera
- Usar el modelo completo de su suscripción Claude.ai (razonamiento más profundo)
- Comparar el costo y la calidad de ambos modos

**Principio clave:** el usuario actúa como "pasarela" entre la plataforma y Claude.ai. El modo se elige con un **selector visible** en la UI de análisis.

---

## 2. Selector de Modo (UI)

En la vista de análisis de un backtest (la que construye la Fase 6), agregar un **toggle / selector** con dos opciones claramente etiquetadas:

```
┌─────────────────────────────────────────────┐
│  Modo de análisis:                          │
│  ( ) API automática  — usa Anthropic API    │
│      · costo por uso · respuesta inmediata  │
│  (•) Manual (copy-paste) — sin costo de API │
│      · usas tu Claude.ai · 2 pasos          │
└─────────────────────────────────────────────┘
```

- Persistir la preferencia del usuario (en `localStorage` del frontend o en settings de usuario)
- Por defecto: **Manual** (para no gastar API sin querer)
- El selector cambia qué UI se muestra debajo (el chat de API vs el flujo de 2 pasos)

---

## 3. Flujo del Modo Manual

### Paso 1 — La plataforma genera el "paquete de salida"
Cuando el usuario está viendo un backtest y elige modo Manual, aparece un botón **"Generar prompt para Claude"**. Al pulsarlo, la plataforma construye un bloque de texto estructurado y lo muestra en un `<textarea>` de solo lectura con un botón **"Copiar"**.

El bloque debe contener:

```
Eres un experto en trading algorítmico. Analiza el resultado de este backtest
y sugiere ajustes a los parámetros de la estrategia para mejorar su rendimiento.

ESTRATEGIA ACTUAL
- Nombre: {nombre}
- Tipo: {tipo}  (ej: ma_cross)
- Par: {par}  ·  Timeframe: {timeframe}
- Parámetros actuales:
{json de parámetros actuales}
- Esquema de parámetros válidos (rangos y tipos permitidos):
{STRATEGY_SCHEMAS del tipo correspondiente}

RESULTADO DEL BACKTEST
- Periodo: {date_from} a {date_to}
- Total trades: {n}
- Win rate: {x}%
- Profit factor: {x}
- Net PnL: {x}
- Return: {x}%
- Max drawdown: {x}% ({x} abs)
- Sharpe: {x}  ·  Sortino: {x}
- Racha ganadora máx: {n}  ·  Racha perdedora máx: {n}
- Avg win: {x}  ·  Avg loss: {x}
- PnL por mes: {breakdown}

INSTRUCCIONES DE RESPUESTA
Responde ÚNICAMENTE con un bloque JSON válido (sin texto adicional antes ni después)
con esta estructura exacta:

{
  "diagnostico": "explicación breve de qué está fallando en la estrategia",
  "parametros_sugeridos": {
    // solo los parámetros del mismo tipo de estrategia, con sus nuevos valores
    // deben respetar el esquema de parámetros válidos de arriba
  },
  "riesgo_sugerido": {
    "sl_pips": {n},
    "tp_pips": {n},
    "risk_percent": {x}
  },
  "justificacion": "por qué estos cambios deberían mejorar el rendimiento",
  "confianza": "alta | media | baja"
}
```

> El esquema de parámetros (`STRATEGY_SCHEMAS`) ya existe en el bridge (Fase 4). Reutilizarlo aquí es lo que permite que Claude conozca los rangos válidos y no invente parámetros.

### Paso 2 — El usuario pega la respuesta de Claude
Debajo del paquete de salida, un segundo `<textarea>` editable con label **"Pega aquí la respuesta JSON de Claude"** y un botón **"Aplicar sugerencia"**.

Al pulsar **Aplicar**:
1. El frontend envía el JSON pegado al backend
2. El backend **valida** (ver sección 4)
3. Si es válido, muestra un **diff visual** (antes vs después de cada parámetro)
4. El usuario confirma con **"Crear nueva versión"**
5. Se crea una nueva versión de la estrategia (mismo mecanismo de versionado de la Fase 4: hijo con `parent_id`, `version` incremental)
6. Se guarda también el registro en `ai_analyses` (con un campo que marque `mode: manual`)

---

## 4. Validación del JSON Pegado (Crítico)

Como el JSON viene pegado manualmente (no de una API confiable), el backend DEBE validarlo robustamente antes de aplicar nada:

- **Parseo seguro:** intentar `json_decode`; si falla, mostrar error claro ("El texto pegado no es un JSON válido. Asegúrate de copiar solo el bloque JSON.")
- **Estructura:** verificar que existan las claves esperadas (`parametros_sugeridos`, `riesgo_sugerido`, etc.)
- **Tipo de estrategia:** los parámetros sugeridos deben pertenecer al MISMO tipo de la estrategia original (no aceptar parámetros de otro tipo)
- **Esquema:** cada parámetro debe existir en `STRATEGY_SCHEMAS` de ese tipo, y su valor debe estar dentro del rango/tipo permitido. Rechazar valores fuera de rango con mensaje específico.
- **Riesgo:** `sl_pips`, `tp_pips`, `risk_percent` dentro de límites sanos (ej: risk_percent ≤ 5, sl/tp > 0)
- **Tolerancia a ruido:** si el usuario pega texto extra alrededor del JSON (a veces Claude añade explicación), intentar extraer el primer bloque `{...}` balanceado antes de fallar.

La validación reutiliza las reglas de [StrategyRequest](app/app/Http/Requests/StrategyRequest.php) en la medida de lo posible para no duplicar lógica.

---

## 5. Comparación de Costos (Bonus solicitado)

El usuario quiere medir cuánto cuesta el modo API. Agregar:

- En el modo **API**, después de cada análisis, registrar en `ai_analyses` los tokens usados (input/output) que devuelve la respuesta de la API de Anthropic, y estimar el costo en USD según el pricing del modelo configurado.
- Una pequeña vista o badge **"Costo acumulado de API este mes"** en la sección de análisis o settings, sumando los costos registrados.
- En el modo **Manual**, el costo registrado es `0` (marcar `mode: manual`).

Esto permite comparar directamente: "llevo X análisis por API = $Y" vs "Z análisis manuales = $0".

---

## 6. Cambios en el Modelo de Datos

Extender la tabla `ai_analyses` (de la Fase 6) con:

```
ai_analyses
  ... (campos existentes)
  mode               enum('api','manual')  default 'manual'
  input_tokens       integer  nullable   // solo modo api
  output_tokens      integer  nullable   // solo modo api
  estimated_cost_usd decimal(10,6) nullable  // solo modo api
  applied            boolean  default false  // si se creó una versión a partir de este análisis
  resulting_strategy_id  FK nullable → strategies.id  // la versión creada
```

Migración nueva (no modificar la de Fase 6 si ya corrió; añadir columnas con una migración incremental).

---

## 7. Resumen de Tareas para el Agente

1. **Migración incremental** de `ai_analyses` con los campos de la sección 6.
2. **Backend — generación del paquete:** método en el `AiAnalysisController` (o servicio dedicado) que arma el bloque de texto de la sección 3 a partir de un backtest. Endpoint `GET /backtests/{id}/manual-prompt`.
3. **Backend — aplicación de la sugerencia:** endpoint `POST /backtests/{id}/apply-manual` que recibe el JSON pegado, valida (sección 4), devuelve el diff, y al confirmar crea la nueva versión + registra el `ai_analysis` con `mode: manual`.
4. **Backend — tracking de costo API:** en el flujo de la Fase 6, capturar tokens de la respuesta de Anthropic y calcular costo estimado. Badge de costo acumulado.
5. **Frontend — selector de modo:** toggle API / Manual en la vista de análisis, con preferencia persistida (default Manual).
6. **Frontend — flujo manual de 2 pasos:** textarea de salida (con copiar) + textarea de entrada (pegar respuesta) + botón aplicar + diff visual + confirmación.
7. **Frontend — vista de costo:** badge/sección de costo API acumulado.
8. **Tests:**
   - Generación del prompt incluye parámetros y métricas correctas
   - Validación rechaza JSON malformado, parámetros de otro tipo, y valores fuera de rango
   - Aplicar sugerencia válida crea una nueva versión con los parámetros correctos
   - Modo manual registra `ai_analysis` con `mode: manual` y costo `0`

---

## 8. Criterio de Aceptación (verificación e2e)

Con un backtest existente (ej: el EMA cross EURUSD que pierde):
1. Elegir modo **Manual** en el selector
2. Generar el prompt → copiar el bloque
3. (Simular respuesta de Claude pegando un JSON válido con parámetros ajustados)
4. Aplicar → ver el diff antes/después → confirmar
5. Verificar que se creó la **v2** de la estrategia con los parámetros nuevos
6. Lanzar un backtest de la v2 y comparar contra la v1
7. Verificar que `ai_analyses` registró el análisis con `mode: manual`, costo `0`

---

## 9. Nota de Diseño

Mantener la coherencia visual con el resto de la plataforma (paleta dark de trading, JetBrains Mono para los valores numéricos del diff, Inter para textos). El bloque de prompt en un contenedor monoespaciado con scroll. El diff de parámetros con verde para valores nuevos y gris/tachado para los viejos, reutilizando los colores semánticos del sistema (`green-profit` para mejoras esperadas no aplica aquí — usar un azul/neutro para "cambiado" y evitar confundir con PnL).

---

*Documento complementario a FOREXBOT_PROJECT.md · Ejecutar después de confirmar Fase 6 (modo API)*
