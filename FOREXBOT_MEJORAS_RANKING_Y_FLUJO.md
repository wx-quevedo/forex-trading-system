# ForexBot — Mejoras: Ranking de Prioridad + Integridad de Datos entre Pantallas

> Conjunto de mejoras y correcciones surgidas al EMPEZAR A USAR la plataforma de verdad (tras completar las 8 fases del plan maestro). Se dividen en: (A) funcionalidades nuevas en el Explorador, y (B) bugs / verificaciones de integridad del flujo de datos entre pantallas.
>
> **Metodología:** mostrar plan antes de codificar; cada parte con sus tests; verificación en pantalla por el usuario. No subir ENGINE_VERSION salvo que se justifique (la mayoría de esto es análisis/visualización, no lógica de trades).

---

## CONTEXTO QUE MOTIVA ESTAS MEJORAS

Al usar la plataforma, ocurrió un caso revelador: una estrategia (EURUSD# H1 ma_cross SL2/TP4, riesgo 2%) que en el Explorador tenía **robustez ★★★★ y veredicto DENTRO**, con Sharpe 2.12 y +74% de retorno, **FALLÓ catastróficamente en el walk-forward del Bot Histórico**: −76% de retorno, win rate cayó de 40% a 22%, capital de $17,449 (backtest) a $2,337 (operación). 

**Lección:** la robustez del optimizador (consistencia in/out en un split) NO basta por sí sola para juzgar si una estrategia es operable. Las señales que predecían el colapso estaban en las OTRAS columnas: win rate bajo (39%), expectativa R delgada (+0.19), drawdown alto (−30%), retorno inflado por riesgo 2%. Necesitamos un score que combine TODAS las métricas y dé una pauta de prioridad.

---

# PARTE A — FUNCIONALIDADES NUEVAS (Explorador)

## A1 — ID por registro
Cada fila de resultados del Explorador debe tener un **ID visible y único**, para poder referirse a una estrategia sin describir todos sus parámetros ("la #47" en vez de "la ma_cross H1 SL2/TP4 riesgo 1%..."). 
- El ID debe ser estable dentro de una corrida de resultados.
- Visible como primera columna, incluido en el CSV exportado.

## A2 — Columna "Prioridad" (score de mérito compuesto)
Una columna nueva llamada **"Prioridad"** (NO "Best" — evitar nombres que suenen a promesa infalible) que ordene las estrategias de mejor a peor **probabilidad de ser rentable de forma sostenible**, combinando TODAS las columnas disponibles.

**Naturaleza de la columna (importante):** es una PAUTA DE PRIORIZACIÓN para validar, no un veredicto de rentabilidad. "Prioridad #1" significa "valida esta primero en walk-forward", NO "esta gana seguro". La validación walk-forward sigue siendo obligatoria para cualquier candidata sin importar su posición. Esto debe quedar claro en la UI (texto/tooltip).

**Diseño del algoritmo de score (criterio técnico, sin sesgo hacia preferencias del usuario):**

El score premia la ROBUSTEZ REAL ANTE EL DETERIORO y penaliza la FRAGILIDAD. Basado en lo que el caso real (la ma_cross que falló) demostró que predice un colapso.

*Factores que SUMAN al score:*
- **Consistencia in/out sample**: que OutSample sostenga InSample (ratio out/in cercano o superior a 1). Es la señal más predictiva de no-overfit. Peso alto.
- **Sharpe y Sortino**: calidad ajustada por riesgo. Peso medio-alto.
- **Expectativa R**: peso ALTO (su delgadez predijo el colapso). Premiar expectativa amplia, penalizar delgada.
- **Win rate**: no porque "alto = mejor" en abstracto, sino porque da MARGEN ante deterioro (un win 60% aguanta más caída de aciertos antes de volverse negativo que un win 39%). Peso medio.
- **Idoneidad MATCH de régimen**: coherencia estrategia↔mercado. Peso medio. (NEUTRO ni suma ni resta fuerte; MISMATCH resta.)
- **Número de operaciones suficiente** (≥80-100): significancia estadística. Penalizar fuerte si hay pocas ops (resultado no significativo).
- **Calmar**: retorno vs drawdown. Peso medio.

*Factores que RESTAN al score (señales de fragilidad):*
- **Drawdown alto**: penalización FUERTE y posiblemente no-lineal (un DD −30% debe penalizar mucho más que el doble de un −15%, porque en vivo suele ser peor — se confirmó: −30% backtest → −76% operación). 
- **Expectativa R delgada o negativa**: penalización fuerte.
- **Brecha in/out desfavorable** (out << in): señal de sobreajuste. Penalización fuerte.
- **Retorno inflado por riesgo alto**: NORMALIZAR por riesgo. Un +74% con riesgo 2% y DD −30% NO vale como un +20% con DD −8%. El score no debe premiar el apalancamiento/riesgo disfrazado de habilidad. (Considerar usar métricas ya normalizadas por riesgo —Sharpe, Calmar, expectativa R— como base, y tratar el retorno absoluto con cuidado o normalizado.)
- **MISMATCH de régimen**: resta.

**Principio rector:** una estrategia con métricas EQUILIBRADAS y MARGEN DE SEGURIDAD rankea más alto que una con un número espectacular y varias señales de fragilidad. El #1 NO es el mayor retorno — es la mejor combinación de probabilidad de sobrevivir al walk-forward y a la operación real.

**Validación del algoritmo:** aplicar el score al caso conocido — la ma_cross H1 SL2/TP4 riesgo 2% que falló (Sharpe 2.12, +74%, pero win 39%, exp +0.19, DD −30%) DEBE quedar penalizada y NO en los primeros puestos, a pesar de su Sharpe alto y sus 4 estrellas. Si el algoritmo la pone arriba, está mal calibrado. Idealmente, comparar contra una candidata equilibrada (win alto, DD bajo, expectativa amplia) que debería rankear por encima.

**Normalización:** el score final puede expresarse como un número (ej. 0-100) o como un ranking ordinal (1, 2, 3...). El usuario quiere poder "ir probando desde la #1 hacia abajo", así que el ORDEN es lo esencial; el número ayuda a ver la magnitud de la diferencia.

## A3 — Modal de desglose del score
Al hacer clic en el número de Prioridad de una fila, abrir una **modal** (no tooltip — hay demasiada info) que explique POR QUÉ esa estrategia está en esa posición:
- Lista de factores que SUMARON puntos (con cuántos y por qué, en lenguaje claro).
- Lista de factores que RESTARON puntos (con cuántos y por qué).
- Un veredicto resumen del score en lenguaje natural (ej. "candidata equilibrada, sin señales graves de fragilidad" o "retorno alto pero frágil: drawdown elevado y expectativa delgada").
- Reiterar que es una pauta para validar, no un veredicto.

Ejemplo de formato deseado:
```
Estrategia #12 — Prioridad: 68/100
SUMARON:
 • Consistencia in/out sólida (out 18.1% ≈ in 15.5%): +18 — el out sostiene el in, baja señal de overfit
 • Sharpe 1.8 (bueno): +12
 • Win rate 58% (buen margen): +10
 • Régimen MATCH: +8
 • 142 operaciones (significativo): +6
RESTARON:
 • Drawdown −19% (moderado-alto): −8
 • Expectativa R +0.14 (delgada): −5
VEREDICTO: candidata equilibrada, sin señales graves de fragilidad. Buena para validar en walk-forward.
```

El desglose debe derivarse de la MISMA función que calcula el score (una sola fuente de verdad: la función devuelve el score Y el detalle de cómo se compuso).

---

# PARTE B — BUGS Y VERIFICACIONES DE INTEGRIDAD DE DATOS ENTRE PANTALLAS

> Patrón sospechado: al añadir los campos nuevos en las fases (régimen, idoneidad, Sharpe/Sortino/Calmar/expectativa), es posible que NO se hayan propagado a TODOS los flujos entre pantallas. Revisar de forma INTEGRAL, no parche por parche. El bug del `#` (abajo) ya confirmó que este tipo de pérdida de datos ocurre.

## B1 — Bug confirmado: el Laboratorio pierde el sufijo `#` del símbolo
- Síntoma: al elegir `GOLD#` en el selector del Laboratorio y ejecutar, el bridge responde "Símbolo desconocido 'GOLD'" (sin `#`).
- Dato de diagnóstico: en el EXPLORADOR el oro funciona perfectamente con `GOLD#`. El bug es específico del Laboratorio, que pierde el `#` antes de llamar al bridge.
- Hipótesis: hay una transformación que parte el símbolo por `#` (quizá para mostrar un nombre sin sufijo) y luego usa por error la versión recortada para la llamada real.
- Pedido: rastrear el flujo del símbolo en el Laboratorio; corregir para que envíe el símbolo COMPLETO (`GOLD#`); si hay versión "display" sin `#`, que sea solo para mostrar. Añadir test de que un símbolo con `#` llega intacto al bridge. **Revisar si el mismo bug está en otros sitios** (la transformación podría estar copiada).

## B2 — Verificar flujo Explorador → Laboratorio (campos completos)
Cuando se carga una estrategia del Explorador al Laboratorio, verificar que TODOS los campos nuevos lleguen completos: régimen, idoneidad MATCH/MISMATCH, Sharpe/Sortino/Calmar/expectativa R, y el nuevo ID/Prioridad. Que no se pierda nada en el traspaso (relacionado con el bug del `#`).

## B3 — Verificar flujo Favoritos → Bot (campos completos + no alteración por controles de riesgo)
- Cuando se carga un favorito al Bot que opera, verificar que los campos nuevos del favorito (régimen, métricas, ID/Prioridad) viajen intactos y se conserven.
- Verificar específicamente que los controles de riesgo del bot — **"Límite pérdida diaria (por estrategia)"** y **"Máx posiciones (por estrategia)"** — NO alteren ni pisen los campos nuevos de la estrategia. Son controles de operación del bot, separados de la definición de la estrategia; confirmar que coexisten sin interferir.

## B4 — Verificar flujo hacia el Bot Histórico (campos completos) — con bug sospechado
- Verificar que cuando una estrategia (desde Favoritos o Explorador) llega al Bot Histórico para el walk-forward, lleve TODOS sus campos nuevos.
- **Bug sospechado/observado:** en la pantalla de validación walk-forward, la cabecera mostraba **"Régimen — backtest: — · operación: —"** (con guiones/vacío). Esto sugiere que el RÉGIMEN no está llegando al Bot Histórico. Investigar por qué el régimen sale vacío ahí y corregir para que se muestre (régimen del periodo de backtest y régimen del periodo de operación, con su MATCH/MISMATCH — que era justamente parte del valor de la Fase 3 y 7 para explicar degradaciones).

## B5 — Explorador: timeframes cortos (M5, M15, M30) no muestran resultados
- Síntoma: al explorar EURUSD en M5/M15/M30, el sistema "calcula" (barra de progreso avanza) pero la tabla queda VACÍA — nunca muestra resultados, ni siquiera malos. En H1 sí muestra resultados (buenos y malos).
- Observación del usuario (válida): debería mostrar resultados aunque sean todos malos; una tabla vacía tras calcular es sospechosa.
- **Distinguir dos causas posibles (esto es clave):**
  1. **Filtro/visualización:** ¿la vista filtra por "inside" por defecto, y como en M5 ninguna combinación pasa el filtro de robustez (normal en timeframes cortos: domina el ruido y los costos pesan más), la tabla sale vacía cuando DEBERÍA mostrar las "outside" también (o al menos un mensaje claro "se evaluaron N combinaciones, 0 robustas")? → sería bug de UX/filtro.
  2. **Cálculo/datos:** ¿en timeframes cortos sobre un periodo largo (13 meses) hay un problema con la cantidad de velas (demasiadas), un límite que se topa, o un timeout, y el cálculo termina sin producir filas? → sería bug de cálculo.
- Pedido: investigar y distinguir cuál de las dos es. Reportar: ¿el cálculo PRODUCE filas que luego se filtran/ocultan, o NO produce filas en absoluto? Según eso, corregir el filtro/mensaje (mostrar resultados aunque sean malos, o un mensaje claro del porqué no hay ninguna) o el problema de cálculo. El mensaje actual "¿velas insuficientes? prueba un rango más amplio" puede estar despistando, porque en M5 el problema sería el opuesto (demasiadas velas).

---

# DECISIONES TÉCNICAS A CONFIRMAR POR EL AGENTE
- ¿Algo de esto afecta caché/ENGINE_VERSION? La Parte A (ID, Prioridad, modal) es análisis/visualización sobre resultados existentes → no debería tocar caché ni versión. La Parte B son correcciones de flujo de datos → tampoco deberían. Confirmar y justificar.
- El score de Prioridad: ¿calcularlo en el bridge (testeable, una sola fuente de verdad) o en el frontend? Recomendación: en el bridge o en una función pura compartida, para poder testearlo contra el caso conocido (la ma_cross que falló).
- Mostrar plan antes de codificar. Trabajar ordenadamente: sugerencia de orden — primero B1 (bug confirmado del `#`) y B4 (régimen en Bot Histórico) y B5 (timeframes cortos) que son correcciones; luego A1/A2/A3 (ranking) que es lo nuevo; las verificaciones B2/B3 en paralelo.

---

*Mejoras post-implementación · ranking de Prioridad con desglose + integridad de datos entre pantallas · el caso de la ma_cross que falló en walk-forward es el caso de prueba del algoritmo de score · la Prioridad es pauta para validar, NO veredicto de rentabilidad*
