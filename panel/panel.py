"""ForexBot Control Panel — herramienta de escritorio (tkinter).

Inicia / detiene / reinicia los servicios de ForexBot (Bridge, Laravel, Reverb,
Queue Worker) y muestra su salud en tiempo real, al estilo del XAMPP Control
Panel. Es externo a la web a propósito: la web es uno de los servicios que hay
que poder encender desde aquí.

Uso:  python panel.py      (o doble clic en panel.exe si se empaqueta)
Dependencia: psutil  (pip install -r requirements.txt)
"""

from __future__ import annotations

import json
import os
import queue
import socket
import subprocess
import sys
import threading
import time
import tkinter as tk
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from tkinter import messagebox

try:
    import psutil
except ImportError:  # pragma: no cover - mensaje claro si falta la dependencia
    print("Falta 'psutil'. Instala con:  pip install -r requirements.txt")
    sys.exit(1)


# --------------------------------------------------------------------------- #
# Rutas y constantes
# --------------------------------------------------------------------------- #
PANEL_DIR = Path(__file__).resolve().parent
ROOT_DIR = PANEL_DIR.parent
BRIDGE_DIR = ROOT_DIR / "bridge"
APP_DIR = ROOT_DIR / "app"
BRIDGE_PY = BRIDGE_DIR / "venv" / "Scripts" / "python.exe"
LOG_DIR = PANEL_DIR / "logs"
STATE_FILE = PANEL_DIR / "panel_state.json"

HEALTH_URL = "http://127.0.0.1:8000/health"

# Banderas de creación de proceso en Windows: sin ventana de consola + grupo
# propio (para que el panel pueda gestionarlo y sobreviva al cierre del panel).
CREATE_NO_WINDOW = 0x08000000
CREATE_NEW_PROCESS_GROUP = 0x00000200
CREATE_FLAGS = CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0

# Paleta (dark, coherente con la plataforma)
BG = "#0D0E11"
PANEL = "#141519"
PANEL2 = "#1B1D23"
TEXT = "#E8E9ED"
MUTED = "#8B8FA8"
GREEN = "#26A69A"
RED = "#EF5350"
GRAY = "#8B8FA8"
YELLOW = "#F59E0B"
BORDER = "#262932"

FONT_LABEL = ("Segoe UI", 10)
FONT_LABEL_B = ("Segoe UI", 10, "bold")
FONT_MONO = ("Consolas", 10)
FONT_TITLE = ("Segoe UI", 13, "bold")
FONT_SMALL = ("Consolas", 8)


