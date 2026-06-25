# ForexBot — Panel de Control de Escritorio
> Herramienta externa (NO web) para iniciar/detener/reiniciar los servicios y ver su salud en tiempo real
> Inspirado en el XAMPP Control Panel · Independiente de la web (por eso puede levantar la web)

---

## 1. Objetivo y Justificación

El usuario no levanta los servicios manualmente; necesita una herramienta única para controlarlos. No puede ser web, porque la web es uno de los servicios que hay que levantar (no se puede acceder a una web que está apagada para encenderla).

**Solución:** una app de escritorio ligera, estilo XAMPP Control Panel, que:
- Muestra el estado en tiempo real de cada servicio (semáforo verde/rojo)
- Permite Start / Stop / Restart de cada servicio individualmente
- Tiene "Iniciar TODO" / "Detener TODO"
- Muestra diagnóstico de solo lectura (MT5, Algo Trading, mercado) que alerta de problemas aunque no pueda resolverlos por software

---

## 2. Tecnología

- **Python + tkinter** (interfaz gráfica nativa, sin dependencias pesadas; Python ya está instalado por el bridge)
- Empaquetable como `.exe` con doble clic (PyInstaller) o ejecutable como script `python panel.py`
- Ubicación sugerida: `D:\mtrad\panel\` (carpeta nueva, separada de bridge/ y app/)
- Estética: limpia, tecnológica/elegante (ver sección 5)

---

## 3. Servicios a Controlar

Cada uno con su fila: nombre, semáforo de estado, y botones [Start] [Stop] [Restart].

| Servicio | Comando de arranque | Puerto | Detección de estado |
|---|---|---|---|
| Bridge Python | `cd D:\mtrad\bridge && venv\Scripts\python.exe run.py` | 8000 | puerto 8000 escuchando + `GET /health` responde |
| Laravel | `cd D:\mtrad\app && php artisan serve --host=0.0.0.0 --port=8090` | 8090 | puerto 8090 escuchando |
| Reverb | `cd D:\mtrad\app && php artisan reverb:start` | 8085 | puerto 8085 escuchando |
| Queue Worker | `cd D:\mtrad\app && php artisan queue:work` | — | proceso vivo (sin puerto; rastrear por PID lanzado) |

### Mecánica de control
- **Start:** lanza el comando en un proceso nuevo (oculto o en ventana propia). Guardar el PID para poder detenerlo.
- **Stop:** terminar el proceso por PID (y los hijos si los hay). Para servicios con puerto, como fallback, encontrar el PID por el puerto (`netstat`/psutil) y matarlo.
- **Restart:** Stop + espera breve + Start.
- Usar la librería `psutil` (única dependencia extra; ligera) para detección robusta de procesos y puertos. Si se prefiere cero dependencias, usar `netstat` parseado, pero psutil es más limpio.

> Importante: el panel debe recordar/rastrear los procesos que él lanzó para gestionarlos. Si un servicio ya estaba corriendo (lanzado fuera del panel), detectarlo por puerto y permitir adoptarlo o al menos mostrar su estado.

---

## 4. Diagnóstico de Solo Lectura

Sección separada, sin botones de control (no se pueden encender por software), solo semáforo + descripción:

| Chequeo | Cómo se detecta | Si está mal |
|---|---|---|
| MT5 conectado | `GET /health` del bridge → `connected: true` | Abrir MT5 y loguearse |
| Algo Trading | `GET /health` → `terminal.trade_allowed: true` | Activar en MT5 (Ctrl+E) — NO se puede por software |
| Mercado abierto | `GET /health` o lógica de horario (fin de semana = cerrado) | Esperar apertura |

> El chequeo de Algo Trading es CLAVE: es el problema recurrente del usuario (MT5 lo apaga solo). Mostrarlo prominente; cuando esté en rojo, un texto claro "Actívalo en MT5 con Ctrl+E".

> Estos chequeos dependen del bridge estar arriba. Si el bridge está caído, mostrarlos en gris/desconocido con nota "requiere bridge activo".

---

## 5. Diseño de la Interfaz

Estética tecnológica/elegante, coherente con el espíritu dark de la plataforma:

- **Tema oscuro:** fondo `#0D0E11` / paneles `#141519`, texto claro `#E8E9ED`
- **Semáforos:** círculos de color — verde `#26A69A` (corriendo), rojo `#EF5350` (detenido/error), gris `#8B8FA8` (desconocido), amarillo `#F59E0B` (iniciando/transición)
- **Tipografía:** monoespaciada para estados y puertos (look técnico), sans para labels
- **Layout:**
  ```
  ┌─────────────────────────────────────────────┐
  │  ForexBot Control Panel            ● ● ●     │
  ├─────────────────────────────────────────────┤
  │  SERVICIOS                                  │
  │  🟢 Bridge Python   :8000  [▶][■][↻]        │
  │  🟢 Laravel         :8090  [▶][■][↻]        │
  │  🟢 Reverb          :8085  [▶][■][↻]        │
  │  🟢 Queue Worker    ----   [▶][■][↻]        │
  ├─────────────────────────────────────────────┤
  │  DIAGNÓSTICO (solo lectura)                  │
  │  🟢 MT5 conectado                            │
  │  🔴 Algo Trading  → actívalo en MT5 (Ctrl+E) │
  │  🟢 Mercado abierto                          │
  ├─────────────────────────────────────────────┤
  │  [▶ INICIAR TODO]      [■ DETENER TODO]      │
  │  Última actualización: 09:42:13              │
  └─────────────────────────────────────────────┘
  ```
