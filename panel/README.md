# ForexBot Control Panel

Herramienta de escritorio (tkinter) para iniciar/detener/reiniciar los servicios
de ForexBot y ver su salud en tiempo real, al estilo del **XAMPP Control Panel**.

Es **externa a la web** a propósito: la web (Laravel) es uno de los servicios que
hay que poder encender desde aquí, así que no podía ser una página web.

## Qué controla

| Servicio | Puerto | Detección |
|---|---|---|
| Bridge Python (MT5) | 8000 | puerto + `GET /health` |
| Laravel | 8090 | puerto |
| Reverb (WebSockets) | 8085 | puerto |
| Queue Worker | — | proceso vivo (PID) |

Y muestra un **diagnóstico de solo lectura** leyendo el `/health` del bridge:

- **MT5 conectado** — si está en rojo, abre MetaTrader 5 y loguéate.
- **Algo Trading** — si está en rojo, **actívalo en MT5 con `Ctrl+E`** (no se puede
  por software; MT5 lo apaga solo a veces). Sin esto el bot no puede operar.
- **Mercado abierto** — heurística de horario forex (cerrado el fin de semana).

## Requisitos

- Python 3 (el mismo que ya usa el bridge sirve)
- `psutil`:

```
cd D:\mtrad\panel
pip install -r requirements.txt
```

## Uso

```
python panel.py
```

- **Start/Stop/Restart** por servicio con los botones `▶ ■ ↻`.
- **INICIAR TODO** los levanta en orden (Bridge → Laravel → Reverb → Worker);
  **DETENER TODO** en orden inverso.
- El estado se refresca solo cada ~2,5 s (semáforo verde/rojo/gris/amarillo).
- Cerrar el panel **no mata los servicios**: pregunta si quieres detenerlos o
  dejarlos corriendo. Los procesos son independientes del panel.
- El panel **adopta** servicios que ya estaban corriendo (los detecta por puerto)
  y recuerda los PID que lanzó (en `panel_state.json`) entre reinicios del panel.

### Notas

- **PHP:** el panel busca `php.exe` en `C:\php\php.exe`, luego en la instalación
  winget, y por último en el `PATH`. Si no encuentra ninguno, avisa y Laravel /
  Reverb / Worker no podrán iniciarse.
- Los logs de cada servicio se guardan en `panel/logs/<servicio>.log` (útiles si
  un servicio no arranca).

## Empaquetar como .exe (opcional, doble clic)

```
pip install pyinstaller
pyinstaller --noconsole --onefile --name "ForexBot Panel" panel.py
```

El ejecutable queda en `dist\ForexBot Panel.exe`.