def find_php() -> str | None:
    """Resuelve un php.exe utilizable. Prioriza el que usa el usuario a diario."""
    candidates = [
        Path(r"C:\php\php.exe"),
        Path(
            r"C:\Users\<user>\AppData\Local\Microsoft\WinGet\Packages"
            r"\PHP.PHP.8.3_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe"
        ),
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    from shutil import which

    return which("php")


PHP = find_php()


# --------------------------------------------------------------------------- #
# Definición de servicios
# --------------------------------------------------------------------------- #
def _service_defs() -> list[dict]:
    php_serve = [PHP, "artisan", "serve", "--host=0.0.0.0", "--port=8090"] if PHP else None
    return [
        {
            "key": "bridge",
            "name": "Bridge Python",
            "port": 8000,
            "cmd": [str(BRIDGE_PY), "run.py"] if BRIDGE_PY.exists() else None,
            "cwd": str(BRIDGE_DIR),
            "health": True,
        },
        {
            "key": "laravel",
            "name": "Laravel",
            "port": 8090,
            "cmd": php_serve,
            "cwd": str(APP_DIR),
            "health": False,
        },
        {
            "key": "reverb",
            "name": "Reverb",
            "port": 8085,
            "cmd": [PHP, "artisan", "reverb:start"] if PHP else None,
            "cwd": str(APP_DIR),
            "health": False,
        },
        {
            "key": "queue",
            "name": "Queue Worker",
            "port": None,
            "cmd": [PHP, "artisan", "queue:work"] if PHP else None,
            "cwd": str(APP_DIR),
            "health": False,
        },
    ]


# --------------------------------------------------------------------------- #
# Helpers de red / procesos
# --------------------------------------------------------------------------- #
def port_listening(port: int, timeout: float = 0.35) -> bool:
    """¿Hay algo escuchando en 127.0.0.1:port? (sin privilegios)."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout):
            return True
    except OSError:
        return False


def find_pid_by_port(port: int) -> int | None:
    """PID que escucha en el puerto (puede requerir permisos; tolera fallos)."""
    try:
        for c in psutil.net_connections(kind="inet"):
            if c.laddr and c.laddr.port == port and c.status == psutil.CONN_LISTEN and c.pid:
                return c.pid
    except (psutil.AccessDenied, OSError):
        return None
    return None


def pid_alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        p = psutil.Process(pid)
        return p.is_running() and p.status() != psutil.STATUS_ZOMBIE
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return False


def kill_tree(pid: int | None) -> None:
    """Mata el proceso y toda su descendencia (uvicorn --reload deja hijos)."""
    if not pid:
        return
    try:
        parent = psutil.Process(pid)
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return
    procs = []
    try:
        procs = parent.children(recursive=True)
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        pass
    procs.append(parent)
    for p in procs:
        try:
            p.kill()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    psutil.wait_procs(procs, timeout=5)


def fetch_health(timeout: float = 2.0) -> dict | None:
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None


def is_market_open(now: datetime | None = None) -> bool:
    """Heurística de horario forex (UTC): cerrado el fin de semana.

    Abre dom ~21:00 UTC, cierra vie ~21:00 UTC.
    """
    now = now or datetime.now(tz=timezone.utc)
    wd = now.weekday()  # lun=0 ... dom=6
    h = now.hour
    if wd == 5:  # sábado
        return False
    if wd == 6:  # domingo: abre por la tarde-noche
        return h >= 21
    if wd == 4:  # viernes: cierra por la tarde-noche
        return h < 21
    return True


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_state(pids: dict) -> None:
    try:
        STATE_FILE.write_text(json.dumps(pids), encoding="utf-8")
    except Exception:
        pass


# --------------------------------------------------------------------------- #
# Controlador de servicios (lógica, sin UI)
# --------------------------------------------------------------------------- #
class ServiceManager:
    def __init__(self) -> None:
        self.defs = {s["key"]: s for s in _service_defs()}
        # PIDs de procesos lanzados por el panel (adopta los previos si siguen vivos).
        self.pids: dict[str, int] = {}
        for key, pid in load_state().items():
            if pid_alive(pid):
                self.pids[key] = pid
        LOG_DIR.mkdir(exist_ok=True)

    # -- estado -----------------------------------------------------------
    def is_running(self, key: str) -> bool:
        svc = self.defs[key]
        if svc["port"]:
            return port_listening(svc["port"])
        return pid_alive(self.pids.get(key))

    def known(self, key: str) -> bool:
        """¿Podemos determinar el estado? (queue sin PID rastreado = desconocido)."""
        svc = self.defs[key]
        if svc["port"]:
            return True
        return key in self.pids

    # -- control ----------------------------------------------------------
    def start(self, key: str) -> tuple[bool, str]:
        svc = self.defs[key]
        if self.is_running(key):
            return True, f"{svc['name']} ya estaba corriendo."
        if not svc["cmd"]:
            reason = "Python del bridge no encontrado" if key == "bridge" else "PHP no encontrado en el sistema"
            return False, f"No se puede iniciar {svc['name']}: {reason}."
        try:
            logf = open(LOG_DIR / f"{key}.log", "ab", buffering=0)
            proc = subprocess.Popen(
                svc["cmd"],
                cwd=svc["cwd"],
                stdout=logf,
                stderr=logf,
                stdin=subprocess.DEVNULL,
                creationflags=CREATE_FLAGS,
            )
            logf.close()  # el proceso hijo conserva su propia copia del handle
        except Exception as exc:  # noqa: BLE001
            return False, f"Error al iniciar {svc['name']}: {exc}"
        self.pids[key] = proc.pid
        save_state(self.pids)
        return True, f"{svc['name']} iniciado (PID {proc.pid})."

    def stop(self, key: str) -> tuple[bool, str]:
        svc = self.defs[key]
        pid = self.pids.get(key)
        killed = False
        if pid_alive(pid):
            kill_tree(pid)
            killed = True
        # Fallback: si sigue ocupando el puerto (proceso ajeno), matar por puerto.
        if svc["port"] and port_listening(svc["port"]):
            foreign = find_pid_by_port(svc["port"])
            if foreign:
                kill_tree(foreign)
                killed = True
        self.pids.pop(key, None)
        save_state(self.pids)
        if killed:
            return True, f"{svc['name']} detenido."
        return True, f"{svc['name']} ya estaba detenido."

    def restart(self, key: str) -> tuple[bool, str]:
        self.stop(key)
        time.sleep(1.2)
        return self.start(key)


# --------------------------------------------------------------------------- #
# Interfaz tkinter
# --------------------------------------------------------------------------- #
ORDER = ["bridge", "laravel", "reverb", "queue"]


class Dot(tk.Canvas):
    def __init__(self, master, r: int = 6):
        super().__init__(master, width=r * 2 + 2, height=r * 2 + 2, bg=master["bg"], highlightthickness=0)
        self._id = self.create_oval(2, 2, r * 2, r * 2, fill=GRAY, outline="")

    def set(self, color: str) -> None:
        self.itemconfig(self._id, fill=color)


class App:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.mgr = ServiceManager()
        self.pending: dict[str, tuple[str, float]] = {}  # key -> (starting|stopping, deadline)
        self._stop_refresh = threading.Event()
        # tkinter no es thread-safe: los hilos solo encolan; el hilo de UI aplica.
        self.ui_queue: queue.Queue = queue.Queue()

        root.title("ForexBot Control Panel")
        root.configure(bg=BG)
        root.geometry("640x680")
        root.minsize(600, 640)

        self.svc_dots: dict[str, Dot] = {}
        self.svc_btns: dict[str, dict[str, tk.Button]] = {}
        self.diag_dots: dict[str, Dot] = {}
        self.diag_labels: dict[str, tk.Label] = {}

        self._build()
        root.protocol("WM_DELETE_WINDOW", self.on_close)

        # Hilo de refresco (la red/psutil fuera del hilo de UI) + drenado en UI.
        threading.Thread(target=self._refresh_loop, name="refresh", daemon=True).start()
        self.root.after(150, self._drain_queue)

    # -- construcción de la UI -------------------------------------------
    def _build(self) -> None:
        header = tk.Frame(self.root, bg=BG)
        header.pack(fill="x", padx=18, pady=(16, 8))
        tk.Label(header, text="ForexBot Control Panel", bg=BG, fg=TEXT, font=FONT_TITLE).pack(side="left")
        self.summary = tk.Frame(header, bg=BG)
        self.summary.pack(side="right")
        self.summary_dots = [Dot(self.summary, 5) for _ in range(3)]
        for d in self.summary_dots:
            d.pack(side="left", padx=2)

        if not PHP:
            warn = tk.Label(
                self.root,
                text="Aviso: PHP no encontrado: Laravel/Reverb/Worker no podrán iniciarse.",
                bg=BG, fg=YELLOW, font=FONT_SMALL,
            )
            warn.pack(fill="x", padx=18)

        # --- Servicios ---
        self._section_title("SERVICIOS")
        sframe = tk.Frame(self.root, bg=PANEL, highlightbackground=BORDER, highlightthickness=1)
        sframe.pack(fill="x", padx=18, pady=(0, 12))
        for key in ORDER:
            self._service_row(sframe, key)

        # --- Diagnóstico ---
        self._section_title("DIAGNÓSTICO  (solo lectura)")
        dframe = tk.Frame(self.root, bg=PANEL, highlightbackground=BORDER, highlightthickness=1)
        dframe.pack(fill="x", padx=18, pady=(0, 12))
        self._diag_row(dframe, "mt5", "MT5 conectado")
        self._diag_row(dframe, "algo", "Algo Trading")
        self._diag_row(dframe, "market", "Mercado abierto")

        # --- Controles globales ---
        gframe = tk.Frame(self.root, bg=BG)
        gframe.pack(fill="x", padx=18, pady=(0, 8))
        tk.Button(
            gframe, text="INICIAR TODO", command=lambda: self._async(self.start_all),
            bg=GREEN, fg="#06231F", activebackground=GREEN, font=FONT_LABEL_B,
            relief="flat", padx=10, pady=8, cursor="hand2",
        ).pack(side="left", expand=True, fill="x", padx=(0, 6))
        tk.Button(
            gframe, text="DETENER TODO", command=lambda: self._async(self.stop_all),
            bg=PANEL2, fg=RED, activebackground=PANEL2, font=FONT_LABEL_B,
            relief="flat", padx=10, pady=8, cursor="hand2",
        ).pack(side="left", expand=True, fill="x", padx=(6, 0))

        self.updated = tk.Label(self.root, text="Última actualización: —", bg=BG, fg=MUTED, font=FONT_SMALL)
        self.updated.pack(fill="x", padx=18)

        # --- Log de actividad ---
        self._section_title("ACTIVIDAD")
        self.log = tk.Text(
            self.root, height=6, bg=PANEL, fg=MUTED, font=FONT_SMALL, relief="flat",
            highlightbackground=BORDER, highlightthickness=1, wrap="word", state="disabled",
        )
        self.log.pack(fill="both", expand=True, padx=18, pady=(0, 16))

    def _section_title(self, text: str) -> None:
        tk.Label(self.root, text=text, bg=BG, fg=MUTED, font=("Segoe UI", 8, "bold")).pack(
            anchor="w", padx=20, pady=(4, 4)
        )

    def _service_row(self, parent: tk.Frame, key: str) -> None:
        svc = self.mgr.defs[key]
        row = tk.Frame(parent, bg=PANEL)
        row.pack(fill="x", padx=12, pady=7)

        dot = Dot(row)
        dot.pack(side="left", padx=(0, 10))
        self.svc_dots[key] = dot

        tk.Label(row, text=svc["name"], bg=PANEL, fg=TEXT, font=FONT_LABEL, width=15, anchor="w").pack(side="left")
        port_txt = f":{svc['port']}" if svc["port"] else "----"
        tk.Label(row, text=port_txt, bg=PANEL, fg=MUTED, font=FONT_MONO, width=7, anchor="w").pack(side="left")

        btns = {}
        for label, name in (("Start", "start"), ("Stop", "stop"), ("Restart", "restart")):
            b = tk.Button(
                row, text=label, width=7, bg=PANEL2, fg=TEXT, activebackground=BORDER,
                relief="flat", font=FONT_LABEL, cursor="hand2",
                command=lambda k=key, n=name: self._do_action(k, n),
            )
            b.pack(side="left", padx=2)
            btns[name] = b
        self.svc_btns[key] = btns

    def _diag_row(self, parent: tk.Frame, key: str, label: str) -> None:
        row = tk.Frame(parent, bg=PANEL)
        row.pack(fill="x", padx=12, pady=7)
        dot = Dot(row)
        dot.pack(side="left", padx=(0, 10))
        self.diag_dots[key] = dot
        lbl = tk.Label(row, text=label, bg=PANEL, fg=TEXT, font=FONT_LABEL, anchor="w")
        lbl.pack(side="left")
        self.diag_labels[key] = lbl

    # -- acciones ---------------------------------------------------------
    def _async(self, fn) -> None:
        threading.Thread(target=fn, daemon=True).start()

    def _do_action(self, key: str, name: str) -> None:
        self.pending[key] = ("stopping" if name == "stop" else "starting", time.time() + 12)
        self._render_pending(key)  # estamos en el hilo de UI (callback de botón)

        def run():
            fn = {"start": self.mgr.start, "stop": self.mgr.stop, "restart": self.mgr.restart}[name]
            ok, msg = fn(key)
            self.ui_queue.put(("log", (msg, ok)))

        self._async(run)

    def start_all(self) -> None:  # corre en hilo aparte
        self.ui_queue.put(("log", ("Iniciando todos los servicios…", True)))
        for key in ORDER:  # bridge → laravel → reverb → queue
            self.ui_queue.put(("pending", (key, "starting", 14)))
            ok, msg = self.mgr.start(key)
            self.ui_queue.put(("log", (msg, ok)))
            time.sleep(2.0)

    def stop_all(self) -> None:  # corre en hilo aparte
        self.ui_queue.put(("log", ("Deteniendo todos los servicios…", True)))
        for key in reversed(ORDER):  # orden inverso
            self.ui_queue.put(("pending", (key, "stopping", 8)))
            ok, msg = self.mgr.stop(key)
            self.ui_queue.put(("log", (msg, ok)))
            time.sleep(0.6)

    # -- refresco ---------------------------------------------------------
    def _refresh_loop(self) -> None:
        while not self._stop_refresh.is_set():
            data = self._gather()
            self.ui_queue.put(("status", data))
            self._stop_refresh.wait(2.5)

    def _drain_queue(self) -> None:
        """Aplica en el hilo de UI los mensajes encolados por los hilos de trabajo."""
        try:
            while True:
                kind, payload = self.ui_queue.get_nowait()
                if kind == "status":
                    self._apply(payload)
                elif kind == "log":
                    self._activity(*payload)
                elif kind == "pending":
                    k, mode, secs = payload
                    self.pending[k] = (mode, time.time() + secs)
                    self._render_pending(k)
        except queue.Empty:
            pass
        if not self._stop_refresh.is_set():
            self.root.after(150, self._drain_queue)

    def _gather(self) -> dict:
        running = {key: self.mgr.is_running(key) for key in ORDER}
        known = {key: self.mgr.known(key) for key in ORDER}
        health = fetch_health()
        return {"running": running, "known": known, "health": health, "ts": datetime.now()}

    def _apply(self, data: dict) -> None:
        now = time.time()
        running, known, health = data["running"], data["known"], data["health"]

        for key in ORDER:
            # Limpia el estado de transición si ya se alcanzó el destino.
            if key in self.pending:
                kind, deadline = self.pending[key]
                done = running[key] if kind == "starting" else not running[key]
                if done or now > deadline:
                    self.pending.pop(key, None)

            if key in self.pending:
                color = YELLOW
            elif key == "bridge" and running[key] and health is None:
                color = YELLOW  # puerto arriba pero /health aún no responde
            elif not known[key]:
                color = GRAY
            elif running[key]:
                color = GREEN
            else:
                color = RED
            self.svc_dots[key].set(color)

            btns = self.svc_btns[key]
            is_run = running[key]
            btns["start"].config(state="disabled" if is_run else "normal")
            btns["stop"].config(state="normal" if is_run else "disabled")

        # Resumen (3 puntos del header): bridge / laravel / reverb
        for d, key in zip(self.summary_dots, ("bridge", "laravel", "reverb")):
            d.set(GREEN if running[key] else RED)

        self._apply_diag(health)
        self.updated.config(text="Última actualización: " + data["ts"].strftime("%H:%M:%S"))

    def _apply_diag(self, health: dict | None) -> None:
        if health is None:
            for key, base in (("mt5", "MT5 conectado"), ("algo", "Algo Trading"), ("market", "Mercado abierto")):
                self.diag_dots[key].set(GRAY)
                self.diag_labels[key].config(text=f"{base}  → requiere bridge activo", fg=MUTED)
            return

        connected = bool(health.get("connected"))
        self.diag_dots["mt5"].set(GREEN if connected else RED)
        self.diag_labels["mt5"].config(
            text="MT5 conectado" if connected else "MT5 desconectado  → abre MT5 y loguéate",
            fg=TEXT if connected else RED,
        )

        algo = bool((health.get("terminal") or {}).get("trade_allowed"))
        self.diag_dots["algo"].set(GREEN if algo else RED)
        self.diag_labels["algo"].config(
            text="Algo Trading activo" if algo else "Algo Trading APAGADO  → actívalo en MT5 (Ctrl+E)",
            fg=TEXT if algo else RED,
        )

        market = is_market_open()
        self.diag_dots["market"].set(GREEN if market else RED)
        self.diag_labels["market"].config(
            text="Mercado abierto" if market else "Mercado cerrado  → esperar apertura",
            fg=TEXT if market else MUTED,
        )

    def _render_pending(self, key: str) -> None:
        if key in self.pending:
            self.svc_dots[key].set(YELLOW)

    # -- log / cierre -----------------------------------------------------
    def _activity(self, msg: str, ok: bool) -> None:
        ts = datetime.now().strftime("%H:%M:%S")
        self.log.config(state="normal")
        self.log.insert("end", f"[{ts}] {'' if ok else '! '}{msg}\n")
        self.log.see("end")
        self.log.config(state="disabled")

    def on_close(self) -> None:
        any_running = any(self.mgr.is_running(k) for k in ORDER)
        if not any_running:
            self._shutdown()
            return
        resp = messagebox.askyesnocancel(
            "Cerrar panel",
            "Hay servicios corriendo.\n\n"
            "Sí  → detener los servicios y cerrar\n"
            "No  → dejarlos corriendo y cerrar\n"
            "Cancelar → no cerrar",
        )
        if resp is None:
            return
        if resp:
            for key in reversed(ORDER):
                self.mgr.stop(key)
        self._shutdown()

    def _shutdown(self) -> None:
        self._stop_refresh.set()
        self.root.destroy()


def main() -> None:
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