- **Refresco automático:** el estado se actualiza cada 2-3s (hilo aparte para no congelar la UI)
- Botones con estados deshabilitados coherentes (no permitir Start si ya corre)
- Opcional: un pequeño log de actividad en la parte inferior (qué se inició/detuvo y cuándo)

---

## 6. Comportamiento

- Al abrir el panel: detecta el estado actual de todo (no asume nada)
- "Iniciar TODO": arranca en orden lógico — Bridge primero, luego Laravel, Reverb, Worker (con pequeñas esperas entre cada uno)
- "Detener TODO": orden inverso
- El panel NO necesita estar abierto para que los servicios sigan corriendo (los procesos son independientes); cerrarlo no mata los servicios (preguntar al cerrar: "¿Detener servicios o dejarlos corriendo?")
- Manejo de errores: si un comando falla (ej: PHP no en PATH), mostrar el error claramente en lugar de fallar en silencio

---

## 7. Resumen de Tareas para el Agente

1. Crear `D:\mtrad\panel\` con la app tkinter (`panel.py`)
2. Detección de estado por puerto + health check del bridge (usar `psutil`)
3. Control Start/Stop/Restart por servicio, rastreando PIDs de procesos lanzados
4. Sección de diagnóstico de solo lectura (MT5, Algo Trading, mercado) leyendo `/health`
5. "Iniciar TODO" / "Detener TODO" con orden y esperas
6. Tema oscuro tecnológico, semáforos de color, refresco automático en hilo aparte
7. Manejo robusto de errores (PHP no en PATH, puerto ocupado, bridge caído)
8. `requirements.txt` del panel (psutil) + instrucciones de arranque
9. Opcional: empaquetar como `.exe` con PyInstaller para doble clic
10. README con cómo usarlo

---

## 8. Criterio de Aceptación

- Abrir el panel muestra el estado real de los 4 servicios y los 3 diagnósticos
- Start de un servicio detenido → pasa a verde; el servicio responde de verdad
- Stop → pasa a rojo; el proceso muere
- Restart → ciclo completo
- "Iniciar TODO" levanta los 4 en orden; la web queda accesible después
- Con Algo Trading apagado en MT5 → el panel lo muestra en rojo con el mensaje de activarlo
- Cerrar el panel no mata los servicios (o pregunta)
- El estado se refresca solo cada pocos segundos sin congelar la UI

---

## Mejora Anotada para Lote 2 (futuro, NO en este documento)
- Indicador de fecha y hora actual CON milisegundos en la web
- Timestamps con milisegundos en entradas, salidas y análisis (precisión temporal exacta)
- (Junto con el responsive móvil ya pendiente)

---

*Herramienta de escritorio · Externa a la web · Construir antes de la Fase 7B*
